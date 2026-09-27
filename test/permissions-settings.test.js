// Writing the allowed rules into a bot's `.claude/settings.json`
// `permissions.allow` (#344 slice A).
//
// `rules build`, `up` (before any tab opens, like the hook) and `bot change
// --allow` write it, for a bot that runs on Claude. What is pinned:
//
// - every rule in bot.yaml `allow` is in the file, and a rule that is not there
//   is never added, the kit's own default set included;
// - everything else in the file is kept as it was: the kit's hook, the other
//   `permissions` keys, entries in `permissions.allow` the kit did not write,
//   and their order. Allowed rules missing from the file are appended after
//   what is there, and none twice;
// - a run that changes nothing leaves the file untouched, content and mtime;
// - nothing outside the bot folder, and never user-level settings: a settings
//   file that is a link leading outside the bot folder is refused by name, as
//   the hook is, and the sandbox's HOME stays as it was seeded;
// - a bot that runs only on Codex gets no Claude settings from this; its rules
//   go into its obk.rules instead (#354, permissions-codex.test.js).
//
// And the kit's rules: every bot's built AGENTS.md tells it that permission
// rules are written by the kit through `obk bot change --allow`, never by hand.
// Only the command is read there; the prose around it is the implementer's.

import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, readlink, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  assertHomeUntouched,
  assertRefused,
  createSandbox,
  kitHooksIn,
  orcaCallsOf,
} from './helpers/cli.js';
import {
  allowedIn,
  codexAllowedIn,
  defaultRules,
  FOREIGN_RULE,
  OWN_RULE,
  prefixRule,
  settingsIn,
  settingsOf,
  writeAllow,
} from './helpers/permissions.js';
import { agentsIn, blockIn } from './helpers/rules.js';

const BOT = 'api-bot';

/** A bots folder `init` made on Claude, with one more bot on `harness` and a daily session. */
async function withBot(box, harness = 'claude') {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', 'daily']);
  assert.equal(added.code, 0, added.stderr);
  return box.path('bots');
}

/** The commands that write the settings from bot.yaml `allow`, each run for the one bot. */
const WRITERS = {
  'rules build': (box) => box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT]),
  up: (box) => box.run(['up', '--bots', 'bots', '--bot', BOT]),
};

/** Run a command that has to go through for the test to mean anything. */
async function ok(promise) {
  const result = await promise;
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  return result;
}

/** Put `settings` in the bot's Claude settings file, as the user would write it. */
async function writeSettings(bots, settings) {
  const file = settingsOf(bots, BOT);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);
}

// ----------------------------------------------------------------- only what was allowed

for (const [writer, run] of Object.entries(WRITERS)) {
  test(`S1 ${writer} writes exactly the rules in allow, in its order, and none of the defaults besides`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    const [, , , , add] = defaultRules(box, bots);
    await writeAllow(bots, BOT, [OWN_RULE, add]);

    await ok(run(box));

    assert.deepEqual(await allowedIn(bots, BOT), [OWN_RULE, add]);
    assert.deepEqual(await allowedIn(bots, 'bot-father'), [], 'Bot Father allowed nothing, so nothing is written for it');
  });
}

// ----------------------------------------------------------------- the rest of the file is kept

test('S2 the hook, the other permissions keys, the user\'s own entries and their order are all kept', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const [, , , read] = defaultRules(box, bots);
  const theirs = {
    permissions: {
      allow: ['Bash(npm test:*)', FOREIGN_RULE, 'Bash(git status)'],
      deny: ['Bash(rm -rf:*)'],
      ask: ['Bash(git push:*)'],
      defaultMode: 'default',
      additionalDirectories: ['../shared'],
    },
    env: { MY_KEY: 'mine' },
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo before' }] }] },
    theme: 'dark',
  };
  await writeSettings(bots, theirs);
  await ok(box.run(['up', '--bots', 'bots', '--bot', BOT]));

  await ok(box.run(['bot', 'change', '--bots', 'bots', '--bot', BOT, '--allow', read, '--allow', OWN_RULE]));
  await ok(box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT]));
  await ok(box.run(['up', '--bots', 'bots', '--bot', BOT]));

  const now = await settingsIn(bots, BOT);
  assert.deepEqual(now.permissions.allow, [...theirs.permissions.allow, read, OWN_RULE], 'theirs first, as they were, then the allowed ones, once each');
  for (const key of ['deny', 'ask', 'defaultMode', 'additionalDirectories']) {
    assert.deepEqual(now.permissions[key], theirs.permissions[key], `permissions.${key} is the user's`);
  }
  assert.deepEqual(now.env, theirs.env);
  assert.equal(now.theme, theirs.theme);
  assert.deepEqual(now.hooks.PreToolUse, theirs.hooks.PreToolUse);
  assert.equal(kitHooksIn(now).length, 1, `the kit's hook is still there, once, got: ${JSON.stringify(now.hooks)}`);
});

test('S3 an allowed rule already in the file is not written twice, and keeps its place', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const [, , , , add, commit] = defaultRules(box, bots);
  await ok(box.run(['up', '--bots', 'bots', '--bot', BOT]));
  const settings = await settingsIn(bots, BOT);
  settings.permissions = { allow: [FOREIGN_RULE, add] };
  await writeSettings(bots, settings);
  await writeAllow(bots, BOT, [add, commit]);

  await ok(box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT]));

  assert.deepEqual(await allowedIn(bots, BOT), [FOREIGN_RULE, add, commit]);
});

// ----------------------------------------------------------------- a run with nothing to do

const PAST = new Date('2020-01-01T00:00:00Z');

