// `obk usage` counts each Codex conversation's own calls, and a parent's calls
// once (issue #376).
//
// A Codex conversation can start from another one, and its rollout then carries
// what the other one had spent. Two shapes of that are on disk (tech notes,
// section 3):
//
//   A. Copied history. A rollout whose `session_meta` names its origin
//      (`payload.forked_from_id`) begins with the origin's own `token_count`
//      records copied in verbatim, stamped at the child's start, from part way
//      into the origin or from its very first record. The child's own calls
//      follow, their running totals carrying on from the last copy.
//
//   B. The running total carried in, nothing copied. The child's first record's
//      running total already holds the parent's; its own calls rise from there.
//      Seen with `forked_from_id` and without it: a subagent a session spawned
//      (`thread_spawn`) and Codex's own reviewer (`guardian`).
//
// What is wanted: the first usage record of any rollout counts its own figure,
// never its running total; the leading records of a rollout that names its
// origin and whose running totals are also the origin's are the origin's calls
// and are not counted under the child, in any window; a rollout whose origin
// cannot be found or read counts nothing and is reported as unreadable; and an
// ordinary rollout counts as it did.
//
// The figures are chosen so that each wrong reading gives an answer of its own.
// The parent's running total when the child starts is 15,000 in and 1,500 out,
// and the child's own two calls are 30,000/3,000 and 50,000/5,000, so:
//
//   80,000 in   the child's own calls, the right answer;
//   95,000 in   the child's whole running total: the copies counted, or its
//               first record counted by its running total (as the code did);
//   94,000 in   the copies counted by their rises, the first by its own figure;
//   50,000 in   the child's first own call dropped with the copies.
//
// Every rollout is planted in the sandbox's own home. Nothing reads the real
// `~/.codex` or `~/.claude`. The helpers below are copied from usage.test.js
// and usage-subagents.test.js, so that importing them does not run their tests
// again.

import assert from 'node:assert/strict';
import { chmod, mkdir, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { stringify } from 'yaml';

import { bookOf, botHomeOf, createSandbox } from './helpers/cli.js';

/** A moment on a day of the month these tests are set in, as Codex writes one. */
const on = (day, hour, minute = 0, second = 0) =>
  `2026-09-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000Z`;

/** A moment on the day most of these tests are set. */
const at = (hour, minute = 0, second = 0) => on(20, hour, minute, second);

const CODEX_MODEL = 'gpt-6-astra';

/** Conversation ids, shaped as Codex shapes them. */
const PARENT = '019f9600-0000-7000-8000-00000000aaaa';
const CHILD = '019f9685-bce3-7000-8000-00000000bbbb';
/** A conversation no rollout on disk is of. */
const GONE = '019f9600-0000-7000-8000-00000000dead';

// ---------------------------------------------------------------- the fleet

/** A bots folder with one bot in it, its sessions written, and nothing opened in Orca. */
async function fleet(box, { harness = 'codex', sessions = ['daily'] } = {}) {
  const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(init.code, 0, init.stderr);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  for (const name of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', name]);
    assert.equal(added.code, 0, added.stderr);
  }
  const bots = box.path('bots');
  return { bots, home: botHomeOf(bots, 'api-bot') };
}

/** The book of one bot, written as the kit writes it. */
const bookSays = (bots, bot, sessions) =>
  writeFile(bookOf(bots, bot), stringify({ orca: { project: 'proj-1', setup: 'setup-1' }, sessions }));

/** A session entry of the book: the conversation it is in. */
const ran = (session) => ({ tab: `tab-${session}`, launched: at(8), session });

// ------------------------------------------------- what Codex writes down

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

/**
 * A Codex status record: its own figure 0 in every field while its
 * `total_tokens` says 81,522, as Codex writes one, and the running total `total`.
 */
const codexStatus = ({ when, total }) => ({
  timestamp: when,
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: {
      last_token_usage: { ...codexTokens({}), total_tokens: 81522 },
      total_token_usage: codexTokens(total),
      model_context_window: 190000,
    },
  },
});

