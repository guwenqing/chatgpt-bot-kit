// Mail from a Codex session tells a busy Claude receiver it is there (#350):
// the send leaves the nudge it could not decide on, and the sending session's
// Codex hook decides it with `ps` and types it.
//
// The usual case is a developer waiting on a review verdict. The reviewer is a
// Codex session at the kit's `auto` level, so its `obk message send` runs in
// Codex's `workspace-write` sandbox, where /bin/ps does not start. The kit then
// asks Orca's runtime `terminal.inspectProcess` who is in front of the
// receiver's tab (#298). For a Claude Code running a command, or idle while it
// holds a background one, Orca answers verdict `unverifiable`, reason
// `tty_boundary` (an Orca bug on macOS: `ps` prints `??` for a process with no
// terminal, and Orca takes it for another terminal). So the kit says it could
// not tell whether a harness is running in the tab, and types nothing. #232's
// rule stays: never type into a shell or a program that is not the harness.
//
// The road (the architect's ruling on #350, 2026-10-02): Codex runs its hooks
// outside its sandbox (tech notes, section 3). So when the send, run in the
// tab the book holds for a Codex session the kit launched (its launch mark,
// OBK_TAB_SHELL, is there), cannot read the tab with `ps` and the look ends in
// "cannot tell", it leaves that nudge: the answer says `nudgeLeft: true`
// beside the "could not tell" sentence of today. The kit's hook on Codex's
// PostToolUse event, matched to its shell tool `Bash`, runs right after the
// shell command that ran the send:
//
//   obk session nudge --bots <bots> --bot <bot>
//
// with Codex's PostToolUse payload on stdin. In the same tab, where `ps` now
// runs, it decides each nudge left from that tab once, by the same gate as the
// send (ADR 0034): the harness Orca names, in front, nothing on screen to
// answer. Then it types exactly the line the send would have typed, and says
// so to the sending session as PostToolUse context. Whatever it cannot read, it
// exits 0 and disturbs nothing. Every other send answers as today, with no
// `nudgeLeft`: one where `ps` runs, one from a Claude session (only Codex has
// this hook), one whose `--from` is not the tab it runs in, and every look that
// is not "cannot tell".
//
// `obk up` writes the hook into a Codex bot's `.codex/hooks.json` beside the
// kit's SessionStart entry, and `obk health` names a Codex bot whose hooks file
// lacks it or whose hook runs a kit that is not there.
//
// Every run is in the sandbox: its own HOME and TMPDIR, a fake Orca, a fake
// `ps` (`ps: 'not-permitted'` is Codex's sandbox) and a fake Orca app whose
// runtime client answers `terminal.inspectProcess` (helpers/cli.js, `orcaApp`).
// Orca's `tty_boundary` answer below is written out by hand from the shape
// ADR 0034 records.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';

import {
  botHomeOf,
  createSandbox,
  eventsIn,
  hookFileOf,
  hooksIn,
  kitHooksIn,
  kitLaunchMark,
  orcaApp,
  sentInto,
  sessionIn,
  sh,
  shellWord,
  spellingsOf,
} from './helpers/cli.js';
import { CLAUDE_TEACH_AUTO } from './helpers/screens.js';

// --------------------------------------------------- what the runtime says

/**
 * What Orca's runtime answers for a Claude Code tab running a command, or
 * holding one in the background, on macOS: verdict `unverifiable`, reason
 * `tty_boundary`, `foregroundProcess` the leader's short kernel name, the
 * version file of a native Claude Code (ADR 0034, seen live in #298's run).
 */
const TTY_BOUNDARY = {
  process: {
    foregroundProcess: '2.1.282',
    hasChildProcesses: true,
    foregroundProcessEvidence: { verdict: 'unverifiable', processName: null, reason: 'tty_boundary', fence: { generation: 1 } },
  },
};

/** A shell at its prompt, as the runtime answers it (front-without-ps.test.js). */
const SHELL = {
  process: { foregroundProcess: null, hasChildProcesses: false, foregroundProcessEvidence: { verdict: 'live', processName: null, fence: { generation: 1 } } },
};

/** The words of the sentence the kit gives when it cannot tell (#232). */
const COULD_NOT_TELL = /could not tell whether a harness is running in it/;

// ------------------------------------------------------------- the fleet

/**
 * A Claude bot `developer` that receives and a Codex bot `reviewer` that sends,
 * each with a `daily` session (the reviewer with `sessions`), all up, nothing
 * typed since.
 */
async function fleetIn(box, { sessions = ['daily'] } = {}) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  for (const [bot, harness, names] of [['developer', 'claude', ['daily']], ['reviewer', 'codex', sessions]]) {
    assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness])).code, 0);
    for (const name of names) {
      const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', bot, '--name', name]);
      assert.equal(added.code, 0, added.stderr);
    }
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
}

/** The tab one session lives in, as the book has it, and Orca's own record of it. */
async function tabOf(box, bots, bot, session = 'daily') {
  const { tab } = await sessionIn(bots, bot, session);
  const terminal = (await box.orca.terminals()).find((one) => one.tabId === tab);
  assert.ok(terminal, `the premise: Orca has ${bot} ${session}'s tab ${tab}`);
  return terminal;
}

