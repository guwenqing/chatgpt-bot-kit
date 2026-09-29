// `obk health` names a Claude session whose book address is not one the kit
// made (#450).
//
// Since #286 a Claude session is started under an address of its own,
// `<bot>.<session>.<8 of [a-z0-9]>` (src/launch.js `addressOf`), and one whose
// book holds any other address is moved to a new one at its next start. A
// session that keeps running, or that Orca brings back by itself, stays on the
// address it had. When that is the bare `<bot>.<session>` of before #286, it is
// a name every fleet with that bot and session shares: on 2026-09-29 a
// throwaway test fleet's grooming session, not finding its own daily, sent its
// report to the owner's real `bot-father.daily` (#450, seen). Nothing said so.
//
// So health reports a Claude session whose book `address` is set and is not
// one the kit made, whatever the session's state. The finding names the bot,
// the session and the address; for the bare name it says the name is shared,
// that a session of another fleet with the same bot and session names can
// write to it; and it gives the restart that moves the session to an address
// of its own: the kit's own CLI, as every command the kit prints is (#220),
// running `restart` with the bots folder, the bot and the session. A kit-made
// address, a Claude session with no address in its book, and any Codex
// session, whatever its book holds, get nothing.
//
// The wording is the implementer's; the kind of finding is not pinned. What is
// pinned is the bot, the session, the address and the command, and for the
// bare name that it is shared, read loosely. Everything runs against the fake
// Orca, with the book edited as a person would edit it.

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { parse, stringify } from 'yaml';

import {
  bookOf,
  botHomeOf,
  conversationOnRecord,
  createSandbox,
  sessionIn,
  sh,
  shellWord,
  spellingsOf,
} from './helpers/cli.js';

/** The kinds a finding can be. */
const KINDS = ['orca', 'config', 'skill', 'session', 'leftover'];

/** An address the kit makes for a bot and session: the pair and a token of eight [a-z0-9]. */
const kitMade = (bot, session) => new RegExp(`^${bot}\\.${session}\\.[a-z0-9]{8}$`);

// ---------------------------------------------------------------- the fleet

/** Run one `obk` command that has to work for the test to mean anything. */
async function obk(box, ...args) {
  const result = await box.run(args);
  assert.equal(result.code, 0, `obk ${args.join(' ')}: ${result.stderr}${result.stdout}`);
  return result;
}

/**
 * Bot Father, api-bot on Claude Code with daily and review, and web-bot on
 * Codex with daily, all brought up by the kit, so that each Claude session's
 * book holds an address the kit made for it.
 */
async function fleet(box) {
  await obk(box, 'init', '--bots', 'bots', '--harness', 'claude');
  for (const [bot, harness, sessions] of [['api-bot', 'claude', ['daily', 'review']], ['web-bot', 'codex', ['daily']]]) {
    await obk(box, 'bot', 'create', '--bots', 'bots', '--name', bot, '--harness', harness);
    for (const session of sessions) await obk(box, 'session', 'add', '--bots', 'bots', '--bot', bot, '--name', session);
    await obk(box, 'up', '--bots', 'bots', '--bot', bot);
  }
  const bots = box.path('bots');
  for (const [bot, session] of [['bot-father', 'daily'], ['api-bot', 'daily'], ['api-bot', 'review']]) {
    const address = (await sessionIn(bots, bot, session))?.address;
    assert.match(String(address), kitMade(bot, session), `the premise: the kit gave ${bot} ${session} an address of its own, got: ${address}`);
  }
  return bots;
}

/** Set, or with `undefined` take away, what one session's book entry says its address is, as a person editing the book would. */
async function addressIs(bots, bot, session, address) {
  const file = bookOf(bots, bot);
  const book = parse(await readFile(file, 'utf8'));
  if (address === undefined) delete book.sessions[session].address;
  else book.sessions[session].address = address;
  await writeFile(file, stringify(book));
}

// ------------------------------------------------------------- what it answers

/** Run the health check. */
const health = (box, ...rest) => box.run(['health', '--bots', 'bots', ...rest]);

/**
 * Run the health check for JSON and hold it to its shape: findings of the
 * kinds there are, each saying where and what, and the exit code the findings
 * call for (1 when there is one, 0 when there is none).
 */