/** What Codex was set to for the turns that follow it. */
const codexTurn = ({ when, model = CODEX_MODEL, effort = 'high' }) => ({
  timestamp: when,
  type: 'turn_context',
  payload: { model, effort, approval_policy: 'on-request' },
});

/**
 * Plant a rollout where Codex keeps it, inside the sandbox's home: filed by the
 * day it started, named `rollout-<stamp>-<id>.jsonl`, its first line the
 * `session_meta` with the id, the folder it ran in, its time and whatever else
 * `meta` adds (`source`, `forked_from_id`, `parent_thread_id`).
 */
async function plantRollout(box, { id, cwd, started, meta = {}, lines }) {
  const file = path.join(
    box.home, '.codex', 'sessions', ...started.slice(0, 10).split('-'),
    `rollout-${started.replaceAll(':', '-').replace(/\..*$/, '')}-${id}.jsonl`,
  );
  const first = { timestamp: started, type: 'session_meta', payload: { id, cwd, timestamp: started, ...meta } };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, [first, ...lines].map((line) => JSON.stringify(line)).join('\n') + '\n');
  const last = new Date(Math.max(...[started, ...lines.map((line) => line.timestamp)].map((stamp) => Date.parse(stamp))));
  await utimes(file, last, last);
  return file;
}

/** A session's own conversation, as Codex marks one a person started. */
const OWN_CONVERSATION = { source: 'cli' };

/** A subagent that `parent` spawned, as Codex marks one. */
const spawnedBy = (parent) => ({
  parent_thread_id: parent,
  source: {
    subagent: {
      thread_spawn: { parent_thread_id: parent, depth: 1, agent_path: 'worker', agent_nickname: 'Mendel', agent_role: 'default' },
    },
  },
});

/** A subagent that `parent` spawned from its own history, naming it as its origin. */
const forkedFrom = (parent) => ({ forked_from_id: parent, ...spawnedBy(parent) });

/** Codex's own reviewer looking at `parent`'s next command. */
const reviewOf = (parent) => ({ parent_thread_id: parent, source: { subagent: { other: 'guardian' } } });

/**
 * The parent's own calls: four before the child starts at 10:00, and one after
 * it, by which time the parent has spent 15,500 in and 1,550 out. Its running
 * total is 15,000/1,500 when the child starts.
 */
const parentCalls = (day = 20) => [
  { when: on(day, 9, 0), last: { input: 1000, output: 100 }, total: { input: 1000, output: 100 } },
  { when: on(day, 9, 10), last: { input: 2000, output: 200 }, total: { input: 3000, output: 300 } },
  { when: on(day, 9, 20), last: { input: 4000, output: 400 }, total: { input: 7000, output: 700 } },
  { when: on(day, 9, 30), last: { input: 8000, output: 800 }, total: { input: 15000, output: 1500 } },
  { when: on(day, 10, 30), last: { input: 500, output: 50 }, total: { input: 15500, output: 1550 } },
];

/** The parent's records before the child started, from its `from`th: what a child copies in. */
const beforeTheChild = (from, day = 20) => parentCalls(day).slice(from, 4);

/**
 * The child's own two calls, 30,000/3,000 and 50,000/5,000, their running
 * totals carrying on from the parent's 15,000/1,500.
 */
const childCalls = (first = at(10, 10), second = at(10, 20)) => [
  { when: first, last: { input: 30000, output: 3000 }, total: { input: 45000, output: 4500 } },
  { when: second, last: { input: 50000, output: 5000 }, total: { input: 95000, output: 9500 } },
];

/** Plant the parent: a session's conversation in `cwd`, with its five calls. */
const plantParent = (box, cwd, day = 20) => plantRollout(box, {
  id: PARENT,
  cwd,
  started: on(day, 8, 55),
  meta: OWN_CONVERSATION,
  lines: [codexTurn({ when: on(day, 8, 55) }), ...parentCalls(day).map(codexCall)],
});

