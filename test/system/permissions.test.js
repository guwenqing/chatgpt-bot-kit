// A system test: the kit's default permission rules, live, on the real Claude
// Code in the real Orca on this machine (#344, slice A). Run it alone with
// `npm run test:system -- --yes test/system/permissions.test.js`; `npm test`
// cannot, and no CI machine could.
//
// What it is the live check for, in the issue's words: a new Claude bot in
// auto mode reads its own mail (`obk message check`, and a long message's body
// file) and sends a reply without a single prompt to the user; it runs a
// default command (its commit, its mail) without a refusal; and a command no
// rule covers still goes to the check.
//
// The order the kit promises is followed as a user would follow it. `bot
// create` shows the rules waiting for a yes and one command that allows them;
// the bot's settings file holds none of them until that command is run, and
// the test runs exactly the line the kit printed. Then `up` brings the bot up.
//
// The bot is given its whole part in its start prompt, with every command it
// runs spelled as the kit spells it (the CLI and the bots folder taken from the
// rules the kit offered): check its mail, read the long body with its Read
// tool, ask the road with `message to`, reply with the `message send` that
// answer names, `git add` and `git commit -- <file>` a file the test put in its
// folder, and last `touch` a file beside the bots folder, which no rule covers.
//
// **Where the evidence comes from.** Nothing here rests on what the model says.
//
//   - What the bot ran and what each call answered: Claude Code's own
//     transcript of the conversation the kit's hook wrote into the book, its
//     `tool_use` items and the `tool_result` for each (tech notes, section 2).
//     A refusal comes back as a `tool_result` with `is_error`, so every default
//     call must have a result that is not one.
//   - That it was the rule that let a default call through: the call as it was
//     run matches a rule in the bot's own `.claude/settings.json`, which holds
//     exactly the rules the kit offered and the user allowed. Where a rule in
//     another settings file covers it too (the user settings on the machine
//     this was written on allow `Bash(git:*)`), that is said as a diagnostic: the kit's rule was there,
//     and it was not the only one.
//   - No prompt to the user: the bot's screen is read every two or three
//     seconds for the whole of the default calls, and a question of the
//     harness's own on it (a numbered choice with the pointer on it,
//     helpers/screens.js), or Orca naming `agent-approval-prompt`, fails the
//     test with the screen and the call still waiting. A prompt nobody answers
//     also stops the bot, so a run with one cannot get to the end either. That
//     Claude Code 2.1.283's permission question is such a numbered list is
//     not captured in this repo: it is what every question of the harnesses'
//     own seen so far looks like but the trust list (tech notes, section 1).
//   - The mail read: the words the two messages carry, which the bot was never
//     told, in the output of its own `message check` and its own Read of the
//     body file; and Orca's mailbox, which holds both messages as read.
//   - The reply: Orca's mailbox for the session it went to holds one message,
//     with both words in it. The long one's word reached the bot only in the
//     file.
//   - The commit: git's own log in the bots repo holds the file, under a
//     message carrying the long one's word, and the file is clean.
//
// **A command no rule covers still goes to the check.** In auto mode an
// uncovered command may simply be allowed, so "it ran" shows nothing either
// way. Claude Code's docs give the order a call is decided in (permission
// modes page): a matching allow, ask or deny rule first; then read-only calls
// and edits inside the working folder; then the classifier, which may refuse,
// and Claude is told why. So the test shows the first two did not decide it:
// no allow rule in any settings file Claude Code reads for this bot matches the
// command as the bot ran it (the user's, the bot folder's, the bots repo
// root's, and the managed file where there is one), and `touch` on a file
// outside the bot's folder is neither read-only nor an edit inside it. What the
// check then did is written down as it happened: it ran (the file is there),
// it was refused (an error result, and no file), or the user was asked. That
// the classifier and not something else made the call is what the docs say
// comes next; nothing a test can read names the classifier.
//
// **Made to grow.** #353 turns charter grants into rules and #354 writes the
// same rules for Codex bots; both need this same check. So a harness is one
// entry in HARNESSES (how its rules are written and read, how its calls are
// read back, what its own questions look like), and a rule is one entry in
// COVERED (the step the bot is given, and how its call is known). Claude and
// the default set are the only entries today.
//
// The machine it runs on is someone's working machine, with their own tabs
// open. So this test, like the others beside it:
//
//   - works in a throwaway bots folder under the system temp directory, made
//     with the prefix `obk-system-permissions-`;
//   - writes down every terminal and workspace Orca already had, before it
//     creates anything;
//   - touches only what it created, matched by handle and by workspace path,
//     and types into no tab at all: the only lines typed are the kit's own;
//   - closes its own tabs one by one (`--terminal <handle> --tab`) and then
//     deletes its own workspaces and folders, whatever happened, and checks
//     afterwards that every terminal that was there before is still there;
//   - reads the user's own Claude settings and never writes them.
//
// `orca terminal close --worktree … --all` is never run here, and the helper
// below refuses to run it at all.
//
// It leaves behind what every system test does: the Run mailboxes Orca cannot
// delete, offline entries in Claude Code's Remote Control list, and the bot's
// transcript under `~/.claude/projects/`.
//
// **It is attended.** Answer only these, in the order they come:
//
//   1. `Bot Father daily`: Claude Code's folder trust. Leave it; nothing here
//      needs Bot Father.
//   2. `Pen Pal daily` (Codex): leave it on whatever it shows. Its mailbox is
//      made before its harness starts, and the reply only has to reach that.
//   3. `Perm Claude daily`: Claude Code's folder trust. Its selection starts on
//      `No, exit`, so it takes a down-arrow and then return. If Claude Code
//      then offers `Teach auto mode about your environment?`, answer `2`, "Not
//      now".
//   4. **Nothing else.** A permission question in `Perm Claude daily` is what
//      this test is looking for: leave it on the screen, and the test fails
//      and shows it.
//
// It takes three to six minutes when the trust screen is answered at once:
// three tabs, one bot's short run of commands, and a look at the mailbox.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from '../helpers/system.js';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'yaml';