/** Change one tab of the fake Orca's world, by its tab id, and leave the rest. */
async function changeTab(box, tabId, changes) {
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((one) => (one.tabId === tabId ? { ...one, ...changes } : one)),
  });
}

/** From here on `ps` does not start, for any pid, as inside Codex's sandbox. */
const psNotPermitted = (box) => box.orca.set({ ps: 'not-permitted' });

/** From here on `ps` runs again, as it does for a hook Codex runs outside its sandbox. */
const psRuns = (box) => box.orca.set({ ps: undefined });

/** A conversation id of the shape Codex gives one. */
const THREAD = '0199b2c0-0408-4444-8888-cccccccccccc';

/**
 * The environment of a command run in one session's tab, the kit's launch mark
 * with it (kitLaunchMark), as every command of a harness the kit launched
 * carries it. `codexCommand` adds what a Codex tool command was seen to carry
 * live (codex-cli 0.157.1, restored-codex-caller.test.js): its conversation and
 * its sandbox. A hook Codex runs is not a sandboxed command, and gets only the
 * tab's own.
 */
async function inTab(box, bots, bot, session = 'daily', { codexCommand = false } = {}) {
  const terminal = await tabOf(box, bots, bot, session);
  const mark = kitLaunchMark(box, terminal);
  assert.equal(typeof mark.OBK_TAB_SHELL, 'string', `the premise: ${bot} ${session}'s tab was started on the kit's launch line`);
  return {
    ...box.env,
    ORCA_TAB_ID: terminal.tabId,
    ORCA_TERMINAL_HANDLE: terminal.handle,
    ...mark,
    ...(codexCommand ? { CODEX_THREAD_ID: THREAD, CODEX_SESSION_ID: THREAD, CODEX_SANDBOX: 'seatbelt' } : {}),
  };
}

/** The subject every send here carries. */
const SUBJECT = 'the review of PR 12';

/** The arguments of one send to `to`, as a session runs it. */
const sendArgs = ({ to = 'developer', from } = {}) => [
  'message', 'send', '--bots', 'bots', '--to', to,
  ...(from === undefined ? [] : ['--from', from]),
  '--subject', SUBJECT, '--text', 'Approved, with two notes.',
];

/** Send one message, `--json`, in `env`, and read the answer. The message goes whatever became of the nudge. */
async function send(box, env, options = {}) {
  const result = await box.run([...sendArgs(options), '--json'], { env });
  assert.equal(result.code, 0, `the message went whatever became of the nudge: ${result.stdout}${result.stderr}`);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.equal(answer.sent, true, `the message is sent whatever became of the nudge, got: ${result.stdout}`);
  return answer;
}

/**
 * The reviewer, a Codex session, sends to the developer from its own tab, in
 * Codex's sandbox, while Orca's runtime answers tty_boundary for the
 * developer's tab: busy (Orca's wait times out), or idle holding a background
 * command. `ps` does not start. Returns the fleet and the send's answer.
 */
async function leftFleet(t, { receiver = 'busy', sessions } = {}) {
  const box = await createSandbox(t);
  const bots = await fleetIn(box, { sessions });
  await orcaApp(box);
  const developer = await tabOf(box, bots, 'developer');
  await changeTab(box, developer.tabId, { inspect: TTY_BOUNDARY });
  if (receiver === 'busy') await box.orca.set({ waitIdle: 'busy' });
  await psNotPermitted(box);
  return { box, bots, developer };
}

/** `leftFleet`, then the send from the reviewer's daily tab; the premise is that it left the nudge. */
async function leftNudge(t, options) {
  const fleet = await leftFleet(t, options);
  const answer = await send(fleet.box, await inTab(fleet.box, fleet.bots, 'reviewer', 'daily', { codexCommand: true }));
  assert.equal(answer.nudgeLeft, true, `the premise: the send left its nudge for the hook, got: ${JSON.stringify(answer)}`);
  return { ...fleet, answer };
}

// ------------------------------------------------------------- the hook

/** The shell command the reviewer ran, which Codex hands the hook in tool_input. */
const SEND_COMMAND = `"$OBK_CLI" message send --bots bots --to developer --subject '${SUBJECT}' --text 'Approved, with two notes.' --json`;

/**
 * Codex's PostToolUse payload after its shell tool ran the send, as the
 * requirement names its fields. What `tool_response` holds is Codex's and is
 * not relied on.
 */
const afterBash = (bots, { command = SEND_COMMAND } = {}) => `${JSON.stringify({
  session_id: THREAD,
  turn_id: 'turn-3',
  transcript_path: '/nowhere/rollout.jsonl',
  cwd: botHomeOf(bots, 'reviewer'),
  hook_event_name: 'PostToolUse',
  model: 'gpt-5.5',
  permission_mode: 'default',
  tool_name: 'Bash',
  tool_input: { command },
  tool_response: '{"sent": true}',
  tool_use_id: 'call_7',
})}\n`;

/** Run the hook as Codex runs it: `obk session nudge` for `bot`, in `env`, with `stdin`. */
const hook = (box, env, stdin, bot = 'reviewer') => box.run(['session', 'nudge', '--bots', 'bots', '--bot', bot], { env, stdin });

