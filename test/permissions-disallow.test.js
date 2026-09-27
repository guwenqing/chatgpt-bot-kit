// Taking back a rule a charter no longer grants, after the user's yes (#360).
//
// `obk bot change --bots <B> --bot <X> --disallow <rule> [--disallow <rule> ...]
// [--charter <text>] [--json]` takes each rule out of bot.yaml `allow`, where it
// must be, exactly as written there. The other entries stay, in their order,
// and the rest of bot.yaml is kept (comments, other keys, the charter unless
// --charter comes too). What is pinned:
//
// - for a bot that runs on Claude Code, every entry of that exact text leaves
//   `permissions.allow` in its `.claude/settings.json`; every other entry (the
//   user's own, others the kit wrote) stays in its order, every other key is
//   kept, and nothing is added, not even a rule `allow` holds that the file
//   lacks. No settings file, or one without the rule, still goes through, and
//   no file is made;
// - for a bot that runs on Codex, `.codex/rules/obk.rules` is rewritten from
//   what `allow` still holds: the rule's line goes, unless another rule still in
//   `allow` gives the very same line. No other `.rules` file is touched;
// - refused, with nothing changed anywhere (bot.yaml, the settings file,
//   obk.rules, the charter too when --charter is given): a rule `allow` does
//   not hold, even one the settings file has by hand; an empty rule; `--allow`
//   and `--disallow` together; a settings file `--allow` would refuse (a link
//   outside the bot folder, not JSON, `permissions` not a mapping,
//   `permissions.allow` not a list); an `allow` in bot.yaml that is not a list
//   of rules; an unknown bot; a harness file or a bot.yaml the kit cannot
//   write; with --charter, a bot.yaml whose `allow` edit cannot be made (an
//   anchor another key uses);
// - when a line leaves obk.rules, the last one included, the plain report
//   says `obk restart`; when none does, it does not;
// - the same rule given twice is taken out once; a kit default taken back
//   waits again, listed with the command that allows it as `--allow` and
//   `rules build` list waiting defaults; `--json` carries `allow` (the whole
//   list now) and `disallowed` (what this call took out, in the order given,
//   each once); `obk health` then has nothing to say about the rule;
// - `bot change --charter` for a bot with rules beyond the defaults says how to
//   take one back (`--disallow`), and `--help` lists `--disallow` under
//   `bot change`.
//
// Plain text is read only for exact rule strings, file paths, the offered
// command and the flag name; the sentences around them are the implementer's.
// Where the claim is that nothing changed, the bots folder is compared byte for
// byte.
//
// Not covered here: that Bot Father offers the take-back and runs nothing on a
// no. That is the skill's prose, read in review, not something a unit test runs.

import assert from 'node:assert/strict';
import { appendFile, chmod, mkdir, readFile, readlink, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse, parseDocument, stringify } from 'yaml';

import {
  assertKeptWhatTheyWrote,
  assertRefused,
  botHomeOf,
  createSandbox,
  skipGit,
  snapshot,
} from './helpers/cli.js';
import {
  allowCommand,
  allowedIn,
  allowOf,
  codexAllowedIn,
  codexRulesOf,
  defaultRules,
  FOREIGN_RULE,
  jsonOf,
  OWN_RULE,
  settingsIn,
  settingsOf,
  waitingOf,
} from './helpers/permissions.js';
import { botYamlOf } from './helpers/skills.js';

const BOT = 'api-bot';
const CHARTER = 'Api Bot owns the API. It merges pull requests and closes issues without asking.';
const NEW_CHARTER = 'Api Bot owns the API. It asks before merging a pull request.';
const CLOSE_RULE = 'Bash(gh issue close:*)';
/** The same Codex line as OWN_RULE (`Bash(gh pr merge:*)`), spelled the other way Claude Code allows. */
const OWN_RULE_SPACED = 'Bash(gh pr merge *)';
const PAST = new Date('2020-01-01T00:00:00Z');

/** The lines OWN_RULE, `Bash(git add:*)` and CLOSE_RULE become in obk.rules, worked out by hand. */
const OWN_LINE = 'prefix_rule(pattern=["gh", "pr", "merge"], decision="allow")';
const ADD_LINE = 'prefix_rule(pattern=["git", "add"], decision="allow")';
const CLOSE_LINE = 'prefix_rule(pattern=["gh", "issue", "close"], decision="allow")';

/** Sessions that make a Codex bot run on Claude too. */
const BOTH = [['daily'], ['review', '--harness', 'claude']];

/**
 * A bots folder `init` made on Claude, with one more bot on `harness`, the
 * sessions given (`[name, ...settings]` each), and `allowed` allowed through
 * the kit, so its harness files hold them as the kit writes them.
 */
