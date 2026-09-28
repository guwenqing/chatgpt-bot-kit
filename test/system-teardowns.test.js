// Every system test's teardown closes only the tabs it or the kit created in
// that run (#426, #246's rule applied everywhere).
//
// A teardown used to close every tab at its homes that was not open before the
// run, so a tab someone else opened there meanwhile went too (the review of PR
// #425). The one road now is the tab guard: `guard.closeOwnAt(homes)` closes the
// tabs the guard counts as the test's own and names every other tab it finds
// there as `foreign`, and the teardown fails on a foreign tab before it removes
// the bots folder (test/helpers/tab-guard.js).
//
// This reads the system tests as text; it runs none of them. What it holds a
// teardown to, where a teardown is the function a test hands `t.after(`:
//
//   - it closes no tab itself: no `'terminal', 'close'` call of its own;
//   - it sweeps nothing by "not open before the run": no `.handles.has(`;
//   - one that deletes the test's Orca projects (`'setup-delete'`) closes its
//     tabs through `guard.closeOwnAt(`, and asserts `foreign` is empty before
//     it calls `removeBotsFolderAndSiblings(`.
//
// A close in the body of a test, of one handle it knows is its own, is not a
// teardown and goes through the guard's `orca`, which counts it for the verdict.
// Comments are taken out before anything is matched, so neither a sweep left in
// a comment nor a comment naming the guard counts.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { repoRoot, snapshot } from './helpers/cli.js';

const systemTestsDir = path.join(repoRoot, 'test', 'system');

/**
 * The source with its comments taken out: block comments, and line comments
 * outside strings. Strings and template literals are kept as they are, so a
 * `//` inside a URL or a message is not taken for a comment.
 */
function withoutComments(source) {
  let out = '';
  let at = 0;
  let quote = null;
  while (at < source.length) {
    const here = source[at];
    const next = source[at + 1];
    if (quote !== null) {
      out += here;
      if (here === '\\') {
        out += next ?? '';
        at += 2;
        continue;
      }
      if (here === quote) quote = null;
      at += 1;
      continue;
    }
    if (here === '/' && next === '/') {
      while (at < source.length && source[at] !== '\n') at += 1;
      continue;
    }
    if (here === '/' && next === '*') {
      const end = source.indexOf('*/', at + 2);
      at = end < 0 ? source.length : end + 2;
      continue;
    }
    if (here === '\'' || here === '"' || here === '`') quote = here;
    out += here;
    at += 1;
  }
  return out;
}

