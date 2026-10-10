// The kit's record of fleet mail it sent and that is not yet read, and what
// retire says about it (#509, requests/fleet-mail-one-signal, R7 and Assumed).
//
//   U1  The record is a folder `obk-unread` in the system temp folder
//       (`os.tmpdir()`, which the sandbox sets with TMPDIR). Every folder the
//       kit makes there has mode 0700. It holds the sender and the subject,
//       never the message body.
//   U2  `obk message check` takes out what it read; `--peek` takes out
//       nothing.
//   R7a `obk temp retire`, `obk retire --bot <bot> --session <s>`, and each
//       temporary session retired along with one, say how many messages sent
//       to that session were not read with `obk message check`, and who sent
//       them. JSON: `unread: { count, from: ["<bot>/<session>", …] }` on the
//       retired session's answer and on each entry of `retiredWith`; no
//       `unread` when there is none. Text: "<n> message(s) sent to it were
//       not read with obk message check, from <a> and <b>", or close to it.
//   R7b `obk retire --bot <bot>` says the same for each of its sessions.
//   R7c The record for a retired session goes with it, and only its own.
//
// Read here: `from` names each sender once, whatever the count; that is held
// as "the set of senders", and a sender named twice is not held against it.
//
// Sends go to busy tabs, so nothing is typed and no send waits out the 8 s
// watch (mail-one-signal.test.js holds what a send does). Every run is in the
// sandbox (helpers/cli.js): its own HOME and TMPDIR, a fake Orca. Nothing here
// reaches the real Orca or a real harness.

import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  createSandbox,
  kitLaunchMark,
  orcaCallsOf,
  sessionIn,
  tabsOfBot,
} from './helpers/cli.js';

/** The Claude Code bot whose sessions are retired, and the Codex bots that write to them. */
const BOT = 'temp-bot';
const SENDERS = ['coder', 'tester'];

/** The environment of a command a session's harness runs in `terminal`. */
const inTab = (box, terminal) => ({ ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId, ...kitLaunchMark(box, terminal) });

/** The tab the book gives a session, and Orca's own record of it. */
async function liveTab(box, bots, bot, name) {
  const entry = await sessionIn(bots, bot, name);
  assert.equal(typeof entry?.tab, 'string', `the premise: the book holds a tab for ${bot}/${name}, got: ${JSON.stringify(entry)}`);
  assert.equal(typeof entry?.mailbox, 'string', `the premise: ${bot}/${name} has a mailbox, got: ${JSON.stringify(entry)}`);
  const terminal = (await tabsOfBot(box, bots, bot)).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `the premise: Orca has ${bot}/${name}'s tab ${entry.tab}`);
  return terminal;
}

/**
 * temp-bot with two long-lived sessions, planner and nightly, and scout, a
 * temporary session planner made; a Claude Code bot `reader` with one session;
 * and the two Codex senders. All up, every tab busy.
 */
