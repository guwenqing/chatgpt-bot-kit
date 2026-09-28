// A Codex session the kit resumes shows up among Orca's agents straight away,
// like a Claude one (#226).
//
// Seen live twice (Codex 0.157.1, Orca 1.4.215, test/system/codex-resume-listed.test.js):
// a resumed Codex thread fires SessionStart only at its first turn, and Orca
// lists the pane among the project's agents only then; a resumed Claude session
// fires it at the resume and is listed within seconds. The owner allowed the
// kit to type one short line into a Codex session it has just resumed, and the
// architect ruled its words, the wait and the report:
//
//   - `up`, `restart` and `unpause` share one path. When it resumes a Codex
//     session (the book holds its conversation, and the launch line resumes it)
//     and the harness came up in the new tab, the kit types exactly one line
//     into that tab, LIST_LINE below, word for word, with a return.
//   - Through the same gate as the mail notice: nothing is typed while Orca
//     reports the tab blocked, while a question, form or menu is on its screen
//     (#329, #416), or while the kit cannot tell whether the harness is there.
//   - It waits up to 20 s for the gate to let it through (Orca named the agent
//     7–11 s into the live runs). Past that, or on a refusal, nothing is typed.
//   - The report: in the `--json` answer, the tab's entry carries `listLine:
//     true` when the line was typed, and `listLine: false` with
//     `listLineTrouble`, why, when it was not; the plain report says under that
//     tab whether it was typed, and why not.
//   - Never for a Claude session, a fresh Codex start (its start prompt is its
//     first turn), a Codex tab that was already running (the kit leaves it
//     alone), or a resumed harness that did not come up. The start prompt is
//     still not re-sent on a resume (PRD 6.4). One line per resume, and nothing
//     else typed into the tab after the launch line.
//
// How the wait is modelled. The fake Orca keeps no clock: time passes in it
// only while `terminal wait` waits (helpers/fake-ps.js), and `waitIdle` given
// as a list is one answer per `terminal wait`, counted from when it was set.
// So a tab the gate lets through only after some time is a tab whose waits
// answer `blocked` a few times and then idle; a tab that never lets it through
// answers `blocked` (or shows a question, or gives Orca no agent) on every look.
// The first case is written so it holds however many looks the launch itself
// takes (one or two, as now): the gate is refused at least once and let through
// within three waits, far inside 20 s of any waits the kit would make. The
// second says nothing about how the kit counts its 20 s, only that it gives up
// and says why; if the kit counts wall-clock time, each of those tests takes
// the kit's full wait.
//
// Every expected value here is the ruling's: the line's words, the keys of the
// report, and Orca's own reason where it gave one.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bareLaunch,
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  recordSession,
  sentInto,
  sessionIn,
  tabsOfBot,
  typedInto,
} from './helpers/cli.js';
import { CODEX_UPDATE_OFFER } from './helpers/screens.js';

/** The line the kit types, word for word, as the architect ruled it on #226. */
const LIST_LINE = 'obk: this session was resumed in a new tab, and this line is only so Orca lists it. Reply "ok"; nothing else is asked.';

const PROMPT = 'Read your AGENTS.md and keep the queue moving.';
const BOT = 'api-bot';

/** A bots folder with Bot Father and api-bot on `harness`, with the sessions named, none of them up yet. */
async function madeBot(box, { harness = 'codex', sessions = ['daily'] } = {}) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness])).code, 0);
  for (const name of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', name, '--prompt', PROMPT]);
    assert.equal(added.code, 0, added.stderr);
  }
  return box.path('bots');
}

/** Run one kit command for api-bot with `--json`, and read its answer. */
async function run(box, command, flags = []) {
  const result = await box.run([command, '--bots', 'bots', '--bot', BOT, '--json', ...flags]);
  assert.equal(result.code, 0, `${command} should go through: ${result.stdout}${result.stderr}`);
  return JSON.parse(result.stdout);
}

/** The tab the book gives a session, as Orca has it now. */
async function liveTab(box, bots, name = 'daily') {
  const entry = await sessionIn(bots, BOT, name);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${name}, got: ${JSON.stringify(entry)}`);
  const terminal = (await tabsOfBot(box, bots, BOT)).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `Orca should have ${name}'s tab ${entry.tab}`);
  return terminal;
}

/** One session's entry in a kit answer. */
function entryOf(answer, name = 'daily') {
  const found = (answer.tabs ?? []).filter((one) => one.bot === BOT && one.name === name);
  assert.equal(found.length, 1, `one entry for ${BOT} ${name}, got: ${JSON.stringify(answer.tabs)}`);
  return found[0];
}

