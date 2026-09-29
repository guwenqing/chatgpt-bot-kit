// Orca not answering. Before any Orca work, `init` and `up` check that Orca is
// there: `orca status --json` saying `ok: true` with a runtime that calls
// itself reachable. When it does not, the command changes nothing at all — no
// folder seeded, no file written — and exits 1 with a message, not a stack.
//
// A call that fails later passes Orca's own message on, so the person reading
// it learns what Orca refused, not that some promise rejected.

import assert from 'node:assert/strict';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  assertCleanFailure,
  createSandbox,
  orcaCallsOf,
  orcaCommand,
  skipGit,
  snapshot,
} from './helpers/cli.js';

/** Orca was asked whether it is there, and nothing else was asked of it. */
async function assertOnlyAskedForStatus(box) {
  assert.deepEqual(
    (await box.orca.calls()).map(orcaCommand),
    ['status'],
    'once Orca is out, the kit must stop asking it for things',
  );
}

/** Every way Orca can be out, and how the fake is told to behave that way. */
const OUTAGES = {
  'a status that answers nothing but an error code': { crash: { command: 'status', exitCode: 1, stderr: 'orca: could not reach the app\n' } },
  'a status that prints something other than JSON': { garbage: { command: 'status', text: 'Orca is starting up…\n' } },
  'a status that answers ok: false': { status: { id: 'x', ok: false, error: { code: 'runtime_unavailable', message: 'the runtime is not running' } } },
  'a status that answers null': { status: null },
  'a runtime that is not reachable': { reachable: false },
  'a status with no runtime in it': { status: { id: 'x', ok: true, result: { app: { running: true } } } },
};

for (const [label, outage] of Object.entries(OUTAGES)) {
  test(`init stops at ${label} and writes nothing`, async (t) => {
    const box = await createSandbox(t);
    await box.orca.set(outage);

    const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

    assertCleanFailure(result);
    assert.match(result.stderr, /orca/i, `the message should name Orca, got: ${result.stderr}`);
    assert.ok(result.stderr.includes('OBK_ORCA'), `should say how to point the kit at Orca, got: ${result.stderr}`);
    assert.deepEqual(await readdir(box.cwd), [], 'nothing at all should have been written');
    await assertOnlyAskedForStatus(box);
  });
}

test('init stops when the Orca CLI is not there at all, and writes nothing', async (t) => {
  const box = await createSandbox(t);
  const missing = path.join(box.root, 'no-such-place', 'orca');

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude'], {
    env: { ...box.env, OBK_ORCA: missing },
  });

  assertCleanFailure(result);
  assert.match(result.stderr, /orca/i, `the message should name Orca, got: ${result.stderr}`);
  assert.ok(result.stderr.includes('OBK_ORCA'), `should say how to point the kit at Orca, got: ${result.stderr}`);
  assert.deepEqual(await readdir(box.cwd), []);
  assert.deepEqual(await box.orca.calls(), [], 'the fake was not the CLI this run looked for');
});

test('init passes on what Orca said when its status failed', async (t) => {
  const box = await createSandbox(t);
  await box.orca.set({
    status: { id: 'x', ok: false, error: { code: 'runtime_unavailable', message: 'the runtime is not running' } },
  });

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.ok(
    result.stderr.includes('the runtime is not running'),
    `should pass Orca's own message on, got: ${result.stderr}`,
  );
});

test('up stops when Orca is out, and changes no file', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const before = await snapshot(bots, skipGit);
  const calls = (await box.orca.calls()).length;
  await box.orca.set({ reachable: false });

  const result = await box.run(['up', '--bots', 'bots']);

  assertCleanFailure(result);
  assert.deepEqual(await snapshot(bots, skipGit), before, 'every file should be byte-identical');
  assert.deepEqual(
    (await box.orca.calls()).slice(calls).map(orcaCommand),
    ['status'],
    'once Orca is out, the kit must stop asking it for things',
  );
});