async function fleetIn(box) {
  const ok = async (args, env) => {
    const result = await box.run(args, env === undefined ? {} : { env });
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  for (const name of ['planner', 'nightly']) await ok(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', name]);
  await ok(['bot', 'create', '--bots', 'bots', '--name', 'reader', '--harness', 'claude']);
  await ok(['session', 'add', '--bots', 'bots', '--bot', 'reader', '--name', 'daily']);
  for (const sender of SENDERS) {
    await ok(['bot', 'create', '--bots', 'bots', '--name', sender, '--harness', 'codex']);
    await ok(['session', 'add', '--bots', 'bots', '--bot', sender, '--name', 'daily']);
  }
  await ok(['up', '--bots', 'bots']);
  const bots = box.path('bots');
  const planner = await liveTab(box, bots, BOT, 'planner');
  await ok(['temp', 'make', '--bots', 'bots', '--name', 'scout', '--prompt', 'Read the open pull request.'], inTab(box, planner));
  const tabs = { planner, scout: await liveTab(box, bots, BOT, 'scout'), nightly: await liveTab(box, bots, BOT, 'nightly') };
  assert.equal((await sessionIn(bots, BOT, 'scout')).temporary?.maker, 'planner', 'the premise: scout is planner\'s');
  // Every tab busy, so a send types nothing and waits for nothing.
  await box.orca.set({ terminals: (await box.orca.terminals()).map((one) => ({ ...one, tuiIdle: 'busy' })) });
  return { bots, tabs };
}

/** One message to `to` (`<bot>/<session>`) from `<from>/daily`, which must go. */
async function mail(box, to, from, subject, text = 'It is down again.') {
  const sent = await box.run([
    'message', 'send', '--bots', 'bots', '--to', to, '--from', `${from}/daily`,
    '--subject', subject, '--text', text, '--json',
  ]);
  assert.equal(sent.code, 0, `the premise: the mail went: ${sent.stdout}${sent.stderr}`);
  assert.equal(JSON.parse(sent.stdout).sent, true, `the premise: the mail went: ${sent.stdout}`);
}

/** `obk message check` for one session, from outside any tab, which must read. */
async function check(box, to, ...more) {
  const [bot, session] = to.split('/');
  const read = await box.run(['message', 'check', '--bots', 'bots', '--bot', bot, '--session', session, '--json', ...more]);
  assert.equal(read.code, 0, `the premise: the check ran: ${read.stdout}${read.stderr}`);
  return JSON.parse(read.stdout);
}

/** The --json answer, which is JSON and nothing else. */
function answerIn(result) {
  assert.equal(result.code, 0, `the retire worked: ${result.stdout}${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout}${result.stderr} (${error.message})`);
  }
}

/** `obk temp retire --name <name>`, run by its maker in its tab. */
const retireTemp = (box, maker, name, more = []) => box.run(['temp', 'retire', '--bots', 'bots', '--name', name, ...more], { env: inTab(box, maker) });

/** `obk retire`, from outside any tab. */
const retire = (box, ...args) => box.run(['retire', '--bots', 'bots', ...args]);

/** An `unread` that says `count` messages from exactly `senders`. */
function assertUnread(unread, count, senders, where) {
  assert.ok(unread !== null && typeof unread === 'object', `${where} carries unread: ${JSON.stringify(unread)}`);
  assert.equal(unread.count, count, `${where}: ${count} unread, got: ${JSON.stringify(unread)}`);
  assert.ok(Array.isArray(unread.from), `${where}: who sent them, got: ${JSON.stringify(unread)}`);
  assert.deepEqual([...new Set(unread.from)].sort(), [...senders].sort(), `${where}: sent by ${senders.join(' and ')}, got: ${JSON.stringify(unread)}`);
}

/** Every folder and file under `dir`, itself included, with its mode. */
async function treeOf(dir) {
  const found = [{ path: dir, dir: true, mode: (await stat(dir)).mode & 0o777 }];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await treeOf(full));
    else found.push({ path: full, dir: false, mode: (await stat(full)).mode & 0o777 });
  }
  return found;
}

/** The kit's record folder, which a send has made. */
async function unreadDir(box) {
  const dir = path.join(box.tmp, 'obk-unread');
  const there = await stat(dir).then((found) => found.isDirectory(), () => false);
  assert.ok(there, `the premise: the send left the kit's record of unread mail in ${dir}`);
  return dir;
}

/** Whether any file of the kit's record holds `text`. */
async function recordHolds(box, text) {
  for (const one of await treeOf(await unreadDir(box))) {
    if (!one.dir && (await readFile(one.path, 'utf8')).includes(text)) return true;
  }
  return false;
}

// --------------------------------------------------------------- U1, U2: the record

test('U1 the record is obk-unread in the system temp folder, and every folder of it is 0700', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);

  await mail(box, `${BOT}/nightly`, 'coder', 'the staging host');
  await mail(box, 'reader/daily', 'tester', 'the flaky test');

  const folders = (await treeOf(await unreadDir(box))).filter((one) => one.dir);
  for (const folder of folders) {
    assert.equal(folder.mode.toString(8), '700', `${folder.path} is private to its owner, got ${folder.mode.toString(8)}`);
  }
});

test('U1 the record holds the subject and never the body', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);

  await mail(box, `${BOT}/nightly`, 'coder', 'subject-5c1e7a', 'body-9d24b0 is what the message says');

  assert.equal(await recordHolds(box, 'subject-5c1e7a'), true, 'the subject is in the record');
  assert.equal(await recordHolds(box, 'body-9d24b0'), false, 'the body is not');
});

test('U2 obk message check --peek takes nothing out of the record; obk message check takes out what it read', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  await mail(box, `${BOT}/nightly`, 'coder', 'subject-for-nightly');
  await mail(box, 'reader/daily', 'coder', 'subject-for-reader');

  assert.equal((await check(box, `${BOT}/nightly`, '--peek')).messages.length, 1, 'the premise: the peek saw it');
  assert.equal(await recordHolds(box, 'subject-for-nightly'), true, 'a peek reads nothing, so it stays');

  assert.equal((await check(box, `${BOT}/nightly`)).messages.length, 1, 'the premise: the check read it');
  assert.equal(await recordHolds(box, 'subject-for-nightly'), false, 'what the check read is out');
  assert.equal(await recordHolds(box, 'subject-for-reader'), true, 'and another session\'s mail stays');
});

// --------------------------------------------------------------- R7a: temp retire

