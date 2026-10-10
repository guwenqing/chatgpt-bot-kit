// One signal for each fleet mail (#509, requests/fleet-mail-one-signal, R1, R2,
// R3 and R6).
//
// Before #509 a send down the Orca road typed the kit's line into every
// receiver that was up, busy or idle, beside Orca's own notice. So a Claude
// receiver got two signals for one mail, and a line typed into a busy Claude
// tab waited in its input box after the mail was read. Now Orca's notice comes
// first and the kit's line is a fallback only:
//
//   S1  Busy at the send's first look (Orca's `terminal wait --for tui-idle`
//       does not answer ok): a Claude Code receiver gets nothing typed, and
//       its own hook tells it when its turn ends (`signal: "hook"`, `because:
//       "busy"`); a Codex receiver gets the line (`signal: "line"`, `because:
//       "busy"`), since Codex takes a line typed during a turn into that turn.
//       But where the record shows Orca's notice for its mailbox, written
//       after the send, the tab is busy with that notice's turn: nothing is
//       typed on either harness (`signal: "orca"`), as R1 says (seen live).
//   S2  Idle: the send watches the tab for up to 8 s.
//         - Orca's notice for the receiver's mailbox shows up in the receiver's
//           own record of its turns (a user turn, written after the send,
//           whose text holds `orchestration check --run <its mailbox>`):
//           nothing is typed, `signal: "orca"`, and the send stops as soon as
//           it sees it.
//         - A turn starts and the record shows no such notice: Claude gets
//           nothing (`signal: "hook"`, `because: "other-turn"`), Codex gets
//           the line (`signal: "line"`, `because: "other-turn"`).
//         - No turn starts in 8 s: the line (`signal: "line"`, `because:
//           "no-turn"`).
//       `watchedMs` says how long it watched.
//   S3  A record that cannot be found or read is "Orca's notice was not
//       seen", never "it reached it" (the architect's ruling, R1): missing,
//       not JSON, or a folder in its place.
//   S4  Where nothing was typed for the old reasons (not up, a question on
//       screen) the answer has no `signal` at all.
//   S5  `nudged` stays true exactly when the kit typed its line, and the
//       plain answer says in words which signal went.
//
// The receiver's turns are played by the fake Orca (helpers/fake-orca.js,
// `afterMail`): at a chosen look after the mail, its tab goes busy and a user
// turn is written at the end of its record, as the harness writes it (tech
// notes, sections 2 and 3). Its record is the conversation the book holds for
// the session, under the sandbox's HOME. The kit's first look finds the tab as
// it was; the reaction shows from the look after it.
//
// What a test that watches the whole 8 s costs: those are run side by side in
// one group, so the file waits about 8 s for them all, not 8 s for each.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME and TMPDIR, a
// fake Orca. Nothing here reaches the real Orca or a real harness.

import assert from 'node:assert/strict';
import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, test } from 'node:test';

import {
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  orcaCallsOf,
  orcaCommand,
  orcaFlag,
  recordSession,
  sessionIn,
  typedInto,
} from './helpers/cli.js';

/** The watch the requirement names, in ms. */
const WATCH_MS = 8000;

/** Conversation ids shaped the way both harnesses shape them. */
const CONVERSATION = { writer: '0199b2c0-0509-4444-8888-c1a0de000001', coder: '0199b2c0-0509-4444-8888-c0de00000002' };

/** Who receives on each harness, and who sends to it down the Orca road. */
const RECEIVERS = {
  claude: { harness: 'claude', bot: 'writer', from: 'coder/daily' },
  codex: { harness: 'codex', bot: 'coder', from: 'writer/daily' },
};

/**
 * A Claude bot and a Codex bot, a `daily` session each, both up. With
 * `records`, the book holds each session's conversation and the harness has
 * written its record; without, the book holds none.
 */
