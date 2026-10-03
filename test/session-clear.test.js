// `obk session clear` and `obk session compact`: the kit, not the harness, is
// asked to clear or compact a session, and does it safely (#391).
//
//   obk session clear   --bots <path> --bot <bot> --session <name> [--json]
//   obk session compact --bots <path> --bot <bot> --session <name> [--json]
//
// The requirement, with the architect's rulings, as these tests hold it:
//
//   - All three flags are needed, and a missing one is refused the way every
//     command refuses one. Both commands are in `obk --help`.
//   - Refused before anything is typed (non-zero exit, a reason, nothing sent
//     into any tab): an unknown bot or session, a paused bot or session, a
//     session with no tab open, and a tab with only its shell in front (the
//     harness quit; the reason says a restart brings it back).
//   - Then it waits, up to 30 s, for the session to be idle with nothing on its
//     screen to answer. Busy is Orca's `tui-idle` not answering ok, or any
//     screen row saying "esc to interrupt" in any case, since Orca can call a
//     busy Codex idle. A question or form on screen (as the kit's own look
//     sees one), or a reason Orca gives for a blocked tab, is waited out too.
//     Still not idle at 30 s: refused, nothing typed, and it says why. One that
//     goes idle within the 30 s goes on.
//   - It types the harness's own command as text, with no return: `/clear` on
//     Claude Code, `/new` on Codex, `/compact` on both. Then it reads the
//     screen: the lowest row the harness's pointer starts (`❯` Claude Code,
//     `›` Codex) must read exactly the pointer, a space and the command, and
//     the first row under it whose first text (after an optional pointer)
//     starts with `/` must name exactly that command as its first word: the
//     harness's slash menu, the command first. Otherwise it takes the text
//     back with one backspace (\x7f) per character, as one send, and refuses,
//     saying what the screen showed. A compact the menu does not offer is
//     "this harness cannot compact".
//   - The return is a send of its own: `\r`, without --enter.
//   - Codex's clear: when "Where should the new conversation run?" comes up
//     with the pointer on "1. Current checkout", one more `\r`; with the
//     pointer anywhere else, Esc (\x1b) and a refusal, never `2`. Then, because
//     Codex reports a new conversation only at its first turn (tech notes,
//     section 3), RECORD_LINE below, word for word (approved by the architect
//     on #391), with a return, through the
//     gate the mail notice goes through. Nothing like it on Claude Code.
//   - A clear is confirmed by the book: within 30 s it holds a conversation id
//     for the session other than the one it held before anything was typed.
//     `--json` answers `{ bots, cleared: { bot, session, harness, was, now } }`.
//     None in 30 s: non-zero, saying the command was entered, the book has no
//     new conversation, and to look at the tab.
//   - A compact is confirmed by the harness's own record of the session's
//     current conversation: within 300 s it gains a compaction made after the
//     command began (Claude Code's `compact_boundary` line, Codex's top-level
//     `compacted` record). `--json` answers `{ bots, compacted: { bot,
//     session, harness, conversation, confirmed: true } }`. None in the 300 s
//     is not a failure: exit 0, `confirmed: false`, and the plain answer says
//     the compaction is "not confirmed yet" (the architect's ruling on #391,
//     comment 5963852753). That case is not tested here, since it costs the
//     whole 300 s; the live system test reports it when it happens.
//   - Nothing goes into any tab but the session's own.
//   - A cleared session is not promised to be idle afterwards (a Codex one may
//     run its start routine), so nothing here asks that of it: a clear is the
//     book's new id.
//
// How the harness is played here. The fake Orca types nothing anywhere and
// runs no hook. Each send into the session's tab can move its screen on
// (`nextScreens`, helpers/fake-orca.js), so the screens a harness would show
// as the command is typed, entered and answered are given in order, from
// helpers/screens.js; the typed-command screens there are reconstructions.
// The harness's part after the return (the hook reporting a new
// conversation, or a compaction written to its record) is played by the test
// while the command waits: it watches the tab's sends and acts once the step
// that would cause it has been sent.
//
// How the wait is modelled. The fake Orca keeps no clock: its `terminal wait`
// answers at once. So a tab that goes idle in time is a `waitIdle` list
// (busy on the first looks, idle after), and one that never does costs the
// full 30 s of real time. Those tests are few, and run
// side by side at the end of this file.
//
// Every expected value comes from the requirement: the commands typed, the
// keys, the line's words and the JSON's shape.

