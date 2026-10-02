// `obk usage` counts a Codex session's spawned subagents, and Codex's own
// auto-reviews of it, under that session (#449).
//
// A Codex conversation can hand work to subagents of its own, each a rollout
// of its own whose `session_meta` names the conversation that spawned it:
// `payload.source = { subagent: { thread_spawn: { parent_thread_id, depth, … } } }`
// (seen in the issue's rollouts). Codex's automatic reviewer is a rollout of
// its own too, `payload.source = { subagent: { other: 'guardian' } }`, with the
// conversation it reviewed as a top-level `payload.parent_thread_id` (seen on
// kit-dev's own 71 such rollouts). Both were listed as unclaimed, nobody's,
// though each names its parent.
//
// What is wanted, as #371 has it for a Claude session's subagents:
//
//   1. A rollout whose parent (`source.subagent.thread_spawn.parent_thread_id`,
//      or a top-level `parent_thread_id`) is a conversation the book names
//      under a session counts in that conversation's row: its calls in
//      `calls`, as `subagent_calls`, its tokens in the row's and in `by_model`
//      under the model it ran on. It is not listed as unclaimed.
//   2. A child of a child counts toward the same conversation.
//   3. A guardian review of a book conversation counts in that conversation's
//      row too, apart from the subagents: as `review_calls`, not
//      `subagent_calls`. The plain line says how many, as it says the
//      subagents' ("of which …"), the words not pinned beyond "auto-review".
//      Read here as #371's "of which": its calls are among the row's `calls`
//      and its tokens among the row's.
//   4. A child whose parent no session claims stays unclaimed: no parent is
//      guessed from timing or folder.
//   5. Each child counts from its own records, its first record by its own
//      figure: a running total that starts with its parent's inside it does
//      not count the parent's again.
//
// The figures are chosen so that each wrong reading gives an answer of its
// own: the parent's own two calls are 3,000 in and 300 out; the child's own two
// are 80,000 and 8,000, its first record's running total 33,000 and 3,300
// (the parent's 3,000 and 300 inside it); the grandchild's one is 700 and 70;
// the review's two are 1,000 and 100.
//
// Every rollout is planted in the sandbox's own home. Nothing reads the real
// `~/.codex`. The helpers are copied from usage-forks.test.js and
// usage-subagents.test.js, so that importing them does not run their tests.

