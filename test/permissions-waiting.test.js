// The kit's default permission rules, and what waits for the user's yes
// (#344 slice A, and #354 slice C for Codex).
//
// A bot in auto mode should not be stopped by the harness's check for what the
// kit's own rules tell every bot to do: read and send its mail through the kit,
// read a long message's body beside the bots folder, and commit. So every bot
// that runs on Claude is offered exactly six rules, spelled with the kit's real
// CLI and bots folder (helpers/permissions.js spells them from the
// requirement). A bot runs on Claude when its harness is `claude` or any of its
// sessions says `harness: claude`, and on Codex the same way with `codex`; it
// can run on both.
//
// A bot that runs only on Codex is offered five: the six without the Read rule,
// since Codex's sandbox reads every file already. They are listed in Claude
// Code's text, as the six are, because bot.yaml's `allow` keeps the yes in that
// text for either harness. A bot that runs on both is offered all six, in one
// block with one command, not one block per harness.
//
// Nothing is written without a yes. `bot create`, `init` (Bot Father, on
// either harness), `rules build` and `up` show every default rule the bot's
// `allow` does not hold, verbatim, and one command that allows them all:
//
//   <CLI> bot change --bots <BOTS-word> --bot <bot> --allow <rule1> --allow <rule2> ...
//
// each word as the kit writes a shell word. Running that exact command works,
// and afterwards nothing waits. A bot with nothing waiting gets no word about
// rules. `--json` answers carry `permissions`: one entry per harness file of
// each bot the command was about, `{ bot, file, written, waiting }` for the
// Claude settings file and `{ bot, file, written, waiting, unwritten }` for
// `.codex/rules/obk.rules`. Until allowed, the waiting rules are written
// nowhere: not in bot.yaml, not in the settings file, not in obk.rules.
//
// Plain text is read only for the exact rule strings and the command; the
// wording around them is the implementer's.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSandbox, sh } from './helpers/cli.js';
import {
  allowCommand,
  allowedIn,
  allowOf,
  codexAllowedIn,
  codexDefaultLines,
  codexDefaultRules,
  codexRulesOf,
  defaultRules,
  entryAt,
  jsonOf,
  mentionsAny,
  offeredCommand,
  OWN_RULE,
  permissionBots,
  readDefault,
  settingsOf,
  waitingOf,
  writeAllow,
} from './helpers/permissions.js';

/** A bots folder `init` made, on `harness`. */
async function seeded(box, harness = 'claude', folder = 'bots') {
  const result = await box.run(['init', '--bots', folder, '--harness', harness]);
  assert.equal(result.code, 0, result.stderr);
  return box.path(folder);
}

/** One more bot, written through the kit, with the sessions given: `[name, ...settings]` each. */
async function makeBot(box, name, harness = 'claude', sessions = [], folder = 'bots') {
  const made = await box.run(['bot', 'create', '--bots', folder, '--name', name, '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  for (const [session, ...settings] of sessions) {
    const added = await box.run(['session', 'add', '--bots', folder, '--bot', name, '--name', session, ...settings]);
    assert.equal(added.code, 0, added.stderr);
  }
}

/** Every rule and the one command in a plain report, each exactly as the requirement spells it. */
function assertOffers(stdout, rules, command) {
  for (const rule of rules) {
    assert.ok(stdout.includes(rule), `the report should name the waiting rule ${rule} verbatim, got:\n${stdout}`);
  }
  assert.ok(stdout.includes(command), `the report should give the one command that allows them:\n${command}\ngot:\n${stdout}`);
}

/** A plain report that says nothing about rules: no default rule, and no allow command. */
function assertSilent(stdout, rules) {
  assert.deepEqual(mentionsAny(stdout, rules), [], `nothing waits, so no rule should be named, got:\n${stdout}`);
  assert.ok(!stdout.includes('--allow'), `and no allow command offered, got:\n${stdout}`);
}

// ----------------------------------------------------------------- the default set

test('P1 bot create of a Claude bot answers with exactly the six default rules waiting, in order', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);

  const answer = jsonOf(await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude', '--json']));

  assert.deepEqual(permissionBots(answer), ['api-bot'], 'one entry, about the one bot the command was about');
  assert.deepEqual(waitingOf(answer, 'api-bot'), defaultRules(box, bots));
});

