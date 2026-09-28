// The reading of a shell command that #239's live test makes of what its bot
// ran (test/helpers/shell-command.js): whether the command runs a bare `obk`,
// the machine's, rather than the kit that launched the tab.
//
// Seen in that test's second live run: the bot committed its work with a
// multi-line `git commit -m "…"` whose message said `obk rules build …` at the
// start of a line, and the reading took that text for a command. Text inside
// quotes, or in a heredoc, runs nothing. A real bare `obk` has to be caught
// wherever a command word stands.

import assert from 'node:assert/strict';
import test from 'node:test';

import { startsBareObk } from './helpers/shell-command.js';

/** The command from the live run, with the session link cut down: `obk` only in the message's text. */
const LIVE_COMMIT = 'cd /private/var/folders/s5/x/T/obk-system-skill-cli-3GiLZ7 && git add -- bots/target-bot/bot.yaml bots/target-bot/AGENTS.md'
  + ' && git commit -m "target-bot: add kit:tests-first to its rules and rebuild AGENTS.md\n\nbot.yaml\'s rules list was edited by hand to add kit:tests-first;'
  + '\nobk rules build --bot target-bot then built AGENTS.md (12 units).\n\nClaude-Session: https://claude.ai/code/session_x"'
  + ' -- bots/target-bot/bot.yaml bots/target-bot/AGENTS.md; echo "exit=$?"; git log --stat --oneline -1; git status --short';

test('text that runs nothing is no bare obk: quoted strings, heredoc bodies, comments and the kit word', () => {
  for (const [label, command] of [
    ['the live run\'s commit, obk at the start of a line of its quoted message', LIVE_COMMIT],
    ['the kit word, quoted', '"${OBK_CLI:-obk}" rules build --bots /tmp/b --bot target-bot'],
    ['the kit\'s variable', '"$OBK_CLI" rules build --bots /tmp/b --bot target-bot 2>&1; echo "exit=$?"'],
    ['the kit word, unquoted', '${OBK_CLI:-obk} health --bots /tmp/b'],
    ['a single-quoted message', "git commit -m 'ran obk health\nobk roster'"],
    ['an echo of the words', 'echo "obk health"'],
    ['a heredoc body', 'cat > notes.txt <<EOF\nobk health --bots /tmp/b\nEOF'],
    ['a quoted heredoc body', "cat <<'EOF' > notes.txt\nobk health\nEOF\necho done"],
    ['a heredoc with <<-', 'cat <<-EOF\n\tobk health\n\tEOF'],
    ['a comment', 'ls # then obk health'],
    ['the word as an argument', 'which obk; grep -n obk AGENTS.md'],
    ['a longer name', 'ls .claude/skills/obk-bot-building && obkx --help'],
    ['the machine\'s obk by path, which the other check is for', '/opt/homebrew/bin/obk health'],
  ]) {
    assert.equal(startsBareObk(command), false, `${label}: ${JSON.stringify(command)}`);
  }
});

test('a bare obk is caught wherever a command word stands', () => {
  for (const [label, command] of [
    ['at the start', 'obk health --bots /tmp/b'],
    ['after &&', 'cd /tmp/b && obk rules build --bot target-bot'],
    ['after ||', 'false || obk up'],
    ['after ;', 'ls; obk roster'],
    ['after a pipe', 'echo y | obk retire --bot x'],
    ['in a subshell', '(obk health)'],
    ['in backticks', 'echo `obk --version`'],
    ['in $( )', 'out=$(obk health --json)'],
    ['in $( ) inside double quotes', 'echo "fleet: $(obk health)"'],
    ['in backticks inside double quotes', 'echo "fleet: `obk health`"'],
    ['at the start of a line of a multi-line command', 'cd /tmp/b\nobk up --bots /tmp/b'],
    ['after a variable set for it', 'FOO=1 obk up'],
    ['after then', 'if true; then obk up; fi'],
    ['in braces', '{ obk health; }'],
    ['quoted as a whole word', '"obk" health'],
    ['after a heredoc ends', 'cat <<EOF > f\ntext\nEOF\nobk up'],
    ['after a quoted message ends', 'git commit -m "said obk\nthere" && obk up'],
  ]) {
    assert.equal(startsBareObk(command), true, `${label}: ${JSON.stringify(command)}`);
  }
});
