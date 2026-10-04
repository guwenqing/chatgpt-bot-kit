// `obk session clear` and `obk session compact` wait their turn to type (#482).
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
// This file is `session clear` and `session compact` (#391,
// session-clear.test.js). They type a slash command one character a send,
// then its return; on Codex a clear also answers Codex's question and types
// one more line, the record line, and all of that is one clear. Before the
// first character, the command takes the session's typing turn, waiting the
// same 5 s as the nudge:
//
//   - not got: refused as these commands refuse today, a non-zero exit with
//     the reason on stderr, which says the kit is typing into it and that
//     nothing was typed; nothing is typed into any tab, and the book holds
//     the conversation it held before;
//   - got within the 5 s (here let go after about 1 s): the clear or compact
//     goes on as it does today;
//   - held while it types: from the first character to the last thing the
//     clear types (the return on Claude Code, the record line on Codex),
//     the turn is the command's, so no other kit line can land among its
//     keys;
//   - per session: a turn held for another session of the bot does not stop
//     it.
//
// How the harness is played, as in session-clear.test.js: each send moves the
// tab's screen on (`nextScreens`), and the hook's report of the new
// conversation, or the compaction in the harness's record, is played by the
// test once the step that causes it has been sent.
//
// The turn is held from the test process, as typing-turn.test.js holds it.
// Every run is in the sandbox, with a fake Orca.

import assert from 'node:assert/strict';
import { appendFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, it } from 'node:test';

import {
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  recordSession,
  sessionIn,
  tabsOfBot,
} from './helpers/cli.js';
import {
  CLAUDE_CLEAR_TYPED,
  CLAUDE_COMPACT_TYPED,
  CLAUDE_IDLE,
  CODEX_COMPACT_TYPED,
  CODEX_IDLE,
  CODEX_NEW_MENU,
  CODEX_NEW_TYPED,
  whileTyping,
} from './helpers/screens.js';
import { typingTurnHeld, withTypingTurnHeld } from './helpers/typing-turn.js';

/** The words the refusal gives for a command the turn kept out. */
const TYPING = /the kit is typing into it/;

/** The line the kit types into Codex after its `/new`, word for word, as the architect approved it on #391. */
const RECORD_LINE = 'obk: this conversation was started by obk session clear, and this line is only so the kit can record it. Reply "ok"; nothing else is asked.';

const BOT = 'api-bot';
const PROMPT = 'Read your AGENTS.md and keep the queue moving.';
const HARNESSES = ['claude', 'codex'];
const VERBS = ['clear', 'compact'];

/** A hard limit for each test, so a wait that never ends fails here rather than hangs the run. */
const LIMIT = { timeout: 120_000 };

/** The command as the kit types it: one character a send, none with a return. */
const typed = (command) => [...command].map((text) => ({ text, enter: false }));

/** What each verb types on each harness, the screens that show while it does, and what the kit sends after it. */
const PLAY = {
  clear: {
    claude: {
      screens: [...whileTyping('claude', '/clear'), CLAUDE_CLEAR_TYPED, CLAUDE_IDLE],
      sends: [...typed('/clear'), { text: '\r', enter: false }],
      last: '\r',
    },
    codex: {
      screens: [...whileTyping('codex', '/new'), CODEX_NEW_TYPED, CODEX_NEW_MENU, CODEX_IDLE],
      sends: [...typed('/new'), { text: '\r', enter: false }, { text: '\r', enter: false }, { text: RECORD_LINE, enter: true }],
      last: RECORD_LINE,
    },
  },
  compact: {
    claude: {
      screens: [...whileTyping('claude', '/compact'), CLAUDE_COMPACT_TYPED, CLAUDE_IDLE],
      sends: [...typed('/compact'), { text: '\r', enter: false }],
      last: '\r',
    },
    codex: {
      screens: [...whileTyping('codex', '/compact'), CODEX_COMPACT_TYPED, CODEX_IDLE],
      sends: [...typed('/compact'), { text: '\r', enter: false }],
      last: '\r',
    },
  },
};

