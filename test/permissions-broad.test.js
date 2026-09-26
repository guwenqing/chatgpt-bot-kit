// `obk bot change --allow` takes only narrow, exact rules (#353, slice B of
// #344).
//
// A charter's grants become exact rules, and the kit records a yes to them
// through `bot change --allow`. A broad rule is not one the kit records: when
// any `--allow` value is broad, the whole command is refused (exit 1, the
// message on stderr, as slice A's refusals are) and nothing is written, not
// bot.yaml (neither `allow` nor the charter when `--charter` comes too) and
// not the settings file. The refusal names the rule and the bot's settings
// file, `<bot home>/.claude/settings.json`, where the user may add it
// themselves. Why it is broad is said in plain words; that wording is the
// implementer's and is not read here.
//
// Broad, from the requirement:
//   a. a Bash rule that matches any command;
//   b. a `*` inside the program word;
//   c. a wildcard with fewer than two words before the first `*`;
//   d. a shell, interpreter or command wrapper as the program (by the program
//      word's basename) with a wildcard, unless the word after it is a fixed
//      absolute path: no `*` in it, and no shell, interpreter or wrapper by
//      its basename;
//   e. Read, Edit or Write on the whole disk or the whole home.
// The program is the first word after any leading shell assignments
// (NAME=value words), and c and d are judged on it and the words after it.
// Everything else is accepted exactly as slice A accepts it, the kit's six
// defaults first of all.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';