test('P1 bot create of a Claude bot names each waiting rule and the one command that allows them', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);

  const result = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude']);

  assert.equal(result.code, 0, result.stderr);
  assertOffers(result.stdout, defaultRules(box, bots), allowCommand(box, bots, 'api-bot', defaultRules(box, bots)));
});

test('P2 bot create of a bot that runs only on Codex answers with one entry, for its obk.rules, the five waiting', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);

  const answer = jsonOf(await box.run(['bot', 'create', '--bots', 'bots', '--name', 'codex-bot', '--harness', 'codex', '--json']));

  assert.deepEqual(permissionBots(answer), ['codex-bot'], 'one entry: the bot has one harness file');
  const entry = entryAt(answer, 'codex-bot', codexRulesOf(bots, 'codex-bot'));
  assert.deepEqual(entry.waiting, codexDefaultRules(box, bots), 'the six without the Read rule, in Claude text, in order');
  assert.deepEqual(entry.written, [], 'nothing was written');
  assert.deepEqual(entry.unwritten, [], 'nothing is allowed, so nothing is left without a Codex form');
});

test('P2 bot create of a Codex bot names the five and the one command that allows them, and not the Read rule', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);

  const result = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'codex-bot', '--harness', 'codex']);

  assert.equal(result.code, 0, result.stderr);
  const five = codexDefaultRules(box, bots);
  assertOffers(result.stdout, five, allowCommand(box, bots, 'codex-bot', five));
  assert.equal(offeredCommand(box, result.stdout, 'codex-bot'), allowCommand(box, bots, 'codex-bot', five));
  assert.deepEqual(mentionsAny(result.stdout, [readDefault(box, bots)]), [], `a Codex bot needs no Read rule, got:\n${result.stdout}`);
});

for (const [label, harness, sessions] of [
  ['a Codex bot with one Claude session', 'codex', [['daily'], ['review', '--harness', 'claude']]],
  ['a Claude bot with one Codex session', 'claude', [['daily'], ['review', '--harness', 'codex']]],
]) {
  test(`P2 ${label} runs on both: one entry per harness file, six waiting for Claude and five for Codex`, async (t) => {
    const box = await createSandbox(t);
    const bots = await seeded(box);
    await makeBot(box, 'mixed-bot', harness, sessions);

    const answer = jsonOf(await box.run(['rules', 'build', '--bots', 'bots', '--bot', 'mixed-bot', '--json']));

    assert.deepEqual(permissionBots(answer), ['mixed-bot', 'mixed-bot'], `two entries, got: ${JSON.stringify(answer.permissions)}`);
    assert.deepEqual(entryAt(answer, 'mixed-bot', settingsOf(bots, 'mixed-bot')).waiting, defaultRules(box, bots));
    assert.deepEqual(entryAt(answer, 'mixed-bot', codexRulesOf(bots, 'mixed-bot')).waiting, codexDefaultRules(box, bots));
  });
}

test('P2 a bot on both harnesses is offered all six once: one block, one command', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'mixed-bot', 'codex', [['daily'], ['review', '--harness', 'claude']]);

  const plain = await box.run(['rules', 'build', '--bots', 'bots', '--bot', 'mixed-bot']);

  assert.equal(plain.code, 0, plain.stderr);
  assertOffers(plain.stdout, defaultRules(box, bots), allowCommand(box, bots, 'mixed-bot', defaultRules(box, bots)));
  // offeredCommand holds the report to exactly one command line for the bot.
  assert.equal(offeredCommand(box, plain.stdout, 'mixed-bot'), allowCommand(box, bots, 'mixed-bot', defaultRules(box, bots)));
});

// ----------------------------------------------------------------- init

test('P3 init --harness claude answers with Bot Father\'s six waiting, and names them with the command', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');

  const answer = jsonOf(await box.run(['init', '--bots', 'bots', '--harness', 'claude', '--json']));
  assert.deepEqual(waitingOf(answer, 'bot-father'), defaultRules(box, bots));

  const other = await createSandbox(t);
  const otherBots = other.path('bots');
  const plain = await other.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(plain.code, 0, plain.stderr);
  assertOffers(plain.stdout, defaultRules(other, otherBots), allowCommand(other, otherBots, 'bot-father', defaultRules(other, otherBots)));
});

