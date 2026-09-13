import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import YAML from 'yaml';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('stderr-only provider refusal retains useful diagnostics and redacts credentials without retry', (t) => {
  const parent = path.join(repo, 'local-data');
  fs.mkdirSync(parent, { recursive: true });
  const base = fs.mkdtempSync(path.join(parent, 'claude-diagnostics-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const executable = path.join(base, 'selected.cjs');
  const log = path.join(base, 'calls.jsonl');
  const secret = 'SYNTHETIC_PROVIDER_SECRET_123456';
  fs.writeFileSync(executable, `#!${process.execPath}\nconst fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[0] === '--version') { console.log('2.1.263'); process.exit(0); }
if (args[0] === '--help') { console.log('-p, --print\\n--output-format <format>\\n--append-system-prompt <prompt>\\n--model <model>\\n--resume <session>'); process.exit(0); }
if (args[0] === 'auth') { console.log('{"loggedIn":true}'); process.exit(0); }
process.stderr.write('Selected provider rejected model entitlement for this session. key=' + process.env.CLAUDE_TEST_API_KEY + ' Authorization: Bearer fake-token-for-test');
process.exitCode = 7;
`);
  fs.chmodSync(executable, 0o755);
  const rule = path.join(base, 'AGENTS.md');
  fs.writeFileSync(rule, 'Read synthetic inputs only.\n');
  const config = path.join(base, 'packet.yaml');
  fs.writeFileSync(config, YAML.stringify({
    schema_version: 1, executable, cwd: base,
    objective: 'Return refusal truthfully.', context: 'Synthetic fixture.',
    authority: 'No retry or provider changes.', return_to: 'origin-task',
    rules: [{ path: rule, role: 'target' }], model: 'requested-model', resume: 'known-session',
  }));
  const run = spawnSync(process.execPath, [path.join(repo, 'src/cli.js'), 'claude-run', '--config', config], {
    cwd: base, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, CLAUDE_TEST_API_KEY: secret },
  });
  assert.ifError(run.error);
  assert.equal(run.status, 1);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'failed');
  assert.equal(result.execution.exit_code, 7);
  assert.match(JSON.stringify(result.errors), /Selected provider rejected model entitlement for this session/, 'retain the provider reason needed for the recovery choice');
  assert.ok(!(run.stdout + run.stderr).includes(secret));
  assert.doesNotMatch(run.stdout + run.stderr, /fake-token-for-test/);
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.filter((args) => args[0] === '-p').length, 1);
});