import {
  assertCleanFailure,
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
const NEW_CHARTER = 'Api Bot owns the API and its docs. It closes issues without asking.';

/** A bots folder `init` made, with one Claude bot of its own and one session. */
async function withBot(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude', '--charter', CHARTER]);
  assert.equal(made.code, 0, made.stderr);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily']);
  assert.equal(added.code, 0, added.stderr);
  return box.path('bots');
}

/**
 * The same, with one rule already allowed, so the settings file holds
 * something a refusal must leave as it is.
 */
async function withAllowedBot(box) {
  const bots = await withBot(box);
  const first = await change(box, ...allowing(OWN_RULE));
  assert.equal(first.code, 0, first.stderr);
  assert.deepEqual(await allowedIn(bots, BOT), [OWN_RULE], 'the premise: the settings file holds the rule allowed first');
  return bots;
}

const change = (box, ...rest) => box.run(['bot', 'change', '--bots', 'bots', '--bot', BOT, ...rest]);

/** `--allow <rule>` for each rule, in order. */
const allowing = (...rules) => rules.flatMap((rule) => ['--allow', rule]);

/** Nothing under the bots folder changed: not bot.yaml, not AGENTS.md, not the settings file. */
async function assertNothingWritten(bots, before) {
  const now = await snapshot(bots, skipGit);
  const changed = Object.keys({ ...before, ...now }).filter((rel) => before[rel] !== now[rel]);
  assert.deepEqual(changed, [], `a refusal writes nothing. bot.yaml now:\n${await readFile(botYamlOf(bots, BOT), 'utf8')}`);
}

/** The refusal names the rule, verbatim, and the bot's own settings file the user may add it to. */
function assertNamesRuleAndFile(result, rule, bots) {
  assert.ok(result.stderr.includes(rule), `the refusal should name ${rule} verbatim, got: ${result.stderr}`);
  assert.ok(
    result.stderr.includes(settingsOf(bots, BOT)),
    `the refusal should name ${settingsOf(bots, BOT)}, where the user can add it themselves, got: ${result.stderr}`,
  );
}

/** Broad rules, by the requirement's letter: the rule and why it is broad. */
const BROAD = [
  // a. matches any command
  ['Bash', 'a: Bash with no specifier'],
  ['Bash()', 'a: an empty specifier'],
  ['Bash(*)', 'a: only a wildcard'],
  ['Bash(:*)', 'a: an empty prefix'],
  // b. a `*` inside the program word
  ['Bash(g*:*)', 'b: a star in the program word'],
  ['Bash(*git commit:*)', 'b: a star before the program word'],
  // c. fewer than two words before the first `*`
  ['Bash(gh:*)', 'c: one word before the :* suffix'],
  ['Bash(git *)', 'c: one word before a star'],
  ['Bash(git * main)', 'c: one word before a star in the middle'],
  ['Bash(/Applications/Orca.app/Contents/Resources/bin/orca:*)', 'c: one absolute program word before :*'],
  ['Bash(curl:*)', 'c: one word before :*'],
  // d. a shell, interpreter or wrapper with a wildcard, the next word no absolute path
  ['Bash(python3 -c:*)', 'd: python3 -c'],
  ['Bash(sh -c:*)', 'd: sh -c'],
  ['Bash(bash -lc:*)', 'd: bash -lc'],
  ['Bash(zsh -c *)', 'd: zsh -c with a spaced star'],
  ['Bash(node -e:*)', 'd: node -e'],
  ['Bash(ruby -e:*)', 'd: ruby -e'],
  ['Bash(perl -e:*)', 'd: perl -e'],
  ['Bash(osascript -e:*)', 'd: osascript -e'],
  ['Bash(npx prettier:*)', 'd: npx'],
  ['Bash(uvx ruff:*)', 'd: uvx'],
  ['Bash(env FOO=1:*)', 'd: env'],
  ['Bash(xargs rm:*)', 'd: xargs'],
  ['Bash(sudo rm:*)', 'd: sudo'],
  ['Bash(nohup git push:*)', 'd: nohup, whatever follows'],
  ['Bash(timeout 10 git:*)', 'd: timeout'],
  ['Bash(/usr/bin/python3 -m:*)', 'd: python3 by the basename of an absolute program word'],
  ['Bash(python3 ./tool.py:*)', 'd: a script by a relative path is no fixed script'],
  ['Bash(python3 /tmp/*:*)', 'd: an absolute path with a star in it is no fixed script'],
  ['Bash(env /bin/sh -c:*)', 'd: a wrapper running a shell by its absolute path'],
  ['Bash(sudo /usr/bin/env bash:*)', 'd: a wrapper running a wrapper by its absolute path'],
  ['Bash(X=1 /bin/sh -c:*)', 'd: a shell after a leading assignment'],
  ['Bash(X=1 gh:*)', 'c: one program word after a leading assignment'],
  // e. the whole disk or the whole home
  ['Read', 'e: Read with no specifier'],
  ['Edit', 'e: Edit with no specifier'],
  ['Write', 'e: Write with no specifier'],
  ['Edit(//**)', 'e: the whole disk'],
  ['Read(//*)', 'e: the top of the disk'],
  ['Write(~/**)', 'e: the whole home'],
  ['Read(~/*)', 'e: the top of the home'],
];

/** Rules that are narrow and exact, each accepted as slice A accepts any rule. */
const NARROW = [
  ['Bash(gh pr merge:*)', 'three words before :*'],
  ['Bash(gh issue close:*)', 'three words before :*'],
  ['Bash(git push *)', 'two words before the star: the boundary of c'],
  ['Bash(npm test)', 'no wildcard'],
  ['Bash(git push origin main)', 'no wildcard'],
  ['Bash(curl -s https://example.com)', 'no wildcard'],
  ['Bash(node --version)', 'an interpreter with no wildcard'],
  ['Bash(python3 /abs/tool.py:*)', 'an interpreter running a fixed script by its absolute path'],
  ['Bash(node /abs/cli.js run:*)', 'node running a fixed script by its absolute path'],
  ['Bash(env /abs/tool.sh run:*)', 'a wrapper running a fixed program by its absolute path'],
  ['Bash(FOO=1 gh pr merge:*)', 'a leading assignment in front of a narrow rule'],
  ['Read(//Users/someone/project/**)', 'one folder, not the whole disk'],
  ['Edit(~/notes/**)', 'one folder, not the whole home'],
];

// ----------------------------------------------------------------- a broad rule is refused

for (const [rule, why] of BROAD) {
  test(`N1 --allow ${rule} is refused as broad (${why}), naming the rule and the settings file, and nothing is written`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withAllowedBot(box);
    const before = await snapshot(bots, skipGit);

    const result = await change(box, ...allowing(rule));

    assertCleanFailure(result);
    assertNamesRuleAndFile(result, rule, bots);
    await assertNothingWritten(bots, before);
    assert.deepEqual(await allowOf(bots, BOT), [OWN_RULE], 'allow is as it was');
  });
}

