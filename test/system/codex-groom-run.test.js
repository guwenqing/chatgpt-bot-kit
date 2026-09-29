// A system test: the daily grooming done by a temporary Codex session at each
// fire of the Claude grooming session's schedule (#238), against the real Orca,
// a real Claude Code and a real Codex on this machine. Run it with
// `npm run test:system -- --yes test/system/codex-groom-run.test.js`; `npm test`
// cannot, and no CI machine could.
//
// **It spends real tokens, and it takes from about ten minutes to a little over
// an hour.** A few short Claude turns (Sonnet, medium) to make the job, fire it
// and handle the run's report, and one grooming run by Codex (gpt-6-sol, low)
// on an empty throwaway fleet, with the real obk-grooming skill. Most of the
// time is Claude Code's own scheduler: the job is set two to three minutes
// ahead, and a recurring job is documented to fire up to thirty minutes after
// its time (tech notes, section 2). Every wait is bounded and says what it was
// waiting for when it runs out; the longest is the one that jitter needs:
//
//   the job made         4 min after --on, and before its own time
//   the fire             up to 32 min after its time: 30 of jitter, 2 to be written down
//   the run made         4 min after the fire
//   its report arrives   20 min after the run was made
//   the report read      4 min after it arrived
//   the run retired      4 min after the report was read
//
// What it proves, one part per line of the issue's acceptance:
//
//   1. The Claude session's schedule, set a few minutes ahead with `--run-on
//      codex`, fires once and starts one Codex run: one temporary session
//      named groom-*, made by the grooming session, appears in Bot Father's
//      book.
//   2. The run's rollout records the chosen model and effort: its latest
//      `turn_context` says gpt-6-sol and low. gpt-6-sol, because Codex's own
//      default here is gpt-6-astra (tech notes, section 3: the context window a
//      session with no override gets is gpt-6-astra's), so a launch line that
//      dropped `-m` would show. Only those two fields of the rollout are read
//      (helpers/codex-rollout.js `turnSettingsIn`), never what was said.
//   3. The run's result reaches the Claude session by the kit's mail: the
//      kit's notice, `Fleet mail from bot-father/<the run>`, is a turn of the
//      grooming conversation, and after it that conversation runs the kit's
//      `message check`, which is it reading the mail.
//   4. After the run no temporary session is left: not in bot.yaml, not among
//      the book's sessions, and not in Orca. The book's retired list keeps the
//      run, with the grooming session as its maker.
//
// The run's own launch line carries codexTrustArgs, through `--extra-arg` on
// `obk groom` (#238, the architect's ruling (4)): the bots folder is trusted
// at launch, the hooks review is bypassed, and Codex's sleep tool is off, so
// Codex writes nothing about this folder into the user's ~/.codex/config.toml
// (#240) and a run told to wait for nothing does not sleep in its turn (#432).
//
// Not proved here, and said when it happens: whether the run found the
// obk-grooming skill by name (the architect's ruling (7)). What the run said is
// not read; the report the grooming session was sent is in its own transcript,
// which a person can read after a run.
//
// The machine it runs on is someone's working machine. So this test, like the
// ones beside it: works in a throwaway bots folder under the system temp
// directory; writes down every terminal and workspace Orca already had; runs
// this checkout's `src/cli.js` by its full path, never the machine's `obk`
// (#220); closes only its own tabs, through the tab guard, and deletes its own
// workspace, whatever happened. The run's tab is the kit's, opened for this
// test's fleet by the grooming session's `temp make`; the test counts it as its
// own once the book names it, so the teardown can close it if the run was never
// retired.
//
// Claude Code's transcripts of the throwaway folder are read, never written,
// and stay under `~/.claude/projects` afterwards, as every system test's do;
// the run's rollout stays under `~/.codex/sessions`. Each run also leaves Bot
// Father's orchestration Runs and the run's behind, which Orca offers no way to
// delete; the runner lists them.
//
// **It is attended.** A bot folder nobody has opened before asks questions
// before the harness is running in it, and this test answers none of them
// (PRD 6.5). What to expect on this machine:
//
//   1. `Bot Father daily`: Claude Code's folder-trust list. Its selection starts
//      on `No, exit`, so it takes a down-arrow and then return.
//   2. The grooming tab, the same list, if it asks.
//   3. Either Claude tab, if Claude Code offers an update: accept it.
//   4. `Bot Father ops` is a plain shell. If zsh asks to update itself, `n`.
//   5. Either Claude tab, after a turn: "Teach auto mode about your
//      environment?". Esc cancels it (#416).
//   6. The grooming tab, at the fire: if Claude Code asks to run the kit's
//      `temp make`, `temp retire` or `message check`, allow it. The run can be
//      made only when that is answered.
//   7. The run's Codex tab should ask nothing: its trust is given at launch.
//      If it does, answer it; the run waits on it.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry } from '../helpers/cli.js';
import { codexTrustArgs } from '../helpers/codex-trust.js';
import { rolloutFilesOf, turnSettingsIn } from '../helpers/codex-rollout.js';
import { waitingOn } from '../helpers/screens.js';
import { tabGuard } from '../helpers/tab-guard.js';
import { RELOAD_LINE, reloadWindow } from '../../src/orca.js';

