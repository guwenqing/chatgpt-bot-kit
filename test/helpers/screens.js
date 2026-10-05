// What a harness tab shows, as Orca renders it: `orca terminal read --terminal
// <handle> --screen --json` answers with `result.terminal.tail`, one string per
// row of the rendered screen, and `source: "screen"` (Orca 1.4.212, #329).
// These are the screens the suite puts in front of the kit, and the look the
// system tests make before they type.
//
// Each screen says where it comes from. A capture is the whole `tail` of one
// live read, taken on 2026-09-26 from tabs the kit made in throwaway fleets,
// with this machine's full paths put back to `<kit clone>` and `<tmp>` and
// nothing else changed; where a path ran across two rows, only where those
// rows end moved. The pieces Codex shortened itself (`/private/var/folders/s5/…`)
// and the path in a typed draft are as they were. A reconstruction is built
// from words that were recorded (the issue, the tech notes) with the layout
// between them made up here.
//
// What makes a screen a harness's own question, for the kit and for the look
// below: a numbered choice list, the harness's selection pointer (`›` on Codex,
// `❯` on Claude Code) on one numbered choice and another numbered choice lined
// up with it on the row right above or below, taken at the lowest row on the
// screen the pointer starts. Numbered, because both harnesses start their input
// line with the same pointer, and Codex puts a status row right under it, lined
// up with its text and starting with a word: an unnumbered rule would take
// every idle Codex tab for a question. The lowest pointer row, because both
// harnesses echo the user's past turns with the pointer too, a long one wrapped
// onto more rows, and those sit above the input line.
//
// Claude Code's folder-trust list has no numbers, so it is not a question by
// that rule. Nothing is lost there: Orca names no agent in that tab and its
// `tui-idle` wait times out (both seen live, for minutes), so the kit's gate
// types nothing into it and the system tests' waits never pass it.
//
// Nor is Claude Code 2.1.283's "Teach auto mode about your environment?", a
// form with no numbers whose Enter is Continue (#416). So the system tests'
// look below also counts a form or menu by the keys its foot row offers
// ("Enter to continue", "Enter to confirm", "Esc to cancel", and Codex's
// "enter select" and the like) on the lowest pointer row or below it,
// where the input line would be: the same words higher up are history. That
// takes in the trust list too, which the kit need not see.

/**
 * Claude Code 2.1.283 at its idle input line, showing its placeholder: a
 * capture, the whole `tail` of a kit-made tab after its trust list was
 * answered. What the fake Orca shows for a tab a test says nothing about,
 * unless a Codex launch line was typed into it.
 */
export const CLAUDE_IDLE = [
  ' ▐▛███▛█   Claude Code v2.1.283',
  '▝▜██████▀  Opus 5.5 with xhigh effort · Claude Max',
  ' ▝▝   ▝▝   <tmp>/obk-dev2-capture-5CkZDQ/bots/bot-father · /rc',
  '                                                                                                     ◉ xhigh · /effort',
  '──────────────────────────────────────────────────────────────────────────────────────────── bot-father.daily.r796uyiz ─',
  '❯ Try "fix typecheck errors"',
  '────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────',
  '  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents',
];

/**
 * The bottom of Claude Code 2.1.283's screen with its input line empty: the
 * last four rows of CLAUDE_ANSWERED, as captured. The reconstructions below
 * stand on it.
 */
const CLAUDE_INPUT_LINE = [
  '──────────────────────────────────────────────────────────────────────────────────────────── bot-father.daily.r796uyiz ─',
  '❯',
  '────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────',
  '  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents',
];

/**
 * Claude Code 2.1.283 after an answered turn: a capture. The echoed turn wraps
 * onto a second row lined up under its text, and that row holds a numbered
 * pair, `1. one 2. two`; the input line is empty below it. Not a question.
 */
export const CLAUDE_ANSWERED = [
  ' ▐▛███▛█   Claude Code v2.1.283',
  '▝▜██████▀  Opus 5.5 with xhigh effort · Claude Max',
  ' ▝▝   ▝▝   <tmp>/obk-dev2-capture-5CkZDQ/bots/bot-father · /rc',
  '❯ Reply with the single word OK and nothing else, and use no tool. This line is long on purpose so that it wraps onto',
  '  more than one row of the screen, the way a fleet mail nudge does: 1. one 2. two',
  '⏺ OK',
  '✻ Cooked for 1s · done 4:14 AM',
  ...CLAUDE_INPUT_LINE,
];

/**
 * Codex 0.157.1 at its idle input line: a capture (the box's own `…` is
 * Codex's). The status row right under `› Ask Codex to do anything` is lined up
 * with its text and starts with a word, the same shape as an unnumbered choice
 * list. What the fake Orca shows for a tab a test says nothing about, when a
 * Codex launch line was typed into it. Not a question.
 */
export const CODEX_IDLE = [
  '╭─────────────────────────────────────────────────────╮',
  '│ >_ OpenAI Codex (v0.157.1)                          │',
  '│                                                     │',
  '│ model:     GPT-6-Luna medium   /model to change     │',
  '│ directory: /private/var/folders/s5/…/bots/cap-codex │',
  '╰─────────────────────────────────────────────────────╯',
  '                                        Tip: Visit the Codex community forum (https://community.openai.com/c/codex/37).',
  '› Ask Codex to do anything',
  '  GPT-6-Luna medium · <tmp>/obk-dev2-capture-5CkZDQ/bots/cap-codex',
  '  ? for shortcuts                                                                             ⚠ 2 warnings · f2 to view',
];

/**
 * Codex 0.157.1 with a long draft in its input line, not sent yet, wrapped
 * onto three rows lined up under its text, the status rows below: a capture.
 * Not a question.
 */
export const CODEX_DRAFT = [
  '╭─────────────────────────────────────────────────────╮',
  '│ >_ OpenAI Codex (v0.157.1)                          │',
  '│                                                     │',
  '│ model:     GPT-6-Luna medium   /model to change     │',
  '│ directory: /private/var/folders/s5/…/bots/cap-codex │',
  '╰─────────────────────────────────────────────────────╯',
  '› Reply with the single word OK and nothing else, and run no command. This line is long on purpose so that it wraps',
  '  onto more than one row of the screen, the way a fleet mail nudge with its full paths does: /private/var/folders/s5/',
  '  example/obk-dev2-capture/bots/cap-codex message check',
  '  GPT-6-Luna medium · <tmp>/obk-dev2-capture-5CkZDQ/bots/cap-codex',
  '                                                                                              ⚠ 2 warnings · f2 to view',
];

