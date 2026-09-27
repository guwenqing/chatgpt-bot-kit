// Every bot knows, without anyone adding it, that it may make temporary
// sessions of its own bot and must retire them (issue #251, the second slice
// of #227; PRD 6.4). The first slice (#250) made the commands, `obk temp make`
// and `obk temp retire`; this one makes them something every bot is told about.
//
// What is held here:
//
//   R1  A new bot's AGENTS.md, as `bot create` writes it, and Bot Father's, as
//       `init` writes it, carry a rule that names `temp make` and `temp
//       retire` and says to retire one's own finished temporary sessions
//       before making another. Nothing in the bots folder asks for it: it
//       comes the way the kit's other rules every bot carries come.
//   R2  A bot whose AGENTS.md was built before the rule existed has it after
//       `obk rules build`: a Claude Code bot, a Codex bot and Bot Father.
//   R3  Bot Father's default charter, as a fresh `init` writes it, says a
//       temporary session is its maker's to retire, and still asks first
//       before retiring a bot or a long-lived session, but not before a maker
//       retires its own temporary one.
//   R4  `obk temp make`, for a tab it brings up whose screen waits on an
//       answer or whose screen the kit cannot see, gives the command that reads
//       that tab's screen and names section 5 of the kit's own SETUP.md by its
//       full path, since that is where the rule sends a session to answer it.
//       This is behaviour #250 already shipped (the report `up` gives); it is
//       pinned here because the rule now leans on it, and it passes today.
//
// The rule's words are the implementer's to write and the reviewer's to read.
// What is matched is its meaning, loosely: the two commands, and a sentence
// with "before", "another" (or new, next, more) and "retire" in it. So is the
// charter's. No sentence is pinned.
//
// "Built before the rule existed" is made with an older copy of the kit, not
// by cutting the rule out of a built file: the build stamps its block with a
// checksum and refuses a block somebody edited (ADR 0013), so a file with the
// rule cut out would test that refusal and not the rebuild, and restamping it
// would pin a checksum helpers/rules.js keeps opaque on purpose. The older
// copy is this package with every rule unit that names the two commands left
// out, which is what the kit was before this slice: it builds a fleet, and
// this checkout's CLI rebuilds it.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca and
// fake programs on its own PATH, and the older copy of the kit inside the
// sandbox's own temp tree. Nothing here reaches the real Orca, a real harness,
// or anything outside the sandbox.