import assert from 'node:assert/strict';
import { mkdir, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { stringify } from 'yaml';

import { bookOf, botHomeOf, createSandbox } from './helpers/cli.js';

/** A moment on the day these tests are set, as Codex writes one. */
const at = (hour, minute = 0) => `2026-09-20T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;

/** Conversation ids, shaped as Codex shapes them. */
const PARENT = '01a0e043-c965-72e0-bbd2-d4aab8723065';
const CHILD = '01a0eb56-fbd3-7d51-9969-1a544fb42407';
const GRANDCHILD = '01a0eb57-20b9-7280-9038-0a917cf26659';
const REVIEW = '01a0e661-82e1-7e40-9759-cfc3d900798c';
/** A conversation of the bot's folder that no session claims. */
const STRANGER = '01a0e7f2-857a-7433-8668-cdd32b17475f';
/** A conversation no rollout on disk is of. */
const GONE = '01a0e000-0000-7000-8000-00000000dead';

// ---------------------------------------------------------------- the fleet

/** A bots folder with api-bot on Codex and its daily session, nothing opened in Orca. */
async function fleet(box) {
  const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(init.code, 0, init.stderr);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'codex']);
  assert.equal(made.code, 0, made.stderr);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily']);
  assert.equal(added.code, 0, added.stderr);
  const bots = box.path('bots');
  return { bots, home: botHomeOf(bots, 'api-bot') };
}

/** The book of api-bot, its daily session in `conversation`. */
const bookSays = (bots, conversation) => writeFile(bookOf(bots, 'api-bot'), stringify({
  orca: { project: 'proj-1', setup: 'setup-1' },
  sessions: { daily: { tab: 'tab-daily', launched: at(8), session: conversation } },
}));

// ------------------------------------------------- what Codex writes down

/** A Codex usage record. */
const codexTokens = ({ input = 0, output = 0 }) => ({
  input_tokens: input,
  cached_input_tokens: 0,
  cache_write_input_tokens: 0,
  output_tokens: output,
  reasoning_output_tokens: 0,
  total_tokens: input + output,
});

/** One Codex API call: what it used, and the running total for the conversation after it. */
const codexCall = ({ when, last, total }) => ({
  timestamp: when,
  type: 'event_msg',
  payload: { type: 'token_count', info: { last_token_usage: codexTokens(last), total_token_usage: codexTokens(total), model_context_window: 190000 } },
});

/** What Codex was set to for the turns that follow. */
const codexTurn = ({ when, model, effort }) => ({ timestamp: when, type: 'turn_context', payload: { model, effort, approval_policy: 'on-request' } });

/** A subagent `parent` spawned, at `depth`, as the issue's rollouts mark one: in `source` alone. */
const spawnedBy = (parent, depth = 1) => ({
  source: { subagent: { thread_spawn: { parent_thread_id: parent, depth, agent_path: 'worker', agent_nickname: 'Mendel', agent_role: 'default' } } },
});

/** Codex's own reviewer of `parent`, as kit-dev's rollouts mark one: a top-level parent_thread_id. */
const reviewOf = (parent) => ({
  source: { subagent: { other: 'guardian' } },
  parent_thread_id: parent,
  session_id: parent,
  subagent_history_start_ordinal: 0,
  multi_agent_version: 1,
});

/**
 * Plant a rollout where Codex keeps it, in the sandbox's home, filed by its
 * day: its first line the `session_meta` with the id, the bot home as its
 * folder, its time and `meta`; then a turn on `model` and `effort`, then `calls`.
 */
async function plantRollout(box, home, { id, started, meta = {}, model, effort, calls }) {
  const file = path.join(
    box.home, '.codex', 'sessions', ...started.slice(0, 10).split('-'),
    `rollout-${started.replaceAll(':', '-').replace(/\..*$/, '')}-${id}.jsonl`,
  );
  const lines = [
    { timestamp: started, type: 'session_meta', payload: { id, cwd: home, timestamp: started, ...meta } },
    codexTurn({ when: started, model, effort }),
    ...calls.map(codexCall),
  ];
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  const last = new Date(Math.max(...lines.map((line) => Date.parse(line.timestamp))));
  await utimes(file, last, last);
  return file;
}

/** The parent: the daily session's own conversation on gpt-6-astra, two calls, 3,000 in and 300 out. */
const plantParent = (box, home, id = PARENT) => plantRollout(box, home, {
  id,
  started: at(9),
  meta: { source: 'cli' },
  model: 'gpt-6-astra',
  effort: 'high',
  calls: [
    { when: at(9, 1), last: { input: 1000, output: 100 }, total: { input: 1000, output: 100 } },
    { when: at(9, 2), last: { input: 2000, output: 200 }, total: { input: 3000, output: 300 } },
  ],
});

/**
 * A child on gpt-6-sol: two calls of its own, 30,000/3,000 and 50,000/5,000,
 * its running totals starting with its parent's 3,000/300 inside them.
 */
const plantChild = (box, home, meta, id = CHILD) => plantRollout(box, home, {
  id,
  started: at(10),
  meta,
  model: 'gpt-6-sol',
  effort: 'medium',
  calls: [
    { when: at(10, 1), last: { input: 30000, output: 3000 }, total: { input: 33000, output: 3300 } },
    { when: at(10, 2), last: { input: 50000, output: 5000 }, total: { input: 83000, output: 8300 } },
  ],
});

/** A grandchild on gpt-6-luna: one call, 700/70. */
const plantGrandchild = (box, home) => plantRollout(box, home, {
  id: GRANDCHILD,
  started: at(11),
  meta: spawnedBy(CHILD, 2),
  model: 'gpt-6-luna',
  effort: 'low',
  calls: [{ when: at(11, 1), last: { input: 700, output: 70 }, total: { input: 700, output: 70 } }],
});

/** A guardian review on codex-auto-review: two calls, 400/40 and 600/60. */
const plantReview = (box, home, parent, id = REVIEW) => plantRollout(box, home, {
  id,
  started: at(12),
  meta: reviewOf(parent),
  model: 'codex-auto-review',
  effort: 'low',
  calls: [
    { when: at(12, 1), last: { input: 400, output: 40 }, total: { input: 400, output: 40 } },
    { when: at(12, 2), last: { input: 600, output: 60 }, total: { input: 1000, output: 100 } },
  ],
});

// ------------------------------------------------------------- what it answers

/** `obk usage --json`. */
async function usage(box) {
  const result = await box.run(['usage', '--bots', 'bots', '--json']);
  assert.equal(result.code, 0, `usage reports and never fails: ${result.stderr}`);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

/** The plain report. */
async function plainUsage(box) {
  const result = await box.run(['usage', '--bots', 'bots']);
  assert.equal(result.code, 0, `usage reports and never fails: ${result.stderr}`);
  return result.stdout;
}

/** The one line of a plain report about one conversation. */
function lineOf(stdout, id) {
  const found = stdout.split('\n').filter((line) => line.includes(id));
  assert.equal(found.length, 1, `one line should be about ${id}, got:\n${stdout}`);
  return found[0];
}

/** api-bot's entry. */
function botOf(answer) {
  const found = answer.usage.filter((entry) => entry.bot === 'api-bot');
  assert.equal(found.length, 1, `one entry should be about api-bot, got: ${JSON.stringify(answer.usage)}`);
  return found[0];
}

/** The daily session's row for one conversation. */
function rowOf(answer, id) {
  const daily = (botOf(answer).sessions ?? []).find((session) => session.name === 'daily');
  assert.ok(daily, `api-bot should say something about daily, got: ${JSON.stringify(botOf(answer).sessions)}`);
  const found = (daily.conversations ?? []).filter((one) => one.id === id);
  assert.equal(found.length, 1, `daily should have one row for ${id}, got: ${JSON.stringify(daily.conversations)}`);
  return found[0];
}

/** The ids of the conversations no session claims. */
const unclaimedIds = (answer) => (botOf(answer).unclaimed ?? []).map((one) => one.id).sort();

/** The one entry about one model in a row's split by model. */
function modelOf(row, model) {
  assert.ok(Array.isArray(row.by_model), `a row should split its usage by model, got: ${JSON.stringify(row)}`);
  const found = row.by_model.filter((one) => one.model === model);
  assert.equal(found.length, 1, `one entry should be about ${model}, got: ${JSON.stringify(row.by_model)}`);
  return found[0];
}

/** Nothing left out, in the answer's words. */
const NOTHING_LEFT_OUT = { unreadable_transcripts: 0, broken_lines: 0, records_without_numbers: 0, records_without_time: 0 };
const leftOutOf = (owner, field) => Object.fromEntries(Object.keys(NOTHING_LEFT_OUT).map((kind) => [kind, owner[field]?.[kind]]));

// ------------------------------------------------------------- 1. a spawned subagent

test('C1 a subagent a book conversation spawned counts in that conversation\'s row, as subagent calls, on the model it ran on, and is not unclaimed', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantParent(box, home);
  await plantChild(box, home, spawnedBy(PARENT));
  await bookSays(bots, PARENT);

  const answer = await usage(box);
  const row = rowOf(answer, PARENT);

  assert.equal(row.calls, 4, 'the parent\'s own two and the subagent\'s two');
  assert.equal(row.subagent_calls, 2, 'of which two were the subagent\'s');
  assert.strictEqual(row.review_calls, 0, 'and none a review\'s: 0, a number');
  assert.equal(row.tokens?.input, 83000, 'the parent\'s 3,000 and the subagent\'s own 80,000');
  assert.equal(row.tokens?.output, 8300, 'the parent\'s 300 and the subagent\'s own 8,000');
  assert.equal(modelOf(row, 'gpt-6-astra').calls, 2);
  assert.equal(modelOf(row, 'gpt-6-astra').tokens?.input, 3000, 'the parent\'s own, on its model');
  assert.equal(modelOf(row, 'gpt-6-sol').calls, 2);
  assert.equal(modelOf(row, 'gpt-6-sol').tokens?.input, 80000, 'the subagent\'s, on the model it ran on');
  assert.deepEqual([...row.models].sort(), ['gpt-6-astra', 'gpt-6-sol']);
  assert.deepEqual(unclaimedIds(answer), [], 'the subagent is daily\'s, not nobody\'s');
  assert.deepEqual(leftOutOf(botOf(answer), 'unclaimed_not_counted'), NOTHING_LEFT_OUT);
});

test('C1 the plain report says how many of the conversation\'s calls were its subagents\', and lists no unclaimed conversation', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantParent(box, home);
  await plantChild(box, home, spawnedBy(PARENT));
  await bookSays(bots, PARENT);

  const stdout = await plainUsage(box);

  assert.match(lineOf(stdout, PARENT), /\b4 calls\W*of which subagents: 2 calls\b/, `got:\n${stdout}`);
  assert.ok(!stdout.includes(CHILD), `the subagent has no line of its own, and no unclaimed one: ${stdout}`);
});

// ------------------------------------------------------------- 2. a child of a child

test('C2 a subagent\'s own subagent counts toward the same conversation\'s row', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantParent(box, home);
  await plantChild(box, home, spawnedBy(PARENT));
  await plantGrandchild(box, home);
  await bookSays(bots, PARENT);

  const answer = await usage(box);
  const row = rowOf(answer, PARENT);

  assert.equal(row.calls, 5, 'the parent\'s two, the child\'s two and the grandchild\'s one');
  assert.equal(row.subagent_calls, 3, 'the child\'s and the grandchild\'s');
  assert.equal(row.tokens?.input, 83700);
  assert.equal(modelOf(row, 'gpt-6-luna').calls, 1, 'the grandchild\'s, on the model it ran on');
  assert.equal(modelOf(row, 'gpt-6-luna').tokens?.input, 700);
  assert.deepEqual(unclaimedIds(answer), [], 'neither is nobody\'s');
});

// ------------------------------------------------------------- 3. Codex's own review

test('C3 a guardian review of a book conversation counts in its row as review calls, apart from the subagents\', and is not unclaimed', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantParent(box, home);
  await plantChild(box, home, spawnedBy(PARENT));
  await plantReview(box, home, PARENT);
  await bookSays(bots, PARENT);

  const answer = await usage(box);
  const row = rowOf(answer, PARENT);

  assert.equal(row.review_calls, 2, 'the review\'s two calls');
  assert.equal(row.subagent_calls, 2, 'the subagent\'s two, and none of the review\'s');
  assert.equal(row.calls, 6, 'the parent\'s own two, the subagent\'s two and the review\'s two, as "of which" reads');
  assert.equal(row.tokens?.input, 84000, 'the parent\'s 3,000, the subagent\'s 80,000 and the review\'s 1,000');
  assert.equal(modelOf(row, 'codex-auto-review').calls, 2, 'the review\'s, on its own model');
  assert.equal(modelOf(row, 'codex-auto-review').tokens?.input, 1000);
  assert.deepEqual(unclaimedIds(answer), [], 'the review is daily\'s, not nobody\'s');
});

test('C3 the plain report says how many of the conversation\'s calls were Codex\'s auto-review, apart from the subagents\'', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantParent(box, home);
  await plantChild(box, home, spawnedBy(PARENT));
  await plantReview(box, home, PARENT);
  await bookSays(bots, PARENT);

  const line = lineOf(await plainUsage(box), PARENT);

  assert.match(line, /of which subagents: 2 calls\b/, `the subagents' as before, got: ${line}`);
  assert.match(line, /auto-review\W+2 calls\b/i, `and the auto-review's apart, got: ${line}`);
});