async function withBot(box, { harness = 'claude', sessions = [['daily']], allowed = [] } = {}) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness, '--charter', CHARTER]);
  assert.equal(made.code, 0, made.stderr);
  for (const [session, ...settings] of sessions) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', session, ...settings]);
    assert.equal(added.code, 0, added.stderr);
  }
  const up = await box.run(['up', '--bots', 'bots', '--bot', BOT]);
  assert.equal(up.code, 0, up.stderr);
  if (allowed.length > 0) {
    const allow = await change(box, ...allowing(...allowed));
    assert.equal(allow.code, 0, `the premise: ${allowed.join(', ')} allowed through the kit\n${allow.stdout}${allow.stderr}`);
  }
  return box.path('bots');
}

const change = (box, ...rest) => box.run(['bot', 'change', '--bots', 'bots', '--bot', BOT, ...rest]);

/** `--allow <rule>` for each rule, in order. */
const allowing = (...rules) => rules.flatMap((rule) => ['--allow', rule]);

/** `--disallow <rule>` for each rule, in order. */
const disallowing = (...rules) => rules.flatMap((rule) => ['--disallow', rule]);

const botText = (bots) => readFile(botYamlOf(bots, BOT), 'utf8');

/** Put `settings` in the bot's Claude settings file by hand, as the user would write it. */
async function writeSettings(bots, settings) {
  const file = settingsOf(bots, BOT);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);
}

/** Set the settings file's `permissions.allow` by hand, keeping everything else in it. */
async function handAllow(bots, entries) {
  const settings = (await settingsIn(bots, BOT)) ?? {};
  settings.permissions = { ...settings.permissions, allow: entries };
  await writeSettings(bots, settings);
}

/** Run a command that has to go through for the test to mean anything. */
async function ok(promise) {
  const result = await promise;
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  return result;
}

/** Nothing under the bots folder changed, byte for byte: not bot.yaml, not AGENTS.md, not a harness file. */
async function assertNothingChanged(bots, before) {
  const now = await snapshot(bots, skipGit);
  const changed = Object.keys({ ...before, ...now }).filter((rel) => before[rel] !== now[rel]);
  assert.deepEqual(changed, [], `a refusal changes nothing. bot.yaml now:\n${await botText(bots)}`);
}

/** A refusal: not 0, a message rather than a crash, and stderr naming each of `named`. */
function assertRefusedNaming(result, ...named) {
  assert.notEqual(result.code, 0, `this should have been refused, got:\n${result.stdout}${result.stderr}`);
  assert.ok(!/^\s+at /m.test(`${result.stdout}${result.stderr}`), `expected a message, got a crash:\n${result.stderr}`);
  for (const word of named) {
    assert.ok(result.stderr.includes(word), `the refusal should name ${word} on stderr, got:\n${result.stderr}`);
  }
}

/** Run the health check for JSON: the findings. */
async function healthFindings(box) {
  const result = await box.run(['health', '--bots', 'bots', '--json']);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.found), `the answer should carry a list of findings, got: ${result.stdout}`);
  return answer.found;
}

// ----------------------------------------------------------------- bot.yaml: the rule leaves allow, the rest stays

test('D1 --disallow takes the rule out of allow; the others stay in their order, and the charter and the user\'s own lines stay', async (t) => {
  const box = await createSandbox(t);
  const [add, commit] = ['Bash(git add:*)', 'Bash(git commit:*)'];
  const bots = await withBot(box, { allowed: [add, OWN_RULE, CLOSE_RULE, commit] });
  // A comment and a key of the user's own, added by hand after the kit wrote the file.
  await appendFile(botYamlOf(bots, BOT), '# my own note about this bot\nnotes: keep me\n');
  const before = await botText(bots);

  const result = await change(box, ...disallowing(OWN_RULE));

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const after = await botText(bots);
  assert.deepEqual(parse(after).allow, [add, CLOSE_RULE, commit]);
  assert.equal(parse(after).charter.trim(), CHARTER, 'no --charter, so the charter is the one it had');
  assertKeptWhatTheyWrote(before, after, { changed: ['allow'] });
  assert.ok(after.includes('# my own note about this bot'), `the user's comment should have survived:\n${after}`);
});

test('D1 two rules taken back in one run: both leave allow, the rest keep their order', async (t) => {
  const box = await createSandbox(t);
  const [add, commit] = ['Bash(git add:*)', 'Bash(git commit:*)'];
  const bots = await withBot(box, { allowed: [add, OWN_RULE, commit, CLOSE_RULE] });

  await ok(change(box, ...disallowing(CLOSE_RULE, add)));

  assert.deepEqual(await allowOf(bots, BOT), [OWN_RULE, commit]);
  assert.deepEqual(await allowedIn(bots, BOT), [OWN_RULE, commit]);
});

// ----------------------------------------------------------------- the Claude settings file