/**
 * Plant a child in `cwd`: `copies` are records copied in from its origin,
 * stamped `stamp` (the child's start unless said), then its own `calls`.
 */
const plantChild = (box, cwd, { id = CHILD, meta, started = at(10), stamp = started, copies = [], calls = childCalls() }) =>
  plantRollout(box, {
    id,
    cwd,
    started,
    meta,
    lines: [
      codexTurn({ when: stamp }),
      ...copies.map((record) => codexCall({ ...record, when: stamp })),
      ...calls.map(codexCall),
    ],
  });

// ------------------------------------------------------------- what it answers

/** Run the command and answer what it said as JSON. */
async function usage(box, ...rest) {
  const result = await box.run(['usage', '--bots', 'bots', ...rest, '--json']);
  assert.equal(result.code, 0, `usage reports and never fails: ${result.stderr}`);
  assert.equal(result.stderr, '');
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.usage), `the answer should carry a list of bots, got: ${result.stdout}`);
  return answer;
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

/** The one entry about one conversation, out of a session's list or a bot's unclaimed one. */
function conversationOf(list, id) {
  const found = (list ?? []).filter((one) => one.id === id);
  assert.equal(found.length, 1, `one entry should be about ${id}, got: ${JSON.stringify(list)}`);
  return found[0];
}

/** The ids a list of conversations holds, in no particular order. */
const idsOf = (list) => (list ?? []).map((one) => one.id).sort();

/** What one conversation used, by kind. */
function tokensOf(conversation) {
  const tokens = conversation.tokens;
  assert.ok(
    tokens !== null && typeof tokens === 'object',
    `a conversation should say what it used, got: ${JSON.stringify(conversation)}`,
  );
  return tokens;
}

/** A session's conversations, straight from the answer. */
const conversationsOf = (session) => {
  assert.ok(
    Array.isArray(session.conversations),
    `a session should carry its conversations as a list, got: ${JSON.stringify(session)}`,
  );
  return session.conversations;
};

/** The parent, as the daily session of api-bot reports it. */
const parentIn = (answer) => conversationOf(conversationsOf(sessionOf(entryOf(answer, 'api-bot'), 'daily')), PARENT);

/** The child, as api-bot reports it among the conversations no session claims. */
const childIn = (answer) => conversationOf(entryOf(answer, 'api-bot').unclaimed, CHILD);

/** Nothing left out, in the answer's words. */
const NOTHING_LEFT_OUT = {
  unreadable_transcripts: 0,
  broken_lines: 0,
  records_without_numbers: 0,
  records_without_time: 0,
};

/** What was left out, of the four kinds, with every kind not named at 0. */
const leftOut = (some) => ({ ...NOTHING_LEFT_OUT, ...some });

/** What a session, or a bot's unclaimed transcripts, say they left out: the four kinds and only those. */
function leftOutOf(owner, field = 'not_counted') {
  const said = owner[field];
  assert.ok(
    said !== null && typeof said === 'object',
    `it should say what it left out in ${field}, got: ${JSON.stringify(owner)}`,
  );
  return Object.fromEntries(Object.keys(NOTHING_LEFT_OUT).map((kind) => [kind, said[kind]]));
}

/** Root reads a file whatever its permissions, so a rollout cannot be made unreadable to it. */
const UNREADABLE_NEEDS_A_USER = process.getuid?.() === 0
  && 'runs as root, which reads a file whatever its permissions, so no rollout can be made unreadable';

/** The child's own calls and nothing else, with each wrong reading named. */
function assertOwnCallsOnly(child) {
  assert.equal(
    tokensOf(child).input,
    80000,
    'the child\'s own 30,000 + 50,000: 95,000 counts the copies or the first record\'s running total, '
    + '94,000 counts the copies by their rises, 50,000 drops the child\'s first own call',
  );
  assert.equal(tokensOf(child).output, 8000, 'the child\'s own 3,000 + 5,000; 9,500 or 9,400 counts the parent\'s again');
  assert.equal(child.calls, 2, 'the child\'s own two calls: more counts copies as calls, 1 drops its first own call');
}

