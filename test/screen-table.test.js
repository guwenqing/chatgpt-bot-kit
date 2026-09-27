// The table of keys that answers a harness's own first-run screens (issue #335).
//
// Two pages carry it: SETUP.md, step 5, which setup follows, and the
// obk-bot-building skill, which Bot Father follows when a tab it opened is
// waiting. An assistant types the Send cell into the screen exactly as written.
// On 2026-09-26 a row's `2\r`, meant as Skip on Codex's update offer, took
// Update now instead: the digit moved the highlight and the return took
// whatever was highlighted. So every key is to be proven live, and each row
// says which version it was proven on, so a reader can tell a key proven on the
// harness in front of them from one proven on an older one.
//
// Whether a key does what its row says is a fact about other people's software,
// proven live and not checkable here. What is held here is what a reader relies
// on and what drifts without a sound: each row names the version its key was
// proven on, no key is a digit plus return (the shape that failed; a fixed key
// is the screen's own named key or arrows), and the two pages give the same keys
// in the same order, so setup and Bot Father answer a screen the same way. The
// versions are checked loosely, as a name and a number, so a key proven again on
// a newer release does not need this file changed. A cell that starts with
// `Not yet proven` and goes on to say why is taken in place of a version, on
// purpose: a row that has not been proven says so plainly rather than claiming
// a version it was not proven on. The bare words, with no reason, are not
// enough. The screen wording and the Which is column are for the reader and are
// left alone.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { repoRoot } from './helpers/cli.js';

/** Where each table lives: the page, and the heading of the section that holds it. */
const PAGES = [
  { file: 'SETUP.md', section: '## 5. Answer what the tabs ask' },
  { file: 'skills/obk-bot-building/SKILL.md', section: '## When a tab it opened is waiting' },
];

/** How the table's header starts, today and after a column is added to its end. */
const HEADER_START = '| On screen | Send | Which is |';

/** A markdown table line's cells, trimmed. A pipe escaped as `\|` stays inside its cell. */
const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim());

/** The text inside each pair of backticks in a cell: the keys, as the page writes them. */
const keysIn = (cell) => [...cell.matchAll(/`([^`]*)`/g)].map((match) => match[1]);

/** A key as written (`\r`, `\x1b[B`) turned into the characters it sends. */
const decode = (key) => key
  .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  .replace(/\\r/g, '\r')
  .replace(/\\n/g, '\n')
  .replace(/\\t/g, '\t');

/**
 * The screen table on one page: its header cells and one entry per row, each
 * with the row's cells by header name. It fails, naming the page, if the
 * section or the table is not there, so a moved heading is not read as an
 * empty table.
 */
async function tableIn({ file, section }) {
  const page = await readFile(path.join(repoRoot, file), 'utf8');
  const lines = page.split('\n');

  const start = lines.indexOf(section);
  assert.notEqual(start, -1, `${file} should have the section "${section}", which holds the screen table`);
  let end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  if (end === -1) end = lines.length;
  const body = lines.slice(start + 1, end);

  const headers = body.map((line, index) => ({ line, index })).filter(({ line }) => line.startsWith(HEADER_START));
  assert.equal(
    headers.length,
    1,
    `${file}, "${section}", should hold one table whose header starts \`${HEADER_START}\`, found ${headers.length}`,
  );

  const at = headers[0].index;
  const header = cellsOf(body[at]);
  const rows = [];
  for (let index = at + 2; index < body.length && body[index].trim().startsWith('|'); index += 1) {
    const cells = cellsOf(body[index]);
    const row = Object.fromEntries(header.map((name, column) => [name, cells[column]]));
    rows.push({ number: rows.length + 1, cells, row, label: `${file}, row ${rows.length + 1} (${cells[0]})` });
  }
  assert.ok(rows.length > 0, `${file}, "${section}": the screen table has a header and no rows`);
  return { file, header, rows };
}

const bothTables = () => Promise.all(PAGES.map(tableIn));

