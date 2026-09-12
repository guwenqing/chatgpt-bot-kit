import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import YAML from 'yaml';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'src/cli.js');
function run(root, command, args = []) {
  const result = spawnSync(process.execPath, [cli, command, '--workspace', root, ...args], { encoding: 'utf8', timeout: 15000 });
  assert.ifError(result.error);
  return result;
}
function snapshot(root, prefix = '') {
  const records = {};
  for (const name of fs.readdirSync(path.join(root, prefix)).sort()) {
    const relative = path.join(prefix, name);
    const file = path.join(root, relative);
    const info = fs.lstatSync(file);
    records[relative] = info.isSymbolicLink() ? `link:${fs.readlinkSync(file)}`
      : info.isDirectory() ? 'directory' : fs.readFileSync(file).toString('base64');
    if (info.isDirectory()) Object.assign(records, snapshot(root, relative));
  }
  return records;
}

// bot-workspaces-and-guidance requires invalid input to cause no applied changes.
// D2 requires preflight and preservation when partially prepared state is resumed.
for (const [name, bytes] of [
  ['unsupported receipt schema', 'schema_version: 999\n'],
  ['malformed receipt YAML', 'schema_version: 1\nsessions: [unfinished\n'],
]) test(`unregistered bot with ${name} is rejected before publishing any bot files or membership`, (t) => {
  const parent = path.join(repo, 'local-data/bot-management-tests');
  fs.mkdirSync(parent, { recursive: true });
  const base = fs.mkdtempSync(path.join(parent, 'recovery-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'workspace');
  const prepared = run(root, 'prepare');
  assert.equal(prepared.status, 0, prepared.stderr);
  const orphan = path.join(root, 'bots/orphan');
  fs.mkdirSync(path.join(orphan, '.bot-kit'), { recursive: true });
  fs.writeFileSync(path.join(orphan, '.bot-kit/native.yaml'), bytes);
  fs.writeFileSync(path.join(orphan, 'unfinished.txt'), 'Preserve prior work from interrupted setup.\n');
  const config = path.join(base, 'orphan.yaml');
  fs.writeFileSync(config, YAML.stringify({
    schema_version: 1, id: 'orphan', name: 'Recovered bot', purpose: 'Continue interrupted setup.',
    rules: [], skills: [], sessions: [{ id: 'daily', role: 'daily', default: true, startup_prompt: 'Continue my selected work.' }],
  }));
  const before = snapshot(root);
  const result = run(root, 'create-bot', ['--config', config]);
  assert.notEqual(result.status, 0, 'invalid existing receipt must be rejected');
  assert.match(result.stderr, /native\.yaml.*(?:schema|YAML)/i, 'identify the existing receipt requiring repair');
  assert.deepEqual(snapshot(root), before, 'preflight rejection must preserve the registry and every existing file without publishing config or guidance');
  assert.equal(fs.existsSync(path.join(orphan, 'bot.yaml')), false);
  assert.equal(fs.existsSync(path.join(orphan, 'AGENTS.md')), false);
  const inspected = run(root, 'inspect');
  assert.equal(inspected.status, 0, 'rejected creation must leave the existing managed directory inspectable');
  assert.ok(!JSON.parse(inspected.stdout).directory.some((bot) => bot.id === 'orphan'));
});

test('a valid unregistered native receipt changed by another writer prevents bot publication', (t) => {
  const parent = path.join(repo, 'local-data/bot-management-tests');
  fs.mkdirSync(parent, { recursive: true });
  const base = fs.mkdtempSync(path.join(parent, 'recovery-race-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'workspace');
  const prepared = run(root, 'prepare');
  assert.equal(prepared.status, 0, prepared.stderr);
  const orphan = path.join(root, 'bots/orphan');
  fs.mkdirSync(path.join(orphan, '.bot-kit'), { recursive: true });
  const nativeFile = path.join(orphan, '.bot-kit/native.yaml');
  const receipt = { schema_version: 1, bot: 'orphan', observed_at: '2026-09-12T20:00:00.000Z',
    source: { surface: 'synthetic-test', method: 'test fixture, not native evidence' }, state: 'backend-only',
    sessions: [], evidence: ['Prepared association remains unconfirmed.'] };
  fs.writeFileSync(nativeFile, YAML.stringify(receipt));
  const changedReceipt = YAML.stringify({ ...receipt, state: 'stale', evidence: ['Another writer learned this association is stale.'] });
  const config = path.join(base, 'orphan.yaml');
  fs.writeFileSync(config, YAML.stringify({ schema_version: 1, id: 'orphan', name: 'Recovered bot',
    purpose: 'Continue interrupted setup.', rules: [], skills: [],
    sessions: [{ id: 'daily', role: 'daily', default: true, startup_prompt: 'Continue my selected work.' }] }));
  const before = snapshot(root);
  before['bots/orphan/.bot-kit/native.yaml'] = Buffer.from(changedReceipt).toString('base64');
  const hook = path.join(base, 'concurrent-writer.mjs');
  // Inject a competing change at acquisition of the public workspace writer lock,
  // after read-only planning but before publication. This is fixture-only code.
  fs.writeFileSync(hook, `import fs from 'node:fs';\nconst original = fs.openSync;\nfs.openSync = function(file, ...args) {\n  if (String(file) === ${JSON.stringify(path.join(root, '.bot-kit/write.lock'))}) fs.writeFileSync(${JSON.stringify(nativeFile)}, ${JSON.stringify(changedReceipt)});\n  return original.call(this, file, ...args);\n};\n`);
  const result = spawnSync(process.execPath, ['--import', hook, cli, 'create-bot', '--workspace', root, '--config', config], { encoding: 'utf8', timeout: 15000 });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0, 'a changed preexisting receipt must invalidate bot publication');
  assert.match(result.stderr, /changed|conflict|revision/i);
  assert.deepEqual(snapshot(root), before, 'keep the competing receipt bytes while leaving registry, config and guidance unpublished');
});
