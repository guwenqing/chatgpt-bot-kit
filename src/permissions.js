// The permission rules a bot may run with, written into its own Claude
// settings, and only the ones its user said yes to (#344).
//
// A bot in auto mode is stopped by the harness's check for things the kit's own
// rules tell every bot to do: read and send its mail, read a long message's
// body beside the bots folder, commit. A matching allow rule is settled before
// that check (Claude Code's permissions docs), so the kit offers every Claude
// bot a small default set, spelled with its real CLI and bots folder. The user
// sees the exact rules and says yes; `bot change --allow` keeps that yes in
// bot.yaml's `allow`, and the kit's code writes what `allow` holds into
// `.claude/settings.json` in the bot folder, beside its hook (ADR 0022). A model
// editing the file by hand may get the format wrong; code does not.
//
// The kit owns only the entries `allow` holds. Any other entry in the file is
// left where it is, and health names it.
//
// A bot on Codex gets the same yes in Codex's own form (#354, ADR 0028): each
// `Bash(<words>:*)` becomes a `prefix_rule` of those words in
// `.codex/rules/obk.rules`, a file the kit owns whole and rewrites from `allow`.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { leadsOutside } from './bot.js';
import { readSettings } from './hooks.js';
import { harnessOf, ownCli, shellWord } from './launch.js';

/** Where Claude Code reads a project's settings, inside the bot home. */
const FILE = '.claude/settings.json';

/** Where Codex reads a trusted project's rules, and the one file of them the kit owns. */
const CODEX_RULES = '.codex/rules';
const CODEX_FILE = `${CODEX_RULES}/obk.rules`;

/**
 * The rules every Claude bot is offered, in this order. The mail commands are
 * narrowed to this bots folder and spelled as the kit prints them in its
 * nudge and in `message to`'s answer, which is what a bot runs. `//` is Claude's
 * form for an absolute path.
 */
export function defaultRules(bots, cli = ownCli()) {
  const kit = shellWord(cli);
  const folder = shellWord(bots);
  return [
    `Bash(${kit} message check --bots ${folder}:*)`,
    `Bash(${kit} message send --bots ${folder}:*)`,
    `Bash(${kit} message to --bots ${folder}:*)`,
    `Read(/${bots}.messages/**)`,
    'Bash(git add:*)',
    'Bash(git commit:*)',
  ];
}

/** Command wrappers: programs that run the command their arguments name. */
const WRAPPERS = new Set(['env', 'xargs', 'sudo', 'eval', 'exec', 'nohup', 'timeout', 'nice', 'command', 'time', 'watch']);

/**
 * Programs that run whatever their arguments tell them to: shells, interpreters
 * and the wrappers above. With a wildcard after one of them, a rule lets the bot
 * run any command, unless the next word fixes what runs by its absolute path.
 */
const RUNNERS = new Set([
  'sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'tcsh',
  'python', 'python2', 'python3', 'node', 'deno', 'bun', 'ruby', 'perl', 'php', 'osascript',
  'npx', 'pnpx', 'bunx', 'uvx',
  ...WRAPPERS,
]);

const ANY = 'it lets the bot run any command';

/**
 * Why a rule is broad, as the end of a sentence, or undefined for a narrow one
 * (#353). A charter's grants are written as narrow, exact rules only; one that
 * lets the bot run any command, a program with any arguments, or any file on
 * the disk or in the home is the user's to add by hand (ADR 0027).
 */
export function broadness(rule) {
  if (typeof rule !== 'string') return undefined;
  const file = /^(Read|Edit|Write)(?:\((.*)\))?$/s.exec(rule);
  if (file !== null) {
    const spec = file[2] ?? '';
    return spec === '' || /^(\/\/|~\/)[*/]*$/.test(spec) ? `it lets the bot ${file[1].toLowerCase()} any file` : undefined;
  }
  const bash = /^Bash(?:\((.*)\))?$/s.exec(rule);
  if (bash === null) return undefined;
  const { words, odd } = shellWords(bash[1] ?? '');
  if (odd !== undefined) return `it holds ${odd}, which the shell reads specially, so the kit cannot tell what it runs`;
  return commandBroadness(words);
}

/** What a word may hold outside quotes; anything else the shell reads specially. */
const PLAIN = /[A-Za-z0-9\-_./:=@%+,^*]/;