/**
 * Codex 0.157.1 after an answered turn: a capture. The echoed turn sits above,
 * wrapped, and the idle input line below. Not a question.
 */
export const CODEX_ANSWERED = [
  '╭─────────────────────────────────────────────────────╮',
  '│ >_ OpenAI Codex (v0.157.1)                          │',
  '│                                                     │',
  '│ model:     GPT-6-Luna medium   /model to change     │',
  '│ directory: /private/var/folders/s5/…/bots/cap-codex │',
  '╰─────────────────────────────────────────────────────╯',
  '› Reply with the single word OK and nothing else, and run no command. This line is long on purpose so that it wraps',
  '  onto more than one row of the screen, the way a fleet mail nudge with its full paths does: /private/var/folders/s5/',
  '  example/obk-dev2-capture/bots/cap-codex message check',
  '• OK',
  '  4:13 AM',
  '                                                  Tip: Use /init to create an AGENTS.md with project-specific guidance.',
  '› Ask Codex to do anything',
  '  GPT-6-Luna medium · <tmp>/obk-dev2-capture-5CkZDQ/bots/cap-codex ·…',
  '  ? for shortcuts                                                                             ⚠ 2 warnings · f2 to view',
];

/**
 * Codex 0.157.1 at its idle input line right after its folder-trust question
 * and its hooks review were answered, its start prompt echoed above: a capture
 * from #342 (the architect's live run, 2026-09-26). The screen Orca went on
 * calling `agent-trust-workspace` when it was seen live; in this capture's own
 * run Orca's wait named no reason. Not a question.
 */
export const CODEX_AFTER_TRUST = [
  '╭─────────────────────────────────────────────────────╮',
  '│ >_ OpenAI Codex (v0.157.1)                          │',
  '│                                                     │',
  '│ model:     GPT-6-Luna medium   /model to change     │',
  '│ directory: /private/var/folders/s5/…/bots/cap-codex │',
  '╰─────────────────────────────────────────────────────╯',
  '› You are a throwaway bot for one capture and own nothing. Say nothing now and wait.',
  '  1:00 PM',
  '                                                     Tip: Paste an image with Ctrl+V to attach it to your next message.',
  '› Ask Codex to do anything',
  '  GPT-6-Luna medium · <tmp>/obk-capture-342-qeq4663w/bots/cap-codex …',
  '  ? for shortcuts                                                                              ⚠ 1 warning · f2 to view',
];

/**
 * Codex 0.157.1's update offer, the screen issue #329 is about: a line typed
 * with a return took its default, "Update now", and Codex updated the machine.
 * A reconstruction: the words are the pieces the issue quotes (the `…` inside
 * the command is the issue's, not the screen's), and the layout between them
 * was not captured. The blank rows under the footer are the rest of the screen;
 * the captures end at their last drawn row and this one does not, so a look
 * that reads only the very last row is caught either way.
 */
export const CODEX_UPDATE_OFFER = [
  '',
  '  ✨ Update available! 0.156.1 -> 0.157.1',
  '',
  "› 1. Update now (runs `sh -c 'curl -fsSL https://chatgpt.com/codex/install.sh | … sh'`)",
  '  2. Skip',
  '  3. Skip until next version',
  '',
  '  enter continue · esc skip',
  '',
  '',
  '',
  '',
];

/**
 * Codex 0.157.1's `/new` menu, put up after an answered turn, the echo of that
 * turn above it: a capture. Orca answered `tui-idle` satisfied, with no reason.
 */
export const CODEX_NEW_MENU = [
  '╭─────────────────────────────────────────────────────╮',
  '│ >_ OpenAI Codex (v0.157.1)                          │',
  '│                                                     │',
  '│ model:     GPT-6-Luna medium   /model to change     │',
  '│ directory: /private/var/folders/s5/…/bots/cap-codex │',
  '╰─────────────────────────────────────────────────────╯',
  '› Reply with the single word OK and nothing else, and run no command. This line is long on purpose so that it wraps',
  '  onto more than one row of the screen, the way a fleet mail nudge with its full paths does: /private/var/folders/s5/',
  '  example/obk-dev2-capture/bots/cap-codex message check',
  '• OK',
  '  4:13 AM',
  '  Where should the new conversation run?',
  '› 1. Current checkout  Keep using the current working directory',
  '  2. New worktree      Create an isolated managed checkout',
  '  enter select · esc back',
];

/**
 * Codex 0.157.1's folder-trust question, its selection on the first choice: a
 * capture, from an orphaned tab, read with `source: "screen"`. Orca named a
 * reason for this one, `agent-trust-workspace`; a test that puts it in front
 * of the kit with none is asking about the screen alone.
 */
export const CODEX_TRUST = [
  '  Folder access',
  '  <tmp>/obk-system-question-Xygmnk/bots/question-codex',
  '  Note: You’re in a subdirectory of a Git project. Trusting will apply to the repository root:',
  '  <tmp>/obk-system-question-Xygmnk',
  '  Trust this folder? Codex can read, edit, and run files here, subject to your permission settings. Folder settings',
  '  can run code automatically, even without a model request. Continue only if you trust these files. Your trust',
  '  decision will be saved.',
  '› 1. Trust and continue',
  '  2. Quit',
  '  enter continue · esc quit',
];

/**
 * Codex 0.157.1's hooks review, which the kit's own hook brings up, its
 * selection on `1`: a capture. Orca answered `tui-idle` satisfied, with no
 * reason: the first screen of a fresh kit-made Codex tab, and one the old
 * guard let a line into.
 */
export const CODEX_HOOKS_REVIEW = [
  '  Hooks need review',
  '  1 hook is new or changed.',
  '  Hooks can run outside the sandbox after you trust them.',
  '› 1. Review hooks',
  '  2. Trust all and continue',
  "  3. Continue without trusting (hooks won't run)",
  '  enter confirm · esc skip',
];