async function found(box) {
  const result = await health(box, '--json');
  assert.equal(result.stderr, '', `a health run reports on stdout, and put this on stderr: ${result.stderr}`);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (error) {
    return assert.fail(`--json should print JSON and nothing else, got: ${result.stdout} (${error.message})`);
  }
  assert.ok(Array.isArray(answer.found), `the answer should carry a list of findings, got: ${result.stdout}`);
  for (const finding of answer.found) {
    assert.ok(KINDS.includes(finding.kind), `a finding's kind is one of ${KINDS.join(', ')}, got: ${JSON.stringify(finding)}`);
    assert.ok(typeof finding.where === 'string' && finding.where.trim() !== '', `a finding says what it is about, got: ${JSON.stringify(finding)}`);
    assert.ok(typeof finding.says === 'string' && finding.says.trim() !== '', `a finding says something, got: ${JSON.stringify(finding)}`);
  }
  assert.equal(
    result.code,
    answer.found.length === 0 ? 0 : 1,
    `${answer.found.length} findings should exit ${answer.found.length === 0 ? 0 : 1}, got ${result.code}`,
  );
  return answer;
}

/** Everything one finding puts in front of a reader. */
const wordsOf = (finding) => `${finding.where} ${finding.says}`;

const escaped = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `word` is in `text` as a word of its own, not inside another, as the other health tests read one. */
const hasWord = (text, word) => new RegExp(`(^|[^A-Za-z0-9_-])${escaped(word)}($|[^A-Za-z0-9_-])`).test(text);

/**
 * Whether an address is in `text` whole: not the start or the end of a longer
 * dotted name, so `api-bot.daily` is not found in `api-bot.daily.ab12cd34`. A
 * full stop that ends the sentence may follow it.
 */
const hasAddress = (text, address) => new RegExp(`(^|[^A-Za-z0-9_.-])${escaped(address)}($|[^A-Za-z0-9_.-]|\\.(?![A-Za-z0-9]))`).test(text);

/** The findings about one session of one bot: the bot's own, naming the session. */
const about = (answer, bot, session) => answer.found.filter((one) => one.bot === bot && hasWord(wordsOf(one), session));

/** Every run of whitespace as one space, so an indented or re-wrapped sentence still reads the same. */
const flat = (text) => text.replace(/\s+/g, ' ').trim();

/** Words that say a name is shared, read loosely: another fleet, any session of that name, more than one. */
const SHARED = /\bshared?\b|\banother fleet\b|\bother fleets?\b|\bany fleet\b|\bevery fleet\b|\bmore than one\b|\bany session\b/i;

/**
 * The one finding about a session whose address the kit did not make: it names
 * the bot, the session and the address, and gives the kit's own restart for
 * that bot and session. Returns it.
 */
function assertNamedAddress(answer, box, bots, bot, session, address) {
  const mine = about(answer, bot, session);
  assert.equal(mine.length, 1, `one finding about ${bot} ${session}, whose book address is ${address}, got: ${JSON.stringify(answer.found, null, 2)}`);
  const [finding] = mine;
  const said = wordsOf(finding);
  assert.ok(said.includes(bot), `it names the bot, got: ${said}`);
  assert.ok(hasWord(said, session), `and the session, got: ${said}`);
  assert.ok(hasAddress(said, address), `and the address, ${address}, whole, got: ${said}`);
  assert.ok(
    spellingsOf(box.cli).some((cli) => finding.says.includes(`${cli} restart `)),
    `the command is the kit's own CLI, ${shellWord(box.cli)}, running restart, got: ${finding.says}`,
  );
  assert.ok(spellingsOf(bots).some((word) => finding.says.includes(`--bots ${word}`)), `the restart names the bots folder, got: ${finding.says}`);
  assert.ok(finding.says.includes(`--bot ${bot}`), `the restart names the bot, got: ${finding.says}`);
  assert.ok(hasWord(finding.says, `--session ${session}`), `the restart names the session, got: ${finding.says}`);
  return finding;
}

/** The plain run says what the JSON said about `finding`: kind and where on one line, and the same words. */
function assertPlainSays(plain, finding) {
  assert.equal(plain.code, 1, `the plain run finds the same, got: ${plain.stdout}${plain.stderr}`);
  assert.equal(plain.stderr, '');
  assert.ok(
    plain.stdout.split('\n').some((line) => line.includes(finding.kind) && line.includes(finding.where)),
    `one plain line holds the finding's kind and where, got:\n${plain.stdout}`,
  );
  assert.ok(flat(plain.stdout).includes(flat(finding.says)), `and the plain lines say what the JSON says, got:\n${plain.stdout}`);
}

// ---------------------------------------------------------------------------
// A1 — the bare name of before #286
// ---------------------------------------------------------------------------