/** Every key anywhere in a value. */
const keysIn = (value) => (value !== null && typeof value === 'object'
  ? Object.entries(value).flatMap(([key, held]) => [key, ...keysIn(held)])
  : []);

/** The fields that would make the hook a decision on the session's turn rather than a word to it. */
const DECISIONS = ['permissionDecision', 'decision', 'continue', 'permissionDecisionReason', 'stopReason'];

/**
 * The hook spoke: exit 0, and on standard output one line of Codex's
 * PostToolUse context and nothing else, with no decision in it. Returns the text.
 */
function assertSaid(ran, what) {
  assert.equal(ran.code, 0, `${what}: a hook never fails the session: ${ran.stderr}`);
  const lines = ran.stdout.split('\n').filter((line) => line !== '');
  assert.equal(lines.length, 1, `${what}: one JSON line on standard output, got: ${JSON.stringify(ran.stdout)}`);
  let answer;
  try {
    answer = JSON.parse(lines[0]);
  } catch (error) {
    return assert.fail(`${what}: the line is JSON, got: ${JSON.stringify(ran.stdout)} (${error.message})`);
  }
  assert.equal(answer?.hookSpecificOutput?.hookEventName, 'PostToolUse', `${what}: a PostToolUse answer, got: ${ran.stdout}`);
  const text = answer.hookSpecificOutput.additionalContext;
  assert.equal(typeof text, 'string', `${what}: its words in additionalContext, got: ${ran.stdout}`);
  assert.deepEqual(keysIn(answer).filter((key) => DECISIONS.includes(key)), [], `${what}: never a decision: ${ran.stdout}`);
  return text;
}

/** The hook said nothing: exit 0, nothing on standard output. */
function assertSilent(ran, what) {
  assert.equal(ran.code, 0, `${what}: a hook never fails the session: ${ran.stderr}`);
  assert.equal(ran.stdout, '', `${what}: nothing to say, so nothing on standard output`);
}

/**
 * The hook disturbed nothing: exit 0, and standard output empty or one line of
 * PostToolUse context with no decision in it.
 */
function assertUndisturbing(ran, what) {
  assert.equal(ran.code, 0, `${what}: a hook never fails the session: ${ran.stderr}`);
  if (ran.stdout !== '') assertSaid(ran, what);
}

// ------------------------------------------------------------- what was typed

/** What was typed into every tab of the whole fleet, after the launch line each one got. */
async function typedSinceLaunch(box) {
  const after = {};
  for (const terminal of await box.orca.terminals()) after[terminal.tabId] = sentInto(terminal).slice(1);
  return after;
}

/** Nothing at all was typed into any tab after its launch line, and the message is in the mailbox. */
async function assertUntyped(box, what) {
  assert.equal((await box.orca.messages()).length, 1, `${what}: the message is in the mailbox`);
  assert.deepEqual(Object.values(await typedSinceLaunch(box)).flat(), [], `${what}: and nothing was typed into any tab`);
}

/**
 * The line the send itself types into the developer's tab for mail from
 * reviewer/daily (src/message.js's words, as message-nudge.test.js reads
 * them), in each spelling of the kit's own path the kit may use.
 */
const nudgeLines = (box, bots, from = 'reviewer/daily') => spellingsOf(box.cli).map(
  (cli) => `Fleet mail from ${from}: ${SUBJECT}. Read it with  ${cli} message check --bots ${shellWord(bots)} --bot developer --session daily`,
);

/** One line typed into `tabId` and no other tab: the nudge, sent off with Enter. */
async function assertToldOnly(box, bots, tabId, what, from) {
  const typed = await typedSinceLaunch(box);
  assert.equal(typed[tabId].length, 1, `${what}: one line into the receiver's tab, got: ${JSON.stringify(typed[tabId])}`);
  assert.ok(
    nudgeLines(box, bots, from).includes(typed[tabId][0].text),
    `${what}: exactly the line the send would have typed, one of ${JSON.stringify(nudgeLines(box, bots, from))}, got: ${typed[tabId][0].text}`,
  );
  assert.equal(typed[tabId][0].enter, true, `${what}: and sent off, not left sitting in the tab`);
  for (const [tab, lines] of Object.entries(typed)) {
    if (tab !== tabId) assert.deepEqual(lines, [], `${what}: nothing may be typed into ${tab}: it is not the receiver's`);
  }
}

// ---------------------------------------------------------------------------
// A1 — the send leaves the nudge it could not decide on.
// ---------------------------------------------------------------------------

/** The two receivers Orca's runtime answers tty_boundary for, by what `leftFleet` makes of them. */
const RECEIVERS = [['busy', 'running a command'], ['idle', 'idle while it holds a background command']];

