// `obk temp make` and `obk temp retire`: a session's own temporary sessions
// (PRD 6.4, #227). And `obk temp trust-hooks`, the one answer a maker gives its
// Codex run's hooks review (#238).
//
// Any long-lived session can make a temporary session of its own bot for a
// piece of work, and retire it when the work is done, without Bot Father, who
// stays the manager of long-lived sessions. A temporary session can make one
// of its own, one level deep and one at a time (#464, ADR 0033). A temporary session is an ordinary
// session in every other way: in bot.yaml, brought up with a tab and a mailbox,
// its conversations kept in the book. What makes it temporary is one field of
// its book entry, `temporary: { maker, made }`, and the book is the one place
// that says so (ADR 0012).
//
// The caller is the session whose tab this runs in, as the book records it: the
// tab says who is calling now. The maker is kept by its session name, not its
// tab, so it still owns what it made after a restart gives it a new tab.
//
// Everything that can refuse is checked before anything is written, so a
// refusal leaves bot.yaml, the book and Orca as they were. The one write that
// may fall outside what a harness's sandbox lets a session write, its start
// prompt's file beside the bots folder, is made first, the way #383 puts the
// risky write before bot.yaml: refused there, nothing else has changed, and the
// same command run again with that access goes through.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

import { readBook, updateBook } from './book.js';
import { addSession, dropSession, NAME, readBot } from './bot.js';
import { harnessOf, isShortPrompt, ownCli, shellWord, startPrompt, workDirOf } from './launch.js';
import { sessionInTab } from './message.js';
import { orca, screenRows, tabs } from './orca.js';
import { retireSession } from './retire.js';
import { bringUp, promptPath } from './up.js';

/** The settings a temporary session takes from its maker unless told otherwise. */
const INHERITED = ['model', 'effort', 'context', 'approval'];

/**
 * Make a temporary session of the caller's own bot and bring it up. `given`
 * holds what the caller said: `name`, `prompt` or `prompt_file`, and any of
 * `harness` and the inherited settings. Returns `{ bot, session, maker,
 * settings, up }`, where `up` is what bringing it up answered.
 */
export async function makeTemp(bots, { tab, ...given }) {
  const caller = callerIn(bots, tab, 'make');
  // A temporary session makes one of its own, one level deep and one at a
  // time (#464, ADR 0033).
  if (caller.temporary !== undefined) {
    const book = readBook(caller.home);
    const maker = caller.temporary.maker;
    if (book.sessions[maker]?.temporary !== undefined) {
      throw new Error(`${caller.bot}/${caller.session} is a temporary session ${maker} made, and ${maker} is temporary itself, so it makes none of its own: temporary sessions go one level deep. Nothing was made.`);
    }
    const open = Object.keys(book.sessions).filter((name) => book.sessions[name]?.temporary?.maker === caller.session);
    if (open.length > 0) {
      throw new Error(`${caller.bot}/${caller.session} is a temporary session, and it already has ${open.join(', ')} open; a temporary session has one of its own at a time. Retire it first with  ${shellWord(ownCli())} temp retire --bots ${shellWord(bots)} --name ${open[0]}  Nothing was made.`);
    }
  }
  // The name is a folder under work/ and a file beside the bots folder, so it
  // is held to the rule a bot's name is: one plain name, never a path.
  if (!NAME.test(given.name)) {
    throw new Error(`${given.name} cannot be a session's name: a name is lower-case letters, digits and single hyphens, such as review-250. Nothing was made.`);
  }
  if (given.prompt === undefined && given.prompt_file === undefined) {
    throw new Error(`temp make needs the task: --prompt <text> or --prompt-file <path>. Nothing was made.`);
  }
  if (given.prompt !== undefined && given.prompt_file !== undefined) {
    throw new Error(`temp make was given the task twice, as --prompt and as --prompt-file, and a session is told its duty once. Give it one way. Nothing was made.`);
  }

  const bot = readBot(caller.home, caller.bot);
  const maker = bot.sessions.find((session) => session.name === caller.session);
  const settings = { name: given.name };
  const harness = given.harness ?? maker?.harness;
  if (harness !== undefined) settings.harness = harness;
  // On another harness than its maker's, the model, the effort and the context
  // are that harness's own, and only the approval carries over (#238, PRD 6.4).
  const same = (harness ?? bot.harness) === harnessOf(maker ?? {}, bot.harness);
  for (const field of INHERITED) {
    const value = given[field] ?? (same || field === 'approval' ? maker?.[field] : undefined);
    if (value !== undefined) settings[field] = value;
  }
  if (given.extra_args !== undefined) settings.extra_args = given.extra_args;
  if (given.prompt !== undefined) settings.prompt = given.prompt;
  else settings.prompt_file = given.prompt_file;
  settings.work_dir = `work/${given.name}`;

  const written = bot.sessions.some((session) => session.name === given.name) ? undefined : writePromptFirst(bots, caller, settings);
  // Refuses a name the bot already has, and a setting that will not work,
  // before it writes anything; the prompt written first goes with a refusal.
  let added;
  try {
    added = addSession(bots, caller.bot, settings);
  } catch (error) {
    if (written !== undefined) rmSync(written, { force: true });
    throw error;
  }
  const made = new Date().toISOString();
  try {
    await updateBook(caller.home, (book) => {
      book.sessions[given.name] = { ...book.sessions[given.name], temporary: { maker: caller.session, made } };
    });
  } catch (error) {
    // A session in bot.yaml that the book does not call temporary would be a
    // long-lived one to everything that reads it, its maker's retire included,
    // so it is taken back off rather than left that way.
    const failed = `${caller.bot}/${given.name} could not be recorded in the book as temporary (${error.message})`;
    try {
      dropSession(bots, caller.bot, given.name);
    } catch (undo) {
      throw new Error(`${failed}, and taking it back off bot.yaml failed too (${undo.message}). It is in bot.yaml as a session the book does not call temporary. Take it off with  ${shellWord(ownCli())} retire --bots ${shellWord(bots)} --bot ${caller.bot} --session ${given.name}`);
    }
    // Off bot.yaml, nothing is made; a prompt file that stays is only a file,
    // and nothing reads it (#393).
    try {
      if (written !== undefined) rmSync(written, { force: true });
    } catch (left) {
      throw new Error(`${failed}, so it was taken back off bot.yaml and nothing was made. Its start prompt ${written} could not be removed (${left.message}), and nothing reads it. Remove it with  rm ${shellWord(written)}`);
    }
    throw new Error(`${failed}, so it was taken back off bot.yaml and nothing was made. Run this again once the book can be written.`);
  }

  let up;
  try {
    up = await bringUp(bots, { bot: caller.bot, session: given.name });
  } catch (error) {
    const cli = shellWord(ownCli());
    throw new Error(`${caller.bot}/${given.name} is made, in bot.yaml and in the book as temporary with its maker ${caller.session}, and could not be brought up: ${error.message} Bring it up with  ${cli} up --bots ${shellWord(bots)} --bot ${caller.bot} --session ${given.name}  or retire it with  ${cli} temp retire --bots ${shellWord(bots)} --name ${given.name}`);
  }
  return { bot: caller.bot, session: given.name, maker: caller.session, settings: added.session, up };
}

