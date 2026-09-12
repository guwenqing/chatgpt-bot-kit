import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parseDocument, stringify } from 'yaml';

const begin = '<!-- bot-kit:begin -->';
const end = '<!-- bot-kit:end -->';
const workspaceFile = '.bot-kit/workspace.yaml';
const lockFile = '.bot-kit/write.lock';
const defaults = {
  schema_version: 1,
  id: 'bot-father',
  name: 'Bot Father',
  purpose: 'Help the user create, manage and coordinate their bots.',
  rules: [],
  skills: [],
  sessions: [{ id: 'daily', role: 'daily', default: true, startup_prompt: 'Help me with my bots and today’s work.' }],
};

function fail(message) { throw new Error(message); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function stat(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// The selected root may itself use the user's normal path alias. Kit-owned
// descendants must not redirect writes through a symlink.
function safePath(root, relative, type) {
  let file = root;
  const parts = relative.split('/');
  for (const [index, part] of parts.entries()) {
    file = path.join(file, part);
    const current = stat(file);
    if (!current) continue;
    if (current.isSymbolicLink()) fail(`Path conflict: ${file} is a symlink. Choose a regular managed destination.`);
    const directory = index < parts.length - 1 || type === 'directory';
    if (directory ? !current.isDirectory() : !current.isFile()) {
      fail(`Path conflict: ${file} must be a ${directory ? 'directory' : 'regular file'}.`);
    }
  }
  return file;
}

function relativePath(value, field) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') ||
      path.isAbsolute(value) || value.split('/').some((part) => !part || part === '..' || part === '.')) {
    fail(`${field}: use a relative path inside the workspace without . or .. components.`);
  }
  return value;
}

function read(root, relative) {
  const file = safePath(root, relative, 'file');
  if (!stat(file)) return null;
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(file)); }
  catch (error) {
    if (error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') fail(`${relative}: expected UTF-8 text; existing bytes were preserved.`);
    throw error;
  }
}

