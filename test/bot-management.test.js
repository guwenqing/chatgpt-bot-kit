import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import YAML from 'yaml';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'src/cli.js');
const father = 'bots/bot-father';

function fixture(t) {
  const parent = path.join(repo, 'local-data/bot-management-tests');
  fs.mkdirSync(parent, { recursive: true });
  const base = fs.mkdtempSync(path.join(parent, 'management-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'workspace');
  fs.mkdirSync(root);
  ok(run(root, 'prepare'));
  return { base, root };
}
function run(root, command, args = []) {
  const result = spawnSync(process.execPath, [cli, command, '--workspace', root, ...args], { encoding: 'utf8', timeout: 15000 });
  assert.ifError(result.error);
  return result;
}
function ok(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
function write(root, file, text) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
}
function yaml(root, file, value) { write(root, file, YAML.stringify(value)); return path.join(root, file); }
function read(root, file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function snapshot(root, prefix = '') {
  const records = {};
  for (const name of fs.readdirSync(path.join(root, prefix)).sort()) {
    const relative = path.join(prefix, name);
    const file = path.join(root, relative);
    const stat = fs.lstatSync(file);
    records[relative] = stat.isSymbolicLink() ? `link:${fs.readlinkSync(file)}`
      : stat.isDirectory() ? 'directory' : fs.readFileSync(file).toString('base64');
    if (stat.isDirectory()) Object.assign(records, snapshot(root, relative));
  }
  return records;
}
function config(id = 'personal') {
  return { schema_version: 1, id, name: id === 'personal' ? 'Personal helper' : 'Technical helper',
    purpose: id === 'personal' ? 'Organize my errands and to-dos.' : 'Continue selected software work.',
    rules: ['Give a useful editable result.'], skills: [], sessions: [
      { id: 'daily', role: 'daily help', default: true, startup_prompt: 'Help with my day.', model: 'user-chosen-model', effort: 'low' },
      { id: 'review', role: 'review a plan', default: false, startup_prompt: 'Review this plan carefully.', model: 'another-user-model', effort: 'high' },
    ] };
}
// Seed documented YAML directly: later RED cases do not depend on create-bot working.
function seed(root, value = config()) {
  yaml(root, `bots/${value.id}/bot.yaml`, value);
  write(root, `bots/${value.id}/AGENTS.md`, '# User guidance\nKeep this exact text.\n');
  yaml(root, `${father}/registry.yaml`, { schema_version: 1, bots: [
    { id: 'bot-father', config: 'bot.yaml' }, { id: value.id, config: `../${value.id}/bot.yaml` },
  ] });
}
function row(root, id = 'personal') {
  const result = ok(run(root, 'inspect'));
  assert.ok(Array.isArray(result.directory), 'inspect must expose the managed directory');
  const found = result.directory.find((bot) => bot.id === id);
  assert.ok(found, `directory must contain ${id}`);
  return found;
}
function rejectUnchanged(root, command, args, diagnostic) {
  const before = snapshot(root);
  const result = run(root, command, args);
  assert.notEqual(result.status, 0, 'invalid or conflicting operation must be rejected');
  assert.match(result.stderr + result.stdout, diagnostic);
  assert.deepEqual(snapshot(root), before, 'rejection must preserve all workspace bytes');
}
function observation(root, state = 'observed') {
  const botRoot = path.join(root, 'bots/personal');
  return { schema_version: 1, bot: 'personal', observed_at: '2026-09-12T20:00:00.000Z',
    source: { surface: 'codex-desktop-test', method: 'synthetic acceptance fixture, not live evidence' }, state,
    project: { surface: 'codex-desktop-test', id: 'project-1', root: botRoot },
    sessions: [{ id: 'daily', native: { surface: 'codex-desktop-test', id: 'thread-1', root: botRoot },
      model: 'user-chosen-model', effort: 'low', settings_status: 'matched' }],
    evidence: ['Synthetic response only; actual desktop readiness was not exercised.'] };
}

test('creation prepares multiple lasting bots, shared session roots and a useful authoritative directory', (t) => {
  const { base, root } = fixture(t);
  for (const id of ['personal', 'technical']) {
    const value = config(id);
    const input = yaml(base, `${id}.yaml`, value);
    const result = ok(run(root, 'create-bot', ['--config', input]));
    assert.ok(fs.existsSync(path.join(root, `bots/${id}/bot.yaml`)), 'successful creation must persist the bot configuration');
    assert.equal(result.native_ready, false);
    assert.deepEqual(YAML.parse(read(root, `bots/${id}/bot.yaml`)), value);
    for (const directory of ['memory', 'work', '.agents/skills']) assert.ok(fs.statSync(path.join(root, `bots/${id}/${directory}`)).isDirectory());
    const entry = row(root, id);
    assert.equal(entry.root, path.join(root, `bots/${id}`));
    assert.equal(entry.purpose, value.purpose);
    assert.deepEqual(entry.rules, value.rules);
    assert.deepEqual(entry.skills, []);
    assert.deepEqual(entry.sessions, value.sessions);
    assert.equal(entry.default_session, 'daily');
    assert.ok(entry.config.endsWith('/bot.yaml'));
    assert.equal(fs.readdirSync(path.join(root, `bots/${id}/work`)).length, 0, 'session settings must not create clones/worktrees');
    const before = snapshot(root);
    ok(run(root, 'create-bot', ['--config', input]));
    assert.deepEqual(snapshot(root), before, 'identical repeated creation must be byte-stable');
  }
  assert.deepEqual(fs.readdirSync(path.join(root, 'bots')).sort(), ['bot-father', 'personal', 'technical']);
});

test('configuration changes preserve user guidance, memory and target work without imposing developer model policy', (t) => {
  const { base, root } = fixture(t);
  seed(root);
  const user = read(root, 'bots/personal/AGENTS.md');
  write(root, 'bots/personal/memory/decisions.md', 'Remember my existing decisions.\n');
  write(root, 'bots/personal/work/project/AGENTS.md', '# Target rules\nUse target conventions.\n');
  write(root, 'bots/personal/work/project/unfinished.txt', 'unfinished work');
  const value = config();
  value.purpose = 'Organize trips as well as errands.';
  value.rules.push('Use concise checklists.');
  value.sessions[1].default = true;
  value.sessions[0].default = false;
  const input = yaml(base, 'changed.yaml', value);
  ok(run(root, 'configure-bot', ['--config', input]));
  assert.deepEqual(YAML.parse(read(root, 'bots/personal/bot.yaml')), value, 'configuration must apply the user-selected purpose and session settings');
  assert.ok(read(root, 'bots/personal/AGENTS.md').includes(user));
  assert.match(read(root, 'bots/personal/AGENTS.md'), /Use concise checklists\./);
  assert.equal(read(root, 'bots/personal/memory/decisions.md'), 'Remember my existing decisions.\n');
  assert.equal(read(root, 'bots/personal/work/project/AGENTS.md'), '# Target rules\nUse target conventions.\n');
  assert.equal(read(root, 'bots/personal/work/project/unfinished.txt'), 'unfinished work');
  assert.equal(row(root).default_session, 'review');
});

test('bot-specific regeneration preserves outside edits and rejects changed managed guidance before configuring', (t) => {
  const { base, root } = fixture(t);
  seed(root);
  const fatherBefore = read(root, `${father}/AGENTS.md`);
  ok(run(root, 'regenerate', ['--bot', 'personal']));
  const generated = read(root, 'bots/personal/AGENTS.md');
  assert.match(generated, /<!-- bot-kit:begin -->/, 'selected bot must receive composed guidance');
  write(root, 'bots/personal/AGENTS.md', generated.replace('<!-- bot-kit:begin -->', '<!-- bot-kit:begin -->\nDirect user managed edit.'));
  const changed = config(); changed.rules.push('New requested rule.');
  const input = yaml(base, 'change.yaml', changed);
  rejectUnchanged(root, 'configure-bot', ['--config', input], /managed|guidance|conflict|changed/i);
  assert.equal(read(root, `${father}/AGENTS.md`), fatherBefore);
});

for (const [name, mutate, command] of [
  ['unsafe bot identity', (v) => { v.id = '../escape'; }, 'create-bot'],
  ['reserved managing identity', (v) => { v.id = 'bot-father'; }, 'create-bot'],
  ['duplicate sessions', (v) => { v.sessions.push({ ...v.sessions[0] }); }, 'configure-bot'],
  ['conflicting defaults', (v) => { v.sessions[1].default = true; }, 'configure-bot'],
  ['unsupported schema', (v) => { v.schema_version = 99; }, 'configure-bot'],
  ['different existing creation', (v) => { v.purpose = 'Replace without consent.'; }, 'create-bot'],
  ['unknown configuration identity', (v) => { v.id = 'unknown'; }, 'configure-bot'],
]) test(`${name} is rejected without writes`, (t) => {
  const { base, root } = fixture(t); seed(root);
  const value = config(); mutate(value);
  const input = yaml(base, 'invalid.yaml', value);
  rejectUnchanged(root, command, ['--config', input], /identity|session|default|schema|exist|conflict|id|bot-father/i);
});

test('a changed managed bot invalidates the workspace revision before configuration or receipt writes', (t) => {
  const { base, root } = fixture(t); seed(root);
  const revision = ok(run(root, 'inspect')).revision;
  const changed = config(); changed.purpose = 'Newer user change.';
  yaml(root, 'bots/personal/bot.yaml', changed);
  const input = yaml(base, 'requested.yaml', config());
  rejectUnchanged(root, 'configure-bot', ['--config', input, '--expected-revision', revision], /revision|changed|conflict/i);
  const receipt = yaml(base, 'receipt.yaml', observation(root));
  rejectUnchanged(root, 'record-native', ['--bot', 'personal', '--receipt', receipt, '--expected-revision', revision], /revision|changed|conflict/i);
});

test('directory refresh reads current purpose and reports stale membership without creating replacement bots', (t) => {
  const { root } = fixture(t); seed(root);
  const value = config(); value.purpose = 'Fresh direct user purpose.';
  yaml(root, 'bots/personal/bot.yaml', value);
  yaml(root, `${father}/registry.yaml`, { schema_version: 1, bots: [
    { id: 'bot-father', config: 'bot.yaml' }, { id: 'personal', config: '../personal/bot.yaml' }, { id: 'missing', config: '../missing/bot.yaml' },
  ] });
  const before = snapshot(root);
  assert.equal(row(root).purpose, value.purpose);
  assert.match(row(root, 'missing').state, /missing|stale|unavailable/);
  assert.deepEqual(snapshot(root), before, 'inspection must not repair stale membership by creation');
});

test('recorded desktop observation retains surface identity but cannot authenticate native readiness', (t) => {
  const { base, root } = fixture(t); seed(root);
  const receipt = observation(root);
  const file = yaml(base, 'receipt.yaml', receipt);
  const result = ok(run(root, 'record-native', ['--bot', 'personal', '--receipt', file]));
  assert.ok(fs.existsSync(path.join(root, 'bots/personal/.bot-kit/native.yaml')), 'successful recording must persist the observation');
  assert.equal(result.native_ready, false);
  assert.deepEqual(YAML.parse(read(root, 'bots/personal/.bot-kit/native.yaml')), receipt);
  const inspected = ok(run(root, 'inspect'));
  assert.equal(inspected.native_ready, false, 'a receipt is not live desktop proof');
  assert.deepEqual(row(root).observation, receipt);
  assert.deepEqual(YAML.parse(read(root, 'bots/personal/bot.yaml')), config(), 'observations cannot overwrite user intent');
  receipt.state = 'stale';
  yaml(base, 'receipt.yaml', receipt);
  ok(run(root, 'record-native', ['--bot', 'personal', '--receipt', file]));
  assert.equal(row(root).observation.state, 'stale');
});

for (const state of ['backend-only', 'unavailable', 'ambiguous']) test(`${state} native result remains incomplete and preserves prepared work`, (t) => {
  const { base, root } = fixture(t); seed(root);
  const receipt = observation(root, state);
  receipt.sessions = []; delete receipt.project;
  const file = yaml(base, 'receipt.yaml', receipt);
  ok(run(root, 'record-native', ['--bot', 'personal', '--receipt', file]));
  assert.equal(row(root).observation.state, state);
  assert.equal(ok(run(root, 'inspect')).native_ready, false);
  assert.deepEqual(YAML.parse(read(root, 'bots/personal/bot.yaml')), config());
});

for (const [name, mutate] of [
  ['cross-surface project identity', (v) => { v.project.surface = 'app-server'; }],
  ['cross-surface conversation identity', (v) => { v.sessions[0].native.surface = 'app-server'; }],
  ['wrong observed root', (v) => { v.sessions[0].native.root += '-other'; }],
  ['unknown session', (v) => { v.sessions[0].id = 'unknown'; }],
  ['duplicate native identity', (v) => { v.sessions.push({ ...v.sessions[0], id: 'review', model: 'another-user-model', effort: 'high' }); }],
  ['contradictory matched model', (v) => { v.sessions[0].model = 'silently-substituted-model'; }],
  ['contradictory matched effort', (v) => { v.sessions[0].effort = 'max'; }],
  ['unidentified observation source', (v) => { delete v.source.surface; }],
]) test(`${name} is rejected without accepting an arbitrary native match`, (t) => {
  const { base, root } = fixture(t); seed(root);
  const receipt = observation(root); mutate(receipt);
  const file = yaml(base, 'receipt.yaml', receipt);
  rejectUnchanged(root, 'record-native', ['--bot', 'personal', '--receipt', file], /surface|root|session|identity|duplicate|model|effort|setting|source/i);
});

test('unsupported native settings are visible while requested model and effort remain unchanged', (t) => {
  const { base, root } = fixture(t); seed(root);
  const receipt = observation(root);
  receipt.sessions[0].model = 'observed-other-model';
  receipt.sessions[0].effort = 'medium';
  receipt.sessions[0].settings_status = 'unsupported';
  const file = yaml(base, 'receipt.yaml', receipt);
  ok(run(root, 'record-native', ['--bot', 'personal', '--receipt', file]));
  assert.equal(row(root).observation.sessions[0].settings_status, 'unsupported');
  assert.equal(row(root).sessions[0].model, 'user-chosen-model');
  assert.equal(row(root).sessions[0].effort, 'low');
  assert.equal(ok(run(root, 'inspect')).native_ready, false);
});

test('malformed YAML configuration is rejected with no managed writes', (t) => {
  const { base, root } = fixture(t); seed(root);
  write(base, 'bad.yaml', 'schema_version: 1\nid: personal\nsessions: [broken\n');
  rejectUnchanged(root, 'configure-bot', ['--config', path.join(base, 'bad.yaml')], /yaml|parse|sessions/i);
});

test('registry identity/config disagreement is reported instead of selecting the wrong bot', (t) => {
  const { root } = fixture(t); seed(root);
  const value = config('technical'); yaml(root, 'bots/personal/bot.yaml', value);
  const before = snapshot(root);
  const result = run(root, 'inspect');
  if (result.status === 0) {
    const data = JSON.parse(result.stdout);
    assert.ok(Array.isArray(data.directory), 'directory must expose the conflicting identity');
    const entry = data.directory.find((bot) => bot.id === 'personal');
    assert.ok(entry, 'retain the original membership identity');
    assert.match(entry.state, /conflict|ambiguous|mismatch/);
  } else assert.match(result.stderr, /identity|conflict|mismatch/i);
  assert.deepEqual(snapshot(root), before);
});

test('a changed recorded observation invalidates the revision before another record replaces it', (t) => {
  const { base, root } = fixture(t); seed(root);
  const receipt = observation(root);
  yaml(root, 'bots/personal/.bot-kit/native.yaml', receipt);
  const revision = ok(run(root, 'inspect')).revision;
  receipt.state = 'stale'; yaml(root, 'bots/personal/.bot-kit/native.yaml', receipt);
  const file = yaml(base, 'request.yaml', observation(root));
  rejectUnchanged(root, 'record-native', ['--bot', 'personal', '--receipt', file, '--expected-revision', revision], /revision|changed|conflict/i);
});