/**
 * Remove the throwaway bots folder and everything the kit made beside it:
 * `<bots>.prompts`, `<bots>.locks` and the rest are siblings of it (PRD 6.3).
 */
async function removeBotsFolderAndSiblings(bots) {
  const parent = path.dirname(bots);
  const mine = path.basename(bots);
  const ours = async () => (await readdir(parent)).filter((name) => name === mine || name.startsWith(`${mine}.`));

  for (const name of await ours()) {
    await rm(path.join(parent, name), { recursive: true, force: true });
  }
  assert.deepEqual(await ours(), [], `this test left folders behind in ${parent}`);
}

/** The Orca CLI that works for a normal user (tech notes, section 1). */
const ORCA = process.env.OBK_ORCA || '/Applications/Orca.app/Contents/Resources/bin/orca';

/** The grooming session: the clock and the reader. A full model id, as its transcript records it. */
const MODEL = 'claude-sonnet-5';
const EFFORT = 'medium';

/** The job's runs: a Codex model that is not this machine's default, at an effort that is not Codex's. */
const CODEX_MODEL = 'gpt-6-sol';
const CODEX_EFFORT = 'low';

/** How long a real agent is given to act on one line. */
const ANSWER_MS = 240000;

/** How long a tab is given to be ready for a question: a person may be answering a screen on it. */
const READY_MS = 180000;

/** How long a recurring job may fire late: Claude Code's documentation says up to thirty minutes. */
const JITTER_MS = 30 * 60000;

/** And a little more, for the fired turn to be written down. */
const LATE_MS = 2 * 60000;

/** How long the run is given to groom an empty fleet and send its report. */
const RUN_MS = 20 * 60000;

/** How often the long waits look again. */
const POLL_MS = 5000;

/** What the kit's mail notice from Bot Father's session `name` says (src/message.js). */
const mailFrom = (name) => `Fleet mail from bot-father/${name}`;

/** Every close goes through the guard, which counts it for the check at the end (#246). */
const guard = tabGuard(ORCA);
const { orca } = guard;

/** Every terminal Orca knows about right now. */
function allTerminals() {
  const answer = orca(['terminal', 'list']);
  assert.equal(answer.ok, true, `orca terminal list failed: ${JSON.stringify(answer.error)}`);
  return answer.result.terminals;
}

/** The terminals in one workspace, by the path they were opened in. */
const terminalsAt = (home) => allTerminals().filter((terminal) => terminal.worktreePath === home);

/** The tabs Orca lists at `home` once it has caught up with what was closed (#187). */
async function terminalsAfterClosing(home, closed, within = 5000) {
  const until = Date.now() + within;
  let left = terminalsAt(home);
  while (left.some((terminal) => closed.includes(terminal.handle)) && Date.now() < until) {
    await setTimeout(250);
    left = terminalsAt(home);
  }
  return left;
}

/** Every workspace Orca knows about right now. */
function allSetups() {
  const answer = orca(['project', 'setups']);
  assert.equal(answer.ok, true, `orca project setups failed: ${JSON.stringify(answer.error)}`);
  return answer.result.setups;
}

