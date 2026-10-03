// The check a system test runs before it answers Claude Code's "Teach auto
// mode about your environment?" form with Esc in a throwaway tab of its own
// (helpers/screens.js `onlyTeachFormOf`; the architect's ruling on #391 after
// live run 3). Read on the form as captured (helpers/screens.js
// CLAUDE_TEACH_FORM, Claude Code 2.1.283) and on that form changed one way at
// a time.

import assert from 'node:assert/strict';
import test from 'node:test';

import { CLAUDE_TEACH_FORM, CLAUDE_TEACH_FORM_ON_CONTINUE, CLAUDE_TRUST, onlyTeachFormOf } from './helpers/screens.js';

/** The captured form with each row `change` gives back. */
const changed = (change) => CLAUDE_TEACH_FORM.map(change);

/** The form's own rows, from its title down, as captured. */
const formRows = CLAUDE_TEACH_FORM.slice(CLAUDE_TEACH_FORM.findIndex((row) => row.includes('Teach auto mode')));

test('the captured form may be answered, whatever is above it', () => {
  assert.equal(onlyTeachFormOf(CLAUDE_TEACH_FORM), undefined);
  assert.equal(onlyTeachFormOf(formRows), undefined, 'the form alone');
  assert.equal(onlyTeachFormOf(['❯ some other turn', '⏺ an answer', '', ...formRows, '']), undefined, 'other history above it, blank rows around it');
});

test('the pointer may sit on another row of the form', () => {
  assert.equal(onlyTeachFormOf(CLAUDE_TEACH_FORM_ON_CONTINUE), undefined, 'on Continue');
  const onRepos = changed((row) => {
    if (row.includes('❯ Also scan shell history')) return row.replace('❯', ' ');
    if (row.includes('Also scan your other repos')) return row.replace('  Also', '❯ Also');
    return row;
  });
  assert.equal(onlyTeachFormOf(onRepos), undefined, 'on "Also scan your other repos"');
});

test('a form with a value changed is not the captured one, and the row is named', () => {
  const shown = changed((row) => (row.includes('Also scan your other repos') ? row.replace('false', 'true') : row));
  const said = onlyTeachFormOf(shown);
  assert.match(said ?? '', /Also scan your other repos\s+true/, `it names the row, got: ${said}`);
});

test('a form with a row more or a row less is not the captured one', () => {
  const more = [...CLAUDE_TEACH_FORM.slice(0, -1), '     Also scan your home folder  false', CLAUDE_TEACH_FORM.at(-1)];
  assert.match(onlyTeachFormOf(more) ?? '', /Also scan your home folder/, 'a row more is named');
  const less = CLAUDE_TEACH_FORM.filter((row) => !row.includes('Also scan your other repos'));
  assert.notEqual(onlyTeachFormOf(less), undefined, 'a row less is refused');
  const twice = [...CLAUDE_TEACH_FORM.slice(0, -1), '     Continue', CLAUDE_TEACH_FORM.at(-1)];
  assert.notEqual(onlyTeachFormOf(twice), undefined, 'a row of the form shown twice is refused');
});

test('a form with no pointer, or two, is not the captured one', () => {
  const none = changed((row) => row.replace('❯', ' '));
  assert.notEqual(onlyTeachFormOf(none), undefined, 'no pointer');
  const two = changed((row) => (row.includes('     Continue') ? '   ❯ Continue' : row));
  assert.notEqual(onlyTeachFormOf(two), undefined, 'two pointers');
});

test('a screen without the form\'s title is not the form', () => {
  assert.notEqual(onlyTeachFormOf(CLAUDE_TRUST), undefined, 'the folder trust');
  assert.notEqual(onlyTeachFormOf(formRows.slice(1)), undefined, 'the form\'s rows under another title, or none');
});