// ------------------------------------------------------------- 4. no parent in the book

for (const [label, plantOne] of [
  ['a subagent of a conversation no session claims', (box, home) => plantChild(box, home, spawnedBy(STRANGER))],
  ['a subagent of a conversation that is not on disk', (box, home) => plantChild(box, home, spawnedBy(GONE))],
  ['a review of a conversation no session claims', (box, home) => plantReview(box, home, STRANGER)],
]) {
  test(`C4 ${label} stays unclaimed, and nothing of it is in the session's row`, async (t) => {
    const box = await createSandbox(t);
    const { bots, home } = await fleet(box);
    await plantParent(box, home);
    await plantParent(box, home, STRANGER);
    await plantOne(box, home);
    await bookSays(bots, PARENT);

    const answer = await usage(box);
    const row = rowOf(answer, PARENT);

    assert.equal(row.calls, 2, 'the parent\'s own two, and nothing of the child\'s');
    assert.strictEqual(row.subagent_calls, 0);
    assert.strictEqual(row.review_calls, 0);
    const child = label.includes('review') ? REVIEW : CHILD;
    assert.ok(unclaimedIds(answer).includes(child), `no session claims its parent, so it is nobody's: ${JSON.stringify(unclaimedIds(answer))}`);
  });
}

// ------------------------------------------------------------- 5. its own figures only

