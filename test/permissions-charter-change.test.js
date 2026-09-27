// A charter change and the rules the bot is allowed now (#353, slice B of
// #344, and #354 for Codex).
//
// A new charter may grant more or less than the old one, and its rules are to
// be listed and shown to the user again; until the user answers, nothing
// changes. So `obk bot change --bots <B> --bot <X> --charter <text>`, for a
// bot that runs on Claude Code, adds to its plain report each rule the bot is
// allowed now beyond the kit's six defaults, word for word, and says none of
// them is removed or added until the user answers. With nothing allowed beyond
// the defaults, the report lists no rule. Its `--json` answer carries
// `beyondDefaults`: the rules in bot.yaml `allow` that are not defaults, in
// `allow`'s order, `[]` for none. The change writes nothing into the settings
// file and leaves `allow` as it was. A bot that runs on Codex gets the same
// note and `beyondDefaults`, and the note names its `.codex/rules/obk.rules`
// among the places the rules would be taken out of; the change writes nothing
// into that file either.
//
// Plain text is read only for the exact rule strings; the sentence that
// nothing changes until the user answers is the implementer's wording.

import assert from 'node:assert/strict';
import { mkdir, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import { createSandbox } from './helpers/cli.js';
import {
  allowOf,
  codexAllowedIn,
  codexDefaultRules,
  codexRulesOf,
  defaultRules,
  mentionsAny,
  namesFile,
  OWN_RULE,
  settingsIn,
  settingsOf,
  writeAllow,
} from './helpers/permissions.js';
import { botYamlOf } from './helpers/skills.js';

const BOT = 'api-bot';
const NEW_CHARTER = 'Api Bot owns the API and its docs. It merges pull requests without asking.';
const CLOSE_RULE = 'Bash(gh issue close:*)';
const PAST = new Date('2020-01-01T00:00:00Z');

/** A bots folder `init` made, with one more bot on `harness`, and the sessions given: `[name, ...settings]` each. */
async function withBot(box, harness = 'claude', sessions = [['daily']]) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  for (const [session, ...settings] of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', session, ...settings]);
    assert.equal(added.code, 0, added.stderr);
  }
  return box.path('bots');
}

const charterChange = (box, ...rest) => box.run(['bot', 'change', '--bots', 'bots', '--bot', BOT, '--charter', NEW_CHARTER, ...rest]);