for (const command of [
  'project setups',
  'repo add',
  'project setup-update',
  'terminal list',
  'terminal create',
  'terminal send',
]) {
  test(`init passes on what Orca said when \`${command}\` failed`, async (t) => {
    const box = await createSandbox(t);
    await box.orca.set({ fail: { [command]: { code: 'orca_refused', message: `${command} is not having it today` } } });

    const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

    assertCleanFailure(result);
    assert.ok(
      result.stderr.includes(`${command} is not having it today`),
      `should pass Orca's own message on, got: ${result.stderr}`,
    );
  });
}

test('a wait that runs out of time is not a failure: it means no harness came up', async (t) => {
  // The one refusal the kit swallows. `tui-idle` asks about a TUI, and a tab
  // that has none is refused with `timeout`, however long the wait. After the
  // harness has been typed in, that answer means it did not start — which the
  // run reports and carries on from.
  const box = await createSandbox(t);
  await box.orca.set({ fail: { 'terminal wait': { code: 'timeout', message: 'timeout' } } });

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assert.equal(result.code, 0, `a harness that did not come up is not a failure: ${result.stderr}`);
  assert.equal(result.stderr, '');
  assert.ok(result.stdout.includes('Bot Father daily'), `should name the tab, got: ${result.stdout}`);
});

test('any other refusal from a wait is passed on, and the run fails', async (t) => {
  // Only `timeout` means "busy". Anything else is Orca refusing, and the kit
  // must not swallow it.
  const box = await createSandbox(t);
  await box.orca.set({
    fail: { 'terminal wait': { code: 'terminal_not_found', message: 'no terminal with handle term_7' } },
  });

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.ok(
    result.stderr.includes('no terminal with handle term_7'),
    `should pass Orca's own message on, got: ${result.stderr}`,
  );
});

test('init reports an Orca call that died without answering', async (t) => {
  const box = await createSandbox(t);
  await box.orca.set({
    crash: { command: 'terminal list', exitCode: 2, stderr: 'orca: the runtime went away\n' },
  });

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.match(result.stderr, /orca/i, `the message should name Orca, got: ${result.stderr}`);
});

test('init reports an Orca answer that is not JSON', async (t) => {
  const box = await createSandbox(t);
  await box.orca.set({ garbage: { command: 'project setups', text: 'Setups:\n  bot-father\n' } });

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.match(result.stderr, /orca/i, `the message should name Orca, got: ${result.stderr}`);
});

test('a failed Orca call opens no half a workspace', async (t) => {
  const box = await createSandbox(t);
  await box.orca.set({ fail: { 'terminal create': { code: 'selector_not_found', message: 'no worktree matches' } } });

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.deepEqual(await box.orca.terminals(), [], 'a create that fails leaves no tab');
});

// ---------------------------------------------------------------------------
// An answer that is not JSON says what Orca did say (#438)
// ---------------------------------------------------------------------------
//
// "Orca answered <command> with something that is not JSON" was all a failure
// on CI carried, and nothing in it could say whether Orca, the fake or the kit
// was at fault. So the error names the command, Orca's exit status, and what it
// printed on each stream, each cut to a bounded length with "…" where it was
// cut, so that a huge answer does not flood the message. It stays a message:
// what Orca printed is carried so that no line of it reads as a stack frame of
// the kit's own.

/** The exit status, as a number the message gives after a word for it. */
const statusSaid = (said, code) => new RegExp(String.raw`\b(?:exit(?:ed)?|status|code)\b[^\n\d]{0,20}\b${code}\b`, 'i').test(said);

test('#438 an Orca answer that is not JSON is passed on: the command, the exit status and what it printed', async (t) => {
  const box = await createSandbox(t);
  await box.orca.set({ garbage: { command: 'project setups', text: 'Setups:\n  bot-father\n' } });

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('project setups'), `the message names the command, got: ${result.stderr}`);
  assert.ok(statusSaid(result.stderr, 0), `and Orca's exit status, 0, got: ${result.stderr}`);
  assert.ok(result.stderr.includes('Setups:') && result.stderr.includes('bot-father'), `and what it printed, got: ${result.stderr}`);
});

