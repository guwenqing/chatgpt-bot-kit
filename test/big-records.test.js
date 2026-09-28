// A conversation record too big to read as one string is still read (#396).
//
// The kit used to read a whole rollout or transcript into one string to get at
// its first line, its user turns or its usage records. Node cannot make a
// string longer than `buffer.constants.MAX_STRING_LENGTH` (about 512 MB), so
// for a file over that the read threw, and the kit went on as if the file had
// nothing in it: a Codex rollout dropped out of the conversations of its bot
// home without a word, `obk usage` showed its session with no calls and said
// nothing was left out, and a start prompt it held was "not confirmed". The
// issue's comment has the live case: a 1,281 MB rollout, 224 `token_count`
// events in a day, shown as nothing.
//
// What is wanted, by what a user can see:
//
//   1. A Codex rollout whose first line is `session_meta` (its folder the bot
//      home), then real records, then more than fits in one string, is still a
//      conversation of the bot home: the book's `unclaimed` lists it, and
//      `obk usage` counts the calls it can read. What it cannot read is said,
//      in `unreadable_transcripts` or `broken_lines`.
//   2. `up` finds the start prompt in such a rollout: `promptReceived`.
//   3. A Claude Code transcript the same way: its first line's time is the one
//      the book goes by, the start prompt in it is found, and its calls count.
//   4. A fork (#376) whose origin is that big is counted or reported, never
//      silently missing.
//   5. A record that cannot be opened at all is reported as unreadable.
//   6. Reading a big file in pieces does not break a character in two: a user
//      turn whose emoji straddles a 64 KiB boundary is still found, whole.
//   7. A conversation the book names under a session is that session's,
//      wherever its record was filed (the architect's ruling on #396; ADR
//      0012): `obk usage` counts it under that session, big or not, and not
//      as unclaimed. One filed elsewhere that the book does not name is not
//      this bot's at all. The live case was a conversation carried into a bot
//      by hand, having started in another folder.
//
// The stand-in for "more than fits in one string" is a sparse file: the real
// lines are written, and then the file is extended past MAX_STRING_LENGTH with
// truncate. That stands in for a real 1.28 GB rollout at no cost in disk or
// time. The region it adds reads as NUL bytes with no newline in it, so it is
// one enormous line that is not JSON: a reader has to get past an over-long
// line as well as a big file, and counts it as broken rather than holding it
// whole. Every test that grows a file checks the premise on it: reading it
// whole with readFileSync(…, 'utf8') throws.
//
// Every record is written in the sandbox's own home. Nothing reads the real
// `~/.codex` or `~/.claude`. The helpers are copied from usage.test.js,
// usage-forks.test.js, session-unclaimed.test.js and prompt-received.test.js,
// so that importing them does not run their tests again.

