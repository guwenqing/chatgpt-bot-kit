// The kit types nothing into a Claude Code session that shows its panel of
// feedback drafts above the input box, and says the panel is why (#502).
//
// Claude Code can draft feedback about itself and show the drafts in a panel,
// a rounded box drawn as the last thing right above its input box
// (helpers/screens.js CLAUDE_FEEDBACK_PANEL_TYPED, a capture from arch-panel's
// architect session, 2026-10-07, passed on by Bot Father). While it is open
// the slash menu does not come up, and the panel takes single keys from the
// input line: `1` opens review, `2` and `2` again sends a draft to Anthropic,
// `0` dismisses. After a `0` Claude Code may ask instead, with no box, "Turn
// off Claude-drafted feedback? 0 to turn off · Esc to keep", and a typed line
// answers that too.
//
// The requirement, as these tests hold it:
//
//   1. The kit's gate sees the panel: `feedbackPanelIn(rows)` in src/orca.js
//      is true for a screen that shows it, and `questionIn(rows)` is true for
//      that screen too, so every caller that asks it refuses. Every label
//      ("Bug report", "Product feedback", "Feature request", "Feedback"),
//      every foot (at rest, with or without more queued, the confirm of a
//      send, sending, sent, a send to retry) and the question to turn the
//      drafts off count.
//   2. `tabToTypeInto` answers `{ blocked: 'feedback-drafts-panel' }` for a
//      Claude Code tab whose screen shows the panel. The tests see that value
//      where the paths pass it on unchanged: the mail nudge's answer and the
//      skills reload's report, both held in this file. Session clear and
//      compact, the session naming, the list line and the grooming line are
//      held in their own files, beside the tests of those paths.
//   3. Nothing at all goes into a tab that shows the panel: no character, no
//      Esc, no return, no backspace.
//   4. What stays no panel: the same screen with the panel taken out, a plain
//      Claude Code screen, Codex's screens, a question that is not the panel,
//      and the panel's words in the history, with a turn after them. A guard
//      that took those for the panel would swallow every nudge.
//
// Every absence here has its presence beside it: the same path, on the same
// screen with the panel taken out (CLAUDE_FEEDBACK_PANEL_GONE), types its line.
// Expected values are the requirement's: true and false, the kit's word
// `feedback-drafts-panel`, and the lines the paths type.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import * as orca from '../src/orca.js';
import {
  botHomeOf,
  createSandbox,
  sentInto,
  sessionIn,
  typedInto,
} from './helpers/cli.js';
import {
  CLAUDE_ANSWERED,
  CLAUDE_COMPACT_TYPED,
  CLAUDE_FEEDBACK_PANEL,
  CLAUDE_FEEDBACK_PANEL_GONE,
  CLAUDE_FEEDBACK_PANEL_TYPED,
  CLAUDE_FEEDBACK_TURN_OFF,
  CLAUDE_IDLE,
  CLAUDE_TEACH_LIST,
  CODEX_ANSWERED,
  CODEX_IDLE,
  CODEX_UPDATE_OFFER,
  FEEDBACK_PANEL_IN_HISTORY,
  FEEDBACK_TURN_OFF_IN_HISTORY,
} from './helpers/screens.js';
import { addSkills, answerOf, botYamlOf, entryOf, SKILL_DIRS } from './helpers/skills.js';

/** The kit's word for a tab whose screen shows the panel of feedback drafts. */
const PANEL = 'feedback-drafts-panel';

/**
 * `feedbackPanelIn` from src/orca.js, through the module, so that a kit
 * without it fails each test that asks it on an assertion and the rest of
 * the file still runs.
 */
function feedbackPanelIn(rows) {
  assert.equal(typeof orca.feedbackPanelIn, 'function', 'src/orca.js exports feedbackPanelIn(rows)');
  return orca.feedbackPanelIn(rows);
}

/** The panel's title row in the capture, and its foot at rest. */
const TITLE_ROW = CLAUDE_FEEDBACK_PANEL.find((row) => row.includes(' drafted: '));
const FOOT_ROW = CLAUDE_FEEDBACK_PANEL.find((row) => row.includes('1 to review'));

/** A row inside the panel's box reading `text`, padded to the captured box's width. */
const boxRow = (text) => `│ ${text}`.padEnd(TITLE_ROW.length - 1) + '│';

