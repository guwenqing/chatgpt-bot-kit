// `obk health` says plainly what a Codex session Orca brought back does to the
// fleet (#408).
//
// Its finding for a session the kit's launch line did not start (#318,
// test/health-not-started-by-kit.test.js) says more for a Codex session.
// Brought back without the kit's line, and so without `--no-daemon`, Codex
// 0.157 runs one shared background server, and every command run through it
// carries the tab of whichever session started that server. So such a
// session's commands run under another tab's identity, and the kit refuses its
// tab-bound commands. `obk restart` is the fix, and it can stop at "open in
// another app" while Codex's shared server still holds the conversation (seen
// live, 2026-09-27, codex-cli 0.157.1). That server outlives the sessions that
// started it, so the way past is Codex's own `codex app-server daemon stop`,
// once every Codex session health names is back on the kit's line, and then
// that session's restart again.
//
// A Claude session Orca brought back runs no such server, and its finding does
// not say any of this.
//
// The wording is the implementer's; the content is read loosely. Everything
// runs against the fake Orca and the fake `ps`: `environment: 'orca'` on a
// tab is a harness Orca resumed by itself (helpers/fake-ps.js).

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import { bookOf, createSandbox, sessionIn } from './helpers/cli.js';

/** Run one `obk` command that has to work for the test to mean anything. */
async function obk(box, ...args) {
  const result = await box.run([...args]);
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stderr}${result.stdout}`);
  return result;
}

/** The ids a conversation is known by in these tests: shaped the way both harnesses shape them. */
const conv = (n) => `0199b2c0-${String(n).padStart(4, '0')}-4444-8888-cccccccccccc`;

/**
 * Bot Father, `coder` on Codex with daily and review, and `writer` on Claude
 * with daily, all brought up by the kit, each with a conversation in the book.
 */
async function fleet(box) {
  await obk(box, 'init', '--bots', 'bots', '--harness', 'claude');
  for (const [bot, harness, sessions] of [['coder', 'codex', ['daily', 'review']], ['writer', 'claude', ['daily']]]) {
    await obk(box, 'bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness);
    for (const session of sessions) await obk(box, 'session', 'add', '--bots', 'bots', '--bot', bot, '--name', session);
    await obk(box, 'up', '--bots', 'bots', '--bot', bot);
  }
  const bots = box.path('bots');
  let n = 0;
  for (const [bot, sessions] of [['coder', ['daily', 'review']], ['writer', ['daily']]]) {
    const book = parse(await readFile(bookOf(bots, bot), 'utf8'));
    for (const session of sessions) book.sessions[session].session = conv(++n);
    await writeFile(bookOf(bots, bot), stringify(book));
  }
  return bots;
}

/** Say that Orca resumed one session's harness by itself. */
async function restoredByOrca(box, bots, bot, session) {
  const { tab } = await sessionIn(bots, bot, session);
  const terminals = await box.orca.terminals();
  assert.ok(terminals.some((one) => one.tabId === tab), `the premise: Orca has ${bot}/${session}'s tab ${tab}`);
  await box.orca.set({ terminals: terminals.map((one) => (one.tabId === tab ? { ...one, environment: 'orca' } : one)) });
}

