// The launch-time overrides that let a system test's Codex session start with
// no folder-trust question and no hooks review, so nothing is written into the
// user's own ~/.codex/config.toml (#240, option (c), the architect's ruling of
// 2026-09-28), and the reader a test checks that file with
// (test/helpers/codex-trust.js).
//
// Codex takes a folder's trust as a whole `projects` table in one `-c`, as TOML;
// the dotted key form splits on every `.` and does not work (the research on
// #240). The path is a TOML basic string, so a path with dots, spaces, quotes or
// backslashes stays one key. What the helper gives is passed through `session
// add --extra-arg=…`, one argument each, which the kit quotes as one word.
//
// The reader returns only the keys of `[projects."…"]` and `[hooks.state."…"]`
// table headers. The file may hold secrets; nothing else in it is returned.

import assert from 'node:assert/strict';
import test from 'node:test';

import { addedUnder, codexTrustArgs, trustKeysIn } from './helpers/codex-trust.js';

test('the extra args trust the bots folder by a whole projects table, bypass the hooks review, and turn tooltips off', () => {
  assert.deepEqual(codexTrustArgs('/private/var/folders/x/obk-system-trust-Ab1.c/bots'), [
    '--extra-arg=-c',
    '--extra-arg=projects={"/private/var/folders/x/obk-system-trust-Ab1.c/bots"={trust_level="trusted"}}',
    '--extra-arg=--dangerously-bypass-hook-trust',
    '--extra-arg=-c',
    '--extra-arg=tui.show_tooltips=false',
  ]);
});

test('a path with dots, spaces, a quote and a backslash stays one TOML key in the projects table', () => {
  const folder = '/tmp/a b.c/it\'s "odd"\\dir';
  const [, table] = codexTrustArgs(folder);
  const found = /^--extra-arg=projects=\{("(?:[^"\\]|\\.)*")=\{trust_level="trusted"\}\}$/.exec(table);
  assert.ok(found, `one table, one quoted key, trust_level trusted: ${table}`);
  // A TOML basic string with these escapes reads back as JSON does.
  assert.equal(JSON.parse(found[1]), folder);
  assert.equal(found[1], '"/tmp/a b.c/it\'s \\"odd\\"\\\\dir"');
});

/** A config.toml with the two kinds of table this reads, and others it must not return. */
const FIXTURE = [
  'model = "gpt-6-luna"',
  'api_key_hint = "sk-not-a-real-one"',
  '',
  '[projects."/Users/q/work/app"]',
  'trust_level = "trusted"',
  '',
  '[projects."/private/var/folders/s5/T/obk-system-trust-Ab1/bots"]',
  'trust_level = "trusted"',
  '',
  '[projects.\'/var/folders/s5/T/obk-system-trust-Ab1/bots/bots/x\']',
  'trust_level = "untrusted"',
  '',
  '[hooks.state."/private/var/folders/s5/T/obk-system-trust-Ab1/bots/bots/x/.codex/hooks.json:SessionStart:0:0"]',
  'trusted_hash = "abc"',
  '',
  '[hooks.state."/Users/q/.codex/hooks.json:Stop:0:0"]',
  'trusted_hash = "def"',
  '',
  '[projects."/tmp/with \\"quote\\""]',
  'trust_level = "trusted"',
  '',
  '[tui.model_availability_nux]',
  'shown_count = 2',
  '',
  '# [projects."/in/a/comment"]',
  '  [projects."/indented"]',
].join('\n');

test('the reader finds the projects and hooks.state table headers, and nothing else in the file', () => {
  assert.deepEqual(trustKeysIn(FIXTURE), {
    projects: [
      '/Users/q/work/app',
      '/private/var/folders/s5/T/obk-system-trust-Ab1/bots',
      '/var/folders/s5/T/obk-system-trust-Ab1/bots/bots/x',
      '/tmp/with "quote"',
      '/indented',
    ],
    hooks: [
      '/private/var/folders/s5/T/obk-system-trust-Ab1/bots/bots/x/.codex/hooks.json:SessionStart:0:0',
      '/Users/q/.codex/hooks.json:Stop:0:0',
    ],
  });
  assert.deepEqual(trustKeysIn(''), { projects: [], hooks: [] }, 'an empty file, or none, has neither');
});

test('the keys added under a folder, in either spelling of a macOS temp path, and none of the others', () => {
  const before = { projects: ['/Users/q/work/app'], hooks: ['/Users/q/.codex/hooks.json:Stop:0:0'] };
  const after = trustKeysIn(FIXTURE);
  // The folder as the test knows it (its realpath), and as Codex may write it.
  for (const folder of ['/private/var/folders/s5/T/obk-system-trust-Ab1', '/var/folders/s5/T/obk-system-trust-Ab1']) {
    assert.deepEqual(addedUnder(before, after, folder), {
      projects: ['/private/var/folders/s5/T/obk-system-trust-Ab1/bots', '/var/folders/s5/T/obk-system-trust-Ab1/bots/bots/x'],
      hooks: ['/private/var/folders/s5/T/obk-system-trust-Ab1/bots/bots/x/.codex/hooks.json:SessionStart:0:0'],
    }, `from ${folder}`);
  }
  assert.deepEqual(
    addedUnder(before, after, '/private/var/folders/s5/T/obk-system-trust-Ab'),
    { projects: [], hooks: [] },
    'a folder whose name only begins the same holds none of them',
  );
  assert.deepEqual(addedUnder(after, after, '/private/var/folders/s5/T/obk-system-trust-Ab1'), { projects: [], hooks: [] }, 'and nothing added is nothing');
});