/**
 * CLAUDE_FEEDBACK_PANEL with its title row's label `label` in place of "Bug
 * report", nothing else changed: a reconstruction on Claude Code 2.1.291's
 * labels.
 */
const panelLabelled = (label) => CLAUDE_FEEDBACK_PANEL.map((row) => (
  row === TITLE_ROW ? boxRow(`✻ ${label} drafted: Auto-mode classifier refused owner-approved routine steps`) : row
));

/**
 * CLAUDE_FEEDBACK_PANEL with its foot reading `foot`, nothing else changed: a
 * reconstruction on the foot forms in Claude Code 2.1.291's code.
 */
const panelWithFoot = (foot) => CLAUDE_FEEDBACK_PANEL.map((row) => (row === FOOT_ROW ? boxRow(foot) : row));

/** The panel's foot with no more drafts queued. */
const PANEL_NONE_QUEUED = panelWithFoot('1 to review · 2 to send · 0 to dismiss');

/**
 * The panel after one `2`, asking to confirm the send. Only "Send without
 * reviewing (full draft + env, no transcript)? 2 to send" was read; what
 * follows it on the row was not, so it is left off.
 */
const PANEL_CONFIRM_SEND = panelWithFoot('Send without reviewing (full draft + env, no transcript)? 2 to send');

/** The panel while a draft goes, and once it has gone. */
const PANEL_SENDING = panelWithFoot('Sending…');
const PANEL_SENT = panelWithFoot('✓ Sent');

/** The panel after a send that failed: only "1 to review & retry" was read, so the row holds that alone. */
const PANEL_RETRY = panelWithFoot('1 to review & retry');

/**
 * The panel's box taken out, and the status row still counting "4 feedback
 * drafts": drafts queued, but no panel drawn. A reconstruction: whether Claude
 * Code shows the count with no panel was not seen. The panel is the box above
 * the input box, not the count.
 */
const COUNT_ONLY = CLAUDE_FEEDBACK_PANEL.filter((row) => !/^[╭│╰]/.test(row));

/** The panel above an input line that is the pointer alone, as the 2.1.289 capture CLAUDE_TEACH_LIST draws an empty one. */
const PANEL_BARE_POINTER = CLAUDE_FEEDBACK_PANEL.map((row) => (row === '❯ ' ? '❯' : row));

// The premises of the reconstructions: each changed what it says, and only that.
test('the panel screens here are the capture with one change each', () => {
  assert.ok(TITLE_ROW.startsWith('│ ✻ Bug report drafted: '), `the captured title row, got: ${TITLE_ROW}`);
  assert.ok(FOOT_ROW.startsWith('│ 1 to review · 2 to send · 0 to dismiss · +3 more queued'), `the captured foot, got: ${FOOT_ROW}`);
  for (const [label, screen] of [
    ['a label', panelLabelled('Feedback')],
    ['the foot', PANEL_CONFIRM_SEND],
    ['the input line', PANEL_BARE_POINTER],
  ]) {
    assert.equal(screen.length, CLAUDE_FEEDBACK_PANEL.length, `${label}: as many rows`);
    assert.equal(screen.filter((row, at) => row !== CLAUDE_FEEDBACK_PANEL[at]).length, 1, `${label}: one row changed`);
    assert.ok(screen.every((row) => !/^[╭│╰]/.test(row) || row.length === TITLE_ROW.length), `${label}: the box keeps its width`);
  }
  assert.ok(!CLAUDE_FEEDBACK_PANEL.some((row) => row.includes('/compact')), 'the idle panel has nothing in its input line');
  assert.ok(CLAUDE_FEEDBACK_PANEL_GONE.every((row) => !/^[╭│╰]/.test(row)), 'the panel gone has no row of the box');
});

// ------------------------------------------------------------- the gate itself

// Covers requirement 1: the capture of issue #502, `/compact` typed, is the panel.
test('feedbackPanelIn: the panel as captured, /compact typed under it and the slash menu\'s rows above it, is the panel', () => {
  assert.equal(feedbackPanelIn(CLAUDE_FEEDBACK_PANEL_TYPED), true);
});

// Covers requirement 1: the panel as the kit finds it before it types.
test('feedbackPanelIn: the panel above an empty input line is the panel, with the pointer\'s non-breaking space or the pointer alone', () => {
  assert.equal(feedbackPanelIn(CLAUDE_FEEDBACK_PANEL), true, 'the pointer and its non-breaking space');
  assert.equal(feedbackPanelIn(PANEL_BARE_POINTER), true, 'the pointer alone');
});

