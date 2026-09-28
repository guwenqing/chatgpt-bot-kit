// The one Orca every system test talks to, and the check that it closed no tab
// but its own.
//
// The machine a system test runs on is shared: the owner's other sessions open
// and close their own tabs while it runs. So "a tab open before this test is gone
// now" says nothing about the test. What does is what the test itself closed:
// every `terminal close` it asked Orca for, and every tab the kit said it closed
// for it. A tab among those that the test did not create (by its own `terminal
// create`, or by a kit answer that says it opened the tab) was not the test's to
// close, and that fails, whenever it was opened: another process can open a tab
// in the test's own project while it runs (#357). One gone that the test did not
// close is reported, not failed (#246).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

/**
 * An Orca for one system test file, run as `cli`, that keeps count of the tabs
 * it closes. `env` is what the CLI is spawned with.
 */
export function tabGuard(cli, { env = process.env } = {}) {
  const closed = [];
  const created = new Set();

  /** Ask Orca something and read its JSON. Never the blanket close, on any road. */
  function orca(args) {
    assert.ok(
      !(args.includes('--all') && args.includes('close')),
      `refusing to run \`orca ${args.join(' ')}\`: it would take away someone else's tabs`,
    );
    // Counted as asked, before Orca answers: a close that failed half way may
    // still have taken the tab.
    if (args[0] === 'terminal' && args[1] === 'close') {
      const at = args.indexOf('--terminal');
      if (at !== -1 && at + 1 < args.length) closed.push(args[at + 1]);
    }
    const done = spawnSync(cli, [...args, '--json'], { encoding: 'utf8', env });
    assert.equal(done.error, undefined, `could not run ${cli}: ${done.error?.message}`);
    let answer;
    try {
      answer = JSON.parse(done.stdout);
    } catch {
      assert.fail(`orca ${args.join(' ')} did not answer JSON: ${done.stdout}${done.stderr}`);
    }
    if (args[0] === 'terminal' && args[1] === 'create' && answer.ok === true) created.add(answer.result.terminal.handle);
    return answer;
  }

  /** Every tab an `obk --json` answer says the kit opened for this test. Gives the answer back. */
  function openedByKit(answer) {
    for (const tab of answer?.tabs ?? []) {
      if (tab.created === true) created.add(tab.terminal);
    }
    return answer;
  }

  /** The tabs the kit said it closed for this test: the `closed` of a restart, pause or retire. */
  function closedByKit(entries = []) {
    for (const entry of entries ?? []) closed.push(entry.terminal);
  }

  /**
   * A teardown's close: every tab this test created that is open at one of
   * `homes` (the path a tab was opened in), closed one by one by its handle,
   * and every other tab open there named, not closed (review of PR #425).
   * Answers `{ closed, foreign: [{ home, handle }] }`.
   */
  function closeOwnAt(homes) {
    const answer = orca(['terminal', 'list']);
    assert.equal(answer.ok, true, `orca terminal list failed: ${JSON.stringify(answer.error)}`);
    const shut = [];
    const foreign = [];
    for (const terminal of answer.result.terminals) {
      if (!homes.includes(terminal.worktreePath)) continue;
      if (!created.has(terminal.handle)) {
        foreign.push({ home: terminal.worktreePath, handle: terminal.handle });
        continue;
      }
      orca(['terminal', 'close', '--terminal', terminal.handle, '--tab']);
      shut.push(terminal.handle);
    }
    return { closed: shut, foreign };
  }

  /**
   * What this test closed that it did not create, and what went that it did
   * not close from the handles open before it began.
   */
  function verdict(before) {
    const was = new Set(before);
    const answer = orca(['terminal', 'list']);
    assert.equal(answer.ok, true, `orca terminal list failed: ${JSON.stringify(answer.error)}`);
    const left = new Set(answer.result.terminals.map((terminal) => terminal.handle));
    const ours = new Set(closed);
    return {
      closedNotOurs: [...ours].filter((handle) => !created.has(handle)),
      goneElsewhere: [...was].filter((handle) => !left.has(handle) && !ours.has(handle)),
    };
  }

  return { orca, openedByKit, closedByKit, closeOwnAt, closed: () => [...closed], verdict };
}
