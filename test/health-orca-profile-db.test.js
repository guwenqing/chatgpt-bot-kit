// Orca's own default launch arguments, read from where Orca 1.4.223 keeps them
// (#507).
//
// `obk health` and `obk init` report Orca's per-agent default launch arguments,
// `agentDefaultArgs`, because when they carry a permission bypass every session
// Orca launches, relaunches or resumes runs in that mode (PRD 6.5). Orca
// 1.4.223 no longer writes `orca-data.json`. Each profile folder holds
// `profile-state.db` instead (SQLite, WAL mode, held open by Orca), and the
// settings are the JSON document in its `profile_state_documents` row whose
// domain is `settings`. A kit that reads only the old file says on every run
// that it "could not read Orca's own settings".
//
// The boundary, from the issue's triage, and the tests that hold each part:
//
//   1. Read-only. The kit never writes Orca's files (the db, its -wal, its
//      -shm) and never holds a lock Orca could wait on. Settings that are in
//      the -wal alone are current settings, and are read.            P4, P5, P6
//   2. Both shapes. The db's settings document first, `orca-data.json` for an
//      older Orca with no db, every profile read. Where a profile has a db with
//      a settings document, the db counts, whatever the json beside it says.
//                                                               P1–P3, P7, P9
//   3. When neither shape reads, the "could not read" finding stays, says
//      where it looked, and is not the bypass sentence. A db that is there and
//      cannot be read is not silent and is not reported as safe.          P8
//   4. A copy of the db, if the kit makes one, is made in a folder of its own
//      under TMPDIR and removed right after the read, on every path.     P10
//   5. `obk init` reports the same finding.                               P11
//   6. Orca checkpoints while the kit copies: health still ends in bounded
//      time, and never reports settings older than the ones committed before
//      it started; it reports the current ones or says it could not read.  P12
//
// Out of scope, and so not pinned: how the db is read, the wording, and what
// health does with the answer (an empty string is no arguments; a harness with
// no entry, or no mapping at all, is Orca's own default, which is the bypass).
//
// Fixtures are small dbs this file builds (helpers/orca-profile.js) with the
// real table shape. Nothing here reads the real Orca profile on this machine.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { createSandbox, snapshot } from './helpers/cli.js';
import {
  filesIn,
  notADb,
  orcaDataJson,
  orcaProfileDb,
  profileOf,
  settledArgsIn,
} from './helpers/orca-profile.js';

/** What each harness's permission bypass is spelled, as Orca would record it. */
const BYPASS = {
  claude: '--dangerously-skip-permissions',
  codex: '--dangerously-bypass-approvals-and-sandbox',
};

/** The harnesses the kit cares about. */
const HARNESSES = Object.keys(BYPASS);

/** Default launch arguments that carry no bypass at all. */
const HARMLESS = { claude: '', codex: '' };

/**
 * How long one kit run may take. A run against the fake takes a second or two;
 * a kit that waits on a lock Orca holds waits far longer, or for ever.
 */
const RUN_BOUND_MS = 30000;

/**
 * Run `obk <args>` in the sandbox, killed if it runs past RUN_BOUND_MS, so a
 * kit that waits on Orca's lock fails here rather than hanging the suite.
 */
function bounded(box, args) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn('obk', args, {
      cwd: box.cwd,
      env: box.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: RUN_BOUND_MS,
      killSignal: 'SIGKILL',
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr, ms: Date.now() - started }));
  });
}

/** A bots folder with Bot Father up in the fake Orca. */
async function seeded(box) {
  const result = await box.run(['init', '--bots', 'bots', '--harness', 'claude']);
  assert.equal(result.code, 0, result.stderr);
}

/**
 * The machine as Orca 1.4.223 leaves it: the sandbox's `orca-data.json` taken
 * away, so the local-default profile holds the db alone.
 */
const onlyTheDb = (box) => box.orca.settings.remove();

/**
 * `obk health --json`, bounded, held to the shape every answer has: JSON alone
 * on stdout, nothing on stderr, and exit 1 when it found something.
 */
