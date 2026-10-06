// Each reason a new tab is not launched is named in the result (#498).
//
// The kit types the launch line only into a tab whose shell is in front and
// whose tty is in line-editor mode. When that is not so 15 s after the tab was
// opened, nothing is typed, the run exits 1, and the tab's entry says
// `launched: false` with one sentence in `notLaunched`:
//
//   - the shell in front, the tty not in line-editor mode: "the shell is
//     asking", with the last row of the tab's screen that is not empty, or,
//     when the screen cannot be read, that it could not be read;
//   - a program other than the shell in front: the sentence names it;
//   - the kit could not read the tty or who is in front (lsof fails or names
//     no tty, stty fails, the front cannot be read): the sentence says the kit
//     could not tell whether the shell is ready, and why.
//
// The tty is the one lsof lists on the shell under the pane, or on the pane
// itself when the pane is the shell.
//
// Who is in front comes from `ps`, or from Orca's runtime where `ps` cannot
// run (#298): a ready shell found that way is launched as ever.
//
// Every refusal here costs the kit's 15 s wait, so the tests run side by side.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createSandbox, orcaApp } from './helpers/cli.js';
import {
  ASKING_ROW,
  ASKING_SCREEN,
  assertInBook,
  assertLaunched,
  assertNotLaunched,
  COULD_NOT_TELL,
  entryOf,
  fleet,
  ok,
  reported,
  SHELL_ASKING,
} from './helpers/shell-ready.js';

/** Bring up coder/review with its new tab as `settings` say, and insist the run failed on it. Returns the sentence and the bots folder. */
async function heldBack(t, settings, state = {}) {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await box.orca.set({ ...state, byName: { review: settings } });

  const result = await reported(box, ['up', '--bots', 'bots', '--bot', 'coder', '--json']);

  assert.equal(result.code, 1, `a tab that was not launched makes the run fail, got ${result.code}:\n${result.stderr}`);
  const entry = entryOf(result, 'coder', 'review');
  const why = await assertNotLaunched(box, entry);
  await assertInBook(bots, entry);
  return why;
}

describe('#498 why a new tab was not launched', { concurrency: true }, () => {
  test('#498 the shell is asking: the reason gives the last row of the screen that is not empty', async (t) => {
    const why = await heldBack(t, { tty: 'question', screen: ASKING_SCREEN });

    assert.match(why, SHELL_ASKING);
    assert.ok(why.includes(ASKING_ROW), `got: ${why}`);
    assert.ok(!why.includes(ASKING_SCREEN[0]), `the last row with text on it, not the first, got: ${why}`);
  });

  test('#498 the shell is asking and its screen cannot be read: the reason still says it is asking, and that the screen could not be read', async (t) => {
    const why = await heldBack(t, { tty: 'question' }, {
      fail: { 'terminal read': { code: 'runtime_error', message: 'the renderer is not attached' } },
    });

    assert.match(why, SHELL_ASKING);
    assert.match(why, /screen/i, `the reason speaks of the screen, got: ${why}`);
    assert.match(why, /(could not|couldn't|cannot|can't|unable to|not) (be )?read|unreadable/i, `and says it could not be read, got: ${why}`);
  });

  test('#498 a program other than the shell in front: the reason names it', async (t) => {
    // `less`, as any program the shell's start-up ran would be.
    const why = await heldBack(t, { front: 'program' });

    assert.match(why, /\bless\b/, `the reason names the program in front, got: ${why}`);
    assert.doesNotMatch(why, SHELL_ASKING, `it is not the shell that is asking, got: ${why}`);
  });

  test('#498 lsof cannot read the pane: the kit could not tell whether the shell is ready, and says lsof failed', async (t) => {
    const why = await heldBack(t, { tty: 'lsof-fails' });

    assert.match(why, COULD_NOT_TELL);
    assert.match(why, /lsof/i, `with the reason, got: ${why}`);
  });

  test('#498 lsof names no tty on the pane\'s fd 0: the kit could not tell whether the shell is ready, and says there was no tty', async (t) => {
    const why = await heldBack(t, { tty: 'no-tty' });

    assert.match(why, COULD_NOT_TELL);
    assert.match(why, /\btty\b|terminal device|\/dev\/null/i, `with the reason, got: ${why}`);
  });

  test('#498 stty cannot read the tty: the kit could not tell whether the shell is ready, and says stty failed', async (t) => {
    const why = await heldBack(t, { tty: 'stty-fails' });

    assert.match(why, COULD_NOT_TELL);
    assert.match(why, /stty/i, `with the reason, got: ${why}`);
  });

  test('#498 ps cannot read the pane, and no Orca runtime says who is in front: the kit could not tell whether the shell is ready', async (t) => {
    const why = await heldBack(t, { front: 'ps-fails' });

    assert.match(why, COULD_NOT_TELL);
    assert.doesNotMatch(why, SHELL_ASKING, `nothing says the shell is asking, got: ${why}`);
  });

  test('#498 Orca\'s diagnostics give no pane for the tab: the kit could not tell whether the shell is ready', async (t) => {
    const why = await heldBack(t, { front: 'no-pid' });

    assert.match(why, COULD_NOT_TELL);
  });

  test('#498 Orca refuses its diagnostics, so the pane is unknown: the kit could not tell whether the shell is ready', async (t) => {
    const why = await heldBack(t, {}, {
      fail: { 'diagnostics memory': { code: 'runtime_error', message: 'diagnostics unavailable' } },
    });

    assert.match(why, COULD_NOT_TELL);
  });

  test('#498 a pane that is the shell itself, at a ready prompt: its own record gives the tty, and the line is typed', async (t) => {
    const box = await createSandbox(t);
    await fleet(box);
    await box.orca.set({ byName: { review: { front: 'bare-shell' } } });

    const result = await ok(box, ['up', '--bots', 'bots', '--bot', 'coder', '--json']);

    await assertLaunched(box, entryOf(result, 'coder', 'review'));
  });

  test('#498 ps may not run, and Orca\'s runtime says the shell is in front of a ready tty: the line is typed', async (t) => {
    // Inside Codex's sandbox /bin/ps does not start (#298); Orca's runtime says
    // who is in front instead.
    const box = await createSandbox(t);
    await fleet(box);
    await orcaApp(box);
    await box.orca.set({ ps: 'not-permitted' });

    const result = await ok(box, ['up', '--bots', 'bots', '--bot', 'coder', '--json']);

    await assertLaunched(box, entryOf(result, 'coder', 'review'));
  });
});
