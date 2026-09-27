// `obk usage` counts every call a session made, exactly once (issue #371).
//
// Two ways a call went uncounted or was counted twice:
//
//   A. Claude Code writes the calls of the subagents a conversation starts
//      (its Agent or Task tool) beside its main transcript, one file per
//      subagent: `~/.claude/projects/<slug>/<id>/subagents/agent-<name>.jsonl`,
//      with an `agent-<name>.meta.json` beside each that is not a transcript.
//      Their calls belong to the conversation that started them, and so to its
//      session. The report says how many of a conversation's calls were
//      subagents'. A call is one `requestId` and `message.id` across the main
//      transcript and every subagent file together, and the same call has been
//      seen written into several subagent files of one conversation.
//
//   B. Codex, #302: a `token_count` whose `info` has `last_token_usage` and no
//      running total was counted by its own figure, and the next event's rise
//      in the running total counted it again. It is now treated as an event
//      whose running total has a figure missing: not counted and named, and the
//      next event with a whole running total is not counted and is named too.
//
// Every transcript is planted in the sandbox's own home. Nothing reads the real
// `~/.claude` or `~/.codex`. The helpers below are copied from usage.test.js,
// so that importing it does not run its tests again.

import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { stringify } from 'yaml';

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

/** The book of one bot, written as the kit writes it. */
const bookSays = (bots, bot, sessions) =>
  writeFile(bookOf(bots, bot), stringify({ orca: { project: 'proj-1', setup: 'setup-1' }, sessions }));

/** A session entry of the book: the conversation it is in, and the ones before it. */
const ran = (session, ...before) => ({
  tab: `tab-${session}`,
  launched: at(8),
  session,
  ...(before.length === 0 ? {} : { history: before.map((old) => ({ session: old, ended: 'clear', at: at(8, 30) })) }),
});

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
const TORN = '{"type":"assistant","timestamp":"2026-09-20T09:20:00.000Z","requestId":"req-torn","message":{"id":"msg-torn","usage":{"input_tokens":7000';

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

/** A Codex token_count with only its own per-call figure: no running total key at all. */
const codexLastOnly = (when, figure) => ({
  timestamp: when,
  type: 'event_msg',
  payload: { type: 'token_count', info: { last_token_usage: codexTokens(figure), model_context_window: 190000 } },
});

/** A Codex token_count with its own per-call figure and a running total that is null. */
const codexLastAndNullTotal = (when, figure) => ({
  timestamp: when,
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: { last_token_usage: codexTokens(figure), total_token_usage: null, model_context_window: 190000 },
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

/**
 * Plant one subagent's transcript beside its conversation's main transcript,
 * as Claude Code writes it: `<id>/subagents/agent-<agent>.jsonl`, every line
 * marked as a sidechain of that conversation and carrying the subagent's own
 * id, opening with the prompt it was given. Beside it the subagent's
 * `agent-<agent>.meta.json`, which is not a transcript. `prettyMeta` writes
 * that file over several lines, as a JSON file may be written.
 */
async function plantSubagent(box, home, { parent, agent, started, lines, prettyMeta = false }) {
  const folder = path.join(claudeProjectOf(box, home), parent, 'subagents');
  const file = path.join(folder, `agent-${agent}.jsonl`);
  const mark = (line) => ({ ...line, isSidechain: true, agentId: agent, sessionId: parent });
  const prompt = mark({ type: 'user', cwd: home, timestamp: started, message: { role: 'user', content: 'look into it' } });

  await mkdir(folder, { recursive: true });
  await writeFile(file, [prompt, ...lines.map(mark)].map((line) => JSON.stringify(line)).join('\n') + '\n');
  await touchToLast(file, [started, ...lines.map((line) => line.timestamp)]);

  const meta = { agentType: 'general-purpose', description: 'Look into it', toolUseId: `toolu_${agent}`, spawnDepth: 1 };
  await writeFile(
    path.join(folder, `agent-${agent}.meta.json`),
    prettyMeta ? `${JSON.stringify(meta, null, 2)}\n` : JSON.stringify(meta),
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

/** Run the command for its plain report. */
async function plainUsage(box, ...rest) {
  const result = await box.run(['usage', '--bots', 'bots', ...rest]);
  assert.equal(result.code, 0, `usage reports and never fails: ${result.stderr}`);
  return result.stdout;
}

/** The one line of a plain report about one conversation. */
function lineOf(stdout, id) {
  const found = stdout.split('\n').filter((line) => line.includes(id));
  assert.equal(found.length, 1, `one line should be about ${id}, got:\n${stdout}`);
  return found[0];
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

/** The one conversation `id` of the session `name` of api-bot. */
const claimed = (answer, id, name = 'daily') =>
  conversationOf(conversationsOf(sessionOf(entryOf(answer, 'api-bot'), name)), id);

/** The one entry about one model in a conversation's per-model split. */
function modelOf(conversation, model) {
  assert.ok(Array.isArray(conversation.by_model), `a conversation should split its usage by model, got: ${JSON.stringify(conversation)}`);
  const found = conversation.by_model.filter((one) => one.model === model);
  assert.equal(found.length, 1, `one entry should be about ${model}, got: ${JSON.stringify(conversation.by_model)}`);
  return found[0];
}

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

/** Root reads a file whatever its permissions, so a transcript cannot be made unreadable to it. */
const UNREADABLE_NEEDS_A_USER = process.getuid?.() === 0
  && 'runs as root, which reads a file whatever its permissions, so no transcript can be made unreadable';

/**
 * The issue's done-check fixture: conv-a, the daily session's, made two calls
 * of its own and started one subagent, which made three calls and wrote the
 * first of them down twice. Five calls in all, three of them the subagent's:
 * input 10 + 20 + 1 + 2 + 3 = 36, output 100 + 200 + 11 + 22 + 33 = 366, cache
 * reads 1,000 + 2,000 + 100 + 200 + 300 = 3,600, cache writes 50 + 60 + 5 + 6
 * + 7 = 128.
 */
async function sessionWithASubagent(box) {
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [
      claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 10, cacheRead: 1000, cacheWrite: 50, output: 100 }),
      claudeCall({ when: at(9, 20), request: 'req-2', message: 'msg-2', input: 20, cacheRead: 2000, cacheWrite: 60, output: 200 }),
    ],
  });
  const first = claudeCall({ when: at(9, 5), request: 'req-s1', message: 'msg-s1', input: 1, cacheRead: 100, cacheWrite: 5, output: 11 });
  await plantSubagent(box, home, {
    parent: 'conv-a',
    agent: 'a1b2c3',
    started: at(9, 4),
    lines: [
      first,
      first,
      claudeCall({ when: at(9, 6), request: 'req-s2', message: 'msg-s2', input: 2, cacheRead: 200, cacheWrite: 6, output: 22 }),
      claudeCall({ when: at(9, 7), request: 'req-s3', message: 'msg-s3', input: 3, cacheRead: 300, cacheWrite: 7, output: 33 }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });
}

// ------------------------------------------------------ A. Claude subagents

test('S1 done-check: a subagent\'s calls are counted once, under the session that started it, and the JSON says how many were the subagent\'s', async (t) => {
  // Today only the main transcript is read: 2 calls, 30 in, 300 out.
  const box = await createSandbox(t);
  await sessionWithASubagent(box);

  const conversation = claimed(await usage(box), 'conv-a');

  assert.equal(conversation.calls, 5, 'two of its own and three of the subagent\'s, the repeated one once');
  assert.equal(conversation.subagent_calls, 3, 'of which three were the subagent\'s');
  assert.deepEqual(
    tokensOf(conversation),
    { input: 36, output: 366, cache_read: 3600, cache_write: 128, reasoning: 0 },
    'the subagent\'s tokens are in the conversation\'s, the repeated call once',
  );
});

test('S1 done-check: the plain report says how many of a conversation\'s calls were subagents\', right after its call count', async (t) => {
  const box = await createSandbox(t);
  await sessionWithASubagent(box);

  const line = lineOf(await plainUsage(box), 'conv-a');

  assert.match(line, /\b5 calls\W*of which subagents: 3 calls\b/, `got: ${line}`);
});

test('S2 the plain report says "1 call" when one of a conversation\'s calls was a subagent\'s', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 3, output: 4 })],
  });
  await plantSubagent(box, home, {
    parent: 'conv-a',
    agent: 'a1b2c3',
    started: at(9, 2),
    lines: [claudeCall({ when: at(9, 3), request: 'req-s1', message: 'msg-s1', input: 5, output: 6 })],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const line = lineOf(await plainUsage(box), 'conv-a');

  assert.match(line, /\b2 calls\W*of which subagents: 1 call(?!s)/, `got: ${line}`);
});