// Covers requirement 1, whichever label Claude Code gives the draft.
for (const label of ['Product feedback', 'Feature request', 'Feedback']) {
  test(`feedbackPanelIn: the panel with a draft labelled "${label}" is the panel`, () => {
    assert.equal(feedbackPanelIn(panelLabelled(label)), true);
  });
}

// Covers requirement 1, whichever foot the panel shows.
for (const [label, screen] of [
  ['no more drafts queued', PANEL_NONE_QUEUED],
  ['the confirm of a send after one 2', PANEL_CONFIRM_SEND],
  ['"Sending…"', PANEL_SENDING],
  ['"✓ Sent"', PANEL_SENT],
  ['a failed send, "1 to review & retry"', PANEL_RETRY],
]) {
  test(`feedbackPanelIn: the panel with its foot on ${label} is the panel`, () => {
    assert.equal(feedbackPanelIn(screen), true);
  });
}

// Covers requirement 1: the question that may follow a `0`, with no box.
test('feedbackPanelIn: "Turn off Claude-drafted feedback? 0 to turn off · Esc to keep" right above the input box is the panel', () => {
  assert.equal(feedbackPanelIn(CLAUDE_FEEDBACK_TURN_OFF), true);
});

// Covers requirement 4. The first row is the presence for every test above:
// the same screen with the panel taken out is no panel, so a true above comes
// from the panel and not from the rest of the screen.
for (const [label, screen] of [
  ['the panel screen with the panel taken out', CLAUDE_FEEDBACK_PANEL_GONE],
  ['the panel screen with the box taken out, the status row still counting the drafts', COUNT_ONLY],
  ['the captured panel\'s box in the history, a turn after it', FEEDBACK_PANEL_IN_HISTORY],
  ['the question to turn the drafts off quoted in the history, a row after it', FEEDBACK_TURN_OFF_IN_HISTORY],
  ['Claude Code 2.1.283\'s idle input line, captured', CLAUDE_IDLE],
  ['Claude Code 2.1.283 after an answered turn, captured', CLAUDE_ANSWERED],
  ['Claude Code\'s slash menu above its input box, /compact typed', CLAUDE_COMPACT_TYPED],
  ['Claude Code 2.1.289\'s Teach list above its input box, a question that is not the panel', CLAUDE_TEACH_LIST],
  ['Codex 0.157.1\'s idle input line, captured', CODEX_IDLE],
  ['Codex 0.157.1 after an answered turn, captured', CODEX_ANSWERED],
  ['Codex\'s update offer, a question that is not the panel', CODEX_UPDATE_OFFER],
]) {
  test(`feedbackPanelIn: ${label} is no panel`, () => {
    assert.equal(feedbackPanelIn(screen), false);
  });
}

// Covers requirement 1 for `questionIn`: every caller that asks it refuses the panel.
for (const [label, screen] of [
  ['the panel as captured, /compact typed', CLAUDE_FEEDBACK_PANEL_TYPED],
  ['the panel above an empty input line', CLAUDE_FEEDBACK_PANEL],
  ['the panel with a "Feature request" draft', panelLabelled('Feature request')],
  ['the panel asking to confirm a send', PANEL_CONFIRM_SEND],
  ['the question to turn the drafts off', CLAUDE_FEEDBACK_TURN_OFF],
]) {
  test(`questionIn: ${label} is a question to the gate`, () => {
    assert.equal(orca.questionIn(screen), true);
  });
}

// Covers requirement 4 for `questionIn`. These pass before the change: they
// hold the new rule to leaving them alone.
for (const [label, screen] of [
  ['the panel screen with the panel taken out', CLAUDE_FEEDBACK_PANEL_GONE],
  ['the panel screen with the box taken out, the status row still counting the drafts', COUNT_ONLY],
  ['the captured panel\'s box in the history, a turn after it', FEEDBACK_PANEL_IN_HISTORY],
  ['the question to turn the drafts off quoted in the history', FEEDBACK_TURN_OFF_IN_HISTORY],
]) {
  test(`questionIn: ${label} is no question`, () => {
    assert.equal(orca.questionIn(screen), false);
  });
}