test('A1 a Claude session whose book holds the bare <bot>.<session> is named: the address, that it is shared, and its restart', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await addressIs(bots, 'api-bot', 'daily', 'api-bot.daily');

  const answer = await found(box);
  const plain = await health(box);

  const finding = assertNamedAddress(answer, box, bots, 'api-bot', 'daily', 'api-bot.daily');
  assert.match(finding.says, SHARED, `it says the name is shared: a session of another fleet with the same names can write to it, got: ${finding.says}`);
  assertPlainSays(plain, finding);

  // The contrast: review, beside it on the same bot, keeps the address the kit
  // made for it, and so does Bot Father's daily.
  assert.deepEqual(about(answer, 'api-bot', 'review'), [], 'review has an address of its own');
  assert.deepEqual(about(answer, 'bot-father', 'daily'), [], 'so does Bot Father\'s daily');
  assert.equal(answer.found.length, 1, `daily's is the only finding in this fleet, got: ${JSON.stringify(answer.found, null, 2)}`);
});

test('A1 Bot Father\'s own daily on the bare bot-father.daily is named with its restart, the case #450 was', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await addressIs(bots, 'bot-father', 'daily', 'bot-father.daily');

  const answer = await found(box);

  const finding = assertNamedAddress(answer, box, bots, 'bot-father', 'daily', 'bot-father.daily');
  assert.match(finding.says, SHARED, `it says the name is shared, got: ${finding.says}`);
});

// ---------------------------------------------------------------------------
// A2 — any other address the kit did not make
// ---------------------------------------------------------------------------

for (const [label, address] of [
  ['an old name of the user\'s own', 'my-api-helper'],
  ['a token of seven characters', 'api-bot.daily.abc1234'],
  ['a token of nine characters', 'api-bot.daily.abc123456'],
  ['a token with capitals, which the kit never makes', 'api-bot.daily.ABC12345'],
  ['another session\'s address, kit-made for it', 'api-bot.review.abcd1234'],
]) {
  test(`A2 a Claude session whose book holds ${label} (${address}) is named with its restart`, async (t) => {
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await addressIs(bots, 'api-bot', 'daily', address);

    const answer = await found(box);

    assertNamedAddress(answer, box, bots, 'api-bot', 'daily', address);
    assert.equal(answer.found.length, 1, `daily's is the only finding, got: ${JSON.stringify(answer.found, null, 2)}`);
  });
}

// ---------------------------------------------------------------------------
// A3 — nothing to say
// ---------------------------------------------------------------------------

test('A3 a fleet whose Claude sessions all hold the addresses the kit made for them has nothing said about addresses', async (t) => {
  const box = await createSandbox(t);
  await fleet(box);

  const answer = await found(box);

  assert.deepEqual(answer.found, [], `every address is one the kit made, got: ${JSON.stringify(answer.found, null, 2)}`);
});

test('A3 a Claude session with no address in its book has nothing said about it', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await addressIs(bots, 'api-bot', 'daily', undefined);

  const answer = await found(box);

  assert.deepEqual(about(answer, 'api-bot', 'daily'), [], `no address, nothing to say about one, got: ${JSON.stringify(answer.found, null, 2)}`);
});

for (const [label, address] of [['the bare web-bot.daily', 'web-bot.daily'], ['a name of the user\'s own', 'my-web-helper']]) {
  test(`A3 a Codex session has nothing said about its book's address, even ${label}`, async (t) => {
    // Codex sessions are reached through the Orca mailbox, not by a name of
    // Claude Code's, so an address in a Codex session's book names nothing.
    const box = await createSandbox(t);
    const bots = await fleet(box);
    await addressIs(bots, 'web-bot', 'daily', address);

    const answer = await found(box);

    assert.deepEqual(about(answer, 'web-bot', 'daily'), [], `a Codex session, got: ${JSON.stringify(answer.found, null, 2)}`);
    assert.deepEqual(answer.found, [], `and nothing else in this fleet, got: ${JSON.stringify(answer.found, null, 2)}`);
  });
}

// ---------------------------------------------------------------------------
// A4 — the advice works when followed (review of PR #452)
// ---------------------------------------------------------------------------
//
// `obk restart` refuses a session whose tab is open when the book does not say
// which conversation is in it (src/restart.js): closing the tab would be the
// end of it. So a finding about a session with no conversation id in its book
// has to say that the id is written into the book first, naming the book file
// and the session, before its restart; and the restart it prints, once that is
// done, has to work. Both are checked by doing what the finding says.

/** A conversation id, shaped as Claude Code shapes them. */
const CONVERSATION = '0199b2c0-0450-4444-8888-cccccccccccc';