import { cliEntry } from '../helpers/cli.js';
import { questionOn } from '../helpers/screens.js';

/**
 * Remove the throwaway bots folder and everything the kit or the bot made
 * beside it: `<bots>.prompts`, `<bots>.messages` where the long body goes, and
 * the file the bot's uncovered command touches are siblings of the bots
 * folder, not children of it (PRD 6.3).
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

/** How long a tab is given to get past the screens of its own, a person answering them included. */
const READY_MS = 180000;

/** How long the launch line's mailbox step is given to write the session's Run into the book. */
const MAILBOX_MS = 60000;

/** How long the bot is given for all of its default calls: two reads, a road, a reply and a commit. */
const DEFAULTS_MS = 480000;

/** How long the bot is given for the one uncovered command, after the rest. */
const UNCOVERED_MS = 240000;

/** How long Orca's inbox is given to list a message the bot's own send already answered for. */
const INBOX_MS = 30000;

/** Ask Orca something and read its JSON. Never the blanket close, on any road. */
function orca(args) {
  assert.ok(
    !(args.includes('--all') && args.includes('close')),
    `refusing to run \`orca ${args.join(' ')}\`: it would take away someone else's tabs`,
  );
  const done = spawnSync(ORCA, [...args, '--json'], { encoding: 'utf8' });
  assert.equal(done.error, undefined, `could not run ${ORCA}: ${done.error?.message}`);
  let answer;
  try {
    answer = JSON.parse(done.stdout);
  } catch {
    assert.fail(`orca ${args.join(' ')} did not answer JSON: ${done.stdout}${done.stderr}`);
  }
  return answer;
}

/** Every terminal Orca knows about right now. */
function allTerminals() {
  const answer = orca(['terminal', 'list']);
  assert.equal(answer.ok, true, `orca terminal list failed: ${JSON.stringify(answer.error)}`);
  return answer.result.terminals;
}

/** The terminals in one workspace, by the path they were opened in. */
const terminalsAt = (home) => allTerminals().filter((terminal) => terminal.worktreePath === home);

/**
 * The tabs Orca lists at `home` once it has caught up with what was closed:
 * `terminal close` answers ok before `terminal list` stops reporting the tab.
 */
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

/**
 * Run this checkout's `obk`, by its full path. The `obk` on PATH is the
 * published release this machine uses, not the code under test (#217).
 */
function obk(args) {
  const done = spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(done.error, undefined, `could not run \`obk\`: ${done.error?.message}`);
  // The owner reads this output. Orca's word for a workspace must not be in it.
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

/** The rules still waiting for a yes for `bot`, from an answer's `permissions`. */
function waitingOf(answer, bot) {
  assert.ok(Array.isArray(answer.permissions), `the answer should carry a permissions list, got: ${JSON.stringify(answer)}`);
  const found = answer.permissions.filter((entry) => entry.bot === bot);
  assert.equal(found.length, 1, `one permissions entry should be about ${bot}, got: ${JSON.stringify(answer.permissions)}`);
  assert.ok(Array.isArray(found[0].waiting), `waiting should be a list, got: ${JSON.stringify(found[0])}`);
  return found[0].waiting;
}

/** What the book says about one session right now. */
async function sessionIn(home, name) {
  const book = parse(await readFile(path.join(home, 'sessions.yaml'), 'utf8')) ?? {};
  return book.sessions?.[name] ?? {};
}

/** The book, read at once: what the calls of a conversation are read by, inside a wait's message too. */
const bookIn = (home) => parse(readFileSync(path.join(home, 'sessions.yaml'), 'utf8')) ?? {};

/** What the bot's `bot.yaml` says the user allowed: missing means none. */
async function allowedIn(home) {
  const bot = parse(await readFile(path.join(home, 'bot.yaml'), 'utf8')) ?? {};
  return bot.allow ?? [];
}

/**
 * Keep asking until `look` gives something other than undefined, or the time
 * runs out. `note` is added to the message when it does, so a run left alone
 * says which screen was waiting rather than only that it waited.
 */
async function until(what, within, look, note = () => '') {
  const stop = Date.now() + within;
  for (;;) {
    const found = await look();
    if (found !== undefined) return found;
    assert.ok(Date.now() < stop, `gave up waiting for ${what} after ${within}ms.${note()}`);
    await setTimeout(1000);
  }
}

/** Everything the tab is rendering right now, as one piece of text to look through. */
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
    ' This test answers nothing a tab asks; see its header for what the person running it answers.',
    `\n  orca terminal read --terminal ${handle} --screen\n  ${screenOf(handle).slice(0, 2000)}`,
  ].join('');
}

