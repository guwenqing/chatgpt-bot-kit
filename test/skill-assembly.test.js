import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import YAML from 'yaml';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'src/cli.js');
const catalog = ['bot-management', 'development', 'architecture-review', 'personal-facilitation', 'claude-handoff'];
function write(file, content) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); return file; }
function yaml(file, value) { return write(file, YAML.stringify(value)); }
function run(root, command, args = [], executable = cli) {
  const result = spawnSync(process.execPath, [executable, command, '--workspace', root, ...args], { encoding: 'utf8', timeout: 15000 });
  assert.ifError(result.error);
  return result;
}
function ok(result) { assert.equal(result.status, 0, result.stderr || result.stdout); return JSON.parse(result.stdout); }
function snapshot(root, relative = '') {
  const result = {};
  for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
    const rel = path.join(relative, name); const file = path.join(root, rel); const stat = fs.lstatSync(file);
    result[rel] = stat.isSymbolicLink() ? ['link', fs.readlinkSync(file)] : stat.isDirectory() ? ['directory'] : ['file', stat.mode & 0o777, fs.readFileSync(file).toString('base64')];
    if (stat.isDirectory()) Object.assign(result, snapshot(root, rel));
  }
  return result;
}
function fixture(t) {
  const parent = path.join(repo, 'local-data/skill-assembly-test'); fs.mkdirSync(parent, { recursive: true });
  const base = fs.mkdtempSync(path.join(parent, 'case-')); t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'workspace'); fs.mkdirSync(root); ok(run(root, 'prepare'));
  for (const id of ['personal', 'technical']) {
    const config = { schema_version: 1, id, name: id, purpose: `Help with ${id} work`, rules: ['Keep my choices.'], skills: [], sessions: [{ id: 'daily', role: 'daily help', default: true, startup_prompt: 'Help with this task.', model: 'my-model', effort: 'low' }] };
    ok(run(root, 'create-bot', ['--config', yaml(path.join(base, `${id}.yaml`), config)]));
  }
  const source = path.join(base, 'local-skill');
  write(path.join(source, 'SKILL.md'), '---\nname: selected-skill\ndescription: Summarize a selected note.\n---\nRead the user-selected note and write a three-line summary.\n');
  write(path.join(source, 'references/example.txt'), 'selected reference\n');
  write(path.join(source, 'scripts/example.sh'), '#!/bin/sh\nprintf "fixture only\\n"\n'); fs.chmodSync(path.join(source, 'scripts/example.sh'), 0o755);
  const selection = { schema_version: 1, id: 'selected-skill', source: { path: source }, mode: 'copy', scope: 'bot', bots: ['personal'] };
  return { base, root, source, selection };
}
function input(f, overrides = {}) { return yaml(path.join(f.base, 'selection.yaml'), { ...f.selection, ...overrides }); }
function install(f, overrides = {}, args = [], executable = cli) { return run(f.root, 'install-skill', ['--config', input(f, overrides), ...args], executable); }
function dest(f, bot = 'personal', id = 'selected-skill') { return path.join(f.root, 'bots', bot, '.agents/skills', id); }
function inspect(f, bot) {
  const observed = ok(run(f.root, 'inspect-skills', bot ? ['--bot', bot] : []));
  assert.equal(observed.status, 'inspected'); assert.deepEqual(observed.changed, []); assert.equal(typeof observed.revision, 'string');
  assert.ok(Array.isArray(observed.skills)); return observed;
}
function record(f, bot = 'personal', id = 'selected-skill') { const found = inspect(f, bot).skills.find((s) => s.bot === bot && s.id === id); assert.ok(found, `inspection must list ${bot}/${id}`); return found; }
function prepared(result) { const observed = ok(result); assert.equal(observed.status, 'prepared', 'installation must perform the requested selection'); assert.equal(typeof observed.revision, 'string'); assert.ok(Array.isArray(observed.skills)); return observed; }
function rejected(f, overrides, diagnostic = /source|skill|config|invalid|recipient|bot|collision|conflict|path|link|revision|writer|lock|changed|exist/i, args = []) {
  const config = input(f, overrides); const before = snapshot(f.root); const sourceBefore = snapshot(f.source);
  const result = run(f.root, 'install-skill', ['--config', config, ...args]);
  assert.notEqual(result.status, 0, 'invalid or conflicting installation must fail'); assert.match(result.stderr + result.stdout, diagnostic);
  assert.deepEqual(snapshot(f.root), before, 'rejected operation must preserve workspace bytes and links'); assert.deepEqual(snapshot(f.source), sourceBefore, 'source must remain unchanged');
}
function values(value) { return value && typeof value === 'object' ? Object.values(value).flatMap(values) : [value]; }
function git(cwd, args) { const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 15000 }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); }

