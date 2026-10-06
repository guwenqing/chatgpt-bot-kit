// What the tests of #498 share: a fleet to bring up, the screen of a shell that
// asks a question when it starts, and the reads of a report and of a tab that
// say whether the kit typed into it.
//
// #498: the kit types a new tab's launch line only into a shell at a ready
// prompt with nothing asking. Ready is the shell in front of the tab's terminal
// (the fake `ps`) and the tab's tty in line-editor mode (the fake `lsof` and
// `stty`, helpers/fake-tty.js). The kit looks for up to 15 s after it opens the
// tab; a tab that is not ready by then gets nothing typed, and the run's answer
// says the tab was not launched and why.

import assert from 'node:assert/strict';

import { orcaCallsOf, orcaFlag, sessionIn, shellWord, TAB_SHELL } from './cli.js';

/** How long the kit looks for a ready shell, in ms (#498). */
export const READY_WAIT_MS = 15000;

/** The row oh-my-zsh's start-up question draws, as seen in the issue. */
export const ASKING_ROW = '[oh-my-zsh] Would you like to update? [Y/n]';

/**
 * A new tab's screen with that question on it, as `terminal read --screen`
 * renders it: a row above it, and empty rows below it, so the question is
 * the last row that is not empty and not the first or the last row.
 */
export const ASKING_SCREEN = ['Last login: Mon Oct  5 09:12:01 on ttys002', ASKING_ROW, '', '', ''];

/** Run `obk <args>` and insist it worked. */
export async function ok(box, args, options) {
  const result = await box.run(args, options);
  assert.equal(result.code, 0, `obk ${args.join(' ')} should have worked:\n${result.stdout}${result.stderr}`);
  return result;
}

/** Run `obk <args>` and insist it reported and did not crash; the exit code is the test's to check. */
export async function reported(box, args, options) {
  const result = await box.run(args, options);
  assert.notEqual(result.stdout.trim(), '', `obk ${args.join(' ')} should report what it did:\n${result.stderr}`);
  assert.ok(!/^\s+at /m.test(result.stderr), `expected a report, got a crash:\n${result.stderr}`);
  return result;
}

/**
 * Bot Father up (claude), and `coder`, a Codex bot with the sessions named,
 * none of them brought up yet. Returns the bots folder's full path.
 */
export async function fleet(box, sessions = ['review']) {
  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  const bots = box.path('bots');
  await ok(box, ['bot', 'create', '--bots', bots, '--name', 'coder', '--harness', 'codex']);
  for (const session of sessions) {
    await ok(box, ['session', 'add', '--bots', bots, '--bot', 'coder', '--name', session]);
  }
  return bots;
}

/** The --json answer, which is JSON and nothing else. */
export function answerIn(result) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout}${result.stderr} (${error.message})`);
  }
}

/** The tab entry a `--json` report gives for one session. */
export function entryOf(result, bot, session) {
  const found = (answerIn(result).tabs ?? []).find((tab) => tab.bot === bot && tab.name === session);
  assert.ok(found !== undefined, `the report should have a tab for ${bot}/${session}, got: ${result.stdout}`);
  return found;
}

/** The fake Orca's record of the tab a report entry names. */
export async function terminalOf(box, entry) {
  const terminal = (await box.orca.terminals()).find((one) => one.handle === entry.terminal);
  assert.ok(terminal, `Orca should have the tab the report names, ${entry.terminal}`);
  return terminal;
}

/** The launch lines typed into a tab: the lines that carry the kit's mark. */
export const launchLinesIn = (terminal) => (terminal.typed ?? []).filter((one) => one.text.includes(TAB_SHELL));

/**
 * The tab the entry names was not launched: the entry says so in the words
 * #498 gives, and nothing at all was typed into the tab. Returns the sentence.
 */
export async function assertNotLaunched(box, entry) {
  assert.equal(entry.launched, false, `the entry should say the tab was not launched, got: ${JSON.stringify(entry)}`);
  assert.equal(typeof entry.notLaunched, 'string', `and say why, got: ${JSON.stringify(entry)}`);
  assert.notEqual(entry.notLaunched.trim(), '', 'a reason that says something');
  assert.ok(!entry.notLaunched.includes('\n'), `one sentence, got: ${entry.notLaunched}`);
  assert.equal(entry.harnessStarted, false, `no harness was started there, got: ${JSON.stringify(entry)}`);
  assert.equal('noMailbox' in entry, false, `"not launched" is the truth, not "no mailbox", got: ${JSON.stringify(entry)}`);
  assert.equal('promptReceived' in entry, false, `nor anything about a start prompt, got: ${JSON.stringify(entry)}`);

  const terminal = await terminalOf(box, entry);
  assert.deepEqual(terminal.typed, [], `nothing at all is typed into the tab, got: ${JSON.stringify(terminal.typed)}`);
  const sends = orcaCallsOf(await box.orca.calls(), 'terminal send').filter((call) => orcaFlag(call, '--terminal') === entry.terminal);
  assert.deepEqual(sends, [], 'and no send was made to it');
  return entry.notLaunched;
}

/** The tab was launched as today: its entry carries no refusal, and one launch line went in. */
export async function assertLaunched(box, entry) {
  assert.notEqual(entry.launched, false, `the tab should have been launched, got: ${JSON.stringify(entry)}`);
  assert.equal('notLaunched' in entry, false, `with nothing to say against it, got: ${JSON.stringify(entry)}`);
  const lines = launchLinesIn(await terminalOf(box, entry));
  assert.equal(lines.length, 1, `the launch line is typed once, got: ${JSON.stringify(lines)}`);
}

/** The book holds the tab the entry names for its session, so a restart can replace it. */
export async function assertInBook(bots, entry) {
  const book = await sessionIn(bots, entry.bot, entry.name);
  assert.equal(book?.tab, entry.tabId, `the book should hold ${entry.bot}/${entry.name}'s tab ${entry.tabId}, got: ${JSON.stringify(book)}`);
}

/** "the kit could not tell whether the shell is ready", in any of the plain ways to say it. */
export const COULD_NOT_TELL = /(could not|couldn't|cannot|can't|was unable to|is unable to) tell whether the shell (is|was) ready/i;

/** A sentence that begins "the shell is asking". */
export const SHELL_ASKING = /^the shell is asking/i;

/** The command that gives one session a new launch. */
export const restartOf = (box, bots, bot, session) =>
  [box.cli, 'restart', '--bots', bots, '--bot', bot, '--session', session].map(shellWord).join(' ');

/**
 * The plain report's lines under one tab: from the line that names the tab to
 * the next line that names another. `tab` is the tab's id, as the book has it.
 */
export function linesUnder(stdout, tab) {
  const lines = stdout.split('\n');
  const header = /^(opened|found)\s/;
  const at = lines.findIndex((line) => header.test(line) && line.includes(`tab ${tab} `));
  assert.ok(at >= 0, `the report should name the tab ${tab}, got:\n${stdout}`);
  const after = lines.slice(at + 1);
  const next = after.findIndex((line) => header.test(line));
  return next < 0 ? after : after.slice(0, next);
}