test('P3 init --harness codex answers with Bot Father\'s five waiting, and names them with the command', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');

  const answer = jsonOf(await box.run(['init', '--bots', 'bots', '--harness', 'codex', '--json']));
  assert.deepEqual(permissionBots(answer), ['bot-father']);
  assert.deepEqual(entryAt(answer, 'bot-father', codexRulesOf(bots, 'bot-father')).waiting, codexDefaultRules(box, bots));

  const other = await createSandbox(t);
  const otherBots = other.path('bots');
  const plain = await other.run(['init', '--bots', 'bots', '--harness', 'codex']);
  assert.equal(plain.code, 0, plain.stderr);
  const five = codexDefaultRules(other, otherBots);
  assertOffers(plain.stdout, five, allowCommand(other, otherBots, 'bot-father', five));
  assert.deepEqual(mentionsAny(plain.stdout, [readDefault(other, otherBots)]), [], `no Read rule for a Codex Bot Father, got:\n${plain.stdout}`);
});

// ----------------------------------------------------------------- rules build and up

test('P4 rules build answers with one entry per bot and harness file: the six for a Claude bot, the five for a Codex bot', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  await makeBot(box, 'codex-bot', 'codex');

  const answer = jsonOf(await box.run(['rules', 'build', '--bots', 'bots', '--json']));

  assert.deepEqual([...permissionBots(answer)].sort(), ['api-bot', 'bot-father', 'codex-bot']);
  assert.deepEqual(entryAt(answer, 'api-bot', settingsOf(bots, 'api-bot')).waiting, defaultRules(box, bots));
  assert.deepEqual(entryAt(answer, 'bot-father', settingsOf(bots, 'bot-father')).waiting, defaultRules(box, bots));
  assert.deepEqual(entryAt(answer, 'codex-bot', codexRulesOf(bots, 'codex-bot')).waiting, codexDefaultRules(box, bots));
});

test('P4 rules build --bot answers only about that bot, and names its waiting rules with the command', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');

  const answer = jsonOf(await box.run(['rules', 'build', '--bots', 'bots', '--bot', 'api-bot', '--json']));
  assert.deepEqual(permissionBots(answer), ['api-bot']);

  const plain = await box.run(['rules', 'build', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(plain.code, 0, plain.stderr);
  assertOffers(plain.stdout, defaultRules(box, bots), allowCommand(box, bots, 'api-bot', defaultRules(box, bots)));
});

test('P5 up answers with the waiting rules of the bot it brought up, and names them with the command', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot', 'claude', [['daily']]);

  const answer = jsonOf(await box.run(['up', '--bots', 'bots', '--bot', 'api-bot', '--json']));
  assert.deepEqual(permissionBots(answer), ['api-bot']);
  assert.deepEqual(waitingOf(answer, 'api-bot'), defaultRules(box, bots));

  const plain = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(plain.code, 0, plain.stderr);
  assertOffers(plain.stdout, defaultRules(box, bots), allowCommand(box, bots, 'api-bot', defaultRules(box, bots)));
});