// --------------------------------------- A. the origin's history copied in

test('F1 a child that copied its origin\'s history from part way in counts only its own calls', async (t) => {
  // The copies are the parent's 2nd to 4th records, stamped at the child's
  // start: the first of them has a running total of 3,000 against its own
  // 2,000. Then the child's own two calls.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantParent(box, home);
  await plantChild(box, home, { meta: forkedFrom(PARENT), copies: beforeTheChild(1) });
  await bookSays(bots, 'api-bot', { daily: ran(PARENT) });

  const answer = await usage(box);

  const child = childIn(answer);
  assertOwnCallsOnly(child);
  assert.equal(Date.parse(child.first), Date.parse(at(10, 10)), 'its first call is its own at 10:10, not a copy at 10:00');
  assert.equal(Date.parse(child.last), Date.parse(at(10, 20)));
  assert.deepEqual(leftOutOf(entryOf(answer, 'api-bot'), 'unclaimed_not_counted'), NOTHING_LEFT_OUT);
});

test('F2 a child that copied its origin\'s history from the very first record counts only its own calls', async (t) => {
  // The first copy's running total equals its own figure, 1,000, so counting
  // the first record by its own figure alone still counts every copy.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantParent(box, home);
  await plantChild(box, home, { meta: forkedFrom(PARENT), copies: beforeTheChild(0) });
  await bookSays(bots, 'api-bot', { daily: ran(PARENT) });

  const answer = await usage(box);

  assertOwnCallsOnly(childIn(answer));
  assert.deepEqual(leftOutOf(entryOf(answer, 'api-bot'), 'unclaimed_not_counted'), NOTHING_LEFT_OUT);
});

test('F3 done-check: the parent\'s session and its child add up to what was spent, the parent\'s calls once and the child\'s own', async (t) => {
  // The parent spent 15,500/1,550 in five calls, and the child 80,000/8,000 of
  // its own after copying in the parent's first four records.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantParent(box, home);
  await plantChild(box, home, { meta: forkedFrom(PARENT), copies: beforeTheChild(1) });
  await bookSays(bots, 'api-bot', { daily: ran(PARENT) });

  const answer = await usage(box);
  const entry = entryOf(answer, 'api-bot');

  const parent = parentIn(answer);
  assert.equal(parent.calls, 5);
  assert.equal(tokensOf(parent).input, 15500);
  assert.equal(tokensOf(parent).output, 1550);
  assert.deepEqual(idsOf(entry.unclaimed), [CHILD], 'the child is the bot\'s, unclaimed');
  const child = childIn(answer);
  assert.equal(
    tokensOf(parent).input + tokensOf(child).input,
    95500,
    'the parent\'s 15,500 once and the child\'s own 80,000: 110,500 counts the parent\'s 15,000 again under the child, '
    + '109,500 counts the copies by their rises',
  );
  assert.equal(tokensOf(parent).output + tokensOf(child).output, 9550, 'and not 11,050 or 10,950');
  assert.equal(parent.calls + child.calls, 7, 'five of the parent\'s and two of the child\'s; 10 counts the copies as calls');
});

test('F4 the origin is found by its id in another folder and under another day, and its records there are still not counted under the child', async (t) => {
  // The parent ran in a folder that is not the bot's, the day before; the
  // child ran in the bot's home.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  const elsewhere = box.path('elsewhere');
  await mkdir(elsewhere, { recursive: true });
  await plantParent(box, elsewhere, 19);
  await plantChild(box, home, { meta: forkedFrom(PARENT), copies: beforeTheChild(1, 19) });
  await bookSays(bots, 'api-bot', { daily: ran('019f9600-0000-7000-8000-00000000cccc') });

  const answer = await usage(box);
  const entry = entryOf(answer, 'api-bot');

  assert.deepEqual(idsOf(entry.unclaimed), [CHILD], 'the parent ran elsewhere and is not the bot\'s');
  assertOwnCallsOnly(childIn(answer));
  assert.deepEqual(
    leftOutOf(entry, 'unclaimed_not_counted'),
    NOTHING_LEFT_OUT,
    'the origin was found, so the child is not reported as unreadable',
  );
});

