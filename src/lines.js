// A transcript read a line at a time, whatever its size (#396).
//
// A harness's record of a conversation can outgrow what one string holds: a
// Codex rollout of 1.28 GB was seen on a live fleet, and reading it whole
// threw, so the conversation dropped out of the book's lookup and its usage
// without a word. So nothing here reads a file whole. The first line is read
// from the start of the file alone, and a whole transcript goes through a
// chunk at a time, its text decoded across the chunks so that a character
// split between two of them stays whole.
//
// A line longer than any record the kit reads is not held: it comes through as
// `undefined`, for the caller to count as a line it could not read. A file cut
// short and padded (a sparse run of NUL bytes, one enormous "line") is read
// through to its end without being held either.

import { closeSync, openSync, readSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

/** How much is read at a time. */
const CHUNK = 64 * 1024;

/** The longest line held whole. */
const LONGEST = 64 * 1024 * 1024;

/**
 * Each line of `file`, in order, to `onLine`: its text, or `undefined` for a
 * line too long to hold. A line `onLine` answers `true` to is the last one
 * read. With `from`, reading starts at that byte, for a caller that wants only
 * what was written after it (#391). Throws what the file system throws when
 * the file cannot be opened or read.
 */
export function eachLine(file, onLine, { from = 0 } = {}) {
  const fd = openSync(file, 'r');
  try {
    const decoder = new StringDecoder('utf8');
    const buffer = Buffer.allocUnsafe(CHUNK);
    let pending = '';
    let tooLong = false;
    let position = from;
    for (;;) {
      const read = readSync(fd, buffer, 0, CHUNK, position);
      position += read;
      const text = read === 0 ? decoder.end() : decoder.write(buffer.subarray(0, read));
      let start = 0;
      for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', start)) {
        const line = tooLong ? undefined : pending + text.slice(start, at);
        pending = '';
        tooLong = false;
        start = at + 1;
        if (onLine(line) === true) return;
      }
      const rest = text.slice(start);
      if (!tooLong) {
        if (pending.length + rest.length > LONGEST) {
          tooLong = true;
          pending = '';
        } else {
          pending += rest;
        }
      }
      if (read === 0) {
        if (tooLong) onLine(undefined);
        else if (pending !== '') onLine(pending);
        return;
      }
    }
  } finally {
    closeSync(fd);
  }
}

/** The first line of `file`, read from its start alone; `undefined` for an empty file or a first line too long to hold. */
export function firstLine(file) {
  let first;
  eachLine(file, (line) => {
    first = line;
    return true;
  });
  return first;
}