for (const [writer, run] of Object.entries({
  ...WRITERS,
  'bot change --allow of a rule already allowed': (box) => box.run(['bot', 'change', '--bots', 'bots', '--bot', BOT, '--allow', OWN_RULE]),
})) {
  test(`S4 ${writer} with nothing new to write leaves the settings file untouched, content and mtime`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    await ok(box.run(['up', '--bots', 'bots', '--bot', BOT]));
    await ok(box.run(['bot', 'change', '--bots', 'bots', '--bot', BOT, '--allow', OWN_RULE, '--allow', 'Bash(git add:*)']));
    const file = settingsOf(bots, BOT);
    const before = await readFile(file, 'utf8');
    await utimes(file, PAST, PAST);

    await ok(run(box));

    assert.equal(await readFile(file, 'utf8'), before);
    assert.equal((await stat(file)).mtime.getTime(), PAST.getTime(), 'the file was not written again');
  });
}

// ----------------------------------------------------------------- up writes before any tab

test('S5 up has written the allowed rules before it opens the bot\'s tab', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);
  const [check, , , read] = defaultRules(box, bots);
  await writeAllow(bots, BOT, [check, read]);
  const kept = path.join(box.root, 'settings-at-tab.json');
  const witness = path.join(box.root, 'witness.cjs');
  await writeFile(witness, "require('node:fs').copyFileSync(process.env.OBK_TEST_WATCH, process.env.OBK_TEST_WITNESS);\n");
  await chmod(witness, 0o755);
  const already = orcaCallsOf(await box.orca.calls(), 'terminal create').length;
  await box.orca.set({
    runDuring: {
      command: 'terminal create',
      on: already + 1,
      argv: [process.execPath, witness],
      env: { OBK_TEST_WATCH: settingsOf(bots, BOT), OBK_TEST_WITNESS: kept },
    },
  });

  await ok(box.run(['up', '--bots', 'bots', '--bot', BOT]));

  const ran = await box.orca.ranDuring();
  assert.equal(ran.length, 1, `the witness should have run as the tab was made, got: ${JSON.stringify(ran)}`);
  assert.equal(ran[0].status, 0, `the settings file should have been there to copy: ${ran[0].stderr}`);
  assert.deepEqual(JSON.parse(await readFile(kept, 'utf8')).permissions?.allow, [check, read]);
});

// ----------------------------------------------------------------- never outside the bot folder

/** What a user keeps in their own settings, outside every bot. */
const USERS_OWN = `${JSON.stringify({ permissions: { allow: ['Bash(git status)'] }, theme: 'dark' }, null, 2)}\n`;

for (const [writer, run] of Object.entries({
  ...WRITERS,
  'bot change --allow': (box) => box.run(['bot', 'change', '--bots', 'bots', '--bot', BOT, '--allow', OWN_RULE]),
})) {
  test(`S6 ${writer} refuses a settings file that links outside the bot folder, and the user's file is untouched`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box);
    await writeAllow(bots, BOT, ['Bash(git add:*)']);
    const file = settingsOf(bots, BOT);
    const target = path.join(box.home, '.claude', 'settings.json');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, USERS_OWN);
    await mkdir(path.dirname(file), { recursive: true });
    await rm(file, { force: true });
    await symlink(target, file);

    const result = await run(box);

    assertRefused(result, file);
    assert.equal(await readFile(target, 'utf8'), USERS_OWN, 'the user\'s own settings, byte for byte');
    assert.equal(await readlink(file), target, 'and the link is left as they made it');
  });
}

test('S7 allowing, building and bringing up write nothing in the user\'s home', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box);

  await ok(box.run(['bot', 'change', '--bots', 'bots', '--bot', BOT, ...defaultRules(box, bots).flatMap((rule) => ['--allow', rule])]));
  await ok(box.run(['bot', 'change', '--bots', 'bots', '--bot', 'bot-father', '--allow', OWN_RULE]));
  await ok(box.run(['rules', 'build', '--bots', 'bots']));
  await ok(box.run(['up', '--bots', 'bots']));

  assert.deepEqual(await allowedIn(bots, BOT), defaultRules(box, bots), 'the rules went into the bot folder');
  await assertHomeUntouched(box);
});

// ----------------------------------------------------------------- only Claude

test('S8 a bot that runs only on Codex gets no Claude settings, whatever its allow holds: its rules go into obk.rules', async (t) => {
  const box = await createSandbox(t);
  const bots = await withBot(box, 'codex');
  await writeAllow(bots, BOT, ['Bash(git add:*)']);

  await ok(box.run(['rules', 'build', '--bots', 'bots', '--bot', BOT]));
  await ok(box.run(['up', '--bots', 'bots', '--bot', BOT]));

  assert.equal(await settingsIn(bots, BOT), undefined, `${settingsOf(bots, BOT)} has no reason to exist`);
  assert.deepEqual(await codexAllowedIn(bots, BOT), [prefixRule(['git', 'add'])], 'the yes went into the Codex form instead');
});

// ----------------------------------------------------------------- the kit's rules say so

for (const [label, bot, harness] of [
  ['Bot Father', 'bot-father', 'claude'],
  ['a Claude bot', BOT, 'claude'],
  ['a Codex bot', BOT, 'codex'],
]) {
  test(`S9 ${label}'s built AGENTS.md names obk bot change --allow as the way permission rules are written`, async (t) => {
    const box = await createSandbox(t);
    const bots = await withBot(box, harness);

    const block = blockIn(await agentsIn(bots, bot)).body;

    const lines = block.split('\n').filter((line) => line.includes('bot change'));
    assert.notEqual(lines.length, 0, `the kit's block in ${bot}'s AGENTS.md should name obk bot change`);
    assert.ok(block.includes('--allow'), `with --allow, got the lines: ${JSON.stringify(lines)}`);
  });
}
