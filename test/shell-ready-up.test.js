// `obk up` types a new tab's launch line only into a shell at a ready prompt
// with nothing asking (#498).
//
// Seen: `obk temp make` answered `noMailbox: true, promptReceived: true`, and
// the tab's scrollback showed the launch line typed into oh-my-zsh's start-up
// question, "[oh-my-zsh] Would you like to update? [Y/n]". The question ate the
// `obk session mailbox` part of the line; the harness part still ran.
//
// What these tests pin, through the fakes (helpers/fake-tty.js, fake-ps.js):
//
//   - Before it types, the kit reads the new tab's tty: `lsof -a -R -d 0 -u
//     <uid> -FpRn` for the tty of the shell under the pane, then `stty -a -f
//     <tty>`. Ready is the shell in front and the tty in line-editor mode,
//     `-icanon` and `-echo` together.
//   - A ready prompt gets the line, once. A shell that becomes ready while the
//     kit looks gets it once, as soon as it is ready.
//   - A shell still not ready 15 s after the tab was opened gets nothing typed.
//     Its entry says `launched: false` and, in `notLaunched`, why: "the shell
//     is asking" and the last row of its screen. No `noMailbox`, no
//     `promptReceived`. The book keeps the tab, so `obk restart` can replace it.
//   - The run exits 1, and its plain report says `not launched:` under that tab
//     with the session's restart command.
//   - A sister session that was ready is launched as ever, and Bot Father's ops
//     tab, which nothing is typed into, is not held back.
//
// Every refusal costs the kit's 15 s wait in real time, so the tests here run
// side by side.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createSandbox, orcaCallsOf, orcaFlag, TAB_SHELL, TAB_TITLES } from './helpers/cli.js';
import { ttyOf } from './helpers/fake-tty.js';
import {
  ASKING_ROW,
  ASKING_SCREEN,
  answerIn,
  assertInBook,
  assertLaunched,
  assertNotLaunched,
  entryOf,
  fleet,
  launchLinesIn,
  linesUnder,
  ok,
  READY_WAIT_MS,
  reported,
  restartOf,
  SHELL_ASKING,
  terminalOf,
} from './helpers/shell-ready.js';

/** When the fake Orca was first asked `command` about the tab `handle`, in ms since the epoch. */
async function firstCallAt(box, command, handle) {
  const calls = await box.orca.calls();
  const clock = await box.orca.clock();
  const at = calls.findIndex((call) => orcaCallsOf([call], command).length === 1 && orcaFlag(call, '--terminal') === handle);
  assert.ok(at >= 0, `the fake Orca should have been asked ${command} about ${handle}`);
  return clock[at].at;
}

/** When the tab the entry names was created: the `terminal create` whose title is the tab's. */
async function createdAt(box, entry) {
  const calls = await box.orca.calls();
  const clock = await box.orca.clock();
  const at = calls.findIndex((call) => orcaCallsOf([call], 'terminal create').length === 1 && orcaFlag(call, '--title') === entry.title);
  assert.ok(at >= 0, `the fake Orca should have been asked to create ${entry.title}`);
  return clock[at].at;
}