/** The same hooks review with its selection moved down to `2`, no return pressed yet: a capture. */
export const CODEX_HOOKS_REVIEW_ON_TWO = [
  '  Hooks need review',
  '  1 hook is new or changed.',
  '  Hooks can run outside the sandbox after you trust them.',
  '  1. Review hooks',
  '› 2. Trust all and continue',
  "  3. Continue without trusting (hooks won't run)",
  '  enter confirm · esc skip',
];

/**
 * Claude Code 2.1.283's folder-trust list, its selection on `No, exit`, its
 * choices unnumbered: a capture, the whole `tail` of a kit-made tab. Above it,
 * the launch line the kit typed, wrapped where the screen is 120 columns wide,
 * and the mailbox step's answer. Not a question by the numbered rule at the
 * top; see CLAUDE_TRUST_AS_ORCA_SAW_IT for why the kit types nothing into it
 * all the same. The system tests' look counts it by its foot row.
 */
export const CLAUDE_TRUST = [
  '➜  bot-father git:(main) ✗ <kit clone>/src/cli.js ses',
  'sion mailbox --bots <tmp>/obk-system-question-Xygmnk --bot bot-father',
  ' --session daily; OBK_TAB_SHELL=$$ OBK_CLI=<kit clone>',
  '/src/cli.js claude --permission-mode auto -n bot-father.daily.9r9v3vg3',
  'bot-father/daily has its mailbox run_1774b8ba625f, made in this tab.',
  '─'.repeat(120),
  ' Accessing workspace:',
  ' <tmp>/obk-system-question-Xygmnk/bots/bot-father',
  ' Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source',
  ' project, or work from your team). If not, take a moment to review what\'s in this folder first.',
  ' Claude Code\'ll be able to read, edit, and execute files here.',
  ' Security guide',
  ' ❯ No, exit',
  '   Yes, I trust this folder',
  ' Enter to confirm · Esc to cancel',
];

/**
 * What Orca said about the tab CLAUDE_TRUST was captured in, as the fake Orca's
 * state: its wait timed out, as on a harness at work, and it named no agent in
 * the tab (both seen live, for minutes).
 */
export const CLAUDE_TRUST_AS_ORCA_SAW_IT = { waitIdle: 'busy', agentIdentity: null };

/**
 * Claude Code offering to learn the machine: the question and its three
 * numbered choices are in the tech notes (verified live on 2.1.278). Where the
 * selection starts is not recorded, and the layout follows CLAUDE_TRUST's. A
 * reconstruction.
 */
export const CLAUDE_TEACH_AUTO = [
  '',
  ' Teach auto mode about your environment?',
  '',
  ' ❯ 1. Yes',
  '   2. Not now',
  "   3. Don't show again",
  '',
];

/**
 * Claude Code 2.1.283's "Teach auto mode about your environment?", a form with
 * no numbers, its selection on "Also scan shell history", drawn under a rule of
 * `▔` right after the session's first turn: a capture, the whole `tail` of a
 * kit-made tab in #261's live test, 2026-09-28, in auto mode. Enter on it is
 * Continue, which starts a scan of the project, recent Claude sessions and, as
 * it stands, the shell history (#416). `<tmp>` stands for the system temp
 * folder, in full on the wrapped rows and in Claude Code's own shortening on
 * the third; the rows were not wrapped again.
 */
export const CLAUDE_TEACH_FORM = [
  ' ▐▛███▛█   Claude Code v2.1.283',
  '▝▜██████▀  Opus 5.5 with xhigh effort · Claude Max',
  ' ▝▝   ▝▝   <tmp>/obk-system-node-nudge-XX7Vtx/bots/node-nudge · /rc',
  '❯ You are a system test\'s bot and you own nothing. Your bots folder is',
  '  <tmp>/obk-system-node-nudge-XX7Vtx. Do nothing that is not written',
  '  here: read no file and write nothing. Reply now with READY-3917 and nothing else. When a line arrives saying fleet',
  '  mail is waiting, run exactly the command that line names to read it, and then print MAIL: followed by the text of the',
  '  message. When you are asked to write something out, do exactly that. Otherwise say nothing and wait.',
  '⏺ READY-3917',
  '✻ Churned for 1s · done 5:42 AM',
  '▔'.repeat(120),
  '   Teach auto mode about your environment?',
  '   Claude Code reads this project, your recent Claude sessions, and optionally your shell history and other',
  '   repositories. Claude analyzes this data and customizes auto mode to make better decisions.',
  '     How you use Claude here     Mixed',
  '   ❯ Also scan shell history     true',
  '     Also scan your other repos  false',
  '     Continue',
  '   ←/→ to change usage · Enter to continue · Esc to cancel',
];

/**
 * The same form with its selection moved down to Continue, the row a return
 * takes: a reconstruction, CLAUDE_TEACH_FORM with the pointer moved.
 */
export const CLAUDE_TEACH_FORM_ON_CONTINUE = CLAUDE_TEACH_FORM.map((row) => {
  if (row === '   ❯ Also scan shell history     true') return '     Also scan shell history     true';
  if (row === '     Continue') return '   ❯ Continue';
  return row;
});

/**
 * Claude Code 2.1.289's "Teach auto mode about your environment?", a numbered
 * list this time, its selection on "1. Yes", drawn above the input box right
 * after the session's first turn: a capture, the whole `tail` of a kit-made
 * temporary session's tab in #489's live run, 2026-10-05, in auto mode. Enter
 * on it takes the row the pointer is on; its answer is "2. Not now" (#489).
 * The input box below it keeps its own `❯`. `<tmp>` stands for the system temp
 * folder, in full on the wrapped rows and in Claude Code's own shortening on
 * the third; the rows were not wrapped again.
 */
export const CLAUDE_TEACH_LIST = [
  ' ▐▛███▛█   Claude Code v2.1.289',
  '▝▜██████▀  Opus 5.5 with xhigh effort · Claude Max',
  ' ▝▝   ▝▝   <tmp>/obk-system-temp-answer-8k20ct/bots/answer-bot · /rc',
  '❯ You are a system test\'s session and you own nothing. Do not run any command, read or write any file, or use any tool.',
  '  Reply now with READY-4893 and nothing else, then wait.',
  '  Your work dir is',
  '  <tmp>/obk-system-temp-answer-8k20ct/bots/answer-bot/work/helper.',
  '  It is a plain folder the kit made for you, not a git worktree.',
  '⏺ READY-4893',
  '✻ Baked for 1s · done 3:15 AM',
  '─'.repeat(120),
  '  Teach auto mode about your environment?',
  '  Auto mode works better when it knows your environment. Takes about a minute.',
  '  ❯ 1. Yes',
  '    2. Not now',
  '    3. Don\'t show again',
  '  Enter to confirm · Esc to cancel',
  `${'─'.repeat(91)} answer-bot.helper.vm2yc5b2 ─`,
  '❯',
  '─'.repeat(120),
  '  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents',
];