for (const [receiver, label] of RECEIVERS) {
  test(`A1 from a Codex session's own tab, in its sandbox, mail to a Claude receiver ${label}, which Orca answers tty_boundary for, is sent, nothing is typed, and the nudge is left`, async (t) => {
    const { box, bots } = await leftFleet(t, { receiver });

    const answer = await send(box, await inTab(box, bots, 'reviewer', 'daily', { codexCommand: true }));

    assert.equal(answer.nudged, false, `got: ${JSON.stringify(answer)}`);
    assert.match(String(answer.nudgeTrouble), COULD_NOT_TELL, `the sentence of today, got: ${JSON.stringify(answer)}`);
    assert.match(String(answer.nudgeTrouble), /tty_boundary/, `naming Orca's reason, got: ${JSON.stringify(answer)}`);
    assert.equal(answer.nudgeLeft, true, `the nudge is left for the sending session's hook, got: ${JSON.stringify(answer)}`);
    await assertUntyped(box, 'the send itself');
  });
}

test('A1 the plain run says the nudge was left for the sending session\'s hook, and types nothing', async (t) => {
  const { box, bots } = await leftFleet(t);

  const result = await box.run(sendArgs(), { env: await inTab(box, bots, 'reviewer', 'daily', { codexCommand: true }) });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /\bhook\b/i, `it says the hook looks at the tab after this command, got: ${result.stdout}`);
  await assertUntyped(box, 'the plain send');
});

// ---------------------------------------------------------------------------
// A2 — the hook decides it with ps and types it.
// ---------------------------------------------------------------------------

for (const [receiver, label] of RECEIVERS) {
  test(`A2 the sending session's hook, where ps runs, types the left nudge into the tab of a receiver ${label}, and no other, and says so`, async (t) => {
    const { box, bots, developer } = await leftNudge(t, { receiver });
    await psRuns(box);

    const ran = await hook(box, await inTab(box, bots, 'reviewer'), afterBash(bots));

    const text = assertSaid(ran, 'a nudge typed');
    assert.ok(text.includes('developer/daily'), `it names the receiver: ${text}`);
    assert.match(text, /\b(told|nudged)\b/i, `and says its tab was told: ${text}`);
    await assertToldOnly(box, bots, developer.tabId, 'the hook');
  });
}

// ---------------------------------------------------------------------------
// A3 — #232's cases still get nothing typed, decided by the hook.
// ---------------------------------------------------------------------------

for (const [label, receiverNow, says] of [
  ['the shell in front: it is not up', { foreground: 'shell' }, /not up/i],
  ['`less` in front, Orca still naming claude: the kit could not tell', { foreground: 'program' }, COULD_NOT_TELL],
  ['a question on its screen: something is waiting to be answered', { screen: CLAUDE_TEACH_AUTO }, /\b(waiting|question|answer|answered|blocked)\b/i],
]) {
  test(`A3 by the time the hook looks, ${label}; nothing is typed, and it says so`, async (t) => {
    const { box, bots, developer } = await leftNudge(t);
    await psRuns(box);
    await changeTab(box, developer.tabId, receiverNow);
    assert.equal((await tabOf(box, bots, 'developer')).agentIdentity, 'claude', 'the premise: Orca still names claude in the tab');

    const ran = await hook(box, await inTab(box, bots, 'reviewer'), afterBash(bots));

    const text = assertSaid(ran, label);
    assert.ok(text.includes('developer/daily'), `it names the receiver: ${text}`);
    assert.match(text, says, `got: ${text}`);
    await assertUntyped(box, label);
  });
}

test('A3 by the time the hook looks, Orca\'s blockedReason on the receiver\'s tab: nothing is typed, and it says something is waiting to be answered', async (t) => {
  const { box, bots } = await leftNudge(t);
  await psRuns(box);
  await box.orca.set({ waitIdle: 'blocked' });

  const ran = await hook(box, await inTab(box, bots, 'reviewer'), afterBash(bots));

  const text = assertSaid(ran, 'blocked');
  assert.ok(text.includes('developer/daily'), `it names the receiver: ${text}`);
  assert.match(text, /\b(waiting|question|answer|answered|blocked)\b/i, `got: ${text}`);
  await assertUntyped(box, 'blocked');
});

// ---------------------------------------------------------------------------
// A4 — each left nudge is decided once.
// ---------------------------------------------------------------------------

test('A4 a second run of the hook after it typed the nudge types nothing more and prints nothing', async (t) => {
  const { box, bots, developer } = await leftNudge(t);
  await psRuns(box);
  const env = await inTab(box, bots, 'reviewer');
  assertSaid(await hook(box, env, afterBash(bots)), 'the first run');

  const again = await hook(box, env, afterBash(bots));

  assertSilent(again, 'the second run');
  await assertToldOnly(box, bots, developer.tabId, 'after both runs');
});

test('A4 a nudge the hook decided not to type is not typed by a later run, once the harness is back in front', async (t) => {
  const { box, bots, developer } = await leftNudge(t);
  await psRuns(box);
  const env = await inTab(box, bots, 'reviewer');
  await changeTab(box, developer.tabId, { foreground: 'shell' });
  assertSaid(await hook(box, env, afterBash(bots)), 'the first run, shell in front');
  await changeTab(box, developer.tabId, { foreground: undefined });

  const again = await hook(box, env, afterBash(bots));

  assertSilent(again, 'the second run, harness in front');
  await assertUntyped(box, 'decided once');
});

// ---------------------------------------------------------------------------
// A5 — nothing left, or nothing the hook can read: silent, exit 0.
// ---------------------------------------------------------------------------