test('D2 the rule leaves the settings file; the user\'s own entries, their order and every other key stay as they were', async (t) => {
  const box = await createSandbox(t);
  const add = 'Bash(git add:*)';
  const bots = await withBot(box, { allowed: [add, OWN_RULE, CLOSE_RULE] });
  // The kit's hook is in the file already; the user's own entries and keys go round the kit's rules.
  const settings = await settingsIn(bots, BOT);
  const theirs = {
    ...settings,
    permissions: {
      allow: ['Bash(npm test:*)', add, FOREIGN_RULE, OWN_RULE, 'Bash(git status)', CLOSE_RULE],
      deny: ['Bash(rm -rf:*)'],
      ask: ['Bash(git push:*)'],
      defaultMode: 'default',
    },
    env: { MY_KEY: 'mine' },
    theme: 'dark',
  };
  await writeSettings(bots, theirs);

  await ok(change(box, ...disallowing(OWN_RULE)));

  const expected = structuredClone(theirs);
  expected.permissions.allow = ['Bash(npm test:*)', add, FOREIGN_RULE, 'Bash(git status)', CLOSE_RULE];
  assert.deepEqual(await settingsIn(bots, BOT), expected, 'only the rule taken back is gone; the hook and every other key are as they were');
});

test('D2 every entry of that exact text leaves the settings file, a second copy the user added by hand included', async (t) => {
  const box = await createSandbox(t);
  const add = 'Bash(git add:*)';
  const bots = await withBot(box, { allowed: [add, OWN_RULE] });
  await handAllow(bots, [OWN_RULE, add, FOREIGN_RULE, OWN_RULE]);

  await ok(change(box, ...disallowing(OWN_RULE)));

  assert.deepEqual(await allowedIn(bots, BOT), [add, FOREIGN_RULE]);
});

test('D2 --disallow adds nothing to the settings file, not even a rule allow holds that the file lacks', async (t) => {
  const box = await createSandbox(t);
  const add = 'Bash(git add:*)';
  const bots = await withBot(box, { allowed: [add, OWN_RULE, CLOSE_RULE] });
  // CLOSE_RULE taken out of the file by hand: allow still holds it.
  await handAllow(bots, [add, OWN_RULE]);

  await ok(change(box, ...disallowing(OWN_RULE)));

  assert.deepEqual(await allowOf(bots, BOT), [add, CLOSE_RULE]);
  assert.deepEqual(await allowedIn(bots, BOT), [add], `${CLOSE_RULE} is not written back by a take-back`);
});

test('D2 another spelling of the rule in the settings file is the user\'s and stays: only the exact text leaves', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [OWN_RULE] });
  await handAllow(bots, [OWN_RULE_SPACED, OWN_RULE]);

  await ok(change(box, ...disallowing(OWN_RULE)));

  assert.deepEqual(await allowedIn(bots, BOT), [OWN_RULE_SPACED], 'only that exact text leaves the file');
});

// ----------------------------------------------------------------- no settings file, or one without the rule

test('D3 with no settings file, the rule still leaves allow, and no settings file is made', async (t) => {
  const box = await createSandbox(t);
  const add = 'Bash(git add:*)';
  const bots = await withBot(box, { allowed: [add, OWN_RULE] });
  await rm(settingsOf(bots, BOT));

  await ok(change(box, ...disallowing(OWN_RULE)));

  assert.deepEqual(await allowOf(bots, BOT), [add]);
  assert.equal(await settingsIn(bots, BOT), undefined, `${settingsOf(bots, BOT)} should not have been made`);
});

test('D3 with a settings file that does not hold the rule, the rule still leaves allow, and the file keeps what it had', async (t) => {
  const box = await createSandbox(t);
  const add = 'Bash(git add:*)';
  const bots = await withBot(box, { allowed: [add, OWN_RULE] });
  await handAllow(bots, [FOREIGN_RULE, add]);
  const was = await settingsIn(bots, BOT);

  await ok(change(box, ...disallowing(OWN_RULE)));

  assert.deepEqual(await allowOf(bots, BOT), [add]);
  assert.deepEqual(await settingsIn(bots, BOT), was);
});

// ----------------------------------------------------------------- a bot on Codex

test('D4 for a Codex bot, obk.rules is rewritten from what allow still holds: the rule\'s line goes, the others stay in order', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { harness: 'codex', allowed: ['Bash(git add:*)', OWN_RULE, CLOSE_RULE] });
  assert.deepEqual(await codexAllowedIn(bots, BOT), [ADD_LINE, OWN_LINE, CLOSE_LINE], 'the premise: obk.rules holds all three');

  await ok(change(box, ...disallowing(OWN_RULE)));

  assert.deepEqual(await allowOf(bots, BOT), ['Bash(git add:*)', CLOSE_RULE]);
  assert.deepEqual(await codexAllowedIn(bots, BOT), [ADD_LINE, CLOSE_LINE]);
  assert.equal(await settingsIn(bots, BOT), undefined, 'a bot only on Codex gets no Claude settings from a take-back');
});

