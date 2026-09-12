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

for (const mode of ['copy', 'link']) test(`a managed selection installs successfully beside a user-owned local_skill ${mode}`, (t) => {
  const parent = path.join(repo, 'local-data/skill-assembly-test'); fs.mkdirSync(parent, { recursive: true });
  const base = fs.mkdtempSync(path.join(parent, 'existing-direct-')); t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'workspace'); fs.mkdirSync(root); ok(run(root, 'prepare'));
  const source = path.join(base, 'source'); fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'SKILL.md'), '---\nname: summarize-note\ndescription: Summarize a selected note in three lines.\n---\nRead the selected note and write its summary.\n');
  fs.writeFileSync(path.join(source, 'reference.txt'), 'User-selected reference.\n');
  const botRoot = path.join(root, 'bots/bot-father'); const skillRoot = path.join(botRoot, '.agents/skills'); const direct = path.join(skillRoot, 'local_skill');
  if (mode === 'copy') fs.cpSync(source, direct, { recursive: true }); else fs.symlinkSync(source, direct, 'dir');
  const directBefore = snapshot(skillRoot); const sourceBefore = snapshot(source); const configBefore = YAML.parse(fs.readFileSync(path.join(botRoot, 'bot.yaml'), 'utf8'));
  const config = path.join(base, 'selection.yaml'); fs.writeFileSync(config, YAML.stringify({ schema_version: 1, id: 'new-managed', source: { path: source }, mode: 'copy', scope: 'bot', bots: ['bot-father'] }));
  const attempted = run(root, 'install-skill', ['--config', config]);
  assert.ok(fs.existsSync(path.join(skillRoot, 'new-managed/SKILL.md')), 'the selected skill files must be present');
  assert.ok(YAML.parse(fs.readFileSync(path.join(botRoot, 'bot.yaml'), 'utf8')).skills.some((skill) => skill.id === 'new-managed'), 'the selection must be recorded in bot.yaml');
  const installed = ok(attempted); assert.equal(installed.status, 'prepared');
  const selected = installed.skills.find((skill) => skill.id === 'new-managed'); assert.ok(selected); assert.equal(selected.files, 'present'); assert.equal(selected.management, 'managed');
  const inspected = ok(run(root, 'inspect-skills', ['--bot', 'bot-father'])); assert.equal(inspected.status, 'inspected');
  for (const [id, management] of [['local_skill', 'unmanaged'], ['new-managed', 'managed']]) {
    const entry = inspected.skills.find((skill) => skill.id === id); assert.ok(entry, `${id} must remain inspectable`);
    assert.equal(entry.destination, path.join(skillRoot, id)); assert.equal(entry.management, management); assert.equal(entry.files, 'present');
    assert.equal(entry.discovery, 'unverified'); assert.equal(entry.exercised, 'unverified');
  }
  const after = snapshot(skillRoot); for (const [file, value] of Object.entries(directBefore)) assert.deepEqual(after[file], value, `user-owned entry ${file} must remain unchanged`);
  assert.deepEqual(snapshot(source), sourceBefore);
  const configAfter = YAML.parse(fs.readFileSync(path.join(botRoot, 'bot.yaml'), 'utf8'));
  assert.deepEqual({ ...configAfter, skills: [] }, configBefore); assert.equal(configAfter.skills.length, 1); assert.equal(configAfter.skills[0].id, 'new-managed');
});
