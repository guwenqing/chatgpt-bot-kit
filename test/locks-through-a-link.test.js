// Every writer of a bot takes the same lock, however it named the bots folder
// (issue #375).
//
// People keep the bots folder on another volume and link to it, and `init
// --bots` follows such a link (test/init-bots-link.test.js). From then on the
// same bot is reached two ways: some callers hand the book module the bot home
// with links resolved, others pass it as it was typed. Each of those callers
// takes the lock properly. The trouble would be that they take two different
// locks: a writer through the link and a writer through the real path each
// alone inside "the lock" at once, the second reading a book the first is about
// to replace, and one change gone — the lost write the book's lock exists to
// stop, with nothing stopped or slow to blame for it.
//
// So what is pinned here is the rule from outside: one bots folder, reached
// through a link and through its real path, and a contender on each. The one
// that comes second waits for the one inside, in both orders, for the book's
// lock and for a session's mailbox turn alike. Where the lock lives is the
// kit's own business and is not looked at (see the foot of
// test/session-book-lock.test.js); moving it is not part of this.
//
// The lock belongs to a process and a waiter blocks its whole thread, so each
// contender is a process of its own, started here and left to end by itself,
// as in test/session-book-writers.test.js. The overlap is arranged rather than
// hoped for: the second contender waits until the first says it is inside,
// comes for the lock a moment later, and every step goes into a shared log
// with the time. The time is `process.hrtime`, which counts from the machine's
// boot on macOS and Linux alike, so two processes' stamps can be compared (see
// `aWriter` in that file for why it is not the wall clock). Nothing here
// signals or kills a process, and every wait is short: the one inside holds for
// a second and a half, so a contender that has to wait for it waits about that
// long, and one that does not wait is caught at once.

import assert from 'node:assert/strict';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

import { botHomeOf, bookOf, createSandbox, node, repoRoot } from './helpers/cli.js';

/** The module under test, as the contenders import it. */
const bookModule = pathToFileURL(path.join(repoRoot, 'src', 'book.js')).href;

/** How long the contender inside holds the lock once it has it. */
const HOLDS_MS = 1500;

/** How long after the first said it was inside the second comes for the lock. */
const ARRIVES_AFTER_MS = 300;

/**
 * A bots folder made by `init` in a real folder, and a link to it beside that:
 * the same bot home, named once through the link and once by its real path.
 */
async function oneBotsFolderTwoWays(box) {
  const real = path.join(box.root, 'real', 'bots');
  await mkdir(path.dirname(real), { recursive: true });
  const ran = await box.run(['init', '--bots', real, '--harness', 'claude']);
  assert.equal(ran.code, 0, ran.stderr);
  const link = path.join(box.root, 'link-bots');
  await symlink(real, link);
  return { real, link, homes: { real: botHomeOf(real), link: botHomeOf(link) } };
}

/**
 * One contender for a lock, as its own process.
 *
 * `lock` is which lock: `book` changes the book through `updateBook`, adding a
 * session named after the contender; `mailbox` takes Bot Father's daily
 * session's turn through `takeMailboxTurn` and lets it go. `holds` keeps it
 * that long once inside. `arrivesAfter` waits for the other contender to say it
 * is inside, then that long more, before coming for the lock.
 *
 * Steps logged: `arrived` just before asking for the lock, `holding` the moment
 * it is inside, and `committed` or `refused` at the end.
 */
async function aContender(box, home, name, { lock, holds = 0, arrivesAfter = 0 }) {
  const dir = path.join(box.root, 'contenders');
  await mkdir(dir, { recursive: true });
  const script = path.join(dir, `${name}.mjs`);
  const log = path.join(dir, 'contenders.log');
  // Where the one inside says, once, at what moment it got in.
  const inside = path.join(dir, 'inside');

  await writeFile(script, `${[
    "import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';",
    "import { setTimeout as sleep } from 'node:timers/promises';",
    `import { takeMailboxTurn, updateBook } from ${JSON.stringify(bookModule)};`,
    '',
    `const NAME = ${JSON.stringify(name)};`,
    `const HOME = ${JSON.stringify(home)};`,
    `const LOCK = ${JSON.stringify(lock)};`,
    `const LOG = ${JSON.stringify(log)};`,
    `const INSIDE = ${JSON.stringify(inside)};`,
    `const HOLDS = ${JSON.stringify(holds)};`,
    `const ARRIVES_AFTER = ${JSON.stringify(arrivesAfter)};`,
    '',
    'const now = () => Number(process.hrtime.bigint()) / 1e6;',
    'const say = (what) => appendFileSync(LOG, `${JSON.stringify({ contender: NAME, what, at: now() })}\\n`);',
    '',
    '// Bounded, so a contender that never got in does not leave this one waiting for ever.',
    'if (ARRIVES_AFTER > 0) {',
    '  const until = Date.now() + 20_000;',
    '  while (!existsSync(INSIDE) && Date.now() < until) await sleep(20);',
    '  const took = existsSync(INSIDE) ? Number(readFileSync(INSIDE, \'utf8\')) : now();',
    '  await sleep(Math.max(0, took + ARRIVES_AFTER - now()));',
    '}',
    '',
    'const gotIn = () => {',
    '  if (HOLDS > 0) writeFileSync(INSIDE, String(now()));',
    '  say(\'holding\');',
    '};',
    '',
    'say(\'arrived\');',
    'try {',
    '  if (LOCK === \'book\') {',
    '    await updateBook(HOME, async (book) => {',
    '      gotIn();',
    '      if (HOLDS > 0) await sleep(HOLDS);',
    '      book.sessions = { ...book.sessions, [NAME]: { tab: `tab-${NAME}` } };',
    '    });',
    '  } else {',
    '    const turn = takeMailboxTurn(HOME, \'daily\');',
    '    if (turn === undefined) throw new Error(\'the mailbox turn did not come\');',
    '    gotIn();',
    '    if (HOLDS > 0) await sleep(HOLDS);',
    '    turn.release();',
    '  }',
    '  say(\'committed\');',
    '} catch (error) {',
    '  say(\'refused\');',
    '  process.stderr.write(`${error.message}\\n`);',
    '  process.exitCode = 1;',
    '}',
  ].join('\n')}\n`);

  return {
    name,
    run: () => node([script], { cwd: box.cwd, env: box.env }),
    /** Everything every contender wrote down, in the order it happened. */
    async steps() {
      const text = await readFile(log, 'utf8');
      return text.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
    },
  };
}

