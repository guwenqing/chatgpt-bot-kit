// `obk health` on a rule the user put in a bot's settings file by hand, one
// `bot change --allow` would refuse as broad (#353, slice B of #344).
//
// Slice A names every entry in the bot's `.claude/settings.json`
// `permissions.allow` that bot.yaml `allow` does not hold, and points at
// `obk bot change --allow` to record the user's yes. For an entry `--allow`
// would refuse, that pointer would lead to a refusal. So such an entry is
// still named, as a config finding naming the file and the entry, but in
// neutral words: it was added by hand, by the user, not by the kit, and it
// stays where it is. The finding does not point at `bot change --allow`, and
// does not call the rule broad, unsafe, dangerous or risky. A foreign entry
// `--allow` would accept keeps slice A's pointer.
//
// The words read here are only those: the entry, the file, the command and
// the four judging words, and that it speaks of the hand or the user. The
// rest of the sentence is the implementer's.

import assert from 'node:assert/strict';
import { mkdir, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createSandbox } from './helpers/cli.js';
import { settingsIn, settingsOf } from './helpers/permissions.js';

const BOT = 'api-bot';
const PAST = new Date('2020-01-01T00:00:00Z');

/** An entry a user might add by hand that `--allow` accepts: exact, no wildcard. */
const NARROW_FOREIGN = 'Bash(curl -s https://example.com)';

/** A fleet up in Orca: Bot Father, and one more Claude bot with a daily session. */
async function fleet(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude']);
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

/** Whether a finding points at `file`, by its `where` or in what it says. */
const names = (finding, file) => finding.where === file || (typeof finding.says === 'string' && finding.says.includes(file));

/**
 * The one finding that names `entry`: a config finding about the bot, naming
 * its settings file.
 */
function findingOf(found, entry, bots) {
  const said = found.filter((one) => typeof one.says === 'string' && one.says.includes(entry));
  assert.equal(said.length, 1, `one finding should name ${entry} verbatim, got: ${show(found)}`);
  assert.equal(said[0].kind, 'config', `got: ${show(said[0])}`);
  assert.equal(said[0].bot, BOT, `got: ${show(said[0])}`);
  assert.ok(names(said[0], settingsOf(bots, BOT)), `the finding should name ${settingsOf(bots, BOT)}, got: ${show(said[0])}`);
  return said[0];
}

/** The neutral finding: by hand or by the user, no pointer at --allow, and no judging word. */
function assertNeutral(finding, entry) {
  const { says } = finding;
  assert.match(says, /\bhand\b|\buser\b/i, `it should say ${entry} was added by hand, by the user, got: ${says}`);
  assert.ok(!says.includes('--allow'), `--allow would refuse ${entry}, so the finding should not point at it, got: ${says}`);
  assert.ok(!says.includes('bot change'), `nor at bot change, got: ${says}`);
  assert.doesNotMatch(says, /broad|unsafe|dangerous|risky/i, `the finding should not judge the user's own rule, got: ${says}`);
}

/** The settings file as bytes and mtime, with the mtime set back first so a rewrite shows. */
async function frozen(bots) {
  const file = settingsOf(bots, BOT);
  await utimes(file, PAST, PAST);
  return { text: await readFile(file, 'utf8'), mtime: PAST.getTime() };
}

async function assertUnchanged(bots, was) {
  const file = settingsOf(bots, BOT);
  assert.equal(await readFile(file, 'utf8'), was.text, 'health never changes the settings file: the entry stays where it is');
  assert.equal((await stat(file)).mtime.getTime(), was.mtime, 'not even to write the same thing back');
}

// ----------------------------------------------------------------- an entry --allow would refuse

for (const entry of [
  'Bash(/Applications/Orca.app/Contents/Resources/bin/orca:*)',
  'Bash(gh:*)',
  'Bash(python3 -c:*)',
  'Bash',
  'Read(//**)',
]) {
  test(`K1 a hand-added ${entry} is named in neutral words, with no pointer at bot change --allow`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await handAllow(bots, [entry]);
    const was = await frozen(bots);

    const found = await health(box);

    assertNeutral(findingOf(found, entry, bots), entry);
    await assertUnchanged(bots, was);
  });
}

// ----------------------------------------------------------------- an entry --allow would accept

test('K2 a hand-added entry --allow would accept keeps the pointer at obk bot change --allow', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await handAllow(bots, [NARROW_FOREIGN]);
  const was = await frozen(bots);

  const found = await health(box);

  const { says } = findingOf(found, NARROW_FOREIGN, bots);
  assert.ok(says.includes('bot change') && says.includes('--allow'), `the user can record a yes to it, so say how, got: ${says}`);
  await assertUnchanged(bots, was);
});

test('K3 side by side, each entry gets its own wording: the pointer for the one --allow accepts, none for the one it refuses', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  const broad = 'Bash(gh:*)';
  await handAllow(bots, [broad, NARROW_FOREIGN]);
  const was = await frozen(bots);

  const found = await health(box);

  assertNeutral(findingOf(found, broad, bots), broad);
  const narrow = findingOf(found, NARROW_FOREIGN, bots);
  assert.ok(narrow.says.includes('--allow'), `the narrow one keeps its pointer, got: ${narrow.says}`);
  await assertUnchanged(bots, was);
});