import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import test, { describe, it } from 'node:test';

import {
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  orcaCallsOf,
  orcaCommand,
  orcaFlag,
  recordSession,
  sessionIn,
  tabsOfBot,
} from './helpers/cli.js';
import {
  CLAUDE_CLEAR_AFTER_DRAFT,
  CLAUDE_CLEAR_NO_MENU,
  CLAUDE_CLEAR_OTHER_FIRST,
  CLAUDE_CLEAR_TYPED,
  CLAUDE_COMPACT_TYPED,
  CLAUDE_IDLE,
  CLAUDE_WORKING,
  CODEX_COMPACT_NOT_OFFERED,
  CODEX_COMPACT_TYPED,
  CODEX_IDLE,
  CODEX_NEW_MENU,
  CODEX_NEW_MENU_ON_TWO,
  CODEX_NEW_NO_MENU,
  CODEX_NEW_TYPED,
  CODEX_UPDATE_OFFER,
  CODEX_WORKING,
} from './helpers/screens.js';

/** The line the kit types into Codex after its `/new`, word for word, as the architect approved it on #391. */
const RECORD_LINE = 'obk: this conversation was started by obk session clear, and this line is only so the kit can record it. Reply "ok"; nothing else is asked.';

const BOT = 'api-bot';
const PROMPT = 'Read your AGENTS.md and keep the queue moving.';
const VERBS = ['clear', 'compact'];

/** The command each harness clears with, and the one it compacts with. */
const CLEAR = { claude: '/clear', codex: '/new' };
const COMPACT = '/compact';

/** One backspace per character of `command`, as the one send that takes it back. */
const backspaces = (command) => '\x7f'.repeat(command.length);

// ---------------------------------------------------------------- the fleet

/** A bots folder with Bot Father and api-bot on `harness`, with the sessions named, none of them up yet. */
async function madeBot(box, { harness = 'claude', sessions = ['daily', 'review'] } = {}) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  for (const name of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', name, '--prompt', PROMPT]);
    assert.equal(added.code, 0, added.stderr);
  }
  return box.path('bots');
}

/** The tab the book gives a session, as Orca has it now. */
async function liveTab(box, bots, name = 'daily') {
  const entry = await sessionIn(bots, BOT, name);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${name}, got: ${JSON.stringify(entry)}`);
  const terminal = (await tabsOfBot(box, bots, BOT)).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `Orca should have ${name}'s tab ${entry.tab}`);
  return terminal;
}

/**
 * api-bot up on `harness`, each session with a conversation the book holds and
 * the harness has on record, as a session that has had a turn has them: its
 * id `sess-<name>`. With `reported: false` the hook has not reported one yet,
 * and the book holds none.
 */
async function running(box, { harness = 'claude', sessions = ['daily', 'review'], reported = true } = {}) {
  const bots = await madeBot(box, { harness, sessions });
  const up = await box.run(['up', '--bots', 'bots', '--bot', BOT]);
  assert.equal(up.code, 0, `the up this test stands on: ${up.stdout}${up.stderr}`);
  if (reported) {
    for (const name of sessions) {
      const tab = await liveTab(box, bots, name);
      const heard = await recordSession(box, { bots, bot: BOT, tab: tab.tabId, session: `sess-${name}` });
      assert.equal(heard.code, 0, `the hook report this test stands on: ${heard.stderr}`);
      await conversationOnRecord(box, { harness, cwd: botHomeOf(bots, BOT), id: `sess-${name}` });
    }
    assert.equal((await sessionIn(bots, BOT, 'daily')).session, 'sess-daily', 'the premise: the book holds daily\'s conversation');
  }
  return bots;
}

/** Change one of Orca's terminals, found by its tab id, as `change` says. */
async function changeTab(box, tabId, change) {
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.tabId === tabId ? { ...terminal, ...change } : terminal)),
  });
}

/** What every tab Orca has had typed into it, by handle. */
async function typedEverywhere(box) {
  return Object.fromEntries((await box.orca.terminals()).map((terminal) => [terminal.handle, terminal.typed ?? []]));
}

