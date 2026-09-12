import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import YAML from 'yaml';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('output bound terminates a still-running producer before the execution timeout', (t) => {
  const parent = path.join(repo, 'local-data');
  fs.mkdirSync(parent, { recursive: true });
  const base = fs.mkdtempSync(path.join(parent, 'claude-output-bound-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const executable = path.join(base, 'selected.cjs');
  const log = path.join(base, 'calls.jsonl');
  fs.writeFileSync(executable, `#!${process.execPath}\nconst fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[0] === '--version') { console.log('2.1.263'); process.exit(0); }
if (args[0] === '--help') { console.log('-p, --print\\n--output-format <format>\\n--append-system-prompt <prompt>'); process.exit(0); }
if (args[0] === 'auth') { console.log('{"loggedIn":true}'); process.exit(0); }
// Finite allocation even when a broken bridge fails to enforce its output cap.
process.stdout.write('x'.repeat(32 * 1024 * 1024));
setInterval(() => {}, 1000);
`);
  fs.chmodSync(executable, 0o755);
  const rule = path.join(base, 'AGENTS.md');
  fs.writeFileSync(rule, 'Read synthetic inputs only.\n');
  const config = path.join(base, 'packet.yaml');
  fs.writeFileSync(config, YAML.stringify({
    schema_version: 1, executable, cwd: base,
    objective: 'Exercise bounded output.', context: 'Synthetic fixture.',
    authority: 'No live provider calls.', return_to: 'origin-task',
    rules: [{ path: rule, role: 'target' }], timeout_ms: 1500,
  }));
  const run = spawnSync(process.execPath, [path.join(repo, 'src/cli.js'), 'claude-run', '--config', config], {
    cwd: base, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
  });
  assert.ifError(run.error);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'failed');
  assert.equal(result.execution.timed_out, false, 'output cap must stop this producer before the execution timeout');
  assert.match(JSON.stringify(result.errors), /output|buffer|bound/i);
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.filter((args) => args[0] === '-p').length, 1);
});
