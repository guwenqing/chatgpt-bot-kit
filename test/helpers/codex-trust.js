// A system test's Codex session starts trusted by launch-time overrides, so
// Codex writes no folder trust and no hooks trust into the user's own
// ~/.codex/config.toml (#240, option (c)); and the reader a test checks that
// file with, before and after. See test/codex-trust.test.js.

/** A TOML basic string: the same escapes JSON uses, which TOML reads alike. */
const tomlString = (text) => JSON.stringify(text);

/**
 * The `session add` arguments that start a Codex session in the bots folder at
 * `botsRealpath` with no folder-trust question and no hooks review, and with
 * nothing of its own written into config.toml at startup:
 *
 *   -c projects={"<folder>"={trust_level="trusted"}}   the folder's trust, as a
 *                                  whole table in one -c; the dotted key form
 *                                  splits on every `.` and does not work
 *   --dangerously-bypass-hook-trust  no hooks review, so no hooks.state entry;
 *                                  the hooks still run
 *   -c tui.show_tooltips=false     no model-availability notice counted in the
 *                                  file at startup
 *
 * Codex looks for trust at the session's folder and then at its git root, the
 * realpath first, so the bots folder's realpath covers every bot in it.
 */
export const codexTrustArgs = (botsRealpath) => [
  '-c', `projects={${tomlString(botsRealpath)}={trust_level="trusted"}}`,
  '--dangerously-bypass-hook-trust',
  '-c', 'tui.show_tooltips=false',
].map((arg) => `--extra-arg=${arg}`);

/** A table header this reads: `[projects."…"]` or `[hooks.state."…"]`, the key double- or single-quoted. */
const HEADER = /^[ \t]*\[(projects|hooks\.state)\.("(?:[^"\\]|\\.)*"|'[^']*')\][ \t]*(?:#.*)?$/;

/** A quoted TOML key, read back to what it names. */
function keyOf(quoted) {
  if (quoted.startsWith('\'')) return quoted.slice(1, -1);
  try {
    return JSON.parse(quoted);
  } catch {
    return quoted.slice(1, -1);
  }
}

/**
 * The keys of config.toml's `[projects."…"]` and `[hooks.state."…"]` tables, in
 * the order the file has them, as `{ projects, hooks }`. Only those headers are
 * read: the file may hold secrets, and nothing else in it is returned.
 */
export function trustKeysIn(text) {
  const found = { projects: [], hooks: [] };
  for (const line of String(text).split('\n')) {
    const header = HEADER.exec(line);
    if (header === null) continue;
    found[header[1] === 'projects' ? 'projects' : 'hooks'].push(keyOf(header[2]));
  }
  return found;
}

/** The ways a macOS temp path is written: with `/private` in front and without. */
function spellingsOf(folder) {
  const bare = folder.replace(/^\/private(?=\/)/, '');
  return [...new Set([folder, bare, `/private${bare}`])];
}

/**
 * The keys in `after` and not in `before` that name `folder` or a path under
 * it, in either spelling, as `{ projects, hooks }`. A hooks.state key starts
 * with the hooks file's path.
 */
export function addedUnder(before, after, folder) {
  const under = (key) => spellingsOf(folder).some((one) => key === one || key.startsWith(`${one}/`));
  const added = (kind) => after[kind].filter((key) => !before[kind].includes(key) && under(key));
  return { projects: added('projects'), hooks: added('hooks') };
}