test('F5 a window that holds the copies\' time counts none of them, and each own call counts in the window it was made in', async (t) => {
  // Copies at 10:00, the child's own calls at 10:10 and 10:20, the parent's
  // first four calls between 09:00 and 09:30.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantParent(box, home);
  await plantChild(box, home, { meta: forkedFrom(PARENT), copies: beforeTheChild(1) });
  await bookSays(bots, 'api-bot', { daily: ran(PARENT) });

  const copiesOnly = await usage(box, '--since', at(9), '--until', at(10, 5));
  assert.equal(tokensOf(parentIn(copiesOnly)).input, 15000, 'the parent\'s four calls in the morning, counted under the parent');
  assert.deepEqual(
    idsOf(entryOf(copiesOnly, 'api-bot').unclaimed),
    [],
    'the child made no call of its own by 10:05, so it has no row; a row here counts the copies at 10:00',
  );
  assert.deepEqual(leftOutOf(entryOf(copiesOnly, 'api-bot'), 'unclaimed_not_counted'), NOTHING_LEFT_OUT);

  const firstOwn = childIn(await usage(box, '--since', at(10, 5), '--until', at(10, 15)));
  assert.equal(firstOwn.calls, 1);
  assert.equal(tokensOf(firstOwn).input, 30000, 'its rise over the last copy; 45,000 is its running total, and no row drops it');
  assert.equal(tokensOf(firstOwn).output, 3000);

  const secondOwn = childIn(await usage(box, '--since', at(10, 15)));
  assert.equal(secondOwn.calls, 1);
  assert.equal(tokensOf(secondOwn).input, 50000);
  assert.equal(tokensOf(secondOwn).output, 5000);

  const all = childIn(await usage(box, '--since', at(10), '--until', at(10, 30)));
  assertOwnCallsOnly(all);
  assert.equal(Date.parse(all.first), Date.parse(at(10, 10)), 'the window opens on the copies, but its first call is its own');
});

test('F6 a rebuilt child with one timestamp on every line still counts its own calls and not the copies', async (t) => {
  // Codex has rewritten the file: the session_meta, the copies and the own
  // calls all carry 11:00. What decides is the records, not their time.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantParent(box, home);
  await plantChild(box, home, {
    meta: forkedFrom(PARENT),
    started: at(11),
    copies: beforeTheChild(1),
    calls: childCalls(at(11), at(11)),
  });
  await bookSays(bots, 'api-bot', { daily: ran(PARENT) });

  const child = childIn(await usage(box));
  assertOwnCallsOnly(child);
  assert.equal(Date.parse(child.first), Date.parse(at(11)));

  const inTheSecond = childIn(await usage(box, '--since', at(11), '--until', at(11, 0, 1)));
  assertOwnCallsOnly(inTheSecond);
});

