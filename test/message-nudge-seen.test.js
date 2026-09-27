// A nudge Orca did not see start a turn (#394).
//
// Seen: `obk message send` said "its tab was told to look", and the receiver's
// harness never took the line. The kit said so as soon as Orca accepted the
// typed input, and nothing looked at whether the harness took it.
//
// Orca can say. `terminal send --text <line> --enter --wait-submit <s>` watches
// the line for a while and answers with a receipt: `turn_started` among its
// stages when the line started a turn, and only `input_accepted`, with a
// warning, when it did not (Orca 1.4.214, live, Claude Code and Codex alike).
// A line queued behind a busy harness's turn and a line that was lost look the
// same to Orca, so the send says it may be either.
//
// What stays: `nudged` means the kit typed the line; one line is typed, never a
// second to confirm or retry; and the mail is queued either way, so the send
// succeeds either way.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSandbox, orcaCallsOf, orcaFlag, sessionIn } from './helpers/cli.js';

/** The start of Orca's warning when it saw no turn start, as 1.4.214 wrote it live. */
const ORCA_UNSEEN = 'input was accepted but no turn start was observed, so the Enter may have been swallowed';

/** A Claude bot that writes and a Codex bot that reads, both up, nothing typed since. */
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

/** The two ways round: to the Codex session, and to the Claude one. */
const RECEIVERS = [
  { harness: 'codex', to: 'coder', from: 'writer/daily' },
  { harness: 'claude', to: 'writer', from: 'coder/daily' },
];

/** Send one message, plain or with `--json`. */
const send = (box, { to, from }, more = []) => box.run([
  'message', 'send', '--bots', 'bots', '--to', to, '--from', from,
  '--subject', 'the staging host', '--text', 'It is down again.', ...more,
]);

/** The receiver's tab id, as the book has it. */
const tabOf = async (bots, bot) => (await sessionIn(bots, bot, 'daily')).tab;

/** What Orca will see a watched line do in one tab: 'turn-started', 'unseen', 'unsupported' or 'old-host' (helpers/fake-orca.js). */
async function submitIn(box, tab, submit) {
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.tabId === tab ? { ...terminal, submit } : terminal)),
  });
}

/** Each `terminal send` into every tab since its launch line, as the fake wrote it down, by tab id. */
async function sentSinceLaunch(box) {
  const after = {};
  for (const terminal of await box.orca.terminals()) after[terminal.tabId] = (terminal.typed ?? []).slice(1);
  return after;
}

/** One line into the receiver's tab, the nudge, and nothing into any other. */
async function assertOneLineInto(box, tab) {
  const sent = await sentSinceLaunch(box);
  assert.equal(sent[tab].length, 1, `exactly one line into the receiver's tab, got: ${JSON.stringify(sent[tab])}`);
  assert.ok(sent[tab][0].text.includes('message check --bots '), `the nudge, got: ${sent[tab][0].text}`);
  for (const [other, lines] of Object.entries(sent)) {
    if (other !== tab) assert.deepEqual(lines, [], `nothing may be typed into ${other}: it is not the receiver's`);
  }
}

for (const receiver of RECEIVERS) {
  // Covers: a send whose `orca terminal send` answer shows no turn start is
  // reported as typed but not seen, with Orca's words; `nudged` still says the
  // line was typed; the mail is queued and the send succeeds; one line only.
  test(`a ${receiver.harness} tab Orca saw no turn start in: nudged, with Orca's words in nudgeUnseen, and the mail is queued`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const tab = await tabOf(bots, receiver.to);
    await submitIn(box, tab, 'unseen');

    const result = await send(box, receiver, ['--json']);

    assert.equal(result.code, 0, `the message went whatever Orca saw: ${result.stdout}${result.stderr}`);
    assert.equal((await box.orca.messages()).length, 1, 'the message is in the mailbox');
    const answer = JSON.parse(result.stdout);
    assert.equal(answer.nudged, true, `the kit typed the line, got: ${JSON.stringify(answer)}`);
    assert.equal(typeof answer.nudgeUnseen, 'string', `why it was not seen, got: ${JSON.stringify(answer)}`);
    assert.ok(answer.nudgeUnseen.includes(ORCA_UNSEEN), `in Orca's own words, got: ${answer.nudgeUnseen}`);
    await assertOneLineInto(box, tab);
  });
}

// Covers: the plain report of a line Orca did not see start a turn says it was
// typed, not seen, may be queued or lost, and the mail waits; never "told to look".
test('the plain report of a line Orca did not see start a turn says typed, not seen, queued or lost, and waits', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const tab = await tabOf(bots, 'coder');
  await submitIn(box, tab, 'unseen');

  const result = await send(box, RECEIVERS[0]);

  assert.equal(result.code, 0, `the message went whatever Orca saw: ${result.stdout}${result.stderr}`);
  assert.equal((await box.orca.messages()).length, 1, 'the message is in the mailbox');
  assert.doesNotMatch(result.stdout, /told to look/, `a tab Orca did not see take the line was not told, got:\n${result.stdout}`);
  for (const [said, pattern] of [
    ['the line was typed', /typed/],
    ['Orca did not see it start a turn', /did not see/],
    ['it may be queued behind the work in hand', /queued/],
    ['or lost', /lost/],
    ['the mail waits for the next check', /waits/],
  ]) {
    assert.match(result.stdout, pattern, `the run should say ${said}, got:\n${result.stdout}`);
  }
  await assertOneLineInto(box, tab);
});