/** The text of every function handed to `t.after(`, from its opening paren to the one that closes it, in code without comments. */
function teardownsIn(code) {
  const found = [];
  for (const match of code.matchAll(/\bt\.after\(/g)) {
    let depth = 0;
    let quote = null;
    let end = match.index + match[0].length - 1;
    for (; end < code.length; end += 1) {
      const here = code[end];
      if (quote !== null) {
        if (here === '\\') end += 1;
        else if (here === quote) quote = null;
        continue;
      }
      if (here === '\'' || here === '"' || here === '`') quote = here;
      else if (here === '(') depth += 1;
      else if (here === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    found.push(code.slice(match.index, end + 1));
  }
  return found;
}

/** What is wrong with one file's teardowns, as sentences, or none. */
function teardownTrouble(source) {
  const trouble = [];
  for (const body of teardownsIn(withoutComments(source))) {
    if (/['"]terminal['"],\s*['"]close['"]/.test(body)) trouble.push('its teardown closes a tab itself rather than through guard.closeOwnAt');
    if (/\.handles\.has\(/.test(body)) trouble.push('its teardown picks tabs by whether they were open before the run');
    if (/['"]setup-delete['"]/.test(body)) {
      if (!/\bguard\.closeOwnAt\(/.test(body)) trouble.push('its teardown deletes its projects without closing its tabs through guard.closeOwnAt');
      const asserted = body.search(/assert\.deepEqual\(\s*foreign\b/);
      const removed = body.search(/\bremoveBotsFolderAndSiblings\(/);
      if (asserted < 0 || (removed >= 0 && removed < asserted)) trouble.push('its teardown does not assert foreign is empty before it removes the bots folder');
    }
  }
  return [...new Set(trouble)];
}

// ------------------------------------------------------------- the check's own cases

const GUARDED = `
test('x', async (t) => {
  t.after(async () => {
    const { closed, foreign } = guard.closeOwnAt(homes);
    const held = new Set(foreign.map((one) => one.home));
    for (const setup of allSetups()) {
      if (!homes.includes(setup.path) || held.has(setup.path)) continue;
      orca(['project', 'setup-delete', '--setup', setup.id]);
    }
    assert.deepEqual(foreign, [], 'tabs this test did not create');
    await removeBotsFolderAndSiblings(bots);
    const { closedNotOurs } = guard.verdict(before.handles);
  });
  orca(['terminal', 'close', '--terminal', mine, '--tab']);
});
`;

const SWEEP = `
test('x', async (t) => {
  t.after(async () => {
    for (const terminal of terminalsAt(home)) {
      if (before.handles.has(terminal.handle)) continue;
      orca(['terminal', 'close', '--terminal', terminal.handle, '--tab']);
    }
    for (const setup of allSetups()) orca(['project', 'setup-delete', '--setup', setup.id]);
    await removeBotsFolderAndSiblings(bots);
  });
});
`;

test('the check passes a teardown that closes through the guard, and a close of the test\'s own handle outside it', () => {
  assert.deepEqual(teardownTrouble(GUARDED), []);
});

test('the check names a teardown that sweeps by "not open before", closes tabs itself, and skips the guard', () => {
  assert.deepEqual(teardownTrouble(SWEEP), [
    'its teardown closes a tab itself rather than through guard.closeOwnAt',
    'its teardown picks tabs by whether they were open before the run',
    'its teardown deletes its projects without closing its tabs through guard.closeOwnAt',
    'its teardown does not assert foreign is empty before it removes the bots folder',
  ]);
});

test('the check names a guarded teardown that removes the bots folder before it asserts foreign is empty', () => {
  const late = GUARDED.replace(
    "    assert.deepEqual(foreign, [], 'tabs this test did not create');\n    await removeBotsFolderAndSiblings(bots);\n",
    "    await removeBotsFolderAndSiblings(bots);\n    assert.deepEqual(foreign, [], 'tabs this test did not create');\n",
  );
  assert.notEqual(late, GUARDED, 'the premise: the case was rewritten');
  assert.deepEqual(teardownTrouble(late), ['its teardown does not assert foreign is empty before it removes the bots folder']);
});

test('the check is not fooled by comments: a sweep left in a comment is none, and a comment naming the guard is no guard', () => {
  const commentedOut = GUARDED.replace(
    '    const { closed, foreign } = guard.closeOwnAt(homes);\n',
    '    const { closed, foreign } = guard.closeOwnAt(homes);\n'
    + "    // for (const terminal of terminalsAt(home)) { if (before.handles.has(terminal.handle)) continue; orca(['terminal', 'close', '--terminal', terminal.handle, '--tab']); }\n"
    + "    /* orca(['terminal', 'close', '--terminal', stray, '--tab']); */\n",
  );
  assert.deepEqual(teardownTrouble(commentedOut), [], 'a sweep in comments is not code');

  const namedOnly = SWEEP.replace('  t.after(async () => {\n', '  t.after(async () => {\n    // guard.closeOwnAt(homes); assert.deepEqual(foreign, []);\n');
  assert.ok(teardownTrouble(namedOnly).includes('its teardown deletes its projects without closing its tabs through guard.closeOwnAt'), 'a comment naming the guard does not count as the guard');
});

test('the check keeps strings whole: a // inside a string is not a comment, and a paren inside one does not end the teardown', () => {
  const tricky = SWEEP.replace('  t.after(async () => {\n', "  t.after(async () => {\n    t.diagnostic('see https://example.com/a (b');\n");
  assert.ok(teardownTrouble(tricky).includes('its teardown closes a tab itself rather than through guard.closeOwnAt'));
});

// ------------------------------------------------------------- the system tests

test('every system test\'s teardown closes only its own tabs, through the tab guard', async () => {
  const tree = await snapshot(systemTestsDir);
  const files = Object.keys(tree).filter((rel) => tree[rel].startsWith('file:') && rel.endsWith('.js'));
  assert.ok(files.length > 0, 'there should be system tests to check');

  const found = [];
  let teardowns = 0;
  for (const rel of files.sort()) {
    const source = await readFile(path.join(systemTestsDir, rel), 'utf8');
    teardowns += teardownsIn(withoutComments(source)).length;
    for (const why of teardownTrouble(source)) found.push(`test/system/${rel}: ${why}`);
  }
  assert.ok(teardowns > 0, 'no teardown was found in the system tests, so the check sees nothing');
  assert.deepEqual(found, [], `system tests whose teardown does not go through the tab guard:\n  ${found.join('\n  ')}`);
});