import assert from 'node:assert/strict';
import { constants } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { chmod, mkdir, open, readdir, truncate, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { stringify } from 'yaml';

import {
  bookOf,
  botHomeOf,
  createSandbox,
  harnessChain,
  orcaCallsOf,
  recordSession,
  sessionIn,
  sessionStart,
  shellWord,
} from './helpers/cli.js';

/** A size no string can hold: the longest there is, and a megabyte more. */
const TOO_BIG = constants.MAX_STRING_LENGTH + 1024 * 1024;

/** Make `file` too big to read whole: what is written stays, and NUL bytes follow to TOO_BIG. */
const grow = (file) => truncate(file, TOO_BIG);

/** The premise: the file cannot be read whole into one string. */
function assertTooBigToReadWhole(file) {
  assert.throws(
    () => readFileSync(file, 'utf8'),
    { code: 'ERR_STRING_TOO_LONG' },
    `${file} should be too big to read whole, or this test shows nothing`,
  );
}

/** Root reads a file whatever its permissions, so a record cannot be made unreadable to it. */
const UNREADABLE_NEEDS_A_USER = process.getuid?.() === 0
  && 'runs as root, which reads a file whatever its permissions, so no record can be made unreadable';

/** A moment on the day the usage tests are set, as both harnesses write one. */
const at = (hour, minute = 0) =>
  `2026-09-20T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;

const CODEX_MODEL = 'gpt-6-astra';
const CLAUDE_MODEL = 'claude-sonnet-5';

/** Conversation ids, shaped as Codex shapes them. */
const BIG = '019f9700-0000-7000-8000-00000000b16b';
const SMALL = '019f9700-0000-7000-8000-000000005a11';
const PARENT = '019f9600-0000-7000-8000-00000000aaaa';
const CHILD = '019f9685-bce3-7000-8000-00000000bbbb';

// ---------------------------------------------------------------- the fleet

/** A bots folder with one bot in it, its session written, and nothing opened in Orca. */
async function fleet(box, harness) {
  const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(init.code, 0, init.stderr);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily']);
  assert.equal(added.code, 0, added.stderr);
  const bots = box.path('bots');
  return { bots, home: botHomeOf(bots, 'api-bot') };
}

/** A bots folder with one bot on `harness` and its session, brought up. */
async function started(box, harness) {
  const { bots, home } = await fleet(box, harness);
  const up = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot', '--json']);
  assert.equal(up.code, 0, up.stderr);
  return { bots, home };
}

/** The book of one bot, written as the kit writes it. */
const bookSays = (bots, bot, sessions) =>
  writeFile(bookOf(bots, bot), stringify({ orca: { project: 'proj-1', setup: 'setup-1' }, sessions }));

/** A session entry of the book: the conversation it is in. */
const ran = (session) => ({ tab: 'tab-daily', launched: at(8), session });

// ------------------------------------------------- what the harnesses write down

/** A Codex usage record: cached tokens inside the input, reasoning inside the output. */
const codexTokens = ({ input = 0, cached = 0, cacheWrite = 0, output = 0, reasoning = 0 }) => ({
  input_tokens: input,
  cached_input_tokens: cached,
  cache_write_input_tokens: cacheWrite,
  output_tokens: output,
  reasoning_output_tokens: reasoning,
  total_tokens: input + output,
});

/** One Codex API call: what it used, and the running total for the conversation after it. */
const codexCall = ({ when, last, total }) => ({
  timestamp: when,
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: { last_token_usage: codexTokens(last), total_token_usage: codexTokens(total), model_context_window: 190000 },
  },
});

/** What Codex was set to for the turns that follow it. */
const codexTurn = ({ when, model = CODEX_MODEL, effort = 'high' }) => ({
  timestamp: when,
  type: 'turn_context',
  payload: { model, effort, approval_policy: 'on-request' },
});

/** A turn of the user's, as Codex writes one: a `user` message item. */
const codexSaid = (when, text) => ({
  timestamp: when,
  type: 'response_item',
  payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
});

/** One Claude Code API call, as an `assistant` line of its transcript. */
const claudeCall = ({ when, request, message, input = 0, output = 0 }) => ({
  type: 'assistant',
  timestamp: when,
  requestId: request,
  effort: 'high',
  message: {
    id: message,
    model: CLAUDE_MODEL,
    usage: { input_tokens: input, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: output },
  },
});

/** A turn of the user's, as Claude Code writes one. */
const claudeSaid = (when, text) => ({ type: 'user', timestamp: when, message: { role: 'user', content: text } });

/**
 * The records of a conversation, then more than fits in one string: two calls
 * with a user turn between them, 1,200/340 and 2,500/460, so 3,700 in and 800
 * out in two calls. Neither figure is what either call alone used.
 */
const BIG_LINES = {
  codex: [
    codexTurn({ when: at(9) }),
    codexCall({ when: at(9, 1), last: { input: 1200, output: 340 }, total: { input: 1200, output: 340 } }),
    codexSaid(at(9, 2), 'Keep the API up.'),
    codexCall({ when: at(9, 3), last: { input: 2500, output: 460 }, total: { input: 3700, output: 800 } }),
  ],
  claude: [
    claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 1200, output: 340 }),
    claudeSaid(at(9, 2), 'Keep the API up.'),
    claudeCall({ when: at(9, 3), request: 'req-2', message: 'msg-2', input: 2500, output: 460 }),
  ],
};

/**
 * Plant a conversation where its harness keeps it, inside the sandbox's home:
 * Codex under the day it started as `rollout-<stamp>-<id>.jsonl`, its first line
 * the `session_meta` with the id, the folder, the time and whatever `meta` adds;
 * Claude Code under the folder's slug as `<id>.jsonl`, its first line a system
 * line with the time. `grown` makes it too big to read whole, after its lines.
 * `archived` files a Codex rollout where Codex moves one it has archived:
 * `archived_sessions`, flat, by the same name. The file's own time is set to
 * its last line unless `touched` says otherwise.
 */
async function plant(box, harness, { id, cwd, started, meta = {}, lines = [], grown = false, touched, archived = false }) {
  const rollout = `rollout-${started.replaceAll(':', '-').replace(/\..*$/, '')}-${id}.jsonl`;
  const file = harness === 'codex'
    ? path.join(box.home, '.codex', ...(archived ? ['archived_sessions'] : ['sessions', ...started.slice(0, 10).split('-')]), rollout)
    : path.join(box.home, '.claude', 'projects', cwd.replaceAll(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  const first = harness === 'codex'
    ? { timestamp: started, type: 'session_meta', payload: { id, cwd, timestamp: started, ...meta } }
    : { type: 'system', sessionId: id, cwd, timestamp: started };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, [first, ...lines].map((line) => JSON.stringify(line)).join('\n') + '\n');
  if (grown) await grow(file);
  if (touched !== null) {
    const stamps = [started, ...lines.map((line) => line.timestamp).filter((stamp) => typeof stamp === 'string')];
    const last = touched ?? new Date(Math.max(...stamps.map((stamp) => Date.parse(stamp))));
    await utimes(file, last, last);
  }
  if (grown) assertTooBigToReadWhole(file);
  return file;
}

// ------------------------------------------------------------- what usage answers

/** Run `obk usage` and answer what it said as JSON. */
async function usage(box) {
  const result = await box.run(['usage', '--bots', 'bots', '--json']);
  assert.equal(result.code, 0, `usage reports and never fails: ${result.stderr}`);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

/** The one entry about one bot. */
function entryOf(answer, bot) {
  const found = answer.usage.filter((entry) => entry.bot === bot);
  assert.equal(found.length, 1, `one entry should be about ${bot}, got: ${JSON.stringify(answer.usage)}`);
  return found[0];
}

/** The one entry about one of a bot's sessions. */
function sessionOf(entry, name) {
  const found = (entry.sessions ?? []).filter((session) => session.name === name);
  assert.equal(found.length, 1, `${entry.bot} should say one thing about ${name}, got: ${JSON.stringify(entry.sessions)}`);
  return found[0];
}

/** The ids a list of conversations holds, in no particular order. */
const idsOf = (list) => (list ?? []).map((one) => one.id).sort();

/** The one entry about one conversation in a list. */
function conversationOf(list, id) {
  const found = (list ?? []).filter((one) => one.id === id);
  assert.equal(found.length, 1, `one entry should be about ${id}, got: ${JSON.stringify(list)}`);
  return found[0];
}

/** Nothing left out, in the answer's words. */
const NOTHING_LEFT_OUT = {
  unreadable_transcripts: 0,
  broken_lines: 0,
  records_without_numbers: 0,
  records_without_time: 0,
};

/** What a session, or a bot's unclaimed transcripts, say they left out: the four kinds and only those. */
function leftOutOf(owner, field = 'not_counted') {
  const said = owner[field];
  assert.ok(said !== null && typeof said === 'object', `it should say what it left out in ${field}, got: ${JSON.stringify(owner)}`);
  return Object.fromEntries(Object.keys(NOTHING_LEFT_OUT).map((kind) => [kind, said[kind]]));
}

/** The part of a file that could not be read is said: as an unreadable transcript, or as broken lines. */
function assertSaysWhatItCouldNotRead(gaps, where) {
  assert.ok(
    gaps.unreadable_transcripts + gaps.broken_lines >= 1,
    `${where} should say something was left out, as unreadable_transcripts or broken_lines, got: ${JSON.stringify(gaps)}`,
  );
  assert.equal(gaps.records_without_numbers, 0, `every record written has its numbers: ${JSON.stringify(gaps)}`);
  assert.equal(gaps.records_without_time, 0, `and its time: ${JSON.stringify(gaps)}`);
}

// ------------------------------------------------------------- what the book holds

/** When the kit says it started a harness in the session's tab. */
async function launchedAt(bots) {
  const when = Date.parse((await sessionIn(bots, 'api-bot', 'daily'))?.launched);
  assert.ok(Number.isFinite(when), 'the book should say when the session was launched');
  return new Date(when);
}

/** A few seconds from `when`, as an ISO time. */
const seconds = (when, n) => new Date(when.getTime() + n * 1000).toISOString();

/** The ids the session's `unclaimed` note holds, in no particular order. */
async function unclaimedIn(bots) {
  const listed = (await sessionIn(bots, 'api-bot', 'daily'))?.unclaimed ?? [];
  assert.ok(Array.isArray(listed), `unclaimed should be a list of ids, got: ${JSON.stringify(listed)}`);
  return [...listed].sort();
}

/** The session's own harness reports `session`, so the kit writes down the rest of the folder's. */
async function reportFromTheTab(box, bots, session) {
  const ran = await recordSession(box, { bots, bot: 'api-bot', tab: (await sessionIn(bots, 'api-bot', 'daily')).tab, session });
  assert.equal(ran.code, 0, ran.stderr);
  assert.equal((await sessionIn(bots, 'api-bot', 'daily'))?.session, session);
}

// ---------------------------------------------------------- 0. the stand-in itself

test('0. the stand-in: a grown record keeps its lines and cannot be read whole', async (t) => {
  // What every other test here rests on. The first bytes are the lines written,
  // and the file is past the longest string Node can make.
  const box = await createSandbox(t);
  const home = box.path('bots', 'api-bot');
  const file = await plant(box, 'codex', { id: BIG, cwd: home, started: at(9), lines: BIG_LINES.codex, grown: true });

  assertTooBigToReadWhole(file);
  const handle = await open(file, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(4096), 0, 4096, 0);
    const first = buffer.subarray(0, bytesRead).toString('utf8').split('\n', 1)[0];
    assert.equal(JSON.parse(first).payload.id, BIG, 'the session_meta is still the first line');
  } finally {
    await handle.close();
  }
});

// ------------------------------------------------ 1. a Codex rollout too big to read whole

test('1. a Codex rollout too big to read whole is still a conversation of the bot home in the book', async (t) => {
  // The book's lookup: conversations of the folder since the launch that no
  // session claims. Before, the rollout's first line could not be had, so it was
  // not a conversation of anywhere.
  const box = await createSandbox(t);
  const { bots, home } = await started(box, 'codex');
  const launched = await launchedAt(bots);
  await plant(box, 'codex', {
    id: BIG, cwd: home, started: seconds(launched, 1), lines: [], grown: true, touched: new Date(seconds(launched, 30)),
  });
  await plant(box, 'codex', { id: SMALL, cwd: home, started: seconds(launched, 60), touched: new Date(seconds(launched, 60)) });

  await reportFromTheTab(box, bots, SMALL);

  assert.deepEqual(await unclaimedIn(bots), [BIG], 'the big rollout is a conversation of this folder that nobody claims');
});

test('1. obk usage counts the calls a Codex rollout too big to read whole holds, and says what it could not read', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, 'codex');
  await plant(box, 'codex', { id: BIG, cwd: home, started: at(9), lines: BIG_LINES.codex, grown: true });
  await bookSays(bots, 'api-bot', { daily: ran(BIG) });

  const entry = entryOf(await usage(box), 'api-bot');
  const daily = sessionOf(entry, 'daily');

  assert.deepEqual(idsOf(daily.conversations), [BIG], `the session's conversation is found, got: ${JSON.stringify(daily)}`);
  const conversation = conversationOf(daily.conversations, BIG);
  assert.equal(conversation.calls, 2, 'both calls it holds');
  assert.equal(conversation.tokens?.input, 3700, 'the 1,200 and 2,500 of its two calls');
  assert.equal(conversation.tokens?.output, 800, 'the 340 and 460 of its two calls');
  assertSaysWhatItCouldNotRead(leftOutOf(daily), 'the session');
  assert.deepEqual(leftOutOf(entry, 'unclaimed_not_counted'), NOTHING_LEFT_OUT, 'and none of it is laid at the bot\'s door');
});