test('#438 an Orca that died with half an answer is passed on: its exit status, its output and its own words on stderr', async (t) => {
  const box = await createSandbox(t);
  await box.orca.set({
    crash: { command: 'project setups', exitCode: 3, stdout: '{"id":"x","ok":tr', stderr: 'orca: the store is locked by pid 4242\n' },
  });

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('project setups'), `the message names the command, got: ${result.stderr}`);
  assert.ok(statusSaid(result.stderr, 3), `and Orca's exit status, 3, got: ${result.stderr}`);
  assert.ok(result.stderr.includes('{"id":"x","ok":tr'), `and the half answer it printed, got: ${result.stderr}`);
  assert.ok(result.stderr.includes('the store is locked by pid 4242'), `and what it said on stderr, got: ${result.stderr}`);
});

test('#438 an Orca that died printing nothing is passed on with its exit status and its stderr', async (t) => {
  const box = await createSandbox(t);
  await box.orca.set({ crash: { command: 'terminal list', exitCode: 2, stderr: 'orca: the runtime went away\n' } });

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('terminal list'), `the message names the command, got: ${result.stderr}`);
  assert.ok(statusSaid(result.stderr, 2), `and Orca's exit status, 2, got: ${result.stderr}`);
  assert.ok(result.stderr.includes('the runtime went away'), `and its own words, got: ${result.stderr}`);
});

test('#438 a huge answer on either stream is cut short, with "…" where it was cut', async (t) => {
  // 5,000 characters on each stream, a marker at the start and one far past
  // any bound a message could be held to.
  const long = (tag) => `${tag}-HEAD ${'x'.repeat(4000)} ${tag}-TAIL ${'y'.repeat(900)}`;
  const box = await createSandbox(t);
  await box.orca.set({ crash: { command: 'project setups', exitCode: 1, stdout: long('OUT'), stderr: long('ERR') } });

  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);

  assertCleanFailure(result);
  for (const tag of ['OUT', 'ERR']) {
    assert.ok(result.stderr.includes(`${tag}-HEAD`), `the start of what Orca printed is there, got: ${result.stderr.slice(0, 2000)}`);
    assert.ok(!result.stderr.includes(`${tag}-TAIL`), `and not what comes 4,000 characters later, got ${result.stderr.length} characters`);
  }
  assert.ok(result.stderr.includes('…'), `and it says where it was cut, got: ${result.stderr.slice(0, 2000)}`);
  assert.ok(result.stderr.length < 3000, `a bounded message, not both streams whole: ${result.stderr.length} characters`);
});

test('#438 a fake Orca that reads its world half written dies saying so, and the kit passes its words on as a message', async (t) => {
  // The race's signature (#438): a fake reading state.json while another is
  // part way through saving it. Forced here: the call hangs after reading the
  // file once, the file is left half written while it waits, and the fake then
  // reads it again, as it does after a hang (helpers/fake-orca.js), and cannot
  // parse it. The sandbox's shim prints the fake's error and exits 70.
  const box = await createSandbox(t);
  await box.orca.set({ hang: { command: 'project setups', ms: 3000 } });
  const running = box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  for (let tries = 0; orcaCallsOf(await box.orca.calls(), 'project setups').length === 0; tries += 1) {
    assert.ok(tries < 200, 'init should have asked for the project setups within ten seconds');
    await sleep(50);
  }
  await writeFile(path.join(box.root, 'orca-fake', 'state.json'), '{"setups": [{"id": "repo_1", "pa');

  const result = await running;

  assertCleanFailure(result);
  assert.ok(result.stderr.includes('project setups'), `the message names the command, got: ${result.stderr}`);
  assert.ok(statusSaid(result.stderr, 70), `and the fake's exit status, 70, got: ${result.stderr}`);
  assert.ok(result.stderr.includes('fake orca'), `and the fake's own words from its stderr, got: ${result.stderr}`);
  assert.match(result.stderr, /SyntaxError|JSON/, `which say it could not parse its world, got: ${result.stderr}`);
});