/**
 * A Bash rule's command as the shell words it is, quotes taken off, or the
 * first thing in it the shell reads specially: `{ words }` or `{ odd }`. Only
 * plain words are judged, so an escape, an expansion or a second command can
 * never hide which program runs.
 */
function shellWords(text) {
  const words = [];
  let word;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (char === ' ' || char === '\t') {
      if (word !== undefined) words.push(word);
      word = undefined;
      continue;
    }
    word ??= '';
    if (char === "'" || char === '"') {
      const end = text.indexOf(char, at + 1);
      if (end === -1) return { odd: `a ${char} that does not close` };
      const inside = text.slice(at + 1, end);
      const special = char === '"' ? /[$`\\]/.exec(inside) : null;
      if (special !== null) return { odd: `the character ${special[0]}` };
      word += inside;
      at = end;
    } else if (char === '\\' && text[at + 1] === "'") {
      // An apostrophe outside quotes, the form shellWord gives one in a path.
      word += "'";
      at += 1;
    } else if (PLAIN.test(char) || (char === '~' && word === '')) {
      word += char;
    } else {
      return { odd: char === '\n' ? 'a newline' : `the character ${char}` };
    }
  }
  if (word !== undefined) words.push(word);
  return { words };
}

/** The shell or interpreter a program name is, with a version on its name or not. */
const runnerOf = (name) => [name, name.replace(/[\d.]+$/, '')].find((one) => RUNNERS.has(one));

/** Why a Bash rule's command, as shell words, is broad, or undefined. */
function commandBroadness(all) {
  // The program is the first word after any shell assignments in front of it.
  let words = all;
  while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words = words.slice(1);
  if (words.length === 0) return ANY;
  const star = words.findIndex((word) => word.includes('*'));
  if (star === -1) return undefined;

  const program = path.basename(words[0].replace(/:?\*.*$/, ''));
  if (runnerOf(program) !== undefined) {
    // Only what runs, fixed by its absolute path, narrows it. A wrapper's
    // program is then judged by itself; an interpreter's script is the end.
    const next = (words[1] ?? '').replace(/:\*$/, '');
    const fixed = next.startsWith('/') && !next.includes('*');
    if (fixed && WRAPPERS.has(program)) return commandBroadness(words.slice(1));
    if (fixed && runnerOf(path.basename(next)) === undefined) return undefined;
    return `${program} runs whatever its arguments say, so ${ANY}`;
  }

  // Two words at least before the first wildcard: a program and what it does.
  const part = words[star].slice(0, words[star].indexOf('*')).replace(/:$/, '');
  const before = star + (part === '' ? 0 : 1);
  if (before === 0) return ANY;
  if (before < 2) return `it lets the bot run ${words[0].replace(/:?\*.*$/, '')} with any arguments`;
  return undefined;
}

/**
 * Refuse the rules `--allow` was given when any is broad, before anything is
 * written, naming the file the user can add it to themselves.
 */
export function refuseBroad(home, rules) {
  for (const rule of rules) {
    const why = broadness(rule);
    if (why === undefined) continue;
    throw new Error(`--allow ${rule} is broad: ${why}. The kit writes only narrow, exact rules, such as Bash(gh pr merge:*), so nothing was written. If the user wants this rule for ${path.basename(home)}, they add it to ${path.join(home, FILE)} themselves.`);
  }
}

/** The rules the bot is allowed beyond the kit's defaults, in `allow`'s order. */
export const beyondDefaults = (bots, home, bot) => {
  const defaults = defaultRules(bots);
  return allowOf(home, bot).filter((rule) => !defaults.includes(rule));
};

/** Whether any of a bot's sessions, or the bot itself, runs on Claude Code. */
export const runsOnClaude = (bot) => bot.harness === 'claude'
  || bot.sessions.some((session) => harnessOf(session, bot.harness) === 'claude');

/** The rules the user allowed this bot, read from its bot.yaml, or a refusal naming the file. */
export function allowOf(home, bot) {
  const value = bot.allow;
  if (value === undefined || value === null) return [];
  const file = path.join(home, 'bot.yaml');
  if (!Array.isArray(value) || value.some((rule) => typeof rule !== 'string' || rule.trim() === '')) {
    throw new Error(`the allow entry in ${file} is not a list of permission rules, such as Bash(git add:*), so none of it is written. Fix it, then run the command again.`);
  }
  return value;
}

/** Whether any of a bot's sessions, or the bot itself, runs on Codex. */
export const runsOnCodex = (bot) => bot.harness === 'codex'
  || bot.sessions.some((session) => harnessOf(session, bot.harness) === 'codex');

/**
 * The default rules this bot has not been allowed yet for one harness's file,
 * in the default order. Codex is not offered the Read rule: its sandbox reads
 * every file already.
 */
function waitingFor(bots, home, bot, harness) {
  const allowed = allowOf(home, bot);
  return defaultRules(bots)
    .filter((rule) => harness === 'claude' || codexForm(rule).line !== undefined)
    .filter((rule) => !allowed.includes(rule));
}

/**
 * A rule's Codex form: `{ line }`, `{ needless: true }` for a Read rule, which
 * Codex's sandbox does not need, or `{ why }` for a rule Codex has none for.
 * Only a prefix of plain words has one; a prefix rule for one exact command
 * would let the bot add any arguments the user did not say yes to.
 */
export function codexForm(rule) {
  if (/^Read(\(.*\))?$/s.test(rule)) return { needless: true };
  const bash = /^Bash\((.*)\)$/s.exec(rule);
  if (bash === null) return { why: 'Codex has no rule for anything but a command, so its sandbox decides it' };
  const { words, odd } = shellWords(bash[1]);
  if (odd !== undefined) return { why: `Codex has no rule for it: it holds ${odd}` };
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? '')) {
    return { why: 'Codex has no rule for a command with a variable set in front of it' };
  }
  if (!words.some((word) => word.includes('*'))) {
    return { why: 'Codex has no rule for one exact command: its rules match a command\'s first words, whatever comes after them' };
  }
  // Only the wildcard comes off, ` *` or `:*` at the very end: every word
  // before it stays, an empty quoted one included, or the rule would be looser
  // than the one the user said yes to.
  const text = bash[1].trimEnd();
  const end = /(?: |:)\*$/.exec(text);
  const prefix = end === null ? [] : shellWords(text.slice(0, end.index)).words;
  if (prefix.length === 0 || prefix.some((word) => word.includes('*'))) {
    return { why: 'Codex has no rule for a wildcard anywhere but at the end, as a word of its own or after a colon' };
  }
  return { line: `prefix_rule(pattern=[${prefix.map((word) => JSON.stringify(word)).join(', ')}], decision="allow")` };
}

/**
 * Refuse the rules `--allow` was given for a bot that runs only on Codex when
 * Codex has no form for one, before anything is written: recorded, it would
 * let the bot do nothing.
 */
export function refuseNoCodexForm(bot, rules) {
  if (runsOnClaude(bot) || !runsOnCodex(bot)) return;
  for (const rule of rules) {
    const { why } = codexForm(rule);
    if (why === undefined) continue;
    throw new Error(`--allow ${rule} is not for ${bot.name}: ${why}, and ${bot.name} runs only on Codex, so nothing was written.`);
  }
}

/** The one command that allows `rules` for `bot`, as the user can run it. */
export const allowCommand = (bots, bot, rules) => [
  shellWord(ownCli()), 'bot', 'change', '--bots', shellWord(bots), '--bot', shellWord(bot),
  ...rules.flatMap((rule) => ['--allow', shellWord(rule)]),
].join(' ');

/**
 * Write what the bot is allowed into the files of the harnesses it runs on, and
 * say what waits: one entry per file, Claude's first. With `keepGoing`, a file
 * the kit may not write is an entry with its `trouble` rather than a throw.
 */
export function writePermissions(bots, home, bot, { keepGoing = false } = {}) {
  const writers = [[runsOnClaude, FILE, writeClaude], [runsOnCodex, CODEX_FILE, writeCodex]];
  return writers.filter(([runs]) => runs(bot)).map(([, file, write]) => {
    try {
      return write(bots, home, bot);
    } catch (error) {
      if (!keepGoing) throw error;
      return { bot: bot.name, file: path.join(home, file), written: [], waiting: [], trouble: error.message };
    }
  });
}

/**
 * Write what the bot is allowed into its Claude settings: `{ bot, file,
 * written, waiting }`, with `written` the rules this run added.
 *
 * Only rules `allow` holds are written. Everything else in the file stays as it
 * is, the user's own entries and their order included; a rule missing from the
 * file goes after them, and a run with nothing to add writes nothing.
 */
function writeClaude(bots, home, bot) {
  const file = path.join(home, FILE);
  const allowed = allowOf(home, bot);
  const waiting = waitingFor(bots, home, bot, 'claude');
  const answer = { bot: bot.name, file, written: [], waiting };
  if (allowed.length === 0) return answer;

  refuseOutside(home, file);
  const settings = readSettings(file, 'the permission rules the user allowed');
  const present = presentIn(settings, file);
  const missing = [...new Set(allowed)].filter((rule) => !present.includes(rule));
  if (missing.length === 0) return answer;

  const wanted = { ...settings, permissions: { ...settings.permissions, allow: [...present, ...missing] } };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(wanted, null, 2)}\n`);
  return { ...answer, written: missing };
}

/**
 * The Codex form of what the bot is allowed: the file's rule lines, each once,
 * with the rules that gave them, and the rules Codex has no form for.
 */
function codexOf(home, bot) {
  const lines = new Map();
  const unwritten = [];
  for (const rule of allowOf(home, bot)) {
    const form = codexForm(rule);
    if (form.why !== undefined) unwritten.push({ rule, why: form.why });
    if (form.line === undefined) continue;
    lines.set(form.line, [...(lines.get(form.line) ?? []), rule]);
  }
  return { lines, unwritten };
}

/** The lines of a rules file that are rules: not blank, not a comment. */
const ruleLines = (text) => text.split('\n').map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#'));

/**
 * Write the Codex form of what the bot is allowed into `.codex/rules/obk.rules`:
 * `{ bot, file, written, waiting, unwritten }`, with `written` every rule in
 * the file when this run wrote it. The kit owns the file whole and writes it
 * only when it would change; with nothing to write and no file, it makes none.
 */
function writeCodex(bots, home, bot) {
  const file = path.join(home, CODEX_FILE);
  const { lines, unwritten } = codexOf(home, bot);
  const answer = { bot: bot.name, file, written: [], waiting: waitingFor(bots, home, bot, 'codex'), unwritten };
  if (lines.size === 0 && !existsSync(file)) return answer;

  refuseOutside(home, file);
  const text = [
    `# Written by obk from ${bot.name}'s bot.yaml, where the user's yes to each rule is kept.`,
    '# obk rewrites this whole file: put rules of your own in another file in this folder.',
    ...lines.keys(),
  ].join('\n');
  if (existsSync(file) && readFileSync(file, 'utf8') === `${text}\n`) return answer;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${text}\n`);
  return { ...answer, written: [...lines.values()].flat() };
}

/**
 * What health has to say about a bot's permission rules: `{ where, says }` for
 * each entry in the file that `allow` does not hold, and each rule `allow`
 * holds that the file lacks. Read only: an entry the kit did not write is named,
 * never taken out.
 */
export function permissionsTrouble(home, bot) {
  let allowed;
  try {
    allowed = allowOf(home, bot);
  } catch (error) {
    if (!runsOnClaude(bot) && !runsOnCodex(bot)) return [];
    return [{ where: path.join(home, 'bot.yaml'), says: error.message }];
  }
  return [...claudeTrouble(home, bot, allowed), ...codexTrouble(home, bot)];
}

/** Health's findings in the bot's Claude settings. */
function claudeTrouble(home, bot, allowed) {
  if (!runsOnClaude(bot)) return [];
  const file = path.join(home, FILE);
  if (!existsSync(file) && allowed.length === 0) return [];

  // A link out of the bot folder is named by the hook's check already; here it
  // matters only when there are rules the kit would write through it.
  if (allowed.length === 0 && leadsOutside(home, file) !== undefined) return [];

  let present;
  try {
    refuseOutside(home, file);
    present = presentIn(readSettings(file, 'the permission rules the user allowed'), file);
  } catch (error) {
    return [{ where: file, says: error.message }];
  }

  return [
    ...present.filter((rule) => !allowed.includes(rule)).map((rule) => ({
      where: file,
      // One `--allow` would refuse was added by the user by hand, which the
      // boundary leaves to them: named, in neutral words, and left alone.
      says: broadness(rule) === undefined
        ? `${file} allows ${rule}, and ${bot.name}'s bot.yaml does not: the kit did not write it. It stays where it is. If the user wants it, record their yes with obk bot change --allow; if not, take it out of the file.`
        : `${file} allows ${rule}, which the user added by hand, not the kit. It stays where it is.`,
    })),
    ...allowed.filter((rule) => !present.includes(rule)).map((rule) => ({
      where: file,
      says: `${file} does not hold ${rule}, which ${bot.name}'s bot.yaml allows, so ${bot.name}'s Claude sessions are asked about it. obk up writes it.`,
    })),
  ];
}