import assert from 'node:assert/strict';
import { cp, mkdir, readdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import { createSandbox, node, repoRoot, sessionIn, tabsOfBot } from './helpers/cli.js';
import { agentsIn, blockIn, headingsIn, sectionsIn } from './helpers/rules.js';
import { botYamlOf } from './helpers/skills.js';

// ------------------------------------------------------------ reading the rule

/** Text with every run of white space made one space, so a wrapped line reads as one. */
const flat = (text) => text.replace(/\s+/g, ' ').trim();

/** The sentences of a text, wrapped lines joined. */
const sentencesOf = (text) => flat(text).split(/(?<=[.!?])\s+/);

/** The two commands the rule names; the build writes the kit's own path in front of them. */
const TEMP_MAKE = /\btemp make\b/;
const TEMP_RETIRE = /\btemp retire\b/;

/** Whether a text names either command: how the older kit's copy tells the rule's unit. */
const namesTempCommands = (text) => TEMP_MAKE.test(flat(text)) || TEMP_RETIRE.test(flat(text));

/**
 * "Before it makes another, it first retires any of its own whose work is
 * done", loosely: one sentence with "before", a word for one more, and retiring.
 */
const retiresBeforeAnother = (sentence) => /\bbefore\b/i.test(sentence)
  && /\b(?:another|new|next|more|further|again)\b/i.test(sentence)
  && /\bretir/i.test(sentence);

/**
 * The sections of a built block that name `temp make`, the charter left out:
 * Bot Father's charter may well talk about temporary sessions, and it is not
 * the rule.
 */
const tempRulesIn = (body) => sectionsIn(body)
  .filter((section) => section.heading !== 'Charter' && TEMP_MAKE.test(flat(section.body)));

/**
 * Hold one bot's AGENTS.md to carrying the rule: inside the kit's block, one
 * section that names `temp make` and `temp retire` and says to retire one's own
 * finished temporary sessions before making another.
 */
async function assertCarriesTheRule(bots, bot, what) {
  const body = blockIn(await agentsIn(bots, bot)).body;
  const naming = tempRulesIn(body);
  assert.ok(
    naming.length > 0,
    `${what}: ${bot}'s AGENTS.md should carry a rule that names temp make, got headings: ${JSON.stringify(headingsIn(body))}`,
  );
  const rule = naming.find((section) => TEMP_RETIRE.test(flat(section.body)));
  assert.ok(
    rule !== undefined,
    `${what}: the rule that names temp make should name temp retire too, got:\n${naming.map((one) => `## ${one.heading}\n${one.body}`).join('\n\n')}`,
  );
  assert.ok(
    sentencesOf(rule.body).some(retiresBeforeAnother),
    `${what}: the rule should say to retire one's own finished temporary sessions before making another, got:\n## ${rule.heading}\n${rule.body}`,
  );
}

/** The `rules:` list a `defaults.yaml` or a `bot.yaml` names, as written. */
const rulesListed = async (file) => (parse(await readFile(file, 'utf8')) ?? {}).rules ?? [];

/**
 * Nothing in the bots folder asks for the rule: no list names a unit that
 * carries it. A unit listed in `defaults.yaml` or a `bot.yaml` would reach a
 * new bot too, and would not reach a folder made before it was listed.
 */
async function assertNobodyAskedFor(bots, bot) {
  for (const file of [path.join(bots, 'defaults.yaml'), botYamlOf(bots, bot)]) {
    for (const name of await rulesListed(file)) {
      const ref = String(name);
      const unit = ref.startsWith('kit:')
        ? path.join(repoRoot, 'rules', `${ref.slice('kit:'.length)}.md`)
        : path.join(bots, 'rules', `${ref}.md`);
      const text = await readFile(unit, 'utf8').catch(() => '');
      assert.ok(
        !namesTempCommands(text),
        `${file} lists ${ref}, which carries the temporary-session rule; the rule should come without anyone listing it`,
      );
    }
  }
}

// ------------------------------------------------------------ running the kit

/** `obk <args>` in `box`, which must work for the test to say anything. */
async function ok(box, args, options) {
  const result = await box.run(args, options);
  assert.equal(result.code, 0, `obk ${args.join(' ')} should have worked:\n${result.stdout}${result.stderr}`);
  return result;
}

/**
 * The kit as it stood before this slice, inside the sandbox: this package as it
 * ships (src/, rules/, skills/, SETUP.md, README.md, package.json), with every
 * rule unit that names `temp make` or `temp retire` left out. src/ and rules/
 * are copies, because the kit reads its units from beside its own source, by
 * the path it runs from; the rest are links. Returns its CLI's path.
 */
async function olderKit(box) {
  const kit = path.join(box.root, 'older-kit');
  await mkdir(path.join(kit, 'rules'), { recursive: true });
  await cp(path.join(repoRoot, 'src'), path.join(kit, 'src'), { recursive: true });
  for (const name of await readdir(path.join(repoRoot, 'rules'))) {
    const text = await readFile(path.join(repoRoot, 'rules', name), 'utf8');
    if (!namesTempCommands(text)) await writeFile(path.join(kit, 'rules', name), text);
  }
  for (const name of ['skills', 'SETUP.md', 'README.md', 'package.json', 'node_modules']) {
    await symlink(path.join(repoRoot, name), path.join(kit, name));
  }
  return path.join(kit, 'src', 'cli.js');
}

/** `<cli> <args>` for the older kit, in `box`, which must work. */
async function okBy(box, cli, args) {
  const result = await node([cli, ...args], { cwd: box.cwd, env: box.env });
  assert.equal(result.code, 0, `the older kit's ${args.join(' ')} should have worked:\n${result.stdout}${result.stderr}`);
  return result;
}

// ------------------------------------------------------------------ R1

for (const harness of ['claude', 'codex']) {
  // Covers R1: a new bot carries the rule, on either harness, unasked.
  test(`R1 a new ${harness} bot's AGENTS.md carries the temporary-session rule without anyone asking (#251)`, async (t) => {
    const box = await createSandbox(t);
    const bots = box.path('bots');
    await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);

    await ok(box, ['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', harness]);

    await assertNobodyAskedFor(bots, 'api-bot');
    await assertCarriesTheRule(bots, 'api-bot', `a new ${harness} bot`);
  });
}

// Covers R1 for Bot Father: it makes temporary sessions of its own like any
// bot, so it carries the rule from init.
test('R1 Bot Father carries the temporary-session rule from init, without anyone asking (#251)', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');

  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);

  await assertNobodyAskedFor(bots, 'bot-father');
  await assertCarriesTheRule(bots, 'bot-father', 'Bot Father after init');
});

// ------------------------------------------------------------------ R2

