// A system test: `obk session clear` and `obk session compact` against the real
// harnesses in the real Orca on this machine (#391). Run it alone with
// `npm run test:system -- --yes test/system/session-clear.test.js`;
// `npm test` cannot, and no CI machine could.
//
// It is the live done check of #391, on Claude Code and on Codex:
//
//   1. On a busy session, `obk session clear` waits and then refuses, and types
//      nothing: the session's conversation in the book is the same, and its
//      record holds no clear.
//   2. On an idle session, `obk session clear` gives a new conversation in the
//      book, and the kit's hook briefed it: asked for a word only its start
//      prompt holds, the new conversation answers it.
//   3. A line added to the bot's AGENTS.md before the clear is read by the new
//      conversation. On Codex that is the architect's condition for the rules
//      stamp (the ruling on #391): the new rollout's "AGENTS.md instructions"
//      message holds the line. Then `obk health` says the session's rules are
//      current, where before the clear it said older and offered the clear.
//   4. `obk session compact` compacts, or says this harness cannot. A compact
//      the harness's record does not show within the kit's 5 minutes is
//      answered `confirmed: false`, not a failure (the architect's ruling on
//      #391); this run reports it when it happens, which is the only check of
//      that case: the unit suite does not wait the 5 minutes.
//
// A cleared session is not promised to be idle afterwards (a Codex one may
// run its start routine). This test waits for it to be idle only so that it
// can type its own question safely, and checks nothing about it.
//
// Every word the session is asked for is one the question does not carry, so
// a wait cannot be satisfied by the question itself. Each answer is read from
// the new conversation's own record, not from the screen, since the screen
// shows the old conversation's start prompt until the clear redraws it.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the others beside it:
//
//   - works in a throwaway bots folder under the system temp directory;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - touches only what it created, matched by handle and by workspace path;
//   - types only into its own bot's tab: the question, the busy turn, and
//     nothing else;
//   - closes its own tabs one by one (`--terminal <handle> --tab`) and then
//     deletes its own workspaces, whatever happened, and checks afterwards that
//     it closed no tab it did not create.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// below refuses to run it at all.
//
// One thing it cannot clean up, as messaging.test.js says of itself: the Run
// mailboxes `up` makes. Orca has no `run-delete`.
//
// **It is attended, a little.** A bot folder nobody has opened before asks
// questions before the harness is running in it (PRD 6.5). This test answers
// one of them itself, Claude Code's folder trust, in its own throwaway Claude
// bot's tab alone, by the architect's ruling on #391 (folder trust, option
// (c)), the same exception send-outside-fleet.test.js has under #451: it
// answers only when every row from "Accessing workspace:" down is a row of the
// captured plain screen with the tab's own throwaway folder in the folder's
// place, the pointer is on "No, exit", "Yes, I trust this folder" is there,
// and no line pre-approves a permission (helpers/screens.js
// `onlyPlainTrustOf`). Then down and return, once, with no `--enter`. Any
// other screen gets no answer, and the test fails printing every row it saw.
// The Codex session is given its folder's trust at launch (#240,
// test/helpers/codex-trust.js), so Codex asks neither its folder trust nor its
// hooks review; it may still offer an update, which is the person's. Bot
// Father's tab shows the same folder trust, which nothing here waits on, and it
// can be left. After a turn Claude Code may offer "Teach auto mode about your
// environment?", where Esc cancels it (#416); that too is the person's. Every
// wait says what the tab is showing when it runs out of patience, so a run left
// alone names the screen that stopped it.
//
// It takes several minutes: two real harnesses, a busy turn of 45 s on each, a
// clear, a question and a compact.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry } from '../helpers/cli.js';
import { codexTrustArgs } from '../helpers/codex-trust.js';
import { onlyPlainTrustOf, waitingOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** How long a tab is given to be ready: a first run has screens on it and a person answering them. */
const READY_MS = 180000;

/** How long a session is given to answer one question. */
const ANSWER_MS = 120000;

/** How long the busy turn runs: longer than the kit's 30 s wait for an idle session. */
const BUSY_SECONDS = 45;

/** How long a session is given to start its busy turn before the clear is asked for. */
const BUSY_START_MS = 60000;

/** How long the tab is given to take a key in before the return that goes after it. */
const KEY_GAP_MS = 1000;

const guard = tabGuard(ORCA);
const { orca } = guard;

/** Every terminal Orca knows about right now. */
function allTerminals() {
  const answer = orca(['terminal', 'list']);
  assert.equal(answer.ok, true, `orca terminal list failed: ${JSON.stringify(answer.error)}`);
  return answer.result.terminals;
}

/** The terminals in one workspace, by the path they were opened in. */
const terminalsAt = (home) => allTerminals().filter((terminal) => terminal.worktreePath === home);

/** The tabs Orca lists at `home` once it has caught up with what was closed (#187). */
async function terminalsAfterClosing(home, closed, within = 5000) {
  const until = Date.now() + within;
  let left = terminalsAt(home);
  while (left.some((terminal) => closed.includes(terminal.handle)) && Date.now() < until) {
    await setTimeout(250);
    left = terminalsAt(home);
  }
  return left;
}

/** Every workspace Orca knows about right now. */
function allSetups() {
  const answer = orca(['project', 'setups']);
  assert.equal(answer.ok, true, `orca project setups failed: ${JSON.stringify(answer.error)}`);
  return answer.result.setups;
}

/**
 * Remove the throwaway bots folder and everything the kit made beside it:
 * `<bots>.prompts` is a sibling of the bots folder and not a child of it.
 */
async function removeBotsFolderAndSiblings(bots) {
  const parent = path.dirname(bots);
  const mine = path.basename(bots);
  const ours = async () => (await readdir(parent)).filter((name) => name === mine || name.startsWith(`${mine}.`));
  for (const name of await ours()) {
    await rm(path.join(parent, name), { recursive: true, force: true });
  }
  assert.deepEqual(await ours(), [], `this test left folders behind in ${parent}`);
}

/**
 * Run this checkout's `obk`, by its full path. The `obk` on PATH is the
 * published release this machine uses, not the code under test (#217).
 */
function obk(args) {
  const done = spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}`);
  assert.ok(!/worktree/i.test(done.stdout + done.stderr), `obk said "worktree": ${done.stdout}${done.stderr}`);
  return done;
}

/** Run `obk ... --json`, which has to go through, and read its answer. */
function obkJson(args) {
  const done = obk([...args, '--json']);
  assert.equal(done.status, 0, `obk ${args.join(' ')} failed: ${done.stdout}${done.stderr}`);
  try {
    return guard.openedByKit(JSON.parse(done.stdout));
  } catch {
    assert.fail(`obk ${args.join(' ')} --json did not print JSON: ${done.stdout}`);
  }
}

/** The entry for one tab in an `obk --json` answer. */
function tabOf(answer, name) {
  const found = (answer.tabs ?? []).filter((entry) => entry.name === name);
  assert.equal(found.length, 1, `one entry should be the ${name} tab, got: ${JSON.stringify(answer.tabs)}`);
  return found[0];
}

/** What a bot's book says about one session now. */
const sessionIn = (home, name) => (parse(readFileSync(path.join(home, 'sessions.yaml'), 'utf8')) ?? {}).sessions?.[name] ?? {};

/** Keep asking until `look` gives something other than undefined, or the time runs out. */
async function until(what, within, look, note = () => '') {
  const stop = Date.now() + within;
  for (;;) {
    const found = await look();
    if (found !== undefined) return found;
    assert.ok(Date.now() < stop, `gave up waiting for ${what} after ${within}ms.${note()}`);
    await setTimeout(1000);
  }
}

/** The rows the tab renders now, or undefined when Orca will not say. */
function rowsOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  const tail = answer.ok === true && answer.result?.terminal?.source === 'screen' ? answer.result.terminal.tail : undefined;
  return Array.isArray(tail) ? tail : undefined;
}

/** What the tab is showing, for the message of a wait that ran out. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return [
    blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`,
    ' This test answers nothing a tab asks; answer it in Orca and run again.',
    `\n  orca terminal read --terminal ${handle} --screen\n    ${(rowsOf(handle) ?? ['(unreadable)']).join('\n    ')}`,
  ].join('');
}