/**
 * Health's findings in the bot's Codex rules: each rule in a file of the
 * user's beside obk.rules, named and left alone, and an obk.rules that is not
 * what the kit writes from `allow`.
 */
function codexTrouble(home, bot) {
  if (!runsOnCodex(bot)) return [];
  const folder = path.join(home, CODEX_RULES);
  const file = path.join(home, CODEX_FILE);
  const { lines } = codexOf(home, bot);
  if (leadsOutside(home, file) !== undefined) {
    if (lines.size === 0) return [];
    try {
      refuseOutside(home, file);
    } catch (error) {
      return [{ where: file, says: error.message }];
    }
  }

  // A file health cannot read is one finding of its own, and the rest of the
  // fleet's health still comes out.
  const unread = (where, error) => [{ where, says: `${where} could not be read (${error.code ?? error.message}), so health cannot say what it holds. It stays where it is.` }];
  let names = [];
  try {
    names = existsSync(folder) ? readdirSync(folder) : [];
  } catch (error) {
    return unread(folder, error);
  }
  const theirs = names
    .filter((name) => name.endsWith('.rules') && name !== path.basename(file))
    .sort()
    .flatMap((name) => {
      const where = path.join(folder, name);
      let text;
      try {
        text = readFileSync(where, 'utf8');
      } catch (error) {
        return unread(where, error);
      }
      return ruleLines(text).map((line) => ({
        where,
        says: `${where} holds ${line}, which the user added, not the kit. It stays where it is.`,
      }));
    });

  const wanted = [...lines.keys()];
  let present = [];
  try {
    present = existsSync(file) ? ruleLines(readFileSync(file, 'utf8')) : [];
  } catch (error) {
    return [...theirs, ...unread(file, error)];
  }
  const missing = wanted.filter((line) => !present.includes(line));
  const extra = present.filter((line) => !wanted.includes(line));
  if (missing.length === 0 && extra.length === 0) return theirs;
  const what = [
    ...(missing.length === 0 ? [] : [`it lacks ${missing.join(' and ')}, which ${bot.name}'s bot.yaml allows`]),
    ...(extra.length === 0 ? [] : [`it holds ${extra.join(' and ')}, which the kit did not write`]),
  ].join(', and ');
  return [...theirs, {
    where: file,
    says: `${file} is not what the kit writes from ${bot.name}'s bot.yaml: ${what}. The kit owns this file, and obk up rewrites it; a rule of the user's own goes in another file in ${folder}.`,
  }];
}

/** The file's `permissions.allow`, or a refusal when it is there and is not a list. */
function presentIn(settings, file) {
  const permissions = settings.permissions;
  if (permissions === undefined) return [];
  if (permissions === null || typeof permissions !== 'object' || Array.isArray(permissions)) {
    throw new Error(`${file} has a permissions entry that is not a mapping, and the permission rules the user allowed go in it. Fix it or move it aside, then run the command again.`);
  }
  if (permissions.allow === undefined) return [];
  if (!Array.isArray(permissions.allow)) {
    throw new Error(`${file} has a permissions.allow entry that is not a list, and the permission rules the user allowed go in it. Fix it or move it aside, then run the command again.`);
  }
  return permissions.allow;
}

/** The kit writes a bot's settings in the bot folder and nowhere else (ADR 0022). */
function refuseOutside(home, file) {
  const real = leadsOutside(home, file);
  if (real === undefined) return;
  throw new Error(`${file} leads outside the bot folder, to ${real}, through a link, and the kit writes permission rules only inside the bot folder. Replace the link with a file of the bot's own, then run the command again.`);
}
