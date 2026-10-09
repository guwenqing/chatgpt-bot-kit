// The reader the system test uses to know what the real machine's Orca settings
// hold (helpers/orca-db-copy.js, #507). The system test holds the kit to what
// this reader says, so a reader that loses a committed change makes the system
// test expect the wrong answer. It cannot be checked in test/system/, which
// never runs in the unit suite, so it is checked here against a fixture.
//
// The case that matters: Orca checkpoints its db while the reader copies it.

import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
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
      const [result] = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all();
      assert.equal(result.busy, 0, 'the fixture: the checkpoint ran to the end');
      assert.equal((await stat(`${file}-wal`)).size, 0, 'the fixture: the checkpoint emptied the -wal');
      checkpointed = true;
    },
  });

  assert.equal(checkpointed, true, 'the reader ran the checkpoint between its copies');
  assert.deepEqual(settings?.agentDefaultArgs, BYPASS, 'a bypass committed before the copies is not lost');
});