test('R7a obk temp retire --json says how many messages were not read, and who sent them', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await mail(box, `${BOT}/scout`, 'coder', 'the staging host');
  await mail(box, `${BOT}/scout`, 'coder', 'the staging host, again');
  await mail(box, `${BOT}/scout`, 'tester', 'the flaky test');

  const answer = answerIn(await retireTemp(box, fleet.tabs.planner, 'scout', ['--json']));

  assertUnread(answer.unread, 3, ['coder/daily', 'tester/daily'], 'scout\'s answer');
});

test('R7a mail read with obk message check does not count; mail after it does', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await mail(box, `${BOT}/scout`, 'coder', 'the staging host');
  assert.equal((await check(box, `${BOT}/scout`)).messages.length, 1, 'the premise: the check read it');
  await mail(box, `${BOT}/scout`, 'tester', 'the flaky test');

  const answer = answerIn(await retireTemp(box, fleet.tabs.planner, 'scout', ['--json']));

  assertUnread(answer.unread, 1, ['tester/daily'], 'scout\'s answer');
});

test('R7a with all its mail read there is no unread in the answer, and the text says nothing of it', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await mail(box, `${BOT}/scout`, 'coder', 'the staging host');
  assert.equal((await check(box, `${BOT}/scout`)).messages.length, 1, 'the premise: the check read it');
  await mail(box, `${BOT}/nightly`, 'coder', 'for nightly, who stays');

  const result = await retireTemp(box, fleet.tabs.planner, 'scout');
  const json = answerIn(await retire(box, '--bot', BOT, '--session', 'nightly', '--json'));

  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /not read/i, `nothing unread to say, got:\n${result.stdout}`);
  assertUnread(json.unread, 1, ['coder/daily'], 'the contrast: nightly\'s answer');
});

test('R7a the plain answer of obk temp retire gives the count and the senders', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await mail(box, `${BOT}/scout`, 'coder', 'the staging host');
  await mail(box, `${BOT}/scout`, 'tester', 'the flaky test');

  const result = await retireTemp(box, fleet.tabs.planner, 'scout');

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /\b2 messages?\b/, `the count, got:\n${result.stdout}`);
  assert.match(result.stdout, /not read/i, `that they were not read, got:\n${result.stdout}`);
  assert.ok(result.stdout.includes('coder/daily') && result.stdout.includes('tester/daily'), `the senders, got:\n${result.stdout}`);
});

test('R7a a temporary session retired along with its maker carries its unread on its retiredWith entry; the maker with none carries none', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  await mail(box, `${BOT}/scout`, 'coder', 'the staging host');

  const answer = answerIn(await retire(box, '--bot', BOT, '--session', 'planner', '--json'));

  const entry = (answer.retiredWith ?? []).find((one) => one.session === 'scout');
  assert.ok(entry, `scout went with planner: ${JSON.stringify(answer)}`);
  assertUnread(entry.unread, 1, ['coder/daily'], 'scout\'s retiredWith entry');
  assert.equal('unread' in answer, false, `planner had no mail, so its own answer has no unread: ${JSON.stringify(answer)}`);
});

test('R7a obk retire --session of a long-lived session says the same in JSON', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  await mail(box, `${BOT}/nightly`, 'tester', 'the flaky test');

  const answer = answerIn(await retire(box, '--bot', BOT, '--session', 'nightly', '--json'));

  assertUnread(answer.unread, 1, ['tester/daily'], 'nightly\'s answer');
});

test('R7a the plain answer of obk retire --session gives the count and the sender', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  await mail(box, `${BOT}/nightly`, 'tester', 'the flaky test');

  const result = await retire(box, '--bot', BOT, '--session', 'nightly');

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /\b1 message\b/, `the count, got:\n${result.stdout}`);
  assert.ok(result.stdout.includes('tester/daily'), `the sender, got:\n${result.stdout}`);
});

// --------------------------------------------------------------- R7b: a whole bot

test('R7b obk retire --bot of a whole bot names the unread mail of its session, with the count and the senders', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  await mail(box, 'reader/daily', 'coder', 'the staging host');
  await mail(box, 'reader/daily', 'tester', 'the flaky test');

  const result = await retire(box, '--bot', 'reader');

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /\b2 messages\b/, `the count, got:\n${result.stdout}`);
  assert.ok(result.stdout.includes('coder/daily') && result.stdout.includes('tester/daily'), `the senders, got:\n${result.stdout}`);
});

// --------------------------------------------------------------- R7c: the record goes

test('R7c the retired session\'s record goes with it, and another session\'s stays', async (t) => {
  const box = await createSandbox(t);
  const fleet = await fleetIn(box);
  await mail(box, `${BOT}/scout`, 'coder', 'subject-for-scout');
  await mail(box, `${BOT}/nightly`, 'coder', 'subject-for-nightly');
  assert.equal(await recordHolds(box, 'subject-for-scout'), true, 'the premise: scout\'s mail is in the record');

  const result = await retireTemp(box, fleet.tabs.planner, 'scout');

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.equal(await recordHolds(box, 'subject-for-scout'), false, 'scout\'s record went with it');
  assert.equal(await recordHolds(box, 'subject-for-nightly'), true, 'nightly\'s stays');
});

