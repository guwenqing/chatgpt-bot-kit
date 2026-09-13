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
const help = '-p, --print Print result\n--output-format <format> Output format\n--append-system-prompt <prompt> Append instructions\n--model <model> Model\n--effort <level> Effort (choices: "low", "medium", "high", "xhigh", "max")\n--resume <session> Resume session';
const success = { type: 'result', subtype: 'success', is_error: false, result: 'Scoped result.', session_id: 'receipt-123' };

function fixture(t, behavior = {}, overrides = {}) {
  const parent = path.join(repo, 'local-data');
  fs.mkdirSync(parent, { recursive: true });
  const base = fs.mkdtempSync(path.join(parent, 'claude-test-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const cwd = path.join(base, 'selected cwd');
  fs.mkdirSync(cwd);
  const executable = path.join(base, 'selected claude.cjs');
  const log = path.join(base, 'calls.jsonl');
  const control = path.join(base, 'control.json');
  fs.writeFileSync(control, JSON.stringify({ help, auth: '{"loggedIn":true}', output: JSON.stringify(success), ...behavior }));
  fs.writeFileSync(executable, `#!${process.execPath}\nconst fs = require('node:fs');
const config = JSON.parse(fs.readFileSync(${JSON.stringify(control)}, 'utf8'));
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, cwd: process.cwd(), provider: process.env.ANTHROPIC_BASE_URL }) + '\\n');
if (args[0] === '--version') { console.log('2.1.263 (Claude Code)'); process.exit(config.versionExit || 0); }
if (args[0] === '--help') { console.log(config.help); process.exit(config.helpExit || 0); }
if (args[0] === 'auth') { process.stdout.write(config.auth); process.stderr.write(config.authStderr || ''); process.exit(config.authExit || 0); }
if (config.hang) { setInterval(() => {}, 1000); }
else if (config.flood) { process.stdout.write('x'.repeat(20 * 1024 * 1024)); }
else { process.stdout.write(config.output); process.stderr.write(config.stderr || ''); process.exitCode = config.exit || 0; }
`);
  fs.chmodSync(executable, 0o755);
  const bot = path.join(base, 'bot AGENTS.md');
  const target = path.join(cwd, 'AGENTS.md');
  fs.writeFileSync(bot, 'Bot guidance: return evidence to the assigned owner.\n');
  fs.writeFileSync(target, 'Target guidance: preserve unrelated files.\n');
  fs.mkdirSync(path.join(cwd, '.claude'));
  const preserved = [bot, target, path.join(cwd, 'CLAUDE.md'), path.join(cwd, '.claude/settings.json')];
  fs.writeFileSync(preserved[2], 'User-owned Claude instructions.\n');
  fs.writeFileSync(preserved[3], '{"permissions":{"allow":[]}}\n');
  const before = preserved.map((file) => fs.readFileSync(file, 'utf8'));
  const config = {
    schema_version: 1, executable, cwd,
    objective: 'Return a scoped answer.', context: 'Use only supplied synthetic inputs.',
    authority: 'Read-only; no network or publication.', return_to: 'origin-task',
    rules: [{ path: bot, role: 'bot' }, { path: target, role: 'target' }], ...overrides,
  };
  const configPath = path.join(base, 'handoff.yaml');
  const calls = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const actual = () => calls().filter((call) => !['--version', '--help', 'auth'].includes(call.args[0]));
  const run = (raw) => {
    fs.writeFileSync(configPath, raw ?? YAML.stringify(config));
    const result = spawnSync(process.execPath, [cli, 'claude-run', '--config', configPath], {
      encoding: 'utf8', cwd: base, timeout: 15000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, ANTHROPIC_BASE_URL: 'https://selected-provider.invalid' },
    });
    assert.ifError(result.error);
    return result;
  };
  return { base, cwd, config, executable, calls, actual, run, unchanged() {
    assert.deepEqual(preserved.map((file) => fs.readFileSync(file, 'utf8')), before);
  } };
}
function output(run, status) {
  assert.equal(run.status, status === 'completed' ? 0 : 1, run.stderr || run.stdout);
  let value;
  assert.doesNotThrow(() => { value = JSON.parse(run.stdout); }, `Expected bridge JSON, got stdout=${run.stdout} stderr=${run.stderr}`);
  assert.equal(value.status, status);
  assert.equal(value.return_to, 'origin-task');
  return value;
}
function valueAfter(args, flag) { return args[args.indexOf(flag) + 1]; }

// This independent executable smoke check distinguishes fixture faults from missing CLI behavior.
test('selected fake executable starts and records probes and an execution', (t) => {
  const f = fixture(t);
  for (const args of [['--version'], ['--help'], ['auth', 'status', '--json'], ['-p', 'fixture smoke']]) {
    const run = spawnSync(f.executable, args, { encoding: 'utf8', cwd: f.cwd });
    assert.ifError(run.error);
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.stdout.length);
  }
  assert.equal(f.calls().length, 4);
  assert.equal(f.actual().length, 1);
  assert.equal(f.actual()[0].cwd, f.cwd);
});