/** CLAUDE_TEACH_LIST with its selection on `choice`, one of its three rows: a reconstruction. */
const teachListOn = (choice) => CLAUDE_TEACH_LIST.map((row) => {
  const found = /^ {2}(?:❯ | {2})([123]\. .+)$/.exec(row);
  if (found === null) return row;
  return found[1] === choice ? `  ❯ ${found[1]}` : `    ${found[1]}`;
});

/** The same list with its selection moved down to "2. Not now", no return pressed yet: a reconstruction. */
export const CLAUDE_TEACH_LIST_ON_NOT_NOW = teachListOn('2. Not now');

/** The same list with its selection on "3. Don't show again": a reconstruction. */
export const CLAUDE_TEACH_LIST_ON_THREE = teachListOn('3. Don\'t show again');

/**
 * Not a question: the model's answer holds an ordinary numbered list, with no
 * pointer on it, and the empty input line is below. A reconstruction on the
 * captured input line.
 */
export const NUMBERED_ANSWER = [
  '❯ What is left to do on this issue?',
  '⏺ Three things are left:',
  '  1. Write the tests for the fake',
  '  2. Run them and read the failures',
  '  3. Hand them to the implementer',
  ...CLAUDE_INPUT_LINE,
];

/**
 * Not a question: a question-shaped block that is history, pointer and numbers
 * and all, with the input line back below it. Here the model quotes Codex's
 * update offer, the way a bot working on issue #329 has it on its screen for
 * hours. A reconstruction on the captured input line.
 */
export const QUESTION_IN_HISTORY = [
  '❯ What did Codex show when it updated itself?',
  '⏺ Its update offer, as issue #329 quotes it:',
  '  ✨ Update available! 0.156.1 -> 0.157.1',
  "  › 1. Update now (runs `sh -c 'curl -fsSL https://chatgpt.com/codex/install.sh | … sh'`)",
  '    2. Skip',
  '    3. Skip until next version',
  '  The line typed with a return took the default.',
  ...CLAUDE_INPUT_LINE,
];

/**
 * Not a question: the teach form's own words, title, pointer and foot row, are
 * history, quoted by the model the way a bot working on issue #416 has them on
 * its screen, with the input line back below. A reconstruction on the
 * captured input line.
 */
export const FORM_IN_HISTORY = [
  '❯ What did Claude Code show after the first turn?',
  '⏺ Its form to teach auto mode, as issue #416 quotes it:',
  '     Teach auto mode about your environment?',
  '     How you use Claude here     Mixed',
  '     ❯ Also scan shell history     true',
  '       Continue',
  '     ←/→ to change usage · Enter to continue · Esc to cancel',
  '  Enter on it is Continue, which starts the scan.',
  ...CLAUDE_INPUT_LINE,
];

// A harness's own command typed into its input line and not entered yet, and
// a harness at work (#391). Where a screen is a live capture it says so; the
// rest are reconstructions on the captured CLAUDE_ANSWERED or CODEX_ANSWERED,
// with the rows around the command made up here on the layout live run 4
// showed.

/** Claude Code's screen down to its input box: CLAUDE_ANSWERED's header, its answered turn. */
const CLAUDE_ABOVE_INPUT = CLAUDE_ANSWERED.slice(0, 7);

// Claude Code 2.1.288, as live run 4 of #391 showed it: the input line puts a
// non-breaking space (U+00A0) after its pointer, `❯\u00a0/clear`; the slash
// menu is drawn ABOVE the input box's top rule, one command a row, a long
// description wrapped onto a row of its own lined up under the description,
// and no pointer marks a selection. With "/" alone typed, the menu showed only
// part of the list. Orca's tui-idle stayed ok with the menu open. The rules
// were relayed shortened ("──────…──"); here they are drawn full width, as in
// the captures above.

/** The top rule of the live run's Claude bot's input box, carrying its session's name. */
const CLAUDE_LIVE_RULE = `${'─'.repeat(92)} clear-claude.daily.drqpadex ─`;

/** Its bottom rule. */
const CLAUDE_RULE = '─'.repeat(120);

/** Its foot row, as live run 4 showed it. */
const CLAUDE_LIVE_FOOT = '  ⏵⏵ auto mode on (shift+tab to cycle)';

/** Claude Code 2.1.288 with `menu` drawn above its input box and `input` as its input line. */
const claudeMenuAbove = (menu, input) => [...CLAUDE_ABOVE_INPUT, ...menu, CLAUDE_LIVE_RULE, input, CLAUDE_RULE, CLAUDE_LIVE_FOOT];

/** Claude Code's input line reading `text`, with the non-breaking space after its pointer, as 2.1.288 draws it. */
const claudeInput = (text) => `❯\u00a0${text}`;

/** Claude Code's menu rows for `/clear`, word for word as live run 4 showed them: the command, its description wrapped. */
const CLAUDE_CLEAR_ROWS = [
  '  /clear                                          Start a new session with empty context; previous session stays on',
  '                                                  disk (resumable with /resume)',
];

/** Claude Code's menu row for `/compact`, laid out as /clear's; the words are made up. */
const CLAUDE_COMPACT_ROWS = ['  /compact                                        Clear conversation history but keep a summary in context'];

/** Claude Code's menu rows for "/" alone, part of the list as live run 4 showed it; the descriptions are made up. */
const CLAUDE_SLASH_ROWS = [
  '  /systematic-validation                          Validate code or docs against explicit design docs, requirements,',
  '                                                  test specs, CLAUDE.md, or AGENTS.md standards',
  '  /claude-api                                     Reference for the Claude API / Anthropic SDK: model ids, pricing,',
  '                                                  params, streaming, tool use',
];