// ------------------------------------------------------------ the mail nudge

/** Give one tab a screen of its own; every other tab keeps the screen it had. */
async function showIn(box, tab, shown) {
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.tabId === tab ? { ...terminal, ...shown } : terminal)),
  });
}

/** The tab one session lives in, as the book has it. */
const tabOf = async (bots, bot, session = 'daily') => (await sessionIn(bots, bot, session)).tab;

/** What was typed into every tab of the whole fleet, after the launch line each one got. */
async function typedSinceLaunch(box) {
  const after = {};
  for (const terminal of await box.orca.terminals()) after[terminal.tabId] = typedInto(terminal).slice(1);
  return after;
}

/** A Claude bot `writer` and a Codex bot `coder`, each with one session, both up, nothing typed since. */
async function fleetIn(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness] of [['writer', 'claude'], ['coder', 'codex']]) {
    assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness])).code, 0);
    assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily'])).code, 0);
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
}

/**
 * The arguments of one message to the Claude bot `writer`, from the Codex bot,
 * so it goes through Orca and the kit types the nudge (PRD 6.9).
 */
const sendArgs = [
  'message', 'send', '--bots', 'bots', '--to', 'writer', '--from', 'coder/daily',
  '--subject', 'the staging host', '--text', 'It is down again.',
];

/** Send the message, `--json`, and read the answer. The message goes whatever became of the nudge. */
async function send(box) {
  const result = await box.run([...sendArgs, '--json']);
  assert.equal(result.code, 0, `the message went whatever became of the nudge: ${result.stdout}${result.stderr}`);
  return JSON.parse(result.stdout);
}

/** The message is in the mailbox, and nothing at all was typed into any tab after its launch line. */
async function assertQueuedUntyped(box, what) {
  assert.equal((await box.orca.messages()).length, 1, `${what}: the message is in the mailbox`);
  assert.deepEqual(Object.values(await typedSinceLaunch(box)).flat(), [], `${what}: and nothing was typed into any tab`);
}

// Covers requirements 2 and 3 for the mail nudge.
for (const [label, screen] of [
  ['the panel above its empty input line', CLAUDE_FEEDBACK_PANEL],
  ['the panel asking to confirm a send', PANEL_CONFIRM_SEND],
  ['the question to turn the drafts off', CLAUDE_FEEDBACK_TURN_OFF],
]) {
  test(`a Claude tab showing ${label}, Orca calling it idle, gets no nudge, and the answer says blocked: feedback-drafts-panel`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    await showIn(box, await tabOf(bots, 'writer'), { screen });

    const answer = await send(box);

    assert.equal(answer.sent, true, `${label}: the message is in the mailbox, got ${JSON.stringify(answer)}`);
    assert.equal(answer.nudged, false, `${label}: got ${JSON.stringify(answer)}`);
    assert.equal(answer.blocked, PANEL, `${label}: the answer names the panel, got ${JSON.stringify(answer)}`);
    await assertQueuedUntyped(box, label);
  });
}

// Covers requirement 2, "says": the plain report names the panel.
test('the plain report for a Claude tab showing the panel names feedback-drafts-panel and says nothing was typed', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await showIn(box, await tabOf(bots, 'writer'), { screen: CLAUDE_FEEDBACK_PANEL });

  const result = await box.run(sendArgs);

  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.includes(`(${PANEL})`), `the report names what the tab is waiting on, got:\n${result.stdout}`);
  assert.match(result.stdout, /nothing was typed/, `and says nothing was typed, got:\n${result.stdout}`);
  await assertQueuedUntyped(box, 'the plain report, the panel');
});

// The presence beside the tests above: the same screen with the panel taken
// out, and the panel's words in the history, get the nudge as ever, one line
// into the receiver's tab. These pass before the change.
for (const [label, screen] of [
  ['the panel screen with the panel taken out', CLAUDE_FEEDBACK_PANEL_GONE],
  ['the captured panel\'s box in the history, a turn after it', FEEDBACK_PANEL_IN_HISTORY],
]) {
  test(`a Claude tab showing ${label}: no panel, and it is nudged as ever`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const reader = await tabOf(bots, 'writer');
    await showIn(box, reader, { screen });

    const answer = await send(box);

    assert.equal(answer.nudged, true, `${label}: the tab is told, got ${JSON.stringify(answer)}`);
    assert.equal('blocked' in answer, false, `${label}: nothing is waiting, got ${JSON.stringify(answer)}`);
    const typed = await typedSinceLaunch(box);
    assert.equal(typed[reader].length, 1, `${label}: one line into the receiver's tab, got ${JSON.stringify(typed[reader])}`);
    assert.match(typed[reader][0], /message check/, `${label}: the nudge, got ${typed[reader][0]}`);
  });
}