test('C5 a subagent whose first running total holds its parent\'s counts only its own figures', async (t) => {
  // Its first record's running total is 33,000 in: the parent's 3,000 and its
  // own 30,000. Counted by the running total, the subagent would show 83,000
  // in, and the row 86,000.
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantParent(box, home);
  await plantChild(box, home, spawnedBy(PARENT));
  await bookSays(bots, PARENT);

  const row = rowOf(await usage(box), PARENT);

  assert.equal(modelOf(row, 'gpt-6-sol').tokens?.input, 80000, 'the subagent\'s own 30,000 and 50,000, not 83,000');
  assert.equal(modelOf(row, 'gpt-6-sol').tokens?.output, 8000, 'its own 3,000 and 5,000, not 8,300');
  assert.equal(row.tokens?.input, 83000, 'the parent\'s 3,000 counted once');
});

// ------------------------------------------------- 6. found by the link, not the folder
//
// The review of PR #459. A child is attached by its explicit link to a
// conversation the book claims, whether or not the parent's own rollout is on
// disk, and wherever the child ran: its own records are all it needs. A missing
// parent's own calls cannot be counted, and the session says so, as one
// unreadable transcript. #376's refusal to count a fork whose origin cannot be
// read is not changed (usage-forks.test.js). Nothing is attached by folder: a
// child that ran elsewhere and links to no claimed conversation is not this
// bot's at all.

