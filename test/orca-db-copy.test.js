// The reader the system test uses to know what the real machine's Orca settings
// hold (helpers/orca-db-copy.js, #507). The system test holds the kit to what
// this reader says, so a reader that loses a committed change makes the system
// test expect the wrong answer. It cannot be checked in test/system/, which
// never runs in the unit suite, so it is checked here against a fixture.
//
// The case that matters: Orca checkpoints its db while the reader copies it.
// The rule is the kit's own (#507): when Orca's files change during the copy,
// the reader tries again or gives up; it never returns settings older than the
// ones committed before it started, and it always ends.

import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { settingsInDb } from './helpers/orca-db-copy.js';
import { orcaProfileDb } from './helpers/orca-profile.js';

const HARMLESS = { claude: '', codex: '' };
const BYPASS = { claude: '--dangerously-skip-permissions', codex: '' };

async function profileDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'obk-db-copy-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('the reader gives settings that are only in the -wal', async (t) => {
  const { file } = await orcaProfileDb(t, await profileDir(t), { settledSettings: HARMLESS, walSettings: BYPASS });

  const settings = await settingsInDb(file);

  assert.deepEqual(settings?.agentDefaultArgs, BYPASS);
});

test('the reader gives the committed settings when Orca checkpoints (TRUNCATE) between its two copies', async (t) => {
  // Committed before the copies: the bypass, in the -wal. Between the copies
  // the checkpoint moves it into the db file and empties the -wal.
  const { file, db } = await orcaProfileDb(t, await profileDir(t), { settledSettings: HARMLESS, walSettings: BYPASS });
  let checkpointed = false;

  const settings = await settingsInDb(file, {
    afterWalCopy: async () => {
      // Once: one checkpoint between the copies, as in the review's probe.
      if (checkpointed) return;
      const [result] = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all();
      assert.equal(result.busy, 0, 'the fixture: the checkpoint ran to the end');
      assert.equal((await stat(`${file}-wal`)).size, 0, 'the fixture: the checkpoint emptied the -wal');
      checkpointed = true;
    },
  });

  assert.equal(checkpointed, true, 'the reader ran the checkpoint between its copies');
  assert.deepEqual(settings?.agentDefaultArgs, BYPASS, 'a bypass committed before the copies is not lost');
});

/** Harmless changes before the bypass: some 160 MB of -wal, which takes a while to copy. */
const CHURN = 40000;

/** How long one read may take before the test calls it hung. */
const BOUND_MS = 20000;

/** The read's outcome within BOUND_MS: `{ settings }`, `{ error }`, or `{ hung: true }`. */
async function settled(promise) {
  const outcome = promise.then((settings) => ({ settings }), (error) => ({ error }));
  const timer = sleep(BOUND_MS, { hung: true }, { ref: false });
  return Promise.race([outcome, timer]);
}

/** A read that is not hung, and does not return the older settings; it gave the bypass or gave up. */
function assertNotOlder(t, outcome) {
  assert.notEqual(outcome.hung, true, `the read did not end within ${BOUND_MS} ms`);
  t.diagnostic(outcome.error !== undefined ? `the read gave up: ${outcome.error.message}` : `the read gave ${JSON.stringify(outcome.settings?.agentDefaultArgs)}`);
  if (outcome.error !== undefined) return;
  assert.deepEqual(outcome.settings?.agentDefaultArgs, BYPASS, 'the read gave settings older than the ones committed before it started');
}

test('the reader ends, and never gives the older settings, when Orca truncates the -wal while it is copying it', { timeout: 120000 }, async (t) => {
  // The -wal is read whole before `afterWalCopy` runs, so a checkpoint while
  // that has not run yet is a checkpoint during the -wal copy. A fixture where
  // the copy finished first is rebuilt and tried again.
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const dir = await profileDir(t);
    const { file, db } = await orcaProfileDb(t, dir, { settledSettings: HARMLESS, walChurn: CHURN, walSettings: BYPASS });
    let walCopied = false;
    const read = settingsInDb(file, { afterWalCopy: async () => { walCopied = true; } });
    await sleep(5);
    if (walCopied) {
      t.diagnostic(`attempt ${attempt}: the -wal copy finished before the checkpoint`);
      await read;
      db.close();
      continue;
    }
    const [result] = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all();
    assert.equal(result.busy, 0, 'the fixture: the checkpoint ran to the end');
    assert.equal((await stat(`${file}-wal`)).size, 0, 'the fixture: the checkpoint emptied the -wal');
    t.diagnostic(`attempt ${attempt}: checkpoint during the -wal copy`);

    assertNotOlder(t, await settled(read));
    return;
  }
  assert.fail('the checkpoint never landed during the -wal copy in 5 attempts, so this test cannot say anything');
});

test('the reader ends when Orca changes its settings during every copy it makes', { timeout: 60000 }, async (t) => {
  // Every try sees Orca commit another change between its two copies. The
  // reader may try again, but not for ever.
  const { file, db } = await orcaProfileDb(t, await profileDir(t), { settledSettings: HARMLESS, walSettings: BYPASS });
  const change = db.prepare("UPDATE profile_state_documents SET payload = ?, revision = revision + 1 WHERE domain = 'settings'");
  let changes = 0;

  const outcome = await settled(settingsInDb(file, {
    afterWalCopy: async () => {
      changes += 1;
      change.run(JSON.stringify({ theme: 'system', agentDefaultArgs: BYPASS, change: changes }));
    },
  }));

  assert.ok(changes > 0, 'the fixture: Orca changed its settings during the copy');
  assertNotOlder(t, outcome);
});