test('bounded success carries literal packet, exact settings and labeled hashed rules without replacing user configuration', (t) => {
  const f = fixture(t, {}, { model: 'caller-model-exact', effort: 'xhigh', resume: 'known-session-exact' });
  const marker = path.join(f.base, 'SHOULD_NOT_EXIST');
  f.config.objective = `literal $(touch '${marker}'); \`touch '${marker}'\` $HOME && echo no`;
  const result = output(f.run(), 'completed');
  assert.equal(result.result, success.result);
  assert.equal(result.session_id, success.session_id);
  assert.equal(result.execution.exit_code, 0);
  assert.equal(result.execution.timed_out, false);
  assert.match(result.execution.version, /2\.1\.263/);
  assert.equal(f.actual().length, 1);
  const { args, cwd, provider } = f.actual()[0];
  assert.equal(cwd, f.cwd);
  assert.equal(provider, 'https://selected-provider.invalid');
  for (const [flag, value] of [['--model', f.config.model], ['--effort', f.config.effort], ['--resume', f.config.resume], ['--output-format', 'json']]) {
    assert.equal(args.filter((arg) => arg === flag).length, 1);
    assert.equal(valueAfter(args, flag), value);
  }
  assert.ok(args.includes('-p'));
  const guidance = valueAfter(args, '--append-system-prompt');
  for (const rule of f.config.rules) {
    assert.ok(guidance.includes(fs.readFileSync(rule.path, 'utf8')));
    assert.match(guidance, new RegExp(rule.role, 'i'));
  }
  for (const key of ['objective', 'context', 'authority', 'return_to']) assert.ok(args.some((arg) => arg.includes(f.config[key])), `${key} must reach executable`);
  assert.equal(result.adaptation.method, 'append-system-prompt');
  const adaptation = JSON.stringify(result.adaptation);
  for (const rule of f.config.rules) {
    assert.ok(adaptation.includes(rule.path));
    assert.ok(adaptation.includes(createHash('sha256').update(fs.readFileSync(rule.path)).digest('hex')));
  }
  assert.deepEqual(f.calls().filter((call) => call.args[0] === 'auth').map((call) => call.args), [['auth', 'status', '--json']]);
  assert.equal(f.calls().filter((call) => call.args[0] === '--version').length, 1);
  assert.equal(f.calls().filter((call) => call.args[0] === '--help').length, 1);
  assert.ok(!args.some((arg) => /^(--bare|--safe-mode|--setting-sources|--dangerously-skip-permissions)(=|$)/.test(arg)));
  assert.equal(fs.existsSync(marker), false);
  f.unchanged();
});

test('omitted settings remain omitted without model, effort or resume defaults', (t) => {
  const f = fixture(t);
  output(f.run(), 'completed');
  assert.equal(f.actual().length, 1);
  for (const flag of ['--model', '--effort', '--resume']) assert.ok(!f.actual()[0].args.includes(flag));
});

test('missing selected executable is unavailable without execution', (t) => {
  const f = fixture(t);
  f.config.executable = path.join(f.base, 'missing-claude');
  const result = output(f.run(), 'unavailable');
  assert.ok(JSON.stringify(result.errors).length > 2);
  assert.equal(f.calls().length, 0);
});

for (const [label, behavior] of [
  ['logged out', { auth: '{"loggedIn":false,"token":"AUTH_SECRET_SENTINEL"}' }],
  ['malformed', { auth: 'AUTH_SECRET_SENTINEL', authStderr: 'AUTH_STDERR_SENTINEL' }],
  ['auth error', { auth: '{"loggedIn":true,"token":"AUTH_SECRET_SENTINEL"}', authExit: 1, authStderr: 'AUTH_STDERR_SENTINEL' }],
  ['missing explicit status', { auth: '{"token":"AUTH_SECRET_SENTINEL"}' }],
]) test(`authentication ${label} is unavailable and never leaks auth output or starts login`, (t) => {
  const f = fixture(t, behavior);
  const run = f.run();
  output(run, 'unavailable');
  assert.doesNotMatch(run.stdout + run.stderr, /AUTH_SECRET_SENTINEL|AUTH_STDERR_SENTINEL/);
  assert.equal(f.actual().length, 0);
  assert.ok(!f.calls().some((call) => call.args.includes('login')));
});

