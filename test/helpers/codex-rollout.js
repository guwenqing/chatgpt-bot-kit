// A Codex session's own record, its rollout, read for the tool calls it made
// and the answers they got (#432's live probe). A rollout also holds everything
// the session and the user said, so only its `function_call` and
// `function_call_output` entries are read, and of those only the tool's name,
// the call id and the time; a sleep call's duration is read out of its
// arguments and nothing else of them. See test/codex-rollout.test.js.

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** The rollout files of the conversation `id` under Codex's sessions folder `dir`: found by name, under any day. */
export function rolloutFilesOf(dir, id) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((name) => path.basename(name).endsWith(`-${id}.jsonl`))
    .map((name) => path.join(dir, name));
}

/** The whole lines of a rollout, as JSON: a line still being written, or not JSON, is left out. */
function entriesOf(text) {
  return String(text).split('\n').flatMap((raw) => {
    try {
      return [JSON.parse(raw)];
    } catch {
      return [];
    }
  });
}

/**
 * The tool calls and their answers in a rollout, in its order: `{ calls: [{ at,
 * name, callId }], outputs: [{ at, callId }] }`, `at` in milliseconds.
 */
export function functionCallsIn(text) {
  const found = { calls: [], outputs: [] };
  for (const entry of entriesOf(text)) {
    const item = entry?.type === 'response_item' ? entry.payload : undefined;
    const at = Date.parse(entry?.timestamp);
    if (item?.type === 'function_call') found.calls.push({ at, name: item.name, callId: item.call_id });
    else if (item?.type === 'function_call_output') found.outputs.push({ at, callId: item.call_id });
  }
  return found;
}

/**
 * What each turn of a rollout ran on, in its order: `{ at, model, effort }` out
 * of every `turn_context` entry, `at` in milliseconds, a field Codex did not
 * write as a string null (#238's live check). Nothing else of the entry is read.
 */
export function turnSettingsIn(text) {
  return entriesOf(text)
    .filter((entry) => entry?.type === 'turn_context')
    .map((entry) => ({
      at: Date.parse(entry.timestamp),
      model: typeof entry.payload?.model === 'string' ? entry.payload.model : null,
      effort: typeof entry.payload?.effort === 'string' ? entry.payload.effort : null,
    }));
}

/** Whether a tool is Codex's sleep: `sleep`, or `sleep` under a namespace such as `clock.sleep`. */
const isSleep = (name) => typeof name === 'string' && /(?:^|\.)sleep$/.test(name);

/** How long a sleep call asked for, in milliseconds, or null when its arguments cannot be read. */
function durationOf(item) {
  try {
    const { duration_ms: ms } = JSON.parse(item.arguments);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

/**
 * Each sleep call in a rollout: `{ at, callId, durationMs, endedAt }`, with
 * `endedAt` the time its answer was written, or null while it sleeps.
 */
export function sleepCallsIn(text) {
  const entries = entriesOf(text);
  const ended = new Map();
  for (const entry of entries) {
    const item = entry?.type === 'response_item' ? entry.payload : undefined;
    if (item?.type === 'function_call_output' && !ended.has(item.call_id)) ended.set(item.call_id, Date.parse(entry.timestamp));
  }
  return entries.flatMap((entry) => {
    const item = entry?.type === 'response_item' ? entry.payload : undefined;
    if (item?.type !== 'function_call' || !isSleep(item.name)) return [];
    return [{ at: Date.parse(entry.timestamp), callId: item.call_id, durationMs: durationOf(item), endedAt: ended.get(item.call_id) ?? null }];
  });
}