/** The sends into a tab after its launch line, each as `{ text, enter }`. */
const sendsAfterLaunch = (terminal) => (terminal.typed ?? []).slice(1).map(({ text, enter }) => ({ text, enter }));

/** The sends into the session's tab after its launch line, as Orca has them now. */
const sendsInto = async (box, bots, name = 'daily') => sendsAfterLaunch(await liveTab(box, bots, name));

/** `obk session <verb>` for api-bot's `session`, with any more flags. */
const sessionCommand = (box, verb, { session = 'daily', bot = BOT, flags = [] } = {}) =>
  box.run(['session', verb, '--bots', 'bots', '--bot', bot, '--session', session, ...flags]);

/**
 * Run `obk session <verb>` with `--json`, and play the harness while it runs:
 * once `when` holds for the sends into the session's tab, run `then`, once.
 * Answers the run's result and whether `then` ran.
 */
async function runPlaying(box, bots, verb, { when, then, session = 'daily' }) {
  const { tabId } = await liveTab(box, bots, session);
  let finished = false;
  const run = sessionCommand(box, verb, { session, flags: ['--json'] });
  run.then(() => { finished = true; }, () => { finished = true; });

  let played = false;
  const until = Date.now() + 25_000;
  while (!finished && Date.now() < until) {
    const terminal = (await box.orca.terminals()).find((one) => one.tabId === tabId);
    if (terminal !== undefined && when(sendsAfterLaunch(terminal))) {
      await then();
      played = true;
      break;
    }
    await sleep(50);
  }
  return { result: await run, played };
}

/** The hook reporting a new conversation `id` from the session's tab, as the harness would run it. */
async function hookReports(box, bots, id, source, session = 'daily') {
  const tab = await liveTab(box, bots, session);
  const heard = await recordSession(box, { bots, bot: BOT, tab: tab.tabId, session: id, source });
  assert.equal(heard.code, 0, `the hook's own run: ${heard.stderr}`);
}

/** A compaction written into the session's conversation record now, the way `harness` writes one. */
async function compactionIn(file, harness) {
  const at = new Date().toISOString();
  const line = harness === 'codex'
    ? { timestamp: at, type: 'compacted', payload: { message: 'A summary of the conversation so far.' } }
    : { type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', sessionId: 'sess-daily', timestamp: at, compactMetadata: { trigger: 'manual', preTokens: 81522 } };
  await appendFile(file, `${JSON.stringify(line)}\n`);
}

/** The JSON a run answered with, which must have gone through. */
function answered(result, what) {
  assert.equal(result.code, 0, `${what} should go through: ${result.stdout}${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    assert.fail(`${what} should answer JSON on stdout, got:\n${result.stdout}`);
  }
}

/** Refused: a non-zero exit, no crash, and a reason, with every word in `named`. Answers what it said. */
function assertRefused(result, ...named) {
  assert.notEqual(result.code, 0, `this should have been refused, got:\n${result.stdout}${result.stderr}`);
  const said = result.stdout + result.stderr;
  assert.notEqual(said.trim(), '', 'a refusal with nothing said is no use to anybody');
  assert.ok(!/^\s+at /m.test(said), `expected a reason, got a crash:\n${said}`);
  for (const word of named) assert.ok(said.includes(word), `the refusal should name ${word}, got:\n${said}`);
  return said;
}

/** Nothing was sent into any tab: every tab's typed list is what it was. */
async function assertNothingTyped(box, before, what) {
  assert.deepEqual(await typedEverywhere(box), before, `${what}: nothing is typed into any tab`);
}

/** Every `terminal send` since `from` calls went into `handle` and no other tab. */
async function assertSentOnlyInto(box, handle, from, what) {
  const sends = orcaCallsOf((await box.orca.calls()).slice(from), 'terminal send');
  assert.ok(sends.length > 0, `${what}: the premise, something was sent`);
  assert.deepEqual([...new Set(sends.map((call) => orcaFlag(call, '--terminal')))], [handle], `${what}: every send went into the session's own tab`);
}

// ---------------------------------------------------------------- the interface

test('obk --help lists session clear and session compact, each with its three flags', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['--help']);

  assert.equal(result.code, 0);
  for (const verb of VERBS) {
    const at = result.stdout.indexOf(`obk session ${verb} `);
    assert.notEqual(at, -1, `the usage should list obk session ${verb}, got:\n${result.stdout}`);
    const usage = result.stdout.slice(at, at + 200);
    for (const flag of ['--bots', '--bot', '--session']) {
      assert.ok(usage.includes(flag), `obk session ${verb}'s usage should give ${flag}, got:\n${usage}`);
    }
  }
});

