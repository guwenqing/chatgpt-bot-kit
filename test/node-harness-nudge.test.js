// A harness the kit launched is told its mail is there whatever its process is
// called (#261).
//
// #232 types the one line into a session's tab only when the process leading
// the tab's foreground group has the name of the agent Orca names there,
// `claude` or `codex`. A harness installed through npm runs as `node`, so its
// tab got "cannot tell", nothing was typed, and it was never told its mail was
// there.
//
// The rule (architect's ruling on #261, 2026-09-28): when the process in front
// is not named as the agent, the kit reads its environment and its parent with
// `ps`, and counts it as the harness it launched only when both hold:
//
//   - its environment carries this tab's `ORCA_TAB_ID=<tab id>`, as a whole
//     word;
//   - it carries `OBK_TAB_SHELL=<n>` with n its own parent's pid: the tab's
//     shell started it on the kit's launch line (`OBK_TAB_SHELL=$$ OBK_CLI=…
//     <harness> …`).
//
// Anything else is "cannot tell", and nothing is typed: an environment or
// parent `ps` cannot read, a `ps` that is not permitted to start (Codex's
// sandbox, where only Orca's runtime answers and gives no pid), no mark (a tab
// Orca restored by itself), a mark naming another tab, and a mark on a process
// whose parent is not the shell (a program the harness started). #232's case
// stays out: `less` run from the shell after the harness quit carries no mark.
// A front named as the agent is typed into as before, a question on screen or
// Orca's blocked reason still stops the line, and the shell in front is not up.
//
// The fake `ps` (helpers/fake-ps.js) puts `node` in front with `foreground:
// 'node-harness'` (the shell's child, carrying the launch line's variables) and
// `'node-child'` (a `node` the harness started), and says what the front
// carries with `environment`. Each test below sets them on the receiver's tab
// alone.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  createSandbox,
  orcaApp,
  sentInto,
  sessionIn,
  spellingsOf,
  typedInto,
} from './helpers/cli.js';
import { CLAUDE_TEACH_AUTO } from './helpers/screens.js';
import { addSkills, answerOf, botYamlOf, entryOf, kitSkill, assertLinked } from './helpers/skills.js';

// ------------------------------------------------------------- the fleet

/**
 * A Codex bot `writer` that sends and a Claude bot `reader` that receives, each
 * with a `daily` session, both up, nothing typed since. The writer is Codex
 * because mail between two Claude sessions of one approval class goes by
 * Claude's own messaging, not through Orca.
 */
async function fleetIn(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness] of [['writer', 'codex'], ['reader', 'claude']]) {
    assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness])).code, 0);
    assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', 'daily'])).code, 0);
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
}

/** The receiver's tab, as Orca holds it. */
async function readerTab(box, bots) {
  const { tab } = await sessionIn(bots, 'reader', 'daily');
  const terminal = (await box.orca.terminals()).find((one) => one.tabId === tab);
  assert.ok(terminal, `the premise: Orca has the reader's tab ${tab}`);
  return terminal;
}

/** Give the receiver's tab alone what a test says: `foreground`, `environment`, `screen`. */
async function steerReader(box, bots, changes) {
  const { tabId } = await readerTab(box, bots);
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((one) => (one.tabId === tabId ? { ...one, ...changes } : one)),
  });
}

/** Send one message from the writer to the reader, `--json`, and read the answer. */
async function send(box) {
  const result = await box.run([
    'message', 'send', '--bots', 'bots', '--to', 'reader', '--from', 'writer/daily',
    '--subject', 'the staging host', '--text', 'It is down again.', '--json',
  ]);
  assert.equal(result.code, 0, `the message went whatever became of the nudge: ${result.stdout}${result.stderr}`);
  const answer = JSON.parse(result.stdout);
  assert.equal(answer.sent, true, `got: ${result.stdout}`);
  return answer;
}

/** The same send, in plain words. */
async function sendPlain(box) {
  const result = await box.run([
    'message', 'send', '--bots', 'bots', '--to', 'reader', '--from', 'writer/daily',
    '--subject', 'the staging host', '--text', 'It is down again.',
  ]);
  assert.equal(result.code, 0, `the message went whatever became of the nudge: ${result.stdout}${result.stderr}`);
  return result.stdout;
}