test('A5 the hook with no nudge left for its tab prints nothing and types nothing; after a send leaves one, it types it', async (t) => {
  const { box, bots, developer } = await leftFleet(t);
  await psRuns(box);
  const env = await inTab(box, bots, 'reviewer');

  assertSilent(await hook(box, env, afterBash(bots)), 'nothing left');
  assert.deepEqual(Object.values(await typedSinceLaunch(box)).flat(), [], 'nothing left, nothing typed');

  await psNotPermitted(box);
  const answer = await send(box, await inTab(box, bots, 'reviewer', 'daily', { codexCommand: true }));
  assert.equal(answer.nudgeLeft, true, `the premise: now one is left, got: ${JSON.stringify(answer)}`);
  await psRuns(box);
  assertSaid(await hook(box, env, afterBash(bots)), 'one left');
  await assertToldOnly(box, bots, developer.tabId, 'one left');
});

for (const [label, stdin] of [
  ['no standard input at all', ''],
  ['standard input that is not JSON', 'codex: something went wrong\n'],
]) {
  test(`A5 with ${label}, the hook exits 0 and types nothing`, async (t) => {
    const { box, bots } = await leftNudge(t);
    await psRuns(box);

    const ran = await hook(box, await inTab(box, bots, 'reviewer'), stdin);

    assertUndisturbing(ran, label);
    await assertUntyped(box, label);
  });
}

for (const [label, misbehaving] of [
  ['Orca refusing the line', { fail: { 'terminal send': { code: 'runtime_error', message: 'refused' } } }],
  ['Orca answering nothing it can read', { crash: { command: '*', exitCode: 1, stdout: '', stderr: 'orca: the app is not running' } }],
]) {
  test(`A5 with ${label}, the hook exits 0 and types nothing`, async (t) => {
    const { box, bots } = await leftNudge(t);
    await psRuns(box);
    await box.orca.set(misbehaving);

    const ran = await hook(box, await inTab(box, bots, 'reviewer'), afterBash(bots));

    assertUndisturbing(ran, label);
    await assertUntyped(box, label);
  });
}

// ---------------------------------------------------------------------------
// A6 — a nudge left from one tab is that tab's.
// ---------------------------------------------------------------------------

test('A6 a nudge left by a send in one tab is not taken by the hook in another; the hook in its own tab still types it', async (t) => {
  const { box, bots, developer } = await leftNudge(t, { sessions: ['daily', 'review'] });
  await psRuns(box);

  const other = await hook(box, await inTab(box, bots, 'reviewer', 'review'), afterBash(bots));

  assertSilent(other, 'the hook in the other tab');
  await assertUntyped(box, 'the hook in the other tab');

  const own = await hook(box, await inTab(box, bots, 'reviewer', 'daily'), afterBash(bots));

  assertSaid(own, 'the hook in the sending tab');
  await assertToldOnly(box, bots, developer.tabId, 'the hook in the sending tab');
});

// ---------------------------------------------------------------------------
// A7 — not left: today's answer, and a hook run afterwards types nothing.
// ---------------------------------------------------------------------------

/** No `nudgeLeft` in the answer at all. */
const assertNotLeft = (answer, what) => assert.equal('nudgeLeft' in answer, false, `${what}: nothing is left for a hook, got: ${JSON.stringify(answer)}`);

test('A7 where ps runs for the sender and the look is "cannot tell", the answer is today\'s, and a hook run afterwards types nothing', async (t) => {
  // `less` in front of the receiver's tab, as ps reads it: cannot tell. Then
  // the harness back in front, so a hook that found a nudge left would type it.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await orcaApp(box);
  const developer = await tabOf(box, bots, 'developer');
  await changeTab(box, developer.tabId, { foreground: 'program' });

  const answer = await send(box, await inTab(box, bots, 'reviewer', 'daily', { codexCommand: true }));

  assert.equal(answer.nudged, false, `got: ${JSON.stringify(answer)}`);
  assert.match(String(answer.nudgeTrouble), COULD_NOT_TELL, `got: ${JSON.stringify(answer)}`);
  assertNotLeft(answer, 'ps runs');
  await changeTab(box, developer.tabId, { foreground: undefined });
  assertSilent(await hook(box, await inTab(box, bots, 'reviewer'), afterBash(bots)), 'ps ran for the send');
  await assertUntyped(box, 'ps ran for the send');
});

test('A7 a Claude session sending from its own tab with ps not permitted leaves nothing: only Codex has the hook', async (t) => {
  // The developer writes to the reviewer, whose tab the runtime answers
  // tty_boundary for. Then ps runs and the reviewer's Codex is in front.
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await orcaApp(box);
  await changeTab(box, (await tabOf(box, bots, 'reviewer')).tabId, { inspect: TTY_BOUNDARY });
  await psNotPermitted(box);

  const answer = await send(box, await inTab(box, bots, 'developer'), { to: 'reviewer' });

  assert.equal(answer.nudged, false, `got: ${JSON.stringify(answer)}`);
  assert.match(String(answer.nudgeTrouble), COULD_NOT_TELL, `got: ${JSON.stringify(answer)}`);
  assertNotLeft(answer, 'a Claude sender');
  await psRuns(box);
  assertSilent(await hook(box, await inTab(box, bots, 'developer'), afterBash(bots), 'developer'), 'a hook run in the Claude sender\'s tab');
  assertSilent(await hook(box, await inTab(box, bots, 'reviewer'), afterBash(bots)), 'a hook run in the receiver\'s own tab');
  await assertUntyped(box, 'a Claude sender');
});

