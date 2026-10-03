// Roles for temporary sessions (#465): the cap, the refusals, and
// `obk temp roles`.
//
//   R9   A role with `cap: N` counts the bot's open temporary sessions the book
//        records with that role, across its options and whoever made them. A
//        retired one no longer counts; one made without --role does not count,
//        whatever its name. With N open, the next make with that role is
//        refused, names each open one, and writes nothing. Below the cap it
//        works. A role with no cap has no limit.
//   R10  Refused, naming the problem, with nothing written: --role on a bot
//        with no temp_roles; an unknown role (naming the bot's roles); an
//        unknown option (naming the role's options); a malformed role.
//   L    `obk temp roles --bots <path> [--json]`, run in a session's own tab,
//        lists the caller's bot's roles: each with its cap, its open sessions,
//        its prompt file and its options, the first the default; `roles: []`
//        for a bot with none.
//
// The reviewer role has cap 2; the developer role has none. Every maker here
// is long-lived, so a temporary maker's own one-at-a-time limit (#464) is not
// what refuses. The fleet is in helpers/temp-roles.js.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca, and
// fake harnesses on its own PATH. Nothing here reaches the real Orca, a real
// harness, or anything outside the sandbox.

import assert from 'node:assert/strict';
import test from 'node:test';

import { assertRefused, createSandbox, orcaCallsOf, sessionIn } from './helpers/cli.js';
import {
  answerIn,
  BOT,
  entryIn,
  fleet,
  made,
  make,
  retireTemp,
  roles,
  rolesCopy,
  setRoles,
  TASK,
  world,
} from './helpers/temp-roles.js';

/**
 * A make that is refused writes nothing and opens nothing. Returns what it
 * said. Each case is followed by a make that works, so that a kit refusing
 * every make does not pass.
 */
async function assertMakeRefused(box, bots, terminal, args, named = []) {
  const before = await world(box, bots);
  const from = (await box.orca.calls()).length;

  const result = await make(box, terminal, args);

  assertRefused(result, ...named);
  assert.deepEqual(await world(box, bots), before, 'bot.yaml, the book and Orca are as they were');
  assert.deepEqual(orcaCallsOf((await box.orca.calls()).slice(from), 'terminal create'), [], 'no tab was opened');
  return `${result.stdout}${result.stderr}`;
}

// ------------------------------------------------------- R9 the cap

test('R9 with a role\'s cap of open sessions reached, across options and makers, the next is refused naming each open one', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner, nightly } = await fleet(box);

  await made(box, planner, ['--role', 'reviewer:deep', '--name', 'reviewer-1']);
  // One below the cap, a second works, by another maker and on the other option.
  await made(box, nightly, ['--role', 'reviewer:light', '--name', 'reviewer-2']);
  assert.ok(await entryIn(bots, 'reviewer-2'), 'below the cap, a make works');

  await assertMakeRefused(box, bots, planner, ['--role', 'reviewer', '--name', 'reviewer-3'], ['reviewer-1', 'reviewer-2']);

  assert.equal(await entryIn(bots, 'reviewer-3'), undefined);
  await made(box, planner, ['--role', 'developer', '--name', 'developer-3', '--prompt', TASK]);
  assert.ok(await entryIn(bots, 'developer-3'), 'another role is not held by reviewer\'s cap');
});

test('R9 a retired session no longer counts towards the cap', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  await made(box, planner, ['--role', 'reviewer', '--name', 'reviewer-1']);
  await made(box, planner, ['--role', 'reviewer', '--name', 'reviewer-2']);
  await assertMakeRefused(box, bots, planner, ['--role', 'reviewer', '--name', 'reviewer-3'], ['reviewer-1', 'reviewer-2']);

  const retired = await retireTemp(box, planner, ['--name', 'reviewer-1']);
  assert.equal(retired.code, 0, `planner retires reviewer-1:\n${retired.stdout}${retired.stderr}`);

  await made(box, planner, ['--role', 'reviewer', '--name', 'reviewer-3']);
  assert.equal((await sessionIn(bots, BOT, 'reviewer-3'))?.temporary?.role, 'reviewer', 'with reviewer-1 retired, reviewer-3 is made');
});

test('R9 a session made without --role does not count towards the cap, even one whose name begins with the role', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);
  await made(box, planner, ['--name', 'reviewer-x', '--prompt', TASK]);
  await made(box, planner, ['--name', 'reviewer-y', '--prompt', TASK]);

  await made(box, planner, ['--role', 'reviewer', '--name', 'reviewer-1']);
  await made(box, planner, ['--role', 'reviewer', '--name', 'reviewer-2']);

  const said = await assertMakeRefused(box, bots, planner, ['--role', 'reviewer', '--name', 'reviewer-3'], ['reviewer-1', 'reviewer-2']);
  for (const other of ['reviewer-x', 'reviewer-y']) {
    assert.ok(!said.includes(other), `${other} was not made as a reviewer, and is not named as one, got:\n${said}`);
  }
});

test('R9 a role with no cap has no limit', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  for (const name of ['1', '2', '3']) await made(box, planner, ['--role', 'developer', '--name', name, '--prompt', TASK]);

  for (const name of ['developer-1', 'developer-2', 'developer-3']) {
    assert.equal((await sessionIn(bots, BOT, name))?.temporary?.role, 'developer', `${name} is open`);
  }
});

// ------------------------------------------------------- R10 refusals

test('R10 --role on a bot with no temp_roles is refused, saying so, and nothing is written', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box, { roles: false });

  const said = await assertMakeRefused(box, bots, planner, ['--role', 'developer', '--name', 'developer-1', '--prompt', TASK]);

  assert.match(said, /temp_roles|no roles?\b/i, `the refusal says the bot has no roles, got:\n${said}`);
  await made(box, planner, ['--name', 'developer-1', '--prompt', TASK]);
  assert.ok(await entryIn(bots, 'developer-1'), 'the same make without --role works');
});

