import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import YAML from 'yaml';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'src/cli.js');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const parent = path.join(repo, 'local-data/bot-management-tests');
  fs.mkdirSync(parent, { recursive: true });
  const base = fs.mkdtempSync(path.join(parent, 'migration-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const source = path.join(base, 'unfinished source');
  const destination = path.join(base, 'receiving bot/work/project');
  fs.mkdirSync(source); fs.mkdirSync(destination, { recursive: true });
  return { base, source, destination };
}
function run(command, args) {
  const result = spawnSync(process.execPath, [cli, command, ...args], { encoding: 'utf8', timeout: 15000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
function write(root, file, value) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), value); }
function git(root, args) {
  const result = spawnSync('git', ['--no-optional-locks', '-C', root, ...args], { encoding: 'utf8', timeout: 15000 });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function entries(root, prefix = '') {
  const result = [];
  for (const name of fs.readdirSync(path.join(root, prefix)).sort()) {
    if (name === '.git') continue;
    const relative = prefix ? `${prefix}/${name}` : name;
    const full = path.join(root, relative);
    const info = fs.lstatSync(full);
    if (info.isSymbolicLink()) result.push({ path: relative, type: 'symlink', mode: info.mode & 0o777, target: fs.readlinkSync(full) });
    else if (info.isDirectory()) { result.push({ path: relative, type: 'directory', mode: info.mode & 0o777 }); result.push(...entries(root, relative)); }
    else result.push({ path: relative, type: 'file', mode: info.mode & 0o777, sha256: hash(fs.readFileSync(full)) });
  }
  return result;
}
function snapshot(root, prefix = '') {
  const result = {};
  for (const name of fs.readdirSync(path.join(root, prefix)).sort()) {
    const relative = path.join(prefix, name); const full = path.join(root, relative); const info = fs.lstatSync(full);
    result[relative] = [info.mode & 0o777, info.isSymbolicLink() ? `link:${fs.readlinkSync(full)}` : info.isDirectory() ? 'directory' : fs.readFileSync(full).toString('base64')];
    if (info.isDirectory()) Object.assign(result, snapshot(root, relative));
  }
  return result;
}
// Independent documented inventory input lets verification failures expose behavior
// even when the inventory command has not yet been implemented.
function manifest(base, source) {
  const inventory = { schema_version: 1, source, entries: entries(source), git: null, caveats: [] };
  const file = path.join(base, 'inventory.yaml');
  fs.writeFileSync(file, YAML.stringify(inventory));
  return file;
}
function verify(file, destination) { return run('verify-migration', ['--inventory', file, '--destination', destination]); }
function initializeGit(root) {
  git(root, ['init', '--quiet']);
  write(root, 'tracked.txt', 'committed work\n');
  write(root, 'AGENTS.md', '# Target repository rules\nKeep these instructions.\n');
  write(root, '.gitignore', 'selected-ignored/\n');
  git(root, ['add', '.']);
  // Synthetic fixtures have no commits to sign: construct their initial Git object
  // directly, without changing or overriding the effective Git signing policy.
  const tree = git(root, ['write-tree']);
  const result = spawnSync('git', ['-C', root, 'hash-object', '-t', 'commit', '-w', '--stdin'], {
    input: `tree ${tree}\nauthor Synthetic Fixture <fixture@example.invalid> 1700000000 +0000\ncommitter Synthetic Fixture <fixture@example.invalid> 1700000000 +0000\n\nSynthetic initial state\n`, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const head = result.stdout.trim();
  git(root, ['update-ref', 'HEAD', head]);
  return head;
}

test('Git inventory includes dirty tracked, untracked and ignored files without exposing contents or changing the source', (t) => {
  const { base, source } = fixture(t);
  const head = initializeGit(source);
  write(source, 'tracked.txt', 'unfinished changed work\n');
  write(source, 'untracked file.txt', 'untracked work\n');
  write(source, 'selected-ignored/environment.txt', 'synthetic-private-value-do-not-report');
  write(source, 'run.sh', '#!/bin/sh\nexit 0\n'); fs.chmodSync(path.join(source, 'run.sh'), 0o755);
  const before = snapshot(source);
  const output = path.join(base, 'inventory.yaml');
  run('inventory', ['--source', source, '--output', output]);
  assert.ok(fs.existsSync(output), 'successful inventory must write the requested YAML manifest');
  const inventory = YAML.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(inventory.schema_version, 1);
  assert.equal(inventory.source, source);
  assert.equal(inventory.git.head, head);
  const byPath = new Map(inventory.entries.map((entry) => [entry.path, entry]));
  for (const file of ['tracked.txt', 'untracked file.txt', 'selected-ignored/environment.txt', 'AGENTS.md']) {
    assert.equal(byPath.get(file)?.sha256, hash(fs.readFileSync(path.join(source, file))), `${file} must be represented with its current bytes`);
  }
  assert.equal(byPath.get('run.sh').mode, 0o755);
  assert.match(JSON.stringify(inventory.git.status), /tracked\.txt/);
  assert.ok(!inventory.entries.some((entry) => entry.path === '.git' || entry.path.startsWith('.git/')), 'clone-specific internal Git bytes are not migration content');
  assert.doesNotMatch(JSON.stringify(inventory), /synthetic-private-value-do-not-report/);
  assert.ok(Array.isArray(inventory.caveats));
  assert.deepEqual(snapshot(source), before, 'read-only inventory must preserve work and Git metadata bytes');
});

test('non-Git inventory is useful and symlinks are recorded without traversing outside or following cycles', (t) => {
  const { base, source } = fixture(t);
  write(source, 'unfinished.txt', 'local non-Git work');
  write(source, 'AGENTS.md', '# Local target rules');
  write(base, 'outside/private.txt', 'not selected');
  fs.symlinkSync('../outside', path.join(source, 'external-link'));
  fs.symlinkSync('.', path.join(source, 'cycle'));
  fs.symlinkSync('missing-target', path.join(source, 'broken-link'));
  const before = snapshot(source);
  const inventory = run('inventory', ['--source', source]);
  assert.ok(Array.isArray(inventory.entries), 'inventory must return file evidence for a non-Git source');
  assert.equal(inventory.git, null);
  for (const [link, target] of [['external-link', '../outside'], ['cycle', '.'], ['broken-link', 'missing-target']]) {
    assert.deepEqual(inventory.entries.find((entry) => entry.path === link), { path: link, type: 'symlink', mode: fs.lstatSync(path.join(source, link)).mode & 0o777, target });
  }
  assert.ok(!inventory.entries.some((entry) => entry.path.includes('private.txt') || entry.path.startsWith('cycle/')));
  assert.match(inventory.caveats.join(' '), /link|portable|portability/i);
  assert.deepEqual(snapshot(source), before);
});

test('verification proves selected non-Git bytes and modes while preserving both original and destination', (t) => {
  const { base, source, destination } = fixture(t);
  write(source, 'AGENTS.md', '# Preserve local rules\n');
  write(source, 'unfinished.txt', 'continue this draft\n');
  write(source, 'run.sh', '#!/bin/sh\nexit 0\n'); fs.chmodSync(path.join(source, 'run.sh'), 0o755);
  const file = manifest(base, source);
  fs.cpSync(source, destination, { recursive: true });
  const sourceBefore = snapshot(source); const destinationBefore = snapshot(destination);
  const result = verify(file, destination);
  assert.equal(result.status, 'verified', 'equal selected working state should pass verification');
  assert.equal(result.source_changed, false);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(snapshot(source), sourceBefore);
  assert.deepEqual(snapshot(destination), destinationBefore);
});

for (const [name, fault] of [
  ['missing untracked work', (destination) => fs.unlinkSync(path.join(destination, 'untracked.txt'))],
  ['changed tracked work', (destination) => write(destination, 'tracked.txt', 'clean clone lost my edits')],
  ['missing selected ignored work', (destination) => fs.unlinkSync(path.join(destination, 'selected-ignored/env.txt'))],
  ['changed executable mode', (destination) => fs.chmodSync(path.join(destination, 'run.sh'), 0o644)],
  ['file replaced by directory', (destination) => { fs.unlinkSync(path.join(destination, 'untracked.txt')); fs.mkdirSync(path.join(destination, 'untracked.txt')); }],
]) test(`migration verification exposes ${name} without changing files`, (t) => {
  const { base, source, destination } = fixture(t);
  write(source, 'tracked.txt', 'unfinished edits'); write(source, 'untracked.txt', 'new work');
  write(source, 'selected-ignored/env.txt', 'synthetic environment data');
  write(source, 'run.sh', '#!/bin/sh\n'); fs.chmodSync(path.join(source, 'run.sh'), 0o755);
  const file = manifest(base, source);
  fs.cpSync(source, destination, { recursive: true }); fault(destination);
  const before = snapshot(source); const afterCopy = snapshot(destination);
  const result = verify(file, destination);
  assert.equal(result.status, 'incomplete', 'an omitted or changed selected item must prevent success');
  assert.ok(result.mismatches.length > 0);
  assert.ok(result.mismatches.every((item) => typeof item.path === 'string' && typeof item.reason === 'string'));
  assert.deepEqual(snapshot(source), before); assert.deepEqual(snapshot(destination), afterCopy);
});

for (const change of ['modified', 'new-untracked']) test(`source ${change} after inventory prevents an outdated migration success`, (t) => {
  const { base, source, destination } = fixture(t);
  write(source, 'unfinished.txt', 'snapshot work'); const file = manifest(base, source);
  fs.cpSync(source, destination, { recursive: true });
  write(source, change === 'modified' ? 'unfinished.txt' : 'new.txt', 'new work after inventory');
  const result = verify(file, destination);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.source_changed, true, 'comparison must check current source instead of trusting an old receipt');
  assert.equal(fs.readFileSync(path.join(source, change === 'modified' ? 'unfinished.txt' : 'new.txt'), 'utf8'), 'new work after inventory');
});

test('linked worktree inventory records the actual Git context rather than copying its .git pointer as portable state', (t) => {
  const { base, source } = fixture(t); const head = initializeGit(source);
  const linked = path.join(base, 'linked checkout'); git(source, ['worktree', 'add', '--detach', linked, head]);
  write(linked, 'untracked.txt', 'unfinished linked work');
  const before = snapshot(linked);
  const inventory = run('inventory', ['--source', linked]);
  assert.ok(inventory.git, 'linked worktree must be recognized as Git');
  assert.equal(inventory.git.head, head);
  assert.match(JSON.stringify(inventory.git.worktrees), /linked checkout/);
  assert.ok(inventory.entries.some((entry) => entry.path === 'untracked.txt'));
  assert.ok(!inventory.entries.some((entry) => entry.path === '.git'));
  assert.match(inventory.caveats.join(' '), /worktree|linked|portable/i);
  assert.deepEqual(snapshot(linked), before);
});

test('submodule inventory retains unfinished nested work and exposes submodule portability obligations', (t) => {
  const { base, source } = fixture(t); initializeGit(source);
  const child = path.join(base, 'submodule origin'); fs.mkdirSync(child); initializeGit(child);
  git(source, ['-c', 'protocol.file.allow=always', 'submodule', 'add', child, 'module']);
  write(source, 'module/tracked.txt', 'unfinished submodule edit');
  write(source, 'module/untracked.txt', 'new submodule work');
  const before = snapshot(source);
  const inventory = run('inventory', ['--source', source]);
  assert.ok(inventory.git, 'submodule-containing source must retain Git observations');
  assert.match(JSON.stringify(inventory.git.submodules), /module/);
  assert.ok(inventory.entries.some((entry) => entry.path === 'module/tracked.txt' && entry.sha256 === hash(Buffer.from('unfinished submodule edit'))));
  assert.ok(inventory.entries.some((entry) => entry.path === 'module/untracked.txt'));
  assert.ok(!inventory.entries.some((entry) => entry.path === 'module/.git'));
  assert.match(inventory.caveats.join(' '), /submodule/i);
  assert.deepEqual(snapshot(source), before);
});

test('copied symlink targets remain visible caveats and differing targets are rejected as complete migration', (t) => {
  const { base, source, destination } = fixture(t);
  write(source, 'unfinished.txt', 'work'); fs.symlinkSync('unfinished.txt', path.join(source, 'shortcut'));
  const file = manifest(base, source);
  write(destination, 'unfinished.txt', 'work'); fs.symlinkSync('somewhere-else', path.join(destination, 'shortcut'));
  const result = verify(file, destination);
  assert.equal(result.status, 'incomplete');
  assert.ok(result.mismatches.some((item) => item.path === 'shortcut'));
});

test('a clone with restored dirty, untracked and ignored work verifies against the source inventory', (t) => {
  const { base, source, destination } = fixture(t); initializeGit(source);
  write(source, 'tracked.txt', 'unfinished tracked changes');
  write(source, 'untracked.txt', 'new local work');
  write(source, 'selected-ignored/environment.txt', 'selected local environment');
  const file = path.join(base, 'git-inventory.yaml');
  run('inventory', ['--source', source, '--output', file]);
  assert.ok(fs.existsSync(file), 'inventory must exist before assessing the selected transfer');
  git(base, ['clone', '--quiet', source, destination]);
  for (const entry of entries(source)) {
    if (entry.type === 'directory') fs.mkdirSync(path.join(destination, entry.path), { recursive: true });
    else if (entry.type === 'file') { write(destination, entry.path, fs.readFileSync(path.join(source, entry.path))); fs.chmodSync(path.join(destination, entry.path), entry.mode); }
  }
  const before = snapshot(source);
  const result = verify(file, destination);
  assert.equal(result.status, 'verified', 'clone metadata differences must not obscure restored selected work');
  assert.equal(result.source_changed, false);
  assert.deepEqual(result.mismatches, []);
  assert.deepEqual(snapshot(source), before);
});
