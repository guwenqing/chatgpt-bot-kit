// Temporary sessions left behind: grooming sees them, and the management
// session offers the user a rule for them (issue #252, the third slice of #227;
// PRD 6.4, 6.8).
//
// A temporary session is one a bot's long-lived session made with `obk temp
// make`; the bot's book marks it `temporary: { maker, made }`, and its maker
// retires it with `obk temp retire`. Nothing in this slice runs code: the change
// is the text of two kit skills, so what is held here is what each says. The
// architect accepted that as a stand-in for the behaviour, beside one real run
// of the pass done by hand; it cannot show that a model following the text does
// the right thing, only that the text asks for it.
//
//   G1  obk-grooming reads each bot's book (sessions.yaml) for sessions marked
//       temporary.
//   G2  It counts one as left behind when its maker is no longer one of that
//       bot's sessions, or when it was made more than a day ago.
//   G3  Its report names each one: the session, its maker (saying so when the
//       maker is gone) and its age.
//   G4  It retires none of them itself.
//   G5  It records them in its open findings.
//   F1  obk-fleet-review, when a grooming report has a bot's temporary sessions
//       left behind, offers the user a rule for that bot's charter, in words
//       ready to accept.
//   F2  On a yes, it reads the charter, adds the line and sets the whole with
//       `obk bot change --charter`, which replaces the whole charter.
//   F3  On a no, nothing changes, and it does not offer it again for the same
//       sessions.
//   F4  It retires none of them itself, and sends nothing to the maker.
//   F5  On a no, it writes the declined offer down in grooming's open findings,
//       so the no outlasts the conversation it was given in.
//
// Meaning is matched, loosely; no sentence is pinned. Each skill's passage on
// the subject is the paragraphs that name it (temporary, left behind, or the
// maker), or every paragraph of a section whose heading does. Only that passage
// is read, so what either skill already says elsewhere (fleet-review's "Nothing
// is retired or deleted because you concluded it", grooming's open findings) does
// not answer for it. A paragraph that carries the subject but names none of
// those words is not read: a line saying only "On a no, nothing changes" after
// the paragraph that introduces the rule, with no heading naming the subject,
// would be missed.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { repoRoot } from './helpers/cli.js';
import { sectionsIn } from './helpers/rules.js';

// ------------------------------------------------------------ reading a skill

/** Text with every run of white space made one space, so a wrapped line reads as one. */
const flat = (text) => text.replace(/\s+/g, ' ').trim();

/** The sentences of a text, wrapped lines joined. */
const sentencesOf = (text) => flat(text).split(/(?<=[.!?])\s+/);

/** What marks a paragraph or a heading as being about temporary sessions left behind. */
const SUBJECT = /\btemporar|\bleft behind\b|\bmakers?\b/i;

/**
 * One kit skill's passage on temporary sessions: the paragraphs that name the
 * subject, and a section whose heading names it, the heading read as a sentence.
 */
async function passageOf(skill) {
  const file = path.join(repoRoot, 'skills', skill, 'SKILL.md');
  const text = await readFile(file, 'utf8');
  const kept = [];
  for (const section of sectionsIn(text)) {
    const whole = SUBJECT.test(section.heading);
    if (whole) kept.push(`${section.heading}.`);
    for (const paragraph of section.body.split(/\n\s*\n/)) {
      if (whole || SUBJECT.test(paragraph)) kept.push(paragraph);
    }
  }
  return kept.join('\n\n');
}

/** The sentences of the passage that pass every test given. */
const saying = (passage, ...patterns) => sentencesOf(passage)
  .filter((sentence) => patterns.every((pattern) => pattern.test(sentence)));

/** How a failure shows what was read, so the reader sees what the skill says. */
const shown = (skill, passage) => (passage.trim() === ''
  ? `skills/${skill}/SKILL.md has no passage on temporary sessions at all`
  : `skills/${skill}/SKILL.md says, on temporary sessions:\n${passage}`);

// ------------------------------------------------------------ the words