async function found(box) {
  const result = await bounded(box, ['health', '--bots', 'bots', '--json']);
  assert.equal(result.signal, null, `health did not end within ${RUN_BOUND_MS} ms; it was killed`);
  assert.equal(result.stderr, '', `a health run reports on stdout, and put this on stderr: ${result.stderr}`);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.found), `the answer should carry a list of findings, got: ${result.stdout}`);
  assert.equal(result.code, answer.found.length === 0 ? 0 : 1, `exit code for ${answer.found.length} findings`);
  return { answer, ms: result.ms };
}

/** The Orca findings of a health run. */
async function orcaFindings(box) {
  const { answer } = await found(box);
  return answer.found.filter((one) => one.kind === 'orca');
}

/** Everything one finding puts in front of a reader. */
const wordsOf = (finding) => `${finding.where} ${finding.says}`;

const show = (findings) => JSON.stringify(findings, null, 2);

/**
 * The Orca findings are exactly one per harness in `bypassed`, each naming the
 * harness and the argument to change, fleet-wide, and nothing names another
 * harness. Exactly that many also means no "could not read" finding beside them.
 */
function assertBypassed(orca, bypassed) {
  assert.equal(orca.length, bypassed.length, `one finding per harness with a bypass, and nothing else, got: ${show(orca)}`);
  for (const harness of bypassed) {
    const about = orca.filter((one) => wordsOf(one).includes(harness));
    assert.equal(about.length, 1, `${harness} runs with a permission bypass, so one finding names it, got: ${show(orca)}`);
    assert.ok(wordsOf(about[0]).includes(BYPASS[harness]), `it says which argument to change, got: ${show(about[0])}`);
    assert.equal(about[0].bot, undefined, 'Orca\'s own setting is about the whole fleet, not one bot');
  }
  for (const harness of HARNESSES.filter((one) => !bypassed.includes(one))) {
    assert.deepEqual(orca.filter((one) => wordsOf(one).includes(harness)), [], `${harness} carries no bypass`);
  }
}

/** The sentences a health run says for a bypass on both harnesses, from a sandbox of their own. */
async function bypassSentences(t) {
  const other = await createSandbox(t);
  await seeded(other);
  await other.orca.settings.set({ agentDefaultArgs: { ...BYPASS } });
  const orca = await orcaFindings(other);
  assert.equal(orca.length, 2, `the contrast run should report both bypasses, got: ${show(orca)}`);
  return orca.map((one) => one.says);
}

/**
 * The one finding for settings the kit could not read: kind `orca`, saying
 * where it looked, and not a sentence it says for a bypass.
 */
async function assertCouldNotRead(t, orca) {
  assert.equal(orca.length, 1, `one finding, about the settings it could not read, got: ${show(orca)}`);
  assert.ok(
    /Application Support\/orca/.test(wordsOf(orca[0])),
    `it should say where it looked for Orca's settings, got: ${show(orca[0])}`,
  );
  const bypass = await bypassSentences(t);
  assert.ok(!bypass.includes(orca[0].says), `a setting it could not read must not read like a bypass it found: ${orca[0].says}`);
}

// ---------------------------------------------------------------------------
// P1, P2, P3 — a profile as Orca 1.4.223 leaves it: the db and no json.
// ---------------------------------------------------------------------------

for (const [label, args, bypassed] of [
  ['claude alone', { claude: BYPASS.claude, codex: '' }, ['claude']],
  ['codex alone', { claude: '', codex: BYPASS.codex }, ['codex']],
  ['both harnesses, one among other arguments', { claude: `--model opus ${BYPASS.claude}`, codex: BYPASS.codex }, ['claude', 'codex']],
]) {
  test(`P1 a bypass in profile-state.db's settings for ${label} is reported per harness, and nothing says it could not read`, async (t) => {
    const box = await createSandbox(t);
    await seeded(box);
    await onlyTheDb(box);
    await orcaProfileDb(t, profileOf(box), { settledSettings: args });

    assertBypassed(await orcaFindings(box), bypassed);
  });
}