test('F7 a child\'s own calls after the copies keep the repeat and new-window rules', async (t) => {
  // After the copies: 30,000/3,000; the same record again, its running total
  // unmoved; a fall to 6,000/600, a new window counted by its own figure; and
  // a rise of 7,000/700 from there. 43,000/4,300 in three calls.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantParent(box, home);
  const first = { when: at(10, 10), last: { input: 30000, output: 3000 }, total: { input: 45000, output: 4500 } };
  await plantChild(box, home, {
    meta: forkedFrom(PARENT),
    copies: beforeTheChild(1),
    calls: [
      first,
      { ...first, when: at(10, 11) },
      { when: at(10, 20), last: { input: 6000, output: 600 }, total: { input: 6000, output: 600 } },
      { when: at(10, 30), last: { input: 7000, output: 700 }, total: { input: 13000, output: 1300 } },
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran(PARENT) });

  const child = childIn(await usage(box));
  assert.equal(child.calls, 3, 'the repeat is not a call: 4 counts it, 6 counts the copies as calls');
  assert.equal(
    tokensOf(child).input,
    43000,
    '30,000 + 6,000 + 7,000: 73,000 counts the repeat, 58,000 counts the copies with the first by its running total, '
    + '57,000 counts the copies by their rises',
  );
  assert.equal(tokensOf(child).output, 4300);
});

// ------------------------------------- B. the running total carried in

test('F8 a child that names its origin and copied nothing counts its first record by its own figure', async (t) => {
  // The origin is on disk and none of its running totals is the child's first.
  // That first record carries the parent's 15,000/1,500 in its running total.
  // Cached and reasoning tokens too: 20,000 and 40,000 of the child's input
  // were cache reads, 1,000 and 2,000 of its output reasoning.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantParent(box, home);
  await plantChild(box, home, {
    meta: forkedFrom(PARENT),
    calls: [
      {
        when: at(10, 10),
        last: { input: 30000, cached: 20000, output: 3000, reasoning: 1000 },
        total: { input: 45000, cached: 20000, output: 4500, reasoning: 1000 },
      },
      {
        when: at(10, 20),
        last: { input: 50000, cached: 40000, output: 5000, reasoning: 2000 },
        total: { input: 95000, cached: 60000, output: 9500, reasoning: 3000 },
      },
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran(PARENT) });

  const answer = await usage(box);

  const child = childIn(answer);
  assert.equal(child.calls, 2);
  assert.equal(
    tokensOf(child).input,
    20000,
    '10,000 + 10,000 uncached: 35,000 counts the parent\'s 15,000 in the first record\'s running total',
  );
  assert.equal(tokensOf(child).cache_read, 60000);
  assert.equal(tokensOf(child).output, 8000, 'and not 9,500 with the parent\'s 1,500');
  assert.equal(tokensOf(child).reasoning, 3000);
  assert.equal(tokensOf(parentIn(answer)).input, 15500, 'the parent\'s own, counted once, under its session');
});

test('F9 a spawned subagent with no origin named counts its first record by its own figure', async (t) => {
  // `thread_spawn` and `parent_thread_id`, no `forked_from_id`. The parent is
  // the daily session's conversation.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantParent(box, home);
  await plantChild(box, home, { meta: spawnedBy(PARENT) });
  await bookSays(bots, 'api-bot', { daily: ran(PARENT) });

  const answer = await usage(box);

  assertOwnCallsOnly(childIn(answer));
  assert.equal(
    tokensOf(parentIn(answer)).input + tokensOf(childIn(answer)).input,
    95500,
    'the parent\'s 15,500 once and the child\'s own 80,000; 110,500 counts the parent\'s 15,000 twice',
  );
});

test('F10 a guardian review with no origin named counts its first record by its own figure, whether or not its parent is on disk', async (t) => {
  // Only `forked_from_id` names an origin, so a `parent_thread_id` with no
  // rollout behind it does not make the review unreadable.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantChild(box, home, { meta: reviewOf(GONE) });
  await bookSays(bots, 'api-bot', { daily: ran('019f9600-0000-7000-8000-00000000cccc') });

  const answer = await usage(box);

  assertOwnCallsOnly(childIn(answer));
  assert.deepEqual(leftOutOf(entryOf(answer, 'api-bot'), 'unclaimed_not_counted'), NOTHING_LEFT_OUT);
});

test('F11 any rollout\'s first record counts its own figure, even one that names no parent at all', async (t) => {
  // What the first running total holds beyond its own figure was spent before
  // this rollout began.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantChild(box, home, { meta: OWN_CONVERSATION });
  await bookSays(bots, 'api-bot', { daily: ran(CHILD) });

  const answer = await usage(box);

  assertOwnCallsOnly(conversationOf(conversationsOf(sessionOf(entryOf(answer, 'api-bot'), 'daily')), CHILD));
});

test('F12 a rebuilt child with no origin named and one timestamp on every line counts all its own calls', async (t) => {
  // Every line at 11:00, the child's start: stamped at the start is not what
  // makes a record a copy.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantParent(box, home);
  await plantChild(box, home, { meta: spawnedBy(PARENT), started: at(11), calls: childCalls(at(11), at(11)) });
  await bookSays(bots, 'api-bot', { daily: ran(PARENT) });

  assertOwnCallsOnly(childIn(await usage(box)));
});

/**
 * A child that begins with a status record: its own figure all zeros, its
 * running total the parent's 15,000/1,500 carried in, at the child's start.
 * Then its own two calls, rising from there.
 */
const plantChildWithStatus = (box, home, meta) => plantRollout(box, {
  id: CHILD,
  cwd: home,
  started: at(10),
  meta,
  lines: [
    codexTurn({ when: at(10) }),
    codexStatus({ when: at(10), total: { input: 15000, output: 1500 } }),
    ...childCalls().map(codexCall),
  ],
});

test('F18 a spawned child whose first record\'s own figure is all zeros is not a call there, and its next record counts by its rise', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantParent(box, home);
  await plantChildWithStatus(box, home, spawnedBy(PARENT));
  await bookSays(bots, 'api-bot', { daily: ran(PARENT) });

  const answer = await usage(box);
  const child = childIn(answer);
  assert.equal(child.calls, 2, 'its own two calls: 3 counts the status record as a call');
  assert.equal(tokensOf(child).input, 80000, 'the rises 30,000 and 50,000: 95,000 counts the status record by its running total');
  assert.equal(tokensOf(child).output, 8000, 'and not 9,500');
  assert.equal(Date.parse(child.first), Date.parse(at(10, 10)), 'its first call is at 10:10, not the status record at 10:00');
  assert.deepEqual(
    leftOutOf(entryOf(answer, 'api-bot'), 'unclaimed_not_counted'),
    NOTHING_LEFT_OUT,
    'a status record is not a call left out',
  );

  const statusOnly = entryOf(await usage(box, '--since', at(10), '--until', at(10, 5)), 'api-bot');
  assert.deepEqual(idsOf(statusOnly.unclaimed), [], 'a window that holds only the status record has no row for the child');
  assert.deepEqual(leftOutOf(statusOnly, 'unclaimed_not_counted'), NOTHING_LEFT_OUT);
});

test('F19 a guardian review whose first record\'s own figure is all zeros is not a call there, and its next record counts by its rise', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantParent(box, home);
  await plantChildWithStatus(box, home, reviewOf(PARENT));
  await bookSays(bots, 'api-bot', { daily: ran(PARENT) });

  const answer = await usage(box);
  const child = childIn(answer);
  assert.equal(child.calls, 2, 'its own two calls: 3 counts the status record as a call');
  assert.equal(tokensOf(child).input, 80000, 'the rises 30,000 and 50,000: 95,000 counts the status record by its running total');
  assert.equal(tokensOf(child).output, 8000, 'and not 9,500');
  assert.deepEqual(leftOutOf(entryOf(answer, 'api-bot'), 'unclaimed_not_counted'), NOTHING_LEFT_OUT);
});