test('P6 only the default rules the bot has not allowed wait, in the default order', async (t) => {
  // Two of the six allowed, and one rule of the user's own that is no default:
  // four wait, the own rule does not, and the command allows exactly the four.
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot');
  const defaults = defaultRules(box, bots);
  await writeAllow(bots, 'api-bot', [defaults[4], OWN_RULE, defaults[0]]);
  const waiting = [defaults[1], defaults[2], defaults[3], defaults[5]];

  const answer = jsonOf(await box.run(['rules', 'build', '--bots', 'bots', '--bot', 'api-bot', '--json']));
  assert.deepEqual(waitingOf(answer, 'api-bot'), waiting);

  const plain = await box.run(['rules', 'build', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(plain.code, 0, plain.stderr);
  assertOffers(plain.stdout, waiting, allowCommand(box, bots, 'api-bot', waiting));
  assert.equal(offeredCommand(box, plain.stdout, 'api-bot'), allowCommand(box, bots, 'api-bot', waiting));
});

// ----------------------------------------------------------------- nothing is written without a yes

test('P7 the waiting rules are written nowhere: not in bot.yaml, not in the settings file', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot', 'claude', [['daily']]);

  for (const args of [['rules', 'build', '--bots', 'bots'], ['up', '--bots', 'bots']]) {
    const result = await box.run(args);
    assert.equal(result.code, 0, result.stderr);
  }

  for (const bot of ['api-bot', 'bot-father']) {
    assert.deepEqual(await allowOf(bots, bot), [], `${bot}'s bot.yaml holds no yes the user never gave`);
    assert.deepEqual(await allowedIn(bots, bot), [], `${bot}'s settings allow nothing the user never allowed`);
  }
});

// ----------------------------------------------------------------- the offered command works

test('P8 the command bot create offers, run as printed, allows all six and nothing waits after it', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  const created = await box.run(['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude']);
  assert.equal(created.code, 0, created.stderr);
  const command = offeredCommand(box, created.stdout, 'api-bot');

  const ran = await sh(command, { env: box.env, cwd: box.cwd });

  assert.equal(ran.code, 0, `the offered command should run: ${command}\n${ran.stdout}${ran.stderr}`);
  assert.deepEqual(await allowOf(bots, 'api-bot'), defaultRules(box, bots), 'the yes is kept in bot.yaml, in order');
  assert.deepEqual(await allowedIn(bots, 'api-bot'), defaultRules(box, bots), 'and written into the bot\'s settings');

  const answer = jsonOf(await box.run(['rules', 'build', '--bots', 'bots', '--bot', 'api-bot', '--json']));
  assert.deepEqual(waitingOf(answer, 'api-bot'), [], 'nothing waits any more');
  const plain = await box.run(['rules', 'build', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(plain.code, 0, plain.stderr);
  assertSilent(plain.stdout, defaultRules(box, bots));
});

test('P8 in a bots folder with a space in its path, the rules and the offered command still hold', async (t) => {
  // The folder is a word that needs quoting, inside a rule that is itself a
  // word that needs quoting: the command has to survive both.
  const box = await createSandbox(t);
  const bots = await seeded(box, 'claude', 'my bots');
  const made = await box.run(['bot', 'create', '--bots', 'my bots', '--name', 'api-bot', '--harness', 'claude', '--json']);
  assert.deepEqual(waitingOf(jsonOf(made), 'api-bot'), defaultRules(box, bots));
  // The premise: the folder is quoted inside the Bash rules and plain in the Read rule.
  assert.ok(defaultRules(box, bots)[0].includes(`--bots '${bots}':*)`));
  assert.equal(defaultRules(box, bots)[3], `Read(/${bots}.messages/**)`);

  const plain = await box.run(['rules', 'build', '--bots', 'my bots', '--bot', 'api-bot']);
  assert.equal(plain.code, 0, plain.stderr);
  const command = offeredCommand(box, plain.stdout, 'api-bot');
  const ran = await sh(command, { env: box.env, cwd: box.cwd });

  assert.equal(ran.code, 0, `the offered command should run: ${command}\n${ran.stdout}${ran.stderr}`);
  assert.deepEqual(await allowOf(bots, 'api-bot'), defaultRules(box, bots));
  const after = jsonOf(await box.run(['rules', 'build', '--bots', 'my bots', '--bot', 'api-bot', '--json']));
  assert.deepEqual(waitingOf(after, 'api-bot'), []);
});

test('P9 up for a bot with nothing waiting says nothing about rules, and its entry waits for nothing', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'api-bot', 'claude', [['daily']]);
  await writeAllow(bots, 'api-bot', defaultRules(box, bots));

  const plain = await box.run(['up', '--bots', 'bots', '--bot', 'api-bot']);
  assert.equal(plain.code, 0, plain.stderr);
  assertSilent(plain.stdout, defaultRules(box, bots));

  const answer = jsonOf(await box.run(['up', '--bots', 'bots', '--bot', 'api-bot', '--json']));
  assert.deepEqual(waitingOf(answer, 'api-bot'), []);
});

// ----------------------------------------------------------------- the same for a Codex bot

test('P5 up of a Codex bot answers with its five waiting, and names them with the command', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'codex-bot', 'codex', [['daily']]);

  const answer = jsonOf(await box.run(['up', '--bots', 'bots', '--bot', 'codex-bot', '--json']));
  assert.deepEqual(permissionBots(answer), ['codex-bot']);
  assert.deepEqual(waitingOf(answer, 'codex-bot'), codexDefaultRules(box, bots));

  const plain = await box.run(['up', '--bots', 'bots', '--bot', 'codex-bot']);
  assert.equal(plain.code, 0, plain.stderr);
  const five = codexDefaultRules(box, bots);
  assertOffers(plain.stdout, five, allowCommand(box, bots, 'codex-bot', five));
});