/** The daily session's entry. */
function dailyOf(answer) {
  const daily = (botOf(answer).sessions ?? []).find((session) => session.name === 'daily');
  assert.ok(daily, `api-bot should say something about daily, got: ${JSON.stringify(botOf(answer).sessions)}`);
  return daily;
}

/** Every conversation id the bot's entry names anywhere: its sessions' rows and its unclaimed. */
const everyIdOf = (answer) => [
  ...(botOf(answer).sessions ?? []).flatMap((session) => (session.conversations ?? []).map((one) => one.id)),
  ...(botOf(answer).unclaimed ?? []).map((one) => one.id),
].sort();

test('C6 a book conversation whose rollout is not on disk still gathers its subagents, a grandchild and a review in its row, and says its own calls are not counted', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantChild(box, home, spawnedBy(PARENT));
  await plantGrandchild(box, home);
  await plantReview(box, home, CHILD);
  await bookSays(bots, PARENT);

  const answer = await usage(box);
  const row = rowOf(answer, PARENT);

  assert.equal(row.calls, 5, 'the child\'s two, the grandchild\'s one and the review\'s two; the parent\'s own are not on disk');
  assert.equal(row.subagent_calls, 3, 'the child\'s and the grandchild\'s');
  assert.equal(row.review_calls, 2, 'the review of the child');
  assert.equal(row.tokens?.input, 81700, 'the child\'s 80,000, the grandchild\'s 700 and the review\'s 1,000');
  assert.deepEqual(unclaimedIds(answer), [], 'none of them is nobody\'s');
  assert.deepEqual(
    leftOutOf(dailyOf(answer), 'not_counted'),
    { ...NOTHING_LEFT_OUT, unreadable_transcripts: 1 },
    'the parent\'s own rollout is not there to be read, and the session says so',
  );
});