for (const verb of VERBS) {
  for (const missing of ['bots', 'bot', 'session']) {
    test(`session ${verb} without --${missing} is refused the way every command refuses a missing flag, and types nothing`, async (t) => {
      const box = await createSandbox(t);
      await running(box);
      const before = await typedEverywhere(box);
      const flags = { bots: ['--bots', 'bots'], bot: ['--bot', BOT], session: ['--session', 'daily'] };
      const args = ['session', verb, ...Object.entries(flags).filter(([name]) => name !== missing).flatMap(([, given]) => given)];

      const result = await box.run(args);

      const said = assertRefused(result);
      assert.match(said, new RegExp(`session ${verb} needs --${missing}\\b`), `in the words every missing flag gets, got:\n${said}`);
      await assertNothingTyped(box, before, `--${missing} missing`);
    });
  }
}

// ---------------------------------------------------- refused before anything is typed

for (const verb of VERBS) {
  test(`session ${verb} for a bot the bots folder does not have is refused, naming it, and types nothing`, async (t) => {
    const box = await createSandbox(t);
    await running(box);
    const before = await typedEverywhere(box);

    assertRefused(await sessionCommand(box, verb, { bot: 'no-such-bot' }), 'no-such-bot');

    await assertNothingTyped(box, before, 'an unknown bot');
  });

  test(`session ${verb} for a session the bot does not have is refused, naming it, and types nothing`, async (t) => {
    const box = await createSandbox(t);
    await running(box);
    const before = await typedEverywhere(box);

    assertRefused(await sessionCommand(box, verb, { session: 'no-such-session' }), 'no-such-session');

    await assertNothingTyped(box, before, 'an unknown session');
  });

  test(`session ${verb} for a paused session is refused, saying it is paused, and types nothing`, async (t) => {
    const box = await createSandbox(t);
    await running(box);
    const paused = await box.run(['pause', '--bots', 'bots', '--bot', BOT, '--session', 'daily']);
    assert.equal(paused.code, 0, `the pause this test stands on: ${paused.stdout}${paused.stderr}`);
    const before = await typedEverywhere(box);

    const said = assertRefused(await sessionCommand(box, verb));

    assert.match(said, /paused/i, `it says the session is paused, got:\n${said}`);
    await assertNothingTyped(box, before, 'a paused session');
  });

  test(`session ${verb} for a session of a paused bot is refused, saying it is paused, and types nothing`, async (t) => {
    const box = await createSandbox(t);
    await running(box);
    const paused = await box.run(['pause', '--bots', 'bots', '--bot', BOT]);
    assert.equal(paused.code, 0, `the pause this test stands on: ${paused.stdout}${paused.stderr}`);
    const before = await typedEverywhere(box);

    const said = assertRefused(await sessionCommand(box, verb));

    assert.match(said, /paused/i, `it says the bot is paused, got:\n${said}`);
    await assertNothingTyped(box, before, 'a paused bot');
  });

  test(`session ${verb} for a session never brought up, with no tab, is refused and types nothing`, async (t) => {
    const box = await createSandbox(t);
    await madeBot(box);
    const before = await typedEverywhere(box);

    assertRefused(await sessionCommand(box, verb), 'daily');

    await assertNothingTyped(box, before, 'a session with no tab');
  });

  test(`session ${verb} for a session whose tab Orca no longer has is refused and types nothing`, async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    const { tabId } = await liveTab(box, bots);
    await box.orca.set({ terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== tabId) });
    const before = await typedEverywhere(box);

    assertRefused(await sessionCommand(box, verb), 'daily');

    await assertNothingTyped(box, before, 'a closed tab');
  });

  test(`session ${verb} for a tab with only its shell in front is refused, saying a restart brings it back, and types nothing`, async (t) => {
    // The harness quit or crashed: a command typed now would run in the shell.
    const box = await createSandbox(t);
    const bots = await running(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { foreground: 'shell' });
    const before = await typedEverywhere(box);

    assertRefused(await sessionCommand(box, verb), 'restart');

    await assertNothingTyped(box, before, 'the shell in front');
  });
}