/**
 * `/clear` typed into Claude Code 2.1.288's empty input line, its menu above
 * the box with `/clear` its first and only command row. From the menu down, a
 * live capture (live run 4 of #391), the rules drawn full width; the header
 * above is CLAUDE_ANSWERED's.
 */
export const CLAUDE_CLEAR_TYPED = claudeMenuAbove(CLAUDE_CLEAR_ROWS, claudeInput('/clear'));

/**
 * `/clear` typed after a draft that was already in the input line, so the line
 * reads the draft and the command together; the menu above is drawn as for the
 * command alone, so only the input line is wrong. A reconstruction.
 */
export const CLAUDE_CLEAR_AFTER_DRAFT = claudeMenuAbove(CLAUDE_CLEAR_ROWS, claudeInput('fix the flaky test/clear'));

/**
 * `/clear` typed, and the menu's first command row above the box a command
 * whose name only starts with it, `/clear` itself second. A reconstruction: no
 * such command was seen.
 */
export const CLAUDE_CLEAR_OTHER_FIRST = claudeMenuAbove([
  '  /clear-history                                  Remove the prompt history',
  ...CLAUDE_CLEAR_ROWS,
], claudeInput('/clear'));

/** `/clear` typed, and no menu at all above the input box: its foot row under it as when idle. A reconstruction. */
export const CLAUDE_CLEAR_NO_MENU = claudeMenuAbove([], claudeInput('/clear'));

/**
 * `/clear` typed, and the menu drawn UNDER the input box, none above it: the
 * layout the kit read before live run 4, which Claude Code 2.1.288 does not
 * draw. A reconstruction.
 */
export const CLAUDE_CLEAR_MENU_BELOW = [...CLAUDE_ABOVE_INPUT, CLAUDE_LIVE_RULE, claudeInput('/clear'), CLAUDE_RULE, ...CLAUDE_CLEAR_ROWS];

/** `/compact` typed into Claude Code's empty input line, its menu above with `/compact` first. A reconstruction on the live layout. */
export const CLAUDE_COMPACT_TYPED = claudeMenuAbove(CLAUDE_COMPACT_ROWS, claudeInput('/compact'));

/**
 * Claude Code at work on a turn, its empty input line below: the row above the
 * box says how to interrupt it, here with a capital E, as either harness may
 * write it. Orca's `tui-idle` can call a harness like this idle (tech notes,
 * section 1). A reconstruction.
 */
export const CLAUDE_WORKING = [
  ...CLAUDE_ABOVE_INPUT.slice(0, 5),
  '✻ Thinking… (12s · ↓ 300 tokens · Esc to interrupt)',
  ...CLAUDE_INPUT_LINE,
];

/** Codex's screen down to its input line: CODEX_ANSWERED's box, its answered turn and the tip. */
const CODEX_ABOVE_INPUT = CODEX_ANSWERED.slice(0, 12);

/** Codex's status rows under its input line, as captured in CODEX_ANSWERED. */
const CODEX_STATUS = CODEX_ANSWERED.slice(13);

/** Codex with `input` as its input line and `below` under it. */
const codexWith = (input, below) => [...CODEX_ABOVE_INPUT, input, ...below];

/**
 * Codex 0.160.0 at its idle input line with nothing in it, not even its
 * placeholder: CODEX_IDLE with the input line a bare `›`. A reconstruction.
 */
export const CODEX_IDLE_EMPTY = CODEX_IDLE.map((row) => (row === '› Ask Codex to do anything' ? '›' : row));

// Codex 0.160.0, as live run 4 of #391 showed it: the slash popup is drawn
// ABOVE the input line, its selected row with Codex's pointer, and Orca's
// screen read never shows the composer's text while the popup is open, even
// with only "/" typed: the input line reads `›` alone. With "/new" typed, the
// popup is filtered down to `/new`'s row. Orca's tui-idle times out with the
// popup open, and stayed out after a backspace. Codex's own snapshot test at
// tag rust-v0.160.0 (codex-rs/tui/src/bottom_pane/snapshots/
// codex_tui__bottom_pane__chat_composer__tests__slash_popup_res.snap) draws the
// popup above a line that does show the text: "› /resume  resume a saved
// chat", "", "› /res", "", "  100% context left". Where a screen below is a
// live capture it says so; above the popup it is CODEX_ANSWERED's box and
// answered turn, a reconstruction.

/** Codex's screen above a popup: CODEX_ANSWERED's box and its answered turn. */
const CODEX_ABOVE_POPUP = CODEX_ANSWERED.slice(0, 11);

/** Codex's status row as live run 4 showed it, the folder as Codex shortened it. */
const CODEX_LIVE_STATUS = '  GPT-6-Luna medium · /private/var/folders/…/bots/clear…';

/** Codex's popup row for each command the kit types, selected, word for word as seen live for /new. */
const CODEX_ROWS = {
  '/new': '› /new  start a new chat during a conversation',
  '/compact': '› /compact  summarize conversation to prevent hitting the context limit',
};

/** Codex with `popup` above its input line, a blank row between, and `input` as the line, as live run 4 showed it. */
const codexPopup = (popup, input = '›') => [...CODEX_ABOVE_POPUP, ...popup, '', input, CODEX_LIVE_STATUS];

/**
 * "/" alone typed into Codex 0.160.0: the popup lists every command, `/model`
 * selected, and the input line reads `›` alone. From the popup down, a live
 * capture (live run 4), partial: the rows between `/fast` and `/approve` were
 * not relayed, nor `/approve`'s description, nor whether a blank row came
 * before the input line.
 */
export const CODEX_SLASH_TYPED = [
  ...CODEX_ABOVE_POPUP,
  '› /model         choose what model and reasoning effort to use',
  '  /fast          1.5x speed',
  '  /approve …',
  '›',
  CODEX_LIVE_STATUS,
];

/**
 * `/new` typed into Codex 0.160.0: the popup filtered down to `/new`'s row,
 * selected, a blank row, and the input line `›` alone. From the popup down, a
 * live capture (live run 4).
 */
export const CODEX_NEW_TYPED = codexPopup([CODEX_ROWS['/new']]);

/**
 * `/new` typed, the popup as in CODEX_NEW_TYPED, and the input line showing
 * the text, `› /new`, as Codex's own snapshot draws it. A reconstruction.
 */
export const CODEX_NEW_TYPED_SHOWN = codexPopup([CODEX_ROWS['/new']], '› /new');