/** What was typed into every tab of the whole fleet, after the launch line each one got. */
async function typedSinceLaunch(box) {
  const after = {};
  for (const terminal of await box.orca.terminals()) after[terminal.tabId] = typedInto(terminal).slice(1);
  return after;
}

/** The words of the sentence the kit gives when it cannot tell (#232). */
const COULD_NOT_TELL = /could not tell whether a harness is running in it/;

/** One nudge, into the reader's tab and no other: the line that says how to read the mail. */
async function assertNudgedOnly(box, bots, answer) {
  assert.equal(answer.nudged, true, `the reader's tab should have been told, got: ${JSON.stringify(answer)}`);
  assert.equal('nudgeTrouble' in answer, false, `nothing stopped the nudge, got: ${JSON.stringify(answer)}`);
  const reader = (await readerTab(box, bots)).tabId;
  const typed = await typedSinceLaunch(box);
  assert.equal(typed[reader].length, 1, `one line into the reader's tab, got: ${JSON.stringify(typed[reader])}`);
  assert.ok(
    spellingsOf(box.cli).some((cli) => typed[reader][0].includes(`${cli} message check --bots `)),
    `the nudge, which says how to read the mail, got: ${typed[reader][0]}`,
  );
  for (const [tab, lines] of Object.entries(typed)) {
    if (tab !== reader) assert.deepEqual(lines, [], `nothing may be typed into ${tab}: it is not the reader's`);
  }
}

/** Not nudged, because the kit could not tell: nothing typed anywhere, the mail waits, and nobody is called not up. */
async function assertCouldNotTell(box, answer, what) {
  assert.equal(answer.nudged, false, `${what}: got ${JSON.stringify(answer)}`);
  assert.equal(typeof answer.nudgeTrouble, 'string', `${what}: a sentence saying why, got ${JSON.stringify(answer)}`);
  assert.match(answer.nudgeTrouble, COULD_NOT_TELL, `${what}: got ${JSON.stringify(answer)}`);
  assert.doesNotMatch(answer.nudgeTrouble, /not up/, `${what}: the kit does not know that, got ${JSON.stringify(answer)}`);
  assert.equal((await box.orca.messages()).length, 1, `${what}: the message is in the mailbox`);
  assert.deepEqual(Object.values(await typedSinceLaunch(box)).flat(), [], `${what}: and nothing was typed into any tab`);
}

// ------------------------------------------------ what ps shows, as premise

/**
 * What the fake `ps` shows in front of the reader's tab, read the way the
 * rule reads it: the front's pid, parent and name, and the words of its
 * environment. So each test can say its setup is the one it means.
 */
async function frontOfReader(box, bots) {
  const { ptyId, tabId } = await readerTab(box, bots);
  const memory = JSON.parse(spawnSync(box.orca.cli, ['diagnostics', 'memory', '--json'], { env: box.env, encoding: 'utf8' }).stdout);
  const pane = memory.result.worktrees.flatMap((worktree) => worktree.sessions).find((one) => one.sessionId === ptyId);
  const read = (pid) => {
    const done = spawnSync(box.ps.cli, ['-o', 'pid=,ppid=,tpgid=,comm=', '-p', String(pid)], { env: box.env, encoding: 'utf8' });
    assert.equal(done.status, 0, done.stderr);
    const [one, ppid, tpgid, ...comm] = done.stdout.trim().split(/\s+/);
    return { pid: Number(one), ppid: Number(ppid), tpgid: Number(tpgid), comm: comm.join(' ') };
  };
  const front = read(read(pane.pid).tpgid);
  const environment = spawnSync(box.ps.cli, ['-E', '-ww', '-o', 'command=', '-p', String(front.pid)], { env: box.env, encoding: 'utf8' });
  return { ...front, tabId, words: environment.status === 0 ? environment.stdout.trim().split(' ') : undefined };
}

// ---------------------------------------------------------------------------
// N1 — a `node` harness the kit's launch line started: counted as the harness, idle or busy.
// ---------------------------------------------------------------------------

