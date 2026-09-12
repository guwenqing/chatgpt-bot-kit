import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parseDocument } from 'yaml';
import { absolute, apply, established, fail, hash, loadState, readText, rootPath, safePath, selected, stat, yaml } from './workspace.js';

const catalog = ['bot-management', 'development', 'architecture-review', 'personal-facilitation', 'claude-handoff'];
function identity(id) {
  if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(id)) fail('Skill id must contain letters/digits separated by hyphens.');
}
// Do not traverse links inside a selected skill or include repository internals.
function tree(directory) {
  const entries = [];
  function visit(relative) {
    for (const name of fs.readdirSync(path.join(directory, relative)).sort()) {
      if (name === '.git') continue;
      const item = path.join(relative, name); const full = path.join(directory, item); const info = fs.lstatSync(full);
      if (info.isSymbolicLink()) entries.push([item, 'link', fs.readlinkSync(full)]);
      else if (info.isDirectory()) { entries.push([item, 'directory']); visit(item); }
      else if (info.isFile()) entries.push([item, 'file', info.mode & 0o777, hash(fs.readFileSync(full))]);
      else fail(`Unsupported skill file type: ${full}`);
    }
  }
  visit(''); return hash(JSON.stringify(entries));
}
function observe(file) {
  const info = stat(file);
  if (!info) return null;
  const link = info.isSymbolicLink() ? fs.readlinkSync(file) : null;
  let resolved;
  try { resolved = fs.realpathSync(file); }
  catch (error) { if (['ENOENT', 'ELOOP', 'ENOTDIR'].includes(error.code)) return { link, broken: true }; throw error; }
  return fs.statSync(file).isDirectory() ? { link, resolved, sha256: tree(file) } : { link, resolved, invalid: true };
}
function git(source, args) {
  try { return execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim(); }
  catch { return null; }
}
function sourceInfo(selection) {
  const source = selection.source;
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      Object.keys(source).length !== 1 || !['path', 'bundled'].includes(Object.keys(source)[0])) fail('Skill source must select one path or bundled skill.');
  if (source.bundled !== undefined && !catalog.includes(source.bundled)) fail('Unknown bundled skill.');
  const file = source.bundled !== undefined ? fileURLToPath(new URL(`../skills/${source.bundled}/`, import.meta.url)) : absolute(source.path, 'source.path');
  const observed = observe(file);
  if (!observed?.sha256) fail(`Skill source must be an existing directory: ${file}`);
  const skill = path.join(file, 'SKILL.md');
  if (!stat(skill)?.isFile()) fail(`Skill source requires a regular SKILL.md: ${skill}`);
  const text = readText(skill); const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!frontmatter) fail(`Skill source requires YAML frontmatter: ${skill}`);
  const doc = parseDocument(frontmatter[1], { uniqueKeys: true, strict: true });
  if (doc.errors.length || doc.warnings.length) fail(`Invalid skill frontmatter: ${skill}`);
  const metadata = doc.toJS({ maxAliasCount: 100 });
  if (!metadata || !['name', 'description'].every((field) => typeof metadata[field] === 'string' && metadata[field].trim())) fail(`Skill name and description are required: ${skill}`);
  const root = git(observed.resolved, ['rev-parse', '--show-toplevel']);
  return { path: path.resolve(file), resolved_path: observed.resolved, sha256: observed.sha256,
    ...(source.bundled ? { bundled: source.bundled } : {}),
    ...(root ? { git: { root, revision: git(root, ['rev-parse', '--verify', 'HEAD']), skill_path: path.relative(root, observed.resolved), content_basis: 'working files; sha256 records actual selected bytes, not commit contents' } } : {}) };
}
function managed(bot) { return bot.value.skills.filter((item) => item && typeof item === 'object' && item.management === 'managed'); }
function destination(state, bot, id) {
  identity(id); const parent = `${bot.directory}/.agents/skills`;
  safePath(state.root, parent, 'directory'); return path.join(state.root, parent, id);
}
function observations(state, bots) {
  return bots.flatMap((bot) => {
    const parent = path.dirname(destination(state, bot, 'probe'));
    const records = managed(bot); const names = new Set([...records.map((item) => item.id), ...(stat(parent) ? fs.readdirSync(parent) : [])]);
    return [...names].sort().map((id) => {
      const file = destination(state, bot, id); const item = records.find((record) => record.id === id);
      let files = 'missing';
      if (stat(file)) {
        try { files = fs.statSync(file).isDirectory() && fs.statSync(path.join(file, 'SKILL.md')).isFile() ? 'present' : 'broken'; }
        catch (error) { if (['ENOENT', 'ELOOP', 'ENOTDIR'].includes(error.code)) files = 'broken'; else throw error; }
      }
      return { ...(item ?? {}), bot: bot.id, id, destination: file, management: item ? 'managed' : 'unmanaged', files, discovery: 'unverified', exercised: 'unverified' };
    });
  });
}
export function inspectSkills(selectedRoot, id) {
  const state = loadState(rootPath(selectedRoot)); established(state);
  return { status: 'inspected', revision: state.revision, changed: [], skills: observations(state, id ? [selected(state, id)] : [...state.bots.values()].filter((bot) => bot.value)) };
}
export function installSkill(selectedRoot, inputFile, expectedRevision) {
  const state = loadState(rootPath(selectedRoot)); established(state);
  const file = absolute(inputFile, '--config'); const text = readText(file); const value = yaml(text, file); identity(value.id);
  if (!['copy', 'link'].includes(value.mode) || !['bot', 'shared'].includes(value.scope)) fail('Skill mode must be copy/link and scope bot/shared.');
  if (!Array.isArray(value.bots) || !value.bots.length || new Set(value.bots).size !== value.bots.length) fail('Choose a nonempty list of distinct bot recipients.');
  const bots = value.bots.map((id) => selected(state, id)); const source = sourceInfo(value);
  const outputs = new Map(); const operations = []; const expected = new Map(); const directories = new Set();
  const records = [...state.bots.values()].filter((bot) => bot.value).flatMap(managed);
  const selection = { id: value.id, management: 'managed', source, mode: value.mode, scope: value.scope };
  function compatible(record) {
    return record.id === value.id && record.scope === value.scope && record.mode === value.mode && record.source?.path === source.path &&
      record.source.resolved_path === source.resolved_path && (value.mode === 'link' || record.source.sha256 === source.sha256);
  }
  function place(full, target, mode, owned) {
    const relative = path.relative(state.root, full); const parent = path.dirname(relative);
    safePath(state.root, parent, 'directory'); directories.add(parent);
    // Recursive copying into a source (or replacing the source itself) is never a valid installation.
    const resolvedDestination = path.join(fs.realpathSync(state.root), relative);
    const relation = path.relative(source.resolved_path, resolvedDestination);
    if (!relation || (!relation.startsWith(`..${path.sep}`) && relation !== '..' && !path.isAbsolute(relation))) fail(`Skill destination conflicts with its source: ${full}`);
    const before = observe(full); expected.set(full, before);
    if (before) {
      if (!owned || before.broken || before.invalid || (mode === 'copy' ? before.link !== null || before.sha256 !== source.sha256 : before.link === null || path.resolve(path.dirname(full), before.link) !== target)) fail(`Skill destination conflict: ${full}. Preserve existing content and choose an explicit reconciliation.`);
      return;
    }
    operations.push({ file: relative, run() {
      const temporary = `${full}.${randomUUID()}.tmp`;
      try {
        if (mode === 'link') fs.symlinkSync(target, temporary, 'dir');
        else fs.cpSync(source.resolved_path, temporary, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true, filter: (entry) => path.basename(entry) !== '.git' });
        if (mode === 'copy' && tree(temporary) !== source.sha256) fail('Skill source changed during copy; inspect it before retrying.');
        check();
        if (stat(full)) fail(`Skill destination changed: ${full}`);
        fs.renameSync(temporary, full); expected.set(full, observe(full));
      } finally { if (stat(temporary)) fs.rmSync(temporary, { recursive: true, force: true }); }
    } });
  }
  for (const bot of bots) {
    const sameName = bot.value.skills.filter((item) => item?.id?.toLowerCase() === value.id.toLowerCase());
    if (sameName.length > 1 || sameName.some((item) => item.management !== 'managed' || !compatible(item))) fail(`Skill selection conflict for ${bot.id}/${value.id}.`);
    const parent = path.dirname(destination(state, bot, value.id));
    if (stat(parent) && fs.readdirSync(parent).some((name) => name.toLowerCase() === value.id.toLowerCase() && name !== value.id)) fail(`Skill name conflicts with an existing destination in ${parent}.`);
    const existing = sameName[0];
    const next = existing && compatible(existing) ? existing : selection;
    if (!existing) {
      // Change only the skills node so comments and unrelated YAML choices survive.
      const doc = parseDocument(state.inputs.get(bot.file)); doc.set('skills', [...bot.value.skills, next]); outputs.set(bot.file, String(doc));
    }
  }
  if (value.scope === 'shared') {
    const common = path.join(state.root, 'common/skills', value.id); const owners = records.filter((record) => record.id?.toLowerCase() === value.id.toLowerCase() && record.scope === 'shared');
    const parent = safePath(state.root, 'common/skills', 'directory');
    if (stat(parent) && fs.readdirSync(parent).some((name) => name.toLowerCase() === value.id.toLowerCase() && name !== value.id)) fail(`Shared skill name conflicts with an existing destination in ${parent}.`);
    if (owners.some((record) => !compatible(record))) fail(`Shared skill selection conflict: ${value.id}`);
    place(common, source.resolved_path, value.mode, owners.length > 0);
    for (const bot of bots) place(destination(state, bot, value.id), common, 'link', managed(bot).some(compatible));
  } else for (const bot of bots) place(destination(state, bot, value.id), source.resolved_path, value.mode, managed(bot).some(compatible));
  function check() {
    const current = observe(source.path);
    if (!current || current.resolved !== source.resolved_path || current.sha256 !== source.sha256) fail('Skill source changed during installation. Inspect it before retrying.');
    for (const [destination, previous] of expected) {
      safePath(state.root, path.relative(state.root, path.dirname(destination)), 'directory');
      if (!isDeepStrictEqual(observe(destination), previous)) fail(`Skill destination changed during installation: ${destination}`);
    }
  }
  const changed = apply(state, outputs, [...directories], expectedRevision, { file, text }, { operations, check });
  const next = loadState(state.root);
  return { status: 'prepared', revision: next.revision, changed, skills: observations(next, bots.map((bot) => selected(next, bot.id))).filter((skill) => skill.id === value.id) };
}
