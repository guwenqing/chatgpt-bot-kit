// The helper that reads a kit command out of a line the kit typed
// (helpers/typed-command.js), checked against the shell it stands in for.

import assert from 'node:assert/strict';
import test from 'node:test';

import { sh } from './helpers/cli.js';
import { commandsIn, flagValue, withWord } from './helpers/typed-command.js';

const CLI = '/opt/kit/src/cli.js';
const SPELLINGS = [CLI, `'${CLI}'`];

const valuesOf = (command) => command.words.map((word) => word.value);

/** What a real shell hands a program for `line`: each argument, NUL-separated. */
async function argvBySh(line) {
  const ran = await sh(`printf '%s\\0' ${line}`, {});
  assert.equal(ran.code, 0, `sh should read ${line}: ${ran.stderr}`);
  return ran.stdout.split('\0').slice(0, -1);
}

test('a command in prose ends at a comma or a full stop followed by a space, and a path with dots runs on', () => {
  const text = `First run ${CLI} temp make --bots /b/x.y --name n --prompt-file /b/task.md, then end your turn.`;
  const [found] = commandsIn(text, SPELLINGS, 'temp make');
  assert.deepEqual(valuesOf(found), [CLI, 'temp', 'make', '--bots', '/b/x.y', '--name', 'n', '--prompt-file', '/b/task.md']);

  const [stopped] = commandsIn(`Run ${CLI} temp retire --name old. Then make one.`, SPELLINGS, 'temp retire');
  assert.deepEqual(valuesOf(stopped), [CLI, 'temp', 'retire', '--name', 'old']);

  const [last] = commandsIn(`Run ${CLI} temp retire --name old`, SPELLINGS, 'temp retire');
  assert.deepEqual(valuesOf(last), [CLI, 'temp', 'retire', '--name', 'old'], 'and at the end of the text');
});

test('a command ends at a backtick, a semicolon, a colon or a bracket followed by a space, and at a newline', () => {
  for (const [text, end] of [
    [`\`${CLI} temp make --name a\` and more`, 'a'],
    [`${CLI} temp make --name a; then`, 'a'],
    [`${CLI} temp make --name a: then`, 'a'],
    [`(${CLI} temp make --name a) then`, 'a'],
    [`${CLI} temp make --name a\n--name b`, 'a'],
  ]) {
    const [found] = commandsIn(text, SPELLINGS, 'temp make');
    assert.deepEqual(valuesOf(found), [CLI, 'temp', 'make', '--name', end], `in ${JSON.stringify(text)}`);
  }
});

test('punctuation inside a word or inside quotes does not end the command', () => {
  const text = `${CLI} temp make --a x,y --b 'one, two. three;' --c "it's: (so)" --d a.b; done`;
  const [found] = commandsIn(text, SPELLINGS, 'temp make');
  assert.deepEqual(valuesOf(found), [CLI, 'temp', 'make', '--a', 'x,y', '--b', 'one, two. three;', '--c', 'it\'s: (so)', '--d', 'a.b']);
});

test('quotes and backslashes are read as the shell reads them, and each word\'s raw text is kept', async () => {
  const text = `${CLI} temp make --extra-arg=-c '--extra-arg=projects={"/tmp/a b"={trust_level="trusted"}}' `
    + `"--extra-arg=\\$HOME \\"q\\"" --extra-arg=it\\'s --model 'o'\\''k', done`;
  const [found] = commandsIn(text, SPELLINGS, 'temp make');
  const expected = [
    CLI, 'temp', 'make', '--extra-arg=-c', '--extra-arg=projects={"/tmp/a b"={trust_level="trusted"}}',
    '--extra-arg=$HOME "q"', '--extra-arg=it\'s', '--model', 'o\'k',
  ];
  assert.deepEqual(valuesOf(found), expected);
  assert.deepEqual(await argvBySh(found.words.map((word) => word.raw).join(' ')), expected, 'a real shell reads the raw words the same');
});

test('the CLI is found in either spelling, every command is found in order, and none is an empty list', () => {
  const text = `${CLI} temp retire --name a. Then '${CLI}' temp make --name b. Then ${CLI} temp retire --name c.`;
  assert.deepEqual(commandsIn(text, SPELLINGS, 'temp retire').map((one) => flagValue(one.words, '--name')), ['a', 'c']);
  assert.deepEqual(commandsIn(text, SPELLINGS, 'temp make').map((one) => flagValue(one.words, '--name')), ['b']);
  const [make] = commandsIn(text, SPELLINGS, 'temp make');
  const [, later] = commandsIn(text, SPELLINGS, 'temp retire');
  assert.ok(make.at < later.at && make.at > text.indexOf('--name a'), 'each at where it stands');
  const both = `'${CLI}' temp make --name first, and ${CLI} temp make --name second.`;
  assert.deepEqual(commandsIn(both, SPELLINGS, 'temp make').map((one) => flagValue(one.words, '--name')), ['first', 'second'], 'in order whichever spelling each has');
  assert.deepEqual(commandsIn('nothing of the kind here', SPELLINGS, 'temp make'), []);
  assert.deepEqual(commandsIn(`/elsewhere/cli.js temp make --name z`, SPELLINGS, 'temp make'), [], 'another CLI is not this one');
});

test('flagValue reads a flag given apart or glued, and is undefined when the flag is not given', () => {
  const [found] = commandsIn(`${CLI} temp make --model m1 --effort=low --name`, SPELLINGS, 'temp make');
  assert.equal(flagValue(found.words, '--model'), 'm1');
  assert.equal(flagValue(found.words, '--effort'), 'low');
  assert.equal(flagValue(found.words, '--harness'), undefined);
  assert.equal(flagValue(found.words, '--name'), undefined, 'a flag with nothing after it has no value');
});

test('withWord puts a real value in place of a placeholder, apart or glued, and leaves every other word as written', async () => {
  const text = `${CLI} temp make --name groom-<YYYYMMDD-HHMM> --extra-arg='a b' --prompt-file /b/t.md, then stop.`;
  const [found] = commandsIn(text, SPELLINGS, 'temp make');
  assert.deepEqual(
    await argvBySh(withWord(found.words, '--name', 'groom-20260929-0400')),
    [CLI, 'temp', 'make', '--name', 'groom-20260929-0400', '--extra-arg=a b', '--prompt-file', '/b/t.md'],
  );
  const [glued] = commandsIn(`${CLI} temp retire --name=<each>`, SPELLINGS, 'temp retire');
  assert.deepEqual(await argvBySh(withWord(glued.words, '--name', 'it\'s')), [CLI, 'temp', 'retire', '--name=it\'s']);
});

test('an unclosed quote in the command is an error, not a guess', () => {
  assert.throws(() => commandsIn(`${CLI} temp make --model 'open`, SPELLINGS, 'temp make'), /unclosed '/);
  assert.throws(() => commandsIn(`${CLI} temp make --model "open`, SPELLINGS, 'temp make'), /unclosed "/);
});
