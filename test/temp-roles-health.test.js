// `obk health` checks a bot's temp_roles (#465).
//
// A role is a list of options, or a mapping `{ options, cap, prompt_file }`
// with only `options` required; an option is a mapping with `name` required
// and any of `for`, `harness` (claude or codex), `model`, `effort`, `context`.
// A malformed role is a finding of kind 'config', `bot` the bot's name,
// `where` that bot's bot.yaml, and `says` naming the role, and the option
// where one is at fault. Malformed is: an option's harness not claude or
// codex; a prompt_file that cannot be read; a cap that is not a positive whole
// number; a role with no options; an option with no name, or a name that is not
// a string (`name: 1`, `name: true`, review of PR #470); two options of one
// name; a key the kit does not know in an option or a role mapping. The
// wording of `says` is not pinned.
//
// A good temp_roles gives no finding, and `temp_roles` is a key the kit knows
// at the top of bot.yaml (today every unknown top-level key is reported,
// #273).
//
// The bot has two roles, and each case breaks one: the finding must name the
// broken one and no finding may name the other, so a check that reported the
// whole of temp_roles, or the first role it met, does not pass. The option
// names differ between the two roles for the same reason.
//
// Everything goes through the CLI on a sandboxed bots folder, against the fake
// Orca, the way test/health-unknown-keys.test.js does.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import { botHomeOf, createSandbox } from './helpers/cli.js';
import { botYamlOf } from './helpers/skills.js';

const BOT = 'api-bot';

/** Two good roles: one a plain list, one a mapping with a cap and a prompt file. */
const GOOD = () => ({
  developer: [
    { name: 'standard', model: 'opus', effort: 'high', for: 'most issues' },
    { name: 'deep', model: 'opus', effort: 'max', context: '1m', for: 'hard causes' },
  ],
  reviewer: {
    cap: 2,
    prompt_file: 'reviewer.md',
    options: [
      { name: 'thorough', harness: 'codex', model: 'gpt-6.1-sol', effort: 'xhigh', for: 'most reviews' },
      { name: 'light', harness: 'claude', model: 'sonnet', effort: 'medium', for: 'small diffs' },
    ],
  },
});

/** A bots folder with Bot Father, and api-bot with one session, brought up, and its reviewer prompt file. */
async function seeded(box) {
  for (const args of [
    ['init', '--bots', 'bots', '--harness', 'claude'],
    ['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude'],
    ['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily'],
    ['up', '--bots', 'bots', '--bot', BOT],
  ]) {
    const result = await box.run(args);
    assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  }
  const bots = box.path('bots');
  await writeFile(path.join(botHomeOf(bots, BOT), 'reviewer.md'), 'You review one pull request.\n');
  return bots;
}

/** Give api-bot these roles, in its bot.yaml, which is the user's file and theirs to edit. */
async function setRoles(bots, roles) {
  const file = botYamlOf(bots, BOT);
  const doc = parse(await readFile(file, 'utf8')) ?? {};
  doc.temp_roles = roles;
  await writeFile(file, stringify(doc));
}

/** Run the health check for JSON: findings, and exit 1 when there are any, 0 when none. */
async function found(box) {
  const result = await box.run(['health', '--bots', 'bots', '--json']);
  assert.equal(result.stderr, '', `a health run reports on stdout, and put this on stderr: ${result.stderr}`);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.found), `the answer should carry a list of findings, got: ${result.stdout}`);
  assert.equal(result.code, answer.found.length === 0 ? 0 : 1, `exit code for ${answer.found.length} findings`);
  return answer;
}

/** api-bot's config findings. */
const configOf = (answer) => answer.found.filter((one) => one.kind === 'config' && one.bot === BOT);

const show = (value) => JSON.stringify(value, null, 2);

test('H a good temp_roles gives no config finding, and temp_roles is not an unknown key', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await setRoles(bots, GOOD());

  const answer = await found(box);

  assert.deepEqual(configOf(answer), [], `two good roles have nothing to report, got: ${show(answer.found)}`);
  assert.deepEqual(
    answer.found.filter((one) => typeof one.says === 'string' && one.says.includes('temp_roles')),
    [],
    `temp_roles is a key the kit knows, got: ${show(answer.found)}`,
  );
});

/**
 * Each malformed role: what breaks it, the role and option the finding must
 * name, and the role that is still good, which no finding may name.
 */
const MALFORMED = [
  ['an option with a harness the kit does not know', (r) => { r.reviewer.options[0].harness = 'emacs'; }, ['reviewer', 'thorough'], 'developer'],
  ['an option with a harness the kit does not know, in a role written as a list', (r) => { r.developer[1].harness = 'vim'; }, ['developer', 'deep'], 'reviewer'],
  ['a prompt_file that cannot be read', (r) => { r.reviewer.prompt_file = 'no-such-duty.md'; }, ['reviewer'], 'developer'],
  ['a cap of 0', (r) => { r.reviewer.cap = 0; }, ['reviewer'], 'developer'],
  ['a cap of -1', (r) => { r.reviewer.cap = -1; }, ['reviewer'], 'developer'],
  ['a cap of 1.5', (r) => { r.reviewer.cap = 1.5; }, ['reviewer'], 'developer'],
  ['a cap of "two"', (r) => { r.reviewer.cap = 'two'; }, ['reviewer'], 'developer'],
  ['a role that is an empty list', (r) => { r.reviewer = []; }, ['reviewer'], 'developer'],
  ['a role mapping with no options', (r) => { delete r.reviewer.options; }, ['reviewer'], 'developer'],
  ['a role mapping with an empty list of options', (r) => { r.reviewer.options = []; }, ['reviewer'], 'developer'],
  ['an option with no name', (r) => { delete r.reviewer.options[1].name; }, ['reviewer'], 'developer'],
  // A name YAML reads as a number or a boolean can never be picked by --role (review of PR #470).
  ['an option whose name is a number', (r) => { r.reviewer.options[1].name = 1; }, ['reviewer'], 'developer'],
  ['an option whose name is true', (r) => { r.reviewer.options[1].name = true; }, ['reviewer'], 'developer'],
  ['two options of the same name', (r) => { r.reviewer.options[1].name = 'thorough'; }, ['reviewer', 'thorough'], 'developer'],
  ['an option key the kit does not know', (r) => { r.reviewer.options[1].efort = 'high'; delete r.reviewer.options[1].effort; }, ['reviewer', 'light'], 'developer'],
  ['a role-mapping key the kit does not know', (r) => { r.reviewer.limit = 3; }, ['reviewer'], 'developer'],
];

for (const [label, breakIt, named, good] of MALFORMED) {
  test(`H a role with ${label} is a config finding on the bot's bot.yaml naming ${named.join(' and ')}`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    const roles = GOOD();
    breakIt(roles);
    await setRoles(bots, roles);

    const answer = await found(box);

    const config = configOf(answer);
    const about = config.filter((one) => typeof one.says === 'string' && named.every((word) => one.says.includes(word)));
    assert.ok(about.length >= 1, `a config finding about ${BOT} should name ${named.join(' and ')}, got: ${show(answer.found)}`);
    for (const finding of about) {
      assert.equal(finding.where, botYamlOf(bots, BOT), `the finding points at the file to open, got: ${show(finding)}`);
    }
    assert.deepEqual(
      config.filter((one) => typeof one.says === 'string' && one.says.includes(good)),
      [],
      `${good} is a good role and is not reported, got: ${show(config)}`,
    );
  });
}