test('S2 a conversation with no subagents says 0 in the JSON and nothing about subagents in the plain report', async (t) => {
  // conv-b ran no subagent; conv-a, in the same session, ran one with two calls.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 3, output: 4 })],
  });
  await plantSubagent(box, home, {
    parent: 'conv-a',
    agent: 'a1b2c3',
    started: at(9, 2),
    lines: [
      claudeCall({ when: at(9, 3), request: 'req-s1', message: 'msg-s1', input: 5, output: 6 }),
      claudeCall({ when: at(9, 4), request: 'req-s2', message: 'msg-s2', input: 5, output: 6 }),
    ],
  });
  await plant(box, 'claude', home, {
    id: 'conv-b',
    started: at(10),
    lines: [
      claudeCall({ when: at(10, 1), request: 'req-b1', message: 'msg-b1', input: 7, output: 8 }),
      claudeCall({ when: at(10, 2), request: 'req-b2', message: 'msg-b2', input: 7, output: 8 }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-b', 'conv-a') });

  const answer = await usage(box);
  const stdout = await plainUsage(box);

  assert.equal(claimed(answer, 'conv-a').subagent_calls, 2, 'the one with a subagent says so');
  assert.strictEqual(claimed(answer, 'conv-b').subagent_calls, 0, 'and the one without says 0, a number');
  assert.equal(claimed(answer, 'conv-b').calls, 2);
  assert.match(lineOf(stdout, 'conv-a'), /of which subagents: 2 calls/);
  assert.doesNotMatch(lineOf(stdout, 'conv-b'), /subagent/i, 'nothing about subagents when there were none');
});

test('S3 a subagent\'s tokens stay with the model it ran on, and its model and effort are the conversation\'s too', async (t) => {
  // The parent ran on claude-opus-5 at high, the subagent on claude-haiku-4-5 at low.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [
      claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', model: 'claude-opus-5', effort: 'high', input: 100, output: 10 }),
      claudeCall({ when: at(9, 9), request: 'req-2', message: 'msg-2', model: 'claude-opus-5', effort: 'high', input: 5, output: 1 }),
    ],
  });
  await plantSubagent(box, home, {
    parent: 'conv-a',
    agent: 'a1b2c3',
    started: at(9, 2),
    lines: [
      claudeCall({ when: at(9, 3), request: 'req-s1', message: 'msg-s1', model: 'claude-haiku-4-5', effort: 'low', input: 900, cacheRead: 40, output: 90 }),
      claudeCall({ when: at(9, 4), request: 'req-s2', message: 'msg-s2', model: 'claude-haiku-4-5', effort: 'low', input: 70, output: 7 }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const conversation = claimed(await usage(box), 'conv-a');

  const opus = modelOf(conversation, 'claude-opus-5');
  const haiku = modelOf(conversation, 'claude-haiku-4-5');
  assert.equal(opus.calls, 2);
  assert.equal(tokensOf(opus).input, 105, 'the parent\'s own, and none of the subagent\'s');
  assert.equal(tokensOf(opus).output, 11);
  assert.equal(haiku.calls, 2);
  assert.equal(tokensOf(haiku).input, 970, 'the subagent\'s, on the model it ran on');
  assert.equal(tokensOf(haiku).cache_read, 40);
  assert.equal(tokensOf(haiku).output, 97);
  assert.deepEqual([...conversation.models].sort(), ['claude-haiku-4-5', 'claude-opus-5']);
  assert.deepEqual([...conversation.efforts].sort(), ['high', 'low']);
});

test('S3 a subagent\'s call after the parent\'s last one is the conversation\'s last', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [
      claudeCall({ when: at(9, 10), request: 'req-1', message: 'msg-1', input: 1, output: 1 }),
      claudeCall({ when: at(9, 20), request: 'req-2', message: 'msg-2', input: 1, output: 1 }),
    ],
  });
  await plantSubagent(box, home, {
    parent: 'conv-a',
    agent: 'a1b2c3',
    started: at(9, 21),
    lines: [
      claudeCall({ when: at(9, 25), request: 'req-s1', message: 'msg-s1', input: 1, output: 1 }),
      claudeCall({ when: at(9, 30), request: 'req-s2', message: 'msg-s2', input: 1, output: 1 }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const conversation = claimed(await usage(box), 'conv-a');

  assert.equal(Date.parse(conversation.first), Date.parse(at(9, 10)), `got: ${conversation.first}`);
  assert.equal(Date.parse(conversation.last), Date.parse(at(9, 30)), `the subagent's last call, got: ${conversation.last}`);
});

test('S4 a call written into two subagent files of one conversation is counted once', async (t) => {
  // Seen on real data. agent-a1 and agent-b2 both carry req-shared, with the
  // same figures; each also has a call of its own.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 1000, output: 100 })],
  });
  const shared = claudeCall({ when: at(9, 5), request: 'req-shared', message: 'msg-shared', input: 40, cacheRead: 400, output: 4 });
  await plantSubagent(box, home, {
    parent: 'conv-a',
    agent: 'a1',
    started: at(9, 2),
    lines: [shared, claudeCall({ when: at(9, 6), request: 'req-a', message: 'msg-a', input: 20, output: 2 })],
  });
  await plantSubagent(box, home, {
    parent: 'conv-a',
    agent: 'b2',
    started: at(9, 2),
    lines: [shared, claudeCall({ when: at(9, 7), request: 'req-b', message: 'msg-b', input: 30, output: 3 })],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const conversation = claimed(await usage(box), 'conv-a');

  assert.equal(conversation.calls, 4, 'the parent\'s, the shared one once, and one of each file\'s own');
  assert.equal(conversation.subagent_calls, 3);
  assert.equal(tokensOf(conversation).input, 1090, '1,000 + 40 + 20 + 30; not 1,130 with the shared call twice');
  assert.equal(tokensOf(conversation).cache_read, 400);
  assert.equal(tokensOf(conversation).output, 109);
});

test('S4 a call written into two subagent files counts by its later record, whichever file holds it', async (t) => {
  // Call X's later copy is in agent-a1, call Y's in agent-b2, so neither the
  // first file read nor the last one gives the right figures for both.
  // Output: X 300 (not 30) + Y 40 (not 4) = 340.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 1, output: 1000 })],
  });
  await plantSubagent(box, home, {
    parent: 'conv-a',
    agent: 'a1',
    started: at(9, 2),
    lines: [
      claudeCall({ when: at(9, 5, 30), request: 'req-x', message: 'msg-x', input: 2, output: 300 }),
      claudeCall({ when: at(9, 6, 10), request: 'req-y', message: 'msg-y', input: 3, output: 4 }),
    ],
  });
  await plantSubagent(box, home, {
    parent: 'conv-a',
    agent: 'b2',
    started: at(9, 2),
    lines: [
      claudeCall({ when: at(9, 5, 10), request: 'req-x', message: 'msg-x', input: 2, output: 30 }),
      claudeCall({ when: at(9, 6, 40), request: 'req-y', message: 'msg-y', input: 3, output: 40 }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const conversation = claimed(await usage(box), 'conv-a');

  assert.equal(conversation.calls, 3);
  assert.equal(conversation.subagent_calls, 2);
  assert.equal(tokensOf(conversation).output, 1340, '1,000, X\'s later 300 and Y\'s later 40');
  assert.equal(tokensOf(conversation).input, 6, '1 + 2 + 3, each call once');
});

test('S4 a call in both the main transcript and a subagent file is one call, counted by its later record', async (t) => {
  // Which of the two it counts as, the parent's or the subagent's, is not
  // pinned here; that it is one call, and its figures the later ones, is.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [
      claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 1000, output: 100 }),
      claudeCall({ when: at(9, 5), request: 'req-z', message: 'msg-z', input: 7, output: 10 }),
    ],
  });
  await plantSubagent(box, home, {
    parent: 'conv-a',
    agent: 'a1',
    started: at(9, 2),
    lines: [
      claudeCall({ when: at(9, 5, 30), request: 'req-z', message: 'msg-z', input: 7, output: 50 }),
      claudeCall({ when: at(9, 6), request: 'req-s', message: 'msg-s', input: 20, output: 2 }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const conversation = claimed(await usage(box), 'conv-a');

  assert.equal(conversation.calls, 3, 'req-1, req-z once, req-s');
  assert.equal(tokensOf(conversation).input, 1027, '1,000 + 7 + 20; not 1,034 with req-z twice');
  assert.equal(tokensOf(conversation).output, 152, '100 + z\'s later 50 + 2');
});

test('S4 copies of one call in subagent files at the very same moment count by the largest, whichever file holds it', async (t) => {
  // A call's records only grow (tech notes, section 2). Seen on real data:
  // one call at one moment with 8 output in one subagent file and 322 in
  // others. In conv-a the small copy is in the file that sorts last, in
  // conv-b in the one that sorts first; both count 322.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  const moment = '2026-09-20T09:05:00.123Z';
  for (const [id, small, large] of [['conv-a', 'zz', ['aa', 'bb']], ['conv-b', 'aa', ['bb', 'zz']]]) {
    await plant(box, 'claude', home, {
      id,
      started: at(9),
      lines: [claudeCall({ when: at(9, 1), request: `req-${id}`, message: `msg-${id}`, input: 1000, output: 1000 })],
    });
    await plantSubagent(box, home, {
      parent: id,
      agent: small,
      started: at(9, 2),
      lines: [claudeCall({ when: moment, request: `req-x-${id}`, message: `msg-x-${id}`, input: 2, cacheRead: 500, output: 8 })],
    });
    for (const agent of large) {
      await plantSubagent(box, home, {
        parent: id,
        agent,
        started: at(9, 2),
        lines: [claudeCall({ when: moment, request: `req-x-${id}`, message: `msg-x-${id}`, input: 2, cacheRead: 500, output: 322 })],
      });
    }
  }
  await bookSays(bots, 'api-bot', { daily: ran('conv-b', 'conv-a') });

  const answer = await usage(box);

  for (const id of ['conv-a', 'conv-b']) {
    const conversation = claimed(answer, id);
    assert.equal(conversation.calls, 2, `${id}: the parent's and X, once`);
    assert.equal(conversation.subagent_calls, 1, id);
    assert.equal(tokensOf(conversation).output, 1322, `${id}: 1,000 + X's 322; not its 8, nor the copies added up`);
    assert.equal(tokensOf(conversation).input, 1002, id);
    assert.equal(tokensOf(conversation).cache_read, 500, id);
  }
});

test('S4 copies of one call in the main transcript and a subagent file at the very same moment count by the largest', async (t) => {
  // In conv-a the main transcript has the small copy, in conv-b the subagent
  // file has it. Both count 322. Whose call it is, is not pinned here.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  const moment = '2026-09-20T09:05:00.123Z';
  for (const [id, mainOutput, subagentOutput] of [['conv-a', 8, 322], ['conv-b', 322, 8]]) {
    await plant(box, 'claude', home, {
      id,
      started: at(9),
      lines: [
        claudeCall({ when: at(9, 1), request: `req-${id}`, message: `msg-${id}`, input: 1000, output: 1000 }),
        claudeCall({ when: moment, request: `req-x-${id}`, message: `msg-x-${id}`, input: 2, output: mainOutput }),
      ],
    });
    await plantSubagent(box, home, {
      parent: id,
      agent: 'a1',
      started: at(9, 2),
      lines: [claudeCall({ when: moment, request: `req-x-${id}`, message: `msg-x-${id}`, input: 2, output: subagentOutput })],
    });
  }
  await bookSays(bots, 'api-bot', { daily: ran('conv-b', 'conv-a') });

  const answer = await usage(box);

  for (const id of ['conv-a', 'conv-b']) {
    const conversation = claimed(answer, id);
    assert.equal(conversation.calls, 2, `${id}: the parent's first call and X, once`);
    assert.equal(tokensOf(conversation).output, 1322, `${id}: 1,000 + X's 322`);
    assert.equal(tokensOf(conversation).input, 1002, id);
  }
});

test('S4 a broken copy at the very same moment as a whole one may be the last written, so a window that opens after them counts none of the call and names it', async (t) => {
  // One call: a whole copy at 09:30 with 10 output, a copy at the same 09:30
  // with its output missing, and a whole copy at 11:00 with 30. Which of the
  // two 09:30 copies was written last cannot be told from the time, so the
  // broken one is taken as the last written before 10:00 (U14's rule): from
  // 10:00 the 20 the call grew cannot be measured, is not counted, and is
  // named once. Four placements, one session each:
  //   one:   main transcript, whole copy first, broken second
  //   two:   main transcript, broken copy first, whole second
  //   three: whole copy in the main transcript, broken in a subagent file
  //   four:  broken copy in the main transcript, whole in a subagent file
  const sessions = ['one', 'two', 'three', 'four'];
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude', sessions });
  const copies = (id) => ({
    whole: claudeCall({ when: at(9, 30), request: `req-${id}`, message: `msg-${id}`, input: 2, cacheRead: 500, output: 10 }),
    broken: claudeCallAnd(
      { when: at(9, 30), request: `req-${id}`, message: `msg-${id}`, input: 2, cacheRead: 500 },
      { output_tokens: undefined },
    ),
    last: claudeCall({ when: at(11, 0), request: `req-${id}`, message: `msg-${id}`, input: 2, cacheRead: 500, output: 30 }),
  });
  const placed = {
    one: ({ whole, broken, last }) => ({ main: [whole, broken, last], subagent: [] }),
    two: ({ whole, broken, last }) => ({ main: [broken, whole, last], subagent: [] }),
    three: ({ whole, broken, last }) => ({ main: [whole, last], subagent: [broken] }),
    four: ({ whole, broken, last }) => ({ main: [broken, last], subagent: [whole] }),
  };
  for (const name of sessions) {
    const id = `conv-${name}`;
    const { main, subagent } = placed[name](copies(id));
    await plant(box, 'claude', home, { id, started: at(9), lines: main });
    if (subagent.length > 0) await plantSubagent(box, home, { parent: id, agent: 'a1', started: at(9, 29), lines: subagent });
  }
  await bookSays(bots, 'api-bot', Object.fromEntries(sessions.map((name) => [name, ran(`conv-${name}`)])));

  const after = entryOf(await usage(box, '--since', at(10)), 'api-bot');
  const whole = entryOf(await usage(box), 'api-bot');

  for (const name of sessions) {
    const late = sessionOf(after, name);
    assert.deepEqual(conversationsOf(late), [], `${name}: from 10:00 no row, not the 20 grown since the whole 09:30 copy`);
    assert.deepEqual(leftOutOf(late), leftOut({ records_without_numbers: 1 }), `${name}: and the call is named once`);

    const all = sessionOf(whole, name);
    assert.deepEqual(leftOutOf(all), leftOut({ records_without_numbers: 1 }), `${name}: with no window, the broken copy is named`);
    const conversation = conversationOf(conversationsOf(all), `conv-${name}`);
    assert.equal(conversation.calls, 1, `${name}: and the call counted once`);
    assert.equal(tokensOf(conversation).output, 30, `${name}: by its last copy`);
  }
  assert.deepEqual(leftOutOf(after, 'unclaimed_not_counted'), NOTHING_LEFT_OUT);
});

test('S5 --since and --until count a subagent\'s calls by their own time, as the main transcript\'s', async (t) => {
  // Subagent calls at 09:59, 10:00, 10:30 and 11:00, a parent call at 10:15.
  // The window 10:00 to 11:00 is half open: 10:00 and 10:30 are in it.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9, 50),
    lines: [claudeCall({ when: at(10, 15), request: 'req-1', message: 'msg-1', input: 1000, output: 100 })],
  });
  await plantSubagent(box, home, {
    parent: 'conv-a',
    agent: 'a1',
    started: at(9, 55),
    lines: [
      claudeCall({ when: at(9, 59), request: 'req-s1', message: 'msg-s1', input: 1, output: 1 }),
      claudeCall({ when: at(10, 0), request: 'req-s2', message: 'msg-s2', input: 20, output: 2 }),
      claudeCall({ when: at(10, 30), request: 'req-s3', message: 'msg-s3', input: 300, output: 3 }),
      claudeCall({ when: at(11, 0), request: 'req-s4', message: 'msg-s4', input: 4000, output: 4 }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const windowed = claimed(await usage(box, '--since', at(10), '--until', at(11)), 'conv-a');
  const whole = claimed(await usage(box), 'conv-a');

  assert.equal(windowed.calls, 3, 'the parent\'s, and the subagent\'s at 10:00 and 10:30');
  assert.equal(windowed.subagent_calls, 2);
  assert.equal(tokensOf(windowed).input, 1320);
  assert.equal(tokensOf(windowed).output, 105);
  assert.equal(whole.calls, 5, 'with no window, all of them');
  assert.equal(whole.subagent_calls, 4);
  assert.equal(tokensOf(whole).input, 5321);
});

test('S5 a conversation whose only calls in the window are its subagent\'s is still reported', async (t) => {
  // The parent's own calls are at 09:01; the subagent's at 10:10 and 10:20.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 1000, output: 100 })],
  });
  await plantSubagent(box, home, {
    parent: 'conv-a',
    agent: 'a1',
    started: at(10, 5),
    lines: [
      claudeCall({ when: at(10, 10), request: 'req-s1', message: 'msg-s1', input: 20, output: 2 }),
      claudeCall({ when: at(10, 20), request: 'req-s2', message: 'msg-s2', input: 30, output: 3 }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const conversation = claimed(await usage(box, '--since', at(10)), 'conv-a');

  assert.equal(conversation.calls, 2);
  assert.equal(conversation.subagent_calls, 2);
  assert.equal(tokensOf(conversation).input, 50);
  assert.equal(tokensOf(conversation).output, 5);
});

test('S5 a subagent call made before --since and grown after it is a subagent call only in the window it was made in', async (t) => {
  // Rule 4 with U13's rule. X is written at 09:59:59.500 with 16 output and
  // again at 10:00:00.300, finished, with 301. It was made before 10:00, so
  // from 10:00 it is not a call, of anyone's, though the 285 it grew there
  // are that window's tokens. Before 10:00 it is one call, and one
  // subagent call, at what it had reached. The parent's req-2 at 10:15 gives
  // the later window a call of its own, so it has a row to read.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [
      claudeCall({ when: at(9, 0), request: 'req-1', message: 'msg-1', input: 1000, output: 100 }),
      claudeCall({ when: at(10, 15), request: 'req-2', message: 'msg-2', input: 30, output: 3 }),
    ],
  });
  await plantSubagent(box, home, {
    parent: 'conv-a',
    agent: 'a1',
    started: at(9, 59),
    lines: [
      claudeCall({ when: '2026-09-20T09:59:59.500Z', request: 'req-x', message: 'msg-x', input: 2, cacheRead: 5000, output: 16 }),
      claudeCall({ when: '2026-09-20T10:00:00.300Z', request: 'req-x', message: 'msg-x', input: 2, cacheRead: 5000, output: 301 }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const before = claimed(await usage(box, '--until', at(10)), 'conv-a');
  const after = claimed(await usage(box, '--since', at(10)), 'conv-a');

  assert.equal(before.calls, 2, 'req-1 and X, made before 10:00');
  assert.equal(before.subagent_calls, 1, 'X is the subagent\'s');
  assert.equal(tokensOf(before).output, 116, '100 + X\'s 16 as it stood then');
  assert.equal(tokensOf(before).cache_read, 5000);

  assert.equal(after.calls, 1, 'req-2 alone: X was made before the window');
  assert.equal(after.subagent_calls, 0, 'so X is not a subagent call here either');
  assert.equal(tokensOf(after).output, 288, 'req-2\'s 3 and the 285 X grew after 10:00');
  assert.equal(tokensOf(after).cache_read, 0, 'X\'s cache reads were the earlier window\'s');
  assert.equal(tokensOf(after).input, 30);
});

test('S6 a broken line, a record without numbers and an undated record in a subagent file are reported under the session, and left out', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 3, output: 4 })],
  });
  const file = await plantSubagent(box, home, {
    parent: 'conv-a',
    agent: 'a1',
    started: at(9, 2),
    lines: [
      claudeCall({ when: at(9, 3), request: 'req-s1', message: 'msg-s1', input: 20, output: 2 }),
      claudeCallAnd({ when: at(9, 4), request: 'req-s2', message: 'msg-s2', input: 5000, output: 5000 }, { output_tokens: undefined }),
      claudeCall({ when: undefined, request: 'req-s3', message: 'msg-s3', input: 6000, output: 6000 }),
    ],
  });
  await slipIn(file, 2, TORN);
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const entry = entryOf(await usage(box), 'api-bot');
  const session = sessionOf(entry, 'daily');

  assert.deepEqual(
    leftOutOf(session),
    leftOut({ broken_lines: 1, records_without_numbers: 1, records_without_time: 1 }),
    'each of the three is named, once, under the session',
  );
  assert.deepEqual(leftOutOf(entry, 'unclaimed_not_counted'), NOTHING_LEFT_OUT, 'and none of it is laid at the unclaimed door');
  const conversation = conversationOf(conversationsOf(session), 'conv-a');
  assert.equal(conversation.calls, 2, 'the parent\'s and the subagent\'s one good call');
  assert.equal(conversation.subagent_calls, 1);
  assert.equal(tokensOf(conversation).input, 23);
  assert.equal(tokensOf(conversation).output, 6);
});

test('S6 an unreadable subagent file is reported under the session, and the rest still counts', { skip: UNREADABLE_NEEDS_A_USER }, async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 3, output: 4 })],
  });
  const locked = await plantSubagent(box, home, {
    parent: 'conv-a',
    agent: 'a1',
    started: at(9, 2),
    lines: [claudeCall({ when: at(9, 3), request: 'req-s1', message: 'msg-s1', input: 9000, output: 900 })],
  });
  await chmod(locked, 0o000);
  await plantSubagent(box, home, {
    parent: 'conv-a',
    agent: 'b2',
    started: at(9, 2),
    lines: [claudeCall({ when: at(9, 4), request: 'req-s2', message: 'msg-s2', input: 20, output: 2 })],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const entry = entryOf(await usage(box), 'api-bot');
  const session = sessionOf(entry, 'daily');

  assert.deepEqual(leftOutOf(session), leftOut({ unreadable_transcripts: 1 }));
  assert.deepEqual(leftOutOf(entry, 'unclaimed_not_counted'), NOTHING_LEFT_OUT);
  const conversation = conversationOf(conversationsOf(session), 'conv-a');
  assert.equal(conversation.calls, 2, 'the parent\'s and the readable subagent\'s');
  assert.equal(conversation.subagent_calls, 1);
  assert.equal(tokensOf(conversation).input, 23);
});