/** A harness at work says how to interrupt it, on either harness. */
const isBusy = (rows) => rows.some((row) => /esc to interrupt/i.test(row));

/** Wait until the tab is idle: a TUI up, nothing of its own waiting, and not at work. */
async function idle(handle, within = READY_MS) {
  await until(
    `${handle} to be idle`,
    within,
    async () => {
      const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '5000']);
      if (answer.ok !== true || answer.result?.wait?.satisfied !== true) return undefined;
      if (waitingOn(orca, handle) !== undefined) return undefined;
      const rows = rowsOf(handle);
      return rows !== undefined && !isBusy(rows) ? true : undefined;
    },
    () => `${waitingOn(orca, handle) ?? ''}${whatIsUp(handle)}`,
  );
}

/**
 * Press keys in the test's own tab: `text`, then a return as a send of its own,
 * neither with `--enter` (Orca's gate can refuse a line with one; on Codex a
 * return inside the text lands in the draft).
 */
async function pressIn(handle, text) {
  for (const keys of [text, '\r']) {
    const sent = orca(['terminal', 'send', '--terminal', handle, '--text', keys]);
    assert.equal(sent.ok, true, `typing ${JSON.stringify(keys)} into ${handle} failed: ${JSON.stringify(sent.error)}.${whatIsUp(handle)}`);
    await setTimeout(KEY_GAP_MS);
  }
}