// -------------------------------------------- 3. a Claude Code transcript too big to read whole

test('3. a Claude Code transcript too big to read whole is placed by its first line\'s time, not the file\'s', async (t) => {
  // Every file here was made after the launch. Two say on their first line that
  // their conversation began before it, and are not this run's; one says it began
  // after. Before, the big one's first line could not be had, so the file's own
  // age stood in and put an earlier conversation into this run.
  const box = await createSandbox(t);
  const { bots, home } = await started(box, 'claude');
  const launched = await launchedAt(bots);
  const before = seconds(launched, -60);
  await plant(box, 'claude', { id: 'early-small', cwd: home, started: before, touched: null });
  await plant(box, 'claude', { id: 'early-big', cwd: home, started: before, lines: [], grown: true, touched: null });
  await plant(box, 'claude', { id: 'late-big', cwd: home, started: seconds(launched, 1), lines: [], grown: true, touched: null });
  await plant(box, 'claude', { id: 'the-new-one', cwd: home, started: seconds(launched, 60), touched: null });

  await reportFromTheTab(box, bots, 'the-new-one');

  assert.deepEqual(
    await unclaimedIn(bots),
    ['late-big'],
    'the one that says it began after the launch, big or not; the two that say before are an earlier run\'s',
  );
});

test('3. obk usage counts the calls a Claude Code transcript too big to read whole holds, and says what it could not read', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, 'claude');
  await plant(box, 'claude', { id: BIG, cwd: home, started: at(9), lines: BIG_LINES.claude, grown: true });
  await bookSays(bots, 'api-bot', { daily: ran(BIG) });

  const entry = entryOf(await usage(box), 'api-bot');
  const daily = sessionOf(entry, 'daily');

  assert.deepEqual(idsOf(daily.conversations), [BIG], `the session's conversation is counted, got: ${JSON.stringify(daily)}`);
  const conversation = conversationOf(daily.conversations, BIG);
  assert.equal(conversation.calls, 2, 'both calls it holds');
  assert.equal(conversation.tokens?.input, 3700, 'the 1,200 and 2,500 of its two calls');
  assert.equal(conversation.tokens?.output, 800, 'the 340 and 460 of its two calls');
  assertSaysWhatItCouldNotRead(leftOutOf(daily), 'the session');
  assert.deepEqual(leftOutOf(entry, 'unclaimed_not_counted'), NOTHING_LEFT_OUT, 'and none of it is laid at the bot\'s door');
});