test('P7 the five waiting for a Codex bot are written nowhere: not in bot.yaml, not in obk.rules', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box, 'codex');
  await makeBot(box, 'codex-bot', 'codex', [['daily']]);

  for (const args of [['rules', 'build', '--bots', 'bots'], ['up', '--bots', 'bots']]) {
    const result = await box.run(args);
    assert.equal(result.code, 0, result.stderr);
  }

  for (const bot of ['codex-bot', 'bot-father']) {
    assert.deepEqual(await allowOf(bots, bot), [], `${bot}'s bot.yaml holds no yes the user never gave`);
    assert.deepEqual(await codexAllowedIn(bots, bot), [], `${bot}'s obk.rules allows nothing the user never allowed`);
  }
});

for (const [label, folder] of [
  ['a plain bots folder', 'bots'],
  ['a bots folder with a space in its path', 'my bots'],
  ['a bots folder with an apostrophe and a space in its path', "bob's bots"],
]) {
  test(`P8 in ${label}, the command bot create offers a Codex bot, run as printed, writes the five into obk.rules, and nothing waits after it`, async (t) => {
    // The Claude rule quotes the folder where it needs it; the Codex pattern
    // holds the folder as the plain path, one word.
    const box = await createSandbox(t);
    const bots = await seeded(box, 'claude', folder);
    const created = await box.run(['bot', 'create', '--bots', folder, '--name', 'codex-bot', '--harness', 'codex']);
    assert.equal(created.code, 0, created.stderr);
    const command = offeredCommand(box, created.stdout, 'codex-bot');

    const ran = await sh(command, { env: box.env, cwd: box.cwd });

    assert.equal(ran.code, 0, `the offered command should run: ${command}\n${ran.stdout}${ran.stderr}`);
    assert.deepEqual(await allowOf(bots, 'codex-bot'), codexDefaultRules(box, bots), 'the yes is kept in bot.yaml, in Claude text, in order');
    assert.deepEqual(await codexAllowedIn(bots, 'codex-bot'), codexDefaultLines(box, bots), 'and written into obk.rules in Codex\'s form');

    const answer = jsonOf(await box.run(['rules', 'build', '--bots', folder, '--bot', 'codex-bot', '--json']));
    assert.deepEqual(waitingOf(answer, 'codex-bot'), [], 'nothing waits any more');
    const plain = await box.run(['rules', 'build', '--bots', folder, '--bot', 'codex-bot']);
    assert.equal(plain.code, 0, plain.stderr);
    assertSilent(plain.stdout, defaultRules(box, bots));
  });
}

test('P8 the six a bot on both harnesses is offered, allowed as printed, go into its Claude settings, and five of them into obk.rules', async (t) => {
  const box = await createSandbox(t);
  const bots = await seeded(box);
  await makeBot(box, 'mixed-bot', 'codex', [['daily'], ['review', '--harness', 'claude']]);
  const plain = await box.run(['rules', 'build', '--bots', 'bots', '--bot', 'mixed-bot']);
  assert.equal(plain.code, 0, plain.stderr);
  const command = offeredCommand(box, plain.stdout, 'mixed-bot');

  const ran = await sh(command, { env: box.env, cwd: box.cwd });

  assert.equal(ran.code, 0, `the offered command should run: ${command}\n${ran.stdout}${ran.stderr}`);
  assert.deepEqual(await allowOf(bots, 'mixed-bot'), defaultRules(box, bots));
  assert.deepEqual(await allowedIn(bots, 'mixed-bot'), defaultRules(box, bots));
  assert.deepEqual(await codexAllowedIn(bots, 'mixed-bot'), codexDefaultLines(box, bots), 'the Read rule needs no Codex line');
  const after = jsonOf(await box.run(['rules', 'build', '--bots', 'bots', '--bot', 'mixed-bot', '--json']));
  for (const file of [settingsOf(bots, 'mixed-bot'), codexRulesOf(bots, 'mixed-bot')]) {
    assert.deepEqual(entryAt(after, 'mixed-bot', file).waiting, [], `nothing waits for ${file}`);
  }
});
