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
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
function snapshot(root, relative = '') {
  const result = {};
  for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
    const rel = path.join(relative, name); const file = path.join(root, rel); const stat = fs.lstatSync(file);
    result[rel] = stat.isSymbolicLink() ? ['link', fs.readlinkSync(file)] : stat.isDirectory() ? ['directory'] : ['file', stat.mode & 0o777, fs.readFileSync(file).toString('base64')];
    if (stat.isDirectory()) Object.assign(result, snapshot(root, rel));
  }
  return result;
}

// Direct installations are user-owned filesystem entries, outside the Kit's
// managed identifier convention. These tests claim file inspection, not native discovery.
for (const mode of ['copy', 'link']) test(`inspection preserves an unmanaged ${mode} named outside Kit ID syntax and still lists other skills`, (t) => {
  const parent = path.join(repo, 'local-data/skill-assembly-test'); fs.mkdirSync(parent, { recursive: true });
  const base = fs.mkdtempSync(path.join(parent, 'discovery-')); t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'workspace'); fs.mkdirSync(root); run(root, 'prepare');
  const source = path.join(base, 'source'); fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'SKILL.md'), '---\nname: summarize-note\ndescription: Summarize a user-selected note in three lines.\n---\nRead the selected note and write a three-line summary.\n');
  fs.writeFileSync(path.join(source, 'example.txt'), 'User-provided reference.\n');
  const config = path.join(base, 'selection.yaml'); fs.writeFileSync(config, YAML.stringify({ schema_version: 1, id: 'managed-skill', source: { path: source }, mode: 'copy', scope: 'bot', bots: ['bot-father'] }));
  const installed = run(root, 'install-skill', ['--config', config]); assert.equal(installed.status, 'prepared');
  const skillRoot = path.join(root, 'bots/bot-father/.agents/skills');
  const direct = path.join(skillRoot, 'local_skill');
  if (mode === 'copy') fs.cpSync(source, direct, { recursive: true }); else fs.symlinkSync(source, direct, 'dir');
  fs.cpSync(source, path.join(skillRoot, 'ordinary-direct'), { recursive: true });
  const before = snapshot(root); const sourceBefore = snapshot(source);
  for (const args of [[], ['--bot', 'bot-father']]) {
    const inspected = run(root, 'inspect-skills', args); assert.equal(inspected.status, 'inspected'); assert.deepEqual(inspected.changed, []);
    for (const [id, management] of [['local_skill', 'unmanaged'], ['ordinary-direct', 'unmanaged'], ['managed-skill', 'managed']]) {
      const entry = inspected.skills.find((skill) => skill.bot === 'bot-father' && skill.id === id);
      assert.ok(entry, `inspection must retain ${id} alongside other installed skills`);
      assert.equal(entry.destination, path.join(skillRoot, id)); assert.equal(entry.management, management); assert.equal(entry.files, 'present');
      assert.equal(entry.discovery, 'unverified'); assert.equal(entry.exercised, 'unverified');
    }
    assert.deepEqual(snapshot(root), before, 'inspection must preserve user paths, links and all workspace bytes');
    assert.deepEqual(snapshot(source), sourceBefore, 'inspection must preserve linked source content');
  }
});