for (const scope of ['bot', 'shared']) for (const mode of ['copy', 'link']) {
  test(`${scope} ${mode} installs only explicit recipients and preserves selected bytes, modes and sharing semantics`, (t) => {
    const f = fixture(t); const untouched = snapshot(path.join(f.root, 'bots/bot-father')); const beforeSource = snapshot(f.source);
    const result = prepared(install(f, { scope, mode, bots: ['personal', 'technical'] }));
    assert.deepEqual(result.skills.map((s) => s.bot).sort(), ['personal', 'technical']); assert.ok(result.changed.length > 0);
    const common = path.join(f.root, 'common/skills/selected-skill');
    for (const bot of ['personal', 'technical']) {
      const destination = dest(f, bot); assert.ok(fs.existsSync(path.join(destination, 'SKILL.md')));
      assert.deepEqual(snapshot(destination), beforeSource, 'ordinary selected file bytes and executable bits must survive installation');
      assert.equal(fs.lstatSync(destination).isSymbolicLink(), scope === 'shared' || mode === 'link');
      if (scope === 'shared') assert.equal(fs.realpathSync(destination), fs.realpathSync(common));
      const row = record(f, bot); assert.equal(row.destination, destination); assert.equal(row.management, 'managed'); assert.equal(row.mode, mode); assert.equal(row.scope, scope);
      assert.equal(row.files, 'present'); assert.equal(row.discovery, 'unverified'); assert.equal(row.exercised, 'unverified');
      assert.ok(values(row.source).includes(fs.realpathSync(f.source)), 'actual local source path must be inspectable');
    }
    assert.deepEqual(snapshot(path.join(f.root, 'bots/bot-father')), untouched);
    assert.deepEqual(snapshot(f.source), beforeSource);
    write(path.join(f.source, 'references/example.txt'), 'changed upstream\n');
    for (const bot of ['personal', 'technical']) assert.equal(fs.readFileSync(path.join(dest(f, bot), 'references/example.txt'), 'utf8'), mode === 'link' ? 'changed upstream\n' : 'selected reference\n');
    if (scope === 'shared' && mode === 'copy') {
      write(path.join(common, 'references/example.txt'), 'changed common snapshot\n');
      for (const bot of ['personal', 'technical']) assert.equal(fs.readFileSync(path.join(dest(f, bot), 'references/example.txt'), 'utf8'), 'changed common snapshot\n');
      assert.equal(fs.readFileSync(path.join(f.source, 'references/example.txt'), 'utf8'), 'changed upstream\n');
    }
  });
}

