// `obk health` on the permission rules in a bot's `.claude/settings.json`
// (#344 slice A).
//
// Only the kit writes those rules, and only the ones the user said yes to. So
// for a bot that runs on Claude, health names each entry in the file's
// `permissions.allow` that bot.yaml `allow` does not hold: a finding of kind
// `config`, naming the file and the entry verbatim. It names an allowed rule
// the file is missing too (`obk up` writes it). It says nothing when the file
// and `allow` agree, and it never changes the file: an entry it did not write
// stays where it is. `allow` is a key the kit knows, so the unknown-key check
// does not name it.
//
// A finding "names the file" when its `where` is the file or its `says`
// carries the path; which of the two is the implementer's. Everything goes
// through the CLI on a sandboxed fleet that is up in the fake Orca, the way
// test/health-unknown-keys.test.js does.

import assert from 'node:assert/strict';
import { mkdir, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createSandbox } from './helpers/cli.js';
import {
  defaultRules,
  FOREIGN_RULE,
  OWN_RULE,
  settingsIn,
  settingsOf,
  writeAllow,
} from './helpers/permissions.js';
import { botYamlOf } from './helpers/skills.js';

const BOT = 'api-bot';
const PAST = new Date('2020-01-01T00:00:00Z');

/** A fleet up in Orca: Bot Father, and one more bot on `harness` with a daily session. */
async function fleet(box, harness = 'claude') {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily']);
  assert.equal(added.code, 0, added.stderr);
  const up = await box.run(['up', '--bots', 'bots', '--bot', BOT]);
  assert.equal(up.code, 0, up.stderr);
  return box.path('bots');
}

/** Put entries into the settings file's `permissions.allow` by hand, keeping what else is there. */
async function handAllow(bots, entries) {
  const file = settingsOf(bots, BOT);
  const settings = (await settingsIn(bots, BOT)) ?? {};
  settings.permissions = { ...settings.permissions, allow: entries };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);
}

/** Run the health check for JSON: the findings, with the exit code they call for. */
async function health(box) {
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
  return answer.found;
}

const show = (value) => JSON.stringify(value, null, 2);

/** The findings whose sentence carries `text`. */
const saying = (found, text) => found.filter((one) => typeof one.says === 'string' && one.says.includes(text));

/** Whether a finding points at `file`, by its `where` or in what it says. */
const names = (finding, file) => finding.where === file || (typeof finding.says === 'string' && finding.says.includes(file));

/** The settings file as bytes and mtime, with the mtime set back first so a rewrite shows. */
async function frozen(bots) {
  const file = settingsOf(bots, BOT);
  await utimes(file, PAST, PAST);
  return { text: await readFile(file, 'utf8'), mtime: PAST.getTime() };
}

async function assertUnchanged(bots, was) {
  const file = settingsOf(bots, BOT);
  assert.equal(await readFile(file, 'utf8'), was.text, 'health never changes the settings file');
  assert.equal((await stat(file)).mtime.getTime(), was.mtime, 'not even to write the same thing back');
}

// ----------------------------------------------------------------- an entry nobody allowed

test('H1 an entry in the settings that allow does not hold is a config finding naming the file and the entry', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await handAllow(bots, [FOREIGN_RULE]);
  const was = await frozen(bots);

  const found = await health(box);

  const said = saying(found, FOREIGN_RULE);
  assert.equal(said.length, 1, `one finding should name ${FOREIGN_RULE} verbatim, got: ${show(found)}`);
  assert.equal(said[0].kind, 'config', `got: ${show(said[0])}`);
  assert.equal(said[0].bot, BOT, `got: ${show(said[0])}`);
  assert.ok(names(said[0], settingsOf(bots, BOT)), `the finding should name ${settingsOf(bots, BOT)}, got: ${show(said[0])}`);
  await assertUnchanged(bots, was);
});

test('H1 an entry allow does not hold is named even beside allowed ones, and they are not', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const [, , , , add] = defaultRules(box, bots);
  const allowed = await box.run(['bot', 'change', '--bots', 'bots', '--bot', BOT, '--allow', add, '--allow', OWN_RULE]);
  assert.equal(allowed.code, 0, allowed.stderr);
  await handAllow(bots, [add, FOREIGN_RULE, OWN_RULE]);
  const was = await frozen(bots);

  const found = await health(box);

  assert.equal(saying(found, FOREIGN_RULE).length, 1, `the stray entry is named, got: ${show(found)}`);
  assert.deepEqual(saying(found, add), [], 'an allowed entry is not a finding');
  assert.deepEqual(saying(found, OWN_RULE), [], 'nor is any other allowed one');
  await assertUnchanged(bots, was);
});

// ----------------------------------------------------------------- an allowed rule the file is missing

test('H2 a rule allow holds and the file is missing is a finding naming the rule, and health does not write it', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const [, , , , , commit] = defaultRules(box, bots);
  await writeAllow(bots, BOT, [commit]);
  const was = await frozen(bots);

  const found = await health(box);

  const said = saying(found, commit);
  assert.equal(said.length, 1, `one finding should name ${commit}, got: ${show(found)}`);
  assert.equal(said[0].bot, BOT, `got: ${show(said[0])}`);
  await assertUnchanged(bots, was);
});

// ----------------------------------------------------------------- agreement

test('H3 when the file and allow agree, health says nothing about them, and does not call allow unknown', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const rules = [...defaultRules(box, bots), OWN_RULE];
  const allowed = await box.run(['bot', 'change', '--bots', 'bots', '--bot', BOT, ...rules.flatMap((rule) => ['--allow', rule])]);
  assert.equal(allowed.code, 0, allowed.stderr);
  const was = await frozen(bots);

  const found = await health(box);

  for (const rule of rules) {
    assert.deepEqual(saying(found, rule), [], `nothing to say about ${rule}, got: ${show(found)}`);
  }
  assert.deepEqual(found.filter((one) => names(one, settingsOf(bots, BOT))), [], `nor about the settings file, got: ${show(found)}`);
  assert.deepEqual(found.filter((one) => names(one, botYamlOf(bots, BOT))), [], `allow is a key the kit knows, got: ${show(found)}`);
  await assertUnchanged(bots, was);
});

test('H3 a Claude bot with nothing allowed and nothing in the file has nothing to hear', async (t) => {
  // The six defaults are waiting for a yes; that is not a disagreement.
  const box = await createSandbox(t);
  const bots = await fleet(box);

  const found = await health(box);

  assert.deepEqual(found.filter((one) => names(one, settingsOf(bots, BOT))), [], `got: ${show(found)}`);
  for (const rule of defaultRules(box, bots)) {
    assert.deepEqual(saying(found, rule), [], `got: ${show(found)}`);
  }
});

// ----------------------------------------------------------------- only Claude

test('H4 a bot that runs only on Codex is not held to a Claude settings file', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box, 'codex');
  await handAllow(bots, [FOREIGN_RULE]);

  const found = await health(box);

  assert.deepEqual(saying(found, FOREIGN_RULE), [], `the bot does not run on Claude, got: ${show(found)}`);
});