test('S6 a subagents folder that cannot be listed is reported as unreadable under the session, and the main transcript still counts', { skip: UNREADABLE_NEEDS_A_USER }, async (t) => {
  // conv-a, daily's, has a subagents folder nobody may list; conv-b,
  // review's, has no subagents folder at all, which is nothing to report.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude', sessions: ['daily', 'review'] });
  for (const id of ['conv-a', 'conv-b']) {
    await plant(box, 'claude', home, {
      id,
      started: at(9),
      lines: [claudeCall({ when: at(9, 1), request: `req-${id}`, message: `msg-${id}`, input: 30, output: 3 })],
    });
  }
  const file = await plantSubagent(box, home, {
    parent: 'conv-a',
    agent: 'a1',
    started: at(9, 2),
    lines: [claudeCall({ when: at(9, 3), request: 'req-s1', message: 'msg-s1', input: 9000, output: 900 })],
  });
  const folder = path.dirname(file);
  await bookSays(bots, 'api-bot', { daily: ran('conv-a'), review: ran('conv-b') });

  await chmod(folder, 0o000);
  let answer;
  try {
    answer = await usage(box);
  } finally {
    await chmod(folder, 0o755);
  }
  const entry = entryOf(answer, 'api-bot');

  assert.deepEqual(leftOutOf(sessionOf(entry, 'daily')), leftOut({ unreadable_transcripts: 1 }), 'the folder is named, not taken as empty');
  assert.deepEqual(leftOutOf(sessionOf(entry, 'review')), NOTHING_LEFT_OUT, 'no subagents folder is nothing left out');
  assert.deepEqual(leftOutOf(entry, 'unclaimed_not_counted'), NOTHING_LEFT_OUT);
  const conversation = claimed(answer, 'conv-a');
  assert.equal(conversation.calls, 1, 'its own call still counts');
  assert.equal(tokensOf(conversation).input, 30);
  assert.equal(conversation.subagent_calls, 0);
});

