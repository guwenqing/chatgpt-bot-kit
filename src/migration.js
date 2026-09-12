import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { stringify } from 'yaml';
import { absolute, fail, hash, readText, stat, yaml } from './workspace.js';

function directory(value, field) {
  const root = absolute(value, field);
  if (!fs.statSync(root).isDirectory()) fail(`${field} must identify a directory.`);
  return root;
}
function entries(root, prefix = '') {
  const result = [];
  for (const name of fs.readdirSync(path.join(root, prefix)).sort()) {
    // Git pointers and object databases belong to their checkout, not to the
    // portable working files. Nested submodule working files remain included.
    if (name === '.git') continue;
    const relative = prefix ? `${prefix}/${name}` : name;
    const file = path.join(root, relative); const info = fs.lstatSync(file);
    const item = { path: relative, mode: info.mode & 0o777 };
    if (info.isSymbolicLink()) result.push({ ...item, type: 'symlink', target: fs.readlinkSync(file) });
    else if (info.isDirectory()) { result.push({ ...item, type: 'directory' }); result.push(...entries(root, relative)); }
    else if (info.isFile()) result.push({ ...item, type: 'file', sha256: hash(fs.readFileSync(file)) });
    else fail(`Cannot inventory special file ${file}; select ordinary working files before migration.`);
  }
  return result;
}
function gitState(root, caveats) {
  // An ordinary folder inside some other repository is still a non-Git source.
  if (!stat(path.join(root, '.git'))) return null;
  const query = (args, optional = false) => {
    const result = spawnSync('git', ['--no-optional-locks', '-C', root, ...args], { encoding: 'utf8', timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
    if (result.error || result.status !== 0) {
      if (optional && !result.error) return null;
      fail(`Cannot inspect Git state at ${root}: ${result.error?.message ?? result.stderr.trim()}`);
    }
    return result.stdout.trimEnd();
  };
  const head = query(['rev-parse', '--verify', 'HEAD'], true);
  const status = query(['status', '--porcelain=v1', '--untracked-files=all']);
  const worktrees = query(['worktree', 'list', '--porcelain']);
  const submodules = query(['submodule', 'status', '--recursive']);
  caveats.push('Git internals are excluded. Clone or restore the chosen checkout and verify its branch/HEAD separately; file equality does not prove portable Git history.');
  if (!fs.lstatSync(path.join(root, '.git')).isDirectory() || worktrees.split('\n').filter((line) => line.startsWith('worktree ')).length > 1) {
    caveats.push('Linked worktrees may point outside this directory. Recreate their Git association instead of copying a .git pointer.');
  }
  if (submodules) caveats.push('Submodule working files are included; recreate and verify submodule Git associations separately.');
  return { head, status, worktrees, submodules };
}
export function inventory(selectedSource, output) {
  const source = directory(selectedSource, '--source');
  let destination;
  if (output !== undefined) {
    destination = absolute(output, '--output');
    const actualOutput = path.join(fs.realpathSync(path.dirname(destination)), path.basename(destination));
    const relative = path.relative(fs.realpathSync(source), actualOutput);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) fail('Write the inventory outside its selected source so it cannot inventory itself.');
    if (stat(destination)) fail(`Inventory output already exists: ${destination}. Choose a new manifest path to preserve prior evidence.`);
  }
  const files = entries(source);
  const caveats = ['This records ordinary file bytes, permission bits and link targets, not ACLs, extended attributes, live process state or an atomic snapshot. All files under the selected root, including ignored files, are included; select a narrower source when necessary.'];
  if (files.some((item) => item.type === 'symlink')) caveats.push('Symlinks are recorded without traversal. Their targets may be missing, outside the source or nonportable after transfer.');
  const git = gitState(source, caveats);
  if (!isDeepStrictEqual(files, entries(source))) fail('Source changed during inventory. Stop conflicting work and create a fresh inventory.');
  const result = { schema_version: 1, source, entries: files, git, caveats };
  if (destination) fs.writeFileSync(destination, stringify(result), { flag: 'wx', mode: 0o600 });
  return result;
}
function validateManifest(value) {
  absolute(value.source, 'inventory.source');
  if (!Array.isArray(value.entries) || !Array.isArray(value.caveats) || !value.caveats.every((item) => typeof item === 'string') ||
      (value.git !== null && (typeof value.git !== 'object' || Array.isArray(value.git)))) fail('Invalid inventory: expected entries, caveats and Git observations or null.');
  const seen = new Set();
  for (const item of value.entries) {
    if (!item || typeof item.path !== 'string' || !item.path || path.isAbsolute(item.path) || item.path.includes('\\') || item.path.includes('\0') ||
        item.path.split('/').some((part) => !part || ['.', '..', '.git'].includes(part)) || seen.has(item.path)) fail('Invalid or duplicate inventory entry path.');
    seen.add(item.path);
    if (!['file', 'directory', 'symlink'].includes(item.type) || !Number.isInteger(item.mode) || item.mode < 0 || item.mode > 0o777 ||
        (item.type === 'file' && !/^[a-f0-9]{64}$/.test(item.sha256)) || (item.type === 'symlink' && typeof item.target !== 'string')) fail(`Invalid inventory entry: ${item.path}`);
  }
}
function compare(expected, actual, extras) {
  const found = new Map(actual.map((item) => [item.path, item])); const mismatches = [];
  for (const item of expected) {
    const current = found.get(item.path); found.delete(item.path);
    if (!current) mismatches.push({ path: item.path, reason: 'missing' });
    else for (const field of ['type', 'mode', 'sha256', 'target']) if (item[field] !== current[field]) mismatches.push({ path: item.path, reason: `${field} differs` });
  }
  if (extras) for (const file of found.keys()) mismatches.push({ path: file, reason: 'added after inventory' });
  return mismatches;
}
export function verifyMigration(inputFile, selectedDestination) {
  const file = absolute(inputFile, '--inventory'); const manifest = yaml(readText(file), file);
  validateManifest(manifest);
  const destination = directory(selectedDestination, '--destination');
  const mismatches = compare(manifest.entries, entries(destination), false);
  const caveats = [...manifest.caveats]; let sourceChanged = false;
  try {
    sourceChanged = compare(manifest.entries, entries(directory(manifest.source, 'inventory.source')), true).length > 0;
    if (manifest.git !== null && !isDeepStrictEqual(manifest.git, gitState(manifest.source, []))) sourceChanged = true;
  } catch (error) { sourceChanged = true; caveats.push(`Cannot recheck the source: ${error.message}`); }
  if (sourceChanged) caveats.push('Source changed or could not be rechecked after inventory; reconcile it and take a fresh inventory before claiming migration complete.');
  caveats.push('This assessment does not transfer conversation context or prove the receiving bot can continue. Check native entry and an actual continuation separately.');
  return { status: sourceChanged || mismatches.length ? 'incomplete' : 'verified', mismatches, source_changed: sourceChanged, caveats };
}