for (const [label, args] of [
  ['no arguments at all', HARMLESS],
  ['arguments that carry no bypass', { claude: '--model opus', codex: '--search' }],
]) {
  test(`P2 ${label} in profile-state.db is nothing to report, not even a settings it could not read`, async (t) => {
    const box = await createSandbox(t);
    await seeded(box);
    await onlyTheDb(box);
    await orcaProfileDb(t, profileOf(box), { settledSettings: args });

    const orca = await orcaFindings(box);

    assert.deepEqual(orca, [], `Orca's settings in the db carry no bypass, so there is nothing to say, got: ${show(orca)}`);
  });
}

test('P3 a harness with no entry in the db\'s agentDefaultArgs is reported as the bypass Orca defaults to', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  await onlyTheDb(box);
  await orcaProfileDb(t, profileOf(box), { settledSettings: { codex: '' } });

  assertBypassed(await orcaFindings(box), ['claude']);
});

test('P3 a db settings document with no agentDefaultArgs at all reports both harnesses', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  await onlyTheDb(box);
  await orcaProfileDb(t, profileOf(box), { settledSettings: { absent: true } });

  assertBypassed(await orcaFindings(box), ['claude', 'codex']);
});

// ---------------------------------------------------------------------------
// P4, P5, P6 — read-only, with Orca holding the db open.
// ---------------------------------------------------------------------------

test('P4 settings that are only in the -wal are Orca\'s current settings, and are what health reports', async (t) => {
  // The db file itself says "no bypass"; the change Orca made since, still in
  // the -wal and not checkpointed, says "bypass for claude". A kit that read
  // the db file alone would say nothing, which is the dangerous answer.
  const box = await createSandbox(t);
  await seeded(box);
  await onlyTheDb(box);
  const { file } = await orcaProfileDb(t, profileOf(box), { settledSettings: HARMLESS, walSettings: { claude: BYPASS.claude, codex: '' } });
  assert.deepEqual(await settledArgsIn(box, file), HARMLESS, 'the fixture: the db file alone holds the older, harmless settings');

  assertBypassed(await orcaFindings(box), ['claude']);
});

test('P5 a db Orca holds in exclusive locking mode is still read, from the -wal, in bounded time', async (t) => {
  // With `locking_mode = EXCLUSIVE` no other SQLite connection may open Orca's
  // file at all. The kit must neither wait on that lock nor give up on the
  // settings: what Orca holds is still its current settings.
  const box = await createSandbox(t);
  await seeded(box);
  await onlyTheDb(box);
  const { file } = await orcaProfileDb(t, profileOf(box), {
    settledSettings: HARMLESS,
    walSettings: { claude: '', codex: BYPASS.codex },
    exclusive: true,
  });
  const other = new DatabaseSync(file, { readOnly: true });
  try {
    assert.throws(
      () => other.prepare('SELECT 1 FROM profile_state_documents').get(),
      /locked/,
      'the fixture: the writer holds the db so no other connection can read it',
    );
  } finally {
    other.close();
  }
  assert.deepEqual(await settledArgsIn(box, file), HARMLESS, 'the fixture: the db file alone holds the older, harmless settings');

  const { answer, ms } = await found(box);

  assertBypassed(answer.found.filter((one) => one.kind === 'orca'), ['codex']);
  assert.ok(ms < RUN_BOUND_MS / 2, `health should not wait on Orca's lock; it took ${ms} ms`);
});

for (const exclusive of [false, true]) {
  test(`P6 health leaves Orca's db, -wal and -shm byte for byte as they were, and adds no file beside them${exclusive ? ' (exclusive lock)' : ''}`, async (t) => {
    // Reading the live file through SQLite, even read-only, writes reader
    // marks into the -shm; that is a write to Orca's files.
    const box = await createSandbox(t);
    await seeded(box);
    await onlyTheDb(box);
    const dir = profileOf(box);
    await orcaProfileDb(t, dir, { settledSettings: HARMLESS, walSettings: { claude: BYPASS.claude, codex: '' }, exclusive });
    const before = await filesIn(dir);
    assert.ok(Object.keys(before).includes('profile-state.db-wal'), `the fixture has a -wal, got: ${Object.keys(before)}`);
    if (!exclusive) assert.ok(Object.keys(before).includes('profile-state.db-shm'), `the fixture has a -shm, got: ${Object.keys(before)}`);

    const orca = await orcaFindings(box);

    // It did read them: otherwise "untouched" proves nothing.
    assertBypassed(orca, ['claude']);
    assert.deepEqual(await filesIn(dir), before, 'Orca\'s profile folder is Orca\'s: the kit reads it and writes nothing there');
  });
}