/** The answer of a `--json` charter change, parsed. */
function jsonOf(result) {
  assert.equal(result.code, 0, `the charter change should have gone through, got:\n${result.stdout}${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
}

// ----------------------------------------------------------------- what is allowed beyond the defaults

test('C1 a charter change names each rule the bot is allowed beyond the defaults, word for word, and not the defaults', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const defaults = defaultRules(box, bots);
  await writeAllow(bots, BOT, [...defaults, OWN_RULE, CLOSE_RULE]);

  const result = await charterChange(box);

  assert.equal(result.code, 0, result.stderr);
  for (const rule of [OWN_RULE, CLOSE_RULE]) {
    assert.ok(result.stdout.includes(rule), `the report should name ${rule}, allowed now beyond the defaults, got:\n${result.stdout}`);
  }
  assert.deepEqual(mentionsAny(result.stdout, defaults), [], `the defaults are not beyond the defaults, got:\n${result.stdout}`);
});

test('C2 --json carries beyondDefaults: the allowed rules that are no default, in allow\'s order', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const [check, , , read, add] = defaultRules(box, bots);
  await writeAllow(bots, BOT, [CLOSE_RULE, check, OWN_RULE, read, add]);

  const answer = jsonOf(await charterChange(box, '--json'));

  assert.deepEqual(answer.beyondDefaults, [CLOSE_RULE, OWN_RULE]);
});

for (const [label, allow] of [
  ['nothing allowed at all', undefined],
  ['only the six defaults allowed', 'defaults'],
  ['some of the defaults allowed', 'some'],
]) {
  test(`C3 with ${label}, a charter change lists no rule, and beyondDefaults is empty`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    const defaults = defaultRules(box, bots);
    if (allow === 'defaults') await writeAllow(bots, BOT, defaults);
    if (allow === 'some') await writeAllow(bots, BOT, [defaults[5], defaults[0]]);

    const answer = jsonOf(await charterChange(box, '--json'));
    assert.deepEqual(answer.beyondDefaults, [], `nothing is allowed beyond the defaults, got: ${JSON.stringify(answer)}`);

    const plain = await box.run(['bot', 'change', '--bots', 'bots', '--bot', BOT, '--charter', `${NEW_CHARTER} Again.`]);
    assert.equal(plain.code, 0, plain.stderr);
    assert.deepEqual(mentionsAny(plain.stdout, [...defaults, OWN_RULE, CLOSE_RULE]), [], `no rule should be listed, got:\n${plain.stdout}`);
  });
}

test('C4 a Codex bot with a Claude session runs on Claude, and its charter change carries beyondDefaults', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex', [['daily'], ['review', '--harness', 'claude']]);
  await writeAllow(bots, BOT, [OWN_RULE]);

  const answer = jsonOf(await charterChange(box, '--json'));

  assert.deepEqual(answer.beyondDefaults, [OWN_RULE]);
});

// ----------------------------------------------------------------- nothing changes until the user answers

test('C5 a charter change writes nothing into the settings file and leaves allow as it was, a hand-added entry included', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const [, , , , add] = defaultRules(box, bots);
  const allowed = await box.run(['bot', 'change', '--bots', 'bots', '--bot', BOT, '--allow', add, '--allow', OWN_RULE]);
  assert.equal(allowed.code, 0, allowed.stderr);
  // An entry of the user's own beside them, which the new charter may or may not grant.
  const file = settingsOf(bots, BOT);
  const settings = await settingsIn(bots, BOT);
  settings.permissions.allow = [...settings.permissions.allow, 'Bash(gh:*)'];
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);
  await utimes(file, PAST, PAST);
  const text = await readFile(file, 'utf8');

  const result = await charterChange(box);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(parse(await readFile(botYamlOf(bots, BOT), 'utf8')).charter.trim(), NEW_CHARTER, 'the premise: the charter did change');
  assert.deepEqual(await allowOf(bots, BOT), [add, OWN_RULE], 'allow is as it was');
  assert.equal(await readFile(file, 'utf8'), text, 'the settings file is as it was');
  assert.equal((await stat(file)).mtime.getTime(), PAST.getTime(), 'not even written back the same');
});

// ----------------------------------------------------------------- a bot on Codex

test('C6 a bot that runs only on Codex gets the note of allowed rules and beyondDefaults, naming its obk.rules', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex');
  await writeAllow(bots, BOT, [...codexDefaultRules(box, bots), OWN_RULE, CLOSE_RULE]);

  const answer = jsonOf(await charterChange(box, '--json'));
  assert.deepEqual(answer.beyondDefaults, [OWN_RULE, CLOSE_RULE]);

  const plain = await box.run(['bot', 'change', '--bots', 'bots', '--bot', BOT, '--charter', `${NEW_CHARTER} Again.`]);
  assert.equal(plain.code, 0, plain.stderr);
  for (const rule of [OWN_RULE, CLOSE_RULE]) {
    assert.ok(plain.stdout.includes(rule), `the report should name ${rule}, allowed now beyond the defaults, got:\n${plain.stdout}`);
  }
  assert.deepEqual(mentionsAny(plain.stdout, codexDefaultRules(box, bots)), [], `the defaults are not beyond the defaults, got:\n${plain.stdout}`);
  assert.ok(namesFile(plain.stdout, box, codexRulesOf(bots, BOT)), `the report should name ${codexRulesOf(bots, BOT)}, got:\n${plain.stdout}`);
});

test('C6 a Codex bot with nothing allowed beyond the defaults hears of no rule', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex');
  await writeAllow(bots, BOT, codexDefaultRules(box, bots));

  const answer = jsonOf(await charterChange(box, '--json'));

  assert.deepEqual(answer.beyondDefaults, []);
});

test('C7 a charter change writes nothing into a Codex bot\'s obk.rules and leaves allow as it was', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex');
  const allowed = await box.run(['bot', 'change', '--bots', 'bots', '--bot', BOT, '--allow', 'Bash(git add:*)', '--allow', OWN_RULE]);
  assert.equal(allowed.code, 0, allowed.stderr);
  const file = codexRulesOf(bots, BOT);
  assert.equal((await codexAllowedIn(bots, BOT)).length, 2, 'the premise: obk.rules holds both');
  await utimes(file, PAST, PAST);
  const text = await readFile(file, 'utf8');

  const result = await charterChange(box);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(parse(await readFile(botYamlOf(bots, BOT), 'utf8')).charter.trim(), NEW_CHARTER, 'the premise: the charter did change');
  assert.deepEqual(await allowOf(bots, BOT), ['Bash(git add:*)', OWN_RULE], 'allow is as it was');
  assert.equal(await readFile(file, 'utf8'), text, 'obk.rules is as it was');
  assert.equal((await stat(file)).mtime.getTime(), PAST.getTime(), 'not even written back the same');
});