// ---------------------------------------------------------------- the fleet

/** The tab the book gives a session, as Orca has it now. */
async function liveTab(box, bots, name = 'daily') {
  const entry = await sessionIn(bots, BOT, name);
  assert.equal(typeof entry?.tab, 'string', `the book should hold a tab for ${name}, got: ${JSON.stringify(entry)}`);
  const terminal = (await tabsOfBot(box, bots, BOT)).find((one) => one.tabId === entry.tab);
  assert.ok(terminal, `Orca should have ${name}'s tab ${entry.tab}`);
  return terminal;
}

/**
 * api-bot up on `harness` with `daily` and `review`, each with a conversation
 * the book holds and the harness has on record (`sess-<name>`), as a session
 * that has had a turn has them. A Codex rollout names Codex 0.160.0.
 */
async function running(box, harness) {
  assert.equal((await box.run(['init', '--bots', 'bots', '--harness', 'claude'])).code, 0);
  const made = await box.run(['bot', 'create', '--bots', 'bots', '--name', BOT, '--harness', harness]);
  assert.equal(made.code, 0, made.stderr);
  for (const name of ['daily', 'review']) {
    const added = await box.run(['session', 'add', '--bots', 'bots', '--bot', BOT, '--name', name, '--prompt', PROMPT]);
    assert.equal(added.code, 0, added.stderr);
  }
  const up = await box.run(['up', '--bots', 'bots', '--bot', BOT]);
  assert.equal(up.code, 0, `the up this test stands on: ${up.stdout}${up.stderr}`);
  const bots = box.path('bots');
  for (const name of ['daily', 'review']) {
    const tab = await liveTab(box, bots, name);
    const heard = await recordSession(box, { bots, bot: BOT, tab: tab.tabId, session: `sess-${name}` });
    assert.equal(heard.code, 0, `the hook report this test stands on: ${heard.stderr}`);
    await conversationOnRecord(box, { harness, cwd: botHomeOf(bots, BOT), id: `sess-${name}`, ...(harness === 'codex' ? { cliVersion: '0.160.0' } : {}) });
  }
  assert.equal((await sessionIn(bots, BOT, 'daily')).session, 'sess-daily', 'the premise: the book holds daily\'s conversation');
  return bots;
}

/** Change one of Orca's terminals, found by its tab id. */
async function changeTab(box, tabId, change) {
  await box.orca.set({
    terminals: (await box.orca.terminals()).map((terminal) => (terminal.tabId === tabId ? { ...terminal, ...change } : terminal)),
  });
}

/** What every tab Orca has had typed into it, by handle. */
async function typedEverywhere(box) {
  return Object.fromEntries((await box.orca.terminals()).map((terminal) => [terminal.handle, terminal.typed ?? []]));
}

/** The sends into the session's tab after its launch line, each as `{ text, enter }`. */
const sendsInto = async (box, bots, name = 'daily') => ((await liveTab(box, bots, name)).typed ?? []).slice(1).map(({ text, enter }) => ({ text, enter }));