test('each screen table has a Proven on column, after Which is, as its last column', async () => {
  // The version a key was proven on sits next to the key, one per row, where
  // the reader choosing the key sees it.
  for (const { file, header } of await bothTables()) {
    assert.deepEqual(
      header,
      ['On screen', 'Send', 'Which is', 'Proven on'],
      `${file}: the screen table's columns should end with Proven on, after Which is`,
    );
  }
});

test('each row of the screen tables names the version its key was proven on', async () => {
  // A Claude Code screen names the Claude Code release, a Codex screen the
  // Codex release, the shell's oh-my-zsh question an oh-my-zsh version or
  // commit. Any row names something: an empty cell is a key nobody proved. A
  // row not proven yet says `Not yet proven` and why, instead of a version.
  const problems = [];
  for (const { rows } of await bothTables()) {
    for (const { row, label } of rows) {
      const screen = row['On screen'] ?? '';
      const proven = (row['Proven on'] ?? '').trim();

      if (proven === '') {
        problems.push(`${label}: the Proven on cell is missing or empty`);
      } else if (/^Not yet proven\b/.test(proven)) {
        if (!/\w/.test(proven.replace(/^Not yet proven\b/, ''))) {
          problems.push(`${label}: Not yet proven should go on to say why, got: ${proven}`);
        }
      } else if (/Claude Code/.test(screen)) {
        if (!/Claude Code \d+\.\d+\.\d+/.test(proven)) problems.push(`${label}: Proven on should name Claude Code <x.y.z>, got: ${proven}`);
      } else if (/Codex/.test(screen)) {
        if (!/Codex \d+\.\d+\.\d+/.test(proven)) problems.push(`${label}: Proven on should name Codex <x.y.z>, got: ${proven}`);
      } else if (/oh-my-zsh/i.test(screen)) {
        if (!/oh-my-zsh/i.test(proven) || !/\d+\.\d+|\b[0-9a-f]{7,40}\b/.test(proven)) {
          problems.push(`${label}: Proven on should name an oh-my-zsh version or commit, got: ${proven}`);
        }
      }
    }
  }
  assert.deepEqual(problems, [], `rows that do not say what they were proven on:\n${problems.join('\n')}`);
});

test('no key in the screen tables is a digit and then return', async () => {
  // A digit moves a menu's highlight and the return then takes what is
  // highlighted, which on Codex's update offer was the opposite of what the
  // row meant. The screen's own named key, a return on its highlighted
  // default, Esc, arrows or a single letter the screen asks for are all fine.
  const problems = [];
  for (const { rows } of await bothTables()) {
    for (const { row, label } of rows) {
      const keys = keysIn(row.Send ?? '');
      if (keys.length === 0) problems.push(`${label}: the Send cell has no key in backticks: ${row.Send}`);
      for (const key of keys) {
        if (/[0-9]\r/.test(decode(key))) problems.push(`${label}: \`${key}\` is a digit and then return`);
      }
    }
  }
  assert.deepEqual(problems, [], `keys that press a digit and then return:\n${problems.join('\n')}`);
});

test('SETUP.md and the obk-bot-building skill give the same keys, row for row', async () => {
  // Setup and Bot Father answer the same screens. A key fixed on one page and
  // left on the other has one of them pressing the key that was proven wrong.
  // The screen wording may differ between the two; the keys may not.
  const [setup, skill] = await bothTables();

  assert.equal(
    skill.rows.length,
    setup.rows.length,
    `${setup.file} has ${setup.rows.length} screen rows and ${skill.file} has ${skill.rows.length}`,
  );
  setup.rows.forEach((setupRow, index) => {
    const skillRow = skill.rows[index];
    assert.deepEqual(
      keysIn(skillRow.row.Send ?? ''),
      keysIn(setupRow.row.Send ?? ''),
      `${setupRow.label} and ${skillRow.label} should send the same keys`,
    );
  });
});