// ---------------------------------------------------------------- clear, Claude Code

test('clear on Claude Code: /clear typed alone, read on screen, a return of its own, and the new conversation the book holds is the answer', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { nextScreens: [CLAUDE_CLEAR_TYPED, CLAUDE_IDLE] });
  const others = Object.fromEntries(Object.entries(await typedEverywhere(box)).filter(([handle]) => handle !== tab.handle));
  const from = (await box.orca.calls()).length;

  // Claude Code reports the clear at /clear itself, with its own word for it.
  const { result, played } = await runPlaying(box, bots, 'clear', {
    when: (sends) => sends.some((one) => one.text === '\r'),
    then: () => hookReports(box, bots, 'sess-cleared', 'clear'),
  });

  const answer = answered(result, 'the clear');
  assert.ok(played, 'the premise: the return was sent and the hook reported the new conversation');
  assert.deepEqual(
    await sendsInto(box, bots),
    [{ text: '/clear', enter: false }, { text: '\r', enter: false }],
    'the command as text with no return, then the return as a send of its own, and nothing else: no line after it on Claude Code',
  );
  assert.equal(answer.bots, bots, 'bots is the folder, resolved');
  assert.deepEqual(answer.cleared, { bot: BOT, session: 'daily', harness: 'claude', was: 'sess-daily', now: 'sess-cleared' });
  assert.equal((await sessionIn(bots, BOT, 'daily')).session, 'sess-cleared', 'the book holds the new conversation');
  const now = Object.fromEntries(Object.entries(await typedEverywhere(box)).filter(([handle]) => handle !== tab.handle));
  assert.deepEqual(now, others, 'no other tab, Bot Father\'s and the bot\'s other session\'s among them, had anything typed into it');
  await assertSentOnlyInto(box, tab.handle, from, 'clear');
});

test('clear of a session whose book held no conversation yet answers was: null', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box, { reported: false });
  assert.equal((await sessionIn(bots, BOT, 'daily')).session, undefined, 'the premise: no conversation in the book');
  await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: [CLAUDE_CLEAR_TYPED, CLAUDE_IDLE] });

  const { result, played } = await runPlaying(box, bots, 'clear', {
    when: (sends) => sends.some((one) => one.text === '\r'),
    then: () => hookReports(box, bots, 'sess-cleared', 'clear'),
  });

  const answer = answered(result, 'the clear');
  assert.ok(played, 'the premise: the hook reported the new conversation');
  assert.deepEqual(answer.cleared, { bot: BOT, session: 'daily', harness: 'claude', was: null, now: 'sess-cleared' });
});

test('clear without --json says, on its way out, the bot, the session and the new conversation', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  const { tabId } = await liveTab(box, bots);
  await changeTab(box, tabId, { nextScreens: [CLAUDE_CLEAR_TYPED, CLAUDE_IDLE] });

  const run = sessionCommand(box, 'clear');
  let finished = false;
  run.then(() => { finished = true; });
  const until = Date.now() + 25_000;
  while (!finished && Date.now() < until && !(await sendsInto(box, bots)).some((one) => one.text === '\r')) await sleep(50);
  await hookReports(box, bots, 'sess-cleared', 'clear');
  const result = await run;

  assert.equal(result.code, 0, `the clear should go through: ${result.stdout}${result.stderr}`);
  for (const word of [BOT, 'daily', 'sess-cleared']) {
    assert.ok(result.stdout.includes(word), `the plain answer names ${word}, got:\n${result.stdout}`);
  }
});

