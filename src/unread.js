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
// writing at once never write the same file; a `<message id>.told` beside it
// once the session's hook told it, so it is told once; and a `<message
// id>.read` once `obk message check` read it, so a send whose answer came back
// after that read does not leave an entry for read mail (#509 review).

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

/** How long a read mark is kept for a send still waiting on Orca's answer. */
const READ_MARK_MS = 60 * 60 * 1000;

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
    // Read already, while the send waited for Orca's answer: the entry is
    // written first and taken out here, and a check writes its mark before it
    // takes an entry out, so in either order no entry is left.
    const read = path.join(dir, `${fileOf(id)}.read`);
    if (existsSync(read)) {
      rmSync(file, { force: true });
      rmSync(read, { force: true });
    }
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

/**
 * Take these messages out: they were read. Each gets a read mark first, for a
 * send still waiting on Orca's answer (see `noteUnread`); marks older than an
 * hour are cleared here, since no send waits that long. Quiet whatever happens.
 */
export function forgetUnread(home, session, ids) {
  const dir = sessionDir(home, session);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const name of readdirSync(dir).filter((one) => one.endsWith('.read'))) {
      if (Date.now() - statSync(path.join(dir, name)).mtimeMs > READ_MARK_MS) rmSync(path.join(dir, name), { force: true });
    }
  } catch {
    // Nothing: a mark that stays is a few bytes in the temp folder.
  }
  for (const id of ids) {
    try {
      writeFileSync(path.join(dir, `${fileOf(id)}.read`), '', { mode: 0o600 });
    } catch {
      // Nothing: the entry is still taken out below.
    }
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