/** Run this checkout's `obk`, by its full path (#217). */
function obk(args) {
  const done = spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}`);
  assert.ok(!/worktree/i.test(done.stdout + done.stderr), `obk said "worktree": ${done.stdout}${done.stderr}`);
  return done;
}

/** Run `obk ... --json` and read the answer it printed. */
function obkJson(args) {
  const done = obk([...args, '--json']);
  assert.equal(done.status, 0, `obk ${args.join(' ')} failed: ${done.stdout}${done.stderr}`);
  try {
    return JSON.parse(done.stdout);
  } catch {
    assert.fail(`obk ${args.join(' ')} --json did not print JSON: ${done.stdout}`);
  }
}

/** The entry for one tab in an `obk --json` answer. */
function tabOf(answer, name) {
  const found = (answer.tabs ?? []).filter((entry) => entry.name === name);
  assert.equal(found.length, 1, `one entry should be the ${name} tab, got: ${JSON.stringify(answer.tabs)}`);
  return found[0];
}

/** Bot Father's book as it stands. */
const bookOf = (home) => parse(readFileSync(path.join(home, 'sessions.yaml'), 'utf8')) ?? {};

/** What Bot Father's book says about one of its sessions right now. */
const sessionIn = (home, name) => bookOf(home).sessions?.[name] ?? {};

/** The names of Bot Father's sessions in bot.yaml right now. */
const sessionsInBotYaml = (home) => (parse(readFileSync(path.join(home, 'bot.yaml'), 'utf8'))?.sessions ?? []).map((one) => one?.name);

/** The temporary sessions the book holds now: `[name, entry]`. */
const temporaries = (home) => Object.entries(bookOf(home).sessions ?? {}).filter(([, entry]) => entry?.temporary !== undefined);

/** Keep asking until `look` gives something other than undefined, or the time runs out. */
async function until(what, within, look, note = () => '', every = 1000) {
  const stop = Date.now() + within;
  for (;;) {
    const found = await look();
    if (found !== undefined) return found;
    assert.ok(Date.now() < stop, `gave up waiting for ${what} after ${within}ms.${note()}`);
    await setTimeout(every);
  }
}

/** Everything the tab is rendering right now, as one piece of text. */
function screenOf(handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  return answer.ok === true ? JSON.stringify(answer.result) : '';
}

/** What the tab is showing, for the message of a wait that ran out. */
function whatIsUp(handle) {
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '2000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  return [
    blocked === undefined ? '' : ` Orca says the tab is waiting on: ${blocked}.`,
    ' This test answers nothing a tab asks; answer it in Orca and run again.',
    `\n  orca terminal read --terminal ${handle} --screen\n  ${screenOf(handle).slice(0, 2000)}`,
  ].join('');
}

/** Wait until the tab will take a question: a TUI up, and nothing of its own waiting (helpers/screens.js). */
async function readyForAQuestion(handle, within = READY_MS) {
  await until(
    `${handle} to be past the questions of its own`,
    within,
    async () => {
      const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '5000']);
      if (answer.ok !== true) return undefined;
      if (answer.result?.wait?.blockedReason !== undefined) return undefined;
      return waitingOn(orca, handle) === undefined ? true : undefined;
    },
    () => `${waitingOn(orca, handle) ?? ''}${whatIsUp(handle)}`,
  );
}

/** Where Claude Code keeps the conversations it had in one folder (tech notes, section 2). */
const transcriptsOf = (home) => path.join(os.homedir(), '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'));

/** One conversation's transcript, whole lines only, a JSON object each. */
function linesOf(home, id) {
  if (typeof id !== 'string') return [];
  const file = path.join(transcriptsOf(home), `${id}.jsonl`);
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  const lines = [];
  for (const raw of text.slice(0, text.lastIndexOf('\n') + 1).split('\n')) {
    if (raw.trim() === '') continue;
    try {
      lines.push(JSON.parse(raw));
    } catch {
      // Not a line Claude Code finished writing as JSON; nothing here reads it.
    }
  }
  return lines;
}

/** The grooming conversation the book holds now, and its lines. */
const groomingLines = (home) => linesOf(home, sessionIn(home, 'grooming').session);

/** The lines written at or after a moment. */
const after = (lines, moment) => lines.filter((line) => Date.parse(line.timestamp ?? '') >= moment);

/** The text a line says, where it says it as text. */
function textsOf(line) {
  const content = line.message?.content;
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content.filter((item) => item?.type === 'text' && typeof item.text === 'string').map((item) => item.text);
}

const itemsOf = (line, type) => (Array.isArray(line.message?.content) ? line.message.content.filter((item) => item?.type === type) : []);
const toolUses = (line) => (line.type === 'assistant' ? itemsOf(line, 'tool_use') : []);
const toolResults = (line) => (line.type === 'user' ? itemsOf(line, 'tool_result') : []);

/** The grooming jobs a stretch of transcript made: a successful recurring CronCreate under the marker. */
function jobsMadeIn(lines, marker) {
  const calls = new Map();
  for (const line of lines) {
    for (const use of toolUses(line)) if (use.name === 'CronCreate') calls.set(use.id, use.input ?? {});
  }
  const made = [];
  for (const line of lines) {
    for (const result of toolResults(line)) {
      const input = calls.get(result.tool_use_id);
      if (input === undefined || result.is_error === true) continue;
      const answer = line.toolUseResult;
      if (answer === null || typeof answer !== 'object' || typeof answer.id !== 'string') continue;
      if (input.recurring === false || !String(input.prompt ?? '').startsWith(marker)) continue;
      made.push({ id: answer.id, cron: input.cron, made: line.timestamp });
    }
  }
  return made;
}

/**
 * The times the job fired after `since`: a user turn, as text, carrying the
 * marker (seen live for #237: Claude Code hands the job's prompt to the session
 * as a `type: "user"` line). Not a tool's answer, a compaction's summary, or a
 * mail notice.
 */
const firesIn = (lines, marker, since) => lines.filter((line) => line.type === 'user'
  && line.isCompactSummary !== true
  && Date.parse(line.timestamp ?? '') > since
  && textsOf(line).some((text) => text.includes(marker) && !text.includes('Fleet mail from')));

/** The last lines of a stretch of transcript, short, for the message of a wait that ran out. */
function tailOf(lines, count = 15) {
  if (lines.length === 0) return '    (nothing)';
  return lines.slice(-count).map((line) => {
    const said = line.message?.content ?? line.toolUseResult ?? line.attachment ?? '';
    return `    ${line.timestamp ?? '-'}  ${line.type}${line.subtype ? `/${line.subtype}` : ''}  ${JSON.stringify(said).slice(0, 200)}`;
  }).join('\n');
}

/** A time of day as the kit takes it: 24 hours, in this machine's own time. */
const hhmm = (date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

/** Codex's own folder of rollouts, read only. */
const CODEX_SESSIONS = path.join(os.homedir(), '.codex', 'sessions');

test('a grooming job with --run-on codex starts one Codex run at its fire, on the chosen model and effort, whose report reaches the grooming session, and which is retired', async (t) => {
  const before = {
    handles: new Set(allTerminals().map((terminal) => terminal.handle)),
    setups: new Set(allSetups().map((setup) => setup.id)),
  };

  const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-codex-groom-')));
  const home = path.join(bots, 'bots', 'bot-father');
  const marker = `obk grooming for ${bots}`;
  const openedBy = (answer) => guard.openedByKit(answer);

  // Registered before anything is created, so it runs however this test ends.
  t.after(async () => {
    const { closed, foreign } = guard.closeOwnAt([home]);
    const held = new Set(foreign.map((one) => one.home));
    let deleted = 0;
    for (const setup of allSetups()) {
      if (setup.path !== home || before.setups.has(setup.id) || held.has(setup.path)) continue;
      orca(['project', 'setup-delete', '--setup', setup.id]);
      deleted += 1;
    }
    if (deleted > 0 && !(await reloadWindow())) t.diagnostic(RELOAD_LINE);
    assert.deepEqual(foreign, [], `tabs this test did not create are open at its home, so it closed only its own and left that project and ${bots} in place`);
    await removeBotsFolderAndSiblings(bots);

    const { closedNotOurs, goneElsewhere } = guard.verdict(before.handles);
    assert.deepEqual(closedNotOurs, [], 'this test closed tabs it did not create');
    if (goneElsewhere.length > 0) t.diagnostic(`tabs open before this test and closed elsewhere meanwhile: ${goneElsewhere.join(', ')}`);
    assert.deepEqual(await terminalsAfterClosing(home, closed), [], 'this test left tabs behind');
  });

  // ---------------------------------------------------------------------------
  // The fleet: Bot Father on Claude Code, and its grooming session, added as
  // the obk-grooming skill says, on Claude Code, which holds the schedule.
  const init = openedBy(obkJson(['init', '--bots', bots, '--harness', 'claude']));
  const daily = tabOf(init, 'daily');
  assert.equal(daily.harnessStarted, true, `no claude came up in ${daily.title}: \`orca terminal read --terminal ${daily.terminal} --screen\``);

  obkJson(['session', 'add', '--bots', bots, '--bot', 'bot-father', '--name', 'grooming', '--model', MODEL, '--effort', EFFORT]);
  const opened = tabOf(openedBy(obkJson(['up', '--bots', bots, '--bot', 'bot-father'])), 'grooming');
  assert.equal(opened.created, true, 'up opened a tab for the grooming session');
  assert.equal(opened.harnessStarted, true, `no claude came up in ${opened.title}: \`orca terminal read --terminal ${opened.terminal} --screen\``);
  const handle = opened.terminal;

  await until(
    'the grooming session to report its session id',
    READY_MS,
    async () => sessionIn(home, 'grooming').session,
    () => ` Answer Claude Code's folder trust in ${opened.title}.${whatIsUp(handle)}`,
  );
  await readyForAQuestion(handle);

  // ---------------------------------------------------------------------------
  // 1. --on --run-on codex, two to three minutes ahead, in this machine's time.
  const due = new Date(Math.ceil((Date.now() + 2 * 60000) / 60000) * 60000);
  const at = hhmm(due);
  const cron = `${due.getMinutes()} ${due.getHours()} * * *`;
  const onAt = Date.now();
  const on = obkJson([
    'groom', '--bots', bots, '--on', '--at', at,
    '--run-on', 'codex', '--model', CODEX_MODEL, '--effort', CODEX_EFFORT, ...codexTrustArgs(bots),
  ]).groom;
  assert.equal(on.asked, 'on', `--on types the line that schedules it: ${JSON.stringify(on)}`);

  const made = await until(
    `the grooming session to make its job for ${at}`,
    ANSWER_MS,
    async () => jobsMadeIn(after(groomingLines(home), onAt), marker)[0],
    () => `\n  its conversation since --on:\n${tailOf(after(groomingLines(home), onAt))}${whatIsUp(handle)}`,
    POLL_MS,
  );
  const madeAt = Date.parse(made.made);
  assert.equal(made.cron, cron, `the job is for ${at}: ${JSON.stringify(made)}`);
  assert.ok(madeAt < due.getTime(), `the job was made at ${made.made}, after its own time ${due.toISOString()}, so it first fires tomorrow; run again`);

  const [listed] = obkJson(['groom', '--bots', bots]).groom.jobs;
  assert.equal(listed?.id, made.id, 'obk groom lists the job Claude Code made');
  assert.deepEqual(listed.run, { harness: 'codex', model: CODEX_MODEL, effort: CODEX_EFFORT }, `and its runs: ${JSON.stringify(listed)}`);

  // The fire. Nothing is typed into the grooming tab from here on.
  const fire = await until(
    `the job to fire, due at ${at} (${due.toISOString()}); Claude Code documents up to ${JITTER_MS / 60000} minutes late`,
    Math.max(0, due.getTime() + JITTER_MS + LATE_MS - Date.now()),
    async () => firesIn(groomingLines(home), marker, madeAt)[0],
    () => ' It fires only while its tab is up and Claude Code is idle in it.'
      + `\n  its conversation since the job was made:\n${tailOf(after(groomingLines(home), madeAt))}${whatIsUp(handle)}`,
    POLL_MS,
  );
  const firedAt = Date.parse(fire.timestamp);
  assert.ok(firedAt >= due.getTime(), `it fired at ${fire.timestamp}, before its time ${due.toISOString()}`);

  // One run, made by the grooming session, in the book with its tab. Its tab is
  // the kit's, for this test's fleet: counted as this test's own from here.
  const [runName, runEntry] = await until(
    'the grooming session to make one groom-* run',
    ANSWER_MS,
    async () => {
      const runs = temporaries(home).filter(([name]) => name.startsWith('groom-'));
      if (runs.length === 0) return undefined;
      assert.equal(runs.length, 1, `one run per fire: ${JSON.stringify(runs)}`);
      const [, entry] = runs[0];
      return typeof entry.tab === 'string' && allTerminals().some((one) => one.tabId === entry.tab) ? runs[0] : undefined;
    },
    () => ` Temporary sessions in the book: ${JSON.stringify(temporaries(home))}.`
      + `\n  the grooming conversation since the fire:\n${tailOf(after(groomingLines(home), firedAt))}${whatIsUp(handle)}`,
    POLL_MS,
  );
  const runTab = allTerminals().find((one) => one.tabId === runEntry.tab);
  guard.openedByKit({ tabs: [{ created: true, terminal: runTab.handle }] });
  assert.equal(runEntry.temporary.maker, 'grooming', `the run is the grooming session's: ${JSON.stringify(runEntry)}`);
  assert.equal(firesIn(groomingLines(home), marker, madeAt).length, 1, 'the job fired once');

  // 2. What the run ran on, from its rollout's turn_context and nothing else.
  const settings = await until(
    `the run ${runName}'s rollout to record a turn`,
    ANSWER_MS,
    async () => {
      const id = sessionIn(home, runName).session;
      if (typeof id !== 'string') return undefined;
      const turns = rolloutFilesOf(CODEX_SESSIONS, id).flatMap((file) => turnSettingsIn(readFileSync(file, 'utf8')));
      return turns.length === 0 ? undefined : turns.sort((left, right) => left.at - right.at).at(-1);
    },
    () => ` The book's entry for the run: ${JSON.stringify(sessionIn(home, runName))}.${whatIsUp(runTab.handle)}`,
    POLL_MS,
  );
  assert.deepEqual(
    { model: settings.model, effort: settings.effort },
    { model: CODEX_MODEL, effort: CODEX_EFFORT },
    'the run\'s latest turn ran on the job\'s model and effort',
  );

  // 3. Its report, by the kit's mail: the notice in the grooming conversation.
  const notice = await until(
    `the run ${runName} to send its report to the grooming session`,
    RUN_MS,
    async () => after(groomingLines(home), firedAt)
      .find((line) => line.type === 'user' && textsOf(line).some((text) => text.includes(mailFrom(runName)))),
    () => `\n  the grooming conversation since the fire:\n${tailOf(after(groomingLines(home), firedAt))}${whatIsUp(runTab.handle)}`,
    POLL_MS,
  );
  const noticeAt = Date.parse(notice.timestamp);

  // And read with the kit's check, after the notice.
  await until(
    'the grooming session to read its mail with the kit\'s message check',
    ANSWER_MS,
    async () => {
      const lines = after(groomingLines(home), noticeAt);
      const checks = new Set(lines.flatMap(toolUses)
        .filter((use) => String(use.input?.command ?? '').includes('message check'))
        .map((use) => use.id));
      return lines.some((line) => toolResults(line).some((result) => checks.has(result.tool_use_id) && result.is_error !== true)) ? true : undefined;
    },
    () => `\n  the grooming conversation since the notice:\n${tailOf(after(groomingLines(home), noticeAt))}${whatIsUp(handle)}`,
    POLL_MS,
  );

  // 4. And retired: nothing temporary left in bot.yaml, the book or Orca.
  await until(
    `the grooming session to retire ${runName}`,
    ANSWER_MS,
    async () => (temporaries(home).length === 0
      && !sessionsInBotYaml(home).includes(runName)
      && !allTerminals().some((one) => one.tabId === runEntry.tab) ? true : undefined),
    () => ` Temporary sessions in the book: ${JSON.stringify(temporaries(home))}; bot.yaml's sessions: ${JSON.stringify(sessionsInBotYaml(home))}.`
      + `\n  the grooming conversation since the notice:\n${tailOf(after(groomingLines(home), noticeAt))}${whatIsUp(handle)}`,
    POLL_MS,
  );
  const retired = (bookOf(home).retired ?? []).filter((entry) => entry?.name === runName);
  assert.equal(retired.length, 1, `the book's retired list keeps the run: ${JSON.stringify(bookOf(home).retired)}`);
  assert.equal(retired[0].temporary?.maker, 'grooming', `as the grooming session's: ${JSON.stringify(retired[0])}`);
  assert.deepEqual(
    terminalsAt(home).filter((one) => one.tabId === runEntry.tab || String(one.title ?? '').includes('groom-')),
    [],
    'and no groom-* tab in Orca',
  );

  // The job is still there, renewed by the fire, with its runs as before.
  const { jobs } = obkJson(['groom', '--bots', bots]).groom;
  assert.equal(jobs.length, 1, `one grooming job after the run: ${JSON.stringify(jobs)}`);
  assert.deepEqual(jobs[0].run, { harness: 'codex', model: CODEX_MODEL, effort: CODEX_EFFORT });
});