// Covers R2: a fleet an older kit built, a Claude Code bot, a Codex bot and
// Bot Father, gets the rule from `obk rules build`, with nothing in the folder
// changed by hand.
test('R2 bots whose AGENTS.md an older kit built carry the rule after obk rules build: Claude Code, Codex and Bot Father (#251)', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  const older = await olderKit(box);
  await okBy(box, older, ['init', '--bots', 'bots', '--harness', 'claude']);
  await okBy(box, older, ['bot', 'create', '--bots', 'bots', '--name', 'claude-bot', '--harness', 'claude']);
  await okBy(box, older, ['bot', 'create', '--bots', 'bots', '--name', 'codex-bot', '--harness', 'codex']);
  const fleet = ['bot-father', 'claude-bot', 'codex-bot'];
  for (const bot of fleet) {
    const body = blockIn(await agentsIn(bots, bot)).body;
    assert.deepEqual(
      tempRulesIn(body).map((section) => section.heading),
      [],
      `the older kit should have built ${bot}'s AGENTS.md without the rule, or this proves nothing:\n${body}`,
    );
  }

  await ok(box, ['rules', 'build', '--bots', 'bots']);

  for (const bot of fleet) {
    await assertCarriesTheRule(bots, bot, `${bot} rebuilt by obk rules build`);
  }
});

// ------------------------------------------------------------------ R3

/** Bot Father's charter as a fresh `init` writes it into its bot.yaml. */
async function defaultCharter(t) {
  const box = await createSandbox(t);
  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  const charter = (parse(await readFile(botYamlOf(box.path('bots'), 'bot-father'), 'utf8')) ?? {}).charter;
  assert.equal(typeof charter, 'string', `init should write Bot Father a charter, got: ${JSON.stringify(charter)}`);
  return charter;
}

/** A sentence that says what Bot Father asks first about: "Ask first before: …", loosely. */
const ASK_FIRST = /\bask\w*\s+(?:\w+\s+){0,3}before\b/i;

/**
 * An ask-first sentence that, where it comes to retiring sessions, leaves a
 * temporary one out: it names the session long-lived, or it excepts temporary
 * sessions, or it says of them that they need no asking.
 */
const LEAVES_TEMPORARY_OUT = [
  /\blong[- ]?(?:lived|running)\b/i,
  /\b(?:except|excepting|but not|not|other than|apart from|besides|excluding)\s+(?:(?:for|a|an|the|any|its|their|one|ones|of)\s+)*temporar/i,
  /temporar[^.]*?(?:\bwithout\s+(?:\w+\s+){0,2}?(?:ask|asking|a yes|approval|permission)\b|\bno\s+(?:need\s+to\s+)?(?:ask|asking|yes|approval|permission)\b|\bneeds?\s+no\s+(?:\w+\s+){0,2}?(?:ask|asking|yes|approval|permission)\b)/i,
];

// Covers R3, the half that is new: the charter tells Bot Father a temporary
// session is its maker's to retire. The charter init wrote before #251 says
// nothing of temporary sessions, and fails here.
test('R3 Bot Father\'s default charter says a temporary session is its maker\'s to retire (#251)', async (t) => {
  const charter = await defaultCharter(t);

  const said = sentencesOf(charter).filter((sentence) => /\btemporar/i.test(sentence)
    && /\bretir/i.test(sentence)
    && /\bmaker\b|\bmade\b|\bits own\b/i.test(sentence));
  assert.ok(
    said.length > 0,
    `the charter should say a temporary session is its maker's to retire, got:\n${charter}`,
  );
});

// Covers R3, the half that stays and the half that goes: Bot Father still asks
// first before retiring a bot or a long-lived session, and its ask-first no
// longer covers a temporary session its maker retires. The charter init wrote
// before #251 asks first before "retiring a bot or a session", any session,
// and fails here.
test('R3 Bot Father\'s default charter still asks first before retiring a bot or a long-lived session, and not before a maker retires its temporary one (#251)', async (t) => {
  const charter = await defaultCharter(t);

  const askFirst = sentencesOf(charter).filter((sentence) => ASK_FIRST.test(sentence));
  assert.ok(askFirst.length > 0, `the charter should still say what Bot Father asks first about, got:\n${charter}`);
  assert.ok(
    askFirst.some((sentence) => /\bretir/i.test(sentence) && /\bbots?\b/i.test(sentence) && /\bsessions?\b/i.test(sentence)),
    `the charter should still ask first before retiring a bot or a long-lived session, got:\n${askFirst.join('\n')}`,
  );
  for (const sentence of askFirst.filter((one) => /\bretir/i.test(one) && /\bsessions?\b/i.test(one))) {
    assert.ok(
      LEAVES_TEMPORARY_OUT.some((pattern) => pattern.test(sentence)),
      `the charter should not ask first before a maker retires its own temporary session: its ask-first should name the session long-lived or leave temporary ones out, got:\n${sentence}`,
    );
  }
});

