// Reading and writing what #344 slice A is about: the Claude Code permission
// rules the kit writes into a bot's own `.claude/settings.json`, the `allow`
// list in `bot.yaml` that holds the user's yes, and the answers that show which
// of the kit's default rules still wait for one.
//
// The default set is spelled here from the requirement, not from the code: the
// kit's CLI as it names itself in the commands it prints (`box.cli`, as
// `shellWord` spells it), and the bots folder as the command was given it,
// absolute. Four test files need the same set and the same reading, so it lives
// here rather than four times.
//
// #354 (slice C) writes the same yes for a bot that runs on Codex, in Codex's
// own form, into `<bot home>/.codex/rules/obk.rules`: one
// `prefix_rule(pattern=[...], decision="allow")` line per rule, each word a
// JSON string. The Codex lines are spelled here from that requirement too.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';

import { botHomeOf, hookFileOf, hooksIn, shellWord } from './cli.js';
import { botYamlOf } from './skills.js';

/**
 * The six rules every Claude bot is offered, in the order the requirement gives
 * them: the kit's mail (check, send, to) for this bots folder, reading long
 * message bodies beside it (`//` is Claude's absolute-path form, and the path
 * there is plain, not shell-quoted), and the commit rule.
 */
export function defaultRules(box, bots) {
  const cli = shellWord(box.cli);
  const word = shellWord(bots);
  return [
    `Bash(${cli} message check --bots ${word}:*)`,
    `Bash(${cli} message send --bots ${word}:*)`,
    `Bash(${cli} message to --bots ${word}:*)`,
    `Read(/${bots}.messages/**)`,
    'Bash(git add:*)',
    'Bash(git commit:*)',
  ];
}

/**
 * The five rules a bot that runs only on Codex is offered: the six, in their
 * order, without the Read rule, since Codex's sandbox reads every file already.
 */
export const codexDefaultRules = (box, bots) => defaultRules(box, bots).filter((rule) => !rule.startsWith('Read('));

/** The Read rule of the six: the one a Codex-only bot is not offered. */
export const readDefault = (box, bots) => defaultRules(box, bots)[3];

/**
 * One line of a Codex rules file that allows commands starting with `words`,
 * as the requirement spells it: each word a JSON string literal, joined by
 * `, `.
 */
export const prefixRule = (words) => `prefix_rule(pattern=[${words.map((word) => JSON.stringify(word)).join(', ')}], decision="allow")`;

/**
 * The Codex lines for the five default Bash rules, in their order. The CLI and
 * the bots folder are plain words here, whatever quoting `shellWord` gave them
 * inside the Claude rule.
 */
export const codexDefaultLines = (box, bots) => [
  prefixRule([box.cli, 'message', 'check', '--bots', bots]),
  prefixRule([box.cli, 'message', 'send', '--bots', bots]),
  prefixRule([box.cli, 'message', 'to', '--bots', bots]),
  prefixRule(['git', 'add']),
  prefixRule(['git', 'commit']),
];

/** The bot's own Codex rules file, which the kit owns whole. */
export const codexRulesOf = (bots, bot) => path.join(botHomeOf(bots, bot), '.codex', 'rules', 'obk.rules');

/**
 * The rule lines of a Codex rules file, in the file's order: every line but
 * blank ones and `#` comments. Undefined when there is no file.
 */
export async function codexLinesIn(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  return text.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'));
}

/** The rule lines of the bot's obk.rules: an empty list for no file. */
export const codexAllowedIn = async (bots, bot) => (await codexLinesIn(codexRulesOf(bots, bot))) ?? [];

/** A rule no default is: one a user might say yes to for one bot of their own. */
export const OWN_RULE = 'Bash(gh pr merge:*)';

/** A rule nobody said yes to, as a hand edit might leave it in the settings file. */
export const FOREIGN_RULE = 'Bash(curl:*)';

/**
 * The one command that allows `rules` for `bot`, as the requirement spells it:
 * the kit's CLI, `bot change`, the bots folder and the bot, then one `--allow`
 * per rule, each word as `shellWord` gives it.
 */
