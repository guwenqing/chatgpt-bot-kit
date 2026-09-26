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

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { leadsOutside } from './bot.js';
import { readSettings } from './hooks.js';
import { harnessOf, ownCli, shellWord } from './launch.js';

/** Where Claude Code reads a project's settings, inside the bot home. */
const FILE = '.claude/settings.json';

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

/**
 * Programs that run whatever their arguments tell them to: shells, interpreters
 * and command wrappers. With a wildcard after one of them, a rule lets the bot
 * run any command, unless the next word fixes the script by its absolute path.
 */
const RUNNERS = new Set([
  'sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'tcsh',
  'python', 'python2', 'python3', 'node', 'deno', 'bun', 'ruby', 'perl', 'php', 'osascript',
  'npx', 'pnpx', 'bunx', 'uvx',
  'env', 'xargs', 'sudo', 'eval', 'exec', 'nohup', 'timeout', 'nice', 'command', 'time', 'watch',
]);

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
  // The program is the first word after any shell assignments in front of it.
  const spec = (bash[1] ?? '').trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*/, '');
  const words = spec.split(/\s+/).filter((word) => word !== '');
  const star = spec.indexOf('*');
  if (words.length === 0) return 'it lets the bot run any command';
  if (star === -1) return undefined;

  const program = path.basename(words[0].replace(/:?\*.*$/, ''));
  if (RUNNERS.has(program)) {
    // Only a fixed script by its absolute path, itself no runner, narrows it.
    const next = (words[1] ?? '').replace(/:\*$/, '');
    const fixed = next.startsWith('/') && !next.includes('*') && !RUNNERS.has(path.basename(next));
    if (!fixed) return `${program} runs whatever its arguments say, so it lets the bot run any command`;
  }
  const before = spec.slice(0, star).replace(/:$/, '').split(/\s+/).filter((word) => word !== '');
  if (before.length === 0) return 'it lets the bot run any command';
  if (before.length < 2) return `it lets the bot run ${before[0]} with any arguments`;
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

/** The default rules this bot has not been allowed yet, in the default order. */
export function waitingFor(bots, home, bot) {
  if (!runsOnClaude(bot)) return [];
  const allowed = allowOf(home, bot);
  return defaultRules(bots).filter((rule) => !allowed.includes(rule));
}

/** The one command that allows `rules` for `bot`, as the user can run it. */
export const allowCommand = (bots, bot, rules) => [
  shellWord(ownCli()), 'bot', 'change', '--bots', shellWord(bots), '--bot', shellWord(bot),
  ...rules.flatMap((rule) => ['--allow', shellWord(rule)]),
].join(' ');

/**
 * Write what the bot is allowed into its Claude settings, and say what waits:
 * `{ bot, file, written, waiting }`, with `written` the rules this run added.
 * Nothing for a bot that does not run on Claude.
 *
 * Only rules `allow` holds are written. Everything else in the file stays as it
 * is, the user's own entries and their order included; a rule missing from the
 * file goes after them, and a run with nothing to add writes nothing.
 */
export function writePermissions(bots, home, bot) {
  if (!runsOnClaude(bot)) return undefined;
  const file = path.join(home, FILE);
  const allowed = allowOf(home, bot);
  const waiting = waitingFor(bots, home, bot);
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
 * What health has to say about a bot's permission rules: `{ where, says }` for
 * each entry in the file that `allow` does not hold, and each rule `allow`
 * holds that the file lacks. Read only: an entry the kit did not write is named,
 * never taken out.
 */
export function permissionsTrouble(home, bot) {
  if (!runsOnClaude(bot)) return [];
  const file = path.join(home, FILE);

  let allowed;
  try {
    allowed = allowOf(home, bot);
  } catch (error) {
    return [{ where: path.join(home, 'bot.yaml'), says: error.message }];
  }
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