/**
 * The question of the harness's own on the tab's screen right now, as its rows,
 * or undefined when there is none or the screen cannot be read. `ours` names
 * the first-run questions the person running the test answers, which are not
 * about a permission.
 */
function questionShown(handle, ours) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  const shown = answer.ok === true ? answer.result?.terminal : undefined;
  if (shown?.source !== 'screen' || !Array.isArray(shown.tail)) return undefined;
  const question = questionOn(shown.tail);
  return question === undefined || ours(question) ? undefined : question;
}

/**
 * Fail at once when the tab is asking the user anything: a question of the
 * harness's own on its screen, or Orca naming an approval prompt it heard of
 * from the harness's hooks (tech notes, section 1). `waiting` names the call
 * the harness is holding, for the message.
 */
function assertNothingAsked(handle, harness, waiting) {
  const question = questionShown(handle, harness.ownQuestion);
  assert.equal(
    question,
    undefined,
    `${harness.name} asked the user something while the bot made its default calls, the call waiting being ${waiting}:\n    ${(question ?? []).join('\n    ')}`,
  );
  const answer = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', '1000']);
  const blocked = answer.ok === true ? answer.result?.wait?.blockedReason : undefined;
  assert.notEqual(
    blocked,
    'agent-approval-prompt',
    `Orca says ${harness.name} is waiting on an approval prompt, the call waiting being ${waiting}.${whatIsUp(handle)}`,
  );
}

/** How many of the newest messages on the machine the inbox is asked for: far more than this test sends. */
const INBOX_LIMIT = 100;

/**
 * Orca's inbox entries for this test's own Runs, by name: `orca orchestration
 * inbox`, a read of Orca's store that takes nothing out of any mailbox. A live
 * run is started from an Orca tab, and from there `obk message check` refuses
 * any session but the tab's own, `--peek` included (#317), so this is the look
 * that is left (codex-nudge.test.js, #298, where it was first used). It lists
 * every recipient's mail on the machine, so everything but the entries of the
 * Runs named here is dropped before anything can print it.
 */
function inboxOf(runs) {
  const asked = `orca orchestration inbox --json --limit ${INBOX_LIMIT}`;
  // Not through `orca()`, whose failures print Orca's output: here that output
  // is everybody's mail.
  const done = spawnSync(ORCA, ['orchestration', 'inbox', '--json', '--limit', String(INBOX_LIMIT)], { encoding: 'utf8' });
  assert.equal(done.error, undefined, `could not run ${ORCA}: ${done.error?.code}`);
  let answer;
  try {
    answer = JSON.parse(done.stdout);
  } catch {
    assert.fail(`${asked} exited ${done.status} and did not answer JSON (${done.stdout.length} characters on stdout, ${done.stderr.length} on stderr; not shown, as they may hold other people's mail)`);
  }
  assert.equal(
    answer?.ok,
    true,
    `${asked} was refused: error code ${JSON.stringify(answer?.error?.code ?? null)} (Orca's message is not shown, as it may quote other people's mail)`,
  );
  const all = answer.result?.messages;
  assert.ok(Array.isArray(all), `the inbox should answer a list of messages, and answered ${all === undefined ? 'none' : typeof all}`);
  const ours = {};
  for (const [name, run] of Object.entries(runs)) {
    ours[name] = all
      .filter((message) => message?.run_id === run)
      .map(({ run_id: runId, read, sequence, subject, body }) => ({ runId, read, sequence, subject, body }));
  }
  return ours;
}

