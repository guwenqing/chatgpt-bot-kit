// `obk temp answer --bots <path> --name <session>`: a maker answers a first-run
// screen of a temporary session it made (#489). Claude Code's auto mode refuses
// a maker's raw `orca terminal send`, so a new Claude session sat on "Teach auto
// mode about your environment?" until a person answered it. As with `obk temp
// trust-hooks` (#238), the kit has one command for the answer, which one narrow
// permission rule can allow. For now it answers that one form, with Esc ("Not
// now", which teaches nothing), and never with a return: Enter on the form is
// Continue, which starts a scan (#416).
//
// What is held here, by the numbers of the requirement in the brief:
//
//   1. It is run by the session's maker in the maker's own tab, found as
//      `temp trust-hooks` and `temp retire` find it. It refuses a call from
//      outside a fleet tab, a name the bot has no session of, a long-lived
//      session, and a temporary session another session made. Both --bots and
//      --name are required.
//   2. It refuses when the session has no tab open in Orca, or its screen
//      cannot be read.
//   3. It sends Esc only when the screen holds the Teach form matched exactly
//      against the captured CLAUDE_TEACH_FORM, by `onlyTeachFormOf`'s rule
//      (helpers/screens.js): every non-blank row from the title down is one of
//      the captured form's rows, the pointer ❯ on exactly one of them,
//      whichever; nothing missing, nothing added. Anything else is refused: no
//      key into any tab, and it prints what the screen shows. For Codex's hooks
//      review, the refusal points to `temp trust-hooks`.
//   4. The typing turn: typing-turn-temp-answer.test.js.
//   5. After the key it reads the screen again; if the form's title row is
//      still there after a few seconds, it fails and says so.
//   6. On success it says which session, that it sent Esc (Not now) to the
//      Teach auto mode form, and that the form has gone. `--json` has at least
//      bot, session and maker.
//   7. Its output and SETUP.md section 5 name the one rule a maker's bot needs:
//      `Bash(<kit> temp answer:*)`, <kit> the running kit's CLI path.
//   8. `obk --help` lists `obk temp answer --bots <path> --name <session>`.
//
// Every run is in the sandbox (helpers/cli.js): the fake Orca shows each tab
// the screen a test gives it, and moves it on at the next key when told to
// (`screenAfterSend`, `nextScreens`).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it as test } from 'node:test';

import {
  createSandbox,
  kitLaunchMark,
  repoRoot,
  sentInto,
  sessionIn,
  spellingsOf,
} from './helpers/cli.js';
import {
  CLAUDE_ANSWERED,
  CLAUDE_IDLE,
  CLAUDE_TEACH_AUTO,
  CLAUDE_TEACH_FORM,
  CLAUDE_TEACH_FORM_ON_CONTINUE,
  CLAUDE_TRUST,
  CODEX_HOOKS_REVIEW,
  FORM_IN_HISTORY,
} from './helpers/screens.js';

const BOT = 'temp-bot';
const TASK = 'Read the open pull request and write down what it changes.';

/** Esc, alone: "Not now" on the Teach form. Never a return, which is Continue. */
const ESC = '\x1b';

/** The form's title row, as captured. */
const TITLE = 'Teach auto mode about your environment?';

/** The environment of a command a session's harness runs in `terminal`. */
const inTab = (box, terminal) => ({ ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId, ...kitLaunchMark(box, terminal) });

/** The terminal Orca has for a session of the bot, by the book's tab. */
async function tabOf(box, bots, name) {
  const tab = (await sessionIn(bots, BOT, name))?.tab;
  const found = (await box.orca.terminals()).find((one) => one.tabId === tab);
  assert.ok(found, `Orca should have ${BOT}/${name}'s tab ${tab}`);
  return found;
}

/**
 * A bots folder with temp-bot on Claude Code, its long-lived sessions planner
 * and nightly brought up, and two temporary sessions planner made: drafter on
 * Claude Code and scout on Codex.
 */