test('D4 a line another rule still in allow gives stays in obk.rules', async (t) => {
  // `Bash(gh pr merge:*)` and `Bash(gh pr merge *)` both become the same line.
  const box = await createSandbox(t);
  const bots = await withBot(box, { harness: 'codex', allowed: [OWN_RULE, OWN_RULE_SPACED, 'Bash(git add:*)'] });
  assert.deepEqual(await codexAllowedIn(bots, BOT), [OWN_LINE, ADD_LINE], 'the premise: one line for the two spellings');

  await ok(change(box, ...disallowing(OWN_RULE)));

  assert.deepEqual(await allowOf(bots, BOT), [OWN_RULE_SPACED, 'Bash(git add:*)']);
  assert.deepEqual(await codexAllowedIn(bots, BOT), [OWN_LINE, ADD_LINE], `${OWN_RULE_SPACED} still gives the line`);
});

test('D4 another .rules file in the bot\'s .codex/rules is untouched, byte for byte and mtime', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { harness: 'codex', allowed: [OWN_RULE, CLOSE_RULE] });
  const theirs = path.join(botHomeOf(bots, BOT), '.codex', 'rules', 'default.rules');
  const text = `# mine\n${OWN_LINE}\nprefix_rule(pattern=["make"], decision="allow")\n`;
  await writeFile(theirs, text);
  await utimes(theirs, PAST, PAST);

  await ok(change(box, ...disallowing(OWN_RULE)));

  assert.deepEqual(await codexAllowedIn(bots, BOT), [CLOSE_LINE], 'the premise: the take-back happened');
  assert.equal(await readFile(theirs, 'utf8'), text, 'the user\'s own rules file, the same line in it included');
  assert.equal((await stat(theirs)).mtime.getTime(), PAST.getTime(), 'not even written back the same');
});

test('D4 a bot on both harnesses loses the rule from its Claude settings and from its obk.rules', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { harness: 'codex', sessions: BOTH, allowed: ['Bash(git add:*)', OWN_RULE] });
  assert.deepEqual(await allowedIn(bots, BOT), ['Bash(git add:*)', OWN_RULE], 'the premise: the Claude settings hold both');
  assert.deepEqual(await codexAllowedIn(bots, BOT), [ADD_LINE, OWN_LINE], 'the premise: obk.rules holds both');

  await ok(change(box, ...disallowing(OWN_RULE)));

  assert.deepEqual(await allowedIn(bots, BOT), ['Bash(git add:*)']);
  assert.deepEqual(await codexAllowedIn(bots, BOT), [ADD_LINE]);
});

// ----------------------------------------------------------------- a rule allow does not hold

for (const [label, extra] of [
  ['--disallow', []],
  ['--disallow with --charter', ['--charter', NEW_CHARTER]],
]) {
  test(`D5 ${label} of a rule allow does not hold is refused, naming it, and a hand-added copy in the settings file stays`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, { allowed: [OWN_RULE] });
    await handAllow(bots, [OWN_RULE, FOREIGN_RULE]);
    const before = await snapshot(bots, skipGit);

    const result = await change(box, ...extra, ...disallowing(FOREIGN_RULE));

    assertRefusedNaming(result, FOREIGN_RULE);
    await assertNothingChanged(bots, before);
    assert.deepEqual(await allowedIn(bots, BOT), [OWN_RULE, FOREIGN_RULE], 'the user\'s own entry stays theirs');
  });
}

test('D5 a rule is taken back only as allow spells it: another spelling of it is refused', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [OWN_RULE] });
  const before = await snapshot(bots, skipGit);

  const result = await change(box, ...disallowing(OWN_RULE_SPACED));

  assertRefusedNaming(result, OWN_RULE_SPACED);
  await assertNothingChanged(bots, before);
});

test('D5 one rule allow holds beside one it does not: the whole run is refused, and the held one stays', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [OWN_RULE, CLOSE_RULE] });
  const before = await snapshot(bots, skipGit);

  const result = await change(box, ...disallowing(OWN_RULE, FOREIGN_RULE));

  assertRefusedNaming(result, FOREIGN_RULE);
  await assertNothingChanged(bots, before);
});

test('D5 for a Codex bot, a rule allow does not hold is refused, and obk.rules is as it was', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { harness: 'codex', allowed: [OWN_RULE] });
  const before = await snapshot(bots, skipGit);

  const result = await change(box, ...disallowing(CLOSE_RULE));

  assertRefusedNaming(result, CLOSE_RULE);
  await assertNothingChanged(bots, before);
});

