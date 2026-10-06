// Every command that opens a session's tab and types its launch line holds the
// line back from a shell that is not ready, and says so (#498): `temp make`,
// `restart`, `unpause` and `init`, as `up` does (test/shell-ready-up.test.js).
//
// In each, the new tab's shell asks oh-my-zsh's start-up question for the
// whole of the kit's 15 s wait. Then nothing is typed into that tab, its entry
// under `tabs` says `launched: false` and "the shell is asking …", the book
// keeps the tab so `obk restart` can replace it, and the command exits 1.
// `temp make` keeps the session in bot.yaml and the book, so it can be
// restarted or retired, and does not say it "Made" it.
//
// Every refusal costs the kit's 15 s wait, so the tests run side by side.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { parse } from 'yaml';

import { botHomeOf, createSandbox, kitLaunchMark, recordSession, sessionIn, tabsOfBot, TAB_TITLES } from './helpers/cli.js';
import {
  ASKING_ROW,
  ASKING_SCREEN,
  assertInBook,
  assertNotLaunched,
  entryOf,
  fleet,
  linesUnder,
  ok,
  reported,
  restartOf,
  SHELL_ASKING,
} from './helpers/shell-ready.js';

/** The task a temporary session is given. */
const TASK = 'Read the open pull request and write down what it changes.';

/** The environment of a command run inside `terminal`, as Orca and the kit's launch line set it. */
const inTab = (box, terminal) => ({ ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId, ...kitLaunchMark(box, terminal) });

/** coder/review brought up and running, the maker of what follows. Returns the bots folder and its tab. */
async function makerUp(box) {
  const bots = await fleet(box);
  await ok(box, ['up', '--bots', 'bots', '--bot', 'coder']);
  const tab = (await sessionIn(bots, 'coder', 'review')).tab;
  const terminal = (await tabsOfBot(box, bots, 'coder')).find((one) => one.tabId === tab);
  assert.ok(terminal, `Orca should have coder/review's tab ${tab}`);
  return { bots, terminal };
}

/** coder/review brought up, with a conversation in its book: a session `restart` and `unpause` can bring back. */
async function runningWithConversation(box) {
  const { bots, terminal } = await makerUp(box);
  const hooked = await recordSession(box, { bots, bot: 'coder', tab: terminal.tabId, session: 'sess-1' });
  assert.equal(hooked.code, 0, hooked.stderr);
  return bots;
}

/** The sessions bot.yaml names for a bot. */
async function sessionsInBotYaml(bots, bot) {
  const doc = parse(await readFile(path.join(botHomeOf(bots, bot), 'bot.yaml'), 'utf8'));
  return (doc.sessions ?? []).map((one) => one?.name);
}

// Four at a time: each run starts dozens of Node fakes, and with many more at once
// a loaded machine leaves the kit too little of its 15 s to read even a ready shell.
describe('#498 every command that launches a session holds the line back from a shell that asks', { concurrency: 4 }, () => {
  test('#498 temp make: nothing is typed into the new tab, the JSON says it was not launched, and the session stays to be restarted or retired', async (t) => {
    const box = await createSandbox(t);
    const { bots, terminal } = await makerUp(box);
    await box.orca.set({ byName: { helper: { tty: 'question', screen: ASKING_SCREEN } } });

    const result = await reported(box, ['temp', 'make', '--bots', 'bots', '--name', 'helper', '--prompt', TASK, '--json'], { env: inTab(box, terminal) });

    assert.equal(result.code, 1, `temp make of a session that was not launched fails, got ${result.code}:\n${result.stderr}`);
    const entry = entryOf(result, 'coder', 'helper');
    const why = await assertNotLaunched(box, entry);
    assert.match(why, SHELL_ASKING);
    assert.ok(why.includes(ASKING_ROW), `got: ${why}`);
    await assertInBook(bots, entry);
    assert.ok((await sessionsInBotYaml(bots, 'coder')).includes('helper'), 'bot.yaml keeps the session');
  });

  test('#498 temp make, plain: it says "not launched:" with the restart command, does not say "Made", and exits 1', async (t) => {
    const box = await createSandbox(t);
    const { bots, terminal } = await makerUp(box);
    await box.orca.set({ byName: { helper: { tty: 'question', screen: ASKING_SCREEN } } });

    const result = await reported(box, ['temp', 'make', '--bots', 'bots', '--name', 'helper', '--prompt', TASK], { env: inTab(box, terminal) });

    assert.equal(result.code, 1, result.stderr);
    const tab = (await sessionIn(bots, 'coder', 'helper'))?.tab;
    assert.equal(typeof tab, 'string', 'the book holds the new tab');
    const under = linesUnder(result.stdout, tab);
    assert.ok(under.some((line) => line.includes('not launched:')), `under the new tab, "not launched:", got:\n${result.stdout}`);
    assert.ok(result.stdout.includes(restartOf(box, bots, 'coder', 'helper')), `and the session's restart command, got:\n${result.stdout}`);
    assert.doesNotMatch(result.stdout, /^Made /m, `a session that was not launched was not made, got:\n${result.stdout}`);
    const typed = (await box.orca.terminals()).find((one) => one.tabId === tab).typed;
    assert.deepEqual(typed, [], 'nothing is typed into its tab');
  });

  test('#498 restart: the new tab gets nothing typed, the book holds it, and restart exits 1', async (t) => {
    const box = await createSandbox(t);
    const bots = await runningWithConversation(box);
    const old = (await sessionIn(bots, 'coder', 'review')).tab;
    await box.orca.set({ byName: { review: { tty: 'question', screen: ASKING_SCREEN } } });

    const result = await reported(box, ['restart', '--bots', 'bots', '--bot', 'coder', '--json']);

    assert.equal(result.code, 1, `a restart whose new tab was not launched fails, got ${result.code}:\n${result.stderr}`);
    const entry = entryOf(result, 'coder', 'review');
    assert.notEqual(entry.tabId, old, 'the entry is the new tab');
    assert.match(await assertNotLaunched(box, entry), SHELL_ASKING);
    await assertInBook(bots, entry);
  });

  test('#498 unpause: the new tab gets nothing typed, the book holds it, and unpause exits 1', async (t) => {
    const box = await createSandbox(t);
    const bots = await runningWithConversation(box);
    await ok(box, ['pause', '--bots', 'bots', '--bot', 'coder']);
    await box.orca.set({ byName: { review: { tty: 'question', screen: ASKING_SCREEN } } });

    const result = await reported(box, ['unpause', '--bots', 'bots', '--bot', 'coder', '--json']);

    assert.equal(result.code, 1, `an unpause whose new tab was not launched fails, got ${result.code}:\n${result.stderr}`);
    const entry = entryOf(result, 'coder', 'review');
    assert.match(await assertNotLaunched(box, entry), SHELL_ASKING);
    await assertInBook(bots, entry);
  });

  test('#498 init: Bot Father\'s daily tab gets nothing typed when its shell asks, and init exits 1', async (t) => {
    const box = await createSandbox(t);
    await box.orca.set({ byName: { daily: { tty: 'question', screen: ASKING_SCREEN } } });

    const result = await reported(box, ['init', '--bots', 'bots', '--harness', 'claude', '--json']);

    assert.equal(result.code, 1, `an init whose daily tab was not launched fails, got ${result.code}:\n${result.stderr}`);
    const entry = entryOf(result, 'bot-father', 'daily');
    assert.equal(entry.title, TAB_TITLES.daily);
    assert.match(await assertNotLaunched(box, entry), SHELL_ASKING);
    await assertInBook(box.path('bots'), entry);
  });
});