/**
 * `/new` typed, and the input line left bare: the popup above it shows `/new`
 * selected, and the line itself reads `›` alone. A live capture (live run 2 of
 * #391, Codex 0.160.0), partial: the rows the kit's refusal printed, its last
 * rows with the blank ones dropped, the folder as Codex shortened it. The line
 * stayed bare for 3 s. The same layout as CODEX_NEW_TYPED but for the blank row.
 */
export const CODEX_NEW_BARE_INPUT = [
  '• DONE',
  '  Worked for 1m 18s • 10:33 AM',
  '› /new  start a new chat during a conversation',
  '›',
  '  GPT-6-Luna medium · /private/var/folders/…/bots/clear…',
];

/**
 * `/new` typed, and the popup's selected row another command. A reconstruction
 * made up to test the rule: no such screen was seen.
 */
export const CODEX_NEW_OTHER_SELECTED = codexPopup(['› /model         choose what model and reasoning effort to use']);

/**
 * `/new` typed, and the popup not filtered down to it: a second command row
 * above `/new`'s, which is selected and sits nearest the input line. A
 * reconstruction made up to test the rule.
 */
export const CODEX_NEW_TWO_ROWS = codexPopup(['  /model         choose what model and reasoning effort to use', CODEX_ROWS['/new']]);

/** The same popup over an input line that shows the text, `› /new`. A reconstruction made up to test the rule. */
export const CODEX_NEW_TWO_ROWS_SHOWN = codexPopup(['  /model         choose what model and reasoning effort to use', CODEX_ROWS['/new']], '› /new');

/**
 * `/new` typed, and no popup at all: Codex's status rows under the line as
 * when idle, and above it only the echo of the last turn. A reconstruction.
 */
export const CODEX_NEW_NO_MENU = codexWith('› /new', CODEX_STATUS);

/**
 * Codex's `/new` menu with its selection moved down to `2. New worktree`:
 * CODEX_NEW_MENU with the pointer moved, a reconstruction.
 */
export const CODEX_NEW_MENU_ON_TWO = CODEX_NEW_MENU.map((row) => {
  if (row.startsWith('› 1. Current checkout')) return `  ${row.slice(2)}`;
  if (row.startsWith('  2. New worktree')) return `› ${row.slice(2)}`;
  return row;
});

/** `/compact` typed into Codex 0.160.0, its popup filtered to `/compact`, selected, the input line bare. A reconstruction on the live layout. */
export const CODEX_COMPACT_TYPED = codexPopup([CODEX_ROWS['/compact']]);

/**
 * `/compact` typed into a Codex that has no such command: its popup finds
 * nothing to offer, so no row of it is selected. A reconstruction.
 */
export const CODEX_COMPACT_NOT_OFFERED = codexPopup(['  no matches']);

/** Claude Code's menu rows for each command the kit types. */
const CLAUDE_ROWS = { '/clear': CLAUDE_CLEAR_ROWS, '/compact': CLAUDE_COMPACT_ROWS };

/**
 * What the harness shows after each character of `command` but the last, as
 * the kit types it one character a send (#391), on the layout live run 4
 * showed. Claude Code: the typed part in the input line, after its
 * non-breaking space, and above the box the part of the list "/" shows, then
 * the command's own rows. Codex: the input line `›` alone, and above it the
 * whole list for "/", then the command's own row. One screen per send, for the
 * fake Orca's `nextScreens`; the screen after the last character is the test's
 * to give. Reconstructions, but for "/" on Codex, which is CODEX_SLASH_TYPED.
 */
export function whileTyping(harness, command) {
  return [...command].slice(0, -1).map((_, at) => {
    const typed = command.slice(0, at + 1);
    if (harness === 'codex') return typed === '/' ? CODEX_SLASH_TYPED : codexPopup([CODEX_ROWS[command]]);
    return claudeMenuAbove(typed === '/' ? CLAUDE_SLASH_ROWS : CLAUDE_ROWS[command], claudeInput(typed));
  });
}

/**
 * Codex at work on a turn, its empty input line below: the row above it says
 * how to interrupt it, in lower case. Orca's `tui-idle` called Codex busy like
 * this idle (tech notes, section 1). A reconstruction.
 */
export const CODEX_WORKING = [
  ...CODEX_ABOVE_INPUT.slice(0, 9),
  '• Working (12s • esc to interrupt)',
  '',
  '› Ask Codex to do anything',
  ...CODEX_STATUS,
];

// The harness's own at-work marker, as seen live (#391, the architect's
// ruling after live run 3). Codex: a row with "esc to interrupt", here as live
// run 3 showed it, "• Working (8s • esc to interrupt)". Claude Code 2.1.288:
// its spinner status row, a glyph, a word ending in "…", then "(" and a time,
// as live run 2 showed it, "✳ Nucleating… (1m 8s · ↓ 131 tokens)"; it shows
// no "esc to interrupt". A finished row, such as CLAUDE_ANSWERED's "✻ Cooked
// for 1s · done 4:14 AM", is no marker. The words of both rows are live; the
// screens around them are reconstructions on the captures above.

/** Claude Code 2.1.288's spinner row while it works, word for word as seen on live run 2. */
const CLAUDE_SPINNER_ROW = '✳ Nucleating… (1m 8s · ↓ 131 tokens)';

/** Codex's at-work row, word for word as seen on live run 3. */
const CODEX_WORKING_ROW = '• Working (8s • esc to interrupt)';

/**
 * Claude Code 2.1.288 at work, its empty input line below: its spinner row and
 * nothing that says "esc to interrupt". Orca's tui-idle may still answer ok. A
 * reconstruction on the live row.
 */
export const CLAUDE_AT_WORK = [...CLAUDE_ABOVE_INPUT.slice(0, 5), CLAUDE_SPINNER_ROW, ...CLAUDE_INPUT_LINE];

/**
 * The harness at work, with `typed` (part or all of `command`) typed, on the
 * layout live run 4 showed: what the screen shows when the harness starts
 * working partway through the kit's typing, or just before its return, every
 * row but the at-work one as it would be with the harness idle. A
 * reconstruction on the live rows.
 */