test('S6 a subagents folder that cannot be listed, of a conversation no session claims, is the bot\'s unclaimed unreadable', { skip: UNREADABLE_NEEDS_A_USER }, async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  for (const id of ['conv-a', 'conv-nobodys']) {
    await plant(box, 'claude', home, {
      id,
      started: at(9),
      lines: [claudeCall({ when: at(9, 1), request: `req-${id}`, message: `msg-${id}`, input: 30, output: 3 })],
    });
  }
  const file = await plantSubagent(box, home, {
    parent: 'conv-nobodys',
    agent: 'a1',
    started: at(9, 2),
    lines: [claudeCall({ when: at(9, 3), request: 'req-s1', message: 'msg-s1', input: 9000, output: 900 })],
  });
  const folder = path.dirname(file);
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  await chmod(folder, 0o000);
  let answer;
  try {
    answer = await usage(box);
  } finally {
    await chmod(folder, 0o755);
  }
  const entry = entryOf(answer, 'api-bot');

  assert.deepEqual(leftOutOf(entry, 'unclaimed_not_counted'), leftOut({ unreadable_transcripts: 1 }));
  assert.deepEqual(leftOutOf(sessionOf(entry, 'daily')), NOTHING_LEFT_OUT);
  const nobodys = conversationOf(entry.unclaimed, 'conv-nobodys');
  assert.equal(nobodys.calls, 1, 'its own call still counts');
  assert.equal(tokensOf(nobodys).input, 30);
});

