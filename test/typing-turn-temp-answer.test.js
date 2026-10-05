// `obk temp answer` waits its turn to type (#489, point 4 of the brief; the
// rule of #482).
//
// Every kit path that types into a session's tab takes that session's typing
// turn (#480, helpers/typing-turn.js), so two kit paths never type into one tab
// at once. `obk temp answer` (temp-answer.test.js) reads a temporary session's
// screen and sends Esc to Claude Code's "Teach auto mode about your
// environment?" form. It takes the session's turn for the look and the key, as
// `obk temp trust-hooks` does (typing-turn-trust-hooks.test.js):
//
//   - not got: nothing is typed into any tab, and it is refused, a non-zero
//     exit with the reason on stderr, which says the kit is typing into it and
//     that nothing was typed;
//   - got within the wait (here let go after about 1 s): it answers the form;
//   - per session: one held for another session of the bot (here the maker's
//     own) does not stop it.
//
// The turn is held from the test process, as typing-turn.test.js holds it.
// Every run is in the sandbox, with a fake Orca that shows the session's tab
// the captured form and moves on at the next key (`screenAfterSend`).

import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, it } from 'node:test';

import { createSandbox, kitLaunchMark, sentInto, sessionIn } from './helpers/cli.js';
import { CLAUDE_ANSWERED, CLAUDE_TEACH_FORM } from './helpers/screens.js';
import { withTypingTurnHeld } from './helpers/typing-turn.js';

/** The words the refusal gives for keys the turn kept out. */
const TYPING = /the kit is typing into it/;

const BOT = 'temp-bot';
const TASK = 'Read the open pull request and write down what it changes.';

/** Esc, alone: "Not now" on the Teach form. */
const ESC = '\x1b';

/** A hard limit for each test, so a wait that never ends fails here rather than hangs the run. */
const LIMIT = { timeout: 120_000 };

/** The environment of a command a session's harness runs in `terminal`. */
const inTab = (box, terminal) => ({ ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId, ...kitLaunchMark(box, terminal) });

/** The terminal Orca has for a session of the bot, by the book's tab. */
async function tabOf(box, bots, name) {
  const tab = (await sessionIn(bots, BOT, name))?.tab;
  const found = (await box.orca.terminals()).find((one) => one.tabId === tab);
  assert.ok(found, `Orca should have ${BOT}/${name}'s tab ${tab}`);
  return found;
}

/**
 * A bots folder with temp-bot on Claude Code, its session planner brought up,
 * and a temporary Claude session drafter that planner made, whose tab shows the
 * captured Teach form and moves on at the next key.
 */
async function fleet(box) {
  const ok = async (args, env) => {
    const result = await box.run(args, env === undefined ? {} : { env });
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  await ok(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'planner']);
  await ok(['up', '--bots', 'bots', '--bot', BOT]);
  const bots = box.path('bots');
  const planner = await tabOf(box, bots, 'planner');
  await ok(['temp', 'make', '--bots', 'bots', '--name', 'drafter', '--prompt', TASK], inTab(box, planner));
  const drafter = (await sessionIn(bots, BOT, 'drafter')).tab;
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.tabId === drafter
      ? { ...terminal, screen: CLAUDE_TEACH_FORM, screenAfterSend: CLAUDE_ANSWERED }
      : terminal)),
  });
  return { bots, planner, drafter };
}

/** Every `terminal send` so far into every tab, by tab id. */
async function sendsByTab(box) {
  return Object.fromEntries((await box.orca.terminals()).map((terminal) => [terminal.tabId, sentInto(terminal)]));
}

/** What was sent since `before`, by tab id, for the tabs that got anything. */
async function sentSince(box, before) {
  const sent = {};
  for (const [tab, sends] of Object.entries(await sendsByTab(box))) {
    const since = sends.slice((before[tab] ?? []).length);
    if (since.length > 0) sent[tab] = since;
  }
  return sent;
}

/** `obk temp answer --bots bots --name drafter`, run in planner's tab. */
const answerDrafter = (box, planner) => box.run(['temp', 'answer', '--bots', 'bots', '--name', 'drafter'], { env: inTab(box, planner) });

/** The form answered: exit 0, Esc alone into drafter's tab and no other, with no --enter. */
async function assertAnswered(box, result, before, drafter, what) {
  assert.equal(result.code, 0, `${what}: it answers the form:\n${result.stdout}${result.stderr}`);
  const sent = await sentSince(box, before);
  assert.deepEqual(Object.keys(sent), [drafter], `${what}: keys go into the session's tab and no other: ${JSON.stringify(sent)}`);
  assert.ok(sent[drafter].every((one) => one.enter === false), `${what}: with no --enter: ${JSON.stringify(sent[drafter])}`);
  assert.equal(sent[drafter].map((one) => one.text).join(''), ESC, `${what}: Esc alone`);
}

describe('temp answer and the typing turn, side by side', { concurrency: true }, () => {
  it('drafter\'s typing turn held for the whole run: refused, nothing typed into any tab, and stderr says the kit is typing into it and nothing was typed', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box);
    const before = await sendsByTab(box);

    const started = Date.now();
    const result = await withTypingTurnHeld(bots, BOT, 'drafter', () => answerDrafter(box, planner));
    const took = Date.now() - started;

    assert.deepEqual(await sentSince(box, before), {}, 'nothing may be typed into any tab while drafter\'s turn is held');
    assert.equal(typeof result.code, 'number', 'it should exit, not be killed');
    assert.notEqual(result.code, 0, `it should be refused, got:\n${result.stdout}${result.stderr}`);
    assert.ok(!/^\s+at /m.test(result.stderr), `expected a reason, got a crash:\n${result.stderr}`);
    assert.match(result.stderr, TYPING, `the refusal says the kit is typing into it, got:\n${result.stderr}`);
    assert.match(result.stderr, /nothing was typed/i, `and that nothing was typed, got:\n${result.stderr}`);
    assert.ok(took < 30_000, `the wait for the turn is bounded; it took ${took} ms`);
  });

  it('drafter\'s typing turn let go after about 1 s: nothing typed while it was held, then the form is answered', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, planner, drafter } = await fleet(box);
    const before = await sendsByTab(box);

    let whileHeld;
    const result = await withTypingTurnHeld(bots, BOT, 'drafter', async (release) => {
      const run = answerDrafter(box, planner);
      await sleep(1_000);
      whileHeld = await sentSince(box, before);
      release();
      return run;
    });

    assert.deepEqual(whileHeld, {}, 'nothing was typed while drafter\'s turn was held');
    await assertAnswered(box, result, before, drafter, 'the turn let go');
  });

  it('the maker planner\'s typing turn held does not hold up the answer to drafter\'s form', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const { bots, planner, drafter } = await fleet(box);
    const before = await sendsByTab(box);

    const result = await withTypingTurnHeld(bots, BOT, 'planner', () => answerDrafter(box, planner));

    await assertAnswered(box, result, before, drafter, 'planner\'s turn is not drafter\'s');
  });
});