describe('#498 up and a new tab\'s shell', { concurrency: true }, () => {
  test('#498 a ready prompt gets the launch line, and the kit read the tab\'s tty before it typed', async (t) => {
    const box = await createSandbox(t);
    await fleet(box);

    const result = await ok(box, ['up', '--bots', 'bots', '--bot', 'coder', '--json']);

    const entry = entryOf(result, 'coder', 'review');
    await assertLaunched(box, entry);
    const terminal = await terminalOf(box, entry);
    assert.ok(terminal.typed[0].text.includes(TAB_SHELL), `the first thing typed is the launch line, got: ${terminal.typed[0].text}`);

    // The kit asked lsof for fd 0 of the user's processes, and read the mode of
    // this tab's tty, the one on the shell under its pane, and no other.
    const tty = ttyOf(await box.orca.state(), terminal);
    const lsof = await box.lsof.calls();
    const stty = (await box.stty.calls()).filter((call) => call.args[2] === tty);
    assert.ok(lsof.length >= 1, `the kit should have asked lsof for the tty, got no call`);
    assert.deepEqual(lsof[0].args, ['-a', '-R', '-d', '0', '-u', String(process.getuid()), '-FpRn']);
    assert.ok(stty.length >= 1, `the kit should have read ${tty}'s mode, got: ${JSON.stringify(await box.stty.calls())}`);
    assert.deepEqual(stty[0].args, ['-a', '-f', tty]);
    const stray = (await box.stty.calls()).filter((call) => call.args[2] === '/dev/ttys900');
    assert.deepEqual(stray, [], 'the tty of a shell that is no tab\'s, listed first, was not read');

    const typedAt = await firstCallAt(box, 'terminal send', entry.terminal);
    assert.ok(stty[0].at <= typedAt, 'the tty was read before the line was typed');
  });

  test('#498 a shell asking oh-my-zsh\'s question gets nothing typed, and up says it was not launched and why', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await box.orca.set({ byName: { review: { tty: 'question', screen: ASKING_SCREEN } } });

    const result = await reported(box, ['up', '--bots', 'bots', '--bot', 'coder', '--json']);

    assert.equal(result.code, 1, `a tab that was not launched makes the run fail, got ${result.code}:\n${result.stderr}`);
    const entry = entryOf(result, 'coder', 'review');
    const why = await assertNotLaunched(box, entry);
    assert.match(why, SHELL_ASKING);
    assert.ok(why.includes(ASKING_ROW), `the reason names the question on the screen, got: ${why}`);
    await assertInBook(bots, entry);
  });

  test('#498 the kit goes on looking for the 15 s, and no longer, before it gives up on a shell that asks', async (t) => {
    const box = await createSandbox(t);
    await fleet(box);
    await box.orca.set({ byName: { review: { tty: 'question', screen: ASKING_SCREEN } } });

    const result = await reported(box, ['up', '--bots', 'bots', '--bot', 'coder', '--json']);

    const entry = entryOf(result, 'coder', 'review');
    await assertNotLaunched(box, entry);
    const terminal = await terminalOf(box, entry);
    const tty = ttyOf(await box.orca.state(), terminal);
    const looks = (await box.stty.calls()).filter((call) => call.args[2] === tty);
    assert.ok(looks.length >= 2, `the kit looks again and again, got ${looks.length} looks`);
    const opened = await createdAt(box, entry);
    const lastLook = looks.at(-1).at - opened;
    assert.ok(lastLook >= READY_WAIT_MS - 3000, `the kit was still looking near the end of the 15 s, its last look came ${lastLook} ms after the tab was opened`);
    assert.ok(lastLook <= READY_WAIT_MS + 10000, `and stopped looking soon after, its last look came ${lastLook} ms after the tab was opened`);
  });

  for (const [mode, what] of [['read', 'a plain line read, with the echo on'], ['secret', 'a line read with the echo off']]) {
    test(`#498 ${what} is not a ready prompt either: nothing is typed`, async (t) => {
      // Line-editor mode is -icanon and -echo together: one of the two is not enough.
      const box = await createSandbox(t);
      await fleet(box);
      await box.orca.set({ byName: { review: { tty: mode } } });

      const result = await reported(box, ['up', '--bots', 'bots', '--bot', 'coder', '--json']);

      assert.equal(result.code, 1, result.stderr);
      const why = await assertNotLaunched(box, entryOf(result, 'coder', 'review'));
      assert.match(why, SHELL_ASKING);
    });
  }

  test('#498 a question answered while the kit looks: the line is typed once, as soon as the shell is ready', async (t) => {
    const box = await createSandbox(t);
    await fleet(box);
    await box.orca.set({ byName: { review: { tty: ['question', 'question', 'question', 'prompt'] } } });

    const result = await ok(box, ['up', '--bots', 'bots', '--bot', 'coder', '--json']);

    const entry = entryOf(result, 'coder', 'review');
    await assertLaunched(box, entry);
    const terminal = await terminalOf(box, entry);
    const tty = ttyOf(await box.orca.state(), terminal);
    const looks = (await box.stty.calls()).filter((call) => call.args[2] === tty);
    assert.ok(looks.length >= 4, `the line went in only once the shell was ready, at the fourth look, got ${looks.length} looks`);
    const typedAt = await firstCallAt(box, 'terminal send', entry.terminal);
    assert.ok(looks[3].at <= typedAt, 'and not before that look');
    const waited = typedAt - await createdAt(box, entry);
    assert.ok(waited < READY_WAIT_MS - 3000, `as soon as it was ready, not at the end of the wait: typed ${waited} ms after the tab was opened`);
  });

  test('#498 of two sessions, only the one whose shell asks is held back, and the run exits 1', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box, ['review', 'build']);
    await box.orca.set({ byName: { review: { tty: 'question', screen: ASKING_SCREEN } } });

    const result = await reported(box, ['up', '--bots', 'bots', '--bot', 'coder', '--json']);

    assert.equal(result.code, 1, result.stderr);
    const review = entryOf(result, 'coder', 'review');
    const build = entryOf(result, 'coder', 'build');
    assert.match(await assertNotLaunched(box, review), SHELL_ASKING);
    await assertLaunched(box, build);
    await assertInBook(bots, review);
    await assertInBook(bots, build);
  });

  test('#498 the plain report says "not launched:" under the held-back tab, with its restart command, and nothing like it under its sister', async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box, ['review', 'build']);
    await box.orca.set({ byName: { review: { tty: 'question', screen: ASKING_SCREEN } } });

    const result = await reported(box, ['up', '--bots', 'bots', '--bot', 'coder']);

    assert.equal(result.code, 1, result.stderr);
    const tabs = Object.fromEntries((await box.orca.terminals()).map((one) => [one.title.split(' ').at(-1), one.tabId]));
    const under = linesUnder(result.stdout, tabs.review);
    assert.ok(under.some((line) => line.includes('not launched:')), `under coder/review's tab, "not launched:", got:\n${result.stdout}`);
    assert.ok(under.some((line) => line.includes('the shell is asking')), `with the reason, got:\n${result.stdout}`);
    assert.ok(under.some((line) => line.includes(restartOf(box, bots, 'coder', 'review'))), `and its restart command, got:\n${result.stdout}`);
    const sister = linesUnder(result.stdout, tabs.build);
    assert.ok(!sister.some((line) => line.includes('not launched')), `nothing of the kind under coder/build's, got:\n${result.stdout}`);
  });

  test('#498 Bot Father\'s ops tab gets nothing typed and is not held back, while its daily tab is', async (t) => {
    const box = await createSandbox(t);
    await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
    // Orca forgot every tab, and every new tab's shell asks.
    await box.orca.set({ terminals: [], tty: 'question', screen: ASKING_SCREEN });

    const result = await reported(box, ['up', '--bots', 'bots', '--json']);

    assert.equal(result.code, 1, result.stderr);
    const tabs = answerIn(result).tabs;
    const ops = tabs.find((tab) => tab.title === TAB_TITLES.ops);
    const daily = tabs.find((tab) => tab.title === TAB_TITLES.daily);
    assert.ok(ops && daily, `both of Bot Father's tabs are reported, got: ${result.stdout}`);
    assert.match(await assertNotLaunched(box, daily), SHELL_ASKING);
    assert.equal('launched' in ops, false, `the ops tab is no launch to hold back, got: ${JSON.stringify(ops)}`);
    assert.equal('notLaunched' in ops, false, `got: ${JSON.stringify(ops)}`);
    assert.deepEqual((await terminalOf(box, ops)).typed, [], 'and nothing is typed into it, as ever');
    assert.equal(launchLinesIn(await terminalOf(box, daily)).length, 0);
  });
});