test('A7 a send whose --from names a Codex session, run outside that session\'s tab, leaves nothing', async (t) => {
  const { box, bots } = await leftFleet(t);

  const answer = await send(box, box.env, { from: 'reviewer/daily' });

  assert.equal(answer.nudged, false, `got: ${JSON.stringify(answer)}`);
  assert.match(String(answer.nudgeTrouble), COULD_NOT_TELL, `got: ${JSON.stringify(answer)}`);
  assertNotLeft(answer, '--from outside its tab');
  await psRuns(box);
  assertSilent(await hook(box, await inTab(box, bots, 'reviewer'), afterBash(bots)), 'the hook in the named session\'s tab');
  await assertUntyped(box, '--from outside its tab');
});

test('A7 an idle receiver the runtime names is typed into by the send itself, nothing is left, and a hook run afterwards types nothing more', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  await orcaApp(box);
  await psNotPermitted(box);
  const developer = await tabOf(box, bots, 'developer');

  const answer = await send(box, await inTab(box, bots, 'reviewer', 'daily', { codexCommand: true }));

  assert.equal(answer.nudged, true, `got: ${JSON.stringify(answer)}`);
  assertNotLeft(answer, 'typed by the send');
  await psRuns(box);
  assertSilent(await hook(box, await inTab(box, bots, 'reviewer'), afterBash(bots)), 'after a send that typed');
  await assertToldOnly(box, bots, developer.tabId, 'the send\'s own line, and only it');
});

for (const [label, setUp, check] of [
  [
    'the runtime finds the shell in front: plainly not up',
    async (box, developer) => changeTab(box, developer.tabId, { inspect: SHELL }),
    (answer) => assert.equal('nudgeTrouble' in answer, false, `the kit knows there is no harness there, got: ${JSON.stringify(answer)}`),
  ],
  [
    'Orca\'s blockedReason on the receiver\'s tab',
    async (box) => box.orca.set({ waitIdle: 'blocked' }),
    (answer) => assert.equal(answer.blocked, 'agent-interactive-prompt', `Orca's reason, got: ${JSON.stringify(answer)}`),
  ],
]) {
  test(`A7 ${label}: the answer is today's, nothing is left, and a hook run afterwards types nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    await orcaApp(box);
    const developer = await tabOf(box, bots, 'developer');
    await setUp(box, developer);
    await psNotPermitted(box);

    const answer = await send(box, await inTab(box, bots, 'reviewer', 'daily', { codexCommand: true }));

    assert.equal(answer.nudged, false, `got: ${JSON.stringify(answer)}`);
    check(answer);
    assertNotLeft(answer, label);
    // The harness idle in front, nothing on screen: a hook that found a nudge left would type it.
    await psRuns(box);
    await box.orca.set({ waitIdle: true });
    await changeTab(box, developer.tabId, { inspect: undefined });
    assertSilent(await hook(box, await inTab(box, bots, 'reviewer'), afterBash(bots)), label);
    await assertUntyped(box, label);
  });
}

// ---------------------------------------------------------------------------
// A8 — up writes the hook into a Codex bot's hooks file.
// ---------------------------------------------------------------------------

/** The PostToolUse groups of a parsed hooks file whose matcher is Bash. */
const bashGroups = (held) => (eventsIn(held)?.PostToolUse ?? []).filter((group) => group?.matcher === 'Bash');

/** Every entry under PostToolUse, in any group, that runs the kit's `session nudge`. */
const nudgeEntries = (held) => (eventsIn(held)?.PostToolUse ?? [])
  .flatMap((group) => group?.hooks ?? [])
  .filter((one) => /\bsession nudge\b/.test(String(one?.command)));

/** The kit's nudge hook line for `bot`, in each spelling of the kit's path it may use: the form of its `session record` line. */
const nudgeHookLines = (box, bots, bot = 'reviewer') => spellingsOf(box.cli).map(
  (cli) => `${cli} session nudge --bots ${shellWord(bots)} --bot ${shellWord(bot)} 2>/dev/null || true`,
);

/** A hook of the user's own, to sit beside the kit's and be left alone. */
const THEIRS = { type: 'command', command: 'echo mine after Bash' };

test('A8 up writes the kit\'s PostToolUse hook, matcher Bash, into a Codex bot\'s .codex/hooks.json, beside its SessionStart entry', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);

  const held = await hooksIn(bots, 'reviewer', 'codex');

  assert.ok(held !== undefined, 'the premise: the Codex bot has its hooks file');
  const groups = bashGroups(held);
  const kit = groups.flatMap((group) => group.hooks ?? []).filter((one) => /\bsession nudge\b/.test(String(one?.command)));
  assert.equal(kit.length, 1, `one kit entry under PostToolUse, matcher Bash, got: ${JSON.stringify(eventsIn(held))}`);
  assert.equal(kit[0].type, 'command', `a command entry, got: ${JSON.stringify(kit[0])}`);
  assert.ok(nudgeHookLines(box, bots).includes(kit[0].command), `the kit's line, one of ${JSON.stringify(nudgeHookLines(box, bots))}, got: ${kit[0].command}`);
  assert.ok(Number.isFinite(kit[0].timeout) && kit[0].timeout > 0, `with a timeout in seconds, got: ${JSON.stringify(kit[0])}`);
  assert.equal(nudgeEntries(held).length, 1, `and no other nudge entry anywhere under PostToolUse, got: ${JSON.stringify(eventsIn(held).PostToolUse)}`);
  assert.equal(kitHooksIn(held).length, 1, 'beside the kit\'s SessionStart entry, which stays');
});

