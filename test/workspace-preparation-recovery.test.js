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
const bot = 'bots/bot-father';

function fixture(t) {
  const parent = path.join(repo, 'local-data');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'workspace-recovery-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function prepare(root, command = 'prepare') {
  const result = spawnSync(process.execPath, [cli, command, '--workspace', root], {
    cwd: root, encoding: 'utf8', timeout: 15000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function read(root, relative) { return fs.readFileSync(path.join(root, relative)); }
function write(root, relative, bytes) {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  fs.writeFileSync(path.join(root, relative), bytes);
}

test('preparation preserves the UTF-8 BOM and exact bytes of unmarked user AGENTS content', (t) => {
  const root = fixture(t);
  const original = Buffer.from('\uFEFF# My existing guidance\r\n\r\nKeep café and these line endings.\r\n');
  write(root, `${bot}/AGENTS.md`, original);
  prepare(root);
  const generated = read(root, `${bot}/AGENTS.md`);
  assert.ok(generated.includes(original), 'the complete unmarked user content, including BOM, must remain byte-for-byte');
  prepare(root);
  assert.deepEqual(read(root, `${bot}/AGENTS.md`), generated, 'a repeat must retain the preserved bytes');
});

test('preparation recovers after current generated AGENTS lands before its digest receipt', (t) => {
  const root = fixture(t);
  const reference = fixture(t);
  prepare(root);
  prepare(reference);
  const config = YAML.parse(read(root, `${bot}/bot.yaml`).toString('utf8'));
  config.rules.push('Keep this authorized rule after interrupted regeneration.');
  const currentYaml = YAML.stringify(config);
  write(root, `${bot}/bot.yaml`, currentYaml);
  write(reference, `${bot}/bot.yaml`, currentYaml);
  // A complete preparation of identical configuration supplies the public output.
  // Copy only its AGENTS result to model interruption before the next receipt write.
  prepare(reference, 'regenerate');
  const expectedAgents = read(reference, `${bot}/AGENTS.md`);
  const oldReceipt = read(root, `${bot}/.bot-kit/generation.yaml`);
  write(root, `${bot}/AGENTS.md`, expectedAgents);
  write(root, `${bot}/memory/user.md`, 'Preserve my remembered preference.\n');
  const beforeRegistry = read(root, `${bot}/registry.yaml`);
  assert.notDeepEqual(oldReceipt, read(reference, `${bot}/.bot-kit/generation.yaml`));

  const result = prepare(root);
  assert.equal(result.status, 'prepared');
  assert.equal(result.native_ready, false);
  assert.deepEqual(read(root, `${bot}/AGENTS.md`), expectedAgents);
  assert.equal(read(root, `${bot}/bot.yaml`).toString('utf8'), currentYaml);
  assert.deepEqual(read(root, `${bot}/registry.yaml`), beforeRegistry);
  assert.equal(read(root, `${bot}/memory/user.md`).toString('utf8'), 'Preserve my remembered preference.\n');
  const agents = expectedAgents.toString('utf8');
  const region = agents.slice(agents.indexOf('<!-- bot-kit:begin -->'), agents.indexOf('<!-- bot-kit:end -->') + '<!-- bot-kit:end -->'.length);
  const receipt = YAML.parse(read(root, `${bot}/.bot-kit/generation.yaml`).toString('utf8'));
  assert.equal(receipt.managed_sha256, createHash('sha256').update(region).digest('hex'));
  const restoredReceipt = read(root, `${bot}/.bot-kit/generation.yaml`);
  prepare(root);
  assert.deepEqual(read(root, `${bot}/.bot-kit/generation.yaml`), restoredReceipt);
  assert.deepEqual(read(root, `${bot}/AGENTS.md`), expectedAgents);
});