// ----------------------------------------------------------------- an empty rule, a rule twice

for (const [label, rules] of [
  ['an empty --disallow', ['']],
  ['an empty --disallow beside a good one', [OWN_RULE, '']],
]) {
  test(`D6 ${label} is refused, and nothing changes; the good one alone then goes through`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, { allowed: [OWN_RULE, CLOSE_RULE] });
    const before = await snapshot(bots, skipGit);

    const result = await change(box, ...disallowing(...rules));

    assertRefusedNaming(result, '--disallow');
    await assertNothingChanged(bots, before);
    // The contrast: the same command without the empty rule is taken.
    await ok(change(box, ...disallowing(OWN_RULE)));
    assert.deepEqual(await allowOf(bots, BOT), [CLOSE_RULE]);
  });
}

test('D6 the same rule given twice is taken out once, and disallowed names it once', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [OWN_RULE, CLOSE_RULE] });

  const answer = jsonOf(await change(box, ...disallowing(OWN_RULE, OWN_RULE), '--json'));

  assert.deepEqual(answer.disallowed, [OWN_RULE]);
  assert.deepEqual(answer.allow, [CLOSE_RULE]);
  assert.deepEqual(await allowOf(bots, BOT), [CLOSE_RULE]);
  assert.deepEqual(await allowedIn(bots, BOT), [CLOSE_RULE]);
});

// ----------------------------------------------------------------- --allow and --disallow together

test('D7 --allow and --disallow in one command are refused, and nothing changes; --disallow alone then goes through', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [OWN_RULE] });
  const before = await snapshot(bots, skipGit);

  const result = await change(box, ...allowing(CLOSE_RULE), ...disallowing(OWN_RULE));

  assertRefusedNaming(result);
  await assertNothingChanged(bots, before);
  await ok(change(box, ...disallowing(OWN_RULE)));
  assert.deepEqual(await allowOf(bots, BOT), []);
});

// ----------------------------------------------------------------- a settings file that cannot be safely changed

/** What a user keeps in their own settings, outside every bot. */
const USERS_OWN = `${JSON.stringify({ permissions: { allow: [OWN_RULE, 'Bash(git status)'] }, theme: 'dark' }, null, 2)}\n`;

test('D8 a settings file that links outside the bot folder is refused by name; nothing changes, and the user\'s file is untouched', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [OWN_RULE, CLOSE_RULE] });
  const file = settingsOf(bots, BOT);
  const target = path.join(box.home, '.claude', 'settings.json');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, USERS_OWN);
  await rm(file, { force: true });
  await symlink(target, file);
  const before = await snapshot(bots, skipGit);

  const result = await change(box, ...disallowing(OWN_RULE));

  assertRefused(result, file);
  await assertNothingChanged(bots, before);
  assert.equal(await readFile(target, 'utf8'), USERS_OWN, 'the user\'s own settings, byte for byte');
  assert.equal(await readlink(file), target, 'and the link is left as they made it');
});

for (const [label, text] of [
  ['not valid JSON', `{ "permissions": { "allow": [${JSON.stringify(OWN_RULE)}] `],
  ['a permissions that is a list', `${JSON.stringify({ permissions: [OWN_RULE] }, null, 2)}\n`],
  ['a permissions that is a line of text', `${JSON.stringify({ permissions: OWN_RULE }, null, 2)}\n`],
  ['a permissions.allow that is a line of text', `${JSON.stringify({ permissions: { allow: OWN_RULE } }, null, 2)}\n`],
  ['a permissions.allow that is a mapping', `${JSON.stringify({ permissions: { allow: { rule: OWN_RULE } } }, null, 2)}\n`],
]) {
  test(`D8 a settings file with ${label} is refused by name, and nothing changes, bot.yaml included`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, { allowed: [OWN_RULE, CLOSE_RULE] });
    const file = settingsOf(bots, BOT);
    await writeFile(file, text);
    const before = await snapshot(bots, skipGit);

    const result = await change(box, ...disallowing(OWN_RULE));

    assertRefused(result, file);
    await assertNothingChanged(bots, before);
    assert.deepEqual(await allowOf(bots, BOT), [OWN_RULE, CLOSE_RULE], 'the rule is still allowed');
  });
}

// ----------------------------------------------------------------- an allow in bot.yaml that is not a list of rules