/**
 * Bring api-bot up once, and give each session a conversation the book holds
 * and the harness has on record, the way a session that has had a turn has it:
 * what the next launch resumes (#295). Its id is `sess-<name>`.
 */
async function running(box, bots, { sessions = ['daily'], harnessOf = () => 'codex' } = {}) {
  await run(box, 'up');
  for (const name of sessions) {
    const tab = await liveTab(box, bots, name);
    await recordSession(box, { bots, bot: BOT, tab: tab.tabId, session: `sess-${name}` });
    await conversationOnRecord(box, { harness: harnessOf(name), cwd: botHomeOf(bots, BOT), id: `sess-${name}` });
  }
}

/** The session's tab, closed the way a user closes one: Orca simply stops listing it. */
async function closeTab(box, tabId) {
  await box.orca.set({ terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== tabId) });
}

/** A Codex session with a conversation in the book, and its tab closed: what `up` resumes. */
async function closedWithConversation(box) {
  const bots = await madeBot(box);
  await running(box, bots);
  await closeTab(box, (await liveTab(box, bots)).tabId);
  return bots;
}

/** What was typed into the session's tab, the launch line first. */
const typedIn = async (box, bots, name = 'daily') => typedInto(await liveTab(box, bots, name));

/** The launch line resumed `id` on Codex, and does not carry the start prompt. */
function assertCodexResumeLine(line, id, what) {
  assert.match(line ?? '', / codex resume /, `${what}: the launch line resumes Codex, got: ${line}`);
  assert.ok(line.includes(id), `${what}: with the conversation the book holds, ${id}, got: ${line}`);
  assert.ok(!line.includes(PROMPT), `${what}: and the start prompt is not sent again, got: ${line}`);
}

/**
 * The typed case in full: the launch line, then exactly the ruled line with a
 * return and nothing after it, and the entry says it was typed.
 */
async function assertListLineTyped(box, bots, entry, what, name = 'daily') {
  const typed = await typedIn(box, bots, name);
  assert.equal(typed.length, 2, `${what}: the launch line and then the list line, nothing else, got: ${JSON.stringify(typed)}`);
  assertCodexResumeLine(typed[0], `sess-${name}`, what);
  assert.equal(typed[1], LIST_LINE, `${what}: the line is the ruled one, word for word`);
  assert.equal(sentInto(await liveTab(box, bots, name))[1].enter, true, `${what}: and it is submitted with a return`);
  assert.equal(entry.listLine, true, `${what}: the answer says the line was typed, got: ${JSON.stringify(entry)}`);
  assert.equal(entry.listLineTrouble, undefined, `${what}: and gives no trouble for it, got: ${JSON.stringify(entry)}`);
}

/**
 * The refused case: a Codex session was resumed and its harness came up, but
 * nothing was typed after the launch line, and the entry says so and why.
 */
async function assertListLineNotTyped(box, bots, entry, what) {
  const typed = await typedIn(box, bots);
  assert.equal(typed.length, 1, `${what}: nothing is typed after the launch line, got: ${JSON.stringify(typed)}`);
  assertCodexResumeLine(typed[0], 'sess-daily', what);
  assert.equal(entry.listLine, false, `${what}: the answer says the line was not typed, got: ${JSON.stringify(entry)}`);
  assert.equal(typeof entry.listLineTrouble, 'string', `${what}: and why, got: ${JSON.stringify(entry)}`);
  assert.notEqual(entry.listLineTrouble.trim(), '', `${what}: a why with words in it`);
}

// ------------------------------------------------------------- typed, through each command

test('up: a Codex session resumed in a new tab gets the ruled line typed once after its launch line, and the answer says so', async (t) => {
  const box = await createSandbox(t);
  const bots = await closedWithConversation(box);

  const entry = entryOf(await run(box, 'up'));

  assert.equal(entry.created, true, `the premise: a new tab, got: ${JSON.stringify(entry)}`);
  assert.equal(entry.resumed, true, `the premise: resumed, got: ${JSON.stringify(entry)}`);
  await assertListLineTyped(box, bots, entry, 'up');
});

test('restart: a Codex session with a conversation in the book comes back in a new tab with the ruled line typed once', async (t) => {
  const box = await createSandbox(t);
  const bots = await madeBot(box);
  await running(box, bots);
  const old = await liveTab(box, bots);

  const entry = entryOf(await run(box, 'restart'));

  assert.notEqual(entry.tabId, old.tabId, 'the premise: a new tab');
  await assertListLineTyped(box, bots, entry, 'restart');
});