async function fleetIn(box, { records = true } = {}) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness] of [['writer', 'claude'], ['coder', 'codex']]) {
    assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness])).code, 0);
    assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily'])).code, 0);
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  const bots = box.path('bots');

  const fleet = { bots, tabs: {}, records: {}, mailboxes: {} };
  for (const { bot, harness } of Object.values(RECEIVERS)) {
    const entry = await sessionIn(bots, bot, 'daily');
    assert.equal(typeof entry?.tab, 'string', `the premise: ${bot}/daily has a tab`);
    assert.equal(typeof entry?.mailbox, 'string', `the premise: ${bot}/daily has a mailbox`);
    fleet.tabs[bot] = entry.tab;
    fleet.mailboxes[bot] = entry.mailbox;
    if (!records) continue;
    const heard = await recordSession(box, { bots, bot, tab: entry.tab, session: CONVERSATION[bot] });
    assert.equal(heard.code, 0, `the premise: the book holds ${bot}'s conversation: ${heard.stderr}`);
    assert.equal((await sessionIn(bots, bot, 'daily')).session, CONVERSATION[bot], `the premise: the book holds ${bot}'s conversation`);
    fleet.records[bot] = await conversationOnRecord(box, { harness, cwd: botHomeOf(bots, bot), id: CONVERSATION[bot] });
  }
  return fleet;
}

/** Change one tab in the fake Orca's world. */
async function setTab(box, tab, changes) {
  const terminals = await box.orca.terminals();
  assert.ok(terminals.some((one) => one.tabId === tab), `the premise: Orca has the tab ${tab}`);
  await box.orca.set({ terminals: terminals.map((one) => (one.tabId === tab ? { ...one, ...changes } : one)) });
}

/** The receiver's tab is busy with a turn of its own from the first look on. */
const busy = (box, fleet, receiver) => setTab(box, fleet.tabs[receiver.bot], { tuiIdle: 'busy' });

/**
 * What the receiver does at the kit's second look after the mail (the first
 * look of the watch): `busy` a turn starts; `text` the user turn written in its
 * record: 'notice' for Orca's notice for its own mailbox, a string for any
 * other turn, null for none. `record` false writes nowhere.
 */
const reacts = (box, fleet, receiver, { busy: turn = true, text = 'notice', record = true, waits = 2, spoil } = {}) => setTab(box, fleet.tabs[receiver.bot], {
  afterMail: {
    waits,
    busy: turn,
    text,
    ...(spoil === undefined ? {} : { spoil }),
    ...(record ? { record: { file: fleet.records[receiver.bot], harness: receiver.harness } } : {}),
  },
});

/** Send one message to the receiver, with `--json` unless `plain`. */
async function send(box, receiver, { plain = false, subject = 'the staging host' } = {}) {
  const started = Date.now();
  const result = await box.run([
    'message', 'send', '--bots', 'bots', '--to', receiver.bot, '--from', receiver.from,
    '--subject', subject, '--text', 'It is down again.', ...(plain ? [] : ['--json']),
  ]);
  return { ...result, tookMs: Date.now() - started };
}

/** The --json answer, which is JSON and nothing else. */
function answerOf(result) {
  assert.equal(result.code, 0, `the message went, whatever the signal: ${result.stdout}${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout}${result.stderr} (${error.message})`);
  }
}

/** What was typed into each tab since its launch line, by tab id. */
async function typedSinceLaunch(box) {
  const after = {};
  for (const terminal of await box.orca.terminals()) after[terminal.tabId] = typedInto(terminal).slice(1);
  return after;
}

/** Nothing typed into any tab of the fleet since it was launched. */
async function assertNothingTyped(box) {
  const typed = await typedSinceLaunch(box);
  for (const [tab, lines] of Object.entries(typed)) assert.deepEqual(lines, [], `nothing may be typed into ${tab}, got: ${JSON.stringify(lines)}`);
}

/** The kit's one line in the receiver's tab, and nothing in any other. */
async function assertOneLine(box, fleet, receiver) {
  const typed = await typedSinceLaunch(box);
  const tab = fleet.tabs[receiver.bot];
  assert.equal(typed[tab].length, 1, `the kit's one line into ${receiver.bot}'s tab, got: ${JSON.stringify(typed[tab])}`);
  assert.ok(typed[tab][0].includes('message check --bots '), `the kit's line, got: ${typed[tab][0]}`);
  for (const [other, lines] of Object.entries(typed)) {
    if (other !== tab) assert.deepEqual(lines, [], `nothing may be typed into ${other}, got: ${JSON.stringify(lines)}`);
  }
}

