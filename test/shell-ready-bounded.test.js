// The kit's wait for a new tab's shell to be ready is bounded in time, whatever
// its readers do (#498, the review of PR #499).
//
// The reviewer's case: an stty that answered "ready" only after 18 s let `up`
// type the launch line after 19.9 s and exit 0. What these tests pin, through
// `obk up`:
//
//   - Every call the readiness check makes (Orca's `terminal show` and
//     `diagnostics memory`, ps, lsof, stty) is given at most what is left of the
//     15 s wait. A call that does not answer in that time ends the look: the
//     kit could not tell whether the shell is ready, and says why.
//   - A "ready" that comes after the wait has run out is too late: nothing is
//     typed, and the tab is reported `launched: false`.
//   - So the command ends: it exits 1, with nothing typed into the tab, about
//     15 s after the tab was opened plus a few seconds (the refusal may read the
//     tab's screen once more, for about 5 s at most).
//   - A reader that is slow but answers well inside the wait is not cut off.
//
// The fake lsof and stty hold their answers back by `lsofDelayMs` and
// `sttyDelayMs` (helpers/fake-tty.js); the fake Orca holds back one command's
// answers with `hang` (helpers/fake-orca.js). Each refusal costs the wait in
// real time, so the tests run side by side.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createSandbox, orcaCallsOf, orcaFlag } from './helpers/cli.js';
import {
  assertInBook,
  assertLaunched,
  assertNotLaunched,
  entryOf,
  fleet,
  ok,
  READY_WAIT_MS,
  reported,
  SHELL_ASKING,
} from './helpers/shell-ready.js';

/** The most a refused launch may take after its tab was opened: the wait, one more read of the screen, and room for a busy machine. */
const BOUND_MS = READY_WAIT_MS + 5000 + 7000;

/** "could not tell", in any of the plain ways to say it. */
const COULD_NOT_TELL_AT_ALL = /(could not|couldn't|cannot|can't|was unable to|is unable to) tell/i;

/** When the tab the entry names was created, in ms since the epoch. */
async function createdAt(box, entry) {
  const calls = await box.orca.calls();
  const clock = await box.orca.clock();
  const at = calls.findIndex((call) => orcaCallsOf([call], 'terminal create').length === 1 && orcaFlag(call, '--title') === entry.title);
  assert.ok(at >= 0, `the fake Orca should have been asked to create ${entry.title}`);
  return clock[at].at;
}

/**
 * Bring up coder/review with its readers as `state` says, insist the run
 * refused the tab and ended in time, and give back the reason.
 */
async function refusedInTime(t, state) {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await box.orca.set(typeof state === 'function' ? await state(box) : state);

  const result = await reported(box, ['up', '--bots', 'bots', '--bot', 'coder', '--json']);
  const ended = Date.now();

  assert.equal(result.code, 1, `a tab that was not launched makes the run fail, got ${result.code}:\n${result.stderr}`);
  const entry = entryOf(result, 'coder', 'review');
  const why = await assertNotLaunched(box, entry);
  await assertInBook(bots, entry);
  const took = ended - await createdAt(box, entry);
  assert.ok(took <= BOUND_MS, `up ended ${took} ms after the tab was opened; the wait is ${READY_WAIT_MS} ms`);
  assert.match(why, COULD_NOT_TELL_AT_ALL, `the kit could not tell in time, got: ${why}`);
  assert.doesNotMatch(why, SHELL_ASKING, `nothing said the shell was asking, got: ${why}`);
  return why;
}

/** Orca holds back every answer to `command` from the next `terminal create` on: a call on the new tab that hangs. */
const hangOnTheNewTab = (command) => async (box) => ({
  hang: {
    command,
    ms: 60000,
    since: 'terminal create',
    sinceFrom: orcaCallsOf(await box.orca.calls(), 'terminal create').length,
  },
});

describe('#498 the wait for a ready shell is bounded, whatever its readers do', { concurrency: true }, () => {
  test('#498 an stty that answers "ready" only after the wait: nothing is typed, and up ends in time', async (t) => {
    // The reviewer's case: 18 s, longer than the whole wait.
    const why = await refusedInTime(t, { byName: { review: { sttyDelayMs: 18000 } } });

    assert.match(why, /stty|time/i, `with the reason, got: ${why}`);
  });

  test('#498 an lsof that never answers: nothing is typed, and up ends in time', async (t) => {
    const why = await refusedInTime(t, { lsofDelayMs: 60000 });

    assert.match(why, /lsof/i, `with the reason, got: ${why}`);
  });

  for (const command of ['terminal show', 'diagnostics memory']) {
    test(`#498 Orca's ${command} hangs once the tab is opened: nothing is typed, and up ends in time`, async (t) => {
      const why = await refusedInTime(t, hangOnTheNewTab(command));

      assert.match(why, /orca|diagnostics|terminal show/i, `with the reason, got: ${why}`);
    });
  }

  test('#498 an stty that is slow but answers well inside the wait: the line is typed, as ever', async (t) => {
    const box = await createSandbox(t);
    await fleet(box);
    await box.orca.set({ byName: { review: { sttyDelayMs: 2000 } } });

    const result = await ok(box, ['up', '--bots', 'bots', '--bot', 'coder', '--json']);

    await assertLaunched(box, entryOf(result, 'coder', 'review'));
  });
});
