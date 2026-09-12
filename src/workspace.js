import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parseDocument, stringify } from 'yaml';

const begin = '<!-- bot-kit:begin -->';
const end = '<!-- bot-kit:end -->';
const workspaceFile = '.bot-kit/workspace.yaml';
const lockFile = '.bot-kit/write.lock';
const defaults = {
  schema_version: 1, id: 'bot-father', name: 'Bot Father',
  purpose: 'Help the user create, manage and coordinate their bots.',
  rules: [], skills: [],
  sessions: [{ id: 'daily', role: 'daily', default: true, startup_prompt: 'Help me with my bots and today’s work.' }],
};

export function fail(message) { throw new Error(message); }
export function hash(value) { return createHash('sha256').update(value).digest('hex'); }
export function stat(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export function absolute(value, field) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) fail(`${field} must be an absolute path.`);
  return path.resolve(value);
}
function rootPath(value) {
  const root = absolute(value, '--workspace');
  if (stat(root) && !fs.statSync(root).isDirectory()) fail(`Workspace must be a directory: ${root}`);
  return root;
}

// The selected root may use a normal user path alias. Managed descendants must
// not redirect reads or writes through symlinks.
function safePath(root, relative, type = 'file') {
  let file = root;
  const parts = relative.split('/');
  for (const [index, part] of parts.entries()) {
    file = path.join(file, part);
    const current = stat(file);
    if (!current) continue;
    if (current.isSymbolicLink()) fail(`Path conflict: ${file} is a symlink. Choose a regular managed destination.`);
    const directory = index < parts.length - 1 || type === 'directory';
    if (directory ? !current.isDirectory() : !current.isFile()) fail(`Path conflict: ${file} must be a ${directory ? 'directory' : 'regular file'}.`);
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
export function readText(file) {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(file)); }
  catch (error) {
    if (error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') fail(`${file}: expected UTF-8 text; existing bytes were preserved.`);
    throw error;
  }
}
function read(root, relative) {
  const file = safePath(root, relative);
  return stat(file) ? readText(file) : null;
}
export function yaml(text, file) {
  const document = parseDocument(text, { uniqueKeys: true, strict: true });
  if (document.errors.length || document.warnings.length) fail(`${file}: invalid YAML: ${[...document.errors, ...document.warnings].map((item) => item.message).join('; ')}`);
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
function identity(value, field) {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value)) fail(`${field}: bot identity must contain letters/digits separated by hyphens.`);
}
function validateBot(bot, file, expected) {
  identity(bot.id, `${file}.id`);
  if (bot.id !== expected) fail(`${file}: identity conflict; expected ${expected}.`);
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
    for (const setting of ['model', 'effort']) if (session[setting] !== undefined) string(session[setting], `${file}.sessions.${session.id}.${setting}`);
  }
  if (bot.sessions.filter((session) => session.default === true).length !== 1) fail(`${file}.sessions: choose exactly one default session.`);
}
function registryPath(father, entry) {
  string(entry.config, 'registry.yaml.bots.config');
  if (path.isAbsolute(entry.config) || entry.config.includes('\\') || entry.config.includes('\0')) fail('Registry config path must stay inside the workspace.');
  const relative = path.posix.normalize(`${father}/${entry.config}`);
  relativePath(relative, 'registry.yaml.bots.config');
  if (path.posix.basename(relative) !== 'bot.yaml') fail('Registry config path must identify a bot.yaml file.');
  return relative;
}
function loadState(root) {
  const inputs = new Map();
  const missing = new Map();
  const input = (file) => { const text = read(root, file); inputs.set(file, text); return text; };
  function config(file, fallback) {
    const text = input(file);
    if (text === null && fallback !== undefined) missing.set(file, stringify(fallback));
    return text === null && fallback === undefined ? null : yaml(text ?? stringify(fallback), file);
  }
  const workspace = config(workspaceFile, { schema_version: 1, bot_father: 'bots/bot-father' });
  const father = relativePath(workspace.bot_father, `${workspaceFile}.bot_father`);
  if (['.bot-kit', 'common'].includes(father.split('/')[0])) fail(`${workspaceFile}.bot_father: path conflicts with shared Kit files.`);
  const registryFile = `${father}/registry.yaml`;
  const registry = config(registryFile, { schema_version: 1, bots: [{ id: 'bot-father', config: 'bot.yaml' }] });
  if (!Array.isArray(registry.bots)) fail(`${registryFile}.bots: expected an array.`);
  const ids = new Set(); const paths = new Set(); const bots = new Map();
  for (const entry of registry.bots) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`${registryFile}: expected bot mappings.`);
    identity(entry.id, `${registryFile}.id`);
    const file = registryPath(father, entry);
    if (ids.has(entry.id.toLowerCase()) || paths.has(file.toLowerCase())) fail(`${registryFile}: duplicate bot identity or config path: ${entry.id}.`);
    ids.add(entry.id.toLowerCase()); paths.add(file.toLowerCase());
    if (entry.id === 'bot-father' && file !== `${father}/bot.yaml`) fail(`${registryFile}: bot-father must reference its own bot.yaml.`);
    const value = config(file, entry.id === 'bot-father' ? defaults : undefined);
    if (value) validateBot(value, file, entry.id);
    const directory = path.posix.dirname(file);
    for (const suffix of ['AGENTS.md', '.bot-kit/generation.yaml', '.bot-kit/native.yaml']) input(`${directory}/${suffix}`);
    const native = inputs.get(`${directory}/.bot-kit/native.yaml`);
    bots.set(entry.id, { id: entry.id, directory, file, value, observation: native === null ? null : yaml(native, `${directory}/.bot-kit/native.yaml`) });
  }
  if (!bots.has('bot-father')) fail(`${registryFile}: bot-father identity is missing.`);
  return { root, father, registry, registryFile, bots, inputs, missing, revision: hash(JSON.stringify([...inputs])) };
}
function managedRegion(text, file) {
  if (!text?.includes(begin) && !text?.includes(end)) return null;
  if (text.split(begin).length !== 2 || text.split(end).length !== 2) fail(`${file}: ambiguous managed markers; reconcile them before regeneration.`);
  const start = text.indexOf(begin); const stop = text.indexOf(end) + end.length;
  if (stop < start + begin.length || (start > 0 && text[start - 1] !== '\n') ||
      !['\n', '\r'].includes(text[start + begin.length]) || text[stop - end.length - 1] !== '\n' ||
      (stop < text.length && !['\n', '\r'].includes(text[stop]))) fail(`${file}: managed markers must be ordered on their own lines.`);
  return { start, stop, text: text.slice(start, stop) };
}
function guidance(state, bot, value = bot.value) {
  const agentsFile = `${bot.directory}/AGENTS.md`; const receiptFile = `${bot.directory}/.bot-kit/generation.yaml`;
  for (const file of [agentsFile, receiptFile]) if (!state.inputs.has(file)) state.inputs.set(file, read(state.root, file));
  const previous = state.inputs.get(agentsFile); const receiptText = state.inputs.get(receiptFile);
  const receipt = receiptText === null ? null : yaml(receiptText, receiptFile);
  if (receipt && !/^[a-f0-9]{64}$/.test(receipt.managed_sha256)) fail(`${receiptFile}.managed_sha256: expected a SHA256 digest.`);
  const template = fs.readFileSync(new URL('../templates/bot-father.md', import.meta.url), 'utf8').trimEnd();
  const nextRegion = `${begin}\n${template}\n\n## This bot\n\n${value.name}\n\n${value.purpose}\n\n## User bot-wide rules\n\n${value.rules.join('\n\n') || 'No additional rules configured.'}\n${end}`;
  const region = managedRegion(previous, agentsFile);
  // Recover an interrupted receipt only when the existing region is exactly the
  // desired output. Any other unrecorded edit remains a conflict.
  if (region && region.text !== nextRegion && (!receipt || hash(region.text) !== receipt.managed_sha256)) {
    fail(`${agentsFile}: managed content changed. Preserve your edits outside the markers or incorporate them into bot.yaml, then explicitly reconcile the managed region before retrying.`);
  }
  const next = region ? previous.slice(0, region.start) + nextRegion + previous.slice(region.stop)
    : `${nextRegion}\n${previous === null || previous === '' ? '' : `\n${previous}`}`;
  const digest = hash(nextRegion);
  return new Map([[agentsFile, next], [receiptFile, receipt?.managed_sha256 === digest ? receiptText : stringify({ schema_version: 1, managed_sha256: digest })]]);
}
function botDirectories(directory) { return ['.agents/skills', '.bot-kit', 'memory', 'work'].map((part) => `${directory}/${part}`); }
function checkInputs(state, external) {
  for (const [file, expected] of state.inputs) if (read(state.root, file) !== expected) fail(`Configuration changed during preparation: ${file}. Inspect the current revision before retrying.`);
  if (external && readText(external.file) !== external.text) fail(`Input changed during the operation: ${external.file}. Inspect it before retrying.`);
}
function atomicWrite(root, relative, text) {
  const file = safePath(root, relative); const temporary = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, text, { flag: 'wx', mode: stat(file)?.mode ?? 0o600 }); fs.renameSync(temporary, file); }
  finally { if (stat(temporary)) fs.unlinkSync(temporary); }
}
function apply(state, outputs, directories, expectedRevision, external) {
  if (expectedRevision !== undefined && expectedRevision !== state.revision) fail('Workspace revision changed. Inspect the latest configuration and reconcile before retrying.');
  for (const directory of directories) safePath(state.root, directory, 'directory');
  for (const file of outputs.keys()) safePath(state.root, file);
  const writes = [...outputs].filter(([file, text]) => state.inputs.get(file) !== text);
  const lock = safePath(state.root, lockFile);
  if (stat(lock)) fail(`Workspace writer lock exists: ${lock}. Wait for its owner; inspect and remove it only after verifying the writer is no longer active.`);
  const completed = []; let descriptor;
  try {
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    descriptor = fs.openSync(lock, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`);
    checkInputs(state, external);
    for (const directory of directories) {
      const full = safePath(state.root, directory, 'directory');
      if (!stat(full)) { fs.mkdirSync(full, { recursive: true }); completed.push(directory); }
    }
    for (const [file, text] of writes) {
      checkInputs(state, external);
      const held = fs.fstatSync(descriptor); const current = stat(lock);
      if (!current || current.ino !== held.ino || current.dev !== held.dev) fail('Workspace writer lock changed. Stop and inspect the active writer before retrying.');
      atomicWrite(state.root, file, text); state.inputs.set(file, text); completed.push(file);
    }
    return completed;
  } catch (error) {
    error.progress = { completed, pending_files: writes.map(([file]) => file).filter((file) => !completed.includes(file)), recovery: 'Inspect the reported paths, resolve the conflict and rerun. Existing user work was not rolled back.' };
    throw error;
  } finally {
    if (descriptor !== undefined) {
      const held = fs.fstatSync(descriptor); fs.closeSync(descriptor); const current = stat(lock);
      if (current?.ino === held.ino && current.dev === held.dev) fs.unlinkSync(lock);
    }
  }
}
function directory(state) {
  return [...state.bots.values()].map((bot) => ({
    id: bot.id, root: path.join(state.root, bot.directory), config: path.join(state.root, bot.file),
    state: state.inputs.get(bot.file) === null ? 'missing' : 'configured',
    ...(bot.value ? { purpose: bot.value.purpose, rules: bot.value.rules, skills: bot.value.skills,
      default_session: bot.value.sessions.find((session) => session.default)?.id, sessions: bot.value.sessions } : {}),
    observation: bot.observation,
  }));
}
function result(state, status, bot, changed = []) {
  return { status, workspace: state.root, bot_root: path.join(state.root, bot.directory), native_ready: false,
    revision: state.revision, directory: directory(state), changed };
}
function selected(state, id) {
  const bot = state.bots.get(id);
  if (!bot?.value) fail(`Unknown or missing bot identity: ${id}. Inspect registry.yaml before choosing a bot.`);
  return bot;
}
function established(state) {
  if (state.missing.size) fail('Workspace preparation is incomplete. Run prepare before managing bots.');
}
export function prepareWorkspace(selectedRoot, { inspect = false, expectedRevision, bot: id = 'bot-father' } = {}) {
  const state = loadState(rootPath(selectedRoot)); const bot = selected(state, id);
  const outputs = new Map([...state.missing, ...guidance(state, bot)]);
  const directories = ['.bot-kit', 'common/skills', ...botDirectories(bot.directory)];
  for (const entry of directories) safePath(state.root, entry, 'directory');
  if (expectedRevision !== undefined && expectedRevision !== state.revision) fail('Workspace revision changed. Inspect the latest configuration before retrying.');
  if (inspect) return { ...result(state, 'inspected', bot), pending_files: [...outputs].filter(([file, text]) => state.inputs.get(file) !== text).map(([file]) => file) };
  const changed = apply(state, outputs, directories, expectedRevision);
  const next = loadState(state.root);
  return result(next, 'prepared', selected(next, id), changed);
}
export function manageBot(selectedRoot, inputFile, { configure = false, expectedRevision } = {}) {
  const state = loadState(rootPath(selectedRoot)); established(state);
  const file = absolute(inputFile, '--config'); const text = readText(file); const value = yaml(text, file);
  identity(value.id, `${file}.id`); validateBot(value, file, value.id);
  if (!configure && value.id.toLowerCase() === 'bot-father') fail('The reserved bot-father identity is created only by workspace preparation.');
  let bot = state.bots.get(value.id);
  if (configure && !bot?.value) fail(`Cannot configure unknown bot identity ${value.id}.`);
  if (!bot && [...state.bots.keys()].some((id) => id.toLowerCase() === value.id.toLowerCase())) fail('Bot identity conflicts with existing membership.');
  const outputs = new Map(); let registryChanged = false;
  if (!bot) {
    const directory = `bots/${value.id}`; const config = `${directory}/bot.yaml`;
    if ([...state.bots.values()].some((entry) => entry.file.toLowerCase() === config.toLowerCase())) fail('Bot path conflicts with existing identity.');
    const previous = read(state.root, config); state.inputs.set(config, previous);
    bot = { id: value.id, directory, file: config, value: previous === null ? null : yaml(previous, config), observation: null };
    if (bot.value) validateBot(bot.value, config, value.id);
    const nativeFile = `${directory}/.bot-kit/native.yaml`;
    const nativeText = read(state.root, nativeFile); state.inputs.set(nativeFile, nativeText);
    if (nativeText !== null) bot.observation = yaml(nativeText, nativeFile);
    state.registry.bots.push({ id: value.id, config: path.posix.relative(state.father, config) }); registryChanged = true;
  }
  if (!configure && bot.value && !isDeepStrictEqual(bot.value, value)) fail(`Existing bot ${value.id} has conflicting configuration. Use configure-bot for an intended change.`);
  outputs.set(bot.file, !configure && bot.value ? state.inputs.get(bot.file) : text);
  for (const [name, bytes] of guidance(state, bot, value)) outputs.set(name, bytes);
  // Keep completed bot files recoverable if membership publication is interrupted.
  if (registryChanged) outputs.set(state.registryFile, stringify(state.registry));
  const changed = apply(state, outputs, botDirectories(bot.directory), expectedRevision, { file, text });
  const next = loadState(state.root);
  return result(next, 'prepared', selected(next, value.id), changed);
}
export function recordNative(selectedRoot, id, inputFile, expectedRevision) {
  const state = loadState(rootPath(selectedRoot)); established(state); const bot = selected(state, id);
  const file = absolute(inputFile, '--receipt'); const text = readText(file); const value = yaml(text, file);
  if (value.bot !== id) fail('Native receipt bot identity conflicts with the selected bot.');
  string(value.observed_at, 'observed_at');
  if (!Number.isFinite(Date.parse(value.observed_at))) fail('observed_at must identify a date/time.');
  string(value.source?.surface, 'source.surface'); string(value.source?.method, 'source.method');
  if (!['observed', 'backend-only', 'unavailable', 'stale', 'ambiguous'].includes(value.state)) fail('Native observation state is unsupported.');
  if (!Array.isArray(value.evidence) || !value.evidence.length) fail('Native observation evidence is required.');
  value.evidence.forEach((item) => string(item, 'evidence'));
  if (!Array.isArray(value.sessions)) fail('Native observation sessions must be an array.');
  const nativeIds = new Set(); const configuredIds = new Set();
  const botRoot = fs.realpathSync(path.join(state.root, bot.directory));
  function native(entry, field) {
    string(entry?.surface, `${field}.surface`); string(entry?.id, `${field}.id`);
    if (entry.surface !== value.source.surface) fail(`${field}: cross-surface native identity cannot be substituted.`);
    absolute(entry.root, `${field}.root`);
    if (value.state === 'observed') {
      let observed;
      try { observed = fs.realpathSync(entry.root); } catch { fail(`${field}.root does not match the bot root.`); }
      if (observed !== botRoot) fail(`${field}.root does not match the bot root.`);
    }
  }
  if (value.project !== undefined) native(value.project, 'project');
  if (value.state === 'observed' && !value.project) fail('An observed project identity is required.');
  for (const session of value.sessions) {
    const intent = bot.value.sessions.find((entry) => entry.id === session?.id);
    if (!intent || configuredIds.has(session.id)) fail('Unknown or duplicate configured session identity.');
    configuredIds.add(session.id);
    if (!['matched', 'unsupported', 'unverified'].includes(session.settings_status)) fail('Session settings_status is required.');
    if (session.native) {
      native(session.native, `session.${session.id}`);
      if (nativeIds.has(session.native.id)) fail('Duplicate native session identity.');
      nativeIds.add(session.native.id);
    } else if (value.state === 'observed') fail('Observed session requires a native identity.');
    for (const setting of ['model', 'effort']) {
      if (session[setting] !== undefined) string(session[setting], `session.${setting}`);
      if (session.settings_status === 'matched' && intent[setting] !== undefined && intent[setting] !== session[setting]) fail(`Contradictory matched ${setting}; preserve requested settings and record unsupported or unverified.`);
    }
  }
  const receipt = `${bot.directory}/.bot-kit/native.yaml`;
  const changed = apply(state, new Map([[receipt, text]]), [`${bot.directory}/.bot-kit`], expectedRevision, { file, text });
  const next = loadState(state.root);
  return result(next, 'recorded', selected(next, id), changed);
}
