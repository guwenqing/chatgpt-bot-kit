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
      says: `${file} allows ${rule}, and ${bot.name}'s bot.yaml does not: the kit did not write it. It stays where it is. If the user wants it, record their yes with obk bot change --allow; if not, take it out of the file.`,
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