function yaml(text, file) {
  const document = parseDocument(text, { uniqueKeys: true, strict: true });
  if (document.errors.length || document.warnings.length) {
    fail(`${file}: invalid YAML: ${[...document.errors, ...document.warnings].map((item) => item.message).join('; ')}`);
  }
  let value;
  try { value = document.toJS({ maxAliasCount: 100 }); }
  catch (error) { fail(`${file}: invalid YAML: ${error.message}`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${file}: expected a YAML mapping.`);
  if (value.schema_version !== 1) fail(`${file}: unsupported schema_version; expected 1.`);
  return value;
}

function string(value, field, markers = false) {
  if (typeof value !== 'string' || !value.trim()) fail(`${field}: expected nonempty text.`);
  if (markers && (value.includes(begin) || value.includes(end))) fail(`${field}: managed marker tokens cannot appear in guidance.`);
}

function validateBot(bot, file) {
  if (bot.id !== 'bot-father') fail(`${file}: conflicting identity; this workspace's managing bot must have id bot-father.`);
  string(bot.name, `${file}.name`, true);
  string(bot.purpose, `${file}.purpose`, true);
  if (!Array.isArray(bot.rules)) fail(`${file}.rules: expected an array of text rules.`);
  bot.rules.forEach((rule, i) => string(rule, `${file}.rules[${i}]`, true));
  if (!Array.isArray(bot.skills)) fail(`${file}.skills: expected an array.`);
  if (!Array.isArray(bot.sessions) || !bot.sessions.length) fail(`${file}.sessions: expected at least one session.`);
  const identities = new Set();
  for (const session of bot.sessions) {
    if (!session || typeof session !== 'object' || Array.isArray(session)) fail(`${file}.sessions: expected session mappings.`);
    string(session.id, `${file}.sessions.id`);
    if (identities.has(session.id)) fail(`${file}: duplicate session identity ${session.id}.`);
    identities.add(session.id);
    string(session.role, `${file}.sessions.${session.id}.role`);
    string(session.startup_prompt, `${file}.sessions.${session.id}.startup_prompt`);
    if (session.default !== undefined && typeof session.default !== 'boolean') fail(`${file}.sessions.${session.id}.default: expected true or false.`);
    for (const setting of ['model', 'effort']) {
      if (session[setting] !== undefined) string(session[setting], `${file}.sessions.${session.id}.${setting}`);
    }
  }
  if (bot.sessions.filter((session) => session.default === true).length !== 1) fail(`${file}.sessions: choose exactly one default session.`);
}

function validateRegistry(registry, file) {
  if (!Array.isArray(registry.bots)) fail(`${file}.bots: expected an array.`);
  const identities = new Set();
  const configs = new Set();
  for (const bot of registry.bots) {
    if (!bot || typeof bot !== 'object' || Array.isArray(bot)) fail(`${file}.bots: expected bot mappings.`);
    string(bot.id, `${file}.bots.id`);
    string(bot.config, `${file}.bots.${bot.id}.config`);
    if (identities.has(bot.id) || configs.has(bot.config)) fail(`${file}: duplicate bot identity or config: ${bot.id}.`);
    identities.add(bot.id);
    configs.add(bot.config);
  }
  if (registry.bots.find((bot) => bot.id === 'bot-father')?.config !== 'bot.yaml') {
    fail(`${file}: bot-father must reference its own bot.yaml.`);
  }
}

function managedRegion(text, file) {
  if (!text?.includes(begin) && !text?.includes(end)) return null;
  if (text.split(begin).length !== 2 || text.split(end).length !== 2) fail(`${file}: ambiguous managed markers; reconcile them before regeneration.`);
  const start = text.indexOf(begin);
  const stop = text.indexOf(end) + end.length;
  if (stop < start + begin.length || (start > 0 && text[start - 1] !== '\n') ||
      !['\n', '\r'].includes(text[start + begin.length]) ||
      text[stop - end.length - 1] !== '\n' || (stop < text.length && !['\n', '\r'].includes(text[stop]))) {
    fail(`${file}: managed markers must be ordered on their own lines.`);
  }
  return { start, stop, text: text.slice(start, stop) };
}

function plan(root) {
  const inputs = new Map();
  const outputs = new Map();
  function input(file) {
    const text = read(root, file);
    inputs.set(file, text);
    return text;
  }
  function config(file, fallback) {
    const text = input(file);
    if (text === null) outputs.set(file, stringify(fallback));
    return yaml(text ?? stringify(fallback), file);
  }
  const workspace = config(workspaceFile, { schema_version: 1, bot_father: 'bots/bot-father' });
  const father = relativePath(workspace.bot_father, `${workspaceFile}.bot_father`);
  // Control files and shared assets cannot also be a bot's root.
  if (['.bot-kit', 'common'].includes(father.split('/')[0])) fail(`${workspaceFile}.bot_father: path conflicts with shared Kit files.`);
  const bot = config(`${father}/bot.yaml`, defaults);
  validateBot(bot, `${father}/bot.yaml`);
  const registry = config(`${father}/registry.yaml`, { schema_version: 1, bots: [{ id: 'bot-father', config: 'bot.yaml' }] });
  validateRegistry(registry, `${father}/registry.yaml`);
  const agentsFile = `${father}/AGENTS.md`;
  const receiptFile = `${father}/.bot-kit/generation.yaml`;
  const previous = input(agentsFile);
  const receiptText = input(receiptFile);
  const receipt = receiptText === null ? null : yaml(receiptText, receiptFile);
  if (receipt && !/^[a-f0-9]{64}$/.test(receipt.managed_sha256)) fail(`${receiptFile}.managed_sha256: expected a SHA256 digest.`);
  const template = fs.readFileSync(new URL('../templates/bot-father.md', import.meta.url), 'utf8').trimEnd();
  const nextRegion = `${begin}\n${template}\n\n## This bot\n\n${bot.name}\n\n${bot.purpose}\n\n## User bot-wide rules\n\n${bot.rules.join('\n\n') || 'No additional rules configured.'}\n${end}`;
  const region = managedRegion(previous, agentsFile);
  // A crash can leave the new region in place before its receipt is replaced.
  // Recover that exact desired output; any other unrecorded edit stays a conflict.
  if (region && region.text !== nextRegion && (!receipt || hash(region.text) !== receipt.managed_sha256)) {
    fail(`${agentsFile}: managed content changed. Preserve your edits outside the markers or incorporate them into bot.yaml, then explicitly reconcile the managed region with its last generated version before retrying.`);
  }
  const nextAgents = region
    ? previous.slice(0, region.start) + nextRegion + previous.slice(region.stop)
    : `${nextRegion}\n${previous === null || previous === '' ? '' : `\n${previous}`}`;
  outputs.set(agentsFile, nextAgents);
  const digest = hash(nextRegion);
  outputs.set(receiptFile, receipt?.managed_sha256 === digest ? receiptText : stringify({ schema_version: 1, managed_sha256: digest }));
  const directories = ['.bot-kit', 'common/skills', `${father}/.agents/skills`, `${father}/.bot-kit`, `${father}/memory`, `${father}/work`];
  for (const directory of directories) safePath(root, directory, 'directory');
  for (const file of outputs.keys()) safePath(root, file, 'file');
  const revision = hash(JSON.stringify([...inputs]));
  const writes = [...outputs].filter(([file, text]) => inputs.get(file) !== text);
  return { father, directories, inputs, writes, revision };
}

function checkInputs(root, inputs) {
  for (const [file, expected] of inputs) {
    if (read(root, file) !== expected) fail(`Configuration changed during preparation: ${file}. Inspect the workspace and retry with its current revision.`);
  }
}

function atomicWrite(root, relative, text) {
  const file = safePath(root, relative, 'file');
  const temporary = `${file}.${randomUUID()}.tmp`;
  const mode = stat(file)?.mode ?? 0o600;
  try {
    fs.writeFileSync(temporary, text, { flag: 'wx', mode });
    fs.renameSync(temporary, file);
  } finally {
    if (stat(temporary)) fs.unlinkSync(temporary);
  }
}

export function prepareWorkspace(selectedRoot, { inspect = false, expectedRevision } = {}) {
  if (typeof selectedRoot !== 'string' || !path.isAbsolute(selectedRoot)) fail('--workspace must be an absolute path.');
  const root = path.resolve(selectedRoot);
  const rootStat = stat(root);
  if (rootStat && !fs.statSync(root).isDirectory()) fail(`Workspace path must be a directory: ${root}`);
  const pending = plan(root);
  if (expectedRevision !== undefined && expectedRevision !== pending.revision) fail('Workspace revision changed. Inspect the latest configuration and reconcile before retrying.');
  const result = { workspace: root, bot_root: path.join(root, pending.father), native_ready: false };
  if (inspect) return { ...result, status: 'inspected', revision: pending.revision, pending_files: pending.writes.map(([file]) => file) };
  const lock = safePath(root, lockFile, 'file');
  if (stat(lock)) fail(`Workspace writer lock exists: ${lock}. Wait for its owner; inspect and remove it only after verifying the writer is no longer active.`);
  const completed = [];
  let descriptor;
  try {
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    descriptor = fs.openSync(lock, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`);
    checkInputs(root, pending.inputs);
    for (const directory of pending.directories) {
      const full = safePath(root, directory, 'directory');
      if (!stat(full)) { fs.mkdirSync(full, { recursive: true }); completed.push(directory); }
    }
    for (const [file, text] of pending.writes) {
      checkInputs(root, pending.inputs);
      const held = fs.fstatSync(descriptor);
      const currentLock = stat(lock);
      if (!currentLock || currentLock.ino !== held.ino || currentLock.dev !== held.dev) fail('Workspace writer lock changed. Stop and inspect the active writer before retrying.');
      atomicWrite(root, file, text);
      pending.inputs.set(file, text);
      completed.push(file);
    }
    return { ...result, status: 'prepared', revision: hash(JSON.stringify([...pending.inputs])), changed: completed };
  } catch (error) {
    error.progress = { completed, pending_files: pending.writes.map(([file]) => file).filter((file) => !completed.includes(file)), recovery: 'Inspect the reported paths, resolve the conflict and rerun preparation. Existing user work was not rolled back.' };
    throw error;
  } finally {
    if (descriptor !== undefined) {
      const held = fs.fstatSync(descriptor);
      fs.closeSync(descriptor);
      const current = stat(lock);
      if (current?.ino === held.ino && current.dev === held.dev) fs.unlinkSync(lock);
    }
  }
}