// ------------------------------------------ 4. a fork whose origin is too big to read whole

test('4. a fork whose origin is too big to read whole is counted right or reported, never silently missing', async (t) => {
  // The origin ran in another folder, so the only thing of this bot's at stake
  // is the child. Counted, it is its own 80,000 in and 8,000 out in two calls
  // (usage-forks.test.js has why each other figure is a wrong reading); not
  // counted, it is said to be left out. This passes before the change as well:
  // the origin's read threw, and the child was reported as unreadable.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, 'codex');
  const elsewhere = box.path('elsewhere');
  await mkdir(elsewhere, { recursive: true });
  const parentCalls = [
    { when: at(9, 0), last: { input: 1000, output: 100 }, total: { input: 1000, output: 100 } },
    { when: at(9, 10), last: { input: 2000, output: 200 }, total: { input: 3000, output: 300 } },
    { when: at(9, 20), last: { input: 4000, output: 400 }, total: { input: 7000, output: 700 } },
    { when: at(9, 30), last: { input: 8000, output: 800 }, total: { input: 15000, output: 1500 } },
  ];
  await plant(box, 'codex', {
    id: PARENT,
    cwd: elsewhere,
    started: at(8, 55),
    meta: { source: 'cli' },
    lines: [codexTurn({ when: at(8, 55) }), ...parentCalls.map(codexCall)],
    grown: true,
  });
  await plant(box, 'codex', {
    id: CHILD,
    cwd: home,
    started: at(10),
    meta: { forked_from_id: PARENT, parent_thread_id: PARENT, source: { subagent: { thread_spawn: { parent_thread_id: PARENT, depth: 1 } } } },
    lines: [
      codexTurn({ when: at(10) }),
      ...parentCalls.slice(1).map((record) => codexCall({ ...record, when: at(10) })),
      codexCall({ when: at(10, 10), last: { input: 30000, output: 3000 }, total: { input: 45000, output: 4500 } }),
      codexCall({ when: at(10, 20), last: { input: 50000, output: 5000 }, total: { input: 95000, output: 9500 } }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('019f9600-0000-7000-8000-00000000cccc') });

  const entry = entryOf(await usage(box), 'api-bot');
  const counted = (entry.unclaimed ?? []).filter((one) => one.id === CHILD);
  const gaps = leftOutOf(entry, 'unclaimed_not_counted');

  if (counted.length === 1) {
    assert.equal(counted[0].tokens?.input, 80000, 'the child\'s own 30,000 + 50,000 and none of its origin\'s');
    assert.equal(counted[0].tokens?.output, 8000, 'the child\'s own 3,000 + 5,000');
    assert.equal(counted[0].calls, 2, 'the child\'s own two calls');
  } else {
    assert.deepEqual(counted, [], 'one row or none');
    assert.ok(
      gaps.unreadable_transcripts + gaps.broken_lines >= 1,
      `a child that is not counted is said to be left out, got: ${JSON.stringify(gaps)}`,
    );
  }
});

// ----------------------------------------------- 5. a record that cannot be opened

test('5. a Codex rollout the book names that cannot be opened is reported as unreadable under its session', { skip: UNREADABLE_NEEDS_A_USER }, async (t) => {
  // Its file name says whose conversation it is, even when nothing in it can be
  // read. The Claude Code case is usage.test.js's U14.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, 'codex');
  const locked = await plant(box, 'codex', { id: BIG, cwd: home, started: at(9), lines: BIG_LINES.codex });
  await chmod(locked, 0o000);
  await bookSays(bots, 'api-bot', { daily: ran(BIG) });

  const entry = entryOf(await usage(box), 'api-bot');
  const daily = sessionOf(entry, 'daily');

  assert.deepEqual(idsOf(daily.conversations), [], 'nothing of it can be counted');
  assert.deepEqual(
    leftOutOf(daily),
    { ...NOTHING_LEFT_OUT, unreadable_transcripts: 1 },
    'and the session says so, rather than looking like a session that spent nothing',
  );
});

// ------------------------------------ 7. the book names a conversation filed elsewhere

/** Another folder than the bot home, where a conversation carried into the bot began. */
async function elsewhereIn(box) {
  const elsewhere = box.path('elsewhere');
  await mkdir(elsewhere, { recursive: true });
  return elsewhere;
}

for (const harness of ['codex', 'claude']) {
  test(`7. on ${harness}, a conversation the book names that was filed under another folder is counted under its session`, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await fleet(box, harness);
    await plant(box, harness, { id: BIG, cwd: await elsewhereIn(box), started: at(9), lines: BIG_LINES[harness] });
    await bookSays(bots, 'api-bot', { daily: ran(BIG) });

    const entry = entryOf(await usage(box), 'api-bot');
    const daily = sessionOf(entry, 'daily');

    assert.deepEqual(idsOf(daily.conversations), [BIG], `the book says it is daily's, got: ${JSON.stringify(daily)}`);
    const conversation = conversationOf(daily.conversations, BIG);
    assert.equal(conversation.calls, 2, 'both calls it holds');
    assert.equal(conversation.tokens?.input, 3700, 'the 1,200 and 2,500 of its two calls');
    assert.equal(conversation.tokens?.output, 800, 'the 340 and 460 of its two calls');
    assert.deepEqual(leftOutOf(daily), NOTHING_LEFT_OUT, 'all of it was read');
    assert.deepEqual(idsOf(entry.unclaimed), [], 'and a session claims it, so it is not unclaimed');
    assert.deepEqual(leftOutOf(entry, 'unclaimed_not_counted'), NOTHING_LEFT_OUT);
  });

  test(`7. on ${harness}, a conversation the book names, filed under another folder and too big to read whole, counts what can be read`, async (t) => {
    const box = await createSandbox(t);
    const { bots } = await fleet(box, harness);
    await plant(box, harness, { id: BIG, cwd: await elsewhereIn(box), started: at(9), lines: BIG_LINES[harness], grown: true });
    await bookSays(bots, 'api-bot', { daily: ran(BIG) });

    const entry = entryOf(await usage(box), 'api-bot');
    const daily = sessionOf(entry, 'daily');

    assert.deepEqual(idsOf(daily.conversations), [BIG], `the book says it is daily's, got: ${JSON.stringify(daily)}`);
    const conversation = conversationOf(daily.conversations, BIG);
    assert.equal(conversation.calls, 2, 'both calls it holds');
    assert.equal(conversation.tokens?.input, 3700, 'the 1,200 and 2,500 of its two calls');
    assert.equal(conversation.tokens?.output, 800, 'the 340 and 460 of its two calls');
    assertSaysWhatItCouldNotRead(leftOutOf(daily), 'the session');
    assert.deepEqual(idsOf(entry.unclaimed), [], 'a session claims it, so it is not unclaimed');
    assert.deepEqual(leftOutOf(entry, 'unclaimed_not_counted'), NOTHING_LEFT_OUT, 'and none of it is laid at the bot\'s door');
  });

  test(`7. on ${harness}, a conversation filed under another folder that the book does not name is not the bot's`, async (t) => {
    // Beside it, one in the bot home that the book names, counted as ever, so
    // that an answer with nothing in it cannot pass.
    const box = await createSandbox(t);
    const { bots, home } = await fleet(box, harness);
    await plant(box, harness, { id: BIG, cwd: await elsewhereIn(box), started: at(9), lines: BIG_LINES[harness] });
    await plant(box, harness, { id: SMALL, cwd: home, started: at(9), lines: BIG_LINES[harness] });
    await bookSays(bots, 'api-bot', { daily: ran(SMALL) });

    const entry = entryOf(await usage(box), 'api-bot');
    const daily = sessionOf(entry, 'daily');

    assert.deepEqual(idsOf(daily.conversations), [SMALL], `only the one the book names, got: ${JSON.stringify(daily)}`);
    assert.equal(conversationOf(daily.conversations, SMALL).tokens?.input, 3700, 'counted as ever');
    assert.deepEqual(idsOf(entry.unclaimed), [], 'the other folder\'s conversation is not this bot\'s to list');
    assert.deepEqual(leftOutOf(daily), NOTHING_LEFT_OUT);
    assert.deepEqual(leftOutOf(entry, 'unclaimed_not_counted'), NOTHING_LEFT_OUT, 'nor to report');
  });
}

test('7. on codex, a conversation the book names whose rollout Codex has archived is counted under its session', async (t) => {
  // Codex moves an archived conversation's rollout into archived_sessions; the
  // book still names it, and the architect's ruling on #396 has the kit look
  // there by its id too.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, 'codex');
  await plant(box, 'codex', { id: BIG, cwd: home, started: at(9), lines: BIG_LINES.codex, archived: true });
  await bookSays(bots, 'api-bot', { daily: ran(BIG) });

  const entry = entryOf(await usage(box), 'api-bot');
  const daily = sessionOf(entry, 'daily');

  assert.deepEqual(idsOf(daily.conversations), [BIG], `the book says it is daily's, got: ${JSON.stringify(daily)}`);
  const conversation = conversationOf(daily.conversations, BIG);
  assert.equal(conversation.calls, 2, 'both calls it holds');
  assert.equal(conversation.tokens?.input, 3700, 'the 1,200 and 2,500 of its two calls');
  assert.equal(conversation.tokens?.output, 800, 'the 340 and 460 of its two calls');
  assert.deepEqual(leftOutOf(daily), NOTHING_LEFT_OUT, 'all of it was read');
  assert.deepEqual(idsOf(entry.unclaimed), [], 'a session claims it, so it is not unclaimed');
});

// --------------------------------------- 2, 3 and 6. the start prompt in a big record

const BOT = 'heard-bot';
const PROMPT = 'Read your AGENTS.md and reply in one line with what this bot owns.';

/** A prompt in CJK with an emoji in it: the emoji is what straddles the boundary in test 6. */
const EMOJI = '\u{1F40B}';
const WIDE_PROMPT = `读你的 AGENTS.md，${EMOJI}用一行说出这个机器人负责什么。`;

/** Where a reader that goes in 64 KiB pieces cuts the file. */
const BOUNDARY = 64 * 1024;

/** Conversation ids shaped the way both harnesses shape them. */
const conv = (n) => `0199b2c0-${String(n).padStart(4, '0')}-4444-8888-cccccccccccc`;

/** A bots folder with one bot on `harness` and one session with its prompt, not yet brought up. */
async function withSession(box, harness, prompt) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness])).code, 0);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily', '--prompt', prompt]);
  assert.equal(added.code, 0, added.stderr);
  const bots = box.path('bots');
  return { bots, home: botHomeOf(bots, BOT) };
}