async function fleet(box) {
  const ok = async (args, env) => {
    const result = await box.run(args, env === undefined ? {} : { env });
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  };
  await ok(['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
  for (const name of ['planner', 'nightly']) await ok(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', name]);
  await ok(['up', '--bots', 'bots', '--bot', BOT]);
  const bots = box.path('bots');
  const planner = await tabOf(box, bots, 'planner');
  await ok(['temp', 'make', '--bots', 'bots', '--name', 'drafter', '--prompt', TASK], inTab(box, planner));
  await ok(['temp', 'make', '--bots', 'bots', '--name', 'scout', '--harness', 'codex', '--prompt', TASK], inTab(box, planner));
  return { bots, planner, nightly: await tabOf(box, bots, 'nightly') };
}

/** Give one session's tab a screen of its own, and what it moves on to at the next key, if anything. */
async function showIn(box, bots, name, shown) {
  const tab = (await sessionIn(bots, BOT, name)).tab;
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.tabId === tab ? { ...terminal, ...shown } : terminal)),
  });
}

/** The captured form, which goes at the next key, as Claude Code's does on Esc. */
const FORM_THAT_GOES = { screen: CLAUDE_TEACH_FORM, screenAfterSend: CLAUDE_ANSWERED };

/** Every `terminal send` so far into every tab, by tab id. */
async function sendsByTab(box) {
  return Object.fromEntries((await box.orca.terminals()).map((terminal) => [terminal.tabId, sentInto(terminal)]));
}

/** What was sent since `before`, by tab id, for the tabs that got anything. */
async function sentSince(box, before) {
  const sent = {};
  for (const [tab, sends] of Object.entries(await sendsByTab(box))) {
    const since = sends.slice((before[tab] ?? []).length);
    if (since.length > 0) sent[tab] = since;
  }
  return sent;
}

/** `obk temp answer --bots bots --name <name>`, run in `terminal`, or outside any tab when it is null. */
const answer = (box, terminal, name, extra = []) => box.run(
  ['temp', 'answer', '--bots', 'bots', '--name', name, ...extra],
  terminal === null ? {} : { env: inTab(box, terminal) },
);

/** A refusal: a non-zero exit, something said, no crash, and nothing typed into any tab. */
async function assertRefusedUntyped(box, result, before, what) {
  const said = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.code, 0, `${what} should be refused, got:\n${said}`);
  assert.notEqual(said.trim(), '', `${what}: a refusal says why`);
  assert.ok(!/^\s+at /m.test(said), `${what}: a message, not a crash:\n${said}`);
  assert.deepEqual(await sentSince(box, before), {}, `${what}: nothing is typed into any tab`);
  return said;
}

/**
 * The keys the command sent into one tab, all together, and each send made
 * with no `--enter`: a return of any kind would be Continue.
 */
function keysSent(sent, tab) {
  const sends = sent[tab] ?? [];
  assert.ok(sends.length > 0, `keys should have been sent into the session's tab, got: ${JSON.stringify(sent)}`);
  assert.ok(sends.every((one) => one.enter === false), `with no --enter: ${JSON.stringify(sends)}`);
  return sends.map((one) => one.text).join('');
}

/** The answer went: exit 0, and Esc alone into drafter's tab and no other. */
async function assertEscInto(box, result, before, tab, what) {
  assert.equal(result.code, 0, `${what}: it answers the form:\n${result.stdout}${result.stderr}`);
  const sent = await sentSince(box, before);
  assert.deepEqual(Object.keys(sent), [tab], `${what}: keys go into the session's tab and no other: ${JSON.stringify(sent)}`);
  assert.equal(keysSent(sent, tab), ESC, `${what}: Esc alone, never a return`);
}

/** The captured form with each row `change` gives back. */
const changed = (change) => CLAUDE_TEACH_FORM.map(change);

/** The form's own rows, from its title down, as captured. */
const formRows = CLAUDE_TEACH_FORM.slice(CLAUDE_TEACH_FORM.findIndex((row) => row.trim() === TITLE));

/** How many of the tests below run at once: each brings up a fleet of its own in its own sandbox. */
const AT_ONCE = { concurrency: 8 };