test('unpause: a paused Codex session comes back with its conversation and the ruled line typed once', async (t) => {
  const box = await createSandbox(t);
  const bots = await madeBot(box);
  await running(box, bots);
  const paused = await box.run(['pause', '--bots', 'bots', '--bot', BOT]);
  assert.equal(paused.code, 0, `the pause this test stands on: ${paused.stderr}`);

  const entry = entryOf(await run(box, 'unpause'));

  await assertListLineTyped(box, bots, entry, 'unpause');
});

test('restart of a bot with two Codex sessions: each new tab gets the line exactly once, and only its own', async (t) => {
  const box = await createSandbox(t);
  const bots = await madeBot(box, { sessions: ['daily', 'review'] });
  await running(box, bots, { sessions: ['daily', 'review'] });

  const answer = await run(box, 'restart');

  for (const name of ['daily', 'review']) {
    await assertListLineTyped(box, bots, entryOf(answer, name), `restart, ${name}`, name);
  }
});

test('the gate refuses at first and lets the line through within the wait: it is typed once, when it may be', async (t) => {
  // Orca answers `blocked` on the first three waits and idle after: the gate
  // is refused at least once, whether the launch looks once or twice, and let
  // through a wait or two later (see "How the wait is modelled" above).
  const box = await createSandbox(t);
  const bots = await closedWithConversation(box);
  await box.orca.set({ waitIdle: ['blocked', 'blocked', 'blocked', true] });

  const entry = entryOf(await run(box, 'up'));

  await assertListLineTyped(box, bots, entry, 'a gate refused at first');
});

// ------------------------------------------------------------- not typed, and said why

test('a resumed Codex tab Orca reports blocked for the whole wait gets nothing typed, and the answer gives Orca\'s reason', async (t) => {
  const box = await createSandbox(t);
  const bots = await closedWithConversation(box);
  await box.orca.set({ waitIdle: 'blocked', blockedReason: 'agent-permission-prompt' });

  const entry = entryOf(await run(box, 'up'));

  await assertListLineNotTyped(box, bots, entry, 'blocked');
  assert.ok(entry.listLineTrouble.includes('agent-permission-prompt'), `in Orca's words, got: ${entry.listLineTrouble}`);
});

test('a resumed Codex tab showing a question of Codex\'s own, which Orca calls idle, gets nothing typed, and the answer says why', async (t) => {
  // Codex's update offer, whose default is "Update now" (#329): a return typed
  // into it updates the machine.
  const box = await createSandbox(t);
  const bots = await closedWithConversation(box);
  await box.orca.set({ screen: CODEX_UPDATE_OFFER });

  const entry = entryOf(await run(box, 'up'));

  await assertListLineNotTyped(box, bots, entry, 'a question on screen');
  assert.match(entry.listLineTrouble, /question/i, `it says a question is waiting, got: ${entry.listLineTrouble}`);
});

test('a resumed Codex tab where Orca names no agent for the whole wait gets nothing typed, and the answer says why', async (t) => {
  // The harness is in front, but Orca never names an agent there: the kit
  // cannot tell a harness seconds into its launch from anything else, and
  // does not type on not knowing.
  const box = await createSandbox(t);
  const bots = await closedWithConversation(box);
  await box.orca.set({ agentIdentity: null });

  const entry = entryOf(await run(box, 'up'));

  assert.equal(entry.harnessStarted, true, `the premise: the harness came up, got: ${JSON.stringify(entry)}`);
  await assertListLineNotTyped(box, bots, entry, 'no agent named');
});

