// The check a system test runs before it lets `obk temp answer` loose on a
// staged copy of Claude Code 2.1.289's "Teach auto mode about your
// environment?" list (helpers/screens.js `onlyTeachListOf`; #489, the
// architect's ruling on the 2.1.289 list). Read on the list as captured
// (helpers/screens.js CLAUDE_TEACH_LIST) and on that list changed one way at a
// time. The rows that count run from the title to the foot row, "Enter to
// confirm · Esc to cancel"; the input box below it, with its own ❯, does not.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLAUDE_TEACH_FORM,
  CLAUDE_TEACH_LIST,
  CLAUDE_TEACH_LIST_ON_NOT_NOW,
  CLAUDE_TEACH_LIST_ON_THREE,
  onlyTeachListOf,
} from './helpers/screens.js';

/** The captured list with each row `change` gives back. */
const changed = (change) => CLAUDE_TEACH_LIST.map(change);

/** The captured list with `rows` put in right above its foot row. */
const withAboveFoot = (...rows) => {
  const foot = CLAUDE_TEACH_LIST.findIndex((row) => row.includes('Enter to confirm · Esc to cancel'));
  return [...CLAUDE_TEACH_LIST.slice(0, foot), ...rows, ...CLAUDE_TEACH_LIST.slice(foot)];
};

test('the captured list is the list, its input box\'s own ❯ below the foot not counted', () => {
  assert.equal(onlyTeachListOf(CLAUDE_TEACH_LIST), undefined);
});

test('the pointer may sit on any of its three rows', () => {
  assert.equal(onlyTeachListOf(CLAUDE_TEACH_LIST_ON_NOT_NOW), undefined, 'on "2. Not now"');
  assert.equal(onlyTeachListOf(CLAUDE_TEACH_LIST_ON_THREE), undefined, 'on "3. Don\'t show again"');
});

test('rows below the foot do not count: a draft in the input box is not part of the list', () => {
  assert.equal(onlyTeachListOf(changed((row) => (row === '❯' ? '❯ fix the flaky test' : row))), undefined);
});

test('a list with a row changed is not the captured one, and the row is named', () => {
  const said = onlyTeachListOf(changed((row) => (row === '    2. Not now' ? '    2. Later' : row)));
  assert.match(said ?? '', /2\. Later/, `it names the row, got: ${said}`);
});

test('a list with a row more, a row less or a row twice is not the captured one', () => {
  assert.match(onlyTeachListOf(withAboveFoot('    4. Ask me every time')) ?? '', /4\. Ask me every time/, 'a row more is named');
  assert.notEqual(onlyTeachListOf(CLAUDE_TEACH_LIST.filter((row) => row !== '    3. Don\'t show again')), undefined, 'a row less');
  assert.notEqual(onlyTeachListOf(withAboveFoot('    2. Not now')), undefined, 'a row twice');
  assert.notEqual(onlyTeachListOf(withAboveFoot('     Continue')), undefined, 'a row of the 2.1.283 form among it');
});

test('a list with two pointers between title and foot, or none, is not the captured one', () => {
  assert.notEqual(onlyTeachListOf(changed((row) => (row === '    2. Not now' ? '  ❯ 2. Not now' : row))), undefined, 'two pointers');
  assert.notEqual(onlyTeachListOf(changed((row) => (row === '  ❯ 1. Yes' ? '    1. Yes' : row))), undefined, 'no pointer');
});

test('a screen with no title, or no foot under it, is not the list; nor is the 2.1.283 form', () => {
  assert.notEqual(onlyTeachListOf(CLAUDE_TEACH_LIST.filter((row) => !row.includes('Teach auto mode'))), undefined, 'no title');
  assert.notEqual(onlyTeachListOf(CLAUDE_TEACH_LIST.filter((row) => !row.includes('Esc to cancel'))), undefined, 'no foot');
  assert.notEqual(onlyTeachListOf(CLAUDE_TEACH_FORM), undefined, 'the 2.1.283 form');
});

// The ruling on the review of PR #490: the same rows in the same order, and
// framed as Claude Code draws the list, not as a turn quotes it.

/** The captured list from its title to its foot. */
const listBlock = CLAUDE_TEACH_LIST.slice(
  CLAUDE_TEACH_LIST.findIndex((row) => row.includes('Teach auto mode')),
  CLAUDE_TEACH_LIST.findIndex((row) => row.includes('Enter to confirm · Esc to cancel')) + 1,
);

test('a list with its rows in another order is not the captured one', () => {
  const swapped = changed((row) => {
    if (row === '  ❯ 1. Yes') return '    3. Don\'t show again';
    if (row === '    3. Don\'t show again') return '  ❯ 1. Yes';
    return row;
  });
  assert.match(onlyTeachListOf(swapped) ?? '', /order/, 'rows swapped');
});

test('a whole list quoted in history, with a line of the turn above its title or below its foot, is not drawn there', () => {
  const input = ['─'.repeat(120), '❯ run the pending command', '─'.repeat(120), '  ⏵⏵ auto mode on'];
  assert.notEqual(
    onlyTeachListOf(['❯ What was the list?', '⏺ The captured list was:', ...listBlock, '  This is a quotation from the previous run.', ...input]),
    undefined,
    'quoted, with lines of the turn around it',
  );
  const foot = CLAUDE_TEACH_LIST.findIndex((row) => row.includes('Enter to confirm · Esc to cancel'));
  const title = CLAUDE_TEACH_LIST.findIndex((row) => row.includes('Teach auto mode'));
  assert.notEqual(
    onlyTeachListOf([...CLAUDE_TEACH_LIST.slice(0, title), '⏺ The captured list was:', ...CLAUDE_TEACH_LIST.slice(title)]),
    undefined,
    'a line of the turn right above its title, under the rule',
  );
  assert.notEqual(
    onlyTeachListOf([...CLAUDE_TEACH_LIST.slice(0, foot + 1), '  This is a quotation from the previous run.', ...CLAUDE_TEACH_LIST.slice(foot + 1)]),
    undefined,
    'a line of the turn right below its foot, above the input box',
  );
  assert.notEqual(onlyTeachListOf(listBlock), undefined, 'nothing at all above its title');
});

test('the list drawn under a rule of ▔, or with nothing below its foot, is drawn there', () => {
  assert.equal(onlyTeachListOf(['▔'.repeat(120), ...listBlock]), undefined, 'under ▔, nothing below');
  assert.equal(onlyTeachListOf(['─'.repeat(120), ...listBlock, '']), undefined, 'under ─, a blank row below');
});
