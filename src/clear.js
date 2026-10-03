// `obk session clear` and `obk session compact` (#391): the kit, not the
// harness, is asked to clear or compact a session, and does it safely.
//
// A clear is special because a cleared session has to be told its duty again.
// That is the kit's hook's work already (src/record.js): it hears the new
// conversation and answers with the start prompt. So this only types the
// harness's own command, and only when that cannot cut off a turn or answer a
// question: it waits for the session to be idle, types the command without a
// return, reads the screen, and presses return only when the screen shows the
// command and nothing else. Afterwards it confirms what happened from the
// records, not from the screen: the book's new conversation for a clear, the
// harness's own record of a compaction for a compact.

import { realpathSync, statSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';

import { readBook } from './book.js';
import { botDir, readBot } from './bot.js';
import { claudeTranscript, codexRollout } from './conversations.js';
import { harnessOf, ownCli, shellWord } from './launch.js';
import { eachLine } from './lines.js';
import { findProject, orca, QUESTION_ON_SCREEN, screenRows, tabs, tabToTypeInto } from './orca.js';
import { botsNamed, sessionsOf, typeListLine } from './up.js';

/** The harness's own command for each, as typed into its input line. Codex's clear is `/new` (tech notes, section 3). */
const COMMANDS = {
  clear: { claude: '/clear', codex: '/new' },
  compact: { claude: '/compact', codex: '/compact' },
};

/** The pointer each harness starts its input line with (tech notes, section 1). */
const POINTER = { claude: '❯', codex: '›' };

/**
 * The line typed into Codex after its `/new`, in the architect's words (#391).
 * Codex reports a new conversation only at its first turn (tech notes, section
 * 3), so without a turn the hook never hears of it and never re-briefs it.
 */
const RECORD_LINE = 'obk: this conversation was started by obk session clear, and this line is only so the kit can record it. Reply "ok"; nothing else is asked.';

/** What Codex asks after `/new`, and the one answer the kit gives it: the bot home it runs in. */
const WHERE_TO_RUN = 'Where should the new conversation run?';
const CURRENT_CHECKOUT = /^ *› +1\. Current checkout\b/;

/** How long the session is given to be idle before nothing is typed, and how long each look waits on it. */
const IDLE_WAIT_MS = 30_000;
const LOOK_MS = 2000;
/** How long the screen is given to show the command typed, or Codex's question after `/new`. */
const SCREEN_MS = 3000;
/** How long the book is given to hold the new conversation, and a harness to record a compaction (the architect: up to 5 minutes). */
const CLEAR_MS = 30_000;
const COMPACT_MS = 300_000;
/** How long each screen read is given before it counts as a screen that cannot be read. */
const READ_MS = 5000;
/** The pause between looks, and between looks at a record that may be large. */
const ASK_MS = 500;
const RECORD_ASK_MS = 2000;

/** A row that says the harness is at work on a turn: both draw it while one runs. */
const WORKING = /esc to interrupt/i;

/**
 * Clear the session: `/clear` on Claude Code, `/new` on Codex. Returns
 * `{ bot, session, harness, was, now }`, the conversation the book held before
 * (or null) and the one it holds now.
 */
export async function clearSession(bots, { bot, session }) {
  const it = sessionToType(bots, bot, session);
  const was = readBook(it.home).sessions[session]?.session ?? null;
  const { command, handle } = await enter(it, 'clear');

  if (it.harness === 'codex') {
    await answerWhereToRun(it, handle, command);
    const line = await typeListLine(it.home, it.tabId, RECORD_LINE);
    if (!line.typed) {
      throw new Error(`${it.name}: ${command} went in, but the line that starts the new conversation's first turn was not typed (${line.why}), and Codex reports a new conversation only at its first turn. The book still holds ${was ?? 'no conversation'}. Look at its tab.`);
    }
  }

  const until = Date.now() + CLEAR_MS;
  for (;;) {
    const now = readBook(it.home).sessions[session]?.session;
    if (typeof now === 'string' && now !== was) return { bot, session, harness: it.harness, was, now };
    if (Date.now() >= until) {
      throw new Error(`${it.name}: ${command} went in, but after ${CLEAR_MS / 1000} s the book has no new conversation for it: it still holds ${was ?? 'none'}. Look at its tab.`);
    }
    await pause(ASK_MS);
  }
}

/**
 * Compact the session's conversation with the harness's `/compact`. Returns
 * `{ bot, session, harness, conversation, confirmed }`: confirmed once the
 * harness's own record of the conversation shows a compaction made after the
 * command began, and not yet when COMPACT_MS passed without one.
 */
export async function compactSession(bots, { bot, session }) {
  const it = sessionToType(bots, bot, session);
  // What the record holds when /compact is typed is not this compact's: one
  // that ends while the kit waits for the session to be idle is the one
  // before it (review of PR #466). So only what is written after counts.
  let record;
  const { typedAt } = await enter(it, 'compact', () => {
    record = recordAt(it.harness, it.home, readBook(it.home).sessions[session]?.session ?? null);
  });

  const until = typedAt + COMPACT_MS;
  for (;;) {
    const conversation = readBook(it.home).sessions[session]?.session ?? null;
    // A conversation the book did not hold when it was typed is read whole.
    if (conversation !== record.id) record = { id: conversation, from: 0 };
    record.file ??= recordFile(it.harness, it.home, conversation);
    if (record.file !== undefined && compactedSince(it.harness, record, typedAt)) {
      return { bot, session, harness: it.harness, conversation, confirmed: true };
    }
    if (Date.now() >= until) return { bot, session, harness: it.harness, conversation, confirmed: false };
    await pause(RECORD_ASK_MS);
  }
}

/**
 * The session as something to type into, once everything that refuses before
 * Orca is asked to type has been asked: `{ name, home, harness, tabId }`.
 */
function sessionToType(bots, bot, session) {
  botsNamed(bots, bot);
  const home = realpathSync(botDir(bots, bot));
  const known = readBot(home, bot);
  const [settings] = sessionsOf(known, session);
  const name = `${bot} ${session}`;
  const unpause = `${shellWord(ownCli())} unpause --bots ${shellWord(bots)} --bot ${bot}`;
  if (known.paused === true) throw new Error(`${bot} is paused, so ${name} is not running and nothing was typed. Bring it back with ${unpause}.`);
  if (settings.paused === true) throw new Error(`${name} is paused, so it is not running and nothing was typed. Bring it back with ${unpause} --session ${session}.`);

  const tabId = readBook(home).sessions[session]?.tab;
  // Orca refuses to list the tabs of a folder it has no project for (tech
  // notes, section 1), so a bot never brought up is asked nothing.
  const open = typeof tabId === 'string' && findProject(home) !== undefined && tabs(home).some((tab) => tab.tabId === tabId);
  if (!open) {
    throw new Error(`${name} has no tab open in Orca, so it is not running and nothing was typed. Bring it up with ${shellWord(ownCli())} up --bots ${shellWord(bots)} --bot ${bot} --session ${session}.`);
  }
  return { name, home, harness: harnessOf(settings, known.harness), tabId, restart: `${shellWord(ownCli())} restart --bots ${shellWord(bots)} --bot ${bot} --session ${session}` };
}

/**
 * Type the harness's command for `verb` into the session's tab and press
 * return, once it is idle and the screen shows the command typed and nothing
 * else. `before` runs just before the command is typed. Returns the command,
 * the handle it went into, and when it was typed.
 */
async function enter(it, verb, before = () => {}) {
  const command = COMMANDS[verb][it.harness];
  const handle = await idleTab(it);

  before();
  const typedAt = Date.now();
  send(handle, command);
  const wrong = await typedWrong(handle, it.harness, command);
  if (wrong !== undefined) {
    // Taken back, one backspace a character, so the input line is as it was.
    send(handle, '\x7f'.repeat(command.length));
    const cannot = verb === 'compact' && wrong.menu ? ` ${harnessName(it.harness)} here cannot compact: its menu does not offer ${command}.` : '';
    throw new Error(`${it.name}: ${command} was typed but not entered, and was taken back, because ${wrong.why}.${cannot}${shownEnd(wrong.rows)}`);
  }
  // A return of its own, not `--enter`: Orca's gate can refuse a line sent
  // with `--enter` while it names a reason, and on Codex a return inside the
  // text lands in the draft (helpers in the system tests, #329).
  send(handle, '\r');
  return { command, handle, typedAt };
}

/**
 * The handle of the session's tab once the session is idle, with nothing on
 * its screen to answer, within IDLE_WAIT_MS. Busy is Orca's `tui-idle` not
 * answering ok, or a screen that says it is at work: Orca can call a busy
 * Codex idle. Throws when the tab holds no harness, and when the wait ran out.
 */
async function idleTab(it) {
  const until = Date.now() + IDLE_WAIT_MS;
  for (;;) {
    const found = tabToTypeInto(it.home, it.tabId, LOOK_MS);
    let why;
    if (found.blocked !== undefined) {
      why = found.blocked === QUESTION_ON_SCREEN
        ? 'a question of its harness\'s own is on its screen'
        : `a question is waiting on its screen: Orca says ${found.blocked}`;
    } else if (found.unsure !== undefined) {
      why = found.unsure;
    } else if (found.handle === undefined) {
      throw new Error(`${it.name} is not running: its tab is open with no harness in front of it, so its harness quit or crashed, and nothing was typed. ${it.restart} brings it back.`);
    } else if (found.agent !== it.harness) {
      why = `Orca names ${found.agent} in it, and the session runs on ${it.harness}`;
    } else {
      const seen = screenRows(found.handle, READ_MS);
      if (!found.idle || seen.rows?.some((row) => WORKING.test(row))) why = 'it is busy with a turn';
      else if (seen.rows === undefined) why = `its screen could not be read (${seen.unreadable})`;
      // The wait is a cutoff, not a count of looks: a yes that comes after it
      // is too late (as for LIST_LINE, review of PR #421).
      else if (Date.now() >= until) why = 'the look that found it idle came only after the wait was up';
      else return found.handle;
    }
    if (Date.now() >= until) throw new Error(`${it.name}: nothing was typed, because after ${IDLE_WAIT_MS / 1000} s ${why}. Run this again once it is idle.`);
    await pause(ASK_MS);
  }
}

/**
 * Why the screen does not show `command` typed and ready, or undefined when it
 * does: the input line, the lowest row the harness's pointer starts, reads the
 * pointer and the command and nothing else, and the first row of the slash
 * menu under it names the command. `menu` is set when the input line was right
 * and the menu was not. Read again for SCREEN_MS while it is not so: a screen
 * takes a moment to draw what was typed.
 */
async function typedWrong(handle, harness, command) {
  const until = Date.now() + SCREEN_MS;
  for (;;) {
    const seen = screenRows(handle, READ_MS);
    const wrong = seen.rows === undefined ? { why: `its screen could not be read (${seen.unreadable})` } : menuWrong(seen.rows, harness, command);
    if (wrong === undefined || Date.now() >= until) return wrong && { ...wrong, rows: seen.rows };
    await pause(ASK_MS);
  }
}

function menuWrong(rows, harness, command) {
  const at = rows.findLastIndex((row) => /^ *[›❯]/.test(row));
  if (at < 0) return { why: 'its screen shows no input line' };
  if (rows[at].trim() !== `${POINTER[harness]} ${command}`) return { why: `its input line reads "${rows[at].trim()}"` };
  const first = rows.slice(at + 1).map((row) => row.replace(/^ *(?:[›❯] +)?/, '')).find((row) => row.startsWith('/'));
  if (first === undefined) return { why: 'no menu of commands came up under its input line', menu: true };
  if (first.split(/\s+/)[0] !== command) return { why: `the first row of its menu is "${first.trim()}"`, menu: true };
  return undefined;
}

/**
 * Answer Codex's "Where should the new conversation run?" with "1. Current
 * checkout", the bot home, when it comes up after `/new`. With its selection
 * anywhere else it is backed out of with Esc: the kit never makes a worktree
 * (PRD 6.2).
 */
async function answerWhereToRun(it, handle, command) {
  const until = Date.now() + SCREEN_MS;
  for (;;) {
    const rows = screenRows(handle, READ_MS).rows ?? [];
    if (rows.some((row) => row.includes(WHERE_TO_RUN))) {
      const pointer = rows.findLast((row) => /^ *›/.test(row));
      if (pointer === undefined || !CURRENT_CHECKOUT.test(pointer)) {
        send(handle, '\x1b');
        throw new Error(`${it.name}: after ${command}, Codex asked "${WHERE_TO_RUN}" with its selection on "${pointer?.trim() ?? 'nothing'}" rather than "1. Current checkout", so it was backed out of with Esc and nothing else was typed. Look at its tab.`);
      }
      send(handle, '\r');
      return;
    }
    if (Date.now() >= until) return;
    await pause(ASK_MS);
  }
}

/** Where the harness keeps the record of `conversation`, or undefined when it has none yet. */
function recordFile(harness, home, conversation) {
  if (conversation === null) return undefined;
  return harness === 'claude' ? claudeTranscript(home, conversation) : codexRollout(conversation);
}

/** The record of `conversation` as it is now: `{ id, file, from }`, `from` the byte it ends at. */
function recordAt(harness, home, conversation) {
  const file = recordFile(harness, home, conversation);
  let from = 0;
  try {
    from = file === undefined ? 0 : statSync(file).size;
  } catch {
    // Not written yet: everything in it will be new.
  }
  return { id: conversation, file, from };
}

/**
 * Whether the record holds, from its byte `from` on, a compaction made at
 * `since` or later. Read a line at a time: a record can be larger than one
 * string holds (#396).
 */
function compactedSince(harness, record, since) {
  let found = false;
  try {
    eachLine(record.file, (line) => {
      // Only a line that names a compaction is worth parsing.
      if (line === undefined || !line.includes('compact')) return false;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        return false;
      }
      // Claude Code's marker, and Codex's (tech notes, sections 2 and 3).
      const compaction = harness === 'claude'
        ? entry?.type === 'system' && entry.subtype === 'compact_boundary'
        : entry?.type === 'compacted';
      found = compaction && Date.parse(entry.timestamp) >= since;
      return found;
    }, { from: record.from });
  } catch {
    return false;
  }
  return found;
}

/**
 * The last rows of the screen with words in them, as a sentence for a refusal,
 * so whoever reads it sees what the harness drew there.
 */
function shownEnd(rows) {
  const shown = (rows ?? []).filter((row) => row.trim() !== '').slice(-SHOWN_ROWS);
  return shown.length === 0 ? '' : ` Its screen ended: ${shown.map((row) => row.trimEnd()).join(' ⏎ ')}`;
}

/** How many rows of the screen a refusal shows. */
const SHOWN_ROWS = 12;

/** Type `keys` into the tab as they are, with no return of Orca's. */
const send = (handle, keys) => orca(['terminal', 'send', '--terminal', handle, '--text', keys]);

const harnessName = (harness) => (harness === 'claude' ? 'Claude Code' : 'Codex');