test('N1 an idle harness running as node, started by the kit\'s launch line in its tab, is told its mail is there', async (t) => {
  // The issue itself: Claude Code installed through npm, so `node` leads the
  // tab's foreground group, while Orca names `claude` in the tab.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await steerReader(box, bots, { foreground: 'node-harness' });
  assert.equal((await readerTab(box, bots)).agentIdentity, 'claude', 'the premise: Orca names claude in the reader\'s tab');
  const front = await frontOfReader(box, bots);
  assert.equal(front.comm, 'node', 'the premise: node is in front');
  assert.ok(front.words.includes(`ORCA_TAB_ID=${front.tabId}`), `the premise: it carries the tab's id, got: ${front.words.join(' ')}`);
  assert.ok(front.words.includes(`OBK_TAB_SHELL=${front.ppid}`), `the premise: and the mark, naming its parent, got: ${front.words.join(' ')}`);

  const answer = await send(box);

  await assertNudgedOnly(box, bots, answer);
});

test('N1 an idle node harness\'s plain send says its tab was told to look', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await steerReader(box, bots, { foreground: 'node-harness' });

  const stdout = await sendPlain(box);

  assert.match(stdout, /its tab was told to look/, `got: ${stdout}`);
  assert.doesNotMatch(stdout, COULD_NOT_TELL, `got: ${stdout}`);
  assert.equal(typedInto(await readerTab(box, bots)).slice(1).length, 1, 'one line into the reader\'s tab');
});

test('N1 a busy harness running as node, started by the kit\'s launch line, counts as the harness: a busy Claude Code, so nothing is typed and its hook tells it (#509)', async (t) => {
  // A busy harness was typed its line as its next turn (#232). Since #509 a
  // busy Claude Code gets nothing typed: its own Stop hook tells it of the
  // mail when its turn ends (signal hook, because busy). What stays from #261:
  // the node in front is the harness, so the answer is that, not "cannot tell".
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await box.orca.set({ waitIdle: 'busy' });
  await steerReader(box, bots, { foreground: 'node-harness' });

  const answer = await send(box);

  assert.equal(answer.nudged, false, `nothing typed into a busy Claude Code, got: ${JSON.stringify(answer)}`);
  assert.equal(answer.signal, 'hook', `its hook tells it, got: ${JSON.stringify(answer)}`);
  assert.equal(answer.because, 'busy', `because it is busy, got: ${JSON.stringify(answer)}`);
  assert.equal('nudgeTrouble' in answer, false, `nothing stopped the nudge, got: ${JSON.stringify(answer)}`);
  assert.deepEqual(Object.values(await typedSinceLaunch(box)).flat(), [], 'nothing typed into any tab');
});

test('N1 a busy node harness\'s plain send says nothing was typed and its hook tells it, not that the kit could not tell (#509)', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await box.orca.set({ waitIdle: 'busy' });
  await steerReader(box, bots, { foreground: 'node-harness' });

  const stdout = await sendPlain(box);

  assert.match(stdout, /hook/i, `got: ${stdout}`);
  assert.doesNotMatch(stdout, COULD_NOT_TELL, `got: ${stdout}`);
});

// ---------------------------------------------------------------------------
// N2 — a front that is not the harness the kit launched: nothing typed.
// ---------------------------------------------------------------------------

test('N2 `less` run from the shell after the harness quit, with Orca still naming claude, is not typed into (#232)', async (t) => {
  // #232's case. `less` is the shell's child, as the harness was, but the
  // launch line gave its variables to the harness alone.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await steerReader(box, bots, { foreground: 'program' });
  assert.equal((await readerTab(box, bots)).agentIdentity, 'claude', 'the premise: Orca still names claude');
  const front = await frontOfReader(box, bots);
  assert.equal(front.comm, 'less', 'the premise: less is in front');
  assert.ok(front.words.includes(`ORCA_TAB_ID=${front.tabId}`), `the premise: it carries the tab's id, got: ${front.words.join(' ')}`);
  assert.equal(front.words.some((word) => word.startsWith('OBK_TAB_SHELL=')), false, `the premise: and no mark, got: ${front.words.join(' ')}`);

  const answer = await send(box);

  await assertCouldNotTell(box, answer, 'less in front');
});