/** Lines of a record as the harness writes it while it runs; `__NOW__` is filled in then. */
const lines = {
  claude: {
    head: (id, home) => [{ type: 'system', sessionId: id, cwd: home, timestamp: '__NOW__' }],
    user: (id, home, content) => ({
      parentUuid: null, isSidechain: false, userType: 'external', cwd: home, sessionId: id, type: 'user',
      message: { role: 'user', content }, timestamp: '__NOW__',
    }),
    reply: (id, home, text) => ({
      parentUuid: null, isSidechain: false, cwd: home, sessionId: id, type: 'assistant',
      message: { role: 'assistant', model: CLAUDE_MODEL, content: [{ type: 'text', text }] }, timestamp: '__NOW__',
    }),
  },
  codex: {
    head: (id, home) => [
      { timestamp: '__NOW__', type: 'session_meta', payload: { id, cwd: home, timestamp: '__NOW__' } },
      {
        timestamp: '__NOW__',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: `# AGENTS.md instructions for ${home}\n\n<INSTRUCTIONS>\nKeep the API up.\n</INSTRUCTIONS>` }],
        },
      },
    ],
    user: (id, home, text) => ({
      timestamp: '__NOW__', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
    }),
    reply: (id, home, text) => ({
      timestamp: '__NOW__', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
    }),
  },
};

