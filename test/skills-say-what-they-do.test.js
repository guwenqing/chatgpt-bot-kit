// Two kit skills say what they do, and carry what they need (issue #269; ADR
// 0019: "A skill does not rely on another skill being loaded; what it needs, it
// carries").
//
//   N1  obk-grilling's NOTICE.md, where it introduces its list of deliberate
//       departures from `grilling` and `domain-modeling`, states no number of
//       them other than the number listed.
//   D1  obk-debugging's "Prove it where it appeared" says who the test author
//       is: someone with a context of their own (a fresh subagent, another
//       session, a person), not a fork of this conversation.
//   D2  It says what the author gets: the requirement and the correct result,
//       the public interface, the reproduction as the worked example; not the
//       fix, the diff or the plan.
//   D3  It says what the author returns: the tests, the command, the failing
//       output.
//   D4  It does not leave the brief to obk-tdd: a mention of obk-tdd in that
//       section is an optional pointer for more, not the only source of how.
//
// The change is the text of two skills, so what is held here is what each
// says. Meaning is matched, loosely; no sentence is pinned. Only the section
// named above is read for D1-D4, so what obk-debugging says elsewhere does not
// answer for it.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { repoRoot } from './helpers/cli.js';
import { sectionsIn } from './helpers/rules.js';

/** Text with every run of white space made one space, so a wrapped line reads as one. */
const flat = (text) => text.replace(/\s+/g, ' ').trim();

/** The clauses of a text: its sentences, cut again at semicolons. */
const clausesOf = (text) => flat(text).split(/(?<=[.!?;])\s+/);

// ------------------------------------------------------------ obk-grilling's NOTICE

const NOTICE = 'skills/obk-grilling/NOTICE.md';

const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve'];

/** A line that starts a list item, at the left margin. */
const ITEM = /^(?:[-*+]|\d+[.)])\s/;

/**
 * Each paragraph that introduces the departures: one that is not itself a list
 * item, names departures, and is followed by a list. The list runs until the
 * next paragraph that is not a list item; blank lines between items do not end
 * it. `stated` is the number the paragraph gives, or undefined when it gives none.
 */
function departureLists(text) {
  const blocks = text.split(/\n\s*\n/).map((block) => block.replace(/^\n+/, ''));
  const found = [];
  blocks.forEach((block, at) => {
    if (ITEM.test(block) || !/\bdepartures\b/i.test(block)) return;
    let items = 0;
    for (const next of blocks.slice(at + 1)) {
      if (!ITEM.test(next)) break;
      items += next.split('\n').filter((line) => ITEM.test(line)).length;
    }
    if (items === 0) return;
    const number = /\b(\d+|[a-z]+)\s+(?:[\w-]+\s+){0,2}departures\b/i.exec(flat(block));
    const word = number?.[1].toLowerCase();
    const stated = word === undefined ? undefined
      : /^\d+$/.test(word) ? Number(word)
        : NUMBERS.includes(word) ? NUMBERS.indexOf(word) : undefined;
    found.push({ intro: flat(block), items, stated });
  });
  return found;
}

test('N1: the NOTICE states as many deliberate departures as it lists', async () => {
  const text = await readFile(path.join(repoRoot, NOTICE), 'utf8');
  const lists = departureLists(text);
  assert.ok(lists.length > 0,
    `${NOTICE} should still introduce its departures from \`grilling\` and \`domain-modeling\` with a list`);
  for (const { intro, items, stated } of lists) {
    if (stated === undefined) continue;
    assert.equal(stated, items,
      `${NOTICE} says "${intro}" and then lists ${items} departures`);
  }
});

// ------------------------------------------------------------ obk-debugging

const DEBUGGING = 'skills/obk-debugging/SKILL.md';

/** The section "Prove it where it appeared", its heading allowed to be reworded around "prove". */
async function proveSection() {
  const text = await readFile(path.join(repoRoot, DEBUGGING), 'utf8');
  const section = sectionsIn(text).find(({ heading }) => /\bprove\b/i.test(heading));
  assert.ok(section !== undefined, `${DEBUGGING} should still have its section "Prove it where it appeared"`);
  return section.body;
}

const shown = (body) => `${DEBUGGING}, "Prove it where it appeared", says:\n${body}`;

