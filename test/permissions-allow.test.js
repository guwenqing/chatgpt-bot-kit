// Recording the user's yes: `obk bot change --allow <rule>` and the `allow`
// list in `bot.yaml` (#344 slice A).
//
// `allow` is a list of exact Claude Code permission rule strings the user
// allowed for this bot; missing means none. `bot change --bots <B> --bot <X>
// --allow <rule> [--allow <rule> ...]` adds each rule to it, in the order given,
// after the ones already there, and never a second copy of one that is there.
// Everything else in bot.yaml is kept. `--charter` is no longer required when
// `--allow` is given; one of the two must be, and both together do both. An
// empty `--allow ''` is refused and nothing is written. The change is written
// into the bot's Claude settings at once, as `rules build` would write it. The
// plain report names each rule added; `--json` carries `allow`, the whole list
// after the change.
//
// A value of `allow` that is not a list of strings is a config problem named
// with the file, as a bad `rules` or `skills` is: `rules build` fails that bot,
// naming its bot.yaml, and `health` names it as a config finding.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  assertCleanFailure,
  assertKeptWhatTheyWrote,
  assertNoTrailingSpace,
  createSandbox,
  skipGit,
  snapshot,
} from './helpers/cli.js';
import {
  allowedIn,
  allowOf,
  defaultRules,
  OWN_RULE,
  settingsOf,
} from './helpers/permissions.js';
import { botYamlOf } from './helpers/skills.js';

const BOT = 'api-bot';
const CHARTER = 'Api Bot owns the API. Good is a green build. Ask before a release.';
const NEW_CHARTER = 'Api Bot owns the API and its docs. Ask before deleting a page.';

/** A bots folder `init` made, with one Claude bot of its own, one session, and nothing allowed. */
async function withBot(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude', '--charter', CHARTER]);
  assert.equal(made.code, 0, made.stderr);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily']);
  assert.equal(added.code, 0, added.stderr);
  return box.path('bots');
}

const change = (box, ...rest) => box.run(['bot', 'change', '--bots', 'bots', '--bot', BOT, ...rest]);

/** `--allow <rule>` for each rule, in order. */
const allowing = (...rules) => rules.flatMap((rule) => ['--allow', rule]);

const botText = (bots) => readFile(botYamlOf(bots, BOT), 'utf8');

// ----------------------------------------------------------------- adding

test('A1 --allow adds the rules to allow in the order given, with no --charter, and the charter stays', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const [check, , , read] = defaultRules(box, bots);
  const before = await botText(bots);

  const result = await change(box, ...allowing(read, OWN_RULE, check));

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await allowOf(bots, BOT), [read, OWN_RULE, check]);
  const after = await botText(bots);
  assert.equal(parse(after).charter.trim(), CHARTER, 'no --charter, so the charter is the one it had');
  assertKeptWhatTheyWrote(before, after, { changed: ['allow'] });
});

test('A1 the user\'s own comments and keys in bot.yaml survive an --allow', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const mine = `# my own notes about this bot
name: api-bot
harness: claude
charter: |
  ${CHARTER}
notes: keep me            # a key the kit knows nothing about
rules: []
skills: []
sessions:
  - name: daily           # my session
    approval: auto
`;
  await writeFile(botYamlOf(bots, BOT), mine);

  const result = await change(box, ...allowing('Bash(git add:*)'));

  assert.equal(result.code, 0, result.stderr);
  const after = await botText(bots);
  assertKeptWhatTheyWrote(mine, after, { changed: ['allow'] });
  assertNoTrailingSpace(after);
  assert.deepEqual(parse(after).allow, ['Bash(git add:*)']);
  assert.ok(after.includes('# a key the kit knows nothing about'), `the user's comment should have survived:\n${after}`);
});

test('A2 new rules go after the ones already there, and a rule already there is not added twice', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const [check, send, , , add, commit] = defaultRules(box, bots);
  assert.equal((await change(box, ...allowing(add, check))).code, 0);

  const result = await change(box, ...allowing(commit, check, send, commit));

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await allowOf(bots, BOT), [add, check, commit, send]);
});

test('A3 --charter and --allow together do both', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);

  const result = await change(box, '--charter', NEW_CHARTER, ...allowing(OWN_RULE));

  assert.equal(result.code, 0, result.stderr);
  const doc = parse(await botText(bots));
  assert.equal(doc.charter.trim(), NEW_CHARTER);
  assert.deepEqual(doc.allow, [OWN_RULE]);
  assert.deepEqual(await allowedIn(bots, BOT), [OWN_RULE]);
});

for (const [label, args] of [
  ['an empty --allow', ['--allow', '']],
  ['an empty --allow beside a good one', ['--allow', 'Bash(git add:*)', '--allow', '']],
]) {
  test(`A4 ${label} is refused, and nothing is written`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    const before = await snapshot(bots, skipGit);

    const result = await change(box, ...args);

    assertCleanFailure(result);
    assert.ok(result.stderr.includes('--allow'), `the refusal should name --allow, got: ${result.stderr}`);
    assert.deepEqual(await snapshot(bots, skipGit), before, 'a refusal writes nothing: not bot.yaml, not the settings');
  });
}