/**
 * Write the start prompt's file where bringing the session up will write it,
 * when its prompt goes to the harness out of a file at all, and say where. A
 * prompt that cannot be read yet is left to `addSession`, which refuses it in
 * its own words.
 */
function writePromptFirst(bots, caller, settings) {
  let prompt;
  try {
    prompt = startPrompt(settings, { home: caller.home, workDir: workDirOf(settings, caller.home) });
  } catch {
    return undefined;
  }
  if (isShortPrompt(prompt)) return undefined;

  const file = promptPath(bots, caller.bot, settings.name);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, prompt);
  } catch (error) {
    throw new Error(`${caller.bot}/${settings.name}'s start prompt could not be written to ${file} (${error.message}), and it is written first, so nothing was made. Run this again where that folder can be written: from a harness's sandbox, with the access to write it.`);
  }
  return file;
}

/**
 * Retire a temporary session the caller made. Returns what `retireSession`
 * does, with the maker.
 */
export async function retireTemp(bots, { tab, name }) {
  const caller = callerIn(bots, tab, 'retire');
  ownTemp(caller, name, 'retire', 'Nothing was retired.');
  return { ...(await retireSession(bots, { bot: caller.bot, session: name })), maker: caller.session };
}

/**
 * The caller's own temporary session `name`, from bot.yaml, or a refusal: one
 * the bot does not have, a long-lived one, or one another session made.
 * `verb` finishes "to <verb>", and `nothing` is the sentence that ends each.
 */
function ownTemp(caller, name, verb, nothing) {
  const bot = readBot(caller.home, caller.bot);
  const session = bot.sessions.find((one) => one.name === name);
  if (session === undefined) {
    throw new Error(`${caller.bot} has no session called ${name}, so there is nothing of yours to ${verb}. ${nothing}`);
  }
  const temporary = readBook(caller.home).sessions[name]?.temporary;
  if (temporary === undefined) {
    throw new Error(`${caller.bot}/${name} is a long-lived session, and those are Bot Father's to ${verb}. ${nothing}`);
  }
  if (temporary.maker !== caller.session) {
    throw new Error(`${caller.bot}/${name} is a temporary session ${temporary.maker} made, not ${caller.session}, so it is ${temporary.maker}'s to ${verb}. ${nothing}`);
  }
  return { bot, session };
}