export function atWork(harness, typed, command) {
  return harness === 'codex'
    ? [...CODEX_ABOVE_POPUP.slice(0, 9), CODEX_WORKING_ROW, '', CODEX_ROWS[command], '', '›', CODEX_LIVE_STATUS]
    : [...CLAUDE_ABOVE_INPUT.slice(0, 5), CLAUDE_SPINNER_ROW, ...(typed === '/' ? CLAUDE_SLASH_ROWS : CLAUDE_ROWS[command]), CLAUDE_LIVE_RULE, claudeInput(typed), CLAUDE_RULE, CLAUDE_LIVE_FOOT];
}

/** A row the pointer starts, whatever follows it: a choice, the input line, or an echoed turn. */
const POINTER_ROW = /^ *[›❯]/;

/** The pointer on a numbered choice: `› 1. Trust and continue`, ` ❯ 2. Not now`. */
const ON_A_NUMBER = /^( *[›❯] +)\d+\. +\S/;

/** Whether `row` holds a numbered choice whose number starts exactly at column `at`. */
const numberedAt = (row, at) => row !== undefined && row.slice(0, at).trim() === '' && /^\d+\. +\S/.test(row.slice(at));

/**
 * The keys a form or menu offers on its foot row, a return among them:
 * Claude Code 2.1.283's "←/→ to change usage · Enter to continue · Esc to
 * cancel" and "Enter to confirm · Esc to cancel", Codex 0.157.1's "enter
 * continue · esc skip", "enter confirm · esc skip" and "enter select · esc
 * back", all captured above.
 */
const FOOT_ROW = /\benter (?:to )?(?:continue|confirm|select)\b|\besc to cancel\b/i;

/** A rule Claude Code draws a form under, or one of its input box's: `─` or `▔` right across. */
const RULE_ROW = /^ *[─▔]{8,}/;

/**
 * The question a screen is asking, as the rows that make it up, or undefined
 * when it asks none, by the rules at the top of this file: a numbered choice
 * list, or a form by its foot row. This is the system tests' own look, not the
 * kit's. A screen it wrongly takes for a question makes a test wait and then
 * fail showing the screen; one it missed would have the test type into the
 * question.
 */
export function questionOn(rows) {
  const at = rows.findLastIndex((row) => POINTER_ROW.test(row));
  const drawn = rows.findLastIndex((row) => row.trim() !== '');
  const pointer = at < 0 ? null : ON_A_NUMBER.exec(rows[at]);
  if (pointer !== null) {
    const column = pointer[1].length;
    if (numberedAt(rows[at - 1], column) || numberedAt(rows[at + 1], column)) {
      let first = at;
      while (first > 0 && numberedAt(rows[first - 1], column)) first -= 1;
      return rows.slice(Math.max(0, first - 3), drawn + 1);
    }
  }

  const from = Math.max(0, at);
  if (!rows.slice(from).some((row) => FOOT_ROW.test(row))) return undefined;
  const rule = rows.slice(0, from).findLastIndex((row) => RULE_ROW.test(row));
  return rows.slice(rule + 1, drawn + 1);
}

/**
 * What stands between a live tab and a line a system test wants to type into
 * it, as the sentence a wait that ran out adds to its message, or undefined
 * when nothing does. `orca` is the calling test's own way of asking the real
 * Orca: it takes the arguments, adds `--json` and gives back the answer.
 *
 * A screen that cannot be read counts as in the way: not knowing whether a
 * question is up is no reason to type.
 */
export function waitingOn(orca, handle) {
  const answer = orca(['terminal', 'read', '--terminal', handle, '--screen']);
  const shown = answer.ok === true ? answer.result?.terminal : undefined;
  if (shown?.source !== 'screen' || !Array.isArray(shown.tail)) {
    const why = answer.ok === true ? `Orca answered with source ${shown?.source}` : `Orca refused: ${JSON.stringify(answer.error)}`;
    return ` The tab's screen could not be read (${why}), so this test cannot tell whether a question of the harness's own is up.`;
  }
  const question = questionOn(shown.tail);
  return question === undefined
    ? undefined
    : ` The tab is waiting on a question of its harness's own, and this test answers none:\n    ${question.join('\n    ')}`;
}

/** The title of Claude Code's "Teach auto mode" form (#416). */
const TEACH_TITLE = 'Teach auto mode about your environment?';

/** A form row with its pointer, wherever it sits, taken out: `❯ Continue` reads as `Continue`. */
const unpointed = (row) => row.replace('❯', ' ').trim();

/**
 * Whether Claude Code's "Teach auto mode about your environment?" form on a
 * tab's rendered `rows` is the captured one and nothing else, the one a system
 * test may answer with Esc in its own throwaway tab (the architect's ruling
 * on #391 after live run 3): undefined when it may, or why not. Every
 * non-blank row from the form's title down is a row of CLAUDE_TEACH_FORM from
 * its title down, the pointer `❯` on exactly one of them, on whichever row
 * it sits; nothing is missing and nothing is added. A row not on that list is
 * refused by name. See test/teach-form.test.js.
 */
export function onlyTeachFormOf(rows) {
  const from = rows.findIndex((row) => row.trim() === TEACH_TITLE);
  if (from < 0) return `it has no "${TEACH_TITLE}" row, so it is not the form captured as CLAUDE_TEACH_FORM`;
  const seen = rows.slice(from).filter((row) => row.trim() !== '');
  const captured = CLAUDE_TEACH_FORM.slice(CLAUDE_TEACH_FORM.findIndex((row) => row.trim() === TEACH_TITLE)).filter((row) => row.trim() !== '');
  const pointers = seen.filter((row) => row.includes('❯')).length;
  if (pointers !== 1) return `it has ${pointers} rows with the pointer ❯, where the captured form has one`;
  const odd = seen.find((row) => !captured.map(unpointed).includes(unpointed(row)));
  if (odd !== undefined) return `it carries a row the captured form does not, which this test has no ruling for: ${odd.trim()}`;
  const missing = captured.find((row) => !seen.map(unpointed).includes(unpointed(row)));
  if (missing !== undefined) return `it lacks a row the captured form has: ${missing.trim()}`;
  if (seen.length !== captured.length) return `it has ${seen.length} rows from its title down, where the captured form has ${captured.length}`;
  return undefined;
}

/** The foot row Claude Code draws under a Teach form or list: `Enter to … · Esc to cancel`. */
const TEACH_FOOT = /^ *(?:.* · )?Enter to \S.* · Esc to cancel *$/;