test('the plain report says under the tab that the line was typed, and when it was not, that it was not and why', async (t) => {
  const box = await createSandbox(t);
  await closedWithConversation(box);

  const typed = await box.run(['up', '--bots', 'bots', '--bot', BOT]);

  assert.equal(typed.code, 0, typed.stderr);
  const typedLines = typed.stdout.split('\n').filter((line) => /\btyped\b/i.test(line) && /\bOrca\b/.test(line) && /\blist/i.test(line));
  assert.equal(typedLines.length, 1, `one line says the line was typed so Orca lists the session, got:\n${typed.stdout}`);
  assert.doesNotMatch(typedLines[0], /\bnot\b|n't\b/i, `and it does not say it was not, got: ${typedLines[0]}`);

  const second = await createSandbox(t);
  await closedWithConversation(second);
  await second.orca.set({ waitIdle: 'blocked', blockedReason: 'agent-permission-prompt' });

  const refused = await second.run(['up', '--bots', 'bots', '--bot', BOT]);

  assert.equal(refused.code, 0, refused.stderr);
  const refusedLines = refused.stdout.split('\n').filter((line) => /\bnot\b|n't\b/i.test(line) && /\btyped\b/i.test(line) && /\bOrca\b/.test(line) && /\blist/i.test(line));
  assert.equal(refusedLines.length, 1, `one line says the line was not typed, got:\n${refused.stdout}`);
  assert.ok(refusedLines[0].includes('agent-permission-prompt'), `and why, in Orca's words, on that line, got: ${refusedLines[0]}`);
});

// ------------------------------------------------------------- never typed

test('a resumed Claude session gets nothing typed after its launch line, and no list line is reported', async (t) => {
  const box = await createSandbox(t);
  const bots = await madeBot(box, { harness: 'claude' });
  await running(box, bots, { harnessOf: () => 'claude' });

  const entry = entryOf(await run(box, 'restart'));

  assert.equal(entry.resumed, true, `the premise: resumed, got: ${JSON.stringify(entry)}`);
  const typed = await typedIn(box, bots);
  assert.equal(typed.length, 1, `the launch line and nothing after it, got: ${JSON.stringify(typed)}`);
  assert.ok(typed[0].includes('--resume sess-daily'), `the premise: Claude resumed its conversation, got: ${typed[0]}`);
  assert.notEqual(entry.listLine, true, `got: ${JSON.stringify(entry)}`);
});

test('unpause of a bot with a Codex and a Claude session types the line into the Codex tab alone', async (t) => {
  const box = await createSandbox(t);
  const bots = await madeBot(box, { sessions: ['daily'] });
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'review', '--harness', 'claude', '--prompt', PROMPT]);
  assert.equal(added.code, 0, added.stderr);
  await running(box, bots, { sessions: ['daily', 'review'], harnessOf: (name) => (name === 'review' ? 'claude' : 'codex') });
  const paused = await box.run(['pause', '--bots', 'bots', '--bot', BOT]);
  assert.equal(paused.code, 0, `the pause this test stands on: ${paused.stderr}`);

  const answer = await run(box, 'unpause');

  await assertListLineTyped(box, bots, entryOf(answer, 'daily'), 'unpause, the Codex session');
  const review = await typedIn(box, bots, 'review');
  assert.equal(review.length, 1, `the Claude session gets its launch line and nothing after it, got: ${JSON.stringify(review)}`);
  assert.ok(review[0].includes('--resume sess-review'), `the premise: Claude resumed, got: ${review[0]}`);
  assert.notEqual(entryOf(answer, 'review').listLine, true);
});

test('a fresh Codex start gets its start prompt on the launch line and nothing typed after it', async (t) => {
  const box = await createSandbox(t);
  const bots = await madeBot(box);

  const entry = entryOf(await run(box, 'up'));

  assert.deepEqual(await typedIn(box, bots), [`${bareLaunch(box, 'codex', BOT, 'daily')} -- '${PROMPT}'`], 'the start prompt is its first turn');
  assert.notEqual(entry.listLine, true, `got: ${JSON.stringify(entry)}`);
});

test('a Codex tab that is already running is left alone: nothing is typed into it', async (t) => {
  const box = await createSandbox(t);
  const bots = await madeBot(box);
  await running(box, bots);
  const before = typedInto(await liveTab(box, bots));

  const entry = entryOf(await run(box, 'up'));

  assert.equal(entry.created, false, `the premise: the tab was already there, got: ${JSON.stringify(entry)}`);
  assert.deepEqual(await typedIn(box, bots), before, 'nothing more was typed into it');
  assert.notEqual(entry.listLine, true, `got: ${JSON.stringify(entry)}`);
});

test('a resumed Codex whose harness did not come up gets nothing typed after its launch line', async (t) => {
  // No TUI in the tab and the shell in front: the launch line went in and no
  // harness is there to take a line. One typed now would run in the shell.
  const box = await createSandbox(t);
  const bots = await closedWithConversation(box);
  await box.orca.set({ waitIdle: false });

  const entry = entryOf(await run(box, 'up'));

  assert.equal(entry.harnessStarted, false, `the premise: no harness came up, got: ${JSON.stringify(entry)}`);
  const typed = await typedIn(box, bots);
  assert.equal(typed.length, 1, `the launch line and nothing after it, got: ${JSON.stringify(typed)}`);
  assertCodexResumeLine(typed[0], 'sess-daily', 'did not come up');
  assert.notEqual(entry.listLine, true, `got: ${JSON.stringify(entry)}`);
});