test('selection bookkeeping preserves user rules, session choices, direct guidance and earlier skills; retry is byte-stable', (t) => {
  const f = fixture(t); const config = path.join(f.root, 'bots/personal/bot.yaml'); const original = YAML.parse(fs.readFileSync(config, 'utf8'));
  const guidance = path.join(f.root, 'bots/personal/AGENTS.md'); fs.appendFileSync(guidance, '\nUser added guidance.\n'); const guideBefore = fs.readFileSync(guidance, 'utf8');
  prepared(install(f)); prepared(install(f, { id: 'second-skill', mode: 'link' }));
  const actual = YAML.parse(fs.readFileSync(config, 'utf8')); assert.deepEqual({ ...actual, skills: [] }, original);
  assert.equal(actual.skills.length, 2); assert.ok(actual.skills.some((s) => s.id === 'selected-skill')); assert.ok(actual.skills.some((s) => s.id === 'second-skill'));
  assert.equal(fs.readFileSync(guidance, 'utf8'), guideBefore);
  const before = snapshot(f.root); const retry = prepared(install(f)); assert.deepEqual(retry.changed, []); assert.deepEqual(snapshot(f.root), before);
  assert.equal(fs.existsSync(dest(f, 'technical')), false, 'unselected bot must not receive a skill');
});