test('clear waits out a busy session and types once it is idle, within the 30 s', async (t) => {
  // Orca's tui-idle says busy on the first two looks and idle after.
  const box = await createSandbox(t);
  const bots = await running(box);
  await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: [CLAUDE_CLEAR_TYPED, CLAUDE_IDLE] });
  await box.orca.set({ waitIdle: ['busy', 'busy', true] });
  const from = (await box.orca.calls()).length;

  const { result, played } = await runPlaying(box, bots, 'clear', {
    when: (sends) => sends.some((one) => one.text === '\r'),
    then: () => hookReports(box, bots, 'sess-cleared', 'clear'),
  });

  const answer = answered(result, 'the clear');
  assert.ok(played, 'the premise: the hook reported the new conversation');
  assert.deepEqual(answer.cleared.now, 'sess-cleared');
  assert.deepEqual(await sendsInto(box, bots), [{ text: '/clear', enter: false }, { text: '\r', enter: false }]);
  const calls = (await box.orca.calls()).slice(from);
  const firstSend = calls.findIndex((call) => orcaCommand(call) === 'terminal send');
  const looksBefore = calls.slice(0, firstSend).filter((call) => orcaCommand(call) === 'terminal wait').length;
  assert.ok(looksBefore >= 3, `nothing was typed until a look found it idle: the third, got ${looksBefore} look(s) first`);
});

test('a draft already in Claude Code\'s input line: the /clear is taken back with six backspaces in one send, nothing entered, and the refusal shows the line', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: [CLAUDE_CLEAR_AFTER_DRAFT, CLAUDE_IDLE] });
  const book = await sessionIn(bots, BOT, 'daily');

  const said = assertRefused(await sessionCommand(box, 'clear'));

  assert.deepEqual(await sendsInto(box, bots), [{ text: '/clear', enter: false }, { text: backspaces('/clear'), enter: false }]);
  assert.ok(said.includes('fix the flaky test/clear'), `it says what the input line showed, got:\n${said}`);
  assert.deepEqual(await sessionIn(bots, BOT, 'daily'), book, 'the book is as it was');
});

test('Claude Code\'s menu with another command first, one whose name only starts with /clear: taken back, nothing entered, and the refusal names that row', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: [CLAUDE_CLEAR_OTHER_FIRST, CLAUDE_IDLE] });

  const said = assertRefused(await sessionCommand(box, 'clear'));

  assert.deepEqual(await sendsInto(box, bots), [{ text: '/clear', enter: false }, { text: backspaces('/clear'), enter: false }]);
  assert.ok(said.includes('/clear-history'), `it says what the menu showed first, got:\n${said}`);
});

test('no slash menu under Claude Code\'s input line: /clear taken back, nothing entered', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box);
  await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: [CLAUDE_CLEAR_NO_MENU, CLAUDE_IDLE] });

  assertRefused(await sessionCommand(box, 'clear'));

  assert.deepEqual(await sendsInto(box, bots), [{ text: '/clear', enter: false }, { text: backspaces('/clear'), enter: false }]);
});

// ---------------------------------------------------------------- clear, Codex

test('clear on Codex: /new, a return, "Current checkout" taken with a return, then the ruled line with a return, and the new conversation is the answer', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box, { harness: 'codex' });
  const tab = await liveTab(box, bots);
  await changeTab(box, tab.tabId, { nextScreens: [CODEX_NEW_TYPED, CODEX_NEW_MENU, CODEX_IDLE] });
  const others = Object.fromEntries(Object.entries(await typedEverywhere(box)).filter(([handle]) => handle !== tab.handle));
  const from = (await box.orca.calls()).length;

  // Codex reports its new conversation at its first turn, as a startup.
  const { result, played } = await runPlaying(box, bots, 'clear', {
    when: (sends) => sends.some((one) => one.text === RECORD_LINE),
    then: () => hookReports(box, bots, 'sess-new', 'startup'),
  });

  const answer = answered(result, 'the clear');
  assert.ok(played, 'the premise: the line was typed and the hook reported the new conversation');
  assert.deepEqual(await sendsInto(box, bots), [
    { text: '/new', enter: false },
    { text: '\r', enter: false },
    { text: '\r', enter: false },
    { text: RECORD_LINE, enter: true },
  ], '/new as text, its return, the return that takes "Current checkout", and the ruled line, once, with a return');
  assert.equal(answer.bots, bots);
  assert.deepEqual(answer.cleared, { bot: BOT, session: 'daily', harness: 'codex', was: 'sess-daily', now: 'sess-new' });
  assert.equal((await sessionIn(bots, BOT, 'daily')).session, 'sess-new', 'the book holds the new conversation');
  const now = Object.fromEntries(Object.entries(await typedEverywhere(box)).filter(([handle]) => handle !== tab.handle));
  assert.deepEqual(now, others, 'no other tab had anything typed into it');
  await assertSentOnlyInto(box, tab.handle, from, 'clear on Codex');
});