/** A pattern with `*` in it, as a regular expression over the whole text, `*` standing for `star`. */
const glob = (pattern, star) => new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join(star)}$`, 's');

/** A path pattern: `**` for anything, `*` for anything within one folder. */
const pathGlob = (pattern) => new RegExp(
  `^${pattern.split('**').map((part) => glob(part, '[^/]*').source.slice(1, -1)).join('.*')}$`,
  's',
);

/**
 * Whether a Claude Code allow rule lets `call` through, read as its docs give
 * rules (permissions page): `Bash` alone or `Bash(*)` for every command,
 * `Bash(<prefix>:*)` for a command that starts with the prefix, `*` elsewhere
 * as a wildcard; `Read(//<path>)` for an absolute path and `Read(~/<path>)`
 * for one under the home folder, `**` crossing folders. It errs towards
 * "covers": a prefix is not held to a word boundary. Other path forms (relative
 * to a settings file) are not read here and count as not covering.
 */
function claudeRuleCovers(rule, call) {
  const found = /^(\w+)(?:\((.*)\))?$/s.exec(rule);
  if (found === null) return false;
  const [, tool, pattern] = found;
  const everything = pattern === undefined || pattern === '' || pattern === '*';

  if (call.kind === 'command') {
    if (tool !== 'Bash') return false;
    if (everything) return true;
    return glob(pattern.endsWith(':*') ? `${pattern.slice(0, -2)}*` : pattern, '.*').test(call.text);
  }
  if (call.kind === 'read') {
    if (tool !== 'Read') return false;
    if (everything) return true;
    const absolute = pattern.startsWith('//')
      ? pattern.slice(1)
      : pattern.startsWith('~/') ? path.join(os.homedir(), pattern.slice(2)) : undefined;
    return absolute !== undefined && pathGlob(absolute).test(call.text);
  }
  return false;
}

/** The `permissions.allow` list of one Claude settings file: an empty list for no file. */
function claudeAllowIn(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  let settings;
  try {
    settings = JSON.parse(text);
  } catch {
    assert.fail(`${file} is not JSON, so this test cannot say what it allows`);
  }
  const allow = settings?.permissions?.allow ?? [];
  assert.ok(Array.isArray(allow), `${file}'s permissions.allow should be a list, got: ${JSON.stringify(allow)}`);
  return allow;
}

/** The text of a tool result's content, which is a string or a list of text blocks. */
const textOf = (content) => (typeof content === 'string'
  ? content
  : Array.isArray(content) ? content.map((item) => (typeof item === 'string' ? item : item?.text ?? '')).join('\n') : '');

/**
 * The calls a Claude Code conversation made, oldest first, each with its
 * result once the transcript has one: `{ kind, text, result: { error, output } }`,
 * where a Bash call is `kind: 'command'` with the command as written, and a
 * Read is `kind: 'read'` with its path. Read from the harness's own record,
 * `~/.claude/projects/<the folder, every other character a dash>/<id>.jsonl`
 * (tech notes, section 2). A line still being written is left for the next look.
 */
function claudeCalls(home, id) {
  const file = path.join(os.homedir(), '.claude', 'projects', home.replaceAll(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  if (!existsSync(file)) return [];
  const uses = new Map();
  const results = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (entry.type === 'assistant' && item?.type === 'tool_use' && !uses.has(item.id)) uses.set(item.id, item);
      if (entry.type === 'user' && item?.type === 'tool_result') {
        results.set(item.tool_use_id, { error: item.is_error === true, output: textOf(item.content) });
      }
    }
  }
  return [...uses.values()].map((use) => ({
    ...(use.name === 'Bash'
      ? { kind: 'command', text: String(use.input?.command ?? '') }
      : use.name === 'Read'
        ? { kind: 'read', text: String(use.input?.file_path ?? '') }
        : { kind: 'other', text: `${use.name} ${JSON.stringify(use.input ?? {})}` }),
    result: results.get(use.id),
  }));
}

/**
 * The harnesses this check runs on, one entry each. An entry says, for its
 * harness: the default rules the kit offers a bot (so the words the bot's
 * commands are spelled with can be read back out of them), which files hold
 * the rules the harness goes by, how a rule is matched to a call, how the
 * calls a conversation made are read back, and which of its own questions are
 * first-run screens rather than a permission. #354 adds Codex here.
 */
const HARNESSES = [
  {
    name: 'claude',
    bot: 'perm-claude',
    display: 'Perm Claude',

    /**
     * The kit's CLI and bots folder, as words, out of the rules the kit offered:
     * the mail check rule is `Bash(<CLI> message check --bots <BOTS>:*)`.
     */
    kitIn(rules) {
      const found = rules.map((rule) => /^Bash\((.+) message check --bots (.+):\*\)$/.exec(rule)).find((one) => one !== null);
      assert.ok(found !== undefined, `the kit should offer a rule for its mail check, and offered: ${JSON.stringify(rules)}`);
      return { cli: found[1], bots: found[2] };
    },

    /** The six rules the requirement gives, in its order, with the kit's words in them. */
    defaults: (kit, bots) => [
      `Bash(${kit.cli} message check --bots ${kit.bots}:*)`,
      `Bash(${kit.cli} message send --bots ${kit.bots}:*)`,
      `Bash(${kit.cli} message to --bots ${kit.bots}:*)`,
      `Read(/${bots}.messages/**)`,
      'Bash(git add:*)',
      'Bash(git commit:*)',
    ],

    /** The bot's own settings file, the one the kit writes. */
    ownFile: (home) => path.join(home, '.claude', 'settings.json'),

    /**
     * Every file Claude Code's docs say it takes permission rules from for a
     * session started in `home`, a folder of the bots repo: the user's, the
     * project's and the local one, in the working folder and at the git root,
     * and the managed file at the macOS path the settings docs give it (not
     * re-checked for this test; absent on this machine when it was written).
     */
    ruleFiles: (bots, home) => [
      path.join(os.homedir(), '.claude', 'settings.json'),
      path.join(home, '.claude', 'settings.json'),
      path.join(home, '.claude', 'settings.local.json'),
      path.join(bots, '.claude', 'settings.json'),
      path.join(bots, '.claude', 'settings.local.json'),
      '/Library/Application Support/ClaudeCode/managed-settings.json',
    ],

    allowIn: claudeAllowIn,
    covers: claudeRuleCovers,
    callsOf: (home, session) => {
      const id = bookIn(home).sessions?.[session]?.session;
      return typeof id === 'string' ? claudeCalls(home, id) : [];
    },

    /** Claude Code's offer to learn the machine: a first-run screen, answered `2. Not now` (tech notes). */
    ownQuestion: (rows) => rows.some((row) => row.includes('Teach auto mode about your environment')),
  },
];

/** The Codex bot the reply goes to. Codex, so that the pair is not Claude Code's own messaging road. */
const PEN_PAL = { name: 'pen-pal', display: 'Pen Pal' };

/** The words the mail carries, which the bot is never told: one in the short message, one in the long one's file. */
const SHORT_WORD = 'HERON-5521';
const LONG_WORD = 'OCELOT-8817';

const SHORT = { subject: 'the short one', text: `Code word one: ${SHORT_WORD}.` };

/** Over the kit's 4 KiB limit, so it travels as a file; short lines, so a Read shows every one. */
const LONG = {
  subject: 'the long one',
  text: [
    'A long message for the permissions system test. Code word two is further down.',
    ...Array.from({ length: 80 }, (_, n) => `Filler line ${n + 1} of the first half, with nothing in it to act on.`),
    `Code word two: ${LONG_WORD}.`,
    ...Array.from({ length: 80 }, (_, n) => `Filler line ${n + 1} of the second half, with nothing in it to act on.`),
  ].join('\n'),
};

/** The file the test puts in the bot's folder for the bot to commit. */
const COMMIT_FILE = 'permissions-check.txt';

/**
 * What the bot is asked to do that an allowed rule must let through, in the
 * order it does it. Each entry is one step of its start prompt, and how its
 * call is known in the transcript: `kind` and the text the call starts with.
 * `kit` holds the kit's CLI and bots folder as words (`cli`, `bots`), the bots
 * folder as a path (`folder`), and the bot's name. #353 adds a charter grant
 * here as one more entry.
 */
const COVERED = [
  {
    what: 'its mail check',
    step: (kit) => `As soon as you are running, read your mail with exactly this command: ${kit.cli} message check --bots ${kit.bots} --bot ${kit.bot} --session daily`
      + ' . If it has not shown you both messages, run the same command again a few seconds later, until it has.'
      + ' If a line arrives saying fleet mail is waiting, run exactly the command that line names.',
    kind: 'command',
    starts: (kit) => `${kit.cli} message check --bots ${kit.bots}`,
  },
  {
    what: 'its read of the long message\'s file',
    step: () => 'Then read the file the long message names with your Read tool, not with a shell command, and find code word two in it.',
    kind: 'read',
    starts: (kit) => `${kit.folder}.messages/`,
  },
  {
    what: 'its ask for the road',
    step: (kit) => `Then ask the kit for the road to ${PEN_PAL.name}/daily with exactly this command: ${kit.cli} message to --bots ${kit.bots} --to ${PEN_PAL.name}/daily`,
    kind: 'command',
    starts: (kit) => `${kit.cli} message to --bots ${kit.bots}`,
  },
  {
    what: 'its reply',
    step: () => 'Then send your reply with the send command that answer names, with the subject \'permissions reply\','
      + ' and as its text code word one, a space, and code word two.',
    kind: 'command',
    starts: (kit) => `${kit.cli} message send --bots ${kit.bots}`,
  },
  {
    what: 'its git add',
    step: () => `Then run exactly: git add -- ${COMMIT_FILE}`,
    kind: 'command',
    starts: () => 'git add',
  },
  {
    what: 'its git commit',
    step: () => `Then run exactly: git commit -m 'permissions check CODE' -- ${COMMIT_FILE} , with CODE replaced by code word two.`,
    kind: 'command',
    starts: () => 'git commit',
  },
];

/**
 * The command no rule covers, last. `touch` on a file beside the bots folder:
 * not read-only, and not an edit inside the bot's working folder, so by the
 * order Claude Code's docs give it is neither of the two things decided before
 * the classifier. Harmless either way, and what became of it is on the disk.
 */
const UNCOVERED = {
  what: 'a command no rule covers',
  file: (kit) => `${kit.folder}.uncovered.txt`,
  step: (kit) => `Last, run exactly this command, once: touch ${kit.folder}.uncovered.txt . If it is refused, do not run it again or try any other way.`,
  kind: 'command',
  starts: (kit) => `touch ${kit.folder}.uncovered.txt`,
};

/** Whether a call is one a case asks for: the same kind, and its text starting with the case's words. */
function isCallOf(entry, kit, call) {
  if (call.kind !== entry.kind) return false;
  const start = entry.starts(kit);
  return entry.kind === 'read' ? call.text.startsWith(start) : call.text === start || call.text.startsWith(`${start} `);
}

/** The bot's whole part, in its start prompt: nothing is typed into its tab but the kit's own lines. */
const botPrompt = (kit) => [
  'You are a system test\'s bot and you own nothing.',
  `Your bots folder is ${kit.folder}.`,
  'Do nothing that is not written here: read no file but the one the long message names, write nothing,'
  + ' and run no command but the ones below.',
  'Run each command exactly as it is written here, or as the kit\'s answer gives it, on its own:'
  + ' nothing before it or after it, no cd, no pipe and no redirection.',
  `Two messages from ${PEN_PAL.name}/daily are waiting for you: a short one with code word one in it,`
  + ' and a long one whose text is in a file the message names, with code word two in that text.',
  ...COVERED.map((entry) => entry.step(kit)),
  UNCOVERED.step(kit),
  'Then say nothing else and wait.',
].join(' ');

/** The pen pal's part: nothing at all. The reply only has to reach its mailbox. */
const PEN_PAL_PROMPT = 'You are a system test\'s pen pal and you own nothing. Run no command, read no file, write nothing'
  + ' and use no tool. If a line says fleet mail is waiting, leave it unread and say nothing. Say nothing now and wait.';

/** The allow command a plain report offers for `bot`: the line naming `bot change` and the bot, from the CLI on. */
function offeredCommand(stdout, cli, bot) {
  const lines = stdout.split('\n').filter((line) => line.includes(' bot change ') && line.includes(` --bot ${bot} `) && line.includes('--allow'));
  assert.equal(lines.length, 1, `the kit should print one command that allows what waits for ${bot}, and printed:\n${stdout}`);
  const at = lines[0].indexOf(cli);
  assert.ok(at >= 0, `the command should start with the kit's own CLI (${cli}), got: ${lines[0]}`);
  return lines[0].slice(at).trim().replace(/`$/, '');
}

/** One line per call, for a message: what it was and what it answered. */
const callLines = (calls) => calls
  .map((call) => `\n    ${call.kind} ${call.text}${call.result === undefined ? '  (no result yet)' : call.result.error ? `  (error: ${call.result.output.slice(0, 300)})` : ''}`)
  .join('');

for (const harness of HARNESSES) {
  test(`a ${harness.name} bot in auto mode runs the kit's default commands with no prompt once the user said yes, and a command no rule covers still goes to the check`, async (t) => {
    const before = {
      handles: new Set(allTerminals().map((terminal) => terminal.handle)),
      setups: new Set(allSetups().map((setup) => setup.id)),
    };

    const bots = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-system-permissions-')));
    const homeOf = (bot) => path.join(bots, 'bots', bot);
    const homes = ['bot-father', PEN_PAL.name, harness.bot].map(homeOf);
    const home = homeOf(harness.bot);

    // Registered before anything is created, so it runs however this test ends.
    t.after(async () => {
      const closed = [];
      for (const each of homes) {
        for (const terminal of terminalsAt(each)) {
          if (before.handles.has(terminal.handle)) continue;
          orca(['terminal', 'close', '--terminal', terminal.handle, '--tab']);
          closed.push(terminal.handle);
        }
      }
      for (const setup of allSetups()) {
        if (!homes.includes(setup.path) || before.setups.has(setup.id)) continue;
        orca(['project', 'setup-delete', '--setup', setup.id]);
      }
      await removeBotsFolderAndSiblings(bots);

      // The point of all the care above: everything that was open is still open.
      const left = new Set(allTerminals().map((terminal) => terminal.handle));
      for (const handle of before.handles) {
        assert.ok(left.has(handle), `${handle} was open before this test and is gone now`);
      }
      for (const each of homes) {
        assert.deepEqual(await terminalsAfterClosing(each, closed), [], `this test left tabs behind in ${each}`);
      }
    });

    obkJson(['init', '--bots', bots, '--harness', 'claude']);
    obkJson([
      'bot', 'create', '--bots', bots, '--name', PEN_PAL.name, '--harness', 'codex',
      '--charter', `${PEN_PAL.display} exists for one system test run and owns nothing.`,
    ]);
    obkJson(['session', 'add', '--bots', bots, '--bot', PEN_PAL.name, '--name', 'daily', `--prompt=${PEN_PAL_PROMPT}`]);

    // 1. The bot is made, and the kit shows what waits for the user's yes. The
    //    plain report is what a user reads: it holds the command to run.
    const created = obk([
      'bot', 'create', '--bots', bots, '--name', harness.bot, '--harness', harness.name,
      '--charter', `${harness.display} exists for one system test run and owns nothing.`,
    ]);
    assert.equal(created.status, 0, `obk bot create failed: ${created.stdout}${created.stderr}`);

    const waiting = waitingOf(obkJson(['rules', 'build', '--bots', bots, '--bot', harness.bot]), harness.bot);
    const words = harness.kitIn(waiting);
    // The bot's commands will be spelled with these words, so they must name
    // this checkout's CLI and this throwaway folder, never the machine's `obk`.
    assert.ok([cliEntry, `'${cliEntry}'`].includes(words.cli), `the rules should name this checkout's CLI, ${cliEntry}, and name ${words.cli}`);
    assert.ok([bots, `'${bots}'`].includes(words.bots), `the rules should name this bots folder, ${bots}, and name ${words.bots}`);
    const kit = { ...words, folder: bots, bot: harness.bot };
    assert.deepEqual(waiting, harness.defaults(kit, bots), 'the rules waiting should be the default set, word for word');

    // Nothing is written before the yes.
    const ownFile = harness.ownFile(home);
    assert.deepEqual(harness.allowIn(ownFile), [], `no rule should be in ${ownFile} before the user said yes`);

    // 2. The yes: the exact command the kit printed, run as a user would paste it.
    const command = offeredCommand(created.stdout, words.cli, harness.bot);
    const allowed = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8', cwd: os.tmpdir() });
    assert.equal(allowed.status, 0, `the command the kit printed should run: ${command}\n${allowed.stdout}${allowed.stderr}`);
    assert.ok(!/worktree/i.test(allowed.stdout + allowed.stderr), `obk said "worktree": ${allowed.stdout}${allowed.stderr}`);
    assert.deepEqual(await allowedIn(home), waiting, 'bot.yaml should keep the yes, every rule of it');
    assert.deepEqual(harness.allowIn(ownFile), waiting, `${ownFile} should hold exactly the rules the user allowed`);

    // The bot's part, and the file it commits.
    await writeFile(path.join(home, COMMIT_FILE), 'A file for the permissions system test to commit.\n');
    obkJson(['session', 'add', '--bots', bots, '--bot', harness.bot, '--name', 'daily', `--prompt=${botPrompt(kit)}`]);

    // 3. Up: the pen pal first, whose mailbox the reply goes to, then the bot.
    //    Nothing waits for a yes any more.
    const mailboxOf = (bot) => until(
      `${bot}/daily to have its mailbox in the book`,
      MAILBOX_MS,
      async () => {
        const { mailbox } = await sessionIn(homeOf(bot), 'daily');
        return /^run_/.test(String(mailbox)) ? mailbox : undefined;
      },
    );
    tabOf(obkJson(['up', '--bots', bots, '--bot', PEN_PAL.name]), 'daily');
    const penPalRun = await mailboxOf(PEN_PAL.name);

    const up = obkJson(['up', '--bots', bots, '--bot', harness.bot]);
    assert.deepEqual(waitingOf(up, harness.bot), [], 'once allowed, nothing should wait for a yes at up');
    const entry = tabOf(up, 'daily');
    assert.equal(entry.created, true);
    assert.equal(
      entry.harnessStarted,
      true,
      `no ${harness.name} came up in ${entry.title}: look at it with \`orca terminal read --terminal ${entry.terminal} --screen\``,
    );
    const handle = entry.terminal;
    const botRun = await mailboxOf(harness.bot);

    // 4. The mail, sent while the tab is still on its first-run screen, so both
    //    are waiting when the bot first checks. The kit types nothing into a tab
    //    on that screen, and says so; the bot's start prompt is its wake-up.
    const send = (message) => obkJson([
      'message', 'send', '--bots', bots, '--to', `${harness.bot}/daily`, '--from', `${PEN_PAL.name}/daily`,
      '--subject', message.subject, '--text', message.text,
    ]);
    const sentLong = send(LONG);
    const sentShort = send(SHORT);
    for (const [which, sent] of [['long', sentLong], ['short', sentShort]]) {
      assert.equal(sent.sent, true, `the ${which} message should be in the mailbox: ${JSON.stringify(sent)}`);
      t.diagnostic(`the ${which} message: nudged ${JSON.stringify(sent.nudged)}${sent.blocked === undefined ? '' : `, blocked ${sent.blocked}`}`);
    }
    assert.equal(typeof sentLong.file, 'string', `the long message should have gone as a file: ${JSON.stringify(sentLong)}`);
    assert.ok(sentLong.file.startsWith(`${bots}.messages${path.sep}`), `and into ${bots}.messages, which the Read rule names: ${sentLong.file}`);
    assert.equal(sentShort.file, undefined, `the short message should have gone as itself: ${JSON.stringify(sentShort)}`);

    // 5. The harness is running once the folder trust is answered: the kit's
    //    hook writes its conversation into the book.
    await until(
      `${harness.bot}/daily to report its conversation`,
      READY_MS,
      async () => ((await sessionIn(home, 'daily')).session === undefined ? undefined : true),
      () => ` Answer Claude Code's folder trust in ${entry.title}.${whatIsUp(handle)}`,
    );

    // 6. The default calls, each with its result, and nobody asked a thing
    //    while they were made. A refused one fails at once, with what it said.
    const calls = () => harness.callsOf(home, 'daily');
    const made = await until(
      `${harness.bot} to make every default call`,
      DEFAULTS_MS,
      async () => {
        const now = calls();
        for (const step of COVERED) {
          const refused = now.find((call) => isCallOf(step, kit, call) && call.result?.error === true);
          assert.equal(refused, undefined, `${step.what} came back as an error: ${JSON.stringify(refused)}`);
        }
        if (COVERED.every((step) => now.some((call) => isCallOf(step, kit, call) && call.result !== undefined))) return now;
        // Not done, so a default call is still to come or still waiting: a
        // question now is about it (or about something the bot was not asked).
        const open = now.filter((call) => call.result === undefined).at(-1);
        assertNothingAsked(handle, harness, open === undefined ? 'none yet' : `${open.kind} ${open.text}`);
        return undefined;
      },
      () => `${callLines(calls())}${whatIsUp(handle)}`,
    );

    // What let each default call through: a rule in the bot's own settings,
    // which holds only what the user allowed. A rule elsewhere that covers it
    // too is said, not failed: the kit's rule was there either way.
    const ruleFiles = harness.ruleFiles(bots, home);
    for (const step of COVERED) {
      for (const call of made.filter((one) => isCallOf(step, kit, one))) {
        const own = harness.allowIn(ownFile).filter((rule) => harness.covers(rule, call));
        assert.notDeepEqual(
          own,
          [],
          `${step.what}, run as \`${call.text}\`, is covered by no rule in ${ownFile}: the command the bot ran is not what the kit's rule covers`,
        );
        const elsewhere = ruleFiles
          .filter((file) => file !== ownFile)
          .flatMap((file) => harness.allowIn(file).filter((rule) => harness.covers(rule, call)).map((rule) => `${rule} in ${file}`));
        t.diagnostic(`${step.what}: \`${call.text}\` let through by ${own.join(', ')}${elsewhere.length === 0 ? '' : `; also covered by ${elsewhere.join(', ')}`}`);
      }
    }

    // 7. The mail was read, by the harness's own record: the short message's
    //    word came back from the bot's own mail check, the long one's file was
    //    named there, and its word came back from the bot's own read of it.
    const checks = made.filter((call) => isCallOf(COVERED.find((step) => step.what === 'its mail check'), kit, call));
    assert.ok(checks.some((call) => call.result.output.includes(SHORT_WORD)), `a mail check should have shown the short message's ${SHORT_WORD}:${callLines(checks)}`);
    assert.ok(checks.some((call) => call.result.output.includes(sentLong.file)), `a mail check should have named the long message's file:${callLines(checks)}`);
    const reads = made.filter((call) => call.kind === 'read' && call.text === sentLong.file);
    assert.ok(reads.some((call) => call.result.output.includes(LONG_WORD)), `the Read of ${sentLong.file} should have shown ${LONG_WORD}:${callLines(reads)}`);

    // And by Orca's store: both messages are in the bot's Run, read. The reply
    // is in the pen pal's, the only mail it has, carrying both words, one of
    // which the bot could only have got from the file.
    const inbox = await until(
      `the reply to show in Orca's inbox for ${PEN_PAL.name}/daily`,
      INBOX_MS,
      async () => {
        const found = inboxOf({ bot: botRun, penPal: penPalRun });
        return found.penPal.length > 0 ? found : undefined;
      },
    );
    for (const message of [SHORT, LONG]) {
      const found = inbox.bot.filter((one) => one.subject === message.subject);
      assert.equal(found.length, 1, `${harness.bot}'s Run should hold ${message.subject}, and the newest ${INBOX_LIMIT} of the inbox hold: ${JSON.stringify(inbox.bot)}`);
      assert.equal(
        found[0].read,
        1,
        `${message.subject} should be read: the bot's own mail check shows it. Either the inbox's \`read\` does not mean acknowledged, or the check did not acknowledge it: ${JSON.stringify(found[0])}`,
      );
    }
    assert.equal(inbox.penPal.length, 1, `${PEN_PAL.name}'s Run should hold the one reply: ${JSON.stringify(inbox.penPal)}`);
    for (const word of [SHORT_WORD, LONG_WORD]) {
      assert.ok(String(inbox.penPal[0].body).includes(word), `the reply should carry ${word}: ${JSON.stringify(inbox.penPal[0])}`);
    }

    // 8. The commit, by git's own record in the bots repo: the file is in a
    //    commit whose message carries the long message's word, and it is clean.
    const inRepo = path.join('bots', harness.bot, COMMIT_FILE);
    const git = (args) => {
      const done = spawnSync('git', ['-C', bots, ...args], { encoding: 'utf8' });
      assert.equal(done.status, 0, `git ${args.join(' ')} failed: ${done.stdout}${done.stderr}`);
      return done.stdout;
    };
    const commits = git(['log', '--format=%s', '--', inRepo]).split('\n').filter((line) => line !== '');
    assert.equal(commits.length, 1, `one commit should hold ${inRepo}, and git's log for it is: ${JSON.stringify(commits)}`);
    assert.ok(commits[0].includes(LONG_WORD), `the commit should be the bot's, its message carrying ${LONG_WORD}: ${commits[0]}`);
    assert.equal(git(['status', '--porcelain', '--', inRepo]), '', `${inRepo} should be committed and clean`);

    // 9. The command no rule covers. It is the bot's last step: it is decided
    //    by the check (it runs, or is refused and the bot told why), or the
    //    user is asked, and nothing here answers.
    const outcome = await until(
      `${harness.bot} to make ${UNCOVERED.what}, and something to decide it`,
      UNCOVERED_MS,
      async () => {
        const call = calls().find((one) => isCallOf(UNCOVERED, kit, one));
        if (call?.result !== undefined) return { call, how: call.result.error ? 'refused' : 'ran' };
        const question = questionShown(handle, harness.ownQuestion);
        return call !== undefined && question !== undefined ? { call, how: 'asked', question } : undefined;
      },
      () => `${callLines(calls())}${whatIsUp(handle)}`,
    );
    t.diagnostic(`${UNCOVERED.what}, \`${outcome.call.text}\`: ${outcome.how}${outcome.how === 'refused' ? `, saying: ${outcome.call.result.output.slice(0, 500)}` : ''}`);

    // No rule was what decided it: none, in any file the harness takes rules
    // from, covers the command as the bot ran it. The kit wrote none for it.
    const covering = ruleFiles.flatMap((file) => harness.allowIn(file)
      .filter((rule) => harness.covers(rule, outcome.call))
      .map((rule) => `${rule} in ${file}`));
    assert.deepEqual(covering, [], `no allow rule may cover \`${outcome.call.text}\`, or this run shows nothing about the check`);
    assert.deepEqual(harness.allowIn(ownFile), waiting, `${ownFile} should still hold exactly the rules the user allowed`);

    // And the disk agrees with what the transcript says became of it.
    if (outcome.how !== 'asked') {
      assert.equal(
        existsSync(UNCOVERED.file(kit)),
        outcome.how === 'ran',
        `the transcript says it ${outcome.how}, and ${UNCOVERED.file(kit)} ${existsSync(UNCOVERED.file(kit)) ? 'is' : 'is not'} there`,
      );
    }
  });
}
