// The mail nudge waits its turn to type (#480).
//
// The architect's ruling on #480 (2026-10-04): one typing turn per session, a
// lock beside its mailbox turn (helpers/typing-turn.js), which any kit path
// typing into the session's tab takes. The naming of a Codex thread takes it
// (session-name.test.js); so does the mail nudge, the one kit line that
// arrives at random times. In `obk message send` to a session, before it
// types its line, the nudge takes the receiver's typing turn, waiting up to
// 5 s:
//
//   - got within the 5 s: the nudge is typed as it is today;
//   - not got: nothing is typed into the tab, and the answer's `nudgeTrouble`
//     says "the kit is typing into it". The send still succeeds: the message
//     is in the receiver's mailbox, as when a nudge cannot be typed today.
//
// The turn is per session: one held for another session of the same bot does
// not hold this one up. The Codex PostToolUse nudge hook types through the
// same nudge, and is tested beside its other cases in
// nudge-left-for-hook.test.js.
//
// The turn is held from the test process, as mailbox-turns.test.js holds the
// mailbox turn. Every run is in the sandbox, with a fake Orca.

import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';

import { createSandbox, sessionIn, typedInto } from './helpers/cli.js';
import { withTypingTurnHeld } from './helpers/typing-turn.js';

/** The words the answer gives for a nudge the turn kept out. */
const TYPING = /the kit is typing into it/;

/** A Claude bot that writes and a Codex bot `coder` with `daily` and `nightly`, all up, nothing typed since. */
async function fleetIn(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness, sessions] of [['writer', 'claude', ['daily']], ['coder', 'codex', ['daily', 'nightly']]]) {
    assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness])).code, 0);
    for (const session of sessions) {
      assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', session])).code, 0);
    }
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
}

/** Send one message from the writer to coder's daily, with any more flags. */
const send = (box, args = []) => box.run([
  'message', 'send', '--bots', 'bots', '--to', 'coder/daily', '--from', 'writer/daily',
  '--subject', 'the staging host', '--text', 'It is down again.', ...args,
]);

/** What was typed into every tab of the whole fleet, after the launch line each one got. */
async function typedSinceLaunch(box) {
  const after = {};
  for (const terminal of await box.orca.terminals()) after[terminal.tabId] = typedInto(terminal).slice(1);
  return after;
}

/** The JSON a send answered with, which must have gone through. */
function answered(result) {
  assert.equal(result.code, 0, `the message goes whatever becomes of the nudge: ${result.stdout}${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    return assert.fail(`--json should print JSON, got:\n${result.stdout}`);
  }
}

/** One line typed into coder daily's tab, and nothing anywhere else. */
async function assertNudgedOnly(box, bots, what) {
  const typed = await typedSinceLaunch(box);
  const reader = (await sessionIn(bots, 'coder', 'daily')).tab;
  assert.equal(typed[reader].length, 1, `${what}: one line into the receiver's tab, got: ${JSON.stringify(typed[reader])}`);
  for (const [tab, lines] of Object.entries(typed)) {
    if (tab !== reader) assert.deepEqual(lines, [], `${what}: nothing may be typed into ${tab}`);
  }
}

test('the receiver\'s typing turn held for longer than 5 s: the message is sent, nothing is typed, and nudgeTrouble says the kit is typing into it', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);

  const started = Date.now();
  const result = await withTypingTurnHeld(bots, 'coder', 'daily', () => send(box, ['--json']));
  const took = Date.now() - started;

  const answer = answered(result);
  assert.equal(answer.sent, true, `the message is sent, got: ${result.stdout}`);
  assert.equal((await box.orca.messages()).length, 1, 'and it is in the mailbox');
  assert.equal(answer.nudged, false, `no nudge was typed, got: ${result.stdout}`);
  assert.match(String(answer.nudgeTrouble), TYPING, `nudgeTrouble says why, got: ${JSON.stringify(answer)}`);
  assert.deepEqual(Object.values(await typedSinceLaunch(box)).flat(), [], 'nothing was typed into any tab');
  assert.ok(took >= 4_000, `it waited for the turn, up to 5 s, before giving up; it took ${took} ms`);
  assert.ok(took < 30_000, `and the wait is bounded; it took ${took} ms`);
});

test('the receiver\'s typing turn held, plain: the run says the kit is typing into the tab, the message is sent, and nothing is typed', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);

  const result = await withTypingTurnHeld(bots, 'coder', 'daily', () => send(box));

  assert.equal(result.code, 0, `the message went; only the nudge did not: ${result.stdout}${result.stderr}`);
  assert.equal((await box.orca.messages()).length, 1, 'the message is in the mailbox');
  assert.ok(result.stdout.split('\n').some((line) => TYPING.test(line)), `a line says the kit is typing into the tab, got:\n${result.stdout}`);
  assert.deepEqual(Object.values(await typedSinceLaunch(box)).flat(), [], 'nothing was typed into any tab');
});

test('the receiver\'s typing turn let go within the 5 s: the nudge is typed as today', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);

  const result = await withTypingTurnHeld(bots, 'coder', 'daily', async (release) => {
    const run = send(box, ['--json']);
    await sleep(1_500);
    release();
    return run;
  });

  const answer = answered(result);
  assert.equal(answer.nudged, true, `the nudge was typed once the turn was free, got: ${result.stdout}`);
  assert.equal('nudgeTrouble' in answer, false, `nothing went wrong with it, got: ${result.stdout}`);
  await assertNudgedOnly(box, bots, 'the turn let go');
});

test('another session\'s typing turn held does not hold up this session\'s nudge', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);

  const result = await withTypingTurnHeld(bots, 'coder', 'nightly', () => send(box, ['--json']));

  const answer = answered(result);
  assert.equal(answer.nudged, true, `nightly's turn is not daily's, got: ${result.stdout}`);
  await assertNudgedOnly(box, bots, 'nightly\'s turn held');
});