for (const [label, value] of [
  ['a line of text', OWN_RULE],
  ['a list holding a number', [OWN_RULE, 42]],
  ['a list holding an empty string', [OWN_RULE, '']],
  ['a list holding a mapping', [OWN_RULE, { rule: CLOSE_RULE }]],
  ['a mapping', { rule: OWN_RULE }],
]) {
  test(`D8 an allow in bot.yaml that is ${label} is refused, naming the bot.yaml, and nothing changes`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, { allowed: [OWN_RULE] });
    const doc = parse(await botText(bots));
    doc.allow = value;
    await writeFile(botYamlOf(bots, BOT), stringify(doc));
    const before = await snapshot(bots, skipGit);

    const result = await change(box, ...disallowing(OWN_RULE));

    assertRefusedNaming(result, botYamlOf(bots, BOT), 'allow');
    await assertNothingChanged(bots, before);
  });
}

test('D8 an unknown bot is refused, naming it, and nothing changes', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: [OWN_RULE] });
  const before = await snapshot(bots, skipGit);

  const result = await box.run(['bot', 'change', '--bots', 'bots', '--bot', 'nobody-bot', ...disallowing(OWN_RULE)]);

  assertRefusedNaming(result, 'nobody-bot');
  await assertNothingChanged(bots, before);
});

// ----------------------------------------------------------------- a harness file the kit cannot write

// Found in the review of PR #380: the refusal comes before anything is
// written, so a file the kit cannot write leaves bot.yaml as it was too.
for (const [label, harness, fileOf, holds] of [
  ['the Claude settings file', 'claude', settingsOf, async (bots) => (await allowedIn(bots, BOT)).includes(OWN_RULE)],
  ['a Codex bot\'s obk.rules', 'codex', codexRulesOf, async (bots) => (await codexAllowedIn(bots, BOT)).includes(OWN_LINE)],
]) {
  test(`D15 ${label} read-only: --disallow is refused and nothing changes; with write access back, it goes through`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, { harness, allowed: ['Bash(git add:*)', OWN_RULE] });
    const file = fileOf(bots, BOT);
    assert.ok(await holds(bots), `the premise: ${file} holds the rule`);
    await chmod(file, 0o444);
    t.after(() => chmod(file, 0o644).catch(() => {}));
    const before = await snapshot(bots, skipGit);

    const result = await change(box, ...disallowing(OWN_RULE));

    assert.notEqual(result.code, 0, `a file the kit cannot write should be refused, got:\n${result.stdout}${result.stderr}`);
    assert.ok(!/^\s+at /m.test(`${result.stdout}${result.stderr}`), `expected a message, got a crash:\n${result.stderr}`);
    await assertNothingChanged(bots, before);
    assert.deepEqual(await allowOf(bots, BOT), ['Bash(git add:*)', OWN_RULE], 'allow still holds the rule');
    assert.ok(await holds(bots), `${file} still holds the rule`);

    await chmod(file, 0o644);
    await ok(change(box, ...disallowing(OWN_RULE)));
    assert.deepEqual(await allowOf(bots, BOT), ['Bash(git add:*)']);
    assert.ok(!(await holds(bots)), `the rule should have left ${file}`);
  });
}

// A bot.yaml the kit cannot write is refused the same way, before a harness
// file is touched.
for (const [label, harness, fileOf, holds, restart] of [
  ['a Claude bot', 'claude', settingsOf, async (bots) => (await allowedIn(bots, BOT)).includes(OWN_RULE), false],
  ['a Codex bot', 'codex', codexRulesOf, async (bots) => (await codexAllowedIn(bots, BOT)).includes(OWN_LINE), true],
]) {
  test(`D18 ${label} with a read-only bot.yaml: --disallow is refused and nothing changes; with write access back, it goes through`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, { harness, allowed: ['Bash(git add:*)', OWN_RULE] });
    const yamlFile = botYamlOf(bots, BOT);
    const file = fileOf(bots, BOT);
    assert.ok(await holds(bots), `the premise: ${file} holds the rule`);
    await chmod(yamlFile, 0o444);
    t.after(() => chmod(yamlFile, 0o644).catch(() => {}));
    const before = await snapshot(bots, skipGit);

    const result = await change(box, ...disallowing(OWN_RULE));

    assert.notEqual(result.code, 0, `a bot.yaml the kit cannot write should be refused, got:\n${result.stdout}${result.stderr}`);
    assert.ok(!/^\s+at /m.test(`${result.stdout}${result.stderr}`), `expected a message, got a crash:\n${result.stderr}`);
    await assertNothingChanged(bots, before);
    assert.deepEqual(await allowOf(bots, BOT), ['Bash(git add:*)', OWN_RULE], 'allow still holds the rule');
    assert.ok(await holds(bots), `${file} still holds the rule`);

    await chmod(yamlFile, 0o644);
    const retry = await ok(change(box, ...disallowing(OWN_RULE)));
    assert.deepEqual(await allowOf(bots, BOT), ['Bash(git add:*)']);
    assert.ok(!(await holds(bots)), `the rule should have left ${file}`);
    if (restart) assert.ok(retry.stdout.includes('obk restart'), `a Codex line left, so say obk restart, got:\n${retry.stdout}`);
  });
}