test('C7 a subagent that ran in another folder is found by its link: it, its own subagent and a review of it count in the claimed parent\'s row', async (t) => {
  const box = await createSandbox(t);
  const { bots, home } = await fleet(box);
  await plantParent(box, home);
  await plantChild(box, path.join(home, 'work', 'worker'), spawnedBy(PARENT));
  await plantGrandchild(box, home);
  await plantReview(box, home, CHILD);
  await bookSays(bots, PARENT);

  const answer = await usage(box);
  const row = rowOf(answer, PARENT);

  assert.equal(row.calls, 7, 'the parent\'s two, the child\'s two, the grandchild\'s one and the review\'s two');
  assert.equal(row.subagent_calls, 3);
  assert.equal(row.review_calls, 2);
  assert.equal(row.tokens?.input, 84700, 'the parent\'s 3,000, the child\'s 80,000, the grandchild\'s 700 and the review\'s 1,000');
  assert.equal(modelOf(row, 'gpt-6-sol').tokens?.input, 80000, 'the child that ran elsewhere, on its own model');
  assert.deepEqual(unclaimedIds(answer), [], 'none of them is nobody\'s');
  assert.deepEqual(leftOutOf(dailyOf(answer), 'not_counted'), NOTHING_LEFT_OUT);
});

for (const [label, where, parent] of [
  ['under the bot\'s own work folder, its parent nowhere on disk', (box, home) => path.join(home, 'work', 'worker'), GONE],
  ['in a folder of no bot\'s, its parent nowhere on disk', (box) => box.path('elsewhere'), GONE],
  ['under the bot\'s own work folder, its parent a conversation of the bot\'s folder that no session claims', (box, home) => path.join(home, 'work', 'worker'), STRANGER],
]) {
  test(`C7 a subagent that ran ${label} is not this bot's: no row, and not unclaimed`, async (t) => {
    // Linked to no claimed conversation, and not run in the bot's folder:
    // nothing ties it to this bot, and no folder is guessed from.
    const box = await createSandbox(t);
    const { bots, home } = await fleet(box);
    await plantParent(box, home);
    await plantParent(box, home, STRANGER);
    await plantChild(box, where(box, home), spawnedBy(parent));
    await bookSays(bots, PARENT);

    const answer = await usage(box);

    assert.ok(!everyIdOf(answer).includes(CHILD), `the subagent appears nowhere, got: ${JSON.stringify(everyIdOf(answer))}`);
    assert.equal(rowOf(answer, PARENT).calls, 2, 'and nothing of it is in the session\'s row');
  });
}

// ------------------------------------------------- 7. one owner across the fleet
//
// The review of PR #459, at 278d8e1. Who a child belongs to is settled across
// the whole fleet before any bot's rows: a child a book claims stays with that
// claim and is attached nowhere else; a child attached through its links to a
// claim counts only there, and is in no other bot's unclaimed, whichever bot's
// folder it ran in. The same when `--bot` names one bot.

/** Bot Father, api-bot and web-bot, both on Codex, each with its daily session; their homes. */
async function twoBots(box) {
  const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(init.code, 0, init.stderr);
  for (const bot of ['api-bot', 'web-bot']) {
    const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', 'codex']);
    assert.equal(made.code, 0, made.stderr);
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily']);
    assert.equal(added.code, 0, added.stderr);
  }
  const bots = box.path('bots');
  return { bots, homeA: botHomeOf(bots, 'api-bot'), homeB: botHomeOf(bots, 'web-bot') };
}

/** One bot's book: daily in `conversation`, and `before` in its history. */
const bookOfSays = (bots, bot, conversation, before = []) => writeFile(bookOf(bots, bot), stringify({
  orca: { project: `proj-${bot}`, setup: `setup-${bot}` },
  sessions: {
    daily: {
      tab: `tab-${bot}`,
      launched: at(8),
      session: conversation,
      ...(before.length === 0 ? {} : { history: before.map((old) => ({ session: old, ended: 'clear', at: at(8, 30) })) }),
    },
  },
}));

/** A conversation of one call, `input` in and a tenth of it out, in `cwd`. */
const oneCall = (box, cwd, { id, started, meta = { source: 'cli' }, model, input }) => plantRollout(box, cwd, {
  id,
  started,
  meta,
  model,
  effort: 'medium',
  calls: [{ when: started.replace(/:00\.000Z$/, ':30.000Z'), last: { input, output: input / 10 }, total: { input, output: input / 10 } }],
});

/**
 * The reviewer's fleet: A's P (10 in), B's Q (100 in), and C (20 in), which
 * names P as its parent and ran in B's folder, or in A's when `childIn` says so.
 */