/** A whole conversation in which the user's turn is `text`. */
const saying = (harness, id, home, text) => [
  ...lines[harness].head(id, home),
  lines[harness].user(id, home, text),
  lines[harness].reply(id, home, 'This bot owns the API.'),
];

/** The bytes a line takes in the file, with `__NOW__` filled in: an ISO time is always 24 characters. */
const bytesOf = (line) => Buffer.byteLength(JSON.stringify(line).replaceAll('__NOW__', new Date(0).toISOString()));

/**
 * A conversation whose user turn is `text`, with a reply of padding before it
 * sized so that the file's byte BOUNDARY falls in the middle of `EMOJI`: its
 * four bytes are at BOUNDARY - 2 to BOUNDARY + 1.
 */
function straddling(harness, id, home, text) {
  const head = lines[harness].head(id, home);
  const user = lines[harness].user(id, home, text);
  const written = JSON.stringify(user).replaceAll('__NOW__', new Date(0).toISOString());
  const intoUser = Buffer.byteLength(written.slice(0, written.indexOf(EMOJI)));
  const before = head.reduce((sum, line) => sum + bytesOf(line) + 1, 0) + bytesOf(lines[harness].reply(id, home, '')) + 1;
  const padding = BOUNDARY - 2 - before - intoUser;
  assert.ok(padding > 0, `the padding has room: ${padding}`);
  return [...head, lines[harness].reply(id, home, 'x'.repeat(padding)), user, lines[harness].reply(id, home, 'This bot owns the API.')];
}