// --------------------------------------------------------------- R7d: a retire that fails partway

// The review of PR #514: retiring a maker retires its temporary session first,
// which takes that session's record of unread mail away with it. When the
// maker's own retire then fails, as when Orca refuses its tab's close, the
// failure names the sessions already retired, and must still say what R7a
// says of each: how many messages sent to it were not read with obk message
// check, and who sent them. Otherwise that is said nowhere, and the record is
// gone.

/** Orca refuses every `terminal close` after the next one: scout's tab closes, planner's does not. */
async function refuseCloseAfterOne(box) {
  const closes = orcaCallsOf(await box.orca.calls(), 'terminal close').length;
  await box.orca.set({ fail: { 'terminal close': { code: 'runtime_error', message: 'the close was refused', after: closes + 1 } } });
}

test('R7d a retire that fails after it retired a temporary session still says how many of its messages were not read, and who sent them', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  await mail(box, `${BOT}/scout`, 'coder', 'the staging host');
  await refuseCloseAfterOne(box);

  const result = await retire(box, '--bot', BOT, '--session', 'planner');

  const said = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.code, 0, `the premise: planner's retire failed at its own close: ${said}`);
  assert.equal((await sessionIn(box.path('bots'), BOT, 'scout'))?.tab, undefined, `the premise: scout was retired before the failure: ${said}`);
  assert.ok(said.includes('scout'), `it names scout, retired before the failure: ${said}`);
  assert.match(said, /\b1 message\b/, `and how many of scout's messages were not read: ${said}`);
  assert.match(said, /not read/i, `that they were not read: ${said}`);
  assert.ok(said.includes('coder/daily'), `and who sent them: ${said}`);
});

test('R7d with --json, a retire that fails after it retired a temporary session still gives its unread count and senders', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  await mail(box, `${BOT}/scout`, 'coder', 'the staging host');
  await mail(box, `${BOT}/scout`, 'tester', 'the flaky test');
  await refuseCloseAfterOne(box);

  const result = await retire(box, '--bot', BOT, '--session', 'planner', '--json');

  const said = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.code, 0, `the premise: planner's retire failed at its own close: ${said}`);
  // In the JSON form when the failure has one, in words otherwise.
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch {
    answer = undefined;
  }
  if (answer !== undefined) {
    const text = JSON.stringify(answer);
    assert.match(text, /"count":\s*2\b/, `the count of scout's unread messages in the JSON: ${text}`);
    assert.ok(text.includes('coder/daily') && text.includes('tester/daily'), `and the senders: ${text}`);
  } else {
    assert.match(said, /\b2 messages\b/, `the count of scout's unread messages: ${said}`);
    assert.ok(said.includes('coder/daily') && said.includes('tester/daily'), `and the senders: ${said}`);
  }
});

// --------------------------------------------------------------- R7e: read before the send's answer

// The review of PR #514: Orca holds the message the moment it is posted, and
// answers the post a while later. A receiver that reads and acknowledges its
// mail with obk message check in that while has read it. A send that writes
// its record of unread mail only once the answer comes then records mail
// already read, and a retire says it was not read.

test('R7e mail the receiver read with obk message check before the send\'s answer came back is not counted as unread by a retire', async (t) => {
  const box = await createSandbox(t);
  await fleetIn(box);
  const sends = orcaCallsOf(await box.orca.calls(), 'orchestration send').length;
  await box.orca.set({ hang: { command: 'orchestration send', ms: 4000, applied: true, from: sends, times: 1 } });

  const sending = box.run([
    'message', 'send', '--bots', 'bots', '--to', `${BOT}/nightly`, '--from', 'coder/daily',
    '--subject', 'read before the answer', '--text', 'Already read.', '--json',
  ]);
  for (let tries = 0; (await box.orca.messages()).length === 0; tries += 1) {
    assert.ok(tries < 200, 'the premise: the post reached Orca while its answer was held back');
    await sleep(25);
  }
  const read = await check(box, `${BOT}/nightly`);
  const sent = await sending;

  assert.equal(read.messages.length, 1, `the premise: the check read the mail before the send's answer: ${JSON.stringify(read)}`);
  assert.equal(sent.code, 0, `the premise: the send went: ${sent.stdout}${sent.stderr}`);
  assert.deepEqual((await box.orca.messages()).map((one) => one.acked), [true], 'the premise: Orca has it as read');
  const answer = answerIn(await retire(box, '--bot', BOT, '--session', 'nightly', '--json'));
  assert.equal('unread' in answer, false, `the mail was read, so nothing is unread: ${JSON.stringify(answer)}`);
});
