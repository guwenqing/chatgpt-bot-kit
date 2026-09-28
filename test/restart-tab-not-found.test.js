// `obk restart` when Orca refuses `terminal close --terminal <h> --tab` with
// tab_not_found for a tab it still lists (#405).
//
// Seen live on Orca 1.4.214, after a machine restart: `obk restart --session
// prep` stopped on `Orca refused terminal close --terminal term_… --tab:
// tab_not_found`, while `orca terminal list --json` listed that terminal with
// the book's tab id and `orphaned: false`. `orca terminal close --terminal
// term_…` without `--tab` worked, and `obk up` then brought the session back
// with its conversation. In Orca 1.4.215's code `terminal list` and `close
// --tab` look the tab up in two different places, so a listed tab can be
// refused; the refusal likely comes as code `runtime_error` with message
// `tab_not_found`, though a code of `tab_not_found` is possible too. For a tab
// of one pane, which is every tab the kit opens, the close without `--tab`
// closes the whole tab.
//
// The contract, from the issue and the architect's ruling on it:
//
//   T1 A `--tab` close refused with tab_not_found, in its message or its code,
//      for a tab Orca lists: the kit closes the same terminal again without
//      `--tab`, waits as ever until the listing drops the tab, and goes on:
//      a new tab, resuming the book's conversation. Only that session's tab is
//      closed, and never with `--worktree … --all`.
//   T2 Every other refusal stops the restart as today, a refusal whose words
//      merely contain the letters inside another word included.
//   T3 Both closes refused: the restart stops with nothing opened, and says
//      both refusals and the command to run by hand.
//   T4 The tab still listed when the wait after the plain close runs out: the
//      restart stops as for any close the listing never catches up with.
//
// The refusal is the fake Orca's `refuseClose`, which one terminal carries
// (helpers/fake-orca.js): the trigger state itself was not produced live.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCleanFailure,
  bareLaunch,
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  orcaCallsOf,
  orcaCommand,
  orcaFlag,
  recordSession,
  sessionIn,
  tabsOfBot,
  tokenless,
  typedInto,
} from './helpers/cli.js';

const BOT = 'api-bot';