/** Health's answer as JSON. */
async function found(box) {
  const result = await box.run(['health', '--bots', 'bots', '--json']);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout}${result.stderr} (${error.message})`);
  }
}

/** Whether `word` is in `text` as a word of its own. */
const hasWord = (text, word) => new RegExp(`(^|[^A-Za-z0-9_-])${word}($|[^A-Za-z0-9_-])`).test(text);

/** The one finding about one session of one bot, which #318 makes for a session the kit did not start. */
function findingAbout(answer, bot, session) {
  const mine = answer.found.filter((one) => one.bot === bot && hasWord(`${one.where} ${one.says}`, session));
  assert.equal(mine.length, 1, `one finding about ${bot}/${session}, which Orca resumed by itself, got: ${JSON.stringify(answer.found, null, 2)}`);
  assert.equal(mine[0].kind, 'session');
  return mine[0].says.replace(/\s+/g, ' ');
}

/** Words that name Codex's shared background server, loosely. */
const SHARED_SERVER = /\b(?:shared|background)\b[^.]{0,40}\bserver\b|\bdaemon\b/i;

/** Words that name the screen a restart can stop at. */
const OTHER_APP = /\banother app\b/i;

/**
 * What frees a conversation Codex's shared server still holds, seen live
 * (#408, run 5): the server outlives the sessions that started it, so a second
 * restart meets "open in another app" again.
 */
const DAEMON_STOP = 'codex app-server daemon stop';

/**
 * Words that warn what the stop reaches: Codex's shared server ends for
 * everything using it. Read loosely.
 */
const STOP_REACH = /\b(?:everything|every|all|any|other)\b[^.;]{0,80}\b(?:using|uses|use|sharing|shares|share|connected to|attached to)\b[^.;]{0,40}\b(?:it|server)\b/i;

/** Words that say that reach includes Codex sessions the kit did not start, the owner's own among them. */
const BEYOND_THE_KIT = /\boutside (?:the kit|obk)\b|\bCodex sessions? (?:the kit|obk) (?:did not|didn't|does not|doesn't) start\b|\b(?:your|the owner's|the user's) own Codex\b/i;

/**
 * What a Codex session's finding adds: its commands run under the tab of
 * whichever session started Codex's shared server, so the kit refuses its
 * tab-bound commands; restart is the fix; and the other-app case.
 */
function assertSaysSharedServer(says, bot, session) {
  assert.match(says, SHARED_SERVER, `${bot}/${session}'s finding says its commands run through Codex's shared background server, got: ${says}`);
  assert.match(says, /\b(?:another|other|whichever)\b[^.]{0,60}\b(?:tab|session)\b/i, `under another session's tab, got: ${says}`);
  assert.match(says, /\brefus/i, `so the kit refuses its tab-bound commands, got: ${says}`);
  assert.match(says, /\brestart\b/, `restart is the fix, got: ${says}`);
  assert.match(says, OTHER_APP, `and a restart can stop at "open in another app", got: ${says}`);
  assert.ok(says.includes(DAEMON_STOP), `and that the way past it is Codex's own \`${DAEMON_STOP}\`, got: ${says}`);
  assert.match(says, STOP_REACH, `and warns that the stop ends Codex's shared server for everything using it, got: ${says}`);
  assert.match(says, BEYOND_THE_KIT, `Codex sessions outside the kit, the owner's own, included, got: ${says}`);
}

test('H1 each Codex session Orca brought back is told its commands run under another tab\'s identity, that restart fixes it, and the other-app case', async (t) => {
  // The live case: two Codex sessions of one bot, both restored by Orca.
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await restoredByOrca(box, bots, 'coder', 'daily');
  await restoredByOrca(box, bots, 'coder', 'review');

  const answer = await found(box);

  for (const session of ['daily', 'review']) assertSaysSharedServer(findingAbout(answer, 'coder', session), 'coder', session);
});

test('H2 a Claude session Orca brought back is named as before, and its finding says nothing of Codex\'s shared server', async (t) => {
  // Contrast in the same fleet: the Codex session's finding says it.
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await restoredByOrca(box, bots, 'writer', 'daily');
  await restoredByOrca(box, bots, 'coder', 'daily');

  const answer = await found(box);

  const claude = findingAbout(answer, 'writer', 'daily');
  assert.match(claude, /\brestart\b/, `it keeps #318's restart, got: ${claude}`);
  assert.doesNotMatch(claude, SHARED_SERVER, `got: ${claude}`);
  assert.doesNotMatch(claude, OTHER_APP, `got: ${claude}`);
  assertSaysSharedServer(findingAbout(answer, 'coder', 'daily'), 'coder', 'daily');
});