/** The answer's signal, said in one place so a failure shows the whole answer. */
function assertSignal(answer, signal, because) {
  assert.equal(answer.sent, true, `the message went: ${JSON.stringify(answer)}`);
  assert.equal(answer.signal, signal, `signal ${signal}, got: ${JSON.stringify(answer)}`);
  if (because !== undefined) assert.equal(answer.because, because, `because ${because}, got: ${JSON.stringify(answer)}`);
  assert.equal(answer.nudged, signal === 'line', `nudged is true exactly when the kit typed its line, got: ${JSON.stringify(answer)}`);
}

/** The receiver's own looks at its tab since `from`: `terminal wait` calls naming its handle. */
async function looksAt(box, tab, from) {
  const handle = (await box.orca.terminals()).find((one) => one.tabId === tab).handle;
  return orcaCallsOf((await box.orca.calls()).slice(from), 'terminal wait').filter((call) => orcaFlag(call, '--terminal') === handle);
}

// ------------------------------------------------- S1: busy at the first look

test('S1 a Claude Code receiver busy at the first look gets nothing typed: signal hook, because busy', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await busy(box, fleet, RECEIVERS.claude);

  const answer = answerOf(await send(box, RECEIVERS.claude));

  assertSignal(answer, 'hook', 'busy');
  assert.equal((await box.orca.messages()).length, 1, 'the mail is in its mailbox');
  await assertNothingTyped(box);
});

test('S1 a Codex receiver busy at the first look still gets the line: signal line, because busy', async (t) => {
  // Codex takes a line typed during a turn into that turn at once, so nothing
  // stays in its input box; that is also what wakes a Codex in its sleep tool.
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await busy(box, fleet, RECEIVERS.codex);

  const answer = answerOf(await send(box, RECEIVERS.codex));

  assertSignal(answer, 'line', 'busy');
  await assertOneLine(box, fleet, RECEIVERS.codex);
});

test('S1 S5 the plain answer for a busy Claude Code receiver says nothing was typed and its hook tells it', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await busy(box, fleet, RECEIVERS.claude);

  const result = await send(box, RECEIVERS.claude, { plain: true });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /nothing was typed|no line was typed/i, `it says nothing was typed, got:\n${result.stdout}`);
  assert.match(result.stdout, /hook/i, `and that its hook tells it, got:\n${result.stdout}`);
  await assertNothingTyped(box);
});

// ------------------- S1: busy at the first look because Orca's notice started a turn
//
// Seen live (Orca 1.4.223, Codex 0.162.0, the #509 live run): Orca typed its
// notice into an idle tab at once after the post, the harness started a turn
// on it, and the send's first look already found the tab busy; the kit then
// typed its line as for a busy Codex, and the receiver had two signals. R1
// holds whatever the first look finds: the kit types nothing when the record
// shows Orca's notice for the mailbox, written after the send.

/**
 * The receiver, played by the test while the send runs: once the mail is in
 * Orca's world, `afterMs` later, Orca's notice for its mailbox goes into its
 * record as a user turn, in its harness's shape. Answers a promise that is
 * done when it has written, or when `stop()` was called first.
 */
function noticeLater(box, fleet, receiver, afterMs) {
  let stopped = false;
  const done = (async () => {
    while (!stopped && (await box.orca.messages()).length === 0) await sleep(50);
    if (stopped) return;
    await sleep(afterMs);
    const text = `You have 1 orchestration message. Run \`orca orchestration check --run ${fleet.mailboxes[receiver.bot]}\``;
    const at = new Date().toISOString();
    const line = receiver.harness === 'codex'
      ? { timestamp: at, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }
      : { type: 'user', message: { role: 'user', content: text }, timestamp: at };
    await appendFile(fleet.records[receiver.bot], `${JSON.stringify(line)}\n`);
  })();
  return { done, stop: () => { stopped = true; } };
}