test('S6 the .meta.json beside a subagent file is neither counted nor reported, however it is written', async (t) => {
  // One subagent's meta file on one line, the other's over several: read as
  // a transcript, the second would be broken lines.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 3, output: 4 })],
  });
  await plantSubagent(box, home, {
    parent: 'conv-a',
    agent: 'a1',
    started: at(9, 2),
    lines: [claudeCall({ when: at(9, 3), request: 'req-s1', message: 'msg-s1', input: 20, output: 2 })],
  });
  await plantSubagent(box, home, {
    parent: 'conv-a',
    agent: 'b2',
    started: at(9, 2),
    prettyMeta: true,
    lines: [claudeCall({ when: at(9, 4), request: 'req-s2', message: 'msg-s2', input: 30, output: 3 })],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const entry = entryOf(await usage(box), 'api-bot');
  const session = sessionOf(entry, 'daily');

  assert.deepEqual(leftOutOf(session), NOTHING_LEFT_OUT, 'no meta file is a gap');
  assert.deepEqual(leftOutOf(entry, 'unclaimed_not_counted'), NOTHING_LEFT_OUT);
  const conversation = conversationOf(conversationsOf(session), 'conv-a');
  assert.equal(conversation.calls, 3, 'the parent\'s and one of each subagent\'s');
  assert.equal(conversation.subagent_calls, 2);
  assert.equal(tokensOf(conversation).input, 53);
});