/**
 * The harness's side of a launch: write its records where it keeps them, grow
 * any it is told to, then run the kit's hook under the process chain. Node
 * rather than shell, so the chain it starts is the one the kit believes.
 */
const HARNESS_START = `
const { mkdirSync, truncateSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const now = new Date().toISOString();
for (const record of JSON.parse(process.env.OBK_TEST_RECORDS)) {
  const file = record.harness === 'codex'
    ? path.join(record.root, '.codex', 'sessions', ...now.slice(0, 10).split('-'),
      'rollout-' + now.replaceAll(':', '-').replace(/[.].*$/, '') + '-' + record.id + '.jsonl')
    : path.join(record.root, '.claude', 'projects', record.cwd.replace(/[^A-Za-z0-9]/g, '-'), record.id + '.jsonl');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, record.lines.map((line) => JSON.stringify(line).replaceAll('__NOW__', now)).join('\\n') + '\\n');
  if (record.grow !== undefined) truncateSync(file, record.grow);
}
const [program, ...rest] = JSON.parse(process.env.OBK_TEST_THEN);
const ran = spawnSync(program, rest, { stdio: 'inherit' });
process.exit(ran.status ?? 1);
`;

/**
 * Arrange for the harness to come up during the next run's first look at the
 * tab it launched: it writes `records` ({ id, lines, grow }) under the sandbox
 * home and tells the kit's hook that `reports` is the conversation it is running.
 */
