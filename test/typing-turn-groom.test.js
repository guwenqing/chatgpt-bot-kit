// The grooming line waits its turn to type (#482).
//
// The owner's intent on #482: two kit paths never type into the same
// session's tab at once, since each kit line is a whole line with its own
// Return, and one that lands in the middle of another submits a mixed line.
// #480 gave each session a typing turn (helpers/typing-turn.js); the naming
// and the mail nudge take it (typing-turn.test.js). The boundary, in the
// owner's words: "every kit path that types into a session's tab takes #480's
// typing turn. When it's held, a path waits a short, bounded time, then
// reports 'not typed: the kit is typing into it' through the trouble report it
// already has, and types nothing."
//
// This file is the grooming line: `obk groom` with `--on`, `--off`, `--now` or
// `--compact` types one line into Bot Father's `grooming` tab
// (groom.test.js). Before it types, it takes the grooming session's typing
// turn, waiting the same 5 s as the nudge:
//
//   - not got: refused as groom refuses today, a non-zero exit with the
//     reason on stderr, which says the kit is typing into it and that nothing
//     was typed; and nothing is typed into any tab;
//   - got within the 5 s (here let go after about 1 s): the line is typed as
//     it is today;
//   - per session: a turn held for another session of Bot Father does not
//     stop it.
//
// The turn is held from the test process, as typing-turn.test.js holds it.
// Every run is in the sandbox, with a fake Orca.

import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, it } from 'node:test';

import { createSandbox, recordSession, sentInto, sessionIn } from './helpers/cli.js';
import { withTypingTurnHeld } from './helpers/typing-turn.js';

/** The words the refusal gives for a line the turn kept out. */
const TYPING = /the kit is typing into it/;

/** A conversation id in the shape Claude Code gives one. */
const CONV = '0199b2c0-0001-4444-8888-cccccccccccc';

/** The flags that type a line, each with no grooming job needed for it. */
const TYPING_FLAGS = [['--on', '--at', '04:00'], ['--off'], ['--now'], ['--compact']];

/** A hard limit for each test, so a wait that never ends fails here rather than hangs the run. */
const LIMIT = { timeout: 120_000 };

/**
 * A bots folder with a Claude Bot Father and its `grooming` session, brought
 * up, with a conversation its hook reported, so the book holds it.
 */
async function fleet(box) {
  const init = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(init.code, 0, init.stderr);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', 'bot-father', '--name', 'grooming']);
  assert.equal(added.code, 0, added.stderr);
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  const bots = box.path('bots');
  const tab = (await sessionIn(bots, 'bot-father', 'grooming')).tab;
  const told = await recordSession(box, { bots, bot: 'bot-father', tab, session: CONV, source: 'startup' });
  assert.equal(told.code, 0, told.stderr);
  return bots;
}

/** `obk groom --bots bots <flags>`, plain. */
const run = (box, ...flags) => box.run(['groom', '--bots', 'bots', ...flags]);

/** Every `terminal send` so far into every tab Orca has, by tab id. */
async function sendsByTab(box) {
  return Object.fromEntries((await box.orca.terminals()).map((terminal) => [terminal.tabId, sentInto(terminal)]));
}

/** What has been sent since `before`, by tab id, for the tabs that got anything. */
async function sentSince(box, before) {
  const sent = {};
  for (const [tab, sends] of Object.entries(await sendsByTab(box))) {
    const since = sends.slice((before[tab] ?? []).length);
    if (since.length > 0) sent[tab] = since;
  }
  return sent;
}

/** Exactly one line typed since `before`, into the grooming tab, with a return, and nothing anywhere else. */
async function assertOneLineTyped(box, bots, before, what) {
  const sent = await sentSince(box, before);
  const tab = (await sessionIn(bots, 'bot-father', 'grooming')).tab;
  assert.deepEqual(Object.keys(sent), [tab], `${what}: one tab typed into, the grooming session's; got: ${JSON.stringify(sent)}`);
  assert.equal(sent[tab].length, 1, `${what}: exactly one line, got: ${JSON.stringify(sent[tab])}`);
  assert.equal(sent[tab][0].enter, true, `${what}: sent off with return`);
}

describe('the grooming line and the typing turn, side by side', { concurrency: true }, () => {
  for (const flags of TYPING_FLAGS) {
    it(`groom ${flags.join(' ')} with the grooming session's typing turn held: refused, nothing typed, and stderr says the kit is typing into it and nothing was typed`, LIMIT, async (t) => {
      const box = await createSandbox(t);
      const bots = await fleet(box);
      const before = await sendsByTab(box);

      const started = Date.now();
      const result = await withTypingTurnHeld(bots, 'bot-father', 'grooming', () => run(box, ...flags));
      const took = Date.now() - started;

      assert.deepEqual(await sentSince(box, before), {}, 'nothing may be typed into any tab while the grooming turn is held');
      assert.equal(typeof result.code, 'number', 'it should exit, not be killed');
      assert.notEqual(result.code, 0, `it should be refused, got:\n${result.stdout}${result.stderr}`);
      assert.ok(!/^\s+at /m.test(result.stderr), `expected a reason, got a crash:\n${result.stderr}`);
      assert.match(result.stderr, TYPING, `the refusal says the kit is typing into it, got:\n${result.stderr}`);
      assert.match(result.stderr, /nothing was typed/i, `and that nothing was typed, got:\n${result.stderr}`);
      assert.ok(took < 30_000, `the wait for the turn is bounded; groom took ${took} ms`);
    });
  }

  it('groom --now with the grooming turn let go after about 1 s: the line is typed as today, and nothing before the turn was free', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    const before = await sendsByTab(box);

    let whileHeld;
    const result = await withTypingTurnHeld(bots, 'bot-father', 'grooming', async (release) => {
      const going = run(box, '--now');
      await sleep(1_000);
      whileHeld = await sentSince(box, before);
      release();
      return going;
    });

    assert.equal(result.code, 0, `groom --now goes through once the turn is free: ${result.stdout}${result.stderr}`);
    assert.deepEqual(whileHeld, {}, 'nothing was typed while the turn was held');
    await assertOneLineTyped(box, bots, before, 'the turn let go');
  });

  it('Bot Father\'s daily typing turn held does not hold up the grooming line', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    const before = await sendsByTab(box);

    const result = await withTypingTurnHeld(bots, 'bot-father', 'daily', () => run(box, '--now'));

    assert.equal(result.code, 0, `daily's turn is not grooming's: ${result.stdout}${result.stderr}`);
    await assertOneLineTyped(box, bots, before, 'daily\'s turn held');
  });
});