test('actual Git-prepared source records committed identity separately from dirty selected bytes and omits sibling skills', (t) => {
  const f = fixture(t); const repository = path.join(f.base, 'skill-repository'); fs.mkdirSync(repository); git(repository, ['init', '-q']);
  const selected = path.join(repository, 'skills/chosen'); fs.cpSync(f.source, selected, { recursive: true }); write(path.join(repository, 'skills/other/SKILL.md'), 'Do not install this sibling.\n');
  git(repository, ['add', '.']); git(repository, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture source']);
  const head = git(repository, ['rev-parse', 'HEAD']); const checkout = path.join(f.base, 'prepared-checkout'); git(f.base, ['clone', '-q', repository, checkout]);
  const preparedSource = path.join(checkout, 'skills/chosen'); write(path.join(preparedSource, 'references/example.txt'), 'dirty selected bytes\n');
  prepared(install(f, { source: { path: preparedSource } })); const source = record(f).source;
  assert.ok(values(source).includes(head), 'actual selected Git HEAD must be inspectable'); assert.ok(values(source).includes('skills/chosen'), 'root-relative selected skill path must be inspectable');
  assert.ok(values(source).some((v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)), 'actual file fingerprint must accompany Git revision');
  assert.equal(fs.readFileSync(path.join(dest(f), 'references/example.txt'), 'utf8'), 'dirty selected bytes\n');
  assert.equal(fs.existsSync(path.join(dest(f), 'other')), false); assert.match(git(checkout, ['status', '--porcelain']), /references\/example.txt/);
  const before = snapshot(f.root); write(path.join(preparedSource, 'references/example.txt'), 'later upstream bytes\n');
  const changed = run(f.root, 'install-skill', ['--config', input(f, { source: { path: preparedSource } })]);
  assert.notEqual(changed.status, 0, 'a changed source must not silently replace the installed snapshot'); assert.deepEqual(snapshot(f.root), before);
});

for (const obstruction of ['unmanaged-copy', 'unmanaged-link', 'broken-link', 'file']) {
  test(`an existing ${obstruction} destination is preserved as a conflict`, (t) => {
    const f = fixture(t); const destination = dest(f); fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (obstruction === 'unmanaged-copy') fs.cpSync(f.source, destination, { recursive: true });
    else if (obstruction === 'unmanaged-link') fs.symlinkSync(f.source, destination);
    else if (obstruction === 'broken-link') fs.symlinkSync(path.join(f.base, 'absent'), destination);
    else write(destination, 'user file\n');
    rejected(f, {});
  });
}

test('edited managed copies are preserved, including edits at the shared copy', (t) => {
  const f = fixture(t); prepared(install(f)); write(path.join(dest(f), 'SKILL.md'), 'User replacement\n'); rejected(f, {});
  prepared(install(f, { id: 'shared-skill', scope: 'shared' })); write(path.join(f.root, 'common/skills/shared-skill/references/example.txt'), 'user shared edit\n'); rejected(f, { id: 'shared-skill', scope: 'shared' });
});

test('direct unmanaged copies, live links and broken links remain inspectable and unchanged', (t) => {
  const f = fixture(t); const directory = path.dirname(dest(f));
  fs.cpSync(f.source, path.join(directory, 'direct-copy'), { recursive: true }); fs.symlinkSync(f.source, path.join(directory, 'direct-link')); fs.symlinkSync(path.join(f.base, 'missing'), path.join(directory, 'direct-broken'));
  const before = snapshot(f.root); const observed = inspect(f, 'personal');
  for (const [id, state] of [['direct-copy', 'present'], ['direct-link', 'present'], ['direct-broken', 'broken']]) {
    const row = observed.skills.find((s) => s.id === id); assert.ok(row); assert.equal(row.management, 'unmanaged'); assert.equal(row.files, state); assert.equal(row.discovery, 'unverified'); assert.equal(row.exercised, 'unverified');
  }
  assert.deepEqual(snapshot(f.root), before); prepared(install(f));
  for (const [name, value] of Object.entries(before).filter(([name]) => name.includes('/direct-'))) assert.deepEqual(snapshot(f.root)[name], value);
});

test('inspection reports a missing managed copy and a broken managed live source without claiming discovery or exercise', (t) => {
  const f = fixture(t); prepared(install(f)); fs.rmSync(dest(f), { recursive: true });
  assert.equal(record(f).files, 'missing'); prepared(install(f)); assert.equal(record(f).files, 'present');
  prepared(install(f, { id: 'linked-skill', mode: 'link' })); fs.renameSync(f.source, `${f.source}-moved`);
  const broken = record(f, 'personal', 'linked-skill'); assert.equal(broken.files, 'broken'); assert.equal(broken.discovery, 'unverified'); assert.equal(broken.exercised, 'unverified');
});

for (const [label, overrides] of [
  ['duplicate recipients', { bots: ['personal', 'personal'] }], ['unknown recipient', { bots: ['personal', 'absent'] }], ['empty recipients', { bots: [] }],
  ['traversing id', { id: '../escape' }], ['absolute id', { id: '/escape' }], ['unknown mode', { mode: 'move' }], ['unknown scope', { scope: 'global' }], ['unsupported schema', { schema_version: 999 }],
]) test(`${label} is rejected before any write`, (t) => { const f = fixture(t); rejected(f, overrides); });

for (const invalid of ['missing', 'invalid-frontmatter']) test(`${invalid} SKILL.md is rejected before installation`, (t) => {
  const f = fixture(t); if (invalid === 'missing') fs.unlinkSync(path.join(f.source, 'SKILL.md')); else write(path.join(f.source, 'SKILL.md'), '---\nname: [broken\n---\nBody\n'); rejected(f, {});
});

test('malformed and duplicate-key installation YAML cannot change the workspace', (t) => {
  const f = fixture(t); for (const text of ['schema_version: [\n', `schema_version: 1\nid: selected-skill\nid: other\nsource:\n  path: ${f.source}\nmode: copy\nscope: bot\nbots: [personal]\n`]) {
    const file = write(path.join(f.base, 'bad.yaml'), text); const before = snapshot(f.root); const result = run(f.root, 'install-skill', ['--config', file]);
    assert.notEqual(result.status, 0); assert.match(result.stderr + result.stdout, /YAML|duplicate|parse|config|mapping|flow/i); assert.deepEqual(snapshot(f.root), before);
  }
});

test('a symlinked recipient skill parent cannot redirect managed writes outside the workspace', (t) => {
  const f = fixture(t); const outside = path.join(f.base, 'outside'); fs.mkdirSync(outside); write(path.join(outside, 'sentinel'), 'keep\n');
  fs.rmdirSync(path.dirname(dest(f))); fs.symlinkSync(outside, path.dirname(dest(f))); const outsideBefore = snapshot(outside); rejected(f, {}); assert.deepEqual(snapshot(outside), outsideBefore);
});

test('stale workspace revision and an active writer guard reject installation without losing newer state', (t) => {
  const f = fixture(t); const old = ok(run(f.root, 'inspect')).revision; const file = path.join(f.root, 'bots/personal/bot.yaml'); const config = YAML.parse(fs.readFileSync(file, 'utf8')); config.rules.push('New user rule'); yaml(file, config);
  rejected(f, {}, /revision|changed|conflict/i, ['--expected-revision', old]);
  write(path.join(f.root, '.bot-kit/write.lock'), 'another writer\n'); rejected(f, {}, /lock|writer|busy|conflict/i);
});

test('conflict at a later shared recipient leaves earlier recipients and shared source untouched', (t) => {
  const f = fixture(t); write(path.join(dest(f, 'technical'), 'SKILL.md'), 'User skill\n'); rejected(f, { scope: 'shared', bots: ['personal', 'technical'] });
});

test('an interrupted multi-recipient write reports progress and retries without duplicating selections', (t) => {
  const f = fixture(t); const config = input(f, { bots: ['personal', 'technical'] });
  const hook = write(path.join(f.base, 'interrupt.mjs'), `import fs from 'node:fs';
const rename = fs.renameSync;
fs.renameSync = function(from, to, ...args) {
  if (String(to) === ${JSON.stringify(path.join(f.root, 'bots/technical/bot.yaml'))}) throw new Error('controlled second-recipient write interruption');
  return rename.call(this, from, to, ...args);
};
`);
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, cli, 'install-skill', '--workspace', f.root, '--config', config], { encoding: 'utf8', timeout: 15000 });
  assert.ifError(result.error); assert.notEqual(result.status, 0, 'the injected write failure must be reported'); assert.match(result.stderr, /controlled second-recipient/);
  const error = JSON.parse(result.stderr); assert.ok(Array.isArray(error.completed), 'failure must identify completed writes'); assert.ok(error.completed.length > 0, 'the interruption must follow a completed earlier recipient write');
  assert.ok(Array.isArray(error.pending_files)); assert.ok(error.pending_files.some((file) => file.endsWith('technical/bot.yaml'))); assert.equal(fs.existsSync(path.join(f.root, '.bot-kit/write.lock')), false);
  prepared(install(f, { bots: ['personal', 'technical'] }));
  for (const bot of ['personal', 'technical']) {
    assert.equal(record(f, bot).files, 'present'); const selection = YAML.parse(fs.readFileSync(path.join(f.root, 'bots', bot, 'bot.yaml'), 'utf8')).skills;
    assert.equal(selection.filter((s) => s.id === 'selected-skill').length, 1);
  }
});

