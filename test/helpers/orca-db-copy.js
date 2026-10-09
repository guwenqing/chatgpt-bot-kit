// Read the settings document out of an Orca profile-state.db that Orca holds
// open, without opening Orca's own file (#507). The system test reads the real
// machine's settings with it; test/orca-db-copy.test.js checks it against a
// fixture, since nothing in test/system/ may run in the unit suite.
//
// Orca keeps the db in WAL mode, and its current settings may be in the -wal
// alone. So this copies the -wal and the db into a throwaway folder, reads the
// copy, and removes the copy, however the read ends. Copying only reads Orca's
// files.
//
// The order is the point. The -wal is copied first, then the db. When Orca
// checkpoints between the two copies, the db copy already holds what the -wal
// copy holds, so the copy shows the committed settings. The other way round, a
// checkpoint between the copies leaves an old db copy and an empty -wal copy,
// and a committed change is lost.

import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * The settings document in the profile-state.db at `db`, parsed, or undefined
 * when there is no db, it cannot be read, or it has no settings document.
 *
 * `afterWalCopy` runs between the two copies. It exists for the check in
 * test/orca-db-copy.test.js, which checkpoints the fixture there.
 */
export async function settingsInDb(db, { afterWalCopy = async () => {} } = {}) {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'obk-orca-db-copy-'));
  try {
    const copy = path.join(scratch, 'profile-state.db');
    try {
      await copyFile(`${db}-wal`, `${copy}-wal`);
    } catch {
      // No -wal: everything is in the db file.
    }
    await afterWalCopy();
    try {
      await copyFile(db, copy);
    } catch {
      return undefined;
    }
    const reader = new DatabaseSync(copy, { readOnly: true });
    try {
      const row = reader.prepare("SELECT payload FROM profile_state_documents WHERE domain = 'settings'").get();
      return row === undefined ? undefined : JSON.parse(row.payload);
    } finally {
      reader.close();
    }
  } catch {
    return undefined;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