test('A8 the installed line, run as Codex runs it in the sending tab after a left nudge, types it', async (t) => {
  const { box, bots, developer } = await leftNudge(t);
  const [entry] = nudgeEntries(await hooksIn(bots, 'reviewer', 'codex'));
  assert.equal(typeof entry?.command, 'string', 'the premise: up wrote the kit\'s nudge hook');
  await psRuns(box);

  const ran = await sh(entry.command, { cwd: botHomeOf(bots, 'reviewer'), env: await inTab(box, bots, 'reviewer'), stdin: afterBash(bots) });

  assertSaid(ran, 'the installed line');
  await assertToldOnly(box, bots, developer.tabId, 'the installed line');
});

test('A8 a second up writes nothing new to the Codex hooks file', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const file = hookFileOf(bots, 'reviewer', 'codex');
  const before = await readFile(file, 'utf8');
  assert.equal(nudgeEntries(JSON.parse(before)).length, 1, 'the premise: the first up wrote the nudge hook');

  const again = await box.run(['up', '--bots', 'bots', '--bot', 'reviewer']);
  assert.equal(again.code, 0, again.stderr);

  assert.equal(await readFile(file, 'utf8'), before, 'nothing to add, so nothing written');
});

test('A8 a Codex hooks file that lost the nudge hook gets it back from up, and the user\'s own PostToolUse groups and entries stay', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const file = hookFileOf(bots, 'reviewer', 'codex');
  const held = JSON.parse(await readFile(file, 'utf8'));
  const mineOnBash = { matcher: 'Bash', hooks: [THEIRS] };
  const mineOnPatch = { matcher: 'apply_patch', hooks: [{ type: 'command', command: 'echo mine after a patch' }] };
  eventsIn(held).PostToolUse = [mineOnBash, mineOnPatch];
  await writeFile(file, `${JSON.stringify(held, null, 2)}\n`);

  const again = await box.run(['up', '--bots', 'bots', '--bot', 'reviewer']);
  assert.equal(again.code, 0, again.stderr);

  const after = JSON.parse(await readFile(file, 'utf8'));
  const text = JSON.stringify(eventsIn(after).PostToolUse);
  assert.equal(nudgeEntries(after).length, 1, `the kit's nudge hook is back, once: ${text}`);
  assert.ok(nudgeHookLines(box, bots).includes(nudgeEntries(after)[0].command), `in the kit's form: ${text}`);
  assert.ok(bashGroups(after).some((group) => group.hooks.includes(nudgeEntries(after)[0])), `under a Bash group: ${text}`);
  assert.ok(
    eventsIn(after).PostToolUse.some((group) => group.matcher === 'apply_patch' && JSON.stringify(group) === JSON.stringify(mineOnPatch)),
    `the user's own group on another matcher stays as they wrote it: ${text}`,
  );
  assert.ok(
    bashGroups(after).some((group) => group.hooks.some((one) => JSON.stringify(one) === JSON.stringify(THEIRS))),
    `and the user's own Bash entry is still there: ${text}`,
  );
  assert.equal(kitHooksIn(after).length, 1, 'and the kit\'s SessionStart entry with them');
});

test('A8 a user\'s entry in the kit\'s own Bash group survives a second up, and the file is left as it was', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const file = hookFileOf(bots, 'reviewer', 'codex');
  const held = JSON.parse(await readFile(file, 'utf8'));
  const [group] = bashGroups(held).filter((one) => (one.hooks ?? []).some((entry) => /\bsession nudge\b/.test(String(entry.command))));
  assert.ok(group, `the premise: the kit's Bash group, got: ${JSON.stringify(eventsIn(held))}`);
  group.hooks.push(THEIRS);
  await writeFile(file, `${JSON.stringify(held, null, 2)}\n`);
  const before = await readFile(file, 'utf8');

  const again = await box.run(['up', '--bots', 'bots', '--bot', 'reviewer']);
  assert.equal(again.code, 0, again.stderr);

  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), JSON.parse(before), 'nothing in the file is the kit\'s to change');
});