for (const receiver of Object.values(RECEIVERS)) {
  test(`S1 a ${receiver.harness} receiver found busy at the first look because Orca's notice started its turn gets nothing typed: signal orca`, async (t) => {
    // The notice and the turn it starts are there from the first look on.
    const box = await createSandbox(t);
    const fleet = await fleetIn(box);
    await reacts(box, fleet, receiver, { waits: 1 });

    const answer = answerOf(await send(box, receiver));

    const fired = (await box.orca.terminals()).find((one) => one.tabId === fleet.tabs[receiver.bot]).afterMail?.fired;
    assert.equal(fired, true, `the premise: the first look found the turn Orca's notice started: ${JSON.stringify(answer)}`);
    assertSignal(answer, 'orca');
    await assertNothingTyped(box);
  });

  test(`S1 a ${receiver.harness} receiver busy at the first look whose record shows Orca's notice a moment later gets nothing typed: signal orca, well inside 8 s`, async (t) => {
    // The tab is busy at the first look, and the notice is in the record
    // 700 ms after the post: the send reads the record a short while before
    // it decides.
    const box = await createSandbox(t);
    const fleet = await fleetIn(box);
    await busy(box, fleet, receiver);
    const notice = noticeLater(box, fleet, receiver, 700);

    let result;
    try {
      result = await send(box, receiver);
    } finally {
      notice.stop();
      await notice.done;
    }

    const answer = answerOf(result);
    assertSignal(answer, 'orca');
    assert.ok(result.tookMs < WATCH_MS, `it did not wait out the 8 s watch, took ${result.tookMs} ms`);
    await assertNothingTyped(box);
  });
}

test('S1 a Codex receiver busy at the first look whose record shows Orca\'s notice for another mailbox still gets the line: signal line, because busy', async (t) => {
  // The contrast: a notice that is not for this mailbox is no signal for this mail.
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await reacts(box, fleet, RECEIVERS.codex, { waits: 1, text: 'You have 1 orchestration message. Run `orca orchestration check --run run_elsewhere`' });

  const answer = answerOf(await send(box, RECEIVERS.codex));

  assertSignal(answer, 'line', 'busy');
  await assertOneLine(box, fleet, RECEIVERS.codex);
});

test('S1 a Claude Code receiver busy at the first look with a turn that wrote nothing to the record: signal hook, because busy', async (t) => {
  // The contrast on Claude: busy, and no notice in the record, is the hook.
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await reacts(box, fleet, RECEIVERS.claude, { waits: 1, text: null });

  const answer = answerOf(await send(box, RECEIVERS.claude));

  assertSignal(answer, 'hook', 'busy');
  await assertNothingTyped(box);
});

// ------------------------------------------- S2: idle, and Orca's notice lands

for (const receiver of Object.values(RECEIVERS)) {
  test(`S2 an idle ${receiver.harness} receiver whose record takes Orca's notice as a turn gets nothing typed: signal orca, and the watch stops there`, async (t) => {
    const box = await createSandbox(t);
    const fleet = await fleetIn(box);
    await reacts(box, fleet, receiver);
    const from = (await box.orca.calls()).length;

    const answer = answerOf(await send(box, receiver));

    assertSignal(answer, 'orca');
    assert.equal(typeof answer.watchedMs, 'number', `the answer says how long it watched: ${JSON.stringify(answer)}`);
    assert.ok(answer.watchedMs < WATCH_MS, `it stopped before the 8 s were up, got watchedMs ${answer.watchedMs}`);
    // The notice was there from the second look on; a send that went on
    // watching after it looks again and again.
    const looks = await looksAt(box, fleet.tabs[receiver.bot], from);
    assert.ok(looks.length >= 2, `the premise: the send looked twice or more, so it saw the turn, got ${looks.length}`);
    assert.ok(looks.length <= 3, `it stops as soon as it sees the notice, not after the whole watch: ${looks.length} looks`);
    await assertNothingTyped(box);
  });
}

