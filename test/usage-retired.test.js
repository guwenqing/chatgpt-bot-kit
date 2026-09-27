// `obk usage` counts a retired session's calls, under that session (issue #379).
//
// `obk retire --bot X --session S` takes S off bot.yaml and moves its entry in
// the book from `sessions.S` to a list `retired:` at the top of the book, as
// `{ name: S, ...the entry it had, retired: <ISO time> }`. The book counts those
// conversations as claimed, so they are never unclaimed; and usage used to
// build a block only for the sessions in bot.yaml, so their calls were counted
// nowhere.
//
// Now each entry of `retired:` has a block of its own in the bot's `sessions`,
// after the live ones and in the book's order: `{ name, retired, conversations,
// not_counted }`, counted exactly as a live session's is. A live block carries
// no `retired` key. The same name can be in the book more than once, and each
// entry is its own block holding its own conversations. The book does not say
// which harness a retired session ran on, so its conversations are found
// whatever harness wrote them. In the plain report a retired block opens with
// `session    <name>  retired <time>`.
//
// Every transcript is planted in the sandbox's own home. Nothing reads the real
// `~/.claude` or `~/.codex`, and Orca is the sandbox's fake. The helpers below
// are copied from usage-subagents.test.js, so that importing it does not run
// its tests again.

import assert from 'node:assert/strict';
import { mkdir, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import { bookOf, botHomeOf, createSandbox } from './helpers/cli.js';

/** A moment on the day these tests are set, as both harnesses write one. */
const at = (hour, minute = 0, second = 0) =>
  `2026-09-20T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000Z`;

const CLAUDE_MODEL = 'claude-opus-5';
const CODEX_MODEL = 'gpt-6-astra';

// ---------------------------------------------------------------- the fleet

/** A bots folder with one bot in it, its sessions written, and nothing opened in Orca. */
async function fleet(box, { harness = 'claude', sessions = ['daily'] } = {}) {
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

/** The book of one bot, written as the kit writes it: its live sessions, and the retired ones in order. */
const bookSays = (bots, bot, sessions, retired) => writeFile(
  bookOf(bots, bot),
  stringify({ orca: { project: 'proj-1', setup: 'setup-1' }, sessions, ...(retired === undefined ? {} : { retired }) }),
);

/** A session entry of the book: the conversation it is in, and the ones before it. */
const ran = (session, ...before) => ({
  tab: `tab-${session}`,
  launched: at(8),
  session,
  ...(before.length === 0 ? {} : { history: before.map((old) => ({ session: old, ended: 'clear', at: at(8, 30) })) }),
});

/** An entry of the book's `retired:` list, as `obk retire` writes it: the entry the session had, its name, and when. */
const gone = (name, when, session, ...before) => ({ name, ...ran(session, ...before), retired: when });

// ------------------------------------------------- what a harness writes down

/** One Claude Code API call, as an `assistant` line of its transcript. */
const claudeCall = ({
  when, request, message, model = CLAUDE_MODEL, effort = 'high',
  input = 0, cacheRead = 0, cacheWrite = 0, output = 0,
}) => ({
  type: 'assistant',
  timestamp: when,
  requestId: request,
  effort,
  message: {
    id: message,
    model,
    usage: {
      input_tokens: input,
      cache_read_input_tokens: cacheRead,
      cache_creation_input_tokens: cacheWrite,
      output_tokens: output,
    },
  },
});

/** A Claude Code call with some of its figures replaced; `undefined` takes one out. */
const claudeCallAnd = (call, figures) => {
  const record = claudeCall(call);
  Object.assign(record.message.usage, figures);
  return record;
};

/** A Claude Code transcript line that cannot be a JSON object: a write torn off mid record. */
const TORN = '{"type":"assistant","timestamp":"2026-09-20T10:20:00.000Z","requestId":"req-torn","message":{"id":"msg-torn","usage":{"input_tokens":7000';

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

/** Claude Code's project folder for a bot home: every non letter or digit a dash. */
const claudeProjectOf = (box, home) => path.join(box.home, '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'));

/** Set a file's time to the latest of the times its lines carry, as a file written as it runs would have it. */
async function touchToLast(file, stamps) {
  const dated = stamps.filter((stamp) => typeof stamp === 'string');
  const touched = new Date(Math.max(...dated.map((stamp) => Date.parse(stamp))));
  await utimes(file, touched, touched);
}

/** Plant a conversation's main transcript where its harness keeps it, inside the sandbox's home. */
async function plant(box, harness, home, { id, started, lines }) {
  const file = harness === 'codex'
    ? path.join(
      box.home, '.codex', 'sessions', ...started.slice(0, 10).split('-'),
      `rollout-${started.replaceAll(':', '-').replace(/\..*$/, '')}-${id}.jsonl`,
    )
    : path.join(claudeProjectOf(box, home), `${id}.jsonl`);

  const first = harness === 'codex'
    ? { timestamp: started, type: 'session_meta', payload: { id, cwd: home, timestamp: started } }
    : { type: 'system', sessionId: id, cwd: home, timestamp: started };

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, [first, ...lines].map((line) => JSON.stringify(line)).join('\n') + '\n');
  await touchToLast(file, [started, ...lines.map((line) => line.timestamp)]);
  return file;
}

