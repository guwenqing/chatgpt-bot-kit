// Roles for temporary sessions (#465): the bot's config picks each one's
// model, effort and context, so a `temp make` call does not have to carry them
// and a slip cannot silently give the wrong model.
//
//   temp_roles:                      # in the bot's bot.yaml
//     <role>: [<option>, …]          # the first option is the default
//     <role>: { options: [<option>, …], cap: <n>, prompt_file: <path> }
//   <option>: { name, for, harness, model, effort, context }
//
//   obk temp make --role <role>[:<option>] --name <name> …
//
// What is held here, the settings a session made from a role gets:
//
//   R1  `--role <role>:<option>` takes that option's settings; a bare
//       `--role <role>` takes the role's first option.
//   R3  A flag given wins over the option.
//   R4  The option's model, effort and context apply only to a session on the
//       option's harness, which is the maker's when the option names none.
//   R5  A gap is filled as temp make fills it today: from the maker on the
//       maker's harness, else left to the harness's own default. Approval
//       comes from the flag or the maker.
//
// The name, the prompt file, the book and the output are in
// temp-roles-output.test.js; the cap, the refusals and `obk temp roles` in
// temp-roles-cap.test.js; health in temp-roles-health.test.js. The fleet is
// in helpers/temp-roles.js, built so that a wrong reading gets a different
// session: the makers' own settings differ from every option's, and the two
// options of a role differ from each other.
//
// Every run is in the sandbox (helpers/cli.js): its own HOME, a fake Orca, and
// fake harnesses on its own PATH. Nothing here reaches the real Orca, a real
// harness, or anything outside the sandbox.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSandbox, fakeProgram, typedInto } from './helpers/cli.js';
import { argvOf, fleet, liveTab, made, settingsOf, TASK } from './helpers/temp-roles.js';

// ------------------------------------------------------- R1 the option taken

test('R1 --role developer:deep takes that option\'s model, effort and context, on its maker\'s harness', async (t) => {
  // developer's options name no harness, so deep's settings go to the maker's:
  // planner's Claude Code, not the bot's Codex.
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  await made(box, planner, ['--role', 'developer:deep', '--name', 'developer-1', '--prompt', TASK]);

  assert.deepEqual(
    await settingsOf(bots, 'developer-1'),
    { harness: 'claude', model: 'claude-fable-5-1', effort: 'max', context: '1m', approval: 'ask' },
    'deep\'s model, effort and context, not standard\'s and not planner\'s opus and xhigh; planner\'s harness and approval',
  );
  const [line] = typedInto(await liveTab(box, bots, 'developer-1'));
  const fake = await fakeProgram(box, 'claude', {});
  const argv = await argvOf(box, line, fake);
  assert.deepEqual(
    argv.slice(4, -1),
    ['--model', 'claude-fable-5-1[1m]', '--effort', 'max', '--'],
    `the option's settings reach Claude Code, got: ${JSON.stringify(argv)}`,
  );
});

test('R1 a bare --role developer takes the role\'s first option', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  await made(box, planner, ['--role', 'developer', '--name', 'developer-1', '--prompt', TASK]);

  // standard gives no context, and planner, on the same harness, fills it.
  assert.deepEqual(
    await settingsOf(bots, 'developer-1'),
    { harness: 'claude', model: 'claude-opus-5-5', effort: 'high', context: '1m', approval: 'ask' },
    'standard\'s model and effort, not deep\'s claude-fable-5-1 and max',
  );
});

test('R1 a Codex option made from a Claude maker: the option\'s harness, model, effort and context, reaching Codex', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  await made(box, planner, ['--role', 'reviewer:deep', '--name', 'reviewer-1', '--prompt', TASK]);

  assert.deepEqual(
    await settingsOf(bots, 'reviewer-1'),
    { harness: 'codex', model: 'gpt-6.1-sol', effort: 'xhigh', context: '400000', approval: 'ask' },
    'deep\'s Codex settings, with planner\'s approval',
  );
  const [line] = typedInto(await liveTab(box, bots, 'reviewer-1'));
  const fake = await fakeProgram(box, 'codex', {});
  const argv = await argvOf(box, line, fake);
  const words = argv.join('\n');
  for (const part of ['-a\non-request', '-m\ngpt-6.1-sol', '-c\nmodel_reasoning_effort=xhigh', '-c\nmodel_context_window=400000']) {
    assert.ok(words.includes(part), `Codex is given ${part.replace('\n', ' ')}, got: ${JSON.stringify(argv)}`);
  }
  assert.ok(!argv.slice(0, -1).some((word) => /opus|\b1m\b/.test(word)), `nothing of planner's Claude settings, got: ${JSON.stringify(argv)}`);
});