test('N2 a node harness Orca restored by itself, with none of the launch line in its environment, is not typed into', async (t) => {
  // The architect's note on #261: Orca resumes the harness with a bare
  // `claude --resume`, so the tab carries no mark. By name alone the kit cannot
  // tell `node` from any other program.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await steerReader(box, bots, { foreground: 'node-harness', environment: 'orca' });
  const front = await frontOfReader(box, bots);
  assert.equal(front.comm, 'node', 'the premise: node is in front');
  assert.ok(front.words.includes(`ORCA_TAB_ID=${front.tabId}`), `the premise: it carries the tab's id, got: ${front.words.join(' ')}`);
  assert.equal(front.words.some((word) => word.startsWith('OBK_TAB_SHELL=')), false, `the premise: and no mark, got: ${front.words.join(' ')}`);

  const answer = await send(box);

  await assertCouldNotTell(box, answer, 'a restored node harness');
});

test('N2 a node front whose mark names another tab, whose id begins with this one\'s, is not typed into', async (t) => {
  // Only a whole word tells the two ids apart.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await steerReader(box, bots, { foreground: 'node-harness', environment: 'launched-other-tab' });
  const front = await frontOfReader(box, bots);
  assert.equal(front.comm, 'node', 'the premise: node is in front');
  assert.equal(front.words.includes(`ORCA_TAB_ID=${front.tabId}`), false, `the premise: not this tab's id, got: ${front.words.join(' ')}`);
  assert.ok(front.words.some((word) => word.startsWith(`ORCA_TAB_ID=${front.tabId}`)), `the premise: another that begins with it, got: ${front.words.join(' ')}`);
  assert.ok(front.words.includes(`OBK_TAB_SHELL=${front.ppid}`), `the premise: and the mark, naming its parent, got: ${front.words.join(' ')}`);

  const answer = await send(box);

  await assertCouldNotTell(box, answer, 'a mark naming another tab');
});

test('N2 a node program the harness started, carrying the mark with the shell\'s pid, is not typed into: its parent is the harness', async (t) => {
  // A program the harness starts inherits OBK_TAB_SHELL, but its parent is the
  // harness, not the shell the mark names.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await steerReader(box, bots, { foreground: 'node-child' });
  const front = await frontOfReader(box, bots);
  assert.equal(front.comm, 'node', 'the premise: node is in front');
  assert.ok(front.words.includes(`ORCA_TAB_ID=${front.tabId}`), `the premise: it carries the tab's id, got: ${front.words.join(' ')}`);
  const marks = front.words.filter((word) => word.startsWith('OBK_TAB_SHELL='));
  assert.equal(marks.length, 1, `the premise: it carries the mark, got: ${front.words.join(' ')}`);
  assert.notEqual(marks[0], `OBK_TAB_SHELL=${front.ppid}`, `the premise: naming a pid that is not its parent, got: ${marks[0]} with parent ${front.ppid}`);

  const answer = await send(box);

  await assertCouldNotTell(box, answer, 'a node program the harness started');
});

// ---------------------------------------------------------------------------
// N3 — what the rule needs cannot be read: cannot tell.
// ---------------------------------------------------------------------------

for (const [label, environment] of [
  ['ps cannot read the node front\'s environment', 'ps-fails'],
  ['ps gives the node front\'s command and no variables at all', 'no-tab-id'],
]) {
  test(`N3 when ${label}, the kit cannot tell: nothing is typed`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    await steerReader(box, bots, { foreground: 'node-harness', environment });

    const answer = await send(box);

    await assertCouldNotTell(box, answer, label);
  });
}

test('N3 when ps is not permitted to start, as in Codex\'s sandbox, and Orca\'s runtime says node is in front, the kit cannot tell', async (t) => {
  // The runtime gives the front's name and no pid, so there is no environment
  // to read (#298, #408).
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await orcaApp(box);
  await steerReader(box, bots, { foreground: 'node-harness' });
  await box.orca.set({ ps: 'not-permitted' });

  const answer = await send(box);

  await assertCouldNotTell(box, answer, 'ps not permitted');
});

