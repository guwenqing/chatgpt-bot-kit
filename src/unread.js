// The kit's hint of the fleet mail it sent and that is not read yet (#509, ADR 0035).
//
// The mailbox is the record of a message; this is not. It is what the kit
// itself knows: a send writes one file for the message, `obk message check`
// takes out what it read, and a retire says what is left. A Claude session's
// turn-end hook reads it first, so a session with no mail asks Orca nothing,
// and asks Orca before it tells, so a stale entry tells nothing.
//
// It sits in the system temp folder because a sender inside Codex's sandbox
// may write there and nowhere outside its own bot (#350). So it is private:
// every folder the kit makes here is 0700, every file 0600, and a file holds
// who sent the message and its subject, never its body. A temp clean-up loses
// it, and loses no mail: the message still waits in the mailbox.
//
// One file for each message, `<session folder>/<message id>.json`, so senders
// writing at once never write the same file; and a `<message id>.told` beside
// it once the session's hook told it, so it is told once.

import { mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Where the hint lives. */
export const unreadRoot = () => path.join(os.tmpdir(), 'obk-unread');

/** One session's folder: its bot home, by its real path, and its name. */
function sessionDir(home, session) {
  let real = home;
  try {
    real = realpathSync(home);
  } catch {
    // A home that is gone is named as it was given.
  }
  return path.join(unreadRoot(), encodeURIComponent(real), encodeURIComponent(session));
}

/** A message id as a file name: Orca's ids are plain, and anything else is made plain. */
const fileOf = (id) => encodeURIComponent(String(id));

/**
 * Note one message sent to `session` of the bot at `home`: `{ id, from, subject,
 * at }`. Quiet whatever happens: the message is sent either way.
 */
export function noteUnread(home, session, { id, from, subject, at }) {
  if (id === undefined) return;
  try {
    const dir = sessionDir(home, session);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${fileOf(id)}.json`);
    // Written aside, then put in place whole: a reader never takes half a file.
    writeFileSync(`${file}.${process.pid}.writing`, `${JSON.stringify({ id, from, subject, at })}\n`, { mode: 0o600 });
    renameSync(`${file}.${process.pid}.writing`, file);
  } catch {
    // Nothing: the hint is lost, the mail is not.
  }
}

/**
 * What the hint holds for `session`: `[{ id, from, subject, at, told }]`,
 * oldest first. An entry that cannot be read is left out. A folder that is not
 * there is no mail; one that cannot be read throws, for the caller to stay
 * quiet about.
 */
export function unreadOf(home, session) {
  const dir = sessionDir(home, session);
  let names;
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const told = new Set(names.filter((name) => name.endsWith('.told')).map((name) => name.slice(0, -'.told'.length)));
  return names
    .filter((name) => name.endsWith('.json'))
    .flatMap((name) => {
      try {
        const entry = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
        if (entry === null || typeof entry !== 'object' || typeof entry.from !== 'string' || typeof entry.subject !== 'string') return [];
        return [{ id: entry.id, from: entry.from, subject: entry.subject, at: entry.at, told: told.has(name.slice(0, -'.json'.length)) }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/**
 * Mark these messages told. Throws when a mark cannot be written: a hook that
 * cannot remember it told must not tell, or it would tell again.
 */
export function markTold(home, session, ids) {
  const dir = sessionDir(home, session);
  for (const id of ids) writeFileSync(path.join(dir, `${fileOf(id)}.told`), '', { mode: 0o600 });
}

/** Take these messages out: they were read. Quiet whatever happens. */
export function forgetUnread(home, session, ids) {
  const dir = sessionDir(home, session);
  for (const id of ids) {
    for (const end of ['.json', '.told']) {
      try {
        rmSync(path.join(dir, `${fileOf(id)}${end}`), { force: true });
      } catch {
        // Nothing: a stale entry tells nothing, since the hook asks Orca first.
      }
    }
  }
}

/**
 * What the hint holds for a session that is going, as a retire says it:
 * `{ count, from: [<bot>/<session>, …] }`, or undefined when nothing; and the
 * session's folder is removed. Quiet whatever happens.
 */
export function takeUnread(home, session) {
  let entries = [];
  try {
    entries = unreadOf(home, session);
  } catch {
    // Unreadable: nothing can be said of it.
  }
  try {
    rmSync(sessionDir(home, session), { recursive: true, force: true });
  } catch {
    // Nothing: it is in the temp folder, and holds no body.
  }
  if (entries.length === 0) return undefined;
  return { count: entries.length, from: [...new Set(entries.map((entry) => entry.from))] };
}