/** The one record the harness keeps for conversation `id`. */
async function recordFileOf(box, id) {
  const found = [];
  for (const root of [path.join(box.home, '.codex', 'sessions'), path.join(box.home, '.claude', 'projects')]) {
    let names = [];
    try {
      names = await readdir(root, { recursive: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    for (const name of names) {
      if (path.basename(name) === `${id}.jsonl` || path.basename(name).endsWith(`-${id}.jsonl`)) found.push(path.join(root, name));
    }
  }
  assert.equal(found.length, 1, `the premise: one record for ${id}, got: ${JSON.stringify(found)}`);
  return found[0];
}

/** A compaction written into the conversation's record now, the way `harness` writes one. */
async function compactionIn(file, harness) {
  const at = new Date().toISOString();
  const line = harness === 'codex'
    ? { timestamp: at, type: 'compacted', payload: { message: 'A summary of the conversation so far.' } }
    : { type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', sessionId: 'sess-daily', timestamp: at, compactMetadata: { trigger: 'manual', preTokens: 81522 } };
  await appendFile(file, `${JSON.stringify(line)}\n`);
}

/** `obk session <verb>` for api-bot's daily, with `--json`. */
const sessionCommand = (box, verb, flags = []) => box.run(['session', verb, '--bots', 'bots', '--bot', BOT, '--session', 'daily', ...flags]);

/**
 * What the harness does once the kit's last step is in: the hook reports a
 * new conversation (Claude Code at its `/clear`, Codex at its first turn), or
 * the harness writes its compaction.
 */
async function harnessAnswer(box, bots, verb, harness) {
  if (verb === 'compact') return compactionIn(await recordFileOf(box, 'sess-daily'), harness);
  const tab = await liveTab(box, bots);
  const heard = await recordSession(box, { bots, bot: BOT, tab: tab.tabId, session: 'sess-new', source: harness === 'codex' ? 'startup' : 'clear' });
  assert.equal(heard.code, 0, `the hook's own run: ${heard.stderr}`);
}

/**
 * Start `obk session <verb> --json` for daily, and play the harness: once the
 * kit's last step is among the tab's sends, the harness answers, once.
 * `watch`, when given, is called on every look before that, with the sends so
 * far. Answers the run's result and whether the harness answered.
 */
async function runPlaying(box, bots, verb, harness, { start = () => sessionCommand(box, verb, ['--json']), watch } = {}) {
  const { last } = PLAY[verb][harness];
  let finished = false;
  const run = start();
  run.then(() => { finished = true; }, () => { finished = true; });
  let played = false;
  const until = Date.now() + 60_000;
  while (!finished && Date.now() < until) {
    const sends = await sendsInto(box, bots);
    if (sends.some((one) => one.text === last)) {
      await harnessAnswer(box, bots, verb, harness);
      played = true;
      break;
    }
    if (watch !== undefined) await watch(sends);
    await sleep(10);
  }
  return { result: await run, played };
}

/** The JSON a run answered with, which must have gone through. */
function answered(result, what) {
  assert.equal(result.code, 0, `${what} should go through: ${result.stdout}${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    return assert.fail(`${what} should answer JSON on stdout, got:\n${result.stdout}`);
  }
}

/** The answer of a clear or a compact of daily, as session-clear.test.js has it. */
function assertWent(answer, verb, harness, what) {
  if (verb === 'clear') {
    assert.deepEqual(answer.cleared, { bot: BOT, session: 'daily', harness, was: 'sess-daily', now: 'sess-new' }, `${what}: the clear's answer`);
  } else {
    assert.deepEqual(answer.compacted, { bot: BOT, session: 'daily', harness, conversation: 'sess-daily', confirmed: true }, `${what}: the compact's answer`);
  }
}

// ---------------------------------------------------------------- the tests

describe('session clear, session compact and the typing turn, side by side', { concurrency: true }, () => {
  for (const verb of VERBS) {
    for (const harness of HARNESSES) {
      it(`${verb} on ${harness} with daily's typing turn held for the whole run: refused, nothing typed into any tab, the book as it was, and stderr says the kit is typing into it and nothing was typed`, LIMIT, async (t) => {
        // No screens are played: whatever the screen shows, nothing may be
        // typed while the turn is held.
        const box = await createSandbox(t);
        const bots = await running(box, harness);
        const before = await typedEverywhere(box);
        const book = await sessionIn(bots, BOT, 'daily');

        const started = Date.now();
        const result = await withTypingTurnHeld(bots, BOT, 'daily', () => sessionCommand(box, verb));
        const took = Date.now() - started;

        assert.deepEqual(await typedEverywhere(box), before, 'nothing may be typed into any tab while daily\'s turn is held');
        assert.notEqual(result.code, 0, `it should be refused, got:\n${result.stdout}${result.stderr}`);
        assert.ok(!/^\s+at /m.test(result.stderr), `expected a reason, got a crash:\n${result.stderr}`);
        assert.match(result.stderr, TYPING, `the refusal says the kit is typing into it, got:\n${result.stderr}`);
        assert.match(result.stderr, /nothing was typed/i, `and that nothing was typed, got:\n${result.stderr}`);
        assert.deepEqual(await sessionIn(bots, BOT, 'daily'), book, 'the book holds the conversation it held before');
        assert.ok(took < 30_000, `the wait for the turn is bounded; it took ${took} ms`);
      });

      it(`${verb} on ${harness} with daily's typing turn let go after about 1 s: nothing typed while it was held, then it goes on as today`, LIMIT, async (t) => {
        const box = await createSandbox(t);
        const bots = await running(box, harness);
        await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: PLAY[verb][harness].screens });

        let whileHeld;
        const { result, played } = await withTypingTurnHeld(bots, BOT, 'daily', (release) => runPlaying(box, bots, verb, harness, {
          start: () => {
            const run = sessionCommand(box, verb, ['--json']);
            sleep(1_000).then(async () => {
              whileHeld = await sendsInto(box, bots);
              release();
            });
            return run;
          },
        }));

        assert.deepEqual(whileHeld, [], 'nothing was typed into daily while its turn was held');
        const answer = answered(result, `${verb} once the turn was free`);
        assert.ok(played, 'the premise: the kit\'s last step went in and the harness answered it');
        assert.deepEqual(await sendsInto(box, bots), PLAY[verb][harness].sends, `${verb} typed what it types today, and nothing else`);
        assertWent(answer, verb, harness, 'the turn let go');
      });
    }
  }

  for (const harness of HARNESSES) {
    it(`clear on ${harness} holds daily's typing turn from its first character to the last thing it types`, LIMIT, async (t) => {
      // Looked at from outside on every turn of the loop: the sends before
      // and after the look bracket it, so a look counts only when the kit had
      // begun typing before it and had not yet typed its last step after it.
      const box = await createSandbox(t);
      const bots = await running(box, harness);
      await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: PLAY.clear[harness].screens });
      const { last } = PLAY.clear[harness];
      const looks = [];

      const { result, played } = await runPlaying(box, bots, 'clear', harness, {
        watch: async (sendsBefore) => {
          if (sendsBefore.length === 0) return;
          const held = typingTurnHeld(bots, BOT, 'daily');
          const sendsAfter = await sendsInto(box, bots);
          if (sendsAfter.some((one) => one.text === last)) return;
          looks.push({ held, sent: sendsAfter.length });
        },
      });

      answered(result, 'the clear');
      assert.ok(played, 'the premise: the clear went through to its last step');
      assert.ok(looks.length > 0, 'the premise: the turn was looked at while the clear was typing');
      assert.deepEqual(looks.filter((look) => !look.held), [], `the turn was the clear's at every look while it typed, got: ${JSON.stringify(looks)}`);
    });
  }

  it('clear on claude with review\'s typing turn held: daily is cleared as today', LIMIT, async (t) => {
    const box = await createSandbox(t);
    const bots = await running(box, 'claude');
    await changeTab(box, (await liveTab(box, bots)).tabId, { nextScreens: PLAY.clear.claude.screens });

    const { result, played } = await withTypingTurnHeld(bots, BOT, 'review', () => runPlaying(box, bots, 'clear', 'claude'));

    const answer = answered(result, 'the clear with review\'s turn held');
    assert.ok(played, 'the premise: the return went in and the hook reported the new conversation');
    assert.deepEqual(await sendsInto(box, bots), PLAY.clear.claude.sends);
    assertWent(answer, 'clear', 'claude', 'review\'s turn is not daily\'s');
  });
});