// ------------------------------------------- an origin that cannot be had

test('F13 a child whose origin is not on disk counts nothing and is reported as unreadable, under the bot when no session claims it', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantParent(box, home);
  await plantChild(box, home, { meta: forkedFrom(GONE), copies: beforeTheChild(1) });
  await bookSays(bots, 'api-bot', { daily: ran(PARENT) });

  const answer = await usage(box);
  const entry = entryOf(answer, 'api-bot');

  assert.deepEqual(
    idsOf(entry.unclaimed),
    [],
    'which records are copies cannot be told, so none is counted: a row counts the copies (95,000 or 94,000) '
    + 'or guesses at them',
  );
  assert.deepEqual(leftOutOf(entry, 'unclaimed_not_counted'), leftOut({ unreadable_transcripts: 1 }), 'the child');
  const daily = sessionOf(entry, 'daily');
  assert.deepEqual(leftOutOf(daily), NOTHING_LEFT_OUT, 'and nothing of it laid at the session\'s door');
  assert.equal(tokensOf(parentIn(answer)).input, 15500, 'while the parent beside it counts as it did');
});

test('F14 a child whose origin is not on disk, and which copied nothing, still counts nothing', async (t) => {
  // Its records look like its own calls, but without the origin that cannot be
  // told.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantChild(box, home, { meta: forkedFrom(GONE) });
  await bookSays(bots, 'api-bot', { daily: ran('019f9600-0000-7000-8000-00000000cccc') });

  const entry = entryOf(await usage(box), 'api-bot');

  assert.deepEqual(idsOf(entry.unclaimed), [], 'not the 80,000 of what look like its own calls');
  assert.deepEqual(leftOutOf(entry, 'unclaimed_not_counted'), leftOut({ unreadable_transcripts: 1 }));
});