/** The lines of a JSONL record, each parsed, skipping a line still being written. */
function linesOf(file) {
  if (file === undefined || !existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').flatMap((line) => {
    try {
      return line.trim() === '' ? [] : [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

/** Where Claude Code keeps a conversation of the folder `home` (tech notes, section 2). */
const claudeRecord = (home, id) => path.join(os.homedir(), '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);

/** Where Codex keeps a conversation, found by its id (tech notes, section 3). */
function codexRecord(id) {
  const root = path.join(os.homedir(), '.codex', 'sessions');
  const name = readdirSync(root, { recursive: true }).find((one) => String(one).endsWith(`-${id}.jsonl`));
  return name === undefined ? undefined : path.join(root, String(name));
}

/** The harness's own record of conversation `id`, as its lines. */
const recordOf = (harness, home, id) => linesOf(harness === 'codex' ? codexRecord(id) : claudeRecord(home, id));

/** What the model said in a record, as one piece of text: never the user's turn or the hook's context. */
function modelSaid(harness, lines) {
  const said = harness === 'codex'
    ? lines.filter((line) => line.type === 'response_item' && line.payload?.role === 'assistant')
    : lines.filter((line) => line.type === 'assistant');
  return said.map((line) => JSON.stringify(harness === 'codex' ? line.payload.content : line.message?.content)).join('\n');
}

/** Whether a record holds a compaction (tech notes, sections 2 and 3). */
const compactionsIn = (harness, lines) => lines.filter((line) => (harness === 'codex'
  ? line.type === 'compacted'
  : line.type === 'system' && line.subtype === 'compact_boundary')).length;

/** `obk health` for the fleet, read whatever it exits with: findings exit non-zero. */
function health(bots) {
  const done = obk(['health', '--bots', bots, '--json']);
  try {
    return JSON.parse(done.stdout);
  } catch {
    assert.fail(`obk health --json did not print JSON: ${done.stdout}${done.stderr}`);
  }
}

/** One session's entry in `obk health`'s answer. */
function healthOf(answer, bot, session) {
  const found = (answer.sessions ?? []).filter((one) => one.bot === bot && one.session === session);
  assert.equal(found.length, 1, `one health entry for ${bot} ${session}, got: ${JSON.stringify(answer.sessions)}`);
  return found[0];
}

/** The two bots, one per harness, and the words each is checked with. */
const BOTS = [
  { harness: 'claude', name: 'clear-claude', word: 'OSPREY-4471', marker: 'HERON-2208' },
  { harness: 'codex', name: 'clear-codex', word: 'PLOVER-6093', marker: 'AVOCET-3517' },
];

/** The start prompt: the word lives here and nowhere else. */
const promptFor = (bot) => 'You are a system test\'s bot and you own nothing. Read or write no file and use no tool,'
  + ' except to run a shell command when a line in this tab asks for one by name. Your word is'
  + ` ${bot.word}. When asked for your word, reply with it and nothing else. Otherwise say nothing and wait.`;

for (const bot of BOTS) {
  test(`session clear and compact on ${bot.harness}: refused while busy, a briefed new conversation on the current rules when idle, and a compact or a "cannot"`, async (t) => {
    const before = {
      handles: new Set(allTerminals().map((terminal) => terminal.handle)),
      setups: new Set(allSetups().map((setup) => setup.id)),
    };

    const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), `obk-system-clear-${bot.harness}-`)));
    const homeOf = (name) => path.join(bots, 'bots', name);
    const home = homeOf(bot.name);
    const homes = [homeOf('bot-father'), home];

    // Registered before anything is created, so it runs however this test ends.
    t.after(async () => {
      const { closed, foreign } = guard.closeOwnAt(homes);
      const held = new Set(foreign.map((one) => one.home));
      let deleted = 0;
      for (const setup of allSetups()) {
        if (!homes.includes(setup.path) || before.setups.has(setup.id) || held.has(setup.path)) continue;
        orca(['project', 'setup-delete', '--setup', setup.id]);
        deleted += 1;
      }
      if (deleted > 0 && !(await reloadWindow())) t.diagnostic(RELOAD_LINE);
      assert.deepEqual(foreign, [], `tabs this test did not create are open at its homes, so it closed only its own and left those projects and ${bots} in place`);
      await removeBotsFolderAndSiblings(bots);

      const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
      assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
      if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
      for (const one of homes) {
        assert.deepEqual(await terminalsAfterClosing(one, closed), [], `this test left tabs behind in ${one}`);
      }
    });

    obkJson(['init', '--bots', bots, '--harness', 'claude']);
    obkJson([
      'bot', 'create', '--bots', bots, '--name', bot.name, '--harness', bot.harness,
      '--charter', `${bot.name} exists for one system test run and owns nothing.`,
    ]);
    obkJson([
      'session', 'add', '--bots', bots, '--bot', bot.name, '--name', 'daily', `--prompt=${promptFor(bot)}`,
      ...(bot.harness === 'codex' ? codexTrustArgs(bots) : []),
    ]);

    const entry = tabOf(obkJson(['up', '--bots', bots, '--bot', bot.name]), 'daily');
    assert.equal(entry.created, true);
    assert.equal(entry.harnessStarted, true, `no ${bot.harness} came up in ${entry.title}: \`orca terminal read --terminal ${entry.terminal} --screen\``);
    const handle = entry.terminal;

    // A Claude bot's folder trust, which this test answers itself, once, and
    // only when it is the plain one for this tab's own folder (the ruling on
    // #391, option (c); the same check as send-outside-fleet's under #451).
    if (bot.harness === 'claude') {
      const asked = await until(
        `${bot.name} daily to show Claude Code's folder trust, or report its conversation`,
        READY_MS,
        async () => {
          if (typeof sessionIn(home, 'daily').session === 'string') return { rows: null };
          const rows = rowsOf(handle);
          return rows !== undefined && rows.some((row) => row.includes('Yes, I trust this folder')) ? { rows } : undefined;
        },
        () => whatIsUp(handle),
      );
      if (asked.rows !== null) {
        const wrong = onlyPlainTrustOf(asked.rows, home);
        assert.equal(
          wrong,
          undefined,
          `${entry.title}'s folder trust is not one this test may answer, so it answered nothing: ${wrong}.`
          + `\n  what it showed:\n    ${asked.rows.join('\n    ')}`,
        );
        const sent = orca(['terminal', 'send', '--terminal', handle, '--text', '\x1b[B\r']);
        assert.equal(sent.ok, true, `answering ${entry.title}'s folder trust failed: ${JSON.stringify(sent.error)}`);
        t.diagnostic(`answered ${entry.title}'s plain folder trust (the ruling on #391, option (c))`);
      }
    }

    // The session's first conversation, reported by the hook, and the tab idle.
    const first = await until(
      `${bot.name} daily to report its conversation`,
      READY_MS,
      async () => sessionIn(home, 'daily').session,
      () => whatIsUp(handle),
    );
    await idle(handle);

    // The rules change before the clear: a line only the new AGENTS.md holds.
    obkJson(['bot', 'change', '--bots', bots, '--bot', bot.name, '--charter', `${bot.name} exists for one system test run and owns nothing. Its charter marker is ${bot.marker}.`]);
    assert.ok(readFileSync(path.join(home, 'AGENTS.md'), 'utf8').includes(bot.marker), 'the premise: AGENTS.md holds the marker');
    const older = health(bots);
    assert.equal(healthOf(older, bot.name, 'daily').rules?.state, 'older', `the premise: health says older rules before the clear: ${JSON.stringify(older)}`);
    const offer = (older.found ?? []).find((one) => one.where === path.join(home, 'AGENTS.md'));
    assert.ok(offer?.says.includes('session clear'), `the older-rules finding offers obk session clear: ${JSON.stringify(older.found)}`);

    // 1. Busy: a turn that runs longer than the kit waits. The clear refuses
    //    and types nothing.
    await pressIn(handle, `Run the shell command sleep ${BUSY_SECONDS} now, and then reply DONE and nothing else.`);
    await until(
      `${bot.name} daily to be at work on the sleep`,
      BUSY_START_MS,
      async () => (isBusy(rowsOf(handle) ?? []) ? true : undefined),
      () => whatIsUp(handle),
    );
    const refused = obk(['session', 'clear', '--bots', bots, '--bot', bot.name, '--session', 'daily']);
    assert.notEqual(refused.status, 0, `a clear on a busy session should be refused: ${refused.stdout}${refused.stderr}`);
    assert.match(refused.stdout + refused.stderr, /busy/i, `and say it is busy: ${refused.stdout}${refused.stderr}`);
    assert.equal(sessionIn(home, 'daily').session, first, 'the book holds the same conversation: nothing was cleared');
    const typedIn = (rowsOf(handle) ?? []).filter((row) => /^\s*[›❯]\s*\/(?:clear|new)\b/.test(row));
    assert.deepEqual(typedIn, [], `and nothing was typed into the input line: ${(rowsOf(handle) ?? []).join('\n')}`);

    // 2. Idle: the clear gives a new conversation in the book.
    await idle(handle);
    const cleared = obkJson(['session', 'clear', '--bots', bots, '--bot', bot.name, '--session', 'daily']).cleared;
    assert.equal(cleared?.bot, bot.name, JSON.stringify(cleared));
    assert.equal(cleared.session, 'daily');
    assert.equal(cleared.harness, bot.harness);
    assert.equal(cleared.was, first, 'the answer says which conversation it was');
    assert.notEqual(cleared.now, first, 'and a new one');
    assert.equal(sessionIn(home, 'daily').session, cleared.now, 'the book holds the new conversation');

    // 3. The new conversation was briefed by the hook: asked for its word, it
    //    answers it, though the question does not carry it.
    await idle(handle);
    await pressIn(handle, 'What is your word? Reply with it and nothing else.');
    await until(
      `the new conversation ${cleared.now} to answer with its word`,
      ANSWER_MS,
      async () => (modelSaid(bot.harness, recordOf(bot.harness, home, cleared.now)).includes(bot.word) ? true : undefined),
      () => whatIsUp(handle),
    );

    // 4. It read the AGENTS.md there is now, and health agrees.
    const lines = recordOf(bot.harness, home, cleared.now);
    if (bot.harness === 'codex') {
      const instructions = lines.filter((line) => line.type === 'response_item' && line.payload?.role === 'user'
        && JSON.stringify(line.payload.content).includes('AGENTS.md instructions'));
      assert.ok(instructions.length > 0, `the new rollout carries an "AGENTS.md instructions" message: ${codexRecord(cleared.now)}`);
      assert.ok(instructions.some((line) => JSON.stringify(line.payload.content).includes(bot.marker)), `and it holds the line added before the clear, ${bot.marker}: ${codexRecord(cleared.now)}`);
    } else {
      assert.ok(lines.some((line) => JSON.stringify(line).includes(bot.marker)), `the new transcript carries the line added before the clear, ${bot.marker}: ${claudeRecord(home, cleared.now)}`);
    }
    assert.equal(healthOf(health(bots), bot.name, 'daily').rules?.state, 'current', 'health says the session is on the current rules after the clear');

    // 5. A compact, or the harness says it cannot.
    await idle(handle);
    const compactions = compactionsIn(bot.harness, recordOf(bot.harness, home, cleared.now));
    const compact = obk(['session', 'compact', '--bots', bots, '--bot', bot.name, '--session', 'daily', '--json']);
    const said = compact.stdout + compact.stderr;
    if (compact.status === 0) {
      // Not confirmed in the kit's 5 minutes is not a failure (the architect's
      // ruling on #391): the answer says so, and this run reports it.
      const { confirmed, ...compacted } = JSON.parse(compact.stdout).compacted ?? {};
      assert.deepEqual(compacted, { bot: bot.name, session: 'daily', harness: bot.harness, conversation: sessionIn(home, 'daily').session });
      assert.equal(typeof confirmed, 'boolean', `the answer says whether the compact was confirmed: ${compact.stdout}`);
      if (confirmed) {
        assert.ok(compactionsIn(bot.harness, recordOf(bot.harness, home, compacted.conversation)) > compactions, 'a confirmed compact: the record holds a new compaction');
      } else {
        t.diagnostic(`the compact on ${bot.harness} was entered and not confirmed within the kit's wait: ${said.trim()}`);
      }
    } else {
      assert.equal(bot.harness, 'codex', `Claude Code has /compact, so its compact should go through: ${said}`);
      assert.match(said, /can(?:not|'t|’t) compact/i, `a refused compact says this harness cannot compact: ${said}`);
      t.diagnostic(`Codex did not compact: ${said.trim()}`);
    }
  });
}