/** A bots folder with api-bot carrying the sessions named, brought up in Orca. */
async function started(box, sessions = ['daily']) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  assert.equal((await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude'])).code, 0);
  for (const name of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', name]);
    assert.equal(added.code, 0, added.stderr);
  }
  const up = await box.run(['up', '--bots', 'bots', '--bot', BOT]);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
}

/** The tab the book gives a session, and Orca's own record of it. */
async function liveTab(box, bots, name) {
  const entry = await sessionIn(bots, BOT, name);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${name}, got: ${JSON.stringify(entry)}`);
  const terminal = (await tabsOfBot(box, bots, BOT)).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `Orca should still have ${name}'s tab ${entry.tab}`);
  return { tabId: entry.tab, handle: terminal.handle, terminal };
}

/** The session's conversation, reported by the kit's hook and on Claude Code's own record: what a restart resumes. */
async function conversationOf(box, bots, name, id) {
  const { tab } = await sessionIn(bots, BOT, name);
  const ran = await recordSession(box, { bots, bot: BOT, tab, session: id });
  assert.equal(ran.code, 0, ran.stderr);
  await conversationOnRecord(box, { harness: 'claude', cwd: botHomeOf(bots, BOT), id });
}

/** Have Orca refuse the closes of one terminal, `tab` for a close with `--tab` and `pane` for one without. */
async function refuseClose(box, handle, refusals) {
  const terminals = await box.orca.terminals();
  assert.ok(terminals.some((one) => one.handle === handle), `the premise: Orca has terminal ${handle}`);
  await box.orca.set({ terminals: terminals.map((one) => (one.handle === handle ? { ...one, refuseClose: refusals } : one)) });
}

/** A session up with its conversation in the book, and Orca refusing its tab's `--tab` close with `tab`. */
async function stuckSession(box, { tab, pane, sessions = ['daily'] }) {
  const bots = await started(box, sessions);
  for (const name of sessions) await conversationOf(box, bots, name, `sess-${name}`);
  const before = await liveTab(box, bots, 'daily');
  await refuseClose(box, before.handle, pane === undefined ? { tab } : { tab, pane });
  return { bots, before };
}

/** The line a claude session resumes `id` on. */
const resumeLine = (box, id, name = 'daily') => `${bareLaunch(box, 'claude', BOT, name)} --resume ${id}`;

/** Everything Orca was asked since `from`, and the calls of one command among them. */
const since = async (box, from) => (await box.orca.calls()).slice(from);
const closes = (calls) => orcaCallsOf(calls, 'terminal close');
const creates = (calls) => orcaCallsOf(calls, 'terminal create');
const shown = (calls) => JSON.stringify(calls.map((call) => call.args.join(' ')));

/** The restart the user ran live: one session of one bot. */
const restart = (box) => box.run(['restart', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);

/** Orca's tab_not_found, in the two forms 1.4.215's code may send it. */
const TAB_NOT_FOUND = [
  ['in the message, code runtime_error', { code: 'runtime_error', message: 'tab_not_found' }],
  ['as the code', { code: 'tab_not_found', message: 'Orca could not find that tab' }],
];

// ---------------------------------------------------------------------------
// T1 — tab_not_found for a listed tab: closed without --tab, and brought back.
// ---------------------------------------------------------------------------

for (const [form, refusal] of TAB_NOT_FOUND) {
  test(`T1 tab_not_found ${form}: the same terminal is closed again without --tab, and the session comes back in a new tab with its conversation`, async (t) => {
    const box = await createSandbox(t);
    const { bots, before } = await stuckSession(box, { tab: refusal });
    const from = (await box.orca.calls()).length;

    const result = await restart(box);

    assert.equal(result.code, 0, `the restart should go on past tab_not_found, got: ${result.stderr}`);
    const calls = await since(box, from);
    const closed = closes(calls);
    assert.equal(closed.length, 2, `the --tab close, then one more: ${shown(closed)}`);
    assert.equal(orcaFlag(closed[0], '--terminal'), before.handle, 'the first close names the session\'s own terminal');
    assert.ok(closed[0].args.includes('--tab'), `and asks for the whole tab, as ever: ${closed[0].args.join(' ')}`);
    assert.equal(orcaFlag(closed[1], '--terminal'), before.handle, 'the second closes the same terminal');
    assert.ok(!closed[1].args.includes('--tab'), `without --tab, the form Orca took live: ${closed[1].args.join(' ')}`);

    const made = creates(calls);
    assert.equal(made.length, 1, 'and one tab is opened in its place');
    assert.ok(calls.indexOf(closed[1]) < calls.indexOf(made[0]), 'after the old one is closed');

    assert.ok(
      !(await box.orca.terminals()).some((one) => one.handle === before.handle),
      'no tab of the old session is left behind',
    );
    const after = await liveTab(box, bots, 'daily');
    assert.notEqual(after.tabId, before.tabId, 'a tab that comes back is a new tab');
    assert.deepEqual(typedInto(after.terminal).map(tokenless), [resumeLine(box, 'sess-daily')], 'resuming the conversation the book held');
    const entry = await sessionIn(bots, BOT, 'daily');
    assert.equal(entry.tab, after.tabId, 'the book follows the session to its new tab');
    assert.equal(entry.session, 'sess-daily', 'and it is still the same conversation');
  });
}

test('T1 the fallback closes only the session\'s own tab, and never a project\'s every tab', async (t) => {
  // The live command named one session; the bot's other session is up beside it.
  const box = await createSandbox(t);
  const { bots, before } = await stuckSession(box, {
    tab: { code: 'runtime_error', message: 'tab_not_found' },
    sessions: ['daily', 'review'],
  });
  const review = await liveTab(box, bots, 'review');
  const from = (await box.orca.calls()).length;

  const result = await restart(box);

  assert.equal(result.code, 0, result.stderr);
  const calls = await since(box, from);
  assert.ok(closes(calls).length >= 2, `a tab really was closed without --tab, or this proves nothing: ${shown(closes(calls))}`);
  for (const call of calls) {
    const line = call.args.join(' ');
    assert.ok(!call.args.includes('--all'), `orca ${line}: --all closes tabs the kit does not own`);
    if (orcaCommand(call) !== 'terminal close') continue;
    assert.equal(orcaFlag(call, '--worktree'), undefined, `orca ${line}: a close names one tab, never a project`);
    assert.equal(orcaFlag(call, '--terminal'), before.handle, `orca ${line}: only the restarted session's tab is closed`);
  }
  assert.deepEqual(
    (await box.orca.terminals()).find((one) => one.handle === review.handle),
    review.terminal,
    'the other session\'s tab is left exactly as it was',
  );
  assert.equal((await sessionIn(bots, BOT, 'review')).tab, review.tabId, 'and the book still puts it in its old tab');
});

test('T1 after the close without --tab the kit waits for the listing to drop the tab before it opens a new one', async (t) => {
  // Orca answers a close before `terminal list` stops listing the tab. The
  // lag is counted in listings (the fake's closeLag), so any restart that looks
  // again gets past it, and one that opens straight away finds the old tab.
  const box = await createSandbox(t);
  const { bots, before } = await stuckSession(box, { tab: { code: 'runtime_error', message: 'tab_not_found' } });
  await box.orca.set({ closeLag: 2 });
  const from = (await box.orca.calls()).length;

  const result = await restart(box);

  assert.equal(result.code, 0, result.stderr);
  const calls = await since(box, from);
  assert.equal(closes(calls).length, 2, `the --tab close and the plain one: ${shown(closes(calls))}`);
  assert.equal(creates(calls).length, 1, 'and the session comes back in a tab of its own');
  const after = await liveTab(box, bots, 'daily');
  assert.notEqual(after.tabId, before.tabId, 'the tab Orca was still listing is not the tab that came back');
  assert.deepEqual(typedInto(after.terminal).map(tokenless), [resumeLine(box, 'sess-daily')], 'with the conversation the book held');
});

// ---------------------------------------------------------------------------
// T2 — every other refusal stops the restart, as today.
// ---------------------------------------------------------------------------

const OTHER_REFUSALS = [
  ['a refusal of its own', { code: 'runtime_error', message: 'the tab will not close' }],
  ['a message with the letters inside a longer word before them', { code: 'runtime_error', message: 'subtab_not_found' }],
  ['a message with the letters inside a longer word after them', { code: 'runtime_error', message: 'tab_not_founded' }],
  ['a code with the letters inside a longer word', { code: 'subtab_not_found', message: 'orca said no' }],
];

for (const [kind, refusal] of OTHER_REFUSALS) {
  test(`T2 ${kind} (${refusal.code}: ${refusal.message}) stops the restart: nothing more is closed and nothing opened`, async (t) => {
    const box = await createSandbox(t);
    const { bots, before } = await stuckSession(box, { tab: refusal });
    const terminals = await box.orca.terminals();
    const from = (await box.orca.calls()).length;

    const result = await restart(box);

    assertCleanFailure(result);
    assert.ok(result.stderr.includes(refusal.message), `Orca's own words should reach the reader, got: ${result.stderr}`);
    const calls = await since(box, from);
    assert.equal(closes(calls).length, 1, `it asked once, with --tab, and was refused: ${shown(closes(calls))}`);
    assert.ok(closes(calls)[0].args.includes('--tab'));
    assert.deepEqual(creates(calls), [], 'and opened nothing after that');
    assert.deepEqual(await box.orca.terminals(), terminals, 'every tab is as it was');
    const entry = await sessionIn(bots, BOT, 'daily');
    assert.equal(entry.tab, before.tabId, 'the session is still in the tab it was in');
    assert.equal(entry.session, 'sess-daily');
  });
}

// ---------------------------------------------------------------------------
// T3 — both closes refused: stopped, with both refusals and the command by hand.
// ---------------------------------------------------------------------------

test('T3 a close without --tab refused too stops the restart with nothing opened, and says both refusals and the command to run by hand', async (t) => {
  const box = await createSandbox(t);
  const { bots, before } = await stuckSession(box, {
    tab: { code: 'runtime_error', message: 'tab_not_found' },
    pane: { code: 'runtime_error', message: 'the pane will not close' },
  });
  const terminals = await box.orca.terminals();
  const from = (await box.orca.calls()).length;

  const result = await restart(box);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('tab_not_found'), `the first refusal, got: ${result.stderr}`);
  assert.ok(result.stderr.includes('the pane will not close'), `and the second, got: ${result.stderr}`);
  // The two steps the user ran by hand live. The Orca CLI is named by the path
  // the kit runs it from, never a bare `orca`, which is root-only on this
  // machine (tech notes); here that path is the fake's. The kit names itself
  // by its own path, which here ends in `obk`. The rest of the wording is free.
  const word = (end) => `(?:'[^']*/${end}'|[^\\s']*/${end})`;
  const closeByHand = new RegExp(`${word('orca')} terminal close --terminal ${before.handle}(?![\\w-])(?! --tab)`);
  assert.match(result.stderr, closeByHand, `and the close without --tab to run by hand, got: ${result.stderr}`);
  const upByHand = new RegExp(`${word('obk')} up --bots (?:'[^']*'|\\S+) --bot ${BOT}(?![\\w-])`);
  assert.match(result.stderr, upByHand, `and the kit's up for the bot after it, got: ${result.stderr}`);

  const calls = await since(box, from);
  const closed = closes(calls);
  assert.equal(closed.length, 2, `the --tab close and the plain one, both refused: ${shown(closed)}`);
  assert.ok(closed[0].args.includes('--tab') && !closed[1].args.includes('--tab'), shown(closed));
  assert.deepEqual(creates(calls), [], 'nothing is opened beside a tab that is still there');
  assert.deepEqual(await box.orca.terminals(), terminals, 'every tab is as it was');
  const entry = await sessionIn(bots, BOT, 'daily');
  assert.equal(entry.tab, before.tabId, 'and the book unchanged');
  assert.equal(entry.session, 'sess-daily');
});

// ---------------------------------------------------------------------------
// T4 — the listing never drops the tab after the plain close.
// ---------------------------------------------------------------------------

test('T4 a tab still listed when the wait after the close without --tab runs out stops the restart with nothing opened', async (t) => {
  const box = await createSandbox(t);
  const { bots, before } = await stuckSession(box, { tab: { code: 'runtime_error', message: 'tab_not_found' } });
  await box.orca.set({ closeLag: 100000 });
  const from = (await box.orca.calls()).length;

  const result = await restart(box);

  assertCleanFailure(result);
  assert.ok(
    result.stderr.includes(before.tabId) || result.stderr.includes(before.handle),
    `the message should name the tab it is waiting on, got: ${result.stderr}`,
  );
  const calls = await since(box, from);
  const closed = closes(calls);
  assert.equal(closed.length, 2, `the --tab close, then the plain one: ${shown(closed)}`);
  assert.ok(!closed[1].args.includes('--tab'), shown(closed));
  assert.deepEqual(creates(calls), [], 'and opened nothing, rather than report the old tab as the new one');
  assert.equal((await sessionIn(bots, BOT, 'daily')).session, 'sess-daily', 'the conversation is still in the book');
});