test('F15 a session\'s own conversation whose origin is not on disk is reported as unreadable under that session', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantChild(box, home, { meta: { ...OWN_CONVERSATION, forked_from_id: GONE }, copies: beforeTheChild(1) });
  await bookSays(bots, 'api-bot', { daily: ran(CHILD) });

  const entry = entryOf(await usage(box), 'api-bot');
  const daily = sessionOf(entry, 'daily');

  assert.deepEqual(idsOf(conversationsOf(daily)), [], 'none of its records is counted');
  assert.deepEqual(leftOutOf(daily), leftOut({ unreadable_transcripts: 1 }), 'the session\'s conversation');
  assert.deepEqual(leftOutOf(entry, 'unclaimed_not_counted'), NOTHING_LEFT_OUT, 'and not the bot\'s unclaimed');
});

test('F16 a child whose origin is on disk but cannot be read counts nothing and is reported as unreadable', { skip: UNREADABLE_NEEDS_A_USER }, async (t) => {
  // The origin ran in another folder, so it is not a transcript of this bot's
  // and the one unreadable transcript reported is the child.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  const elsewhere = box.path('elsewhere');
  await mkdir(elsewhere, { recursive: true });
  const origin = await plantParent(box, elsewhere);
  await chmod(origin, 0o000);
  await plantChild(box, home, { meta: forkedFrom(PARENT), copies: beforeTheChild(1) });
  await bookSays(bots, 'api-bot', { daily: ran('019f9600-0000-7000-8000-00000000cccc') });

  const entry = entryOf(await usage(box), 'api-bot');

  assert.deepEqual(idsOf(entry.unclaimed), [], 'not the 95,000 of copies and own calls together');
  assert.deepEqual(leftOutOf(entry, 'unclaimed_not_counted'), leftOut({ unreadable_transcripts: 1 }));
});

// ------------------------------------------------- nothing else changes

test('F17 an ordinary rollout counts as it did: its first record, a repeat that is not a call, and a new window by its own figure', async (t) => {
  // No origin, the first running total equal to its own figure. 1,000; 2,000
  // by its rise; the same again, not a call; a fall to 500, counted by its own
  // figure; 700 by its rise. 4,200 in four calls.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantRollout(box, {
    id: PARENT,
    cwd: home,
    started: at(9),
    meta: OWN_CONVERSATION,
    lines: [
      codexTurn({ when: at(9) }),
      codexCall({ when: at(9, 1), last: { input: 1000, output: 100 }, total: { input: 1000, output: 100 } }),
      codexCall({ when: at(9, 2), last: { input: 2000, output: 200 }, total: { input: 3000, output: 300 } }),
      codexCall({ when: at(9, 3), last: { input: 2000, output: 200 }, total: { input: 3000, output: 300 } }),
      codexCall({ when: at(9, 4), last: { input: 500, output: 50 }, total: { input: 500, output: 50 } }),
      codexCall({ when: at(9, 5), last: { input: 700, output: 70 }, total: { input: 1200, output: 120 } }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran(PARENT) });

  const parent = parentIn(await usage(box));
  assert.equal(parent.calls, 4);
  assert.equal(tokensOf(parent).input, 4200);
  assert.equal(tokensOf(parent).output, 420);
});
