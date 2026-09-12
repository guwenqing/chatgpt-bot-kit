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
const begin = '<!-- bot-kit:begin -->';
const end = '<!-- bot-kit:end -->';
const botPath = 'bots/bot-father';
const workspaceConfig = '.bot-kit/workspace.yaml';
const botConfig = `${botPath}/bot.yaml`;
const registryConfig = `${botPath}/registry.yaml`;
const agentsPath = `${botPath}/AGENTS.md`;

function fixture(t) {
  const parent = path.join(repo, 'local-data');
  fs.mkdirSync(parent, { recursive: true });
  const base = fs.mkdtempSync(path.join(parent, 'workspace-test-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'selected workspace');
  fs.mkdirSync(root);
  return { base, root };
}

function run(root, command = 'prepare', args = [], entry = cli) {
  const result = spawnSync(process.execPath, [entry, command, '--workspace', root, ...args], {
    cwd: root, encoding: 'utf8', timeout: 15000,
  });
  assert.ifError(result.error);
  return result;
}

function ok(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function read(root, file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function write(root, file, content) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
}
function readYaml(root, file) { return YAML.parse(read(root, file)); }
function writeYaml(root, file, value) { write(root, file, YAML.stringify(value)); }

// Capture directories, symlink destinations and exact bytes, including user data.
function snapshot(root, prefix = '') {
  const records = {};
  for (const name of fs.readdirSync(path.join(root, prefix)).sort()) {
    const relative = path.join(prefix, name);
    const full = path.join(root, relative);
    const stat = fs.lstatSync(full);
    records[relative] = stat.isSymbolicLink() ? `link:${fs.readlinkSync(full)}`
      : stat.isDirectory() ? 'directory' : fs.readFileSync(full).toString('base64');
    if (stat.isDirectory()) Object.assign(records, snapshot(root, relative));
  }
  return records;
}

function seed(root) {
  writeYaml(root, workspaceConfig, { schema_version: 1, bot_father: botPath });
  writeYaml(root, botConfig, {
    schema_version: 1, id: 'bot-father', name: 'Bot Father', purpose: 'Help manage my bots.',
    rules: [], skills: [],
    sessions: [{ id: 'daily', role: 'daily', default: true, startup_prompt: 'Help with today.' }],
  });
  writeYaml(root, registryConfig, {
    schema_version: 1, bots: [{ id: 'bot-father', config: 'bot.yaml' }],
  });
}

function rejectUnchanged(root, command, diagnostic, args = []) {
  const before = snapshot(root);
  const result = run(root, command, args);
  assert.notEqual(result.status, 0, 'invalid/conflicting input must be rejected');
  assert.match(`${result.stderr}\n${result.stdout}`, diagnostic, 'error must identify the input or conflict');
  assert.deepEqual(snapshot(root), before, 'rejection must not change any workspace file or directory');
}

function region(text) {
  assert.equal(text.split(begin).length, 2, 'one managed region start');
  assert.equal(text.split(end).length, 2, 'one managed region end');
  const start = text.indexOf(begin);
  const stop = text.indexOf(end) + end.length;
  assert.ok(stop > start);
  return text.slice(start, stop);
}

test('initial preparation creates only Bot Father and reports files prepared without native readiness', (t) => {
  const { root } = fixture(t);
  write(root, 'user-notes.txt', 'Keep this user file.\n');
  const result = ok(run(root));
  // The actual candidate can execute successfully while this behavior is missing.
  assert.ok(fs.existsSync(path.join(root, workspaceConfig)), 'prepare must create workspace YAML');
  assert.equal(result.status, 'prepared');
  assert.equal(result.native_ready, false);
  assert.deepEqual(fs.readdirSync(path.join(root, 'bots')), ['bot-father']);
  for (const directory of ['common/skills', `${botPath}/.agents/skills`, `${botPath}/memory`, `${botPath}/work`]) {
    assert.ok(fs.statSync(path.join(root, directory)).isDirectory(), directory);
  }
  assert.equal(read(root, 'user-notes.txt'), 'Keep this user file.\n');
  const workspace = readYaml(root, workspaceConfig);
  const bot = readYaml(root, botConfig);
  const registry = readYaml(root, registryConfig);
  assert.equal(workspace.schema_version, 1);
  assert.equal(workspace.bot_father, botPath);
  assert.equal(bot.schema_version, 1);
  assert.equal(bot.id, 'bot-father');
  assert.equal(bot.name, 'Bot Father');
  assert.deepEqual(bot.skills, []);
  assert.deepEqual(bot.sessions.map(({ id, role, default: isDefault }) => ({ id, role, isDefault })),
    [{ id: 'daily', role: 'daily', isDefault: true }]);
  assert.equal(bot.sessions[0].model, undefined);
  assert.equal(bot.sessions[0].effort, undefined);
  assert.deepEqual(registry.bots.map(({ id, config }) => ({ id, config })), [{ id: 'bot-father', config: 'bot.yaml' }]);
  assert.equal(fs.readdirSync(path.join(root, 'common/skills')).length, 0);
  assert.equal(fs.readdirSync(path.join(root, `${botPath}/.agents/skills`)).length, 0);
  assert.doesNotMatch(JSON.stringify(snapshot(root)), /grooming\.yaml|schedule\.yaml/);
  const receipt = readYaml(root, `${botPath}/.bot-kit/generation.yaml`);
  assert.equal(receipt.schema_version, 1);
  assert.equal(receipt.managed_sha256, createHash('sha256').update(region(read(root, agentsPath))).digest('hex'));
});

test('repeat preparation is byte-stable and preserves user work, memory and target rules', (t) => {
  const { root } = fixture(t);
  ok(run(root));
  write(root, `${botPath}/memory/preferences.md`, 'Remember: use short answers.\n');
  write(root, `${botPath}/work/project/AGENTS.md`, '# Project instructions\nKeep local rules.\n');
  write(root, `${botPath}/work/project/unfinished.txt`, 'unfinished');
  const before = snapshot(root);
  ok(run(root));
  assert.deepEqual(snapshot(root), before);
});

test('partial preparation resumes deterministic identities without replacing existing YAML', (t) => {
  const { root } = fixture(t);
  seed(root);
  const bot = readYaml(root, botConfig);
  bot.rules = ['Keep my chosen preference.'];
  writeYaml(root, botConfig, bot);
  const original = read(root, botConfig);
  ok(run(root));
  assert.equal(read(root, botConfig), original);
  assert.match(read(root, agentsPath), /Keep my chosen preference\./);
  fs.unlinkSync(path.join(root, agentsPath));
  fs.rmdirSync(path.join(root, `${botPath}/work`));
  ok(run(root));
  assert.equal(read(root, botConfig), original);
  assert.ok(fs.statSync(path.join(root, `${botPath}/work`)).isDirectory());
  assert.deepEqual(readYaml(root, registryConfig).bots.map(({ id }) => id), ['bot-father']);
  assert.deepEqual(fs.readdirSync(path.join(root, 'bots')), ['bot-father']);
});

for (const [label, file, mutate, diagnostic] of [
  ['malformed YAML', workspaceConfig, () => 'schema_version: [\n', /workspace\.yaml|YAML/i],
  ['duplicate YAML keys', workspaceConfig, () => `schema_version: 1\nschema_version: 1\nbot_father: ${botPath}\n`, /workspace\.yaml|duplicate/i],
  ['unsupported workspace schema', workspaceConfig, (value) => ({ ...value, schema_version: 99 }), /schema_version|version/i],
  ['wrong rules type', botConfig, (value) => ({ ...value, rules: 'not an array' }), /rules/i],
  ['duplicate bot identity', registryConfig, (value) => ({ ...value, bots: [...value.bots, ...value.bots] }), /duplicate|bot-father|identity/i],
  ['conflicting Bot Father identity', botConfig, (value) => ({ ...value, id: 'someone-else' }), /bot-father|identity|\bid\b/i],
  ['duplicate session identity', botConfig, (value) => ({ ...value, sessions: [...value.sessions, ...value.sessions] }), /session|duplicate/i],
  ['two default sessions', botConfig, (value) => ({ ...value, sessions: [...value.sessions, { ...value.sessions[0], id: 'second' }] }), /default/i],
  ['managed path escape', workspaceConfig, (value) => ({ ...value, bot_father: '../outside' }), /path|outside|bot_father|conflict/i],
  ['marker injection in rules', botConfig, (value) => ({ ...value, rules: [begin] }), /marker|rule|managed/i],
]) {
  test(`${label} is rejected before any preparation writes`, (t) => {
    const { root } = fixture(t);
    seed(root);
    const value = mutate(readYaml(root, file));
    write(root, file, typeof value === 'string' ? value : YAML.stringify(value));
    rejectUnchanged(root, 'prepare', diagnostic);
  });
}

test('unmarked AGENTS content is preserved while composing YAML rules separately from session prompts', (t) => {
  const { root } = fixture(t);
  seed(root);
  const custom = '# My rules\n\nKeep these exact bytes.\n';
  write(root, agentsPath, custom);
  const bot = readYaml(root, botConfig);
  bot.rules = ['USER_BOT_WIDE_PREFERENCE'];
  bot.sessions[0].startup_prompt = 'PRIVATE_DAILY_ONLY_PROMPT';
  writeYaml(root, botConfig, bot);
  ok(run(root));
  const agents = read(root, agentsPath);
  assert.ok(agents.includes(custom));
  assert.match(region(agents), /USER_BOT_WIDE_PREFERENCE/);
  assert.doesNotMatch(agents, /PRIVATE_DAILY_ONLY_PROMPT/);
  assert.equal(readYaml(root, botConfig).sessions[0].startup_prompt, 'PRIVATE_DAILY_ONLY_PROMPT');
});

test('regeneration preserves both user regions and incorporates changed bot rules', (t) => {
  const { root } = fixture(t);
  ok(run(root));
  const original = read(root, agentsPath);
  const prefix = '# User preface\nKeep leading text.\n\n';
  const suffix = '\n# User afterword\nKeep trailing text.\n';
  write(root, agentsPath, prefix + original + suffix);
  const bot = readYaml(root, botConfig);
  bot.rules.push('NEW_USER_RULE_123');
  writeYaml(root, botConfig, bot);
  ok(run(root, 'regenerate'));
  const next = read(root, agentsPath);
  assert.ok(next.startsWith(prefix));
  assert.ok(next.endsWith(suffix));
  assert.match(region(next), /NEW_USER_RULE_123/);
  const stable = snapshot(root);
  ok(run(root, 'regenerate'));
  assert.deepEqual(snapshot(root), stable);
});

test('direct edits inside the managed region are preserved and reported as conflict', (t) => {
  const { root } = fixture(t);
  ok(run(root));
  write(root, agentsPath, read(root, agentsPath).replace(begin, `${begin}\nMy direct managed edit.`));
  rejectUnchanged(root, 'regenerate', /AGENTS\.md|managed|conflict/i);
  rejectUnchanged(root, 'prepare', /AGENTS\.md|managed|conflict/i);
});

test('ambiguous managed markers cannot be silently replaced', (t) => {
  const { root } = fixture(t);
  seed(root);
  write(root, agentsPath, `${begin}\nFirst\n${end}\n${begin}\nSecond\n${end}\n`);
  rejectUnchanged(root, 'prepare', /marker|managed|conflict|AGENTS\.md/i);
});

test('guidance covers shared roots, target rules, durable quiet memory and actual host limits', (t) => {
  const { root } = fixture(t);
  ok(run(root));
  const agents = read(root, agentsPath);
  assert.match(agents, /shared|share/i);
  assert.match(agents, /target|repository|project/i);
  assert.match(agents, /nested/i);
  assert.match(agents, /AGENTS\.md/);
  assert.match(agents, /memory\//);
  assert.match(agents, /remember/i);
  assert.match(agents, /broadcast/i);
  assert.match(agents, /running|instant/i);
  assert.match(agents, /permission/i);
  assert.match(agents, /sandbox|isolation/i);
  assert.match(agents, /external/i);
  assert.doesNotMatch(agents, /assuredloop|Astra|squash merge/i);
});

test('inspect is read-only and stale revision rejects newer configuration without overwriting it', (t) => {
  const { root } = fixture(t);
  ok(run(root));
  const before = snapshot(root);
  const observed = ok(run(root, 'inspect'));
  assert.equal(typeof observed.revision, 'string');
  assert.ok(observed.revision.length > 0);
  assert.equal(observed.native_ready, false);
  assert.deepEqual(snapshot(root), before);
  const bot = readYaml(root, botConfig);
  bot.rules.push('A concurrent conversation just added this.');
  writeYaml(root, botConfig, bot);
  rejectUnchanged(root, 'regenerate', /changed|revision|conflict/i, ['--expected-revision', observed.revision]);
  const current = ok(run(root, 'inspect'));
  assert.notEqual(current.revision, observed.revision);
  ok(run(root, 'regenerate', ['--expected-revision', current.revision]));
  assert.match(read(root, agentsPath), /A concurrent conversation just added this\./);
});

test('a competing writer guard is rejected and retained with recovery guidance', (t) => {
  const { root } = fixture(t);
  seed(root);
  write(root, '.bot-kit/write.lock', 'another active writer\n');
  rejectUnchanged(root, 'prepare', /lock|writer|busy|conflict/i);
  assert.match(`${run(root).stderr}\n${run(root).stdout}`, /retry|inspect|remove|recover|wait/i);
});

test('managed symlink escape is rejected without changing its target', (t) => {
  const { base, root } = fixture(t);
  const outside = path.join(base, 'outside');
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(root, 'bots'));
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'outside user data');
  fs.symlinkSync(outside, path.join(root, botPath), 'dir');
  const outsideBefore = snapshot(outside);
  rejectUnchanged(root, 'prepare', /symlink|outside|path|conflict/i);
  assert.deepEqual(snapshot(outside), outsideBefore);
});

test('packed local installation exposes bot-kit and resolves guidance away from the development checkout', (t) => {
  const { base, root } = fixture(t);
  const env = { ...process.env, npm_config_cache: path.join(base, 'npm-cache') };
  const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', base], {
    cwd: repo, env, encoding: 'utf8', timeout: 60000,
  });
  assert.ifError(packed.error);
  assert.equal(packed.status, 0, packed.stderr);
  const [manifest] = JSON.parse(packed.stdout);
  const install = path.join(base, 'clean-install');
  fs.mkdirSync(install);
  fs.writeFileSync(path.join(install, 'package.json'), '{"name":"bot-kit-clean-fixture","version":"1.0.0","private":true}\n');
  const installed = spawnSync('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', path.join(base, manifest.filename)], {
    cwd: install, env, encoding: 'utf8', timeout: 60000,
  });
  assert.ifError(installed.error);
  assert.equal(installed.status, 0, installed.stderr);
  const packageRoot = path.join(install, 'node_modules/chatgpt-bot-kit');
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(packageJson.dependencies.yaml, '2.9.0');
  assert.equal(packageJson.type, 'module');
  assert.equal(packageJson.bin['bot-kit'], 'src/cli.js');
  const entry = path.join(install, 'node_modules/.bin/bot-kit');
  assert.ok(fs.existsSync(entry));
  const result = ok(run(root, 'prepare', [], entry));
  assert.equal(result.status, 'prepared');
  assert.equal(result.native_ready, false);
  assert.match(read(root, agentsPath), /memory\//);
  assert.doesNotMatch(read(root, agentsPath), new RegExp(repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
