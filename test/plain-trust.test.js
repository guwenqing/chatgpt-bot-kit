// The check a system test runs before it answers Claude Code's folder trust in
// a throwaway tab of its own (helpers/screens.js `plainTrustOf`; the rulings on
// #238 after #450, and on #451). Read on the screen as captured
// (helpers/screens.js CLAUDE_TRUST, Claude Code 2.1.283) and on that screen
// changed one way at a time.

import assert from 'node:assert/strict';
import test from 'node:test';

import { CLAUDE_TRUST, plainTrustOf } from './helpers/screens.js';

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