async function harnessDuring(box, { bots, home, harness, records, reports }) {
  const dir = path.join(box.root, 'harness');
  await mkdir(dir, { recursive: true });
  const start = path.join(dir, 'harness-start.cjs');
  await writeFile(start, `${HARNESS_START.trim()}\n`);

  const hook = [box.cli, 'session', 'record', '--bots', bots, '--bot', BOT].map(shellWord).join(' ');
  const chain = await harnessChain(box, hook, { stdin: sessionStart({ session: reports, cwd: home }) });
  const env = {
    OBK_TEST_RECORDS: JSON.stringify(records.map((one) => ({ harness, root: box.home, cwd: home, ...one }))),
    ...chain.env,
    OBK_TEST_THEN: JSON.stringify(chain.argv),
  };
  await box.orca.set({
    runDuring: {
      command: 'terminal wait',
      argv: [process.execPath, start],
      env,
      on: orcaCallsOf(await box.orca.calls(), 'terminal wait').length + 1,
    },
  });
}

/** Run `up` for the one bot with --json, check the harness came up and reported, and give back the session's tab entry. */
async function upEntry(box, bots, id) {
  const result = await box.run(['up', '--bots', 'bots', '--bot', BOT, '--json']);
  assert.equal(result.code, 0, result.stderr);
  const ran = await box.orca.ranDuring();
  assert.equal(ran.length, 1, `the harness should have come up in the middle of the run, got: ${JSON.stringify(ran)}`);
  assert.equal(ran[0].status, 0, `and nothing it ran should have failed: ${ran[0].stderr}`);
  assert.equal((await sessionIn(bots, BOT, 'daily'))?.session, id, 'the book names the conversation the harness reported');
  const found = JSON.parse(result.stdout).tabs.filter((entry) => entry.name === 'daily' && entry.created === true);
  assert.equal(found.length, 1, `the session's new tab should be reported, got: ${result.stdout}`);
  return found[0];
}

/** The file the harness wrote the conversation `id` to. */
async function recordFile(box, harness, home, id) {
  if (harness === 'claude') return path.join(box.home, '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  const dir = path.join(box.home, '.codex', 'sessions');
  const found = (await readdir(dir, { recursive: true })).filter((name) => name.endsWith(`-${id}.jsonl`));
  assert.equal(found.length, 1, `one rollout of ${id}, got: ${JSON.stringify(found)}`);
  return path.join(dir, found[0]);
}

/** `count` bytes of `file` from `position`. */
async function bytesAt(file, position, count) {
  const handle = await open(file, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(count), 0, count, position);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

for (const harness of ['codex', 'claude']) {
  const which = harness === 'codex' ? '2' : '3';

  test(`${which}. on ${harness}, the start prompt in a record too big to read whole is received`, async (t) => {
    const box = await createSandbox(t);
    const { bots, home } = await withSession(box, harness, PROMPT);
    await harnessDuring(box, {
      bots, home, harness, records: [{ id: conv(1), lines: saying(harness, conv(1), home, PROMPT), grow: TOO_BIG }], reports: conv(1),
    });

    const entry = await upEntry(box, bots, conv(1));

    assertTooBigToReadWhole(await recordFile(box, harness, home, conv(1)));
    assert.equal(entry.promptReceived, true, `the record holds the prompt as the user's turn, got: ${JSON.stringify(entry)}`);
  });

  test(`${which}. on ${harness}, a record too big to read whole whose user turn is something else is not confirmed`, async (t) => {
    // Beside the one above: a record that cannot be read whole is not, for that,
    // taken to hold the prompt.
    const box = await createSandbox(t);
    const { bots, home } = await withSession(box, harness, PROMPT);
    await harnessDuring(box, {
      bots,
      home,
      harness,
      records: [{ id: conv(1), lines: saying(harness, conv(1), home, 'What is on the queue today?'), grow: TOO_BIG }],
      reports: conv(1),
    });

    const entry = await upEntry(box, bots, conv(1));

    assertTooBigToReadWhole(await recordFile(box, harness, home, conv(1)));
    assert.equal(entry.promptReceived, false, `got: ${JSON.stringify(entry)}`);
  });

  test(`6. on ${harness}, a start prompt whose emoji straddles a 64 KiB boundary of a big record is received whole`, async (t) => {
    const box = await createSandbox(t);
    const { bots, home } = await withSession(box, harness, WIDE_PROMPT);
    await harnessDuring(box, {
      bots,
      home,
      harness,
      records: [{ id: conv(1), lines: straddling(harness, conv(1), home, WIDE_PROMPT), grow: TOO_BIG }],
      reports: conv(1),
    });

    const entry = await upEntry(box, bots, conv(1));

    const file = await recordFile(box, harness, home, conv(1));
    assertTooBigToReadWhole(file);
    assert.deepEqual(
      await bytesAt(file, BOUNDARY - 2, 4),
      Buffer.from(EMOJI),
      'the premise: the emoji\'s four bytes sit two before and two after the boundary',
    );
    assert.equal(entry.promptReceived, true, `the record holds the prompt, emoji and all, got: ${JSON.stringify(entry)}`);
  });
}