// ----------------------------------------------------------------- narrow rules still go through

for (const [rule, why] of NARROW) {
  test(`N2 --allow ${rule} is accepted (${why}): kept in allow and written into the settings`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);

    const result = await change(box, ...allowing(rule));

    assert.equal(result.code, 0, `${rule} is narrow and exact, and should be allowed, got:\n${result.stdout}${result.stderr}`);
    assert.deepEqual(await allowOf(bots, BOT), [rule]);
    assert.deepEqual(await allowedIn(bots, BOT), [rule], `${settingsOf(bots, BOT)} should allow it now`);
  });
}

test('N2 the kit\'s six default rules are accepted together, none taken for broad', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const defaults = defaultRules(box, bots);

  const result = await change(box, ...allowing(...defaults));

  assert.equal(result.code, 0, `the defaults are the kit's own narrow rules, got:\n${result.stdout}${result.stderr}`);
  assert.deepEqual(await allowOf(bots, BOT), defaults);
  assert.deepEqual(await allowedIn(bots, BOT), defaults);
});

// ----------------------------------------------------------------- a mix is refused as a whole

test('N3 good rules beside a broad one are refused with it: none of them is recorded or written', async (t) => {
  const box = await createSandbox(t);
  const bots = await withAllowedBot(box);
  const [, , , , add] = defaultRules(box, bots);
  const broad = 'Bash(gh:*)';
  const before = await snapshot(bots, skipGit);

  const result = await change(box, ...allowing(add, broad, 'Bash(gh issue close:*)'));

  assertCleanFailure(result);
  assertNamesRuleAndFile(result, broad, bots);
  await assertNothingWritten(bots, before);
  assert.deepEqual(await allowOf(bots, BOT), [OWN_RULE], 'the good ones are not recorded either');
  assert.deepEqual(await allowedIn(bots, BOT), [OWN_RULE], 'nor written into the settings');
});

test('N3 a broad rule as the last of several is refused all the same', async (t) => {
  const box = await createSandbox(t);
  const bots = await withAllowedBot(box);
  const broad = 'Bash(python3 -c:*)';
  const before = await snapshot(bots, skipGit);

  const result = await change(box, ...allowing('Bash(gh issue close:*)', 'Bash(npm test)', broad));

  assertCleanFailure(result);
  assertNamesRuleAndFile(result, broad, bots);
  await assertNothingWritten(bots, before);
});

test('N4 --charter with a broad --allow is refused, and the charter is not changed either', async (t) => {
  const box = await createSandbox(t);
  const bots = await withAllowedBot(box);
  const broad = 'Edit(//**)';
  const before = await snapshot(bots, skipGit);

  const result = await change(box, '--charter', NEW_CHARTER, ...allowing('Bash(gh issue close:*)', broad));

  assertCleanFailure(result);
  assertNamesRuleAndFile(result, broad, bots);
  await assertNothingWritten(bots, before);
  const doc = parse(await readFile(botYamlOf(bots, BOT), 'utf8'));
  assert.equal(doc.charter.trim(), CHARTER, 'the charter is the one it had');
});

test('N4 --charter with only narrow --allow values still does both', async (t) => {
  // The contrast to the refusal above: the same command shape goes through
  // when nothing in it is broad.
  const box = await createSandbox(t);
  const bots = await withAllowedBot(box);

  const result = await change(box, '--charter', NEW_CHARTER, ...allowing('Bash(gh issue close:*)'));

  assert.equal(result.code, 0, result.stderr);
  const doc = parse(await readFile(botYamlOf(bots, BOT), 'utf8'));
  assert.equal(doc.charter.trim(), NEW_CHARTER);
  assert.deepEqual(doc.allow, [OWN_RULE, 'Bash(gh issue close:*)']);
  assert.deepEqual(await allowedIn(bots, BOT), [OWN_RULE, 'Bash(gh issue close:*)']);
});