// ------------------------------------------------------------------ R4

/** The SETUP.md shipped with the kit under test: its package root is the repo root here. */
const SETUP = path.join(repoRoot, 'SETUP.md');

/** "Section 5" of SETUP.md, loosely, as first-run-screens.test.js reads it. */
const SECTION_5 = /(?:section|§|step|part|#)\s*5\b|\b5\.\s+Answer what the tabs ask/i;

/** The task a made session is given. */
const TASK = 'Read the open pull request and write down what it changes.';

/** The environment of a command run inside `terminal`, as Orca sets it in every pane. */
const inTab = (box, terminal) => ({ ...box.env, ORCA_TERMINAL_HANDLE: terminal.handle, ORCA_TAB_ID: terminal.tabId });

/** The tab the book gives a session, and Orca's own record of it. */
async function liveTab(box, bots, bot, name) {
  const entry = await sessionIn(bots, bot, name);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${bot}/${name}, got: ${JSON.stringify(entry)}`);
  const terminal = (await tabsOfBot(box, bots, bot)).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `Orca should have ${bot}/${name}'s tab ${entry.tab}`);
  return terminal;
}

/**
 * Bot Father and api-bot (Claude Code) with a long-lived session called lead,
 * up; then Orca put in `state`, and `temp make` run from lead's tab. What it
 * printed, and the tab it made.
 */
async function madeInto(t, state, extra = []) {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  await ok(box, ['init', '--bots', 'bots', '--harness', 'claude']);
  await ok(box, ['bot', 'create', '--bots', 'bots', '--name', 'api-bot', '--harness', 'claude']);
  await ok(box, ['session', 'add', '--bots', 'bots', '--bot', 'api-bot', '--name', 'lead']);
  await ok(box, ['up', '--bots', 'bots', '--bot', 'api-bot']);
  const lead = await liveTab(box, bots, 'api-bot', 'lead');
  await box.orca.set(state);

  const result = await ok(
    box,
    ['temp', 'make', '--bots', 'bots', '--name', 'scout', '--prompt', TASK, ...extra],
    { env: inTab(box, lead) },
  );

  return { box, stdout: result.stdout, scout: await liveTab(box, bots, 'api-bot', 'scout') };
}

/**
 * Hold what `temp make` printed to giving the command that reads the made
 * tab's screen, and naming section 5 of the kit's own SETUP.md by its full
 * path (and the file being there).
 */
async function assertSendsToSetup({ box, stdout, scout }, what) {
  assert.ok(
    stdout.includes(`${box.orca.cli} terminal read --terminal ${scout.handle} --screen`),
    `${what}: temp make should give the command that reads the new tab's screen, got:\n${stdout}`,
  );
  const setups = [SETUP, await realpath(SETUP)];
  assert.ok(
    setups.some((file) => stdout.includes(file)),
    `${what}: temp make should name the kit's SETUP.md by its full path (${SETUP}), got:\n${stdout}`,
  );
  const words = setups.reduce((text, file) => text.split(file).join('<SETUP.md>'), stdout);
  assert.match(words, SECTION_5, `${what}: temp make should point at section 5 of SETUP.md, got:\n${stdout}`);
}

// Covers R4, a screen waiting on an answer: Codex's folder-trust question, as
// Orca named it live (#342).
test('R4 temp make, for a tab it brings up waiting on a screen, gives the command to read it and names section 5 of the kit\'s SETUP.md (#251)', async (t) => {
  const made = await madeInto(t, { waitIdle: 'blocked', blockedReason: 'agent-trust-workspace' });

  await assertSendsToSetup(made, 'a tab waiting on agent-trust-workspace');
});

// Covers R4, a screen the kit cannot see: Orca calls the harness idle and names
// no reason, which a waiting screen can look exactly like (#288). On both
// harnesses, since a made session may run either.
for (const harness of ['claude', 'codex']) {
  test(`R4 temp make, for a ${harness} tab whose screen the kit cannot see, gives the command to read it and names section 5 of the kit's SETUP.md (#251)`, async (t) => {
    const made = await madeInto(t, { waitIdle: true }, ['--harness', harness]);

    await assertSendsToSetup(made, `a ${harness} tab with no reason from Orca`);
  });
}