test('S2 Orca\'s notice in the record is enough even when the tab is idle again by the next look: signal orca, well before 8 s', async (t) => {
  // The turn Orca's notice started can be over before the kit looks again.
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await reacts(box, fleet, RECEIVERS.claude, { busy: false });
  const from = (await box.orca.calls()).length;

  const answer = answerOf(await send(box, RECEIVERS.claude));

  assertSignal(answer, 'orca');
  assert.ok(answer.watchedMs < WATCH_MS, `it stopped before the 8 s were up, got watchedMs ${answer.watchedMs}`);
  const looks = await looksAt(box, fleet.tabs.writer, from);
  assert.ok(looks.length <= 3, `it stops as soon as the record shows the notice: ${looks.length} looks`);
  await assertNothingTyped(box);
});

test('S2 S5 the plain answer when Orca\'s notice reached it says no line was typed', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await reacts(box, fleet, RECEIVERS.claude);

  const result = await send(box, RECEIVERS.claude, { plain: true });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /no line was typed/i, `got:\n${result.stdout}`);
  assert.match(result.stdout, /Orca/, `and that Orca's notice reached it, got:\n${result.stdout}`);
  await assertNothingTyped(box);
});

// ------------------------------------- S2: idle, and a turn of other work

test('S2 an idle Claude Code receiver that starts a turn of other work gets nothing typed: signal hook, because other-turn', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await reacts(box, fleet, RECEIVERS.claude, { text: 'Run the tests again, please.' });

  const answer = answerOf(await send(box, RECEIVERS.claude));

  assertSignal(answer, 'hook', 'other-turn');
  assert.ok(answer.watchedMs < WATCH_MS, `it stopped when the turn started, got watchedMs ${answer.watchedMs}`);
  await assertNothingTyped(box);
});

test('S2 an idle Codex receiver that starts a turn of other work gets the line: signal line, because other-turn', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await reacts(box, fleet, RECEIVERS.codex, { text: 'Run the tests again, please.' });

  const answer = answerOf(await send(box, RECEIVERS.codex));

  assertSignal(answer, 'line', 'other-turn');
  assert.ok(answer.watchedMs < WATCH_MS, `it stopped when the turn started, got watchedMs ${answer.watchedMs}`);
  await assertOneLine(box, fleet, RECEIVERS.codex);
});

test('S2 a turn whose text is Orca\'s notice for another mailbox is a turn of other work, not this mail\'s notice', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await reacts(box, fleet, RECEIVERS.claude, { text: 'You have 1 orchestration message. Run `orca orchestration check --run run_elsewhere`' });

  const answer = answerOf(await send(box, RECEIVERS.claude));

  assertSignal(answer, 'hook', 'other-turn');
  await assertNothingTyped(box);
});

test('S2 a turn that writes nothing to the record is a turn of other work: Claude hook, other-turn', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await reacts(box, fleet, RECEIVERS.claude, { text: null });

  const answer = answerOf(await send(box, RECEIVERS.claude));

  assertSignal(answer, 'hook', 'other-turn');
  await assertNothingTyped(box);
});

// ------------------- S3: a record that cannot be found or read, and a turn

/** Ways the receiver's record cannot be read: each one leaves the book's id in place. */
const UNREADABLE = {
  missing: async (file) => rm(file, { force: true }),
  'not JSON': async (file) => writeFile(file, 'this is not JSON {{{\nnor is this\n'),
  'a folder in its place': async (file) => {
    await rm(file, { force: true });
    await mkdir(file);
  },
};

for (const [how, spoil] of Object.entries(UNREADABLE)) {
  test(`S3 a Claude Code receiver whose record is ${how} and that starts a turn gets nothing typed: hook, other-turn, never orca`, async (t) => {
    const box = await createSandbox(t);
    const fleet = await fleetIn(box);
    await spoil(fleet.records.writer);
    await reacts(box, fleet, RECEIVERS.claude, { text: null, record: false });

    const answer = answerOf(await send(box, RECEIVERS.claude));

    assertSignal(answer, 'hook', 'other-turn');
    await assertNothingTyped(box);
  });

  test(`S3 a Codex receiver whose record is ${how} and that starts a turn gets the line: line, other-turn`, async (t) => {
    const box = await createSandbox(t);
    const fleet = await fleetIn(box);
    await spoil(fleet.records.coder);
    await reacts(box, fleet, RECEIVERS.codex, { text: null, record: false });

    const answer = answerOf(await send(box, RECEIVERS.codex));

    assertSignal(answer, 'line', 'other-turn');
    await assertOneLine(box, fleet, RECEIVERS.codex);
  });
}