/** When one contender took one step, which it takes exactly once. */
function when(steps, contender, what) {
  const found = steps.filter((step) => step.contender === contender && step.what === what);
  assert.equal(found.length, 1, `${contender} should have ${what} exactly once, got: ${JSON.stringify(steps)}`);
  return found[0].at;
}

/**
 * Run a contender that holds the lock and one that comes for it while it does,
 * and hold them to the rule: the second asked while the first was inside, and
 * got in only once the first had held it for all of `HOLDS_MS`.
 */
async function assertOneWaitsForTheOther(box, first, second) {
  const [one, two] = await Promise.all([first.run(), second.run()]);
  assert.equal(one.code, 0, `${first.name} should have got in and finished: ${one.stderr}`);
  assert.equal(two.code, 0, `${second.name} should have waited its turn and finished: ${two.stderr}`);

  const steps = await first.steps();
  const inside = when(steps, first.name, 'holding');
  // The overlap really happened: the second asked while the first was inside.
  assert.ok(
    when(steps, second.name, 'arrived') < inside + HOLDS_MS,
    `${second.name} should have asked for the lock while ${first.name} held it, got: ${JSON.stringify(steps)}`,
  );
  // And the rule: it did not get in beside it.
  assert.ok(
    when(steps, second.name, 'holding') >= inside + HOLDS_MS,
    `${second.name} got in while ${first.name} was still inside, so the two of them took two different`
    + ` locks for one bot: ${JSON.stringify(steps)}`,
  );
}

/** Both changes are in the book: nobody's write was lost to the other's. */
async function assertBothKept(bots, names) {
  const text = await readFile(bookOf(bots), 'utf8');
  const book = parse(text);
  assert.notEqual(book, null, `the book must still be readable YAML, got:\n${text}`);
  assert.deepEqual(
    names.map((name) => book.sessions?.[name]?.tab),
    names.map((name) => `tab-${name}`),
    `every writer's change must be in the book:\n${text}`,
  );
  assert.notEqual(book.sessions?.daily, undefined, `the session that was there is still there:\n${text}`);
}

test('a book writer through a link to the bots folder and one through its real path take one lock: the real one waits', async (t) => {
  const box = await createSandbox(t);
  const { real, homes } = await oneBotsFolderTwoWays(box);

  const first = await aContender(box, homes.link, 'through-the-link', { lock: 'book', holds: HOLDS_MS });
  const second = await aContender(box, homes.real, 'by-the-real-path', { lock: 'book', arrivesAfter: ARRIVES_AFTER_MS });
  await assertOneWaitsForTheOther(box, first, second);
  await assertBothKept(real, ['through-the-link', 'by-the-real-path']);
});

test('a book writer by the real path and one through a link to the bots folder take one lock: the linked one waits', async (t) => {
  const box = await createSandbox(t);
  const { real, homes } = await oneBotsFolderTwoWays(box);

  const first = await aContender(box, homes.real, 'by-the-real-path', { lock: 'book', holds: HOLDS_MS });
  const second = await aContender(box, homes.link, 'through-the-link', { lock: 'book', arrivesAfter: ARRIVES_AFTER_MS });
  await assertOneWaitsForTheOther(box, first, second);
  await assertBothKept(real, ['by-the-real-path', 'through-the-link']);
});

test('a session\'s mailbox turn taken through a link to the bots folder holds out one taken by the real path', async (t) => {
  const box = await createSandbox(t);
  const { homes } = await oneBotsFolderTwoWays(box);

  const first = await aContender(box, homes.link, 'through-the-link', { lock: 'mailbox', holds: HOLDS_MS });
  const second = await aContender(box, homes.real, 'by-the-real-path', { lock: 'mailbox', arrivesAfter: ARRIVES_AFTER_MS });
  await assertOneWaitsForTheOther(box, first, second);
});

test('a session\'s mailbox turn taken by the real path holds out one taken through a link to the bots folder', async (t) => {
  const box = await createSandbox(t);
  const { homes } = await oneBotsFolderTwoWays(box);

  const first = await aContender(box, homes.real, 'by-the-real-path', { lock: 'mailbox', holds: HOLDS_MS });
  const second = await aContender(box, homes.link, 'through-the-link', { lock: 'mailbox', arrivesAfter: ARRIVES_AFTER_MS });
  await assertOneWaitsForTheOther(box, first, second);
});