/** A maker that is gone: no longer one of the bot's sessions. */
const MAKER_GONE = /\b(?:no longer|gone|missing|absent|removed|retired|not (?:one of|among|in)|(?:does not|doesn't) exist|left the book)\b/i;

/** Made more than a day ago. */
const OVER_A_DAY = /\b(?:more than|over|older than|longer than|past|beyond)\s+(?:a|one|1)\s+day\b|\b(?:24|twenty-four)\s+hours\b/i;

/** How old it is. */
const AGE = /\bage\b|\bhow old\b|\bhow long ago\b|\bwhen it was made\b/i;

/** Saying something in the report. */
const SAYS = /\b(?:say|says|saying|said|note|notes|noting|mark|marks|marking|flag|flags|flagging|name|names|naming|report|reports|reporting)\b/i;

/**
 * Retiring none of them: a negation governing "retire" within a few words, or
 * "retires nothing", or "nothing is retired", or leaving the retiring to
 * someone. A sentence that says it does retire them carries none of these.
 */
const RETIRES_NONE = new RegExp([
  String.raw`\b(?:not|never|n't)\s+(?:[\w'’]+\s+){0,3}retir`,
  String.raw`\bretir\w*\s+(?:nothing|none)\b`,
  String.raw`\b(?:nothing|none of them)\s+(?:\w+\s+){0,2}retired\b`,
  String.raw`\bleav(?:e|es|ing)\s+(?:the\s+)?retiring\b`,
].join('|'), 'i');

/** A negation, for the sentences that say what does not happen. */
const NOT = /\b(?:not|never|no|nothing|none|n't)\b|n't\b/i;

// ------------------------------------------------------------ obk-grooming

const GROOMING = 'obk-grooming';

test('G1: the grooming pass reads each bot\'s book for sessions marked temporary', async () => {
  const passage = await passageOf(GROOMING);
  assert.ok(
    saying(passage, /\btemporar/i, /\bsessions\.yaml\b|\bbook\b/i).length > 0,
    `the grooming skill should say it reads each bot's book (sessions.yaml) for sessions marked temporary.\n${shown(GROOMING, passage)}`,
  );
});

test('G2: a temporary session is left behind when its maker is gone, or when it was made over a day ago', async () => {
  const passage = await passageOf(GROOMING);
  assert.ok(
    saying(passage, /\bmaker\b/i, MAKER_GONE).length > 0,
    `the grooming skill should count a temporary session as left behind when its maker is no longer one of the bot's sessions.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    saying(passage, OVER_A_DAY).length > 0,
    `the grooming skill should count a temporary session as left behind when it was made more than a day ago.\n${shown(GROOMING, passage)}`,
  );
});

test('G3: the report names each one left behind, with its maker and its age', async () => {
  const passage = await passageOf(GROOMING);
  assert.ok(
    saying(passage, /\breport/i, /\bmaker\b/i, AGE).length > 0,
    `the grooming skill should say its report names each temporary session left behind, its maker and its age.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    saying(passage, /\bsession\b/i, /\bmaker\b/i, AGE).length > 0,
    `the grooming skill's report should name the session itself, beside its maker and its age.\n${shown(GROOMING, passage)}`,
  );
  assert.ok(
    saying(passage, /\bmaker\b/i, MAKER_GONE, SAYS).length > 0,
    `the grooming skill's report should say so when a temporary session's maker is gone.\n${shown(GROOMING, passage)}`,
  );
});

test('G4: the grooming pass retires none of them itself', async () => {
  const passage = await passageOf(GROOMING);
  assert.ok(
    saying(passage, RETIRES_NONE).length > 0,
    `the grooming skill should say the pass retires no temporary session itself.\n${shown(GROOMING, passage)}`,
  );
});

test('G5: the grooming pass records them in its open findings', async () => {
  const passage = await passageOf(GROOMING);
  assert.ok(
    saying(passage, /\bopen findings\b/i).length > 0,
    `the grooming skill should say the temporary sessions left behind go in the open findings.\n${shown(GROOMING, passage)}`,
  );
});

// ------------------------------------------------------------ obk-fleet-review

const REVIEW = 'obk-fleet-review';

test('F1: on a grooming report of temporary sessions left behind, the review offers the user a charter rule, words ready', async () => {
  const passage = await passageOf(REVIEW);
  assert.ok(
    saying(passage, /\bgroom/i).length > 0,
    `the fleet review skill should tie the offer to a grooming report of temporary sessions left behind.\n${shown(REVIEW, passage)}`,
  );
  assert.ok(
    saying(passage, /\b(?:offer|propose|suggest|ask)/i, /\bcharter\b/i, /\b(?:user|owner)\b/i).length > 0,
    `the fleet review skill should say it offers the user a rule for that bot's charter.\n${shown(REVIEW, passage)}`,
  );
  assert.ok(
    saying(passage, /\bready\b|\bwording\b|\bverbatim\b|\bword for word\b|\bexact (?:words|text|line)\b/i).length > 0,
    `the fleet review skill should say the rule is offered in words ready to accept.\n${shown(REVIEW, passage)}`,
  );
});

test('F2: on a yes, the review adds the line to the whole charter with obk bot change --charter', async () => {
  const passage = await passageOf(REVIEW);
  assert.ok(
    saying(passage, /\bbot change\b/i, /--charter\b/).length > 0,
    `the fleet review skill should say that on a yes it sets the charter with obk bot change --charter.\n${shown(REVIEW, passage)}`,
  );
  assert.ok(
    saying(passage, /\byes\b|\bagree|\baccept/i).length > 0,
    `the fleet review skill should say what happens on the user's yes.\n${shown(REVIEW, passage)}`,
  );
  assert.ok(
    saying(passage, /\bcharter\b/i, /\b(?:whole|entire|full|in full|existing|current)\b|\breplaces?\b/i).length > 0,
    `the fleet review skill should say --charter sets the whole charter, so the line is added to the one there is.\n${shown(REVIEW, passage)}`,
  );
});

test('F3: on a no, nothing changes and it is not offered again for the same sessions', async () => {
  const passage = await passageOf(REVIEW);
  assert.ok(
    saying(passage, /\bno\b|\bdeclin|\brefus|\bturns? (?:it )?down\b/i,
      /\bnothing (?:\w+\s+)?changes\b|\bchanges? nothing\b|\bunchanged\b|\bstays? as (?:it|they) (?:is|are)\b/i).length > 0,
    `the fleet review skill should say that on a no, nothing changes.\n${shown(REVIEW, passage)}`,
  );
  assert.ok(
    saying(passage, NOT, /\bagain\b|\btwice\b|\ba second time\b|\brepeat|\bre-?offer/i, /\bsessions?\b|\bsame\b/i).length > 0,
    `the fleet review skill should say that after a no it does not offer the rule again for the same sessions.\n${shown(REVIEW, passage)}`,
  );
});

test('F5: on a no, the declined offer is written down in the open findings, so it outlasts the conversation', async () => {
  // Found by the real run of the offer: with nowhere named to keep the no, "not
  // offered again" does not hold after a /clear or on another day.
  const passage = await passageOf(REVIEW);
  const writes = /\b(?:record|writ|wrote|not(?:e|es|ed|ing)\b|add|put|keep|kept|log|enter|mark|file)/i;
  const writesNot = /\b(?:not|never|n't)\s+(?:\w+\s+){0,2}(?:record|writ|note|add|put|keep|log|enter|mark|file)/i;
  assert.ok(
    saying(passage, /\bopen findings\b/i, /\bno\b|\bdeclin|\brefus|\bturned down\b|\brejected\b/i, writes)
      .some((sentence) => !writesNot.test(sentence)),
    `the fleet review skill should say that on a no, the declined offer is written down in the open findings.\n${shown(REVIEW, passage)}`,
  );
});

test('F4: the review retires none of them itself and sends nothing to the maker', async () => {
  const passage = await passageOf(REVIEW);
  assert.ok(
    saying(passage, RETIRES_NONE).length > 0,
    `the fleet review skill should say the management session retires no temporary session itself.\n${shown(REVIEW, passage)}`,
  );
  assert.ok(
    saying(passage, NOT, /\bmaker/i, /\b(?:send|sends|sending|sent|message|messages|write|writes|tell|tells|mail)\b|\bnot to (?:the |its )?maker/i).length > 0,
    `the fleet review skill should say it sends nothing to the maker's session: the hint goes to the user.\n${shown(REVIEW, passage)}`,
  );
});