test('R10 an unknown role is refused, naming the roles the bot has, and nothing is written', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  await assertMakeRefused(box, bots, planner, ['--role', 'tester', '--name', 'tester-1', '--prompt', TASK], ['tester', 'developer', 'reviewer']);

  await made(box, planner, ['--role', 'developer', '--name', 'developer-1', '--prompt', TASK]);
  assert.ok(await entryIn(bots, 'developer-1'), 'a role the bot has works');
});

test('R10 an unknown option is refused, naming that role\'s options, and nothing is written', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  const said = await assertMakeRefused(box, bots, planner, ['--role', 'developer:huge', '--name', 'developer-1', '--prompt', TASK], ['huge', 'standard', 'deep']);

  assert.ok(!said.includes('light'), `reviewer's options are not developer's, got:\n${said}`);
  await made(box, planner, ['--role', 'developer:deep', '--name', 'developer-1', '--prompt', TASK]);
  assert.ok(await entryIn(bots, 'developer-1'), 'an option the role has works');
});

/** A role broken by hand, the make that uses it, and what its refusal names. */
const MALFORMED = [
  ['an option with a harness the kit does not know', (r) => { r.reviewer.options[0].harness = 'emacs'; }, 'reviewer', ['reviewer', 'emacs']],
  ['a cap of 0', (r) => { r.reviewer.cap = 0; }, 'reviewer', ['reviewer', 'cap']],
  // A typo here would leave the session on its maker's effort, the slip roles are for.
  ['an option key the kit does not know', (r) => { r.reviewer.options[1].efort = 'high'; delete r.reviewer.options[1].effort; }, 'reviewer:light', ['reviewer', 'efort']],
];

for (const [label, breakIt, role, named] of MALFORMED) {
  test(`R10 a make with a malformed role (${label}) is refused, naming the problem, and nothing is written`, async (t) => {
    const box = await createSandbox(t);
    const { bots, planner } = await fleet(box);
    const broken = rolesCopy();
    breakIt(broken);
    await setRoles(bots, broken);

    await assertMakeRefused(box, bots, planner, ['--role', role, '--name', 'reviewer-1', '--prompt', TASK], named);

    await setRoles(bots, rolesCopy());
    await made(box, planner, ['--role', role, '--name', 'reviewer-1', '--prompt', TASK]);
    assert.ok(await entryIn(bots, 'reviewer-1'), 'with the role put right, the same make works');
  });
}

// ------------------------------------------------------- L obk temp roles

/** The answer's roles by name, an option's context as text: the number the user wrote is not what is under test. */
const rolesIn = (answer) => [...answer.roles]
  .map((role) => ({
    ...role,
    options: role.options.map((option) => (option.context === undefined ? option : { ...option, context: String(option.context) })),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

test('L temp roles --json lists the caller\'s bot\'s roles, their caps, prompt files, open sessions and options; none for a bot with none', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner, nightly } = await fleet(box, { roles: false });

  const none = await roles(box, nightly, ['--json']);
  assert.equal(none.code, 0, `${none.stdout}${none.stderr}`);
  assert.deepEqual(answerIn(none).roles, [], `a bot with no roles has none to list, got: ${none.stdout}`);

  await setRoles(bots, rolesCopy());
  await made(box, planner, ['--role', 'reviewer:light', '--name', 'reviewer-1']);
  await made(box, planner, ['--name', 'reviewer-x', '--prompt', TASK]);

  // Run from nightly's tab: the bot is the caller's, whoever made the sessions.
  const result = await roles(box, nightly, ['--json']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  const answer = answerIn(result);
  assert.equal(answer.bots, bots, `the bots folder, resolved, got: ${result.stdout}`);
  assert.equal(answer.bot, BOT, `got: ${result.stdout}`);
  assert.deepEqual(rolesIn(answer), [
    {
      name: 'developer',
      open: [],
      options: [
        { name: 'standard', for: 'most issues', model: 'claude-opus-5-5', effort: 'high', default: true },
        { name: 'deep', for: 'hard causes, wide changes', model: 'claude-fable-5-1', effort: 'max', context: '1m', default: false },
      ],
    },
    {
      name: 'reviewer',
      cap: 2,
      prompt_file: 'reviewer.md',
      open: ['reviewer-1'],
      options: [
        { name: 'deep', for: 'most reviews', harness: 'codex', model: 'gpt-6.1-sol', effort: 'xhigh', context: '400000', default: true },
        { name: 'light', for: 'small diffs', harness: 'codex', model: 'gpt-6.1-mini', effort: 'medium', default: false },
      ],
    },
  ], `reviewer-x was made without a role and is not open as a reviewer, got: ${result.stdout}`);
});

test('L temp roles shows each role, and each option\'s name and purpose', async (t) => {
  const box = await createSandbox(t);
  const { planner } = await fleet(box);

  const result = await roles(box, planner);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  for (const what of ['developer', 'reviewer', 'standard', 'deep', 'light', 'most issues', 'hard causes, wide changes', 'most reviews', 'small diffs']) {
    assert.ok(result.stdout.includes(what), `the list should show ${what}, got:\n${result.stdout}`);
  }
});

test('L temp roles run outside any tab is refused; from a session\'s tab it answers', async (t) => {
  const box = await createSandbox(t);
  const { planner } = await fleet(box);

  assertRefused(await roles(box, null, ['--json']));

  const own = await roles(box, planner, ['--json']);
  assert.equal(own.code, 0, `${own.stdout}${own.stderr}`);
  assert.equal(answerIn(own).roles.length, 2, `got: ${own.stdout}`);
});