// Covers: a send whose answer shows a turn start says "its tab was told to
// look", as today, and carries no nudgeUnseen.
test('a tab Orca saw the line start a turn in was told to look, and there is nothing unseen to report', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleetIn(box);
  const tab = await tabOf(bots, 'coder');
  await submitIn(box, tab, 'turn-started');

  const json = await send(box, RECEIVERS[0], ['--json']);
  const plain = await send(box, RECEIVERS[0]);

  assert.equal(json.code, 0, json.stderr);
  const answer = JSON.parse(json.stdout);
  assert.equal(answer.nudged, true, `got: ${JSON.stringify(answer)}`);
  assert.equal('nudgeUnseen' in answer, false, `a line Orca saw start a turn is not unseen, got: ${JSON.stringify(answer)}`);

  assert.equal(plain.code, 0, plain.stderr);
  assert.match(plain.stdout, /its tab was told to look/, `got:\n${plain.stdout}`);
  assert.doesNotMatch(plain.stdout, /did not see/, `got:\n${plain.stdout}`);
  assert.equal((await box.orca.messages()).length, 2, 'both messages are in the mailbox');
});

// Covers: the nudge's own send asks Orca to watch the line, for about five
// seconds, and it is the one line: no second send to confirm or retry it,
// whatever Orca saw.
for (const submit of ['turn-started', 'unseen']) {
  test(`the nudge asks Orca to watch the line it types, a few seconds, and types it once (${submit})`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const tab = await tabOf(bots, 'coder');
    await submitIn(box, tab, submit);
    const handle = (await box.orca.terminals()).find((terminal) => terminal.tabId === tab).handle;
    const before = (await box.orca.calls()).length;

    const result = await send(box, RECEIVERS[0]);

    assert.equal(result.code, 0, result.stderr);
    const sends = orcaCallsOf((await box.orca.calls()).slice(before), 'terminal send');
    assert.equal(sends.length, 1, `one terminal send, got: ${JSON.stringify(sends.map((call) => call.args))}`);
    const [call] = sends;
    assert.equal(orcaFlag(call, '--terminal'), handle, 'into the receiver\'s tab');
    assert.ok(call.args.includes('--enter'), `the line is sent off, got: ${call.args.join(' ')}`);
    const wait = Number(orcaFlag(call, '--wait-submit'));
    assert.ok(wait > 0 && wait <= 10, `--wait-submit with a few seconds, got: ${call.args.join(' ')}`);
    assert.equal(call.args.includes('--retry-request'), false, `a first send carries no request to re-issue, got: ${call.args.join(' ')}`);

    const [line] = (await sentSinceLaunch(box))[tab];
    assert.equal(line.enter, true);
    assert.equal(Number(line.waitSubmit), wait, 'the typed line is the watched one');
    await assertOneLineInto(box, tab);
  });
}

// Covers (the architect's decision after the live check): when Orca's receipt
// says `observation: "unsupported"`, Orca did not watch the line at all, so the
// send does not say Orca did not see it start a turn. It passes Orca's own
// words on: in `nudgeUnseen`, and in the plain line, which says the tab was
// typed into and the mail waits. Seen live as a Claude tab where the kit's
// line raced Orca's own notice; an old Orca host answers the same way.
for (const [submit, warning] of [
  ['unsupported', 'input was accepted, but this provider cannot report delivery. Inspect the terminal before retrying.'],
  ['old-host', 'this host predates durable prompt receipts. Update Orca on the execution host, and inspect the terminal before retrying an ambiguous send.'],
]) {
  test(`a line Orca could not watch (${submit}) is reported as typed, in Orca's own words, never as not seen`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);
    const tab = await tabOf(bots, 'writer');
    await submitIn(box, tab, submit);
    const claude = RECEIVERS[1];

    const json = await send(box, claude, ['--json']);
    const plain = await send(box, claude);

    assert.equal(json.code, 0, `the message went whatever Orca could say: ${json.stdout}${json.stderr}`);
    const answer = JSON.parse(json.stdout);
    assert.equal(answer.nudged, true, `the kit typed the line, got: ${JSON.stringify(answer)}`);
    assert.equal(typeof answer.nudgeUnseen, 'string', `got: ${JSON.stringify(answer)}`);
    assert.ok(answer.nudgeUnseen.includes(warning), `in Orca's own words, got: ${answer.nudgeUnseen}`);

    assert.equal(plain.code, 0, `the message went whatever Orca could say: ${plain.stdout}${plain.stderr}`);
    assert.doesNotMatch(plain.stdout, /did not see/, `Orca did not watch, so it did not fail to see anything, got:\n${plain.stdout}`);
    assert.doesNotMatch(plain.stdout, /told to look/, `nor was the tab seen to take it, got:\n${plain.stdout}`);
    assert.match(plain.stdout, /typed/, `the run should say the tab was typed into, got:\n${plain.stdout}`);
    assert.ok(plain.stdout.includes(warning), `the run should give Orca's words, got:\n${plain.stdout}`);
    assert.match(plain.stdout, /waits/, `the run should say the mail waits, got:\n${plain.stdout}`);

    assert.equal((await box.orca.messages()).length, 2, 'both messages are in the mailbox');
    const sent = await sentSinceLaunch(box);
    assert.equal(sent[tab].length, 2, `one line into the receiver's tab per send, got: ${JSON.stringify(sent[tab])}`);
    for (const [other, lines] of Object.entries(sent)) {
      if (other !== tab) assert.deepEqual(lines, [], `nothing may be typed into ${other}: it is not the receiver's`);
    }
  });
}