// ---------------------------------------------------------------------------
// P7 — a db with a settings document counts over an old orca-data.json.
// ---------------------------------------------------------------------------

test('P7 the db says bypass and an old orca-data.json beside it says none: the bypass is reported', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  await box.orca.settings.set({ agentDefaultArgs: HARMLESS });
  await orcaProfileDb(t, profileOf(box), { settledSettings: { claude: BYPASS.claude, codex: '' } });

  assertBypassed(await orcaFindings(box), ['claude']);
});

test('P7 the db says no bypass and an old orca-data.json beside it says bypass: nothing is reported', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  await box.orca.settings.set({ agentDefaultArgs: { ...BYPASS } });
  await orcaProfileDb(t, profileOf(box), { settledSettings: HARMLESS });

  const orca = await orcaFindings(box);

  assert.deepEqual(orca, [], `the db is what Orca 1.4.223 runs on, and it carries no bypass, got: ${show(orca)}`);
});

// ---------------------------------------------------------------------------
// P8 — neither shape reads.
// ---------------------------------------------------------------------------

test('P8 a profile-state.db that is not a SQLite file, with no orca-data.json, is a settings it could not read', async (t) => {
  // This is how the kit answers today too, with the json gone; it stays.
  const box = await createSandbox(t);
  await seeded(box);
  await onlyTheDb(box);
  await notADb(profileOf(box));

  await assertCouldNotRead(t, await orcaFindings(box));
});

test('P8 a profile-state.db with no settings row, and no orca-data.json, is a settings it could not read', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  await onlyTheDb(box);
  await orcaProfileDb(t, profileOf(box), { settledSettings: null });

  await assertCouldNotRead(t, await orcaFindings(box));
});

test('P8 a profile-state.db that cannot be read is not silent, even with a harmless orca-data.json beside it', async (t) => {
  // The db is what Orca 1.4.223 runs on. Falling back to an old json that says
  // "no bypass" and saying nothing would report a db nobody read as safe.
  const box = await createSandbox(t);
  await seeded(box);
  await box.orca.settings.set({ agentDefaultArgs: HARMLESS });
  await notADb(profileOf(box));

  const orca = await orcaFindings(box);

  assert.ok(orca.length > 0, 'a db the kit could not read is said, not passed over');
});

// ---------------------------------------------------------------------------
// P9 — every profile is read.
// ---------------------------------------------------------------------------

test('P9 every profile is read: a bypass in a second profile\'s db and in an older profile\'s json are both reported', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  await onlyTheDb(box);
  await orcaProfileDb(t, profileOf(box), { settledSettings: HARMLESS });
  await orcaProfileDb(t, profileOf(box, 'work'), { settledSettings: HARMLESS, walSettings: { claude: '', codex: BYPASS.codex } });
  await orcaDataJson(profileOf(box, 'older'), { claude: BYPASS.claude, codex: '' });

  assertBypassed(await orcaFindings(box), ['claude', 'codex']);
});

// ---------------------------------------------------------------------------
// P10 — nothing is left in TMPDIR, after a good read or a failed one.
// ---------------------------------------------------------------------------

test('P10 after health reads the db, the kit\'s temp folder holds nothing new', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  await onlyTheDb(box);
  await orcaProfileDb(t, profileOf(box), { settledSettings: HARMLESS, walSettings: { claude: BYPASS.claude, codex: '' } });
  const before = await snapshot(box.tmp);

  const orca = await orcaFindings(box);

  assertBypassed(orca, ['claude']);
  assert.deepEqual(await snapshot(box.tmp), before, 'a copy of Orca\'s db, if the kit made one, is removed right after the read');
});

