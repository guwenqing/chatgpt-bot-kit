// The skills reload waits its turn to type (#482).
//
// The owner's intent on #482: two kit paths never type into the same
// session's tab at once, since each kit line is a whole line with its own
// Return, and one that lands in the middle of another submits a mixed line.
// #480 gave each session a typing turn (helpers/typing-turn.js); the naming
// and the mail nudge take it (typing-turn.test.js). The boundary, in the
// owner's words: "every kit path that types into a session's tab takes #480's
// typing turn. When it's held, a path waits a short, bounded time, then
// reports 'not typed: the kit is typing into it' through the trouble report it
// already has, and types nothing."
//
// This file is the skills reload: `obk skills build` types `/reload-skills`
// into each running Claude Code session whose skills changed
// (skills-reload.test.js). Before it types, it takes the session's typing
// turn, waiting the same 5 s as the nudge:
//
//   - not got: nothing is typed into that tab, the session's entry has
//     `state: 'unknown'` and a `trouble` that says the kit is typing into it,
//     the links are made all the same, and the build still succeeds;
//   - got within the 5 s (here let go after about 1 s): `/reload-skills` is
//     typed as it is today;
//   - per session: a turn held for another session of the bot does not stop
//     this one.
//
// The turn is held from the test process, as typing-turn.test.js holds it.
// Every run is in the sandbox, with a fake Orca.

import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, it } from 'node:test';

import { createSandbox, sentInto, sessionIn } from './helpers/cli.js';
import { addSkills, answerOf, assertLinked, botYamlOf, entryOf, kitSkill } from './helpers/skills.js';
import { withTypingTurnHeld } from './helpers/typing-turn.js';

/** The words the report gives for a line the turn kept out. */
const TYPING = /the kit is typing into it/;

/** Claude Code's own command for picking up skills changed on disk. */
const RELOAD = '/reload-skills';

/** One of the kit's own skills: the change the build makes. */
const KIT_SKILL = 'obk-tdd';

const BOT = 'api-bot';

/** A hard limit for each test, so a wait that never ends fails here rather than hangs the run. */
const LIMIT = { timeout: 120_000 };

/**
 * A fleet that is up: Bot Father, and `api-bot` with two Claude sessions,
 * `daily` and `night`, every tab with its launch line and nothing since; then
 * a kit skill added to api-bot's list, so the next build changes its links.
 */
async function fleetIn(box) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', 'claude', '--charter', `${BOT} owns its own corner.`]);
  assert.equal(made.code, 0, made.stderr);
  for (const session of ['daily', 'night']) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', session]);
    assert.equal(added.code, 0, added.stderr);
  }
  const up = await box.run(['up', '--bots', 'bots']);
  assert.equal(up.code, 0, up.stderr);
  const bots = box.path('bots');
  await addSkills(botYamlOf(bots, BOT), `kit:${KIT_SKILL}`);
  return bots;
}

/** `obk skills build`, with whatever else the test wants to say. */
const build = (box, ...rest) => box.run(['skills', 'build', '--bots', 'bots', ...rest]);

/** Each `terminal send` into one session's tab since its launch line, `{ text, enter }`. */
async function sentToSession(box, bots, session) {
  const tab = (await sessionIn(bots, BOT, session)).tab;
  const terminal = (await box.orca.terminals()).find((one) => one.tabId === tab);
  assert.ok(terminal, `Orca should have ${session}'s tab ${tab}`);
  return sentInto(terminal).slice(1).map(({ text, enter }) => ({ text, enter }));
}

/** One session's entry under api-bot in a `--json` answer. */
function sessionOf(result, session) {
  const entry = entryOf(answerOf(result), BOT);
  assert.ok(Array.isArray(entry.sessions), `${BOT}'s links changed, so its entry should list its sessions, got: ${JSON.stringify(entry)}`);
  const found = entry.sessions.filter((one) => one.session === session);
  assert.equal(found.length, 1, `one entry for ${session}, got: ${JSON.stringify(entry.sessions)}`);
  return found[0];
}

describe('the skills reload and the typing turn, side by side', { concurrency: true }, () => {
  it('daily\'s typing turn held for the whole build: nothing is typed into daily, it is unknown with the kit typing into it, the links are made, and night is still told', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);

    const started = Date.now();
    const result = await withTypingTurnHeld(bots, BOT, 'daily', () => build(box, '--json'));
    const took = Date.now() - started;

    assert.equal(result.code, 0, `the build still succeeds: ${result.stdout}${result.stderr}`);
    assert.deepEqual(await sentToSession(box, bots, 'daily'), [], 'nothing may be typed into daily while its turn is held');
    const daily = sessionOf(result, 'daily');
    assert.equal(daily.state, 'unknown', `daily was not told, got: ${JSON.stringify(daily)}`);
    assert.match(String(daily.trouble), TYPING, `and why, got: ${JSON.stringify(daily)}`);
    await assertLinked(bots, BOT, KIT_SKILL, await kitSkill(KIT_SKILL));
    // The turn is per session: night's is free, so night is told as today.
    assert.equal(sessionOf(result, 'night').state, 'reloaded', `night's turn is not daily's, got: ${result.stdout}`);
    assert.deepEqual(await sentToSession(box, bots, 'night'), [{ text: RELOAD, enter: true }], 'night gets its one line');
    assert.ok(took < 60_000, `the wait for the turn is bounded; the build took ${took} ms`);
  });

  it('daily\'s typing turn held, plain: the report names api-bot/daily and says the kit is typing into it', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);

    const result = await withTypingTurnHeld(bots, BOT, 'daily', () => build(box));

    assert.equal(result.code, 0, `the build still succeeds: ${result.stdout}${result.stderr}`);
    assert.deepEqual(await sentToSession(box, bots, 'daily'), [], 'nothing may be typed into daily while its turn is held');
    const lines = result.stdout.split('\n').filter((line) => line.includes(`${BOT}/daily`));
    assert.notEqual(lines.length, 0, `the report should name ${BOT}/daily, got:\n${result.stdout}`);
    assert.match(lines.join('\n'), TYPING, `and say the kit is typing into it, got:\n${result.stdout}`);
  });

  it('daily\'s typing turn let go after about 1 s: /reload-skills is typed into daily as today, and nothing before the turn was free', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleetIn(box);

    let whileHeld;
    const result = await withTypingTurnHeld(bots, BOT, 'daily', async (release) => {
      const run = build(box, '--json');
      await sleep(1_000);
      whileHeld = await sentToSession(box, bots, 'daily');
      release();
      return run;
    });

    assert.equal(result.code, 0, `the build succeeds: ${result.stdout}${result.stderr}`);
    assert.deepEqual(whileHeld, [], 'nothing was typed into daily while its turn was held');
    assert.deepEqual(sessionOf(result, 'daily'), { session: 'daily', harness: 'claude', state: 'reloaded' });
    assert.deepEqual(await sentToSession(box, bots, 'daily'), [{ text: RELOAD, enter: true }], 'one line, the reload command, once the turn was free');
  });
});
