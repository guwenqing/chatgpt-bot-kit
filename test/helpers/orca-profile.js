// Orca's own settings store as Orca 1.4.223 keeps it, built in a sandbox (#507).
//
// From 1.4.223 Orca no longer writes `orca-data.json`. Each profile folder
// under `~/Library/Application Support/orca/profiles/` holds `profile-state.db`
// instead: SQLite, in WAL mode, held open by Orca, with its `-wal` and `-shm`
// beside it. The settings are one JSON document in the table
// `profile_state_documents`, in the row whose `domain` is `settings`
// (`domain_version` 1), and that document carries `agentDefaultArgs` at its top
// level, the same mapping the old file kept under `settings`.
//
// The fixture here is that shape and no more: the real table, one settings
// row, and only the fields a test needs. It is never a copy of a real profile.
//
// And it is held open the way Orca holds it, for as long as the test runs: the
// writer keeps its connection, never checkpoints on its own, and so whatever it
// wrote after `settledSettings` is in the `-wal` alone. The kit has to read the
// settings as Orca would see them now, which includes that.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Orca's profile folders, inside a sandbox's home directory. */
export const profilesOf = (box) => path.join(box.home, 'Library', 'Application Support', 'orca', 'profiles');

/** One profile folder; `local-default` is the one the sandbox seeds. */
export const profileOf = (box, name = 'local-default') => path.join(profilesOf(box), name);

/** The file Orca 1.4.223 keeps its profile state in. */
export const DB_NAME = 'profile-state.db';

/** The table, as Orca 1.4.223 makes it. */
const TABLE = 'CREATE TABLE profile_state_documents ('
  + 'domain TEXT PRIMARY KEY, payload TEXT, domain_version, revision, updated_at, content_hash)';

/**
 * A settings document: `agentDefaultArgs` at the top level among other
 * settings, or no `agentDefaultArgs` at all when it is given as undefined.
 */
const documentOf = (agentDefaultArgs) => JSON.stringify(
  agentDefaultArgs === undefined ? { theme: 'system' } : { theme: 'system', agentDefaultArgs },
);

const hashOf = (text) => createHash('sha256').update(text).digest('hex');

/**
 * Build `profile-state.db` in `dir` and hold it open as Orca does, until the
 * test ends.
 *
 * - `settledSettings`: the `agentDefaultArgs` of a settings document that is
 *   written and then checkpointed into the db file itself. `null` writes no
 *   settings row at all.
 * - `walSettings`: when given, the settings document is then changed to carry
 *   this `agentDefaultArgs`, and that change stays in the `-wal` alone. These
 *   are Orca's current settings.
 * - `exclusive`: the writer holds the db in `locking_mode = EXCLUSIVE`, so any
 *   other SQLite open of this file is refused, and no `-shm` is made.
 *
 * - `walChurn`: that many more changes to the settings document, each one
 *   harmless and committed on its own, written to the `-wal` before
 *   `walSettings`. About 4 KB of `-wal` each, so 40000 make a `-wal` of some
 *   160 MB, which takes the kit a while to copy.
 *
 * Pass `{ absent: true }` as either settings argument for a settings document
 * that has no `agentDefaultArgs` in it at all.
 */
export async function orcaProfileDb(t, dir, { settledSettings = null, walSettings, exclusive = false, walChurn = 0 } = {}) {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, DB_NAME);
  const db = new DatabaseSync(file);
  t.after(() => { if (db.isOpen) db.close(); });

  db.exec('PRAGMA journal_mode = WAL');
  if (exclusive) db.exec('PRAGMA locking_mode = EXCLUSIVE');
  db.exec('PRAGMA wal_autocheckpoint = 0');
  // Only the fixture's own speed: nothing here survives a crash anyway.
  if (walChurn > 0) db.exec('PRAGMA synchronous = OFF');
  db.exec(TABLE);
  // Another domain beside the settings, as a real store has.
  db.prepare('INSERT INTO profile_state_documents VALUES (?, ?, 1, 1, ?, ?)')
    .run('workspace', '{"open":[]}', Date.now(), hashOf('{"open":[]}'));
  if (settledSettings !== null) {
    const payload = documentOf(argsOf(settledSettings));
    db.prepare('INSERT INTO profile_state_documents VALUES (?, ?, 1, 1, ?, ?)')
      .run('settings', payload, Date.now(), hashOf(payload));
  }
  db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all();

  if (walChurn > 0) {
    assert.ok(settledSettings !== null, 'the fixture: churn changes a settings row, so it needs one');
    const churn = db.prepare("UPDATE profile_state_documents SET payload = ?, revision = ? WHERE domain = 'settings'");
    for (let i = 0; i < walChurn; i += 1) {
      churn.run(JSON.stringify({ theme: 'system', agentDefaultArgs: argsOf(settledSettings), churn: i }), i + 2);
    }
  }

  if (walSettings !== undefined) {
    const payload = documentOf(argsOf(walSettings));
    const changed = settledSettings === null
      ? db.prepare('INSERT INTO profile_state_documents VALUES (?, ?, 1, 2, ?, ?)')
        .run('settings', payload, Date.now(), hashOf(payload))
      : db.prepare('UPDATE profile_state_documents SET payload = ?, revision = 2, updated_at = ?, content_hash = ? WHERE domain = ?')
        .run(payload, Date.now(), hashOf(payload), 'settings');
    assert.equal(changed.changes, 1, 'the fixture should have changed the settings row in the -wal');
  }

  return { file, db };
}

/** `{ absent: true }` is a document with no `agentDefaultArgs` in it; anything else is the mapping. */
const argsOf = (given) => (given !== null && typeof given === 'object' && given.absent === true ? undefined : given);

/**
 * What the db file alone says, without its `-wal`: read from a copy of the
 * main file, made by the test in a folder of its own outside TMPDIR and the
 * profile. A test uses it to prove its fixture holds the newer settings in the
 * `-wal` only, so a kit that ignored the `-wal` would read the older ones.
 */
export async function settledArgsIn(box, file) {
  const scratch = await mkdtemp(path.join(box.root, 'db-file-alone-'));
  const copy = path.join(scratch, DB_NAME);
  await copyFile(file, copy);
  const db = new DatabaseSync(copy, { readOnly: true });
  try {
    const row = db.prepare("SELECT payload FROM profile_state_documents WHERE domain = 'settings'").get();
    return row === undefined ? undefined : JSON.parse(row.payload).agentDefaultArgs;
  } finally {
    db.close();
  }
}

/** Write a `profile-state.db` that is not a SQLite file at all. */
export async function notADb(dir) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, DB_NAME), 'this is not a SQLite database\n');
}

/** Write an older Orca's `orca-data.json` into a profile folder: everything under one `settings` key. */
export async function orcaDataJson(dir, agentDefaultArgs) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'orca-data.json'), `${JSON.stringify({ settings: { agentDefaultArgs } }, null, 2)}\n`);
}

/** Every file in a folder, by name, with a hash of its bytes: what "untouched" is held to. */
export async function filesIn(dir) {
  const out = {};
  for (const name of (await readdir(dir)).sort()) {
    out[name] = hashOf(await readFile(path.join(dir, name)));
  }
  return out;
}
