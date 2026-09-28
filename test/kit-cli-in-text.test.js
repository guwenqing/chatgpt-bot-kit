// What the kit's own text tells a bot to run reaches the CLI that launched its
// tab, not whatever `obk` is on PATH (#239).
//
// A tab the kit launched carries `OBK_CLI=<the CLI that launched it>` (#220),
// and `"${OBK_CLI:-obk}"` is that CLI there and plain `obk` anywhere else. So:
//
//   - a rule unit (rules/*.md) that tells a bot to run the kit writes the
//     command as `"${OBK_CLI:-obk}" …`, never as a bare `obk …`: the rules build
//     writes the building CLI's path where a unit says `"${OBK_CLI:-obk}"`
//     (#344), and a bare `obk` it leaves as it is;
//   - a shipped skill (skills/*/SKILL.md) is a linked file, the same on every
//     machine (ADR 0014), and cannot carry a path. One with a backticked
//     `obk …` command carries a note instead: where the skill says `obk`, run
//     `"${OBK_CLI:-obk}"`, the kit that started your tab. The note is found by
//     what it says, not by its exact words: a paragraph that names
//     `"${OBK_CLI:-obk}"` and the tab.
//
// A command is a code span, or a line of a fenced code block, that starts with
// the word `obk` and goes on: `obk health`, `obk --help`. The word on its own,
// `obk`, names the program and is not a command. A `"${OBK_CLI:-obk}"` command
// is not a bare one, and nothing inside the note counts.

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { repoRoot } from './helpers/cli.js';

/** The kit's own name for itself in a tab it launched, and `obk` elsewhere. */
const KIT_WORD = '"${OBK_CLI:-obk}"';

/** A bare kit command: the word `obk`, then more. */
const BARE = /^\$?\s*obk\s+\S/;

/** Whether a paragraph is the note: it names `"${OBK_CLI:-obk}"` and the tab. */
const isNote = (paragraph) => paragraph.includes(KIT_WORD) && /\btab\b/i.test(paragraph);

/**
 * The bare `obk` commands in a markdown text, as `{ line, text }`, outside any
 * paragraph that is the note: code spans, and lines of fenced code blocks.
 */
function bareCommandsIn(markdown) {
  const lines = markdown.split('\n');
  // Paragraphs by blank lines, each as the line numbers it holds.
  const noteLines = new Set();
  let start = 0;
  for (let at = 0; at <= lines.length; at += 1) {
    if (at === lines.length || lines[at].trim() === '') {
      if (isNote(lines.slice(start, at).join('\n'))) for (let one = start; one < at; one += 1) noteLines.add(one);
      start = at + 1;
    }
  }

  const found = [];
  let fenced = false;
  lines.forEach((line, at) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (noteLines.has(at)) return;
    if (fenced) {
      if (BARE.test(line.trim())) found.push({ line: at + 1, text: line.trim() });
      return;
    }
    for (const match of line.matchAll(/`([^`\n]+)`/g)) {
      if (BARE.test(match[1])) found.push({ line: at + 1, text: match[1] });
    }
  });
  return found;
}

/** Whether a markdown text carries the note. */
function carriesNote(markdown) {
  return markdown.split(/\n\s*\n/).some(isNote);
}

/** The markdown files of one kind, relative to the repo: the rule units, or each skill's SKILL.md. */
async function ruleUnits() {
  const dir = path.join(repoRoot, 'rules');
  return (await readdir(dir)).filter((name) => name.endsWith('.md')).sort().map((name) => path.join('rules', name));
}

async function skillFiles() {
  const dir = path.join(repoRoot, 'skills');
  const names = (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const files = [];
  for (const name of names) {
    const rel = path.join('skills', name, 'SKILL.md');
    try {
      await readFile(path.join(repoRoot, rel));
      files.push(rel);
    } catch {
      // A directory with no SKILL.md is not a skill; the skills' own tests say so.
    }
  }
  return files;
}

// ------------------------------------------------------------- the reading, on its own

test('a bare `obk …` in a code span or a fenced block is a command; the word alone and the kit word are not', () => {
  const text = [
    'Run `obk health --bots <bots>` and read it. `obk --help` lists the flags.',
    'The `obk` on PATH is the published one. Mail goes with `"${OBK_CLI:-obk}" message send`.',
    '',
    '```sh',
    'obk roster --bots <bots>',
    '"${OBK_CLI:-obk}" up --bots <bots>',
    '```',
  ].join('\n');
  assert.deepEqual(bareCommandsIn(text), [
    { line: 1, text: 'obk health --bots <bots>' },
    { line: 1, text: 'obk --help' },
    { line: 5, text: 'obk roster --bots <bots>' },
  ]);
});

test('nothing inside the note counts, and the note is found by what it says', () => {
  const note = 'Where this skill says `obk`, run `"${OBK_CLI:-obk}"`: the kit that started your tab, and plain `obk …` anywhere else.';
  const text = [note, '', 'Then run `obk health`.'].join('\n');
  assert.deepEqual(bareCommandsIn(text), [{ line: 3, text: 'obk health' }]);
  assert.equal(carriesNote(text), true);
  assert.equal(carriesNote('Run `"${OBK_CLI:-obk}" health` for the fleet.'), false, 'the kit word alone, with nothing about the tab, is not the note');
  assert.equal(carriesNote('Where this skill says obk, run the kit that started your tab.'), false, 'nor is a note that does not name "${OBK_CLI:-obk}"');
});

// ------------------------------------------------------------- the kit's own text

test('no rule unit tells a bot to run a bare `obk` command: each says "${OBK_CLI:-obk}"', async () => {
  const units = await ruleUnits();
  assert.ok(units.length > 0, 'there should be rule units to read');
  const found = [];
  for (const rel of units) {
    for (const one of bareCommandsIn(await readFile(path.join(repoRoot, rel), 'utf8'))) found.push(`${rel}:${one.line}: \`${one.text}\``);
  }
  assert.deepEqual(found, [], `rule units that tell a bot to run a bare obk:\n  ${found.join('\n  ')}`);
});

test('every shipped skill with a backticked `obk` command carries the note that names "${OBK_CLI:-obk}"', async () => {
  const skills = await skillFiles();
  assert.ok(skills.length > 0, 'there should be skills to read');
  const missing = [];
  let withCommands = 0;
  for (const rel of skills) {
    const text = await readFile(path.join(repoRoot, rel), 'utf8');
    const bare = bareCommandsIn(text);
    if (bare.length === 0) continue;
    withCommands += 1;
    if (!carriesNote(text)) missing.push(`${rel} (${bare.length} bare obk command${bare.length === 1 ? '' : 's'}, first at line ${bare[0].line})`);
  }
  assert.ok(withCommands > 0, 'no skill names an obk command, so this checks nothing');
  assert.deepEqual(missing, [], `skills that tell a bot to run obk without the note:\n  ${missing.join('\n  ')}`);
});
