import fs from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import { absolute, apply, established, fail, hash, loadState, readText, rootPath, safePath, selected, stat, yaml } from './workspace.js';

function text(value, field) {
  if (typeof value !== 'string' || !value.trim()) fail(`${field}: expected nonempty text.`);
  return value;
}
function identity(value) {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value)) fail('Receipt identity must contain letters/digits separated by hyphens.');
  return value;
}
function evidence(value) {
  if (!Array.isArray(value) || !value.length) fail('Nonempty evidence is required.');
  value.forEach((item) => text(item, 'evidence'));
}
function input(file) {
  file = absolute(file, '--config'); const bytes = readText(file);
  return { value: yaml(bytes, file), external: { file, text: bytes } };
}
function workspace(root) { const state = loadState(rootPath(root)); established(state); return state; }
function receipt(state, name) {
  const file = `${state.father}/.bot-kit/${name}.yaml`;
  const absoluteFile = safePath(state.root, file);
  const bytes = stat(absoluteFile) ? readText(absoluteFile) : null;
  state.inputs.set(file, bytes);
  return { file, value: bytes === null ? null : yaml(bytes, file) };
}
function save(state, file, value, expectedRevision, external, check) {
  return apply(state, new Map([[file, stringify(value)]]), [path.posix.dirname(file)], expectedRevision, external, { check });
}
function endpoint(state, value, defaultAllowed = false) {
  const bot = selected(state, value?.bot);
  const id = value.session ?? (defaultAllowed ? bot.value.sessions.find((entry) => entry.default).id : undefined);
  const session = bot.value.sessions.find((entry) => entry.id === id);
  if (!session) fail(`Unknown configured session identity for ${bot.id}: ${id}.`);
  const native = bot.observation?.state === 'observed' ? bot.observation.sessions?.find((entry) => entry.id === id)?.native : undefined;
  return { bot: bot.id, session: id, root: path.join(state.root, bot.directory), ...(native ? { native } : {}) };
}
function handoff(state, value) {
  if (value?.schema_version !== 1) fail('Packet schema_version must be 1.');
  const id = identity(value.id), from = endpoint(state, value.from), to = endpoint(state, value.to, true);
  const body = { id, from, to, return_to: from, objective: text(value.objective, 'objective'), context: text(value.context, 'context'), authority: text(value.authority, 'authority') };
  const host = value.host;
  text(host?.surface, 'host.surface'); text(host?.recipient_id, 'host.recipient_id');
  if (!['idle', 'busy', 'unknown', 'not-loaded'].includes(host.activity)) fail('Unsupported host activity.');
  const modes = ['send', 'queue', 'steer', 'stop'];
  if (!Array.isArray(host.capabilities) || host.capabilities.some((mode) => !modes.includes(mode))) fail('Unsupported host capabilities.');
  if (value.mode !== undefined && !modes.includes(value.mode)) fail('Unsupported handoff mode.');
  if (to.native && (to.native.surface !== host.surface || to.native.id !== host.recipient_id)) fail('Native recipient identity/surface conflicts with the selected conversation.');
  if (from.native && from.native.surface !== host.surface) fail('Sender native surface conflicts with the selected connection.');
  const logical = hash(JSON.stringify(body));
  const previous = receipt(state, `handoffs/${id}`);
  if (previous.value && previous.value.logical !== logical) fail('Handoff logical identity conflicts with previously recorded work.');
  const mode = value.mode ?? (host.activity === 'busy' ? 'queue' : host.activity === 'idle' ? 'send' : undefined);
  const result = { ...body, status: 'ready', mode, reason: value.reason, native_verified: false };
  if (previous.value) {
    result.status = previous.value.delivery.state === 'uncertain' ? 'uncertain' : 'recorded';
    result.delivery = previous.value.delivery;
    result.next_action = 'Reconcile recorded native delivery/result before considering another submission.';
  } else if (!from.native || !to.native || ['unknown', 'not-loaded'].includes(host.activity) || !host.capabilities.includes(mode)) {
    result.status = 'unavailable'; result.next_action = 'Observe the actual native conversation and arrange a supported handoff; do not substitute delivery semantics.';
  } else if (['steer', 'stop'].includes(mode) && (host.activity !== 'busy' || !value.reason?.trim() || !host.active_turn || !value.expected_turn || value.expected_turn !== host.active_turn)) {
    result.status = 'refresh-required'; result.next_action = 'Observe the active turn and supply the explicit reason and matching expected_turn. Stop does not roll back effects.';
  }
  return { result, logical, previous };
}