test('S6 a gap in a subagent file of a conversation no session claims is the bot\'s unclaimed, and no session\'s', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 3, output: 4 })],
  });
  await plant(box, 'claude', home, {
    id: 'conv-nobodys',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-9', message: 'msg-9', input: 3, output: 4 })],
  });
  const file = await plantSubagent(box, home, {
    parent: 'conv-nobodys',
    agent: 'a1',
    started: at(9, 2),
    lines: [claudeCall({ when: at(9, 3), request: 'req-s1', message: 'msg-s1', input: 20, output: 2 })],
  });
  await slipIn(file, 2, TORN);
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const entry = entryOf(await usage(box), 'api-bot');

  assert.deepEqual(leftOutOf(entry, 'unclaimed_not_counted'), leftOut({ broken_lines: 1 }));
  assert.deepEqual(leftOutOf(sessionOf(entry, 'daily')), NOTHING_LEFT_OUT);
});

test('S7 a conversation no session claims is reported under unclaimed with its subagent calls', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  await plant(box, 'claude', home, {
    id: 'conv-a',
    started: at(9),
    lines: [claudeCall({ when: at(9, 1), request: 'req-1', message: 'msg-1', input: 3, output: 4 })],
  });
  await plant(box, 'claude', home, {
    id: 'conv-nobodys',
    started: at(11),
    lines: [claudeCall({ when: at(11, 1), request: 'req-9', message: 'msg-9', input: 640, output: 21 })],
  });
  await plantSubagent(box, home, {
    parent: 'conv-nobodys',
    agent: 'a1',
    started: at(11, 2),
    lines: [
      claudeCall({ when: at(11, 3), request: 'req-s1', message: 'msg-s1', input: 50, cacheRead: 55, output: 5 }),
      claudeCall({ when: at(11, 4), request: 'req-s2', message: 'msg-s2', input: 7, output: 6 }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const entry = entryOf(await usage(box), 'api-bot');

  const nobodys = conversationOf(entry.unclaimed, 'conv-nobodys');
  assert.equal(nobodys.calls, 3);
  assert.equal(nobodys.subagent_calls, 2);
  assert.equal(tokensOf(nobodys).input, 697);
  assert.equal(tokensOf(nobodys).cache_read, 55);
  assert.equal(tokensOf(nobodys).output, 32);
  assert.equal(conversationOf(conversationsOf(sessionOf(entry, 'daily')), 'conv-a').calls, 1, 'and conv-a has none of them');
});

test('S8 a subagent is never reported as a conversation of its own, claimed or unclaimed', async (t) => {
  // Two subagents under the claimed conv-a, one under the unclaimed
  // conv-nobodys. The only conversations are those two.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude' });
  for (const id of ['conv-a', 'conv-nobodys']) {
    await plant(box, 'claude', home, {
      id,
      started: at(9),
      lines: [claudeCall({ when: at(9, 1), request: `req-${id}`, message: `msg-${id}`, input: 3, output: 4 })],
    });
  }
  for (const [parent, agent] of [['conv-a', 'a1'], ['conv-a', 'b2'], ['conv-nobodys', 'c3']]) {
    await plantSubagent(box, home, {
      parent,
      agent,
      started: at(9, 2),
      lines: [claudeCall({ when: at(9, 3), request: `req-${agent}`, message: `msg-${agent}`, input: 1, output: 1 })],
    });
  }
  await bookSays(bots, 'api-bot', { daily: ran('conv-a') });

  const entry = entryOf(await usage(box), 'api-bot');

  assert.deepEqual(idsOf(conversationsOf(sessionOf(entry, 'daily'))), ['conv-a']);
  assert.deepEqual(idsOf(entry.unclaimed), ['conv-nobodys'], 'no a1, b2 or c3, nor agent-a1 and the like');
  assert.equal(conversationOf(conversationsOf(sessionOf(entry, 'daily')), 'conv-a').subagent_calls, 2);
  assert.equal(conversationOf(entry.unclaimed, 'conv-nobodys').subagent_calls, 1);
});

test('S9 each conversation counts its own subagents and no other conversation\'s', async (t) => {
  // Two sessions of one bot, so one Claude project folder: conv-a's subagent
  // made two calls, conv-b's three.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'claude', sessions: ['daily', 'review'] });
  for (const id of ['conv-a', 'conv-b']) {
    await plant(box, 'claude', home, {
      id,
      started: at(9),
      lines: [claudeCall({ when: at(9, 1), request: `req-${id}`, message: `msg-${id}`, input: 1000, output: 100 })],
    });
  }
  await plantSubagent(box, home, {
    parent: 'conv-a',
    agent: 'a1',
    started: at(9, 2),
    lines: [1, 2].map((n) => claudeCall({ when: at(9, 2 + n), request: `req-a${n}`, message: `msg-a${n}`, input: 10, output: 1 })),
  });
  await plantSubagent(box, home, {
    parent: 'conv-b',
    agent: 'b1',
    started: at(9, 2),
    lines: [1, 2, 3].map((n) => claudeCall({ when: at(9, 2 + n), request: `req-b${n}`, message: `msg-b${n}`, input: 20, output: 2 })),
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-a'), review: ran('conv-b') });

  const answer = await usage(box);
  const a = claimed(answer, 'conv-a', 'daily');
  const b = claimed(answer, 'conv-b', 'review');

  assert.equal(a.calls, 3);
  assert.equal(a.subagent_calls, 2);
  assert.equal(tokensOf(a).input, 1020);
  assert.equal(b.calls, 4);
  assert.equal(b.subagent_calls, 3);
  assert.equal(tokensOf(b).input, 1060);
});

// ------------------------------------------------ B. Codex, a figure alone (#302)

test('C1 #302 done-check: a figure-only Codex event followed by a whole total is not counted, is reported, and never counted twice', async (t) => {
  // A is a call, 1,000 in and 100 out. L has only its own figure, 200/20, and
  // no running total. C's whole total rose by exactly L's figure, so whether
  // C is L written down again or a call of its own cannot be told: neither is
  // counted, both are named. D is measured by its rise from C: 300/30.
  // Today L counts by its own figure and C's rise counts it again: 4 calls.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex' });
  await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: at(9) }),
      codexCall({ when: at(9, 0), last: { input: 1000, output: 100 }, total: { input: 1000, output: 100 } }),
      codexLastOnly(at(9, 10), { input: 200, output: 20 }),
      codexCall({ when: at(9, 20), last: { input: 200, output: 20 }, total: { input: 1200, output: 120 } }),
      codexCall({ when: at(9, 30), last: { input: 300, output: 30 }, total: { input: 1500, output: 150 } }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-c') });

  const session = sessionOf(entryOf(await usage(box), 'api-bot'), 'daily');

  assert.deepEqual(leftOutOf(session), leftOut({ records_without_numbers: 2 }), 'L and C');
  const conversation = conversationOf(conversationsOf(session), 'conv-c');
  assert.equal(conversation.calls, 2, 'A and D');
  assert.equal(tokensOf(conversation).input, 1300, '1,000 + D\'s rise of 300; not 1,700 with L\'s 200 twice');
  assert.equal(tokensOf(conversation).output, 130);
});

test('C1 a figure-only Codex event whose running total is null is treated the same', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex' });
  await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: at(9) }),
      codexCall({ when: at(9, 0), last: { input: 1000, output: 100 }, total: { input: 1000, output: 100 } }),
      codexLastAndNullTotal(at(9, 10), { input: 200, output: 20 }),
      codexCall({ when: at(9, 20), last: { input: 200, output: 20 }, total: { input: 1200, output: 120 } }),
      codexCall({ when: at(9, 30), last: { input: 300, output: 30 }, total: { input: 1500, output: 150 } }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-c') });

  const session = sessionOf(entryOf(await usage(box), 'api-bot'), 'daily');

  assert.deepEqual(leftOutOf(session), leftOut({ records_without_numbers: 2 }), 'L and C');
  const conversation = conversationOf(conversationsOf(session), 'conv-c');
  assert.equal(conversation.calls, 2, 'A and D');
  assert.equal(tokensOf(conversation).input, 1300);
  assert.equal(tokensOf(conversation).output, 130);
});

test('C2 a figure-only Codex event as the first of its rollout is not counted, nor is the whole total after it', async (t) => {
  // No running total before L at all. C's total, 200/20, is L's figure again
  // as far as anyone can tell. D is its rise from C: 300/30.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex' });
  await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: at(9) }),
      codexLastOnly(at(9, 10), { input: 200, output: 20 }),
      codexCall({ when: at(9, 20), last: { input: 200, output: 20 }, total: { input: 200, output: 20 } }),
      codexCall({ when: at(9, 30), last: { input: 300, output: 30 }, total: { input: 500, output: 50 } }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-c') });

  const session = sessionOf(entryOf(await usage(box), 'api-bot'), 'daily');

  assert.deepEqual(leftOutOf(session), leftOut({ records_without_numbers: 2 }), 'L and C');
  const conversation = conversationOf(conversationsOf(session), 'conv-c');
  assert.equal(conversation.calls, 1, 'D alone');
  assert.equal(tokensOf(conversation).input, 300);
  assert.equal(tokensOf(conversation).output, 30);
});

test('C3 a figure-only Codex event and the whole total after it are each reported only in a window that holds their time', async (t) => {
  // A 09:00, L 09:10, C 10:30, D 11:00. Before 10:00: A counted, L named.
  // From 10:00: C named, D counted by its rise from C, 300/30.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex' });
  await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: at(9) }),
      codexCall({ when: at(9, 0), last: { input: 1000, output: 100 }, total: { input: 1000, output: 100 } }),
      codexLastOnly(at(9, 10), { input: 200, output: 20 }),
      codexCall({ when: at(10, 30), last: { input: 200, output: 20 }, total: { input: 1200, output: 120 } }),
      codexCall({ when: at(11, 0), last: { input: 300, output: 30 }, total: { input: 1500, output: 150 } }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-c') });

  const early = sessionOf(entryOf(await usage(box, '--until', at(10)), 'api-bot'), 'daily');
  const late = sessionOf(entryOf(await usage(box, '--since', at(10)), 'api-bot'), 'daily');

  const before = conversationOf(conversationsOf(early), 'conv-c');
  assert.equal(before.calls, 1, 'A, and not L');
  assert.equal(tokensOf(before).input, 1000);
  assert.equal(tokensOf(before).output, 100);
  assert.deepEqual(leftOutOf(early), leftOut({ records_without_numbers: 1 }), 'L');

  const after = conversationOf(conversationsOf(late), 'conv-c');
  assert.equal(after.calls, 1, 'D, and not C');
  assert.equal(tokensOf(after).input, 300);
  assert.equal(tokensOf(after).output, 30);
  assert.deepEqual(leftOutOf(late), leftOut({ records_without_numbers: 1 }), 'C');
});