// ----------------------------------------------------------------- written at once

test('A5 the allowed rules are in the bot\'s Claude settings as soon as bot change returns', async (t) => {
  // No rules build and no up in between: the change writes them itself.
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const [, , , read, add] = defaultRules(box, bots);

  const result = await change(box, ...allowing(add, read));

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await allowedIn(bots, BOT), [add, read], `${settingsOf(bots, BOT)} should allow them now`);
});

// ----------------------------------------------------------------- the report

test('A6 the report names each rule added, and --json carries the whole allow list after the change', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const [check, , , , add] = defaultRules(box, bots);
  assert.equal((await change(box, ...allowing(add))).code, 0);

  const plain = await change(box, ...allowing(check, OWN_RULE));

  assert.equal(plain.code, 0, plain.stderr);
  for (const rule of [check, OWN_RULE]) {
    assert.ok(plain.stdout.includes(rule), `the report should name ${rule}, got:\n${plain.stdout}`);
  }

  const asJson = await change(box, ...allowing(add, 'Bash(git commit:*)'), '--json');
  assert.equal(asJson.code, 0, asJson.stderr);
  assert.equal(asJson.stderr, '');
  let parsed;
  try {
    parsed = JSON.parse(asJson.stdout);
  } catch (error) {
    assert.fail(`--json should print JSON and nothing else, got: ${asJson.stdout} (${error.message})`);
  }
  assert.deepEqual(parsed.allow, [add, check, OWN_RULE, 'Bash(git commit:*)']);
});

// ----------------------------------------------------------------- a value that is not a list of strings

for (const [label, value] of [
  ['a line of text', 'Bash(git add:*)'],
  ['a list holding a number', ['Bash(git add:*)', 42]],
  ['a mapping', { rule: 'Bash(git add:*)' }],
]) {
  test(`A7 an allow that is ${label} is a config problem named with the bot.yaml`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    assert.equal((await box.run(['up', '--bots', 'bots'])).code, 0);
    const doc = parse(await botText(bots));
    doc.allow = value;
    await writeFile(botYamlOf(bots, BOT), stringify(doc));

    const built = await box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT]);
    assert.equal(built.code, 1, `the build should fail this bot, got:\n${built.stdout}${built.stderr}`);
    const said = built.stdout + built.stderr;
    assert.ok(said.includes(botYamlOf(bots, BOT)), `and name its bot.yaml, got:\n${said}`);
    assert.ok(said.includes('allow'), `and say it is the allow entry, got:\n${said}`);
    assert.deepEqual(await allowedIn(bots, BOT), [], 'nothing of it reaches the settings');

    const health = await box.run(['health', '--bots', 'bots', '--json']);
    const found = JSON.parse(health.stdout).found.filter((one) => one.kind === 'config' && one.bot === BOT
      && typeof one.says === 'string' && one.says.includes('allow')
      && (one.where === botYamlOf(bots, BOT) || one.says.includes(botYamlOf(bots, BOT))));
    assert.equal(found.length, 1, `health should name it once, as a config finding about the bot.yaml, got: ${health.stdout}`);
    assert.equal(health.code, 1);
  });
}

// ----------------------------------------------------------------- a bad allow already there: nothing written

// `bot change --allow` onto a bot.yaml whose `allow` is not a list of non-empty
// strings is refused before anything is written: not bot.yaml (its charter
// included, when --charter comes too), not AGENTS.md, not the settings.
for (const [label, value] of [
  ['a list holding a number', [42]],
  ['a list holding an empty string', ['Bash(git commit:*)', '']],
  ['a list holding a mapping', [{ rule: 'Bash(git commit:*)' }]],
  ['a line of text', 'Bash(git commit:*)'],
  ['a mapping', { rule: 'Bash(git commit:*)' }],
]) {
  for (const [how, extra] of [
    ['--allow', []],
    ['--allow with --charter', ['--charter', NEW_CHARTER]],
  ]) {
    test(`A8 ${how} onto an allow that is ${label} is refused, and nothing is written`, async (t) => {
      const box = await createSandbox(t);
      const bots = await withBot(box);
      // A rule allowed first, so the settings hold one: they must not change either.
      assert.equal((await change(box, ...allowing(OWN_RULE))).code, 0);
      const doc = parse(await botText(bots));
      doc.allow = value;
      await writeFile(botYamlOf(bots, BOT), stringify(doc));
      const before = await snapshot(bots, skipGit);

      const result = await change(box, ...extra, ...allowing('Bash(git add:*)'));

      assertCleanFailure(result);
      assert.ok(result.stderr.includes(botYamlOf(bots, BOT)), `the refusal should name the bot.yaml, got: ${result.stderr}`);
      assert.ok(result.stderr.includes('allow'), `the refusal should say it is the allow entry, got: ${result.stderr}`);
      const now = await snapshot(bots, skipGit);
      const changed = Object.keys({ ...before, ...now }).filter((rel) => before[rel] !== now[rel]);
      assert.deepEqual(changed, [], `a refusal writes nothing: not bot.yaml, not AGENTS.md, not the settings. bot.yaml now:\n${await botText(bots)}`);
    });
  }
}