export const allowCommand = (box, bots, bot, rules) => [
  shellWord(box.cli), 'bot', 'change', '--bots', shellWord(bots), '--bot', shellWord(bot),
  ...rules.flatMap((rule) => ['--allow', shellWord(rule)]),
].join(' ');

/**
 * The allow command a plain report offers for `bot`: the line holding
 * `bot change` and `--bot <bot>`, from the CLI's first word to the end of the
 * line. Exactly one such line, since the requirement asks for one command.
 */
export function offeredCommand(box, stdout, bot) {
  const lines = stdout.split('\n').filter((line) => line.includes(' bot change ') && line.includes(` --bot ${shellWord(bot)} `));
  assert.equal(lines.length, 1, `one command should allow what waits for ${bot}, got:\n${stdout}`);
  const [line] = lines;
  const starts = [shellWord(box.cli), `'${box.cli}'`].map((cli) => line.indexOf(cli)).filter((at) => at >= 0);
  assert.notEqual(starts.length, 0, `the command should start with the kit's own CLI (${box.cli}), got: ${line}`);
  return line.slice(Math.min(...starts)).trim().replace(/`$/, '');
}

/** The answer of a `--json` run, parsed, with the `permissions` list the requirement gives it. */
export function jsonOf(result) {
  assert.equal(result.code, 0, `the run should have gone through, got:\n${result.stdout}${result.stderr}`);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.permissions), `the answer should carry a permissions list, got: ${result.stdout}`);
  return answer;
}

/** The one `permissions` entry about `bot`. */
export function waitingOf(answer, bot) {
  const found = answer.permissions.filter((entry) => entry.bot === bot);
  assert.equal(found.length, 1, `one permissions entry should be about ${bot}, got: ${JSON.stringify(answer.permissions)}`);
  assert.ok(Array.isArray(found[0].waiting), `waiting should be a list, got: ${JSON.stringify(found[0])}`);
  return found[0].waiting;
}

/**
 * The one `permissions` entry about `bot` and `file`: for a bot that runs on
 * both harnesses there is one per harness file.
 */
export function entryAt(answer, bot, file) {
  const found = answer.permissions.filter((entry) => entry.bot === bot && entry.file === file);
  assert.equal(found.length, 1, `one permissions entry should be about ${bot} and ${file}, got: ${JSON.stringify(answer.permissions)}`);
  return found[0];
}

/** The bots a `permissions` list is about, in the order it gives them. */
export const permissionBots = (answer) => answer.permissions.map((entry) => entry.bot);

/** The bot's own Claude settings file. */
export const settingsOf = (bots, bot) => hookFileOf(bots, bot, 'claude');

/** The bot's Claude settings, parsed, or undefined when there is no file. */
export const settingsIn = (bots, bot) => hooksIn(bots, bot, 'claude');

/** What the bot's Claude settings allow, in the file's order: an empty list for no file or no list. */
export const allowedIn = async (bots, bot) => (await settingsIn(bots, bot))?.permissions?.allow ?? [];

/** The bot's `bot.yaml`, parsed. */
export const botYamlIn = async (bots, bot) => parse(await readFile(botYamlOf(bots, bot), 'utf8')) ?? {};

/** The yes the bot's `bot.yaml` holds: missing means none. */
export const allowOf = async (bots, bot) => (await botYamlIn(bots, bot)).allow ?? [];

/** Set `allow` in a `bot.yaml` by hand, the way a user editing the file would, and not through the kit. */
export async function writeAllow(bots, bot, allow) {
  const doc = await botYamlIn(bots, bot);
  doc.allow = allow;
  await writeFile(botYamlOf(bots, bot), stringify(doc));
}

/** Whether a plain report names `file`: by its full path, or by its path from the folder the command ran in. */
export const namesFile = (text, box, file) => text.includes(file) || text.includes(path.relative(box.cwd, file));

/** Which of `rules` appear anywhere in `text`: an empty list when none does. */
export const mentionsAny = (text, rules) => rules.filter((rule) => text.includes(rule));