/** A negation, for the clauses that say what is not so. */
const NOT = /\b(?:not|never|no|none|nor|without|rather than|instead of|neither)\b|n't\b/i;

test('D1: the section says who the test author is: a context of its own, not a fork of this conversation', async () => {
  const body = await proveSection();
  assert.ok(/\bsub-?agents?\b|\b(?:another|other|separate|second|different) (?:session|bot|agent)s?\b|\bperson\b|\bhuman\b|\bcolleague\b/i.test(body),
    `the section should say who can be the test author: a fresh subagent, another session, a person.\n${shown(body)}`);
  const forks = clausesOf(body).filter((clause) => /\bfork/i.test(clause));
  const unshared = /\b(?:not|never|without|n't)\b(?:\W+\w+){0,6}?\W+(?:inherit|share|shares|shared|seen|see|sees)\b(?:\W+\w+){0,6}?\W+conversation\b/i;
  assert.ok(forks.some((clause) => NOT.test(clause)) || unshared.test(flat(body)),
    `the section should say the author is not a fork of this conversation.\n${shown(body)}`);
  assert.ok(forks.every((clause) => NOT.test(clause)),
    `every mention of a fork in the section should rule it out as the author.\n${shown(body)}`);
});

test('D2: the section says what the author gets, and that it does not get the fix, the diff or the plan', async () => {
  const body = await proveSection();
  const text = flat(body);
  assert.ok(/\brequirements?\b|\b(?:correct|expected|right|intended) (?:result|behaviou?r|output|answer|outcome)s?\b|\bwhat (?:should|ought to) (?:happen|have happened|come out)\b/i.test(text),
    `the section should say the author gets the requirement and what the correct result is.\n${shown(body)}`);
  assert.ok(/\bpublic (?:interface|api|surface|boundary)\b|\bsignatures?\b/i.test(text),
    `the section should say the author gets the public interface.\n${shown(body)}`);
  assert.ok(/\b(?:reproduction|repro|reproducer)\b/i.test(text),
    `the section should say the author gets the reproduction as the worked example.\n${shown(body)}`);
  const withheld = clausesOf(body).filter((clause) => /\b(?:fix|diff|plan|patch|implementation)\b/i.test(clause)
    && (/^(?:[-*+]\s+|\d+[.)]\s+)?(?:but |and )?(?:not|never|nor)\b/i.test(clause)
      || (NOT.test(clause) && /\b(?:author|brief|see|sees|seen|show|shown|give|gives|given|get|gets|hand|share|tell)\b/i.test(clause))));
  assert.ok(withheld.length > 0,
    `the section should say the author does not get the fix, the diff or the plan.\n${shown(body)}`);
});

test('D3: the section says what the author returns: the tests, the command, the failing output', async () => {
  const body = await proveSection();
  const text = flat(body);
  assert.ok(/\breturns?\b|\bhands? (?:back|over)\b|\b(?:brings?|sends?|gives?) (?:you )?back\b|\bcomes? back with\b|\breports?\b/i.test(text),
    `the section should say what the author returns.\n${shown(body)}`);
  assert.ok(/\bcommands?\b/i.test(text),
    `the section should say the author returns the command it ran.\n${shown(body)}`);
  assert.ok(/\bfail\w*\s+(?:\w+\s+)?(?:output|run|result)s?\b|\boutput\b(?:\W+\w+){0,4}?\W+fail|\bred (?:output|run)\b/i.test(text),
    `the section should say the author returns the failing output.\n${shown(body)}`);
});

test('D4: the section does not leave how the brief goes to obk-tdd; a mention of it is only a pointer for more', async () => {
  const body = await proveSection();
  const optional = /\bif (?:you can|it can be|you have it|it is|it's) (?:load|loaded|available|installed)|\bif (?:you can )?load(?:ed)? it\b|\bhas more\b|\bmore (?:on|about|in|detail)\b|\bfor more\b|\bgoes further\b|\bsee also\b|\bin (?:more )?detail\b/i;
  const leaning = clausesOf(body).filter((clause) => /\bobk-tdd\b/.test(clause) && !optional.test(clause));
  assert.deepEqual(leaning, [],
    `a mention of obk-tdd in the section should be an optional pointer for more ("has more on", "if you can load it"), `
      + `not where the brief is to be found.\n${shown(body)}`);
});