for (const flag of ['--append-system-prompt', '--output-format', '--model', '--effort', '--resume']) {
  test(`unsupported ${flag} is unavailable before actual execution`, (t) => {
    const f = fixture(t, { help: help.split('\n').filter((line) => !line.includes(flag)).join('\n') }, { model: 'exact-model', effort: 'high', resume: 'known-session' });
    output(f.run(), 'unavailable');
    assert.equal(f.actual().length, 0);
  });
}
test('effort not in observed help choices is rejected without substitution', (t) => {
  const f = fixture(t, {}, { effort: 'ultra' });
  output(f.run(), 'unavailable');
  assert.equal(f.actual().length, 0);
});

for (const [label, body, exit] of [
  ['error flag despite success subtype', { ...success, is_error: true }, 0],
  ['nonzero despite success fields', success, 7],
  ['missing error flag', { type: 'result', subtype: 'success', result: 'Partial work.' }, 0],
  ['nonboolean error flag', { ...success, is_error: 'false' }, 0],
  ['error subtype', { ...success, subtype: 'error_during_execution' }, 0],
  ['unknown type', { ...success, type: 'unknown' }, 0],
  ['missing result', { type: 'result', subtype: 'success', is_error: false }, 0],
  ['malformed result value', { ...success, result: { text: 'not supported' } }, 0],
]) test(`${label} fails and retains available partial text`, (t) => {
  const f = fixture(t, { output: JSON.stringify(body), exit });
  const result = output(f.run(), 'failed');
  assert.equal(result.execution.exit_code, exit);
  if (typeof body.result === 'string') assert.equal(result.result, body.result);
  assert.equal(f.actual().length, 1);
});
for (const raw of ['not JSON', '', 'null', '[]']) test(`invalid final output ${JSON.stringify(raw)} fails`, (t) => {
  const f = fixture(t, { output: raw });
  output(f.run(), 'failed');
  assert.equal(f.actual().length, 1);
});

test('failed continuation preserves provider rejection and never retries or changes settings', (t) => {
  const f = fixture(t, { output: JSON.stringify({ ...success, is_error: true, result: 'Resume rejected by selected provider.' }), exit: 1 }, { resume: 'known-session', model: 'selected-model', effort: 'max' });
  const result = output(f.run(), 'failed');
  assert.match(result.result, /Resume rejected/);
  assert.equal(f.actual().length, 1);
  assert.equal(valueAfter(f.actual()[0].args, '--resume'), 'known-session');
  assert.equal(valueAfter(f.actual()[0].args, '--model'), 'selected-model');
  assert.equal(valueAfter(f.actual()[0].args, '--effort'), 'max');
});
test('hung execution times out within a finite bound and remains failed', (t) => {
  const f = fixture(t, { hang: true }, { timeout_ms: 200 });
  const start = Date.now();
  const result = output(f.run(), 'failed');
  assert.equal(result.execution.timed_out, true);
  assert.ok(Date.now() - start < 10000);
  assert.equal(f.actual().length, 1);
});
test('excessive provider output is bounded and failed', (t) => {
  const f = fixture(t, { flood: true });
  const run = f.run();
  output(run, 'failed');
  assert.ok(run.stdout.length + run.stderr.length < 1024 * 1024);
  assert.equal(f.actual().length, 1);
});

for (const [label, alter] of [
  ['missing objective', (c) => { delete c.objective; }],
  ['empty context', (c) => { c.context = ''; }],
  ['missing authority', (c) => { delete c.authority; }],
  ['missing return destination', (c) => { delete c.return_to; }],
  ['relative cwd', (c) => { c.cwd = '.'; }],
  ['missing cwd', (c) => { c.cwd += '/absent'; }],
  ['relative executable', (c) => { c.executable = 'claude'; }],
  ['missing rules', (c) => { c.rules = []; }],
  ['invalid rule role', (c) => { c.rules[0].role = 'invented'; }],
  ['directory rule', (c) => { c.rules[0].path = c.cwd; }],
  ['unsupported schema', (c) => { c.schema_version = 2; }],
  ['arbitrary extra args', (c) => { c.extra_args = ['--dangerously-skip-permissions']; }],
  ['invalid timeout', (c) => { c.timeout_ms = 0; }],
]) test(`invalid packet: ${label} is rejected before any executor call`, (t) => {
  const f = fixture(t);
  alter(f.config);
  const run = f.run();
  assert.equal(run.status, 1);
  assert.doesNotMatch(run.stderr, /Choose a supported command/, 'must reach packet validation');
  assert.equal(f.calls().length, 0);
  f.unchanged();
});
test('duplicate YAML keys are rejected before any executor call', (t) => {
  const f = fixture(t);
  const run = f.run(`${YAML.stringify(f.config)}model: first\nmodel: second\n`);
  assert.equal(run.status, 1);
  assert.match(run.stdout + run.stderr, /duplicate|unique/i);
  assert.equal(f.calls().length, 0);
});