// ----------------------------------------------------------------- a bot.yaml edit that cannot be made

test('D16 --charter with --disallow changes nothing, the charter included, when allow carries an anchor another key uses', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: ['Bash(git add:*)', OWN_RULE] });
  // A valid bot.yaml, edited by hand: allow is anchored and a key of the user's own is an alias of it.
  const doc = parseDocument(await botText(bots));
  const allowNode = doc.get('allow', true);
  allowNode.anchor = 'grants';
  doc.set('notes', doc.createAlias(allowNode, 'grants'));
  await writeFile(botYamlOf(bots, BOT), String(doc));
  const text = await botText(bots);
  assert.ok(text.includes('&grants') && text.includes('*grants'), `the premise: an anchor and its alias, got:\n${text}`);
  assert.deepEqual(parse(text).notes, ['Bash(git add:*)', OWN_RULE], 'the premise: the file is valid and the alias reads as allow');
  const before = await snapshot(bots, skipGit);

  const result = await change(box, '--charter', NEW_CHARTER, ...disallowing(OWN_RULE));

  assert.notEqual(result.code, 0, `the edit cannot be made, so the run should be refused, got:\n${result.stdout}${result.stderr}`);
  assert.ok(!/^\s+at /m.test(`${result.stdout}${result.stderr}`), `expected a message, got a crash:\n${result.stderr}`);
  await assertNothingChanged(bots, before);
  assert.equal(parse(await botText(bots)).charter.trim(), CHARTER, 'the charter is the one it had');
});

// ----------------------------------------------------------------- obk restart, when a Codex line leaves

test('D17 a line leaving obk.rules: the plain report says obk restart', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { harness: 'codex', allowed: ['Bash(git add:*)', OWN_RULE] });

  const result = await ok(change(box, ...disallowing(OWN_RULE)));

  assert.deepEqual(await codexAllowedIn(bots, BOT), [ADD_LINE], 'the premise: the line left');
  assert.ok(result.stdout.includes('obk restart'), `a running Codex session keeps the rule until it restarts, so say obk restart, got:\n${result.stdout}`);
});

test('D17 the last line leaving obk.rules: the plain report says obk restart, and the file holds no rule', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { harness: 'codex', allowed: [OWN_RULE] });
  assert.deepEqual(await codexAllowedIn(bots, BOT), [OWN_LINE], 'the premise: obk.rules holds the one line');

  const result = await ok(change(box, ...disallowing(OWN_RULE)));

  assert.deepEqual(await allowOf(bots, BOT), []);
  const left = await codexAllowedIn(bots, BOT);
  assert.deepEqual(left.filter((line) => line.includes('prefix_rule')), [], `no prefix_rule should be left, got: ${JSON.stringify(left)}`);
  assert.ok(result.stdout.includes('obk restart'), `a running Codex session keeps the rule until it restarts, so say obk restart, got:\n${result.stdout}`);
});

for (const [label, options, allowed] of [
  ['the line stays because another rule gives it', { harness: 'codex' }, [OWN_RULE, OWN_RULE_SPACED]],
  ['a Claude-only bot', {}, ['Bash(git add:*)', OWN_RULE]],
]) {
  test(`D17 no line leaving obk.rules (${label}): the plain report does not say obk restart`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, { ...options, allowed });

    const result = await ok(change(box, ...disallowing(OWN_RULE)));

    assert.ok(!(await allowOf(bots, BOT)).includes(OWN_RULE), 'the premise: the rule left allow');
    assert.ok(!result.stdout.includes('obk restart'), `no Codex line left, so nothing to restart for, got:\n${result.stdout}`);
  });
}

// ----------------------------------------------------------------- a kit default taken back waits again

test('D9 a kit default taken back leaves allow and the settings file, and the report lists it as waiting with the command that allows it', async (t) => {
  const box = await createSandbox(t);
  const defaults = defaultRules(box, box.path('bots'));
  const add = defaults[4];
  const bots = await withBot(box, { allowed: defaults });

  const result = await change(box, ...disallowing(add));

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.deepEqual(await allowOf(bots, BOT), defaults.filter((rule) => rule !== add));
  assert.deepEqual(await allowedIn(bots, BOT), defaults.filter((rule) => rule !== add));
  const command = allowCommand(box, bots, BOT, [add]);
  assert.ok(result.stdout.includes(command), `the report should offer the command that allows ${add} again:\n${command}\ngot:\n${result.stdout}`);
});