export function planHandoff(root, file) {
  const state = workspace(root), { value } = input(file);
  return handoff(state, value).result;
}
export function recordHandoff(root, file, expectedRevision) {
  const state = workspace(root), { value, external } = input(file);
  const { result, logical, previous } = handoff(state, value.packet);
  const delivery = value.delivery;
  if (!['sent', 'uncertain', 'completed'].includes(delivery?.state)) fail('Unsupported delivery state.');
  evidence(delivery.evidence);
  if (delivery.native_message_id !== undefined) text(delivery.native_message_id, 'native_message_id');
  if (previous.value?.delivery.state === 'completed' && delivery.state !== 'completed') fail('Completed delivery cannot regress.');
  // Even an unsupported or lost native call can have effects worth recording.
  // This records observations; it never claims that the local plan executed.
  const observation = { schema_version: 1, logical, packet: previous.value?.packet ?? result, delivery };
  const changed = save(state, previous.file, observation, expectedRevision, external);
  return { status: 'recorded', native_verified: false, changed, delivery };
}

export function recordFinding(root, file, expectedRevision) {
  const state = workspace(root), { value, external } = input(file);
  identity(value.id); selected(state, value.bot);
  for (const field of ['summary', 'next_action', 'observed_at']) text(value[field], field);
  evidence(value.evidence);
  if (!Number.isFinite(Date.parse(value.observed_at))) fail('observed_at must identify a date/time.');
  if (!['open', 'resolved'].includes(value.status)) fail('Finding status must be open or resolved.');
  if (value.routed !== undefined) evidence(value.routed?.evidence);
  const previous = receipt(state, `findings/${value.id}`);
  if (previous.value && previous.value.finding.bot !== value.bot) fail('Finding identity conflicts with the recorded bot.');
  const finding = Object.fromEntries(['id', 'bot', 'summary', 'evidence', 'next_action', 'status', 'observed_at'].map((field) => [field, value[field]]));
  const { observed_at, ...meaning } = finding;
  const fingerprint = hash(JSON.stringify(meaning));
  if (value.routed && previous.value?.fingerprint !== fingerprint) fail('Stale finding routing acknowledgement. Record the current finding first and acknowledge only the version actually sent.');
  const routed = value.routed ?? (previous.value?.fingerprint === fingerprint ? previous.value.routed : undefined);
  const notify = !routed && (value.status === 'open' || Boolean(previous.value));
  const saved = { schema_version: 1, finding, fingerprint, ...(routed ? { routed } : {}) };
  const changed = save(state, previous.file, saved, expectedRevision, external);
  return { status: 'recorded', native_verified: false, finding, notify, changed };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function skillFiles(directory) {
  const files = {}; let count = 0;
  function visit(file, relative, ancestors = []) {
    if (++count > 10000 || ancestors.length > 64) fail(`Skill inspection limit reached at ${file}; inspect the selected link/tree before retrying.`);
    let actual, info;
    try { info = fs.lstatSync(file); actual = fs.realpathSync(file); }
    catch (error) { fail(`Broken or cyclic skill path ${file}: ${error.code}. Reconcile the skill before planning notices.`); }
    if (info.isSymbolicLink()) files[`${relative}#link`] = fs.readlinkSync(file);
    if (ancestors.includes(actual)) fail(`Cyclic skill path ${file}; reconcile the selected link before planning notices.`);
    const target = fs.statSync(file);
    if (target.isDirectory()) {
      files[relative] = 'directory';
      for (const name of fs.readdirSync(file).sort()) if (name !== '.git') visit(path.join(file, name), `${relative}/${name}`, [...ancestors, actual]);
    } else if (target.isFile()) files[relative] = `${target.mode & 0o777}:${hash(fs.readFileSync(file))}`;
    else fail(`Unsupported skill file ${file}; expected an ordinary file, directory or selected link.`);
  }
  if (stat(directory)) for (const name of fs.readdirSync(directory).sort()) if (name !== '.git') visit(path.join(directory, name), name);
  return files;
}
function configuration(state) {
  const sessions = [];
  for (const bot of state.bots.values()) {
    selected(state, bot.id);
    const { sessions: configured, ...common } = bot.value;
    const components = { [bot.file]: hash(JSON.stringify(stable(common))), [`${bot.directory}/AGENTS.md`]: hash(state.inputs.get(`${bot.directory}/AGENTS.md`) ?? '') };
    const skills = `${bot.directory}/.agents/skills`;
    for (const [file, value] of Object.entries(skillFiles(safePath(state.root, skills, 'directory')))) components[`${skills}/${file}`] = value;
    for (const session of configured) {
      const relevant = { ...components, [`${bot.file}#sessions/${session.id}`]: hash(JSON.stringify(stable(session))) };
      sessions.push({ bot: bot.id, session: session.id, components: relevant, fingerprint: hash(JSON.stringify(stable(relevant))) });
    }
  }
  return sessions;
}
function sameSession(a, b) { return a.bot === b.bot && a.session === b.session; }
function noticeState(state) {
  const saved = receipt(state, 'notices');
  if (saved.value && (!Array.isArray(saved.value.snapshot) || !Array.isArray(saved.value.notices))) fail('Malformed notice receipt; inspect its snapshot and notices before recovery.');
  return saved;
}
function configurationCheck(state, snapshot) {
  const digest = hash(JSON.stringify(snapshot));
  return () => {
    if (hash(JSON.stringify(configuration(state))) !== digest) fail('Effective skill/configuration changed during notice preparation; inspect and retry.');
  };
}

export function planNotices(root, expectedRevision) {
  const state = workspace(root), previous = noticeState(state), snapshot = configuration(state);
  const notices = [];
  for (const current of snapshot) {
    const before = previous.value?.snapshot.find((entry) => sameSession(entry, current));
    const existing = previous.value?.notices.find((entry) => sameSession(entry, current));
    if (before && before.fingerprint !== current.fingerprint) {
      const delta = [...new Set([...Object.keys(before.components), ...Object.keys(current.components)])].filter((key) => before.components[key] !== current.components[key]);
      const changes = [...new Set([...(existing && existing.state !== 'adopted' ? existing.changes : []), ...delta])].sort();
      notices.push({ bot: current.bot, session: current.session, fingerprint: current.fingerprint, changes, state: 'pending', evidence: [] });
    } else if (existing) notices.push(existing);
  }
  const changed = save(state, previous.file, { schema_version: 1, snapshot, notices }, expectedRevision, undefined, configurationCheck(state, snapshot));
  return { status: previous.value ? 'planned' : 'baseline', native_verified: false, notices, changed };
}

export function recordNotice(root, file, expectedRevision) {
  const state = workspace(root), { value, external } = input(file), previous = noticeState(state);
  endpoint(state, value);
  text(value.fingerprint, 'fingerprint'); evidence(value.evidence);
  if (!['sent', 'uncertain', 'adopted'].includes(value.state)) fail('Unsupported notice state.');
  const snapshot = configuration(state);
  const current = snapshot.find((entry) => sameSession(entry, value));
  const notice = previous.value?.notices.find((entry) => sameSession(entry, value));
  if (!notice || notice.fingerprint !== value.fingerprint || current.fingerprint !== value.fingerprint) fail('Notice fingerprint is stale or missing. Plan the current configuration notices before recording delivery.');
  Object.assign(notice, { state: value.state, evidence: value.evidence });
  const changed = save(state, previous.file, previous.value, expectedRevision, external, configurationCheck(state, snapshot));
  return { status: 'recorded', native_verified: false, notice, changed };
}