async function reviewersFleet(box, { childIn = 'B' } = {}) {
  const fleetOf = await twoBots(box);
  const { homeA, homeB } = fleetOf;
  await oneCall(box, homeA, { id: PARENT, started: at(9), model: 'gpt-6-astra', input: 10 });
  await oneCall(box, homeB, { id: STRANGER, started: at(9, 10), model: 'gpt-6-luna', input: 100 });
  await oneCall(box, childIn === 'A' ? homeA : homeB, { id: CHILD, started: at(10), meta: spawnedBy(PARENT), model: 'gpt-6-sol', input: 20 });
  return fleetOf;
}

/** One bot's entry in an answer, or undefined. */
const bot = (answer, name) => answer.usage.find((entry) => entry.bot === name);

/** One bot's daily row for a conversation, or undefined. */
const rowIn = (answer, name, id) => (bot(answer, name)?.sessions ?? []).find((session) => session.name === 'daily')?.conversations?.find((one) => one.id === id);

/** Every conversation row of the answer, sessions' and unclaimed, across the bots it holds. */
const allRows = (answer) => answer.usage.flatMap((entry) => [
  ...(entry.sessions ?? []).flatMap((session) => session.conversations ?? []),
  ...(entry.unclaimed ?? []),
]);

test('C8 a subagent that ran in another bot\'s folder and names a claimed conversation of this bot\'s counts once, there, and is in no bot\'s unclaimed', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await reviewersFleet(box);
  await bookOfSays(bots, 'api-bot', PARENT);
  await bookOfSays(bots, 'web-bot', STRANGER);

  const answer = await usage(box);

  const p = rowIn(answer, 'api-bot', PARENT);
  assert.equal(p?.calls, 2, `P's own call and C's: ${JSON.stringify(p)}`);
  assert.equal(p.subagent_calls, 1);
  assert.equal(p.tokens?.input, 30, 'P\'s 10 and C\'s 20');
  assert.equal(rowIn(answer, 'web-bot', STRANGER)?.calls, 1, 'Q, B\'s own, as it was');
  assert.ok(!(bot(answer, 'web-bot').unclaimed ?? []).some((one) => one.id === CHILD), `C is A's, through P, so not B's unclaimed: ${JSON.stringify(bot(answer, 'web-bot').unclaimed)}`);
  const rows = allRows(answer);
  assert.equal(rows.reduce((sum, one) => sum + one.calls, 0), 3, `three calls in all, each once: ${JSON.stringify(rows)}`);
  assert.equal(rows.reduce((sum, one) => sum + (one.tokens?.input ?? 0), 0), 130, 'and 130 in: 10, 20 and 100');
});

test('C8 a subagent another bot\'s book claims stays with that claim, as its own conversation, and is not attached to its parent\'s row', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await reviewersFleet(box);
  await bookOfSays(bots, 'api-bot', PARENT);
  await bookOfSays(bots, 'web-bot', CHILD, [STRANGER]);

  const answer = await usage(box);

  const p = rowIn(answer, 'api-bot', PARENT);
  assert.equal(p?.calls, 1, `P's own call alone: C is claimed by B's book: ${JSON.stringify(p)}`);
  assert.strictEqual(p.subagent_calls, 0);
  assert.equal(p.tokens?.input, 10);
  const c = rowIn(answer, 'web-bot', CHILD);
  assert.equal(c?.calls, 1, `C counts under B's claim, as its own conversation: ${JSON.stringify(bot(answer, 'web-bot'))}`);
  assert.equal(c.tokens?.input, 20);
  const rows = allRows(answer);
  assert.equal(rows.reduce((sum, one) => sum + one.calls, 0), 3, `three calls in all, each once: ${JSON.stringify(rows)}`);
  assert.equal(rows.reduce((sum, one) => sum + (one.tokens?.input ?? 0), 0), 130);
});