test('D9 after a kit default is taken back, rules build lists it waiting, with the command', async (t) => {
  const box = await createSandbox(t);
  const defaults = defaultRules(box, box.path('bots'));
  const [check] = defaults;
  const bots = await withBot(box, { allowed: defaults });

  await ok(change(box, ...disallowing(check)));

  const answer = jsonOf(await box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT, '--json']));
  assert.deepEqual(waitingOf(answer, BOT), [check]);
  const plain = await ok(box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT]));
  assert.ok(plain.stdout.includes(allowCommand(box, bots, BOT, [check])), `rules build should offer ${check} again, got:\n${plain.stdout}`);
});

// ----------------------------------------------------------------- with --charter

test('D10 --charter with --disallow changes the charter and takes the rule back, in one run', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: ['Bash(git add:*)', OWN_RULE] });

  await ok(change(box, '--charter', NEW_CHARTER, ...disallowing(OWN_RULE)));

  const doc = parse(await botText(bots));
  assert.equal(doc.charter.trim(), NEW_CHARTER);
  assert.deepEqual(doc.allow, ['Bash(git add:*)']);
  assert.deepEqual(await allowedIn(bots, BOT), ['Bash(git add:*)']);
});

// ----------------------------------------------------------------- the report

test('D11 --json carries allow, the whole list now, and disallowed, the rules taken out in the order given', async (t) => {
  const box = await createSandbox(t);
  const [add, commit] = ['Bash(git add:*)', 'Bash(git commit:*)'];
  const bots = await withBot(box, { allowed: [add, OWN_RULE, CLOSE_RULE, commit] });

  const answer = jsonOf(await change(box, ...disallowing(CLOSE_RULE, add, CLOSE_RULE), '--json'));

  assert.deepEqual(answer.disallowed, [CLOSE_RULE, add]);
  assert.deepEqual(answer.allow, [OWN_RULE, commit]);
  assert.deepEqual(await allowOf(bots, BOT), [OWN_RULE, commit], 'the answer says what the file holds');
});

test('D11 the plain report names each rule taken out, word for word', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, { allowed: ['Bash(git add:*)', OWN_RULE, CLOSE_RULE] });

  const result = await change(box, ...disallowing(OWN_RULE, CLOSE_RULE));

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  for (const rule of [OWN_RULE, CLOSE_RULE]) {
    assert.ok(result.stdout.includes(rule), `the report should name ${rule}, got:\n${result.stdout}`);
  }
  assert.deepEqual(await allowOf(bots, BOT), ['Bash(git add:*)']);
});

// ----------------------------------------------------------------- health afterwards

for (const [label, options] of [
  ['a Claude bot', {}],
  ['a Codex bot', { harness: 'codex' }],
  ['a bot on both harnesses', { harness: 'codex', sessions: BOTH }],
]) {
  test(`D12 after a take-back, health has no finding about the rule for ${label}`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, { ...options, allowed: ['Bash(git add:*)', OWN_RULE] });

    // Findings about the rule, its Codex line, or the files it lives in.
    const aboutIt = (found) => found.filter((one) => one.bot === BOT
      && [OWN_RULE, OWN_LINE, settingsOf(bots, BOT), codexRulesOf(bots, BOT)].some((text) => `${one.says} ${one.where}`.includes(text)));
    assert.deepEqual(aboutIt(await healthFindings(box)), [], 'the premise: with the rule allowed and written, health has nothing to say about it');

    await ok(change(box, ...disallowing(OWN_RULE)));

    assert.deepEqual(await allowOf(bots, BOT), ['Bash(git add:*)'], 'the premise: the rule left allow');
    const about = aboutIt(await healthFindings(box));
    assert.deepEqual(about, [], `nothing should be left to say about ${OWN_RULE}, got: ${JSON.stringify(about, null, 2)}`);
  });
}

// ----------------------------------------------------------------- the charter change points at --disallow

test('D13 a charter change for a bot with rules beyond the defaults says how to take one back: --disallow', async (t) => {
  const box = await createSandbox(t);
  await withBot(box, { allowed: [OWN_RULE] });

  const result = await change(box, '--charter', NEW_CHARTER);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.ok(result.stdout.includes(OWN_RULE), `the premise: the report names ${OWN_RULE}, got:\n${result.stdout}`);
  assert.ok(result.stdout.includes('--disallow'), `the report should say how to take a rule back, got:\n${result.stdout}`);
});

// ----------------------------------------------------------------- help

test('D14 --help lists --disallow under bot change', async (t) => {
  const box = await createSandbox(t);

  const result = await box.run(['--help']);

  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.split('\n');
  const from = lines.findIndex((line) => line.includes('obk bot change'));
  assert.notEqual(from, -1, `--help should list bot change, got:\n${result.stdout}`);
  const to = lines.findIndex((line, at) => at > from && /^\s*obk /.test(line));
  const block = lines.slice(from, to === -1 ? undefined : to).join('\n');
  assert.ok(block.includes('--disallow'), `bot change's entry should list --disallow, got:\n${block}`);
});