// ----------------------------------------------------------- the skills reload

/** One of the kit's own skills, and Claude Code's command for picking up skills changed on disk. */
const KIT_SKILL = 'obk-tdd';
const RELOAD = '/reload-skills';

/** The bot whose skills change. */
const BOT = 'api-bot';

/** Bot Father, and api-bot with a Claude session `daily` and a Codex session `reviewer`, all up, nothing typed since. */
async function skillsFleetIn(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude', '--charter', `${BOT} owns its own corner.`]);
  assert.equal(made.code, 0, made.stderr);
  for (const [session, harness] of [['daily', 'claude'], ['reviewer', 'codex']]) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', session, '--harness', harness]);
    assert.equal(added.code, 0, added.stderr);
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
}

/** A skills build that links one more skill into api-bot, `--json`: what it says of each session. */
async function build(box, bots) {
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);
  const result = await box.run(['skills', 'build', '--bots', 'bots', '--json']);
  assert.equal(result.code, 0, `the links were made whatever became of the telling: ${result.stdout}${result.stderr}`);
  const entry = entryOf(answerOf(result), BOT);
  assert.ok(Array.isArray(entry.sessions), `${BOT}'s links changed, so its sessions are reported, got: ${JSON.stringify(entry)}`);
  return entry.sessions;
}

/** What the Codex session is told to read meanwhile: the SKILL.md through the bot's own link. */
const codexSkillMd = (bots) => path.join(botHomeOf(bots, BOT), SKILL_DIRS.codex, KIT_SKILL, 'SKILL.md');

/** Each `terminal send` into every tab since its launch line, by tab id. */
async function sentSinceLaunch(box) {
  const after = {};
  for (const terminal of await box.orca.terminals()) after[terminal.tabId] = sentInto(terminal).slice(1);
  return after;
}

// Covers requirements 2 and 3 for the skills reload. `/reload-skills` goes in
// with a return, and the panel reads the input line. Only the Claude session's
// tab shows the panel.
test('a Claude session showing the panel gets no /reload-skills, and is reported blocked on feedback-drafts-panel', async (t) => {
  const box = await createSandbox(t);
  const bots = await skillsFleetIn(box);
  await showIn(box, await tabOf(bots, BOT, 'daily'), { screen: CLAUDE_FEEDBACK_PANEL });

  const sessions = await build(box, bots);

  assert.deepEqual(sessions, [
    { session: 'daily', harness: 'claude', state: 'blocked', blocked: PANEL },
    { session: 'reviewer', harness: 'codex', state: 'next-turn', read: [codexSkillMd(bots)] },
  ]);
  assert.deepEqual(Object.values(await sentSinceLaunch(box)).flat(), [], `no ${RELOAD}, and nothing else, typed anywhere`);
});

// The presence beside the test above: the same screen with the panel taken
// out gets `/reload-skills`, with a return, into the Claude session's tab
// alone. Passes before the change.
test('a Claude session on the panel screen with the panel taken out gets /reload-skills, and is reported reloaded', async (t) => {
  const box = await createSandbox(t);
  const bots = await skillsFleetIn(box);
  const daily = await tabOf(bots, BOT, 'daily');
  await showIn(box, daily, { screen: CLAUDE_FEEDBACK_PANEL_GONE });

  const sessions = await build(box, bots);

  assert.deepEqual(sessions, [
    { session: 'daily', harness: 'claude', state: 'reloaded' },
    { session: 'reviewer', harness: 'codex', state: 'next-turn', read: [codexSkillMd(bots)] },
  ]);
  const sent = await sentSinceLaunch(box);
  assert.deepEqual(sent[daily].map(({ text, enter }) => ({ text, enter })), [{ text: RELOAD, enter: true }], `one ${RELOAD} with a return into daily's tab`);
  for (const [tab, sends] of Object.entries(sent)) {
    if (tab !== daily) assert.deepEqual(sends, [], `nothing into ${tab}`);
  }
});