/** A Claude Code conversation with one call in it, at `when`. */
const plantOneCall = (box, home, id, when, { input = 3, output = 4 } = {}) => plant(box, 'claude', home, {
  id,
  started: when,
  lines: [claudeCall({ when, request: `req-${id}`, message: `msg-${id}`, input, output })],
});

/**
 * Plant one subagent's transcript beside its conversation's main transcript,
 * as Claude Code writes it: `<id>/subagents/agent-<agent>.jsonl`, every line
 * marked as a sidechain of that conversation, and its `.meta.json` beside it.
 */
async function plantSubagent(box, home, { parent, agent, started, lines }) {
  const folder = path.join(claudeProjectOf(box, home), parent, 'subagents');
  const file = path.join(folder, `agent-${agent}.jsonl`);
  const mark = (line) => ({ ...line, isSidechain: true, agentId: agent, sessionId: parent });
  const prompt = mark({ type: 'user', cwd: home, timestamp: started, message: { role: 'user', content: 'look into it' } });

  await mkdir(folder, { recursive: true });
  await writeFile(file, [prompt, ...lines.map(mark)].map((line) => JSON.stringify(line)).join('\n') + '\n');
  await touchToLast(file, [started, ...lines.map((line) => line.timestamp)]);
  await writeFile(
    path.join(folder, `agent-${agent}.meta.json`),
    JSON.stringify({ agentType: 'general-purpose', description: 'Look into it', toolUseId: `toolu_${agent}`, spawnDepth: 1 }),
  );
  return file;
}

/**
 * Put lines into a planted transcript as they are, after its first `after`
 * lines: a string as the text it is, anything else as JSON. The file keeps the
 * time it had.
 */
async function slipIn(file, after, ...lines) {
  const { atime, mtime } = await stat(file);
  const had = (await readFile(file, 'utf8')).split('\n');
  had.splice(after, 0, ...lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))));
  await writeFile(file, had.join('\n'));
  await utimes(file, atime, mtime);
}

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

/** Run the command for its plain report, as lines. */
async function plainUsage(box, ...rest) {
  const result = await box.run(['usage', '--bots', 'bots', ...rest]);
  assert.equal(result.code, 0, `usage reports and never fails: ${result.stderr}`);
  return result.stdout.split('\n');
}

/** The one entry about one bot. */
function entryOf(answer, bot) {
  const found = answer.usage.filter((entry) => entry.bot === bot);
  assert.equal(found.length, 1, `one entry should be about ${bot}, got: ${JSON.stringify(answer.usage)}`);
  return found[0];
}

/** Every block of a bot's `sessions` that has the name given, in the answer's order. */
const blocksNamed = (entry, name) => (entry.sessions ?? []).filter((session) => session.name === name);