// ------------------------------- S2: a look in the watch Orca does not answer

test('S2 a look during the watch that Orca does not answer does not hold the send: it returns in bounded time, the mail sent', async (t) => {
  // No kit command hangs on one slow Orca reply (#226, gate-bounded.test.js).
  // The gate's own look answers; every look after it is held for 30 s. What
  // the send then says is the builder's; that it returns, and well inside the
  // 8 s watch plus half the hang, is the rule.
  const box = await createSandbox(t);
  await fleetIn(box);
  const from = orcaCallsOf(await box.orca.calls(), 'terminal wait').length;
  await box.orca.set({ hang: { command: 'terminal wait', ms: 30_000, after: 1, from } });

  const result = await send(box, RECEIVERS.claude);

  const answer = answerOf(result);
  assert.equal(answer.sent, true, `the mail went: ${JSON.stringify(answer)}`);
  assert.ok(result.tookMs < WATCH_MS + 15_000, `the send came back in bounded time, took ${result.tookMs} ms`);
});

// ------------------------------------- S4: nothing typed for the old reasons

for (const [what, waitIdle, field] of [
  ['a tab with no harness in it (not up)', false, undefined],
  ['a tab with a question on screen', 'blocked', 'blocked'],
]) {
  test(`S4 ${what}: nothing typed, as before, and no signal in the answer`, async (t) => {
    const box = await createSandbox(t);
    await fleetIn(box);
    await box.orca.set({ waitIdle });

    const answer = answerOf(await send(box, RECEIVERS.claude));

    assert.equal(answer.sent, true, `the mail went: ${JSON.stringify(answer)}`);
    assert.equal(answer.nudged, false, `nothing typed: ${JSON.stringify(answer)}`);
    assert.equal('signal' in answer, false, `no signal went, so none is named: ${JSON.stringify(answer)}`);
    if (field !== undefined) assert.equal(typeof answer[field], 'string', `the old answer stays: ${JSON.stringify(answer)}`);
    await assertNothingTyped(box);
  });
}

// --------------------- S2 S3: the whole 8 s, side by side to keep the cost down

/** When the line went into the tab, and when the mail was posted, from the fake Orca's clock. */
async function lineAfterPostMs(box, tab) {
  const handle = (await box.orca.terminals()).find((one) => one.tabId === tab).handle;
  const clock = await box.orca.clock();
  const posted = clock.find((call) => orcaCommand(call) === 'orchestration send');
  const typed = clock.findLast((call) => orcaCommand(call) === 'terminal send' && orcaFlag(call, '--terminal') === handle);
  assert.ok(posted && typed, `the premise: the mail was posted and a line typed: ${JSON.stringify(clock.map((call) => call.args.slice(0, 2)))}`);
  return typed.at - posted.at;
}

/** A send that watched the whole 8 s, saw no turn, and typed the line after it. */
async function assertNoTurnLine(box, fleet, receiver, result) {
  const answer = answerOf(result);
  assertSignal(answer, 'line', 'no-turn');
  assert.equal(typeof answer.watchedMs, 'number', `the answer says how long it watched: ${JSON.stringify(answer)}`);
  assert.ok(answer.watchedMs >= WATCH_MS - 500, `it watched the whole 8 s, got watchedMs ${answer.watchedMs}`);
  assert.ok(result.tookMs >= WATCH_MS - 500, `the send took the 8 s, got ${result.tookMs} ms`);
  assert.ok(await lineAfterPostMs(box, fleet.tabs[receiver.bot]) >= WATCH_MS - 500, 'the line went in after the watch, not before it');
  await assertOneLine(box, fleet, receiver);
}