test('P10 after a read of the db fails, the kit\'s temp folder holds nothing new', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  await onlyTheDb(box);
  await notADb(profileOf(box));
  const before = await snapshot(box.tmp);

  const orca = await orcaFindings(box);

  assert.ok(orca.length > 0, `the db could not be read, and that is said, got: ${show(orca)}`);
  assert.deepEqual(await snapshot(box.tmp), before, 'a copy of Orca\'s db is removed on a failed read too');
});

// ---------------------------------------------------------------------------
// P11 — obk init reports the same, from the db.
// ---------------------------------------------------------------------------

test('P11 init reminds the user of a bypass in profile-state.db, and still exits 0', async (t) => {
  const box = await createSandbox(t);
  await onlyTheDb(box);
  await orcaProfileDb(t, profileOf(box), { settledSettings: HARMLESS, walSettings: { claude: BYPASS.claude, codex: '' } });

  const result = await bounded(box, ['init', '--bots', 'bots', '--harness', 'claude', '--json']);

  assert.equal(result.signal, null, `init did not end within ${RUN_BOUND_MS} ms; it was killed`);
  assert.equal(result.code, 0, result.stderr);
  const answer = JSON.parse(result.stdout);
  assertBypassed((answer.found ?? []).filter((one) => one.kind === 'orca'), ['claude']);
});

test('P11 init says nothing about Orca\'s setting when profile-state.db carries no bypass', async (t) => {
  const box = await createSandbox(t);
  await onlyTheDb(box);
  await orcaProfileDb(t, profileOf(box), { settledSettings: HARMLESS });

  const result = await bounded(box, ['init', '--bots', 'bots', '--harness', 'claude', '--json']);

  assert.equal(result.signal, null, `init did not end within ${RUN_BOUND_MS} ms; it was killed`);
  assert.equal(result.code, 0, result.stderr);
  const answer = JSON.parse(result.stdout);
  assert.deepEqual(
    (answer.found ?? []).filter((one) => one.kind === 'orca'),
    [],
    'Orca\'s settings in the db carry no bypass, and they were read',
  );
  assert.ok(Array.isArray(answer.tabs) && answer.tabs.length > 0, `init still answers about its tabs, got: ${result.stdout}`);
});

// ---------------------------------------------------------------------------
// P12 — Orca checkpoints the db while the kit is copying it.
// ---------------------------------------------------------------------------

/** Harmless changes written to the -wal before the bypass: some 160 MB of -wal, so a copy takes a while. */
const CHURN = 40000;

/** How many fresh fixtures to try before the test says the race never landed. */
const ATTEMPTS = 5;

/** The size of a file now, or undefined when it is gone. */
function sizeOf(file) {
  try {
    return statSync(file).size;
  } catch {
    return undefined;
  }
}

/**
 * Start `obk health --json` on a profile whose -wal is big, and checkpoint
 * (TRUNCATE) Orca's db while the kit is partway through copying the -wal.
 *
 * The test watches TMPDIR, every millisecond, for an entry that was not there
 * before the run: the kit's own temp folder, made for its copy. The checkpoint
 * runs as soon as it appears. The race has landed when the checkpoint ran
 * while the run was still going. A fixture where the kit finished first is
 * rebuilt and tried again. How far the copy had got is only reported, since
 * how the kit copies is its own.
 */
