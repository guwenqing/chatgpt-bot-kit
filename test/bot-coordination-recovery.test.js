import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import YAML from 'yaml';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'src/cli.js');
const bot = 'bots/bot-father';
function snapshot(root) {
  const entries = {};
  function visit(relative) {
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      const file = path.join(relative, name);
      const absolute = path.join(root, file);
      const stat = fs.lstatSync(absolute);
      entries[file] = stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? `link:${fs.readlinkSync(absolute)}` : fs.readFileSync(absolute).toString('base64');
      if (stat.isDirectory()) visit(file);
    }
  }
  visit('');
  return entries;
}
function fixture(t) {
  const parent = path.join(repo, 'local-data/bot-coordination-test');
  fs.mkdirSync(parent, { recursive: true });
  const base = fs.mkdtempSync(path.join(parent, 'recovery-case-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'workspace');
  fs.mkdirSync(root);
  function run(command, input, args = []) {
    const options = [];
    if (input !== undefined) {
      const file = path.join(base, 'input.yaml');
      fs.writeFileSync(file, YAML.stringify(input));
      options.push('--config', file);
    }
    const result = spawnSync(process.execPath, [cli, command, '--workspace', root, ...options, ...args], { encoding: 'utf8', timeout: 15000 });
    assert.ifError(result.error);
    return result;
  }
  function call(command, input, args) {
    const result = run(command, input, args);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  }
  call('prepare');
  return { root, run, call };
}
function daily(result) {
  const matches = result.notices.filter((notice) => notice.bot === 'bot-father' && notice.session === 'daily');
  assert.equal(matches.length, 1);
  return matches[0];
}
function noticeReceipt(notice, state) {
  return { schema_version: 1, bot: notice.bot, session: notice.session, fingerprint: notice.fingerprint, state, evidence: ['Synthetic receipt observation; no native delivery is asserted.'] };
}
function changePrompt(root, prompt) {
  const file = path.join(root, bot, 'bot.yaml');
  const config = YAML.parse(fs.readFileSync(file, 'utf8'));
  config.sessions.find((session) => session.id === 'daily').startup_prompt = prompt;
  fs.writeFileSync(file, YAML.stringify(config));
}

for (const state of ['pending', 'sent', 'uncertain']) {
  test(`later configuration changes retain earlier unadopted ${state} notice paths`, (t) => {
    const f = fixture(t);
    assert.equal(f.call('plan-notices').status, 'baseline');
    fs.appendFileSync(path.join(f.root, bot, 'AGENTS.md'), '\nUser-wide preference: explain decisions briefly.\n');
    const first = daily(f.call('plan-notices'));
    assert.ok(first.changes.includes(`${bot}/AGENTS.md`));
    if (state !== 'pending') f.call('record-notice', noticeReceipt(first, state));
    changePrompt(f.root, 'Start daily work by asking for the desired result.');
    const next = daily(f.call('plan-notices'));
    assert.notEqual(next.fingerprint, first.fingerprint);
    assert.equal(next.state, 'pending');
    for (const changed of first.changes) {
      assert.ok(next.changes.includes(changed), `unadopted change must remain visible: ${changed}`);
    }
    assert.ok(next.changes.includes(`${bot}/bot.yaml#sessions/daily`), 'the new session change must also be visible');
    assert.deepEqual(daily(f.call('plan-notices')), next, 'unchanged repeat retains the complete unresolved notice');

    f.call('record-notice', noticeReceipt(next, 'adopted'));
    changePrompt(f.root, 'Start daily work by consulting the current user request.');
    const afterAdoption = daily(f.call('plan-notices'));
    assert.equal(afterAdoption.state, 'pending');
    assert.ok(!afterAdoption.changes.includes(`${bot}/AGENTS.md`), 'already adopted changes must not accumulate forever');
  });
}

test('stale routed finding acknowledgement cannot overwrite newer material content when workspace revision is unchanged', (t) => {
  const f = fixture(t);
  const first = { schema_version: 1, id: 'skill-recovery', bot: 'bot-father', summary: 'Skill failed with condition A.',
    evidence: ['Synthetic observation A'], next_action: 'Ask about condition A.', status: 'open', observed_at: '2026-09-12T20:00:00.000Z' };
  const second = { ...first, summary: 'The skill now fails with material condition B.', evidence: ['Synthetic observation B'],
    next_action: 'Ask about condition B.', observed_at: '2026-09-12T20:01:00.000Z' };
  const revision = f.call('inspect').revision;
  assert.equal(f.call('record-finding', first).notify, true);
  assert.equal(f.call('record-finding', second).notify, true);
  assert.equal(f.call('inspect').revision, revision, 'finding receipts are outside the workspace configuration revision');
  const before = snapshot(f.root);
  const stale = f.run('record-finding', { ...first, routed: { evidence: ['Only A was delivered to the daily conversation.'] } }, ['--expected-revision', revision]);
  assert.notEqual(stale.status, 0, 'a routing acknowledgement of older material content must be rejected');
  assert.match(stale.stderr + stale.stdout, /stale|changed|current|version|finding/i);
  assert.deepEqual(snapshot(f.root), before, 'stale acknowledgement must not overwrite B or mark it routed');

  const current = f.call('record-finding', { ...second, observed_at: '2026-09-12T20:02:00.000Z' });
  assert.equal(current.finding.summary, second.summary);
  assert.deepEqual(current.finding.evidence, second.evidence);
  assert.equal(current.finding.next_action, second.next_action);
  assert.equal(current.notify, true, 'B still needs routing');
  const routed = f.call('record-finding', { ...second, routed: { evidence: ['B was delivered to the daily conversation.'] } });
  assert.equal(routed.notify, false, 'a matching acknowledgement may quiet the current finding');
  assert.equal(f.call('record-finding', { ...second, observed_at: '2026-09-12T20:03:00.000Z' }).notify, false);
});