// ---------------------------------------------------------------------------
// N4 — what #261 leaves as it was.
// ---------------------------------------------------------------------------

test('N4 a harness named as the agent Orca names is typed into as before, with no mark in its environment', async (t) => {
  // A native `claude` Orca restored by itself carries none of the launch line,
  // and its name is enough, as under #232.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await steerReader(box, bots, { foreground: 'harness', environment: 'orca' });
  const front = await frontOfReader(box, bots);
  assert.equal(front.comm, 'claude', 'the premise: claude is in front');
  assert.equal(front.words.some((word) => word.startsWith('OBK_TAB_SHELL=')), false, `the premise: with no mark, got: ${front.words.join(' ')}`);

  const answer = await send(box);

  await assertNudgedOnly(box, bots, answer);
});

test('N4 a harness named as the agent whose environment cannot be read is typed into as before', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await steerReader(box, bots, { foreground: 'harness', environment: 'ps-fails' });

  const answer = await send(box);

  await assertNudgedOnly(box, bots, answer);
});

for (const [label, changes, state] of [
  ['a question on its screen', { screen: CLAUDE_TEACH_AUTO }, {}],
  ['Orca\'s blocked reason', {}, { waitIdle: 'blocked' }],
]) {
  test(`N4 a node harness the kit launched, with ${label}, is not typed into`, async (t) => {
    // The line's Enter would answer the question.
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    await box.orca.set(state);
    await steerReader(box, bots, { foreground: 'node-harness', ...changes });

    const answer = await send(box);

    assert.equal(answer.nudged, false, `got: ${JSON.stringify(answer)}`);
    assert.equal((await box.orca.messages()).length, 1, 'the message is in the mailbox');
    assert.deepEqual(Object.values(await typedSinceLaunch(box)).flat(), [], 'and nothing was typed into any tab');
  });
}

test('N4 the shell in front of the reader\'s tab is not up, as before', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await steerReader(box, bots, { foreground: 'shell' });

  const stdout = await sendPlain(box);

  assert.match(stdout, /not up/, `got: ${stdout}`);
  assert.doesNotMatch(stdout, COULD_NOT_TELL, `got: ${stdout}`);
  assert.deepEqual(Object.values(await typedSinceLaunch(box)).flat(), [], 'nothing was typed into any tab');
});

// ---------------------------------------------------------------------------
// N5 — the skills reload goes through the same gate.
// ---------------------------------------------------------------------------

/** One bot, `api-bot`, with one Claude session `daily`, up. */
async function oneBotUp(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'daily'])).code, 0);
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
}

for (const [label, foreground, state, typed] of [
  ['a node harness the kit launched is typed /reload-skills', 'node-harness', 'reloaded', [{ text: '/reload-skills', enter: true }]],
  ['`less` in front, from the shell after the harness quit, is not typed into', 'program', 'unknown', []],
]) {
  test(`N5 skills build: ${label}`, async (t) => {
    const box = await createSandbox(t);
    const bots = await oneBotUp(box);
    const { tab } = await sessionIn(bots, 'api-bot', 'daily');
    await box.orca.set({
      terminals: (await box.orca.terminals()).map((one) => (one.tabId === tab ? { ...one, foreground } : one)),
    });
    await addSkills(botYamlOf(bots, 'api-bot'), 'kit:obk-tdd');

    const result = await box.run(['skills', 'build', '--bots', 'bots', '--json']);

    assert.equal(result.code, 0, result.stderr);
    await assertLinked(bots, 'api-bot', 'obk-tdd', await kitSkill('obk-tdd'));
    const sessions = entryOf(answerOf(result), 'api-bot').sessions;
    assert.deepEqual(sessions.map((entry) => [entry.session, entry.state]), [['daily', state]], `got: ${JSON.stringify(sessions)}`);
    for (const terminal of await box.orca.terminals()) {
      assert.deepEqual(sentInto(terminal).slice(1), terminal.tabId === tab ? typed : [], `what was typed into ${terminal.tabId}`);
    }
  });
}