async function checkpointDuringTheCopy(t, box) {
  const dir = profileOf(box);
  const file = path.join(dir, 'profile-state.db');
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const { db } = await orcaProfileDb(t, dir, {
      settledSettings: HARMLESS,
      walChurn: CHURN,
      walSettings: { claude: BYPASS.claude, codex: '' },
    });
    const walSize = sizeOf(`${file}-wal`);
    const tmpBefore = await snapshot(box.tmp);
    const namesBefore = new Set(readdirSync(box.tmp));

    let done = false;
    const run = bounded(box, ['health', '--bots', 'bots', '--json']).then((result) => { done = true; return result; });
    let checkpoint;
    while (!done && checkpoint === undefined) {
      const fresh = readdirSync(box.tmp).filter((one) => !namesBefore.has(one));
      if (fresh.length > 0) {
        const [result] = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all();
        let copied = [];
        try {
          copied = readdirSync(path.join(box.tmp, fresh[0])).map((one) => `${one} ${sizeOf(path.join(box.tmp, fresh[0], one))}`);
        } catch {
          // Not a folder, or gone already: nothing to say about how far it got.
        }
        checkpoint = { folder: fresh[0], copied, busy: result.busy, walAfter: sizeOf(`${file}-wal`), runStillGoing: !done };
      }
      if (checkpoint === undefined) await sleep(1);
    }
    const filesAfterCheckpoint = checkpoint === undefined ? undefined : await filesIn(dir);
    const result = await run;

    if (checkpoint !== undefined && checkpoint.runStillGoing) {
      t.diagnostic(`the race landed on attempt ${attempt} of ${ATTEMPTS}: checkpoint once ${checkpoint.folder} appeared, holding [${checkpoint.copied.join(', ')}], with a -wal of ${walSize} bytes`);
      return { result, checkpoint, filesAfterCheckpoint, tmpBefore, dir };
    }
    // A run that was killed is a finding, whether or not the race landed.
    if (result.signal !== null) return { result, checkpoint, filesAfterCheckpoint, tmpBefore, dir };
    t.diagnostic(`the race did not land on attempt ${attempt}; the kit finished first`);
    db.close();
    for (const one of ['', '-wal', '-shm']) await rm(`${file}${one}`, { force: true });
  }
  return assert.fail(`the checkpoint never landed during the kit's copy in ${ATTEMPTS} attempts, so this test cannot say anything`);
}

test('P12 Orca checkpoints during the copy: health ends in bounded time and never reports the older settings', async (t) => {
  const box = await createSandbox(t);
  await seeded(box);
  await onlyTheDb(box);

  const { result, checkpoint, filesAfterCheckpoint, tmpBefore, dir } = await checkpointDuringTheCopy(t, box);

  // 1. Bounded time.
  assert.equal(result.signal, null, `health did not end within ${RUN_BOUND_MS} ms after Orca checkpointed during its copy; it was killed`);
  assert.equal(checkpoint.busy, 0, 'the fixture: the checkpoint ran to the end');
  assert.equal(checkpoint.walAfter, 0, 'the fixture: the checkpoint emptied the -wal');

  // 2. The current settings carry a claude bypass. Health says so, or says it
  //    could not read; it never says there is nothing to report.
  assert.equal(result.stderr, '', `a health run reports on stdout, and put this on stderr: ${result.stderr}`);
  const answer = JSON.parse(result.stdout);
  const orca = answer.found.filter((one) => one.kind === 'orca');
  assert.ok(orca.length > 0, 'the committed settings carry a bypass, so "nothing to report" is the older settings');
  const saysTheBypass = orca.some((one) => wordsOf(one).includes(BYPASS.claude));
  if (!saysTheBypass) {
    assert.equal(orca.length, 1, `no bypass reported, so this is the one "could not read" finding, got: ${show(orca)}`);
    assert.ok(/Application Support\/orca/.test(wordsOf(orca[0])), `it says where it looked, got: ${show(orca[0])}`);
    for (const bypass of Object.values(BYPASS)) {
      assert.ok(!wordsOf(orca[0]).includes(bypass), `and it does not read as a bypass it found, got: ${show(orca[0])}`);
    }
  }

  // 3. Orca's files as the checkpoint left them, and nothing left in TMPDIR.
  assert.deepEqual(await filesIn(dir), filesAfterCheckpoint, 'Orca\'s profile folder is Orca\'s: the kit writes nothing there');
  assert.deepEqual(await snapshot(box.tmp), tmpBefore, 'the kit\'s copy is removed after the read, whatever happened during it');
});
