// The check a system test runs before it answers Claude Code's folder trust in
// a throwaway tab of its own (helpers/screens.js `plainTrustOf`; the rulings on
// #238 after #450, and on #451). Read on the screen as captured
// (helpers/screens.js CLAUDE_TRUST, Claude Code 2.1.283) and on that screen
// changed one way at a time.

import assert from 'node:assert/strict';
import test from 'node:test';

import { CLAUDE_TRUST, onlyPlainTrustOf, plainTrustOf } from './helpers/screens.js';

/** The folder the captured screen names, as the capture spells it. */
const FOLDER = '<tmp>/obk-system-question-Xygmnk/bots/bot-father';

/** The captured screen with each row `change` gives back. */
const changed = (change) => CLAUDE_TRUST.map(change);

test('the plain folder trust for the test\'s own folder may be answered', () => {
  assert.equal(plainTrustOf(CLAUDE_TRUST, FOLDER), undefined);
});

test('the same folder in the other spelling of a macOS temp path is the same folder', () => {
  const real = '/private/var/folders/x/T/obk-system-q/bots/bot-father';
  const shown = changed((row) => (row.trim() === FOLDER ? ' /var/folders/x/T/obk-system-q/bots/bot-father' : row));
  assert.equal(plainTrustOf(shown, real), undefined, 'the screen shows /var, the test knows /private/var');
  assert.equal(plainTrustOf(shown, '/var/folders/x/T/obk-system-q/bots/bot-father'), undefined, 'and the other way round');
});

test('a screen that names a pre-approved permission is not the plain one', () => {
  const shown = [
    ...CLAUDE_TRUST.slice(0, -4),
    ' ⚠ This folder pre-approves 1 tool permission in .claude/settings.json:',
    '   Bash(/opt/kit/src/cli.js temp trust-hooks:*)',
    ...CLAUDE_TRUST.slice(-4),
  ];
  assert.match(String(plainTrustOf(shown, FOLDER)), /pre-approved/);
});

test('a screen that names another folder is not this test\'s to answer', () => {
  assert.match(String(plainTrustOf(CLAUDE_TRUST, '<tmp>/obk-system-other/bots/bot-father')), /does not show this test's folder/);
});

test('a pointer that is not on "No, exit" is not answered: down and return would then mean something else', () => {
  const onYes = changed((row) => {
    if (/No, exit/.test(row)) return '   No, exit';
    if (/Yes, I trust this folder/.test(row)) return ' ❯ Yes, I trust this folder';
    return row;
  });
  assert.match(String(plainTrustOf(onYes, FOLDER)), /pointer is not on "No, exit"/);
});

test('a screen with no "Yes, I trust this folder" choice is not answered', () => {
  const noYes = CLAUDE_TRUST.filter((row) => !/Yes, I trust this folder/.test(row));
  assert.match(String(plainTrustOf(noYes, FOLDER)), /no "Yes, I trust this folder" choice/);
});

// ------------------------------------------- nothing but the plain screen

// send-outside-fleet answers only a screen whose every row from "Accessing
// workspace:" down is a row of the captured plain one, its own folder in the
// folder's place (the ruling on #451, comment 5961132572; review-451 found a
// screen with one more row answered). helpers/screens.js `onlyPlainTrustOf`.

/** The captured screen with `extra` put in after its "execute files here" row. */
const withRow = (extra) => CLAUDE_TRUST.flatMap((row) => (/execute files here/.test(row) ? [row, extra] : [row]));

test('only-plain: the captured plain screen for its own folder may be answered, in either spelling of a macOS temp path', () => {
  assert.equal(onlyPlainTrustOf(CLAUDE_TRUST, FOLDER), undefined, 'the screen as captured');
  const shown = changed((row) => (row.trim() === FOLDER ? ' /var/folders/x/T/obk-system-q/bots/receiver' : row));
  assert.equal(onlyPlainTrustOf(shown, '/private/var/folders/x/T/obk-system-q/bots/receiver'), undefined, 'the screen shows /var, the test knows /private/var');
  assert.equal(onlyPlainTrustOf(changed((row) => (row.trim() === FOLDER ? ' /private/var/folders/x/T/q/bots/receiver' : row)), '/var/folders/x/T/q/bots/receiver'), undefined, 'and the other way round');
});

for (const [label, extra] of [
  ['the reviewer\'s network permissions row', ' This folder will enable additional network permissions.'],
  ['a row about hooks', ' This folder has hooks that will run when Claude Code starts.'],
  ['a ⚠ row', ' ⚠ Something about this folder.'],
]) {
  test(`only-plain: a screen with one more row, ${label}, is refused, naming the row`, () => {
    const said = onlyPlainTrustOf(withRow(extra), FOLDER);
    assert.equal(typeof said, 'string', `refused: ${said}`);
    assert.ok(said.includes(extra.trim()), `and the refusal names the row it has no ruling for: ${said}`);
  });
}

test('only-plain: a screen that names another folder is refused', () => {
  const said = onlyPlainTrustOf(CLAUDE_TRUST, '<tmp>/obk-system-other/bots/receiver');
  assert.equal(typeof said, 'string', `refused: ${said}`);
  assert.ok(said.includes(FOLDER), `naming the folder row it shows instead: ${said}`);
});

test('only-plain: a screen whose pointer is on "Yes" is refused', () => {
  const onYes = changed((row) => {
    if (/No, exit/.test(row)) return '   No, exit';
    if (/Yes, I trust this folder/.test(row)) return ' ❯ Yes, I trust this folder';
    return row;
  });
  assert.equal(typeof onlyPlainTrustOf(onYes, FOLDER), 'string');
});

test('only-plain: rows above "Accessing workspace:" are the tab\'s own and not judged; a screen without that row is refused', () => {
  const above = ['$ something the shell printed before', ...CLAUDE_TRUST];
  assert.equal(onlyPlainTrustOf(above, FOLDER), undefined, 'a launch line above the screen is not part of it');
  const without = CLAUDE_TRUST.filter((row) => !/Accessing workspace:/.test(row));
  assert.equal(typeof onlyPlainTrustOf(without, FOLDER), 'string', 'no "Accessing workspace:", so not the screen this was captured as');
});

test('only-plain: blank rows between the screen\'s rows are not judged, as Orca\'s rendered rows have them', () => {
  const spaced = CLAUDE_TRUST.flatMap((row) => [row, '', '   ']);
  assert.equal(onlyPlainTrustOf(spaced, FOLDER), undefined);
});

test('only-plain: a screen missing one of the plain screen\'s needed rows is refused: the "Yes" choice, the folder', () => {
  assert.equal(typeof onlyPlainTrustOf(CLAUDE_TRUST.filter((row) => !/Yes, I trust this folder/.test(row)), FOLDER), 'string', 'no "Yes" choice');
  assert.equal(typeof onlyPlainTrustOf(CLAUDE_TRUST.filter((row) => row.trim() !== FOLDER), FOLDER), 'string', 'no folder shown');
});