test('C8 with --bot naming the other bot alone, its unclaimed still does not list a subagent that belongs to this bot\'s claim', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await reviewersFleet(box);
  await bookOfSays(bots, 'api-bot', PARENT);
  await bookOfSays(bots, 'web-bot', STRANGER);

  const result = await box.run(['usage', '--bots', 'bots', '--bot', 'web-bot', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const answer = JSON.parse(result.stdout);

  assert.deepEqual(answer.usage.map((entry) => entry.bot), ['web-bot'], 'the one bot asked about');
  assert.ok(!(bot(answer, 'web-bot').unclaimed ?? []).some((one) => one.id === CHILD), `C is A's, through P, even when only B is asked about: ${JSON.stringify(bot(answer, 'web-bot').unclaimed)}`);
  assert.equal(rowIn(answer, 'web-bot', STRANGER)?.calls, 1, 'Q, B\'s own');
});

// The reviewer's third look at PR #459: the same claim by B's book, with C run
// in A's folder. A conversation any bot's book claims is that claim's, so it is
// in no other bot's unclaimed, whichever folder it ran in, subagent or not.

/** A conversation of A's folder that no book names and that links to nothing: A's unclaimed, as ever. */
const LONER = '01a0eb59-5abf-7720-abb2-fe574ced006d';

test('C9 a subagent another bot\'s book claims, run in this bot\'s folder, is that claim\'s alone: not this bot\'s unclaimed, and counted once', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await reviewersFleet(box, { childIn: 'A' });
  await bookOfSays(bots, 'api-bot', PARENT);
  await bookOfSays(bots, 'web-bot', CHILD, [STRANGER]);

  const answer = await usage(box);

  assert.equal(rowIn(answer, 'web-bot', CHILD)?.calls, 1, `C counts under B's claim: ${JSON.stringify(bot(answer, 'web-bot'))}`);
  assert.equal(rowIn(answer, 'api-bot', PARENT)?.calls, 1, 'P\'s own call alone: C is claimed by B\'s book');
  assert.ok(!(bot(answer, 'api-bot').unclaimed ?? []).some((one) => one.id === CHILD), `C is B's, so not A's unclaimed, though it ran in A's folder: ${JSON.stringify(bot(answer, 'api-bot').unclaimed)}`);
  const rows = allRows(answer);
  assert.equal(rows.reduce((sum, one) => sum + one.calls, 0), 3, `three calls in all, each once: ${JSON.stringify(rows)}`);
  assert.equal(rows.reduce((sum, one) => sum + (one.tokens?.input ?? 0), 0), 130, 'and 130 in: 10, 20 and 100');
});

test('C9 with --bot naming this bot alone, a conversation another bot\'s book claims is still not in its unclaimed', async (t) => {
  const box = await createSandbox(t);
  const { bots } = await reviewersFleet(box, { childIn: 'A' });
  await bookOfSays(bots, 'api-bot', PARENT);
  await bookOfSays(bots, 'web-bot', CHILD, [STRANGER]);

  const result = await box.run(['usage', '--bots', 'bots', '--bot', 'api-bot', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const answer = JSON.parse(result.stdout);

  assert.deepEqual(answer.usage.map((entry) => entry.bot), ['api-bot'], 'the one bot asked about');
  assert.ok(!(bot(answer, 'api-bot').unclaimed ?? []).some((one) => one.id === CHILD), `C is B's, even when only A is asked about: ${JSON.stringify(bot(answer, 'api-bot').unclaimed)}`);
  const p = rowIn(answer, 'api-bot', PARENT);
  assert.equal(p?.calls, 1, `P's own call alone: ${JSON.stringify(p)}`);
  assert.equal(p.tokens?.input, 10);
});

test('C9 a conversation of this bot\'s folder that no book names and that links to no claim is still this bot\'s unclaimed', async (t) => {
  const box = await createSandbox(t);
  const { bots, homeA } = await reviewersFleet(box, { childIn: 'A' });
  await oneCall(box, homeA, { id: LONER, started: at(11), model: 'gpt-6-astra', input: 7 });
  await bookOfSays(bots, 'api-bot', PARENT);
  await bookOfSays(bots, 'web-bot', CHILD, [STRANGER]);

  const answer = await usage(box);

  const loner = (bot(answer, 'api-bot').unclaimed ?? []).find((one) => one.id === LONER);
  assert.equal(loner?.calls, 1, `nobody claims it and it links to nothing, so it is A's unclaimed: ${JSON.stringify(bot(answer, 'api-bot').unclaimed)}`);
  assert.equal(loner.tokens?.input, 7);
});