test('clear on Codex when no "Where should the new conversation run?" comes up: /new, its return, and the ruled line', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box, { harness: 'codex' });
  await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: [CODEX_NEW_TYPED, CODEX_IDLE] });

  const { result, played } = await runPlaying(box, bots, 'clear', {
    when: (sends) => sends.some((one) => one.text === RECORD_LINE),
    then: () => hookReports(box, bots, 'sess-new', 'startup'),
  });

  const answer = answered(result, 'the clear');
  assert.ok(played, 'the premise: the hook reported the new conversation');
  assert.deepEqual(await sendsInto(box, bots), [
    { text: '/new', enter: false },
    { text: '\r', enter: false },
    { text: RECORD_LINE, enter: true },
  ]);
  assert.deepEqual(answer.cleared, { bot: BOT, session: 'daily', harness: 'codex', was: 'sess-daily', now: 'sess-new' });
});

test('Codex\'s "Where should the new conversation run?" with its pointer on "2. New worktree": Esc, a refusal, and never a 2, a return or the line', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box, { harness: 'codex' });
  await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: [CODEX_NEW_TYPED, CODEX_NEW_MENU_ON_TWO, CODEX_IDLE] });

  assertRefused(await sessionCommand(box, 'clear'));

  assert.deepEqual(await sendsInto(box, bots), [
    { text: '/new', enter: false },
    { text: '\r', enter: false },
    { text: '\x1b', enter: false },
  ], 'the menu is backed out of with Esc, and nothing picks a worktree');
});

test('no slash menu under Codex\'s input line: /new taken back with four backspaces in one send, nothing entered', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box, { harness: 'codex' });
  await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: [CODEX_NEW_NO_MENU, CODEX_IDLE] });

  assertRefused(await sessionCommand(box, 'clear'));

  assert.deepEqual(await sendsInto(box, bots), [{ text: '/new', enter: false }, { text: backspaces('/new'), enter: false }]);
});

// ---------------------------------------------------------------- compact

for (const harness of ['claude', 'codex']) {
  test(`compact on ${harness}: /compact typed alone, read on screen, a return of its own, and a compaction on the harness's record is confirmed`, async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box, { harness });
    const tab = await liveTab(box, bots);
    await changeTab(box, tab.tabId, { nextScreens: [harness === 'codex' ? CODEX_COMPACT_TYPED : CLAUDE_COMPACT_TYPED, harness === 'codex' ? CODEX_IDLE : CLAUDE_IDLE] });
    const record = await conversationOnRecord(box, { harness, cwd: botHomeOf(bots, BOT), id: 'sess-daily' });
    const book = await sessionIn(bots, BOT, 'daily');
    const from = (await box.orca.calls()).length;

    // The harness writes its compaction into the conversation's record once
    // the return has gone in.
    const { result, played } = await runPlaying(box, bots, 'compact', {
      when: (sends) => sends.some((one) => one.text === '\r'),
      then: () => compactionIn(record, harness),
    });

    const answer = answered(result, 'the compact');
    assert.ok(played, 'the premise: the return was sent and the compaction written');
    assert.deepEqual(await sendsInto(box, bots), [{ text: COMPACT, enter: false }, { text: '\r', enter: false }]);
    assert.equal(answer.bots, bots);
    assert.deepEqual(answer.compacted, { bot: BOT, session: 'daily', harness, conversation: 'sess-daily', confirmed: true });
    assert.deepEqual(await sessionIn(bots, BOT, 'daily'), book, 'a compact leaves the book as it was');
    await assertSentOnlyInto(box, tab.handle, from, `compact on ${harness}`);
  });
}

test('compact on a harness whose slash menu does not offer /compact: taken back with eight backspaces, nothing entered, and it says the harness cannot compact', async (t) => {
  const box = await createSandbox(t);
  const bots = await running(box, { harness: 'codex' });
  await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: [CODEX_COMPACT_NOT_OFFERED, CODEX_IDLE] });

  const said = assertRefused(await sessionCommand(box, 'compact'));

  assert.deepEqual(await sendsInto(box, bots), [{ text: COMPACT, enter: false }, { text: backspaces(COMPACT), enter: false }]);
  assert.match(said, /can(?:not|'t|’t) compact/i, `it says this harness cannot compact, got:\n${said}`);
});