/** Codex's hooks review, and the one of its choices this kit answers it with (tech notes, section 3). */
const HOOKS_REVIEW = 'Hooks need review';
const TRUST_ALL = 'Trust all and continue';

/** How long the review is given to go once answered, looked at every half second. */
const REVIEW_GONE_MS = 5000;

/**
 * Answer the hooks review of a Codex run the caller made with "Trust all and
 * continue", and confirm the review went (#238, the owner's choice (b)). The
 * one answer a permission rule of its own can allow: a raw `orca terminal
 * send` cannot be narrowed to a tab or to these keys. Everything that can
 * refuse is checked before a key is sent. Returns `{ bot, session, maker }`.
 */
export async function trustHooks(bots, { tab, name }) {
  const caller = callerIn(bots, tab, 'trust-hooks', "answer a run's hooks review");
  const nothing = 'Nothing was typed.';
  const { bot, session } = ownTemp(caller, name, 'answer for', nothing);
  const run = `${caller.bot}/${name}`;
  const harness = harnessOf(session, bot.harness);
  if (harness !== 'codex') {
    throw new Error(`${run} runs on ${harness}, and temp trust-hooks answers a Codex run's "${HOOKS_REVIEW}" alone. ${nothing}`);
  }
  const tabId = readBook(caller.home).sessions[name]?.tab;
  const handle = tabId === undefined ? undefined : tabs(caller.home).find((one) => one.tabId === tabId)?.handle;
  if (handle === undefined) {
    throw new Error(`${run} has no tab open in Orca, so there is no review of its to answer. ${nothing}`);
  }
  const seen = screenRows(handle);
  if (seen.rows === undefined) {
    throw new Error(`${run}'s screen could not be read (${seen.unreadable}), so the kit cannot tell whether its hooks review is there. ${nothing}`);
  }
  const keys = keysToTrustAll(seen.rows);
  if (keys === undefined) {
    throw new Error(`${run}'s screen shows no "${HOOKS_REVIEW}" with its choices, so there is nothing for this to answer. It shows: ${shown(seen.rows)}. ${nothing}`);
  }
  // The return is inside the text: `--enter` would be a second key.
  orca(['terminal', 'send', '--terminal', handle, '--text', keys]);
  for (let waited = 0; ; waited += 500) {
    const after = screenRows(handle);
    if (after.rows !== undefined && !after.rows.some((row) => row.includes(HOOKS_REVIEW))) break;
    if (waited >= REVIEW_GONE_MS) {
      const still = after.rows === undefined ? `its screen could not be read again (${after.unreadable})` : `its screen still shows "${HOOKS_REVIEW}"`;
      throw new Error(`${run}: "${TRUST_ALL}" was chosen on its hooks review, but ${REVIEW_GONE_MS / 1000} seconds later ${still}. Look at its tab.`);
    }
    await pause(500);
  }
  return { bot: caller.bot, session: name, maker: caller.session };
}

/**
 * The keys that take Codex's hooks review to "2. Trust all and continue" and
 * answer it, from wherever its pointer is: arrows, then return, never a digit
 * (a digit and return once took whatever was highlighted). Undefined when the
 * rows show no such review with the pointer on one of its choices.
 */
function keysToTrustAll(rows) {
  if (!rows.some((row) => row.includes(HOOKS_REVIEW))) return undefined;
  if (!rows.some((row) => new RegExp(`^ *(?:› +)?2\\. ${TRUST_ALL}`).test(row))) return undefined;
  const pointer = rows.map((row) => /^ *› +(\d+)\. /.exec(row)).findLast((found) => found !== null);
  if (pointer === undefined) return undefined;
  const moves = 2 - Number(pointer[1]);
  return (moves > 0 ? '\x1b[B'.repeat(moves) : '\x1b[A'.repeat(-moves)) + '\r';
}

/** What a screen shows, on one line: its rows with words in them, cut short. */
function shown(rows) {
  const text = rows.map((row) => row.trim()).filter((row) => row !== '').join(' ⏎ ');
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

/**
 * The session this runs in, as the book knows it, with its home and whether it
 * is itself temporary.
 */
function callerIn(bots, tab, what, doing = `${what} it`) {
  const found = tab === undefined ? undefined : sessionInTab(bots, tab);
  if (found === undefined) {
    throw new Error(`temp ${what} is run by a session in its own tab, and this is not one of the fleet's tabs, so there is no session here to ${doing} for. Nothing was done.`);
  }
  const entry = readBook(found.home).sessions[found.session] ?? {};
  return { bot: found.bot, session: found.session, home: found.home, temporary: entry.temporary };
}