/**
 * The restart the finding prints, as a shell would be handed it: the kit's own
 * CLI, `restart`, and each `--flag value` after it, up to the first word that
 * is not a flag. Values are single-quoted or bare, as the kit prints them.
 */
function printedRestart(box, says) {
  const spelling = spellingsOf(box.cli).find((cli) => says.includes(`${cli} restart `));
  assert.ok(spelling !== undefined, `the finding prints the kit's own restart, got: ${says}`);
  const words = [spelling, 'restart'];
  let rest = says.slice(says.indexOf(`${spelling} restart `) + `${spelling} restart `.length);
  const word = /^(?:'(?:[^']|'\\'')*'|[^\s'`]+)+/;
  for (;;) {
    const flag = /^(--[a-z-]+)\s+/.exec(rest);
    if (flag === null) break;
    rest = rest.slice(flag[0].length);
    const value = word.exec(rest);
    if (value === null) break;
    words.push(flag[1], value[0].replace(/[.,;:]+$/, ''));
    rest = rest.slice(value[0].length).replace(/^\s+/, '');
  }
  return words.join(' ');
}

/** Write the conversation `id` into one session's book entry as `session: <id>`, as the finding says to. */
async function conversationIs(bots, bot, session, id) {
  const file = bookOf(bots, bot);
  const book = parse(await readFile(file, 'utf8'));
  book.sessions[session].session = id;
  await writeFile(file, stringify(book));
}

/** Run the printed restart as a person would, in a shell, and hold it to working and to moving the session to an address the kit made. */
async function followRestart(box, bots, bot, session, command) {
  const ran = await sh(command, { cwd: box.cwd, env: box.env });
  assert.equal(ran.code, 0, `the restart the finding printed should work: ${command}\n${ran.stdout}${ran.stderr}`);
  const address = (await sessionIn(bots, bot, session))?.address;
  assert.match(String(address), kitMade(bot, session), `and the session is then on an address the kit made, got: ${address}`);
}

test('A4 with no conversation id in the book, the finding says to write it into the book first, naming the file and the session; done, its restart works', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await addressIs(bots, 'api-bot', 'daily', 'api-bot.daily');
  assert.equal((await sessionIn(bots, 'api-bot', 'daily'))?.session, undefined, 'the premise: the book names no conversation for daily');

  const answer = await found(box);

  const finding = assertNamedAddress(answer, box, bots, 'api-bot', 'daily', 'api-bot.daily');
  const book = bookOf(bots, 'api-bot');
  const bookAt = Math.max(...spellingsOf(book).map((spelling) => finding.says.indexOf(spelling)));
  assert.ok(bookAt >= 0, `it names the book file, ${book}, where the id goes, got: ${finding.says}`);
  assert.match(finding.says, /\bsession:\s*<id>/, `and says the id goes in as session: <id>, got: ${finding.says}`);
  const restartAt = Math.max(...spellingsOf(box.cli).map((cli) => finding.says.indexOf(`${cli} restart `)));
  assert.ok(bookAt < restartAt, `the id is written first, then the restart, got: ${finding.says}`);

  // The premise of the advice: run before the id is written, the restart is refused and closes nothing.
  const tooSoon = await sh(printedRestart(box, finding.says), { cwd: box.cwd, env: box.env });
  assert.notEqual(tooSoon.code, 0, `the premise: with no id in the book the restart refuses, got:\n${tooSoon.stdout}${tooSoon.stderr}`);
  assert.equal((await sessionIn(bots, 'api-bot', 'daily'))?.address, 'api-bot.daily', 'and changes nothing');

  // Done as it says: the conversation on the harness's own record, its id in the book, and the printed restart run.
  await conversationOnRecord(box, { harness: 'claude', cwd: botHomeOf(bots, 'api-bot'), id: CONVERSATION });
  await conversationIs(bots, 'api-bot', 'daily', CONVERSATION);
  await followRestart(box, bots, 'api-bot', 'daily', printedRestart(box, finding.says));
});

test('A4 with a conversation id in the book, the restart the finding prints works as it stands', async (t) => {
  const box = await createSandbox(t);
  const bots = await fleet(box);
  await conversationOnRecord(box, { harness: 'claude', cwd: botHomeOf(bots, 'api-bot'), id: CONVERSATION });
  await conversationIs(bots, 'api-bot', 'daily', CONVERSATION);
  await addressIs(bots, 'api-bot', 'daily', 'api-bot.daily');

  const answer = await found(box);

  const finding = assertNamedAddress(answer, box, bots, 'api-bot', 'daily', 'api-bot.daily');
  await followRestart(box, bots, 'api-bot', 'daily', printedRestart(box, finding.says));
});