test('C4 an undated figure-only Codex event is named as without time, and the whole total after it is still not counted', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box, { harness: 'codex' });
  await plant(box, 'codex', home, {
    id: 'conv-c',
    started: at(9),
    lines: [
      codexTurn({ when: at(9) }),
      codexCall({ when: at(9, 0), last: { input: 1000, output: 100 }, total: { input: 1000, output: 100 } }),
      codexLastOnly(undefined, { input: 200, output: 20 }),
      codexCall({ when: at(9, 20), last: { input: 200, output: 20 }, total: { input: 1200, output: 120 } }),
      codexCall({ when: at(9, 30), last: { input: 300, output: 30 }, total: { input: 1500, output: 150 } }),
    ],
  });
  await bookSays(bots, 'api-bot', { daily: ran('conv-c') });

  const session = sessionOf(entryOf(await usage(box), 'api-bot'), 'daily');

  assert.deepEqual(
    leftOutOf(session),
    leftOut({ records_without_numbers: 1, records_without_time: 1 }),
    'C without numbers, L without time',
  );
  const conversation = conversationOf(conversationsOf(session), 'conv-c');
  assert.equal(conversation.calls, 2, 'A and D');
  assert.equal(tokensOf(conversation).input, 1300);
  assert.equal(tokensOf(conversation).output, 130);
});