/**
 * Whether Claude Code 2.1.289's "Teach auto mode about your environment?" list
 * on a tab's rendered `rows` is the captured one and nothing else (#489, the
 * architect's ruling on the 2.1.289 list): undefined when it is, or why not.
 * The rows that count run from the title row to the first foot row under it,
 * `Enter to … · Esc to cancel`; the input box below, with its own `❯`, does
 * not count. Every non-blank row there is a row of CLAUDE_TEACH_LIST from its
 * title to its foot, in the same order, the pointer `❯` on exactly one of
 * them, on whichever row it sits; nothing is missing and nothing is added. A
 * row not on that list is refused by name. And it is framed as Claude Code
 * draws it, not as it is quoted (the ruling on the review of PR #490): the
 * non-blank row right above the title is a rule of `─` or `▔` alone, and the
 * non-blank row right below the foot, if there is one, is the input box's top
 * rule, starting with `─`. See test/teach-list.test.js.
 */
export function onlyTeachListOf(rows) {
  const block = (shown) => {
    const from = shown.findIndex((row) => row.trim() === TEACH_TITLE);
    if (from < 0) return undefined;
    const foot = shown.findIndex((row, at) => at > from && TEACH_FOOT.test(row));
    return foot < 0 ? undefined : shown.slice(from, foot + 1).filter((row) => row.trim() !== '');
  };
  if (!rows.some((row) => row.trim() === TEACH_TITLE)) return `it has no "${TEACH_TITLE}" row, so it is not the list captured as CLAUDE_TEACH_LIST`;
  const seen = block(rows);
  if (seen === undefined) return 'it has no "Enter to … · Esc to cancel" row under its title, so it is not the list captured as CLAUDE_TEACH_LIST';
  const captured = block(CLAUDE_TEACH_LIST);
  const pointers = seen.filter((row) => row.includes('❯')).length;
  if (pointers !== 1) return `it has ${pointers} rows with the pointer ❯ from its title to its foot, where the captured list has one`;
  const odd = seen.find((row) => !captured.map(unpointed).includes(unpointed(row)));
  if (odd !== undefined) return `it carries a row the captured list does not, which this test has no ruling for: ${odd.trim()}`;
  const missing = captured.find((row) => !seen.map(unpointed).includes(unpointed(row)));
  if (missing !== undefined) return `it lacks a row the captured list has: ${missing.trim()}`;
  if (seen.length !== captured.length) return `it has ${seen.length} rows from its title to its foot, where the captured list has ${captured.length}`;
  const outOfOrder = seen.find((row, at) => unpointed(row) !== unpointed(captured[at]));
  if (outOfOrder !== undefined) return `its rows are not in the captured list's order: ${outOfOrder.trim()}`;
  const from = rows.findIndex((row) => row.trim() === TEACH_TITLE);
  const above = rows.slice(0, from).findLast((row) => row.trim() !== '');
  if (above === undefined || !/^\s*(?:─+|▔+)\s*$/.test(above)) return `the row above its title is not a rule, so it is quoted, not drawn: ${above?.trim() ?? '(none)'}`;
  const foot = rows.findIndex((row, at) => at > from && TEACH_FOOT.test(row));
  const below = rows.slice(foot + 1).find((row) => row.trim() !== '');
  if (below !== undefined && !/^\s*─/.test(below)) return `the row below its foot is not the input box's rule, so it is quoted, not drawn: ${below.trim()}`;
  return undefined;
}

/**
 * Whether Claude Code's folder trust on a tab's rendered `rows` is the plain one
 * for `folder`, the one a system test may answer in its own throwaway tab (the
 * rulings on #238 after #450, and on #451): undefined when it may, or what
 * makes it a screen the test leaves alone. No permission is pre-approved, the
 * folder shown is `folder` in either spelling of a macOS temp path, and the
 * pointer is on "No, exit" with "Yes, I trust this folder" below it. Shared by
 * codex-groom-run and send-outside-fleet; see test/plain-trust.test.js.
 */
export function plainTrustOf(rows, folder) {
  if (rows.some((row) => /\bpre-approves\b/.test(row))) return 'it names a pre-approved permission, and this folder should have none yet';
  const bare = folder.replace(/^\/private(?=\/)/, '');
  const spellings = new Set([folder, bare, `/private${bare}`]);
  if (!rows.some((row) => spellings.has(row.trim()))) return `it does not show this test's folder, ${folder}`;
  if (!rows.some((row) => /^\s*❯\s*No, exit\s*$/.test(row))) return 'its pointer is not on "No, exit", where down-and-return would mean "Yes, I trust this folder"';
  if (!rows.some((row) => /^\s*Yes, I trust this folder\s*$/.test(row))) return 'it has no "Yes, I trust this folder" choice';
  return undefined;
}

/**
 * Whether Claude Code's folder trust on a tab's rendered `rows` is the plain
 * one for `folder` and nothing else (the ruling on #451, comment 5961132572):
 * undefined when the test may answer it, or what makes it a screen left alone.
 * Every non-blank row from "Accessing workspace:" down is a row of the captured
 * plain screen, CLAUDE_TRUST, with `folder`, in either spelling of a macOS temp
 * path, where that screen shows its folder; and plainTrustOf holds. A row not
 * on that list is refused by name. See test/plain-trust.test.js.
 */
export function onlyPlainTrustOf(rows, folder) {
  const from = rows.findIndex((row) => /Accessing workspace:/.test(row));
  if (from < 0) return 'it has no "Accessing workspace:" row, so it is not the screen captured as the plain folder trust';
  const captured = CLAUDE_TRUST.slice(CLAUDE_TRUST.findIndex((row) => /Accessing workspace:/.test(row)));
  const capturedFolder = captured[1].trim();
  const bare = folder.replace(/^\/private(?=\/)/, '');
  const allowed = new Set([
    ...captured.map((row) => row.trim()).filter((row) => row !== '' && row !== capturedFolder),
    folder, bare, `/private${bare}`,
  ]);
  const odd = rows.slice(from).find((row) => row.trim() !== '' && !allowed.has(row.trim()));
  if (odd !== undefined) return `it carries a row the plain folder trust does not, which this test has no ruling for: ${odd.trim()}`;
  return plainTrustOf(rows, folder);
}