// ------------------------------------------------------- R3 a flag wins

test('R3 a flag given wins over the option, and only for that setting', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  await made(box, planner, ['--role', 'reviewer', '--name', 'reviewer-1', '--prompt', TASK, '--model', 'gpt-6.1-max', '--context', '300000']);

  assert.deepEqual(
    await settingsOf(bots, 'reviewer-1'),
    { harness: 'codex', model: 'gpt-6.1-max', effort: 'xhigh', context: '300000', approval: 'ask' },
    'the flags\' model and context, deep\'s harness and effort, planner\'s approval',
  );
});

test('R3 --approval wins over the maker\'s, with a role', async (t) => {
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  await made(box, planner, ['--role', 'reviewer:light', '--name', 'reviewer-1', '--prompt', TASK, '--approval', 'auto']);

  assert.deepEqual(
    await settingsOf(bots, 'reviewer-1'),
    { harness: 'codex', model: 'gpt-6.1-mini', effort: 'medium', context: undefined, approval: 'auto' },
  );
});

// ------------------------------------------------------- R4 the option's harness

test('R4 --harness away from the option\'s harness: the option\'s model, effort and context do not apply, the maker\'s do', async (t) => {
  // reviewer:deep is Codex; --harness claude puts the session on planner's own
  // harness, so it is filled from planner as a make without a role would be.
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  await made(box, planner, ['--role', 'reviewer', '--name', 'reviewer-1', '--prompt', TASK, '--harness', 'claude']);

  assert.deepEqual(
    await settingsOf(bots, 'reviewer-1'),
    { harness: 'claude', model: 'opus', effort: 'xhigh', context: '1m', approval: 'ask' },
    'planner\'s settings, none of deep\'s gpt-6.1-sol, xhigh on Codex or 400000',
  );
});

test('R4 an option that names no harness is the maker\'s: --harness codex from a Claude maker leaves model, effort and context to Codex', async (t) => {
  // developer's options are planner's Claude Code's, since they name no
  // harness and planner is the maker; on Codex neither they nor planner's
  // Claude settings apply.
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  await made(box, planner, ['--role', 'developer:deep', '--name', 'developer-1', '--prompt', TASK, '--harness', 'codex']);

  assert.deepEqual(
    await settingsOf(bots, 'developer-1'),
    { harness: 'codex', model: undefined, effort: undefined, context: undefined, approval: 'ask' },
    'only planner\'s approval: nothing of deep\'s and nothing of planner\'s Claude settings',
  );
});

test('R4 an option that names no harness, made by a Codex maker, applies on Codex; the gap is the maker\'s', async (t) => {
  // nightly runs on its bot's Codex, so developer:standard is Codex here.
  const box = await createSandbox(t);
  const { bots, nightly } = await fleet(box);

  await made(box, nightly, ['--role', 'developer', '--name', 'developer-1', '--prompt', TASK]);

  assert.deepEqual(
    await settingsOf(bots, 'developer-1'),
    { harness: 'codex', model: 'claude-opus-5-5', effort: 'high', context: '200000', approval: 'auto' },
    'standard\'s model and effort on nightly\'s Codex, nightly\'s context and approval; not gpt-6-sol or low',
  );
});

// ------------------------------------------------------- R5 the gaps

test('R5 a gap on the maker\'s harness is filled from the maker', async (t) => {
  // reviewer:light gives no context; nightly is on Codex with 200000.
  const box = await createSandbox(t);
  const { bots, nightly } = await fleet(box);

  await made(box, nightly, ['--role', 'reviewer:light', '--name', 'reviewer-1', '--prompt', TASK]);

  assert.deepEqual(
    await settingsOf(bots, 'reviewer-1'),
    { harness: 'codex', model: 'gpt-6.1-mini', effort: 'medium', context: '200000', approval: 'auto' },
  );
});

test('R5 a gap on another harness than the maker\'s is left to the harness\'s own default, and not written', async (t) => {
  // reviewer:light gives no context; planner's 1m is Claude's.
  const box = await createSandbox(t);
  const { bots, planner } = await fleet(box);

  await made(box, planner, ['--role', 'reviewer:light', '--name', 'reviewer-1', '--prompt', TASK]);

  assert.deepEqual(
    await settingsOf(bots, 'reviewer-1'),
    { harness: 'codex', model: 'gpt-6.1-mini', effort: 'medium', context: undefined, approval: 'ask' },
    'light\'s settings, no context written, planner\'s approval',
  );
});