describe('obk temp answer', AT_ONCE, () => {
  // ------------------------------------------------------------ 1. who may ask

  test('TA1 a name the bot has no session of is refused, names it, and nothing is typed', async (t) => {
    const box = await createSandbox(t);
    const { planner } = await fleet(box);
    const before = await sendsByTab(box);

    const said = await assertRefusedUntyped(box, await answer(box, planner, 'nobody'), before, 'a name the bot has no session of');
    assert.ok(said.includes('nobody'), `it names what was asked for: ${said}`);
  });

  test('TA1 a long-lived session is refused, even with the captured form on its screen, and nothing is typed', async (t) => {
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box);
    await showIn(box, bots, 'nightly', FORM_THAT_GOES);
    const before = await sendsByTab(box);

    const said = await assertRefusedUntyped(box, await answer(box, planner, 'nightly'), before, 'a long-lived session');
    assert.match(said, /long-lived/i, `it says the session is long-lived: ${said}`);
  });

  test('TA1 a temporary session another session made is refused, and nothing is typed; from its maker\'s tab the same ask is answered', async (t) => {
    const box = await createSandbox(t);
    const { bots, planner, nightly } = await fleet(box);
    await showIn(box, bots, 'drafter', FORM_THAT_GOES);
    const drafter = (await sessionIn(bots, BOT, 'drafter')).tab;
    const before = await sendsByTab(box);

    const said = await assertRefusedUntyped(box, await answer(box, nightly, 'drafter'), before, 'a session another session made');
    assert.ok(said.includes('planner'), `it names the maker, whose it is: ${said}`);

    await assertEscInto(box, await answer(box, planner, 'drafter'), before, drafter, 'from its maker\'s tab');
  });

  test('TA1 run outside any tab it is refused, and nothing is typed', async (t) => {
    const box = await createSandbox(t);
    const { bots } = await fleet(box);
    await showIn(box, bots, 'drafter', FORM_THAT_GOES);
    const before = await sendsByTab(box);

    const said = await assertRefusedUntyped(box, await answer(box, null, 'drafter'), before, 'a call from outside any tab');
    assert.match(said, /\btab\b/i, `it says it is run in a session's own tab, as temp retire says: ${said}`);
  });

  for (const [flag, args] of [
    ['--name', ['temp', 'answer', '--bots', 'bots']],
    ['--bots', ['temp', 'answer', '--name', 'drafter']],
  ]) {
    test(`TA1 without ${flag} it is refused, names ${flag}, and nothing is typed`, async (t) => {
      const box = await createSandbox(t);
      const { bots, planner } = await fleet(box);
      await showIn(box, bots, 'drafter', FORM_THAT_GOES);
      const before = await sendsByTab(box);

      const result = await box.run(args, { env: inTab(box, planner) });

      const said = await assertRefusedUntyped(box, result, before, `a call without ${flag}`);
      assert.ok(said.includes(flag), `it names the flag it needs: ${said}`);
    });
  }

  test('TA1 a temporary maker answers the form of a temporary session it made itself', async (t) => {
    // A temporary session may make one of its own (ADR 0033); it is that one's
    // maker, as temp trust-hooks takes it (temp-nested.test.js N4).
    const box = await createSandbox(t);
    const { bots } = await fleet(box);
    const drafter = await tabOf(box, bots, 'drafter');
    const made = await box.run(['temp', 'make', '--bots', 'bots', '--name', 'helper', '--prompt', TASK], { env: inTab(box, drafter) });
    assert.equal(made.code, 0, `drafter makes helper:\n${made.stdout}${made.stderr}`);
    await showIn(box, bots, 'helper', FORM_THAT_GOES);
    const helper = (await sessionIn(bots, BOT, 'helper')).tab;
    const before = await sendsByTab(box);

    await assertEscInto(box, await answer(box, drafter, 'helper'), before, helper, 'drafter answers its helper');
  });

  // ------------------------------------------------------------ 2. a tab and a screen to read

  test('TA2 a session with no tab open in Orca is refused, says so, and nothing is typed', async (t) => {
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box);
    const drafter = (await sessionIn(bots, BOT, 'drafter')).tab;
    await box.orca.set({ terminals: (await box.orca.terminals()).filter((terminal) => terminal.tabId !== drafter) });
    const before = await sendsByTab(box);

    const said = await assertRefusedUntyped(box, await answer(box, planner, 'drafter'), before, 'a session with no tab');
    assert.match(said, /\btab\b/i, `it says there is no tab: ${said}`);
  });

  for (const [label, change] of [
    ['Orca refuses to read it', { fail: { 'terminal read': { code: 'runtime_error', message: 'the renderer did not answer' } } }],
    ['Orca answers with no rendered screen', null],
  ]) {
    test(`TA2 a session whose screen cannot be read (${label}) is refused, says so, and nothing is typed`, async (t) => {
      const box = await createSandbox(t);
      const { bots, planner } = await fleet(box);
      if (change === null) await showIn(box, bots, 'drafter', { ...FORM_THAT_GOES, screenSource: 'screen-unavailable' });
      else {
        await showIn(box, bots, 'drafter', FORM_THAT_GOES);
        await box.orca.set(change);
      }
      const before = await sendsByTab(box);

      const said = await assertRefusedUntyped(box, await answer(box, planner, 'drafter'), before, label);
      assert.match(said, /could not|cannot|can't|unreadable|not be read/i, `it says the screen could not be read: ${said}`);
    });
  }

  // ------------------------------------------------------------ 3. the captured form, and nothing else

  for (const [label, screen] of [
    ['the captured form, the pointer on "Also scan shell history"', CLAUDE_TEACH_FORM],
    ['the captured form with its pointer on Continue, the row a return would take', CLAUDE_TEACH_FORM_ON_CONTINUE],
    ['the captured form with its pointer on "Also scan your other repos"', changed((row) => {
      if (row.includes('❯ Also scan shell history')) return row.replace('❯', ' ');
      if (row.includes('Also scan your other repos')) return row.replace('  Also', '❯ Also');
      return row;
    })],
    ['the form\'s own rows alone, other history gone, a blank row below', [...formRows, '']],
  ]) {
    test(`TA3 ${label}: Esc alone, into the session's tab alone`, async (t) => {
      const box = await createSandbox(t);
      const { bots, planner } = await fleet(box);
      await showIn(box, bots, 'drafter', { screen, screenAfterSend: CLAUDE_ANSWERED });
      const drafter = (await sessionIn(bots, BOT, 'drafter')).tab;
      const before = await sendsByTab(box);

      await assertEscInto(box, await answer(box, planner, 'drafter'), before, drafter, label);
    });
  }

  // Each screen that is not the captured form, with a row of it the refusal has
  // to print: what the screen shows.
  for (const [label, screen, row] of [
    ['the form with a row more', [...CLAUDE_TEACH_FORM.slice(0, -1), '     Also scan your home folder  false', CLAUDE_TEACH_FORM.at(-1)], /Also scan your home folder/],
    ['the form with a row less', CLAUDE_TEACH_FORM.filter((one) => !one.includes('Also scan your other repos')), /Teach auto mode about your environment\?/],
    ['the form with a value changed, false to true', changed((one) => (one.includes('Also scan your other repos') ? one.replace('false', 'true') : one)), /Also scan your other repos\s+true/],
    ['the form with one of its rows shown twice', [...CLAUDE_TEACH_FORM.slice(0, -1), '     Continue', CLAUDE_TEACH_FORM.at(-1)], /Teach auto mode about your environment\?/],
    ['the form with two pointers', changed((one) => (one === '     Continue' ? '   ❯ Continue' : one)), /❯ Continue/],
    ['the form with no pointer', changed((one) => one.replace('❯', ' ')), /Also scan shell history\s+true/],
    ['the form quoted in history, the input line below it', FORM_IN_HISTORY, /Enter on it is Continue, which starts the scan\./],
    ['Claude Code idle at its input line', CLAUDE_IDLE, /Try "fix typecheck errors"/],
    ['Claude Code\'s folder trust', CLAUDE_TRUST, /Yes, I trust this folder/],
    ['the older numbered teach list', CLAUDE_TEACH_AUTO, /2\. Not now/],
  ]) {
    test(`TA3 ${label} is refused, says what the screen shows, and nothing is typed`, async (t) => {
      const box = await createSandbox(t);
      const { bots, planner } = await fleet(box);
      await showIn(box, bots, 'drafter', { screen, screenAfterSend: CLAUDE_ANSWERED });
      const before = await sendsByTab(box);

      const said = await assertRefusedUntyped(box, await answer(box, planner, 'drafter'), before, label);
      assert.match(said, row, `it prints what the screen shows, this row among it: ${said}`);
    });
  }

  test('TA3 a Codex session on its hooks review is refused, nothing is typed, and the refusal points to temp trust-hooks', async (t) => {
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box);
    await showIn(box, bots, 'scout', { screen: CODEX_HOOKS_REVIEW });
    const before = await sendsByTab(box);

    const said = await assertRefusedUntyped(box, await answer(box, planner, 'scout'), before, 'Codex\'s hooks review');
    assert.match(said, /Hooks need review/, `it says what the screen shows: ${said}`);
    assert.match(said, /temp trust-hooks/, `it points to temp trust-hooks: ${said}`);
  });

  // ------------------------------------------------------------ 5. the form gone

  test('TA5 a form still on screen a few seconds after Esc is a failure, and it says so', async (t) => {
    // The key went in and Claude Code did not move on: every read after it
    // still shows the form.
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box);
    await showIn(box, bots, 'drafter', { screen: CLAUDE_TEACH_FORM });
    const drafter = (await sessionIn(bots, BOT, 'drafter')).tab;
    const before = await sendsByTab(box);

    const result = await answer(box, planner, 'drafter');

    const said = `${result.stdout}${result.stderr}`;
    assert.notEqual(result.code, 0, `the form did not go, so it did not work:\n${said}`);
    assert.ok(!/^\s+at /m.test(said), `a message, not a crash:\n${said}`);
    assert.equal(keysSent(await sentSince(box, before), drafter), ESC, 'Esc was sent, and nothing more');
    assert.match(said, /still/i, `it says the form is still there: ${said}`);
    assert.ok(said.includes(TITLE), `naming it: ${said}`);
  });

  test('TA5 a form that takes a moment to go after Esc is answered', async (t) => {
    // The first two reads after the key still show the form, as a screen that
    // redraws late would; every read after them shows the answered turn.
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box);
    await showIn(box, bots, 'drafter', { screen: CLAUDE_TEACH_FORM, nextScreens: [{ screen: CLAUDE_TEACH_FORM, then: CLAUDE_ANSWERED, reads: 2 }] });
    const drafter = (await sessionIn(bots, BOT, 'drafter')).tab;
    const before = await sendsByTab(box);

    await assertEscInto(box, await answer(box, planner, 'drafter'), before, drafter, 'a form that goes late');
  });

  // ------------------------------------------------------------ 6, 7. what it says

  test('TA6 TA7 on success it says which session, that it sent Esc (Not now) to the Teach auto mode form, that the form has gone, and the rule a maker needs', async (t) => {
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box);
    await showIn(box, bots, 'drafter', FORM_THAT_GOES);

    const result = await answer(box, planner, 'drafter');

    assert.equal(result.code, 0, `it answers the form:\n${result.stdout}${result.stderr}`);
    const said = result.stdout;
    assert.ok(said.includes('drafter'), `it says which session: ${said}`);
    assert.match(said, /\bEsc\b/, `that it sent Esc: ${said}`);
    assert.match(said, /Not now/, `which is Not now: ${said}`);
    assert.match(said, /Teach auto mode/, `to the Teach auto mode form: ${said}`);
    assert.match(said, /\bgone\b|\bclosed\b|no longer/i, `and that the form has gone: ${said}`);
    const rules = spellingsOf(box.cli).map((kit) => `Bash(${kit} temp answer:*)`);
    assert.ok(rules.some((rule) => said.includes(rule)), `it names the one rule a maker's bot needs, one of ${JSON.stringify(rules)}: ${said}`);
  });

  test('TA6 --json answers with the bot, the session and its maker', async (t) => {
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box);
    await showIn(box, bots, 'drafter', FORM_THAT_GOES);

    const result = await answer(box, planner, 'drafter', ['--json']);

    assert.equal(result.code, 0, `it answers the form:\n${result.stdout}${result.stderr}`);
    let answered;
    try {
      answered = JSON.parse(result.stdout);
    } catch {
      assert.fail(`--json should print JSON, got: ${result.stdout}`);
    }
    assert.deepEqual(
      { bot: answered.bot, session: answered.session, maker: answered.maker },
      { bot: BOT, session: 'drafter', maker: 'planner' },
      `the answer names them: ${result.stdout}`,
    );
  });

  test('TA7 SETUP.md section 5 names temp answer and the rule a maker\'s bot needs for it', async () => {
    const setup = await readFile(path.join(repoRoot, 'SETUP.md'), 'utf8');
    const start = setup.indexOf('\n## 5.');
    assert.ok(start >= 0, 'SETUP.md has a section 5');
    const end = setup.indexOf('\n## ', start + 1);
    const section = setup.slice(start, end < 0 ? undefined : end);
    assert.match(section, /temp answer/, 'section 5 names temp answer');
    assert.match(section, /Bash\([^)\n]* temp answer:\*\)/, 'section 5 names the rule, Bash(<kit> temp answer:*)');
  });

  // ------------------------------------------------------------ 8. the usage

  test('TA8 obk --help lists obk temp answer --bots <path> --name <session>', async (t) => {
    const box = await createSandbox(t);

    const result = await box.run(['--help']);

    assert.equal(result.code, 0);
    assert.ok(result.stdout.includes('obk temp answer --bots <path> --name <session>'), `usage lists temp answer: ${result.stdout}`);
  });
});
