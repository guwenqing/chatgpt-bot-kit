// The reading of a Codex session's own record, its rollout, that #432's live
// probe makes (test/helpers/codex-rollout.js): the tool calls the session made
// and the answers they got, by call id, with their times, and nothing else in
// the file. A rollout also holds everything the session and the user said, so
// only `function_call` and `function_call_output` entries are ever read.
//
// Seen in #240's live set (Codex 0.158.0, gpt-6-astra, the rollout named on
// #432): a bot told to wait called `sleep` with `{"duration_ms":43200000}` and
// its turn did not end.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { functionCallsIn, rolloutFilesOf, sleepCallsIn } from './helpers/codex-rollout.js';

/** A secret word in what the session said: the reading must never hand it back. */
const SECRET = 'SECRET-SAID-7713';

/** One rollout line, as Codex writes them: `{ timestamp, type, payload }`. */
const line = (timestamp, type, payload) => JSON.stringify({ timestamp, type, payload });

/** A rollout: a meta line, a user turn, a sleep call and its answer, a shell call left unanswered, and a line cut off. */
const ROLLOUT = [
  line('2026-09-28T20:14:50.000Z', 'session_meta', { id: 'abc', cwd: '/tmp/x', instructions: SECRET }),
  line('2026-09-28T20:14:59.000Z', 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: SECRET }] }),
  line('2026-09-28T20:15:00.000Z', 'response_item', { type: 'function_call', name: 'sleep', arguments: '{"duration_ms":43200000}', call_id: 'call_sleep1' }),
  line('2026-09-28T20:15:01.000Z', 'event_msg', { type: 'agent_message', message: SECRET }),
  line('2026-09-28T20:16:30.500Z', 'response_item', { type: 'function_call_output', call_id: 'call_sleep1', output: `woke: ${SECRET}` }),
  line('2026-09-28T20:16:31.000Z', 'response_item', { type: 'function_call', name: 'exec_command', arguments: `{"cmd":"echo ${SECRET}"}`, call_id: 'call_shell1' }),
  line('2026-09-28T20:17:00.000Z', 'response_item', { type: 'function_call', name: 'clock.sleep', arguments: '{"duration_ms":60000}', call_id: 'call_sleep2' }),
  '{"timestamp":"2026-09-28T20:17:01.000Z","type":"response_item","payload":{"type":"function_call_out',
].join('\n');

test('the reading gives each tool call and each answer, by call id and time, and nothing the session said', () => {
  const found = functionCallsIn(ROLLOUT);
  assert.deepEqual(found, {
    calls: [
      { at: Date.parse('2026-09-28T20:15:00.000Z'), name: 'sleep', callId: 'call_sleep1' },
      { at: Date.parse('2026-09-28T20:16:31.000Z'), name: 'exec_command', callId: 'call_shell1' },
      { at: Date.parse('2026-09-28T20:17:00.000Z'), name: 'clock.sleep', callId: 'call_sleep2' },
    ],
    outputs: [{ at: Date.parse('2026-09-28T20:16:30.500Z'), callId: 'call_sleep1' }],
  });
  assert.ok(!JSON.stringify(found).includes(SECRET), 'no word of what was said, or of a call\'s arguments or answer');
  assert.deepEqual(functionCallsIn(''), { calls: [], outputs: [] }, 'an empty rollout has none');
});

test('each sleep call, however its tool is named, with its duration, and when its answer came, or null while it sleeps', () => {
  assert.deepEqual(sleepCallsIn(ROLLOUT), [
    { at: Date.parse('2026-09-28T20:15:00.000Z'), callId: 'call_sleep1', durationMs: 43200000, endedAt: Date.parse('2026-09-28T20:16:30.500Z') },
    { at: Date.parse('2026-09-28T20:17:00.000Z'), callId: 'call_sleep2', durationMs: 60000, endedAt: null },
  ]);
  const unreadable = line('2026-09-28T20:18:00.000Z', 'response_item', { type: 'function_call', name: 'sleep', arguments: 'not json', call_id: 'call_sleep3' });
  assert.deepEqual(sleepCallsIn(unreadable), [
    { at: Date.parse('2026-09-28T20:18:00.000Z'), callId: 'call_sleep3', durationMs: null, endedAt: null },
  ], 'a duration that cannot be read is null');
  const notANumber = line('2026-09-28T20:18:30.000Z', 'response_item', { type: 'function_call', name: 'sleep', arguments: '{"duration_ms":"soon"}', call_id: 'call_sleep4' });
  assert.equal(sleepCallsIn(notANumber)[0].durationMs, null, 'and so is one that is not a number');
  assert.deepEqual(sleepCallsIn(line('2026-09-28T20:19:00.000Z', 'response_item', { type: 'function_call', name: 'sleepy_tool', arguments: '{}', call_id: 'x' })), [], 'a tool whose name only begins with sleep is not one');
});

test('the rollout files of one conversation are found by its id, under any day, and no other', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'obk-rollout-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const id = '0199f0aa-1111-7222-8333-444455556666';
  await mkdir(path.join(dir, '2026', '09', '28'), { recursive: true });
  await mkdir(path.join(dir, '2026', '09', '29'), { recursive: true });
  const mine = [
    path.join(dir, '2026', '09', '28', `rollout-2026-09-28T20-14-50-${id}.jsonl`),
    path.join(dir, '2026', '09', '29', `rollout-2026-09-29T01-00-00-${id}.jsonl`),
  ];
  for (const file of mine) await writeFile(file, '');
  await writeFile(path.join(dir, '2026', '09', '28', 'rollout-2026-09-28T20-14-50-0199f0aa-1111-7222-8333-000000000000.jsonl'), '');
  await writeFile(path.join(dir, '2026', '09', '28', `rollout-2026-09-28T20-14-50-${id}.jsonl.bak`), '');

  assert.deepEqual(rolloutFilesOf(dir, id).sort(), mine.sort());
  assert.deepEqual(rolloutFilesOf(path.join(dir, 'missing'), id), [], 'no sessions folder is no files');
});
