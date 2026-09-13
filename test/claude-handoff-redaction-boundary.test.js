import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import YAML from 'yaml';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const limit = 65536;
const reason = 'Selected provider refused this authorized continuation. ';
const knownSecret = 'SYNTHETIC_BOUNDARY_CREDENTIAL_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const cases = [
  { name: 'known environment credential', value: knownSecret, visible: 24, forbidden: knownSecret.slice(0, 24) },
  { name: 'recognizable API token', value: 'sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', visible: 12, forbidden: 'sk-ABCDEFGHI' },
  { name: 'recognizable bearer token', value: 'Bearer SYNTHETIC_BEARER_ABCDEFGHIJKLMNOPQRSTUVWXYZ', visible: 25, forbidden: 'SYNTHETIC_BEARER_' },
];

for (const surface of ['stderr', 'result', 'structured errors']) {
  for (const credential of cases) {
    test(`${surface}: redact ${credential.name} spanning the returned-text cutoff`, (t) => {
      const parent = path.join(repo, 'local-data');
      fs.mkdirSync(parent, { recursive: true });
      const base = fs.mkdtempSync(path.join(parent, 'claude-redaction-boundary-'));
      t.after(() => fs.rmSync(base, { recursive: true, force: true }));
      const executable = path.join(base, 'selected.cjs');
      const log = path.join(base, 'calls.jsonl');
      // The credential is complete in captured provider output but crosses the
      // returned-text boundary. A space makes token recognition unambiguous.
      const payload = reason + 'x'.repeat(limit - credential.visible - reason.length - 1) + ' ' + credential.value + '\nAdditional diagnostic context.';
      assert.ok(payload.length > limit);
      assert.equal(payload.slice(0, limit).includes(credential.forbidden), true, 'fixture must place credential bytes across the cutoff');
      fs.writeFileSync(path.join(base, 'payload.txt'), payload);
      fs.writeFileSync(executable, `#!${process.execPath}\nconst fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[0] === '--version') { console.log('2.1.263'); process.exit(0); }
if (args[0] === '--help') { console.log('-p, --print\\n--output-format <format>\\n--append-system-prompt <prompt>\\n--resume <session>'); process.exit(0); }
if (args[0] === 'auth') { console.log('{"loggedIn":true}'); process.exit(0); }
const payload = fs.readFileSync(${JSON.stringify(path.join(base, 'payload.txt'))}, 'utf8');
const surface = ${JSON.stringify(surface)};
if (surface === 'stderr') process.stderr.write(payload);
else console.log(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, ...(surface === 'result' ? { result: payload } : { result: 'Partial work retained.', errors: [payload] }) }));
process.exitCode = 7;
`);
      fs.chmodSync(executable, 0o755);
      const rule = path.join(base, 'AGENTS.md');
      fs.writeFileSync(rule, 'Use synthetic inputs only.\n');
      const config = path.join(base, 'packet.yaml');
      fs.writeFileSync(config, YAML.stringify({
        schema_version: 1, executable, cwd: base,
        objective: 'Return bounded diagnostics.', context: 'Synthetic credential boundary fixture.',
        authority: 'No retry or provider changes.', return_to: 'origin-task',
        rules: [{ path: rule, role: 'target' }], resume: 'known-session',
      }));
      const run = spawnSync(process.execPath, [path.join(repo, 'src/cli.js'), 'claude-run', '--config', config], {
        cwd: base, encoding: 'utf8', timeout: 10000,
        // Only synthetic credential values enter this test process environment.
        env: { PATH: path.dirname(process.execPath), CLAUDE_TEST_API_KEY: knownSecret },
      });
      assert.ifError(run.error);
      assert.equal(run.status, 1);
      const result = JSON.parse(run.stdout);
      assert.equal(result.status, 'failed');
      assert.equal(result.execution.exit_code, 7);
      const returned = surface === 'result' ? result.result : result.errors.find((item) => item.startsWith(reason));
      assert.equal(typeof returned, 'string', 'retain useful provider diagnostic text');
      assert.ok(returned.startsWith(reason));
      assert.ok(returned.length <= limit, 'sanitized returned text remains bounded');
      assert.ok(!(run.stdout + run.stderr).includes(credential.forbidden), 'credential prefix must not leak when its complete value crosses the return cutoff');
      const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
      const executions = calls.filter((args) => args[0] === '-p');
      assert.equal(executions.length, 1, 'failure must not trigger retry');
      assert.equal(executions[0][executions[0].indexOf('--resume') + 1], 'known-session');
    });
  }
}