test('selectable starter assets survive npm pack and install from the extracted package', (t) => {
  const f = fixture(t); const packed = spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', f.base], { cwd: repo, encoding: 'utf8', timeout: 30000 });
  assert.equal(packed.status, 0, packed.stderr); const manifest = JSON.parse(packed.stdout)[0]; const unpack = path.join(f.base, 'unpacked'); fs.mkdirSync(unpack);
  const extracted = spawnSync('tar', ['-xzf', path.join(f.base, manifest.filename), '-C', unpack], { encoding: 'utf8' }); assert.equal(extracted.status, 0, extracted.stderr);
  const packageRoot = path.join(unpack, 'package'); const packagedCli = path.join(packageRoot, 'src/cli.js');
  assert.ok(fs.existsSync(packagedCli)); assert.equal(inspect(f).skills.length, 0, 'prepare must not install every role');
  for (const id of catalog) {
    const result = prepared(install(f, { id, source: { bundled: id } }, [], packagedCli));
    const text = fs.readFileSync(path.join(dest(f, 'personal', id), 'SKILL.md'), 'utf8'); const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text); assert.ok(frontmatter, `${id} needs ordinary skill frontmatter`);
    const metadata = YAML.parse(frontmatter[1]); assert.equal(metadata.name, id); assert.equal(typeof metadata.description, 'string'); assert.ok(metadata.description.trim().length > 10);
    const source = result.skills.find((s) => s.id === id).source; assert.ok(values(source).some((v) => typeof v === 'string' && v.startsWith(`${packageRoot}/`)), 'bundled selection must resolve inside extracted package');
  }
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'bots')).sort(), ['bot-father', 'personal', 'technical']);
});