// ---------------------------------------------------- the waits that run out
//
// Each of these costs its whole wait in real time, so they run side by side.

describe('the waits that run out, side by side', { concurrency: true }, () => {
  it('a session Orca reports busy for the whole 30 s: refused after waiting about that long, saying it is busy, and nothing typed', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    await box.orca.set({ waitIdle: 'busy' });
    const before = await typedEverywhere(box);

    const started = Date.now();
    const result = await sessionCommand(box, 'clear');
    const took = Date.now() - started;

    const said = assertRefused(result);
    assert.match(said, /busy/i, `it says the session is busy, got:\n${said}`);
    await assertNothingTyped(box, before, 'busy throughout');
    assert.ok(took >= 25_000, `it waited for the session, up to 30 s, before refusing; it took ${took} ms`);
    assert.ok(took < 90_000, `and the wait is bounded; it took ${took} ms`);
    assert.equal((await sessionIn(bots, BOT, 'daily')).session, 'sess-daily', 'the book is as it was');
  });

  it('a Codex Orca calls idle while its screen says "esc to interrupt": refused as busy, nothing typed', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box, { harness: 'codex' });
    await changeTab(box, (await liveTab(box, bots)).tabId, { screen: CODEX_WORKING });
    const before = await typedEverywhere(box);

    const said = assertRefused(await sessionCommand(box, 'clear'));

    assert.match(said, /busy/i, `it says the session is busy, got:\n${said}`);
    await assertNothingTyped(box, before, 'esc to interrupt on screen');
  });

  it('a Claude Code tab Orca calls idle while its screen says "Esc to interrupt", in another case: compact refused as busy, nothing typed', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { screen: CLAUDE_WORKING });
    const before = await typedEverywhere(box);

    const said = assertRefused(await sessionCommand(box, 'compact'));

    assert.match(said, /busy/i, `it says the session is busy, got:\n${said}`);
    await assertNothingTyped(box, before, 'Esc to interrupt on screen');
  });

  it('a question of the harness\'s own on screen for the whole 30 s, Orca calling it idle: refused, saying a question is up, nothing typed', async (t) => {
    // Codex's update offer, whose default is "Update now" (#329).
    const box = await createSandbox(t);
    const bots = await running(box, { harness: 'codex' });
    await changeTab(box, (await liveTab(box, bots)).tabId, { screen: CODEX_UPDATE_OFFER });
    const before = await typedEverywhere(box);

    const said = assertRefused(await sessionCommand(box, 'clear'));

    assert.match(said, /question/i, `it says a question is waiting, got:\n${said}`);
    await assertNothingTyped(box, before, 'a question on screen');
  });

  it('a tab Orca reports blocked for the whole 30 s: refused, nothing typed', async (t) => {
    const box = await createSandbox(t);
    await running(box);
    await box.orca.set({ waitIdle: 'blocked', blockedReason: 'agent-permission-prompt' });
    const before = await typedEverywhere(box);

    const said = assertRefused(await sessionCommand(box, 'clear'));

    assert.ok(/question/i.test(said) || said.includes('agent-permission-prompt'), `it says something is waiting to be answered, got:\n${said}`);
    await assertNothingTyped(box, before, 'blocked');
  });

  it('a clear entered whose new conversation never reaches the book in 30 s: refused, saying /clear went in and to look at the tab', async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box);
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: [CLAUDE_CLEAR_TYPED, CLAUDE_IDLE] });

    const said = assertRefused(await sessionCommand(box, 'clear'));

    assert.deepEqual(await sendsInto(box, bots), [{ text: '/clear', enter: false }, { text: '\r', enter: false }], 'the premise: the command was entered');
    assert.ok(said.includes('/clear'), `it says what was entered, got:\n${said}`);
    assert.match(said, /\bconversation\b/i, `it says the book has no new conversation, got:\n${said}`);
    assert.match(said, /\btab\b/i, `and to look at the tab, got:\n${said}`);
    assert.equal((await sessionIn(bots, BOT, 'daily')).session, 'sess-daily', 'the book is as it was');
  });
});