/** The one block about one of a bot's sessions. */
function sessionOf(entry, name) {
  const found = blocksNamed(entry, name);
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

/** Nothing left out, in the answer's words. */
const NOTHING_LEFT_OUT = {
  unreadable_transcripts: 0,
  broken_lines: 0,
  records_without_numbers: 0,
  records_without_time: 0,
};

/** What was left out, of the four kinds, with every kind not named at 0. */
const leftOut = (some) => ({ ...NOTHING_LEFT_OUT, ...some });

/** What a session says it left out: the four kinds and only those. */
function leftOutOf(owner, field = 'not_counted') {
  const said = owner[field];
  assert.ok(
    said !== null && typeof said === 'object',
    `it should say what it left out in ${field}, got: ${JSON.stringify(owner)}`,
  );
  return Object.fromEntries(Object.keys(NOTHING_LEFT_OUT).map((kind) => [kind, said[kind]]));
}

/** Every call and token a bot's answer counted, conversation by conversation, whoever it was put under. */
function everyCallIn(entry) {
  const all = [...(entry.sessions ?? []).flatMap(conversationsOf), ...(entry.unclaimed ?? [])];
  return all
    .map((one) => ({ id: one.id, calls: one.calls, tokens: tokensOf(one) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// ------------------------------------------------------------------ the tests

test('R1 done-check: a retired session\'s calls are counted under a block of its own, marked retired, and nowhere else', async (t) => {
  // old was retired at 12:00. Its conversation now, conv-r, made two calls
  // (3 + 5 in, 4 + 6 out); the one before it, conv-r0, made one (7 in, 8 out).
  // conv-nobodys is in the bot's folder and in no entry of the book.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantOneCall(box, home, 'conv-live', at(9, 1));
  await plant(box, 'claude', home, {
    id: 'conv-r',
    started: at(10),
    lines: [
      claudeCall({ when: at(10, 1), request: 'req-r1', message: 'msg-r1', input: 3, output: 4 }),
      claudeCall({ when: at(10, 2), request: 'req-r2', message: 'msg-r2', input: 5, output: 6 }),
    ],
  });
  await plantOneCall(box, home, 'conv-r0', at(9, 30), { input: 7, output: 8 });
  await plantOneCall(box, home, 'conv-nobodys', at(11));
  await bookSays(bots, 'api-bot', { daily: ran('conv-live') }, [gone('old', at(12), 'conv-r', 'conv-r0')]);

  const entry = entryOf(await usage(box), 'api-bot');

  const old = sessionOf(entry, 'old');
  assert.equal(old.retired, at(12), `the block says when the session was retired, as the book has it, got: ${JSON.stringify(old)}`);
  assert.deepEqual(idsOf(conversationsOf(old)), ['conv-r', 'conv-r0'], 'the conversation it was in, and the one in its history');
  const now = conversationOf(conversationsOf(old), 'conv-r');
  assert.equal(now.calls, 2);
  assert.equal(tokensOf(now).input, 8);
  assert.equal(tokensOf(now).output, 10);
  const before = conversationOf(conversationsOf(old), 'conv-r0');
  assert.equal(before.calls, 1);
  assert.equal(tokensOf(before).input, 7);
  assert.equal(tokensOf(before).output, 8);
  assert.deepEqual(idsOf(conversationsOf(sessionOf(entry, 'daily'))), ['conv-live'], 'the live session keeps only its own');
  assert.deepEqual(idsOf(entry.unclaimed), ['conv-nobodys'], 'and the retired session\'s are not unclaimed as well');
});

test('R2 retired blocks come after the live ones, in the book\'s order, and only they are marked retired', async (t) => {
  // zeta was retired after alpha in time, but the book lists zeta first; the
  // answer follows the book, not the names and not the times.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { sessions: ['daily', 'review'] });
  for (const id of ['conv-d', 'conv-v', 'conv-z', 'conv-a']) await plantOneCall(box, home, id, at(9, 1));
  await bookSays(
    bots,
    'api-bot',
    { daily: ran('conv-d'), review: ran('conv-v') },
    [gone('zeta', at(11), 'conv-z'), gone('alpha', at(12), 'conv-a')],
  );

  const entry = entryOf(await usage(box), 'api-bot');

  assert.deepEqual((entry.sessions ?? []).map((session) => session.name), ['daily', 'review', 'zeta', 'alpha']);
  assert.deepEqual(
    (entry.sessions ?? []).map((session) => session.retired),
    [undefined, undefined, at(11), at(12)],
    `each retired block carries its own time, and a live one carries none, got: ${JSON.stringify(entry.sessions)}`,
  );
  for (const live of ['daily', 'review']) {
    assert.equal('retired' in sessionOf(entry, live), false, `a live block has no retired key, got: ${JSON.stringify(sessionOf(entry, live))}`);
  }
});

test('R3 a window that spans a real `obk retire` counts the same calls before and after it, under the session', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { sessions: ['daily', 'review'] });
  await plantOneCall(box, home, 'conv-d-old', at(9, 1), { input: 11, output: 12 });
  await plantOneCall(box, home, 'conv-d', at(10, 1), { input: 13, output: 14 });
  await plantOneCall(box, home, 'conv-v', at(9, 30), { input: 15, output: 16 });
  await plantOneCall(box, home, 'conv-nobodys', at(11), { input: 17, output: 18 });
  await bookSays(bots, 'api-bot', { daily: ran('conv-d', 'conv-d-old'), review: ran('conv-v') });
  const window = ['--since', at(9), '--until', at(12)];
  const before = entryOf(await usage(box, ...window), 'api-bot');
  assert.deepEqual(
    idsOf(conversationsOf(sessionOf(before, 'daily'))),
    ['conv-d', 'conv-d-old'],
    'daily holds its two conversations before it is retired, or the check after means nothing',
  );
  const retiredFrom = Date.now();

  const retired = await box.run(['retire', '--bots', 'bots', '--bot', 'api-bot', '--session', 'daily']);
  assert.equal(retired.code, 0, `the retirement this test stands on did not happen: ${retired.stderr}`);
  const retiredTo = Date.now();
  const book = parse(await readFile(bookOf(bots, 'api-bot'), 'utf8'));
  assert.equal(book.sessions?.daily, undefined, 'daily is off the live list of the book');

  const after = entryOf(await usage(box, ...window), 'api-bot');

  assert.deepEqual(everyCallIn(after), everyCallIn(before), 'every call in the window is counted after the retirement as before it');
  const daily = sessionOf(after, 'daily');
  assert.deepEqual(idsOf(conversationsOf(daily)), ['conv-d', 'conv-d-old'], 'still under daily');
  assert.equal(daily.retired, book.retired[0].retired, 'marked retired, at the time the book has');
  assert.ok(
    Date.parse(daily.retired) >= Math.floor(retiredFrom / 1000) * 1000 && Date.parse(daily.retired) <= retiredTo,
    `at the time it was retired, got: ${daily.retired}`,
  );
  assert.deepEqual(idsOf(conversationsOf(sessionOf(after, 'review'))), ['conv-v']);
  assert.deepEqual(idsOf(after.unclaimed), ['conv-nobodys']);
});

test('R4 a retired session\'s conversation is counted exactly as a live one\'s: window, subagents and what was left out', async (t) => {
  // conv-live (daily's) and conv-ret (retired old's) are the same conversation
  // twice. In the window 10:00 to 12:00: a main call at 10:30 (20 in, 200
  // cache reads, 2 out) and a subagent call at 11:10 written twice (3 in, 30
  // out) are counted, 2 calls, 1 of them a subagent's; the calls at 09:01,
  // 09:30 and 12:30 are outside it; a record at 11:00 has no output figure; and
  // one line is torn.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  for (const id of ['conv-live', 'conv-ret']) {
    const main = await plant(box, 'claude', home, {
      id,
      started: at(9),
      lines: [
        claudeCall({ when: at(9, 1), request: `req-${id}-1`, message: `msg-${id}-1`, input: 1000, output: 100 }),
        claudeCall({ when: at(10, 30), request: `req-${id}-2`, message: `msg-${id}-2`, input: 20, cacheRead: 200, output: 2 }),
        claudeCallAnd({ when: at(11), request: `req-${id}-3`, message: `msg-${id}-3`, input: 9 }, { output_tokens: undefined }),
        claudeCall({ when: at(12, 30), request: `req-${id}-4`, message: `msg-${id}-4`, input: 5000, output: 500 }),
      ],
    });
    await slipIn(main, 2, TORN);
    const twice = claudeCall({ when: at(11, 10), request: `req-${id}-s1`, message: `msg-${id}-s1`, input: 3, output: 30 });
    await plantSubagent(box, home, {
      parent: id,
      agent: `agent-${id}`,
      started: at(9, 29),
      lines: [
        claudeCall({ when: at(9, 30), request: `req-${id}-s0`, message: `msg-${id}-s0`, input: 777, output: 77 }),
        twice,
        twice,
      ],
    });
  }
  await bookSays(bots, 'api-bot', { daily: ran('conv-live') }, [gone('old', at(12), 'conv-ret')]);

  const entry = entryOf(await usage(box, '--since', at(10), '--until', at(12)), 'api-bot');

  const live = sessionOf(entry, 'daily');
  const old = sessionOf(entry, 'old');
  const ret = conversationOf(conversationsOf(old), 'conv-ret');
  assert.equal(ret.calls, 2, `the main call and the subagent's inside the window, the repeated one once, got: ${JSON.stringify(ret)}`);
  assert.equal(ret.subagent_calls, 1);
  assert.deepEqual(tokensOf(ret), { input: 23, output: 32, cache_read: 200, cache_write: 0, reasoning: 0 });
  assert.deepEqual(leftOutOf(old), leftOut({ broken_lines: 1, records_without_numbers: 1 }), 'the torn line and the record with no output');
  const { id: liveId, ...liveRest } = conversationOf(conversationsOf(live), 'conv-live');
  const { id: retId, ...retRest } = ret;
  assert.deepEqual(retRest, liveRest, 'every figure the same as the live twin\'s');
  assert.deepEqual(leftOutOf(old), leftOutOf(live));
});

test('R5 a retired session\'s Codex conversation is counted on a bot whose every live session runs on Claude Code', async (t) => {
  // The book does not say which harness a retired session ran on. conv-x is a
  // Codex rollout in the bot's folder: one call, 40 in, 5 out.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plantOneCall(box, home, 'conv-live', at(9, 1));
  await plant(box, 'codex', home, {
    id: 'conv-x',
    started: at(9),
    lines: [
      codexTurn({ when: at(9) }),
      codexCall({ when: at(9, 10), last: { input: 40, output: 5 }, total: { input: 40, output: 5 } }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-live') }, [gone('old', at(12), 'conv-x')]);

  const entry = entryOf(await usage(box), 'api-bot');

  const conversation = conversationOf(conversationsOf(sessionOf(entry, 'old')), 'conv-x');
  assert.equal(conversation.calls, 1);
  assert.equal(tokensOf(conversation).input, 40);
  assert.equal(tokensOf(conversation).output, 5);
  assert.deepEqual([...conversation.models], [CODEX_MODEL]);
});

test('R6 the same name in the book more than once is a block per entry, each with its own conversations only', async (t) => {
  // daily was retired at 10:00 and at 12:00, and is live again now.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  for (const id of ['conv-first', 'conv-second', 'conv-now']) await plantOneCall(box, home, id, at(9, 1));
  await bookSays(
    bots,
    'api-bot',
    { daily: ran('conv-now') },
    [gone('daily', at(10), 'conv-first'), gone('daily', at(12), 'conv-second')],
  );

  const entry = entryOf(await usage(box), 'api-bot');

  const blocks = blocksNamed(entry, 'daily');
  assert.deepEqual(
    blocks.map((block) => ({ retired: block.retired, ids: idsOf(conversationsOf(block)) })),
    [
      { retired: undefined, ids: ['conv-now'] },
      { retired: at(10), ids: ['conv-first'] },
      { retired: at(12), ids: ['conv-second'] },
    ],
    `got: ${JSON.stringify(entry.sessions)}`,
  );
});

test('R7 --session picks the retired blocks of that name as well as the live one, and no other', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { sessions: ['daily', 'review'] });
  for (const id of ['conv-d', 'conv-v', 'conv-dr', 'conv-o']) await plantOneCall(box, home, id, at(9, 1));
  await bookSays(
    bots,
    'api-bot',
    { daily: ran('conv-d'), review: ran('conv-v') },
    [gone('daily', at(10), 'conv-dr'), gone('old', at(11), 'conv-o')],
  );

  const daily = entryOf(await usage(box, '--bot', 'api-bot', '--session', 'daily'), 'api-bot');
  const old = entryOf(await usage(box, '--bot', 'api-bot', '--session', 'old'), 'api-bot');

  assert.deepEqual(
    (daily.sessions ?? []).map((block) => ({ name: block.name, retired: block.retired, ids: idsOf(conversationsOf(block)) })),
    [
      { name: 'daily', retired: undefined, ids: ['conv-d'] },
      { name: 'daily', retired: at(10), ids: ['conv-dr'] },
    ],
  );
  assert.deepEqual(
    (old.sessions ?? []).map((block) => ({ name: block.name, retired: block.retired, ids: idsOf(conversationsOf(block)) })),
    [{ name: 'old', retired: at(11), ids: ['conv-o'] }],
    'a name only a retired entry has is picked too',
  );
});

test('R8 a retired entry that spent nothing in the window still has its block, with no conversations', async (t) => {
  // old's conversation made its one call at 09:01, before the window. never
  // was launched and retired before the book learnt of any conversation.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantOneCall(box, home, 'conv-d', at(11));
  await plantOneCall(box, home, 'conv-o', at(9, 1));
  const { session, ...launchedOnly } = gone('never', at(9, 45), 'unused');
  await bookSays(bots, 'api-bot', { daily: ran('conv-d') }, [gone('old', at(9, 50), 'conv-o'), launchedOnly]);

  const entry = entryOf(await usage(box, '--since', at(10)), 'api-bot');

  assert.deepEqual(idsOf(conversationsOf(sessionOf(entry, 'daily'))), ['conv-d'], 'the live one counts its call in the window');
  for (const [name, when] of [['old', at(9, 50)], ['never', at(9, 45)]]) {
    const block = sessionOf(entry, name);
    assert.equal(block.retired, when);
    assert.deepEqual(conversationsOf(block), [], `${name} is there, with nothing in the window`);
    assert.deepEqual(leftOutOf(block), NOTHING_LEFT_OUT);
  }
});

test('R9 the plain report opens a retired block with its name and when it was retired, and lists its conversations under it', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantOneCall(box, home, 'conv-d', at(9, 1));
  await plantOneCall(box, home, 'conv-o', at(9, 2));
  await bookSays(bots, 'api-bot', { daily: ran('conv-d') }, [gone('old', at(12), 'conv-o')]);

  const lines = await plainUsage(box, '--bot', 'api-bot');

  const live = lines.indexOf('session    daily');
  const old = lines.indexOf(`session    old  retired ${at(12)}`);
  assert.ok(live >= 0, `a live block opens with its name alone, got:\n${lines.join('\n')}`);
  assert.ok(old >= 0, `a retired block opens with its name and when it was retired, got:\n${lines.join('\n')}`);
  assert.ok(lines[live + 1].includes('conv-d'), `daily's conversation is under daily, got:\n${lines.join('\n')}`);
  assert.ok(lines[old + 1].includes('conv-o'), `old's conversation is under old, got:\n${lines.join('\n')}`);
});
