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
// a harness at work (#391). None of these was captured: each is a
// reconstruction on the captured CLAUDE_ANSWERED or CODEX_ANSWERED, with the
// input line and what is drawn under it made up here. How the slash menu
// lays out its rows (one command a row, the command first, its description
// after it) is how both harnesses were seen to draw it by eye; the words of
// the descriptions are made up. Neither harness was seen to start a menu row
// with its pointer, and these do not.

/** Claude Code's screen down to its input box: CLAUDE_ANSWERED's header, its answered turn. */
const CLAUDE_ABOVE_INPUT = CLAUDE_ANSWERED.slice(0, 7);

/** Claude Code with `input` as its input line, and `below` drawn under the box in place of its foot row. */
const claudeWith = (input, below) => [...CLAUDE_ABOVE_INPUT, CLAUDE_INPUT_LINE[0], input, CLAUDE_INPUT_LINE[2], ...below];

/** Claude Code's slash menu row for `/clear`, its first word the command. */
const CLAUDE_CLEAR_ROW = '  /clear (reset, new)              Clear conversation history and free up context';

/** Claude Code's slash menu row for `/compact`. */
const CLAUDE_COMPACT_ROW = '  /compact                         Clear conversation history but keep a summary in context';

/** `/clear` typed into Claude Code's empty input line, its menu open under it with `/clear` first. A reconstruction. */
export const CLAUDE_CLEAR_TYPED = claudeWith('❯ /clear', [
  CLAUDE_CLEAR_ROW,
  '  /context                         Visualize current context usage',
]);

/**
 * `/clear` typed after a draft that was already in the input line, so the line
 * reads the draft and the command together; the menu under it is drawn as for
 * the command alone, so only the input line is wrong. A reconstruction.
 */
export const CLAUDE_CLEAR_AFTER_DRAFT = claudeWith('❯ fix the flaky test/clear', [CLAUDE_CLEAR_ROW]);

/**
 * `/clear` typed, and the menu's first row a command whose name only starts
 * with it, `/clear` itself second. A reconstruction: no such command was seen.
 */
export const CLAUDE_CLEAR_OTHER_FIRST = claudeWith('❯ /clear', [
  '  /clear-history                   Remove the prompt history',
  CLAUDE_CLEAR_ROW,
]);

/** `/clear` typed, and no menu at all under the input box: its foot row as when idle. A reconstruction. */
export const CLAUDE_CLEAR_NO_MENU = claudeWith('❯ /clear', [CLAUDE_INPUT_LINE[3]]);

/** `/compact` typed into Claude Code's empty input line, its menu open with `/compact` first. A reconstruction. */
export const CLAUDE_COMPACT_TYPED = claudeWith('❯ /compact', [CLAUDE_COMPACT_ROW]);

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

// Codex 0.160.0 draws its slash popup ABOVE the input line, the selected row
// with Codex's pointer, a blank row between it and the input line, and its
// status rows below (#391, live run 2). Codex's own snapshot test at tag
// rust-v0.160.0 (codex-rs/tui/src/bottom_pane/snapshots/
// codex_tui__bottom_pane__chat_composer__tests__slash_popup_res.snap) draws
// "› /resume  resume a saved chat", "", "› /res", "", "  100% context left".
// The screens below are reconstructions on that layout, on the captured
// CODEX_ANSWERED above the popup and its status row below, but for
// CODEX_NEW_BARE_INPUT, which is the live capture.

/** Codex's screen above a popup: CODEX_ANSWERED's box and its answered turn. */
const CODEX_ABOVE_POPUP = CODEX_ANSWERED.slice(0, 11);

/** Codex with the popup's `selected` row above `input`, as the snapshot draws them. */
const codexPopup = (selected, input) => [...CODEX_ABOVE_POPUP, selected, '', input, '', CODEX_STATUS[0]];

/** Codex's popup row for each command the kit types, selected; the words of /new's as seen live. */
const CODEX_ROWS = {
  '/new': '› /new  start a new chat during a conversation',
  '/compact': '› /compact  summarize conversation to prevent hitting the context limit',
};

/** `/new` typed into Codex's empty input line, its popup above with `/new` selected. A reconstruction. */
export const CODEX_NEW_TYPED = codexPopup(CODEX_ROWS['/new'], '› /new');

/**
 * `/new` typed, and the input line left bare: the popup above it shows `/new`
 * selected, and the line itself reads `›` alone. A live capture (live run 2 of
 * #391, Codex 0.160.0), partial: the rows the kit's refusal printed, its last
 * rows with the blank ones dropped, the folder as Codex shortened it. The line
 * stayed bare for 3 s.
 */
export const CODEX_NEW_BARE_INPUT = [
  '• DONE',
  '  Worked for 1m 18s • 10:33 AM',
  '› /new  start a new chat during a conversation',
  '›',
  '  GPT-6-Luna medium · /private/var/folders/…/bots/clear…',
];

/**
 * `/new` typed, and the popup's selected row above it another command. A
 * reconstruction made up to test the rule: no such screen was seen.
 */
export const CODEX_NEW_OTHER_SELECTED = codexPopup('› /model  choose what model and reasoning effort to use', '› /new');

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

/** `/compact` typed into Codex's empty input line, its popup above with `/compact` selected. A reconstruction. */
export const CODEX_COMPACT_TYPED = codexPopup(CODEX_ROWS['/compact'], '› /compact');

/**
 * `/compact` typed into a Codex that has no such command: its popup finds
 * nothing to offer, so no row of it is selected. A reconstruction.
 */
export const CODEX_COMPACT_NOT_OFFERED = [...CODEX_ABOVE_POPUP, '  no matches', '', '› /compact', '', CODEX_STATUS[0]];

/** Claude Code's menu row for each command the kit types. */
const CLAUDE_ROWS = { '/clear': CLAUDE_CLEAR_ROW, '/compact': CLAUDE_COMPACT_ROW };

/**
 * What the harness shows after each character of `command` but the last, as
 * the kit types it one character a send (#391): the typed part in the input
 * line, and the command's own menu row where the harness draws it, below the
 * input box on Claude Code and above the input line on Codex. One screen per
 * send, for the fake Orca's `nextScreens`; the screen after the last
 * character is the test's to give. Reconstructions, as above.
 */
export function whileTyping(harness, command) {
  return [...command].slice(0, -1).map((_, at) => {
    const typed = command.slice(0, at + 1);
    return harness === 'codex' ? codexPopup(CODEX_ROWS[command], `› ${typed}`) : claudeWith(`❯ ${typed}`, [CLAUDE_ROWS[command]]);
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