test('A8 the kit\'s nudge entry written for a bots folder that moved is rewritten in place, not doubled, and what sits beside it stays', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const file = hookFileOf(bots, 'reviewer', 'codex');
  const held = JSON.parse(await readFile(file, 'utf8'));
  const [kit] = nudgeEntries(held);
  assert.ok(kit?.command?.includes(` --bots ${shellWord(bots)} `), `the premise: the kit's line names ${bots}, got: ${JSON.stringify(kit)}`);
  const old = kit.command.replace(` --bots ${shellWord(bots)} `, " --bots '/old place/bots' ");
  eventsIn(held).PostToolUse = [{ matcher: 'Bash', hooks: [{ type: 'command', command: old, timeout: 10 }, THEIRS] }];
  await writeFile(file, `${JSON.stringify(held, null, 2)}\n`);

  const again = await box.run(['up', '--bots', 'bots', '--bot', 'reviewer']);
  assert.equal(again.code, 0, again.stderr);

  const after = JSON.parse(await readFile(file, 'utf8'));
  const text = JSON.stringify(eventsIn(after).PostToolUse);
  assert.equal(eventsIn(after).PostToolUse.length, 1, `one group, the one that was there: ${text}`);
  const [only] = eventsIn(after).PostToolUse;
  assert.equal(only.matcher, 'Bash', `still matched to Bash: ${text}`);
  assert.deepEqual(
    only.hooks.map((one) => one.command).sort(),
    [nudgeEntries(after)[0]?.command, THEIRS.command].sort(),
    `the kit's entry and the user's, and nothing else: ${text}`,
  );
  assert.ok(nudgeHookLines(box, bots).includes(nudgeEntries(after)[0]?.command), `the old line is today's now: ${text}`);
  assert.ok(!text.includes('/old place/bots'), `and the old path is gone: ${text}`);
});

test('A8 a Claude bot\'s settings get no session nudge hook', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);

  const claude = await hooksIn(bots, 'developer', 'claude');
  const codex = await hooksIn(bots, 'reviewer', 'codex');

  assert.ok(claude !== undefined, 'the premise: the Claude bot has its settings file');
  assert.equal(nudgeEntries(codex).length, 1, 'the premise: the Codex bot beside it has the nudge hook');
  assert.ok(!JSON.stringify(claude).includes('session nudge'), `nothing of it in Claude's settings: ${JSON.stringify(claude)}`);
});

// ---------------------------------------------------------------------------
// A9 — health names a Codex bot whose hooks file lacks the nudge hook, or whose
// nudge hook runs a kit that is not there.
// ---------------------------------------------------------------------------

/** `obk health --json`. */
async function health(box) {
  const result = await box.run(['health', '--bots', 'bots', '--json']);
  assert.equal(result.stderr, '', result.stderr);
  return { code: result.code, answer: JSON.parse(result.stdout) };
}

/** The findings that name `file`. */
const about = (answer, file) => answer.found.filter((one) => `${one.where} ${one.says}`.includes(file));

test('A9 health names a Codex bot whose hooks file lacks the nudge hook, and says nothing of one that has it', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const file = hookFileOf(bots, 'reviewer', 'codex');

  const whole = await health(box);
  assert.deepEqual(about(whole.answer, file), [], `the hook is there, so nothing about ${file}: ${JSON.stringify(whole.answer.found)}`);

  const held = JSON.parse(await readFile(file, 'utf8'));
  delete eventsIn(held).PostToolUse;
  await writeFile(file, `${JSON.stringify(held, null, 2)}\n`);

  const { code, answer } = await health(box);
  const found = about(answer, file);
  assert.equal(found.length, 1, `one finding names ${file}, whose nudge hook is gone: ${JSON.stringify(answer.found, null, 2)}`);
  assert.match(found[0].says, /PostToolUse|nudge/i, `and says which hook: ${found[0].says}`);
  assert.equal(code, 1, 'a finding exits 1');
});

test('A9 health names a Codex bot whose nudge hook runs a kit that is not there, with SessionStart intact, and exits 1', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const file = hookFileOf(bots, 'reviewer', 'codex');
  const held = JSON.parse(await readFile(file, 'utf8'));
  const sessionStart = JSON.stringify(eventsIn(held).SessionStart);
  // Named obk, as an installed kit is, so the line is still the kit's; the folder is not there.
  const gone = box.path('kit-moved-away/bin/obk');
  let replaced = 0;
  for (const one of nudgeEntries(held)) {
    const spelling = spellingsOf(box.cli).find((cli) => String(one.command).startsWith(`${cli} session nudge `));
    if (spelling === undefined) continue;
    one.command = `${gone}${one.command.slice(spelling.length)}`;
    replaced += 1;
  }
  assert.equal(replaced, 1, `the premise: one kit nudge hook, run by ${box.cli}, to point elsewhere: ${JSON.stringify(eventsIn(held))}`);
  await writeFile(file, `${JSON.stringify(held, null, 2)}\n`);
  assert.equal(JSON.stringify(eventsIn(JSON.parse(await readFile(file, 'utf8'))).SessionStart), sessionStart, 'the premise: SessionStart as up wrote it');

  const { code, answer } = await health(box);
  const found = about(answer, file);
  assert.equal(found.length, 1, `one finding names ${file}, whose nudge hook runs ${gone}: ${JSON.stringify(answer.found, null, 2)}`);
  assert.match(found[0].says, /PostToolUse|nudge/i, `and says it is the nudge hook: ${found[0].says}`);
  assert.equal(code, 1, 'a finding exits 1');
});
