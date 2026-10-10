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
// Three things keep the copy honest while Orca goes on working:
//
//   - The -wal is copied first, then the db. A checkpoint between the two
//     leaves the db copy holding what the -wal copy holds.
//   - Each file is read with readFile, which ends at the end of the file even
//     when the file is truncated under it. On macOS, copyFile does not return
//     when its source is truncated during the copy.
//   - Both files are looked at before and after the copy. When either changed
//     (a checkpoint, a truncation, a new commit), the copy may mix old and new
//     pages, and a partial -wal over a checkpointed db shows older settings. So
//     the copy is thrown away and made again, a few times, and then the reader
//     gives up with an error rather than return settings that may be older.

import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** How many copies to try while Orca's files keep changing under the reader. */
const TRIES = 5;

/** What says a file changed: its identity, size and change time, or that it is not there. */
async function stamp(file) {
  try {
    const { ino, size, mtimeNs, ctimeNs } = await lstat(file, { bigint: true });
    return `${ino}:${size}:${mtimeNs}:${ctimeNs}`;
  } catch (error) {
    if (error.code === 'ENOENT') return 'none';
    throw error;
  }
}

/** The bytes of a file, or undefined when it is not there. */
async function bytesOf(file) {
  try {
    return await readFile(file);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * The settings document in the profile-state.db at `db`, parsed. Undefined when
 * there is no db, or the db has no settings document. Throws when the db is
 * there and cannot be read, including when Orca's files changed during every
 * copy tried.
 *
 * `afterWalCopy` runs between the two copies. It exists for the checks in
 * test/orca-db-copy.test.js, which change the fixture there.
 */
export async function settingsInDb(db, { afterWalCopy = async () => {} } = {}) {
  const wal = `${db}-wal`;
  for (let attempt = 1; attempt <= TRIES; attempt += 1) {
    const before = [await stamp(wal), await stamp(db)];
    if (before[1] === 'none') return undefined;
    const walBytes = await bytesOf(wal);
    await afterWalCopy();
    const dbBytes = await bytesOf(db);
    const after = [await stamp(wal), await stamp(db)];
    if (dbBytes === undefined) return undefined;
    if (before[0] !== after[0] || before[1] !== after[1]) continue;
    return readCopy(dbBytes, walBytes);
  }
  throw new Error(`Orca's files changed during each of ${TRIES} copies of ${db}, so its settings could not be read`);
}

/** Write the copied bytes into a throwaway folder, read the settings there, and remove the folder. */
async function readCopy(dbBytes, walBytes) {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'obk-orca-db-copy-'));
  try {
    const copy = path.join(scratch, 'profile-state.db');
    await writeFile(copy, dbBytes);
    if (walBytes !== undefined) await writeFile(`${copy}-wal`, walBytes);
    const reader = new DatabaseSync(copy, { readOnly: true });
    try {
      const row = reader.prepare("SELECT payload FROM profile_state_documents WHERE domain = 'settings'").get();
      return row === undefined ? undefined : JSON.parse(row.payload);
    } finally {
      reader.close();
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
