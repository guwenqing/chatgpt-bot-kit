import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import YAML from 'yaml';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'src/cli.js');
const surface = 'synthetic-coordination-fixture';
function run(root, command, args = []) {
  const result = spawnSync(process.execPath, [cli, command, '--workspace', root, ...args], { encoding: 'utf8', timeout: 15000 });
  assert.ifError(result.error);
  return result;
}
function ok(result) { assert.equal(result.status, 0, result.stderr || result.stdout); return JSON.parse(result.stdout); }
function write(root, file, value) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
  return target;
}
function yaml(root, file, value) { return write(root, file, YAML.stringify(value)); }
function snapshot(root) {
  const result = {};
  function visit(relative) {
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      const file = path.join(relative, name), absolute = path.join(root, file), stat = fs.lstatSync(absolute);
      result[file] = stat.isSymbolicLink() ? `link:${fs.readlinkSync(absolute)}` : stat.isDirectory() ? 'directory' : fs.readFileSync(absolute).toString('base64');
      if (stat.isDirectory()) visit(file);
    }
  }
  visit(''); return result;
}
function config(id) {
  return { schema_version: 1, id, name: id, purpose: 'Provide bounded help.', rules: ['Keep authority bounded.'], skills: [], sessions: [
    { id: 'daily', role: 'daily help', default: true, startup_prompt: 'Help with today.', model: 'chosen-model', effort: 'low' },
    { id: 'review', role: 'review plans', default: false, startup_prompt: 'Review the supplied plan.', model: 'chosen-model', effort: 'high' },
  ] };
}
function fixture(t) {
  const parent = path.join(repo, 'local-data/bot-coordination-test');
  fs.mkdirSync(parent, { recursive: true });
  const base = fs.mkdtempSync(path.join(parent, 'case-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'workspace'); fs.mkdirSync(root);
  ok(run(root, 'prepare'));
  for (const id of ['sender', 'helper', 'unrelated']) {
    const value = config(id);
    ok(run(root, 'create-bot', ['--config', yaml(base, `${id}.yaml`, value)]));
    const botRoot = path.join(root, `bots/${id}`);
    const receipt = { schema_version: 1, bot: id, observed_at: '2026-09-12T20:00:00.000Z',
      source: { surface, method: 'Synthetic fixture; not native transport evidence.' }, state: 'observed',
      project: { surface, id: `project-${id}`, root: botRoot },
      sessions: value.sessions.map((s) => ({ id: s.id, native: { surface, id: `${id}-${s.id}`, root: botRoot },
        model: s.model, effort: s.effort, settings_status: 'matched' })), evidence: ['Synthetic fixture only.'] };
    ok(run(root, 'record-native', ['--bot', id, '--receipt', yaml(base, `${id}-native.yaml`, receipt)]));
  }
  const invoke = (command, value, args = []) => run(root, command, value === undefined ? args : ['--config', yaml(base, 'input.yaml', value), ...args]);
  return { base, root, invoke, call: (command, value, args) => ok(invoke(command, value, args)) };
}
function packet() {
  return { schema_version: 1, id: 'bounded-help', from: { bot: 'sender', session: 'review' }, to: { bot: 'helper' },
    objective: 'Review this proposed change.', context: 'Only the supplied plan is in scope.', authority: 'Review only; return broader proposals to sender.',
    host: { surface, recipient_id: 'helper-daily', activity: 'idle', capabilities: ['send', 'queue', 'steer', 'stop'] } };
}
function reject(f, command, value, diagnostic, args = []) {
  // Inputs live outside the workspace, so failed writes cannot hide in fixture setup.
  yaml(f.base, 'input.yaml', value);
  const before = snapshot(f.root);
  const result = run(f.root, command, ['--config', path.join(f.base, 'input.yaml'), ...args]);
  assert.notEqual(result.status, 0, 'invalid operation must fail');
  assert.match(result.stderr + result.stdout, diagnostic);
  assert.deepEqual(snapshot(f.root), before, 'rejected input must not change workspace bytes');
}
function recipients(result) { return result.notices.map((n) => `${n.bot}/${n.session}`).sort(); }
function notice(f, bot = 'helper', session = 'daily') {
  const found = f.call('plan-notices').notices.find((n) => n.bot === bot && n.session === session);
  assert.ok(found, `notice for ${bot}/${session}`); return found;
}
function receipt(n, state) { return { schema_version: 1, bot: n.bot, session: n.session, fingerprint: n.fingerprint, state, evidence: ['Synthetic reported observation.'] }; }

test('coordination fixture establishes managed bots and observed native identities using existing commands', (t) => {
  const f = fixture(t), directory = f.call('inspect').directory;
  assert.equal(directory.find((b) => b.id === 'helper').observation.sessions[0].native.id, 'helper-daily');
});

test('handoff uses explicit or configured default conversation and preserves sender, return and authority', (t) => {
  const f = fixture(t), p = packet(), before = snapshot(f.root);
  const planned = f.call('plan-handoff', p);
  assert.equal(planned.status, 'ready'); assert.equal(planned.mode, 'send'); assert.equal(planned.native_verified, false);
  assert.equal(planned.to.bot, 'helper'); assert.equal(planned.to.session, 'daily');
  assert.equal(planned.to.native.id, 'helper-daily'); assert.equal(planned.to.root, path.join(f.root, 'bots/helper'));
  assert.equal(planned.from.native.id, 'sender-review'); assert.deepEqual(planned.return_to, planned.from);
  for (const key of ['id', 'objective', 'context', 'authority']) assert.equal(planned[key], p[key]);
  assert.deepEqual(snapshot(f.root), before, 'planning must not create conversations or delivery receipts');
  p.to.session = 'review'; p.host.recipient_id = 'helper-review';
  assert.equal(f.call('plan-handoff', p).to.session, 'review');
  const cfg = config('helper'); cfg.sessions[0].default = false; cfg.sessions[1].default = true;
  f.call('configure-bot', cfg); delete p.to.session;
  assert.equal(f.call('plan-handoff', p).to.session, 'review', 'fallback follows actual configuration');
});

for (const [activity, capabilities, expectedStatus, expectedMode] of [
  ['busy', ['send', 'queue', 'steer'], 'ready', 'queue'],
  ['busy', ['send', 'steer'], 'unavailable', undefined],
  ['unknown', ['send', 'queue'], 'unavailable', undefined],
  ['not-loaded', ['send', 'queue'], 'unavailable', undefined],
  ['idle', [], 'unavailable', undefined],
]) test(`handoff activity ${activity} with ${capabilities.join(',')} has honest native semantics`, (t) => {
  const f = fixture(t), p = packet(); Object.assign(p.host, { activity, capabilities });
  const result = f.call('plan-handoff', p);
  assert.equal(result.status, expectedStatus); assert.equal(result.native_verified, false);
  if (expectedMode) assert.equal(result.mode, expectedMode);
  assert.notEqual(result.mode, 'steer', 'ordinary request must never silently steer');
});

test('steering requires reason and matching current turn, while explicit stop retains its reason', (t) => {
  const f = fixture(t), p = packet(); p.mode = 'steer'; Object.assign(p.host, { activity: 'busy', active_turn: 'turn-2' });
  assert.equal(f.call('plan-handoff', p).status, 'refresh-required');
  p.reason = 'New constraint changes the review.'; p.expected_turn = 'turn-1';
  assert.equal(f.call('plan-handoff', p).status, 'refresh-required');
  p.expected_turn = 'turn-2'; assert.equal(f.call('plan-handoff', p).status, 'ready');
  p.mode = 'stop'; p.reason = 'User withdrew the review request.';
  const stopped = f.call('plan-handoff', p);
  assert.equal(stopped.status, 'ready'); assert.equal(stopped.mode, 'stop'); assert.equal(stopped.reason, p.reason);
  p.expected_turn = 'turn-1'; assert.notEqual(f.call('plan-handoff', p).status, 'ready');
  delete p.reason; assert.notEqual(f.call('plan-handoff', p).status, 'ready');
});

test('handoff uncertain receipt prevents blind retry, reconciles with evidence and never regresses completed', (t) => {
  const f = fixture(t), p = packet(), input = { schema_version: 1, packet: p, delivery: { state: 'uncertain', evidence: ['Native call lost its response.'] } };
  f.call('record-handoff', input);
  const recorded = snapshot(f.root);
  f.call('record-handoff', input); assert.deepEqual(snapshot(f.root), recorded, 'exact retry is stable');
  assert.equal(f.call('plan-handoff', p).status, 'uncertain');
  input.delivery = { state: 'sent', evidence: ['Native message found during reconciliation.'], native_message_id: 'message-1' };
  f.call('record-handoff', input); assert.equal(f.call('plan-handoff', p).status, 'recorded');
  input.delivery.state = 'completed'; input.delivery.evidence = ['Observed result returned to sender-review.'];
  f.call('record-handoff', input);
  assert.equal(f.call('plan-handoff', p).status, 'recorded');
  input.delivery.state = 'sent';
  reject(f, 'record-handoff', input, /completed|regress|state|conflict/i);
});

for (const field of ['objective', 'context', 'authority', 'from', 'to']) test(`handoff logical identity cannot be reused with changed ${field}`, (t) => {
  const f = fixture(t), p = packet(), input = { schema_version: 1, packet: p, delivery: { state: 'sent', evidence: ['Synthetic accepted observation.'] } };
  f.call('record-handoff', input);
  if (field === 'from') p.from.session = 'daily';
  else if (field === 'to') { p.to.session = 'review'; p.host.recipient_id = 'helper-review'; }
  else p[field] += ' Changed';
  reject(f, 'record-handoff', input, /identity|conflict|changed|logical/i);
  reject(f, 'plan-handoff', p, /identity|conflict|changed|logical/i);
});

test('notices baseline excludes ordinary memory, work, receipt and semantic YAML formatting changes', (t) => {
  const f = fixture(t), baseline = f.call('plan-notices');
  assert.equal(baseline.status, 'baseline'); assert.deepEqual(baseline.notices, []);
  write(f.root, 'bots/helper/memory/today.md', 'An ordinary preference.');
  write(f.root, 'bots/helper/work/notes.md', 'Work in progress.');
  write(f.root, 'bots/helper/.bot-kit/bookkeeping.yaml', 'observed: today\n');
  const file = path.join(f.root, 'bots/helper/bot.yaml');
  fs.writeFileSync(file, `# User formatting only\n${YAML.stringify(config('helper'), { indent: 4 })}`);
  const result = f.call('plan-notices'); assert.equal(result.status, 'planned'); assert.deepEqual(result.notices, []);
});

test('session configuration changes notify only existing affected session and retain pending/sent/adopted distinctions', (t) => {
  const f = fixture(t); f.call('plan-notices');
  const cfg = config('helper'); cfg.sessions[1].startup_prompt = 'Consider the new acceptance criterion.';
  f.call('configure-bot', cfg);
  const first = f.call('plan-notices'); assert.deepEqual(recipients(first), ['helper/review']);
  const n = first.notices[0]; assert.equal(n.state, 'pending'); assert.ok(n.changes.length > 0); assert.ok(n.fingerprint);
  assert.equal(notice(f, 'helper', 'review').fingerprint, n.fingerprint);
  for (const state of ['uncertain', 'sent', 'adopted']) {
    const result = f.call('record-notice', receipt(n, state));
    assert.equal(result.native_verified, false);
    assert.equal(notice(f, 'helper', 'review').state, state);
    const before = snapshot(f.root); f.call('record-notice', receipt(n, state)); assert.deepEqual(snapshot(f.root), before);
  }
  cfg.sessions.push({ ...cfg.sessions[0], id: 'new-session', default: false });
  f.call('configure-bot', cfg);
  assert.ok(!recipients(f.call('plan-notices')).includes('helper/new-session'), 'new session needs no retrospective notice');
  cfg.sessions = cfg.sessions.filter((s) => s.id !== 'review'); f.call('configure-bot', cfg);
  assert.ok(!recipients(f.call('plan-notices')).includes('helper/review'), 'removed session is not a recipient');
});

test('shared linked skills use live effective bytes and send notices to all affected bots only', (t) => {
  const f = fixture(t); write(f.base, 'shared/SKILL.md', '# Shared guidance\nFirst version.\n');
  for (const id of ['sender', 'helper']) fs.symlinkSync(path.join(f.base, 'shared'), path.join(f.root, `bots/${id}/.agents/skills/shared`));
  f.call('plan-notices');
  write(f.base, 'shared/SKILL.md', '# Shared guidance\nChanged behavior.\n');
  const result = f.call('plan-notices');
  assert.deepEqual(recipients(result), ['helper/daily', 'helper/review', 'sender/daily', 'sender/review']);
  for (const n of result.notices) { assert.equal(n.state, 'pending'); assert.match(JSON.stringify(n.changes), /shared|SKILL|skills/i); }
  write(f.base, 'shared/.git/ignored', 'Do not traverse repository bookkeeping.');
  assert.deepEqual(f.call('plan-notices').notices, result.notices);
});

test('current guidance changes invalidate adoption and reject stale notice receipt even before replanning', (t) => {
  const f = fixture(t); f.call('plan-notices');
  const agents = path.join(f.root, 'bots/helper/AGENTS.md'); fs.appendFileSync(agents, '\nUser guidance one.\n');
  const old = notice(f); f.call('record-notice', receipt(old, 'adopted'));
  fs.appendFileSync(agents, '\nUser guidance two.\n');
  reject(f, 'record-notice', receipt(old, 'adopted'), /stale|fingerprint|changed|current/i);
  const current = notice(f); assert.equal(current.state, 'pending'); assert.notEqual(current.fingerprint, old.fingerprint);
  reject(f, 'record-notice', receipt(old, 'sent'), /stale|fingerprint|changed|current/i);
});

test('grooming findings recover unrouted observations, deduplicate routed content and report resolution/reopening', (t) => {
  const f = fixture(t), finding = { schema_version: 1, id: 'skill-difficulty', bot: 'helper', summary: 'Skill could not load.',
    evidence: ['Observed a missing selected skill.'], next_action: 'Ask owner whether to repair the link.', status: 'open', observed_at: '2026-09-12T20:00:00.000Z' };
  const first = f.call('record-finding', finding); assert.equal(first.notify, true);
  for (const key of ['id', 'bot', 'summary', 'evidence', 'next_action', 'status']) assert.deepEqual(first.finding[key], finding[key]);
  finding.observed_at = '2026-09-13T20:00:00.000Z'; assert.equal(f.call('record-finding', finding).notify, true, 'failed routing stays recoverable');
  finding.routed = { evidence: ['Synthetic result accepted by daily conversation.'] };
  assert.equal(f.call('record-finding', finding).notify, false);
  delete finding.routed; finding.observed_at = '2026-09-14T20:00:00.000Z';
  assert.equal(f.call('record-finding', finding).notify, false, 'next daily observation must not broadcast unchanged problem');
  finding.evidence.push('New relevant reproduction evidence.'); assert.equal(f.call('record-finding', finding).notify, true);
  finding.routed = { evidence: ['Updated finding routed.'] }; assert.equal(f.call('record-finding', finding).notify, false);
  delete finding.routed; finding.status = 'resolved'; assert.equal(f.call('record-finding', finding).notify, true);
  finding.routed = { evidence: ['Resolution routed.'] }; assert.equal(f.call('record-finding', finding).notify, false);
  delete finding.routed; assert.equal(f.call('record-finding', finding).notify, false);
  finding.status = 'open'; assert.equal(f.call('record-finding', finding).notify, true);
});

for (const [name, mutate] of [
  ['unsafe packet identity', (p) => { p.id = '../outside'; }],
  ['unknown sender', (p) => { p.from.bot = 'not-managed'; }],
  ['unknown destination session', (p) => { p.to.session = 'not-configured'; }],
  ['wrong native surface', (p) => { p.host.surface = 'other-surface'; }],
  ['wrong native recipient', (p) => { p.host.recipient_id = 'unrelated-daily'; }],
  ['empty authority', (p) => { p.authority = ' '; }],
]) test(`${name} is rejected with no workspace mutation`, (t) => {
  const f = fixture(t), p = packet(); mutate(p);
  reject(f, 'plan-handoff', p, /id|identity|managed|session|surface|recipient|authority|empty|nonempty/i);
});

test('receipts reject missing evidence, unmanaged findings, duplicate YAML keys and stale revision', (t) => {
  const f = fixture(t);
  reject(f, 'record-handoff', { schema_version: 1, packet: packet(), delivery: { state: 'uncertain', evidence: [] } }, /evidence/i);
  const finding = { schema_version: 1, id: 'bad-finding', bot: 'not-managed', summary: 'Problem', evidence: ['Observation'], next_action: 'Ask owner', status: 'open', observed_at: '2026-09-12T20:00:00.000Z' };
  reject(f, 'record-finding', finding, /bot|managed|unknown/i);
  finding.bot = 'helper'; finding.id = '../escaped'; reject(f, 'record-finding', finding, /id|identity|path/i);
  const duplicate = write(f.base, 'duplicate.yaml', `${YAML.stringify(packet())}id: duplicate\n`), before = snapshot(f.root);
  const rejected = run(f.root, 'plan-handoff', ['--config', duplicate]);
  assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /duplicate|unique|yaml/i); assert.deepEqual(snapshot(f.root), before);
  const revision = f.call('inspect').revision;
  fs.appendFileSync(path.join(f.root, 'bots/helper/AGENTS.md'), '\nNew user rule.\n');
  reject(f, 'record-handoff', { schema_version: 1, packet: packet(), delivery: { state: 'sent', evidence: ['Reported receipt'] } }, /revision|changed|conflict/i, ['--expected-revision', revision]);
});

for (const kind of ['broken', 'cyclic']) test(`${kind} discovered skill link has deterministic visible diagnostics`, (t) => {
  const f = fixture(t); f.call('plan-notices');
  const selected = path.join(f.root, `bots/helper/.agents/skills/${kind}`);
  fs.symlinkSync(kind === 'broken' ? path.join(f.base, 'missing-skill') : selected, selected);
  const first = run(f.root, 'plan-notices'), second = run(f.root, 'plan-notices');
  assert.equal(second.status, first.status);
  assert.match(first.stdout + first.stderr, /broken|missing|cycle|cyclic|loop|ENOENT|ELOOP/i);
  assert.equal(second.stdout + second.stderr, first.stdout + first.stderr, 'same unusable link must have stable diagnosis');
});

test('management receipt directory cannot redirect writes outside Bot Father', (t) => {
  const f = fixture(t), state = path.join(f.root, 'bots/bot-father/.bot-kit');
  // Preserve any prepared state, but redirect the managed write location to an unowned sibling.
  if (fs.existsSync(state)) fs.renameSync(state, path.join(f.base, 'saved-father-state'));
  const outside = path.join(f.base, 'outside-receipts'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, state);
  reject(f, 'record-handoff', { schema_version: 1, packet: packet(), delivery: { state: 'sent', evidence: ['Synthetic observation'] } }, /link|path|outside|directory|managed/i);
  assert.deepEqual(fs.readdirSync(outside), [], 'receipt cannot escape through symlink');
});