describe('the whole 8 s watch, with no turn', { concurrency: true }, () => {
  for (const receiver of Object.values(RECEIVERS)) {
    test(`S2 an idle ${receiver.harness} receiver that starts no turn in 8 s gets the line after the watch: line, no-turn`, async (t) => {
      const box = await createSandbox(t);
      const fleet = await fleetIn(box);

      await assertNoTurnLine(box, fleet, receiver, await send(box, receiver));
    });
  }

  test('S2 S5 the plain answer for no turn in 8 s says the line was typed, and names the 8 s', async (t) => {
    const box = await createSandbox(t);
    const fleet = await fleetIn(box);

    const result = await send(box, RECEIVERS.codex, { plain: true });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /8 s/, `it names the 8 s, got:\n${result.stdout}`);
    assert.match(result.stdout, /typed/, `and says the line was typed, got:\n${result.stdout}`);
    await assertOneLine(box, fleet, RECEIVERS.codex);
  });

  test('S2 Orca\'s notice that was in the record before the send does not count: line, no-turn', async (t) => {
    const box = await createSandbox(t);
    const fleet = await fleetIn(box);
    // An earlier mail's notice, for this same mailbox, taken as a turn an hour ago.
    const earlier = new Date(Date.now() - 3_600_000).toISOString();
    await writeFile(fleet.records.writer, `${JSON.stringify({
      type: 'user',
      message: { role: 'user', content: `You have 1 orchestration message. Run \`orca orchestration check --run ${fleet.mailboxes.writer}\`` },
      timestamp: earlier,
    })}\n`, { flag: 'a' });

    await assertNoTurnLine(box, fleet, RECEIVERS.claude, await send(box, RECEIVERS.claude));
  });

  for (const [how, spoil] of Object.entries(UNREADABLE)) {
    for (const receiver of Object.values(RECEIVERS)) {
      test(`S3 an idle ${receiver.harness} receiver whose record is ${how} and that starts no turn gets the line after 8 s: line, no-turn`, async (t) => {
        const box = await createSandbox(t);
        const fleet = await fleetIn(box);
        await spoil(fleet.records[receiver.bot]);

        await assertNoTurnLine(box, fleet, receiver, await send(box, receiver));
      });
    }
  }

  // R1's last sentence: a record readable when the send took its mark, and
  // not by the watch's first look (removed, its mode 000, a folder in its
  // place), with no notice and no turn, counts as "the notice was not seen":
  // the line after the watch, never "orca". The review of PR #514's hand
  // mutation check: a record read that throws must not count as the notice.
  for (const [how, spoil] of [['removed', 'remove'], ['made unreadable (mode 000)', 'mode000'], ['replaced by a folder', 'folder']]) {
    for (const receiver of Object.values(RECEIVERS)) {
      const asRoot = spoil === 'mode000' && process.getuid?.() === 0 && 'runs as root, which reads a file whatever its mode';
      test(`S3 an idle ${receiver.harness} receiver whose record is ${how} during the watch, with no notice and no turn, gets the line after 8 s: line, no-turn`, { skip: asRoot }, async (t) => {
        const box = await createSandbox(t);
        const fleet = await fleetIn(box);
        await reacts(box, fleet, receiver, { busy: false, text: null, spoil });

        const result = await send(box, receiver);

        const fired = (await box.orca.terminals()).find((one) => one.tabId === fleet.tabs[receiver.bot]).afterMail?.fired;
        assert.equal(fired, true, `the premise: the record went unreadable at the watch's first look: ${result.stdout}`);
        await assertNoTurnLine(box, fleet, receiver, result);
      });
    }
  }

  test('S3 an idle Claude Code receiver whose book holds no conversation at all gets the line after 8 s: line, no-turn', async (t) => {
    const box = await createSandbox(t);
    const fleet = await fleetIn(box, { records: false });
    assert.equal((await sessionIn(fleet.bots, 'writer', 'daily')).session, undefined, 'the premise: the book holds no conversation for it');

    await assertNoTurnLine(box, fleet, RECEIVERS.claude, await send(box, RECEIVERS.claude));
  });
});
