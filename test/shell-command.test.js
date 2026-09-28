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

import { codeOf, startsBareObk } from './helpers/shell-command.js';

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

// The review of PR #430: an unquoted heredoc (`<<EOF`, `<<-EOF`) expands `$( )`
// and backticks in its body, so the shell runs what they hold, while a quoted
// end word (`<<'EOF'`, `<<"EOF"`, `<<\EOF`) keeps the body literal. Plain text in
// either body still runs nothing.
test('what an unquoted heredoc\'s body runs through $( ) or backticks is a command; a quoted heredoc\'s body is text', () => {
  for (const [label, command] of [
    ['$( ) in a <<EOF body', 'cat <<EOF\n$(obk health)\nEOF'],
    ['backticks in a <<EOF body', 'cat <<EOF\nfleet: `obk health`\nEOF'],
    ['$( ) in a <<-EOF body', 'cat <<-EOF\n\tfleet: $(obk health --json)\n\tEOF'],
    ['$( ) in a body, with a command after the heredoc', 'cat > report.txt <<EOF\nversion $(obk --version)\nEOF\necho done'],
  ]) {
    assert.equal(startsBareObk(command), true, `${label}: ${JSON.stringify(command)}`);
  }
  for (const [label, command] of [
    ["$( ) in a <<'EOF' body", "cat <<'EOF'\n$(obk health)\nEOF"],
    ['$( ) in a <<"EOF" body', 'cat <<"EOF"\n$(obk health)\nEOF'],
    ['$( ) in a <<\\EOF body', 'cat <<\\EOF\n$(obk health)\nEOF'],
    ["backticks in a <<'EOF' body", "cat <<'EOF'\n`obk health`\nEOF"],
    ['backticks in a <<"EOF" body', 'cat <<"EOF"\n`obk health`\nEOF'],
    ['plain text in a <<EOF body', 'cat <<EOF\nobk rules build --bot target-bot\nEOF'],
    ['an escaped $( in a <<EOF body', 'cat <<EOF\n\\$(obk health)\nEOF'],
  ]) {
    assert.equal(startsBareObk(command), false, `${label}: ${JSON.stringify(command)}`);
  }
});

test('the code the path check reads holds what an unquoted heredoc runs, and not a quoted heredoc\'s text', () => {
  const machine = '/opt/homebrew/bin/obk';
  assert.ok(codeOf(`cat <<EOF\n$(${machine} health)\nEOF`).includes(machine), 'run from a <<EOF body: in the code');
  assert.ok(!codeOf(`cat <<'EOF'\n$(${machine} health)\nEOF`).includes(machine), "a <<'EOF' body: not in the code");
  assert.ok(!codeOf(`cat <<EOF\nran ${machine} health\nEOF`).includes(machine), 'plain text in a <<EOF body: not in the code');
});

// The delta review of PR #430: a substitution in an expanding heredoc's body
// can span lines, and the shell runs it whole. Checked under /bin/sh with a fake
// `obk`: the first case below ran `obk health`.
test('a $( ) or backticks that span lines of an unquoted heredoc\'s body are read whole; the same under a quoted end word are text', () => {
  const multilineDollar = 'cat <<EOF\n$(\nobk health\n)\nEOF';
  const multilineBacktick = 'cat <<EOF\n`\nobk health\n`\nEOF';
  assert.equal(startsBareObk(multilineDollar), true, `$( ) across lines: ${JSON.stringify(multilineDollar)}`);
  assert.equal(startsBareObk(multilineBacktick), true, `backticks across lines: ${JSON.stringify(multilineBacktick)}`);
  assert.equal(startsBareObk("cat <<'EOF'\n$(\nobk health\n)\nEOF"), false, "$( ) across lines under <<'EOF'");
  assert.equal(startsBareObk("cat <<'EOF'\n`\nobk health\n`\nEOF"), false, "backticks across lines under <<'EOF'");

  const machine = '/opt/homebrew/bin/obk';
  assert.ok(codeOf(`cat <<EOF\n$(\n${machine} health\n)\nEOF`).includes(machine), 'the machine\'s obk run across lines of a <<EOF body is in the code');
  assert.ok(!codeOf(`cat <<'EOF'\n$(\n${machine} health\n)\nEOF`).includes(machine), "and under <<'EOF' it is not");
});

test('a ) inside quotes within a $( ) does not end it early', () => {
  for (const [label, command] of [
    ['in an unquoted heredoc body', 'cat <<EOF\n$(echo ")"; obk health)\nEOF'],
    ['inside double quotes', 'echo "$(printf \')\'; obk health)"'],
    ['in plain code', 'x=$(echo ")"; obk health)'],
  ]) {
    assert.equal(startsBareObk(command), true, `${label}: ${JSON.stringify(command)}`);
  }
});

// The review of 46959aa: a `)` in a `#` comment inside a `$( )` ended it early
// here, and the shell ran the `obk` after it. A comment inside a substitution is
// skipped as the shell skips it. What this reading cannot follow inside a
// substitution, a `case` (its patterns end in `)`) or a heredoc (its body can
// hold one), makes it throw, so the live test fails as unreadable rather than
// passing a command it could not read. Outside a substitution neither throws.
test('a ) in a comment inside a $( ) does not end it, and $# is no comment', () => {
  const commented = 'cat <<EOF\n$(\n# 1) Read the kit version\nobk --version\n)\nEOF';
  assert.equal(startsBareObk(commented), true, `a comment with a ) in it: ${JSON.stringify(commented)}`);
  assert.equal(startsBareObk('x=$(echo $#; obk health)'), true, '$# is a parameter, not a comment');
  assert.equal(startsBareObk('x=$(echo ${#x}; obk health)'), true, '${#x} is a length, not a comment');
  assert.equal(startsBareObk('x=$(echo a#b; obk health)'), true, 'a#b is a word, not a comment');
  assert.equal(startsBareObk("cat <<'EOF'\n$(\n# 1) Read the kit version\nobk --version\n)\nEOF"), false, "the same body under <<'EOF' is text");
});

test('a case inside a substitution cannot be read here, and says so by throwing; outside one it is read', () => {
  for (const [label, command] of [
    ['a case in $( )', 'x=$(case "$1" in a) echo a;; esac; obk health)'],
    ['a case in $( ) in an unquoted heredoc body', 'cat <<EOF\n$(case y in y) obk health;; esac)\nEOF'],
    ['a case in backticks', 'x=`case y in y) obk health;; esac`'],
  ]) {
    assert.throws(() => startsBareObk(command), /can(?:no|')t be read/i, `${label}: ${JSON.stringify(command)}`);
  }
  for (const [label, command, runs] of [
    ['a case at the top', 'case "$1" in a) echo a;; esac', false],
    ['a heredoc at the top', 'cat <<EOF > f\ncase x in a) obk;; esac\nEOF', false],
    ["a case in a quoted heredoc's body", "cat <<'EOF'\n$(case y in y) obk health;; esac)\nEOF", false],
    ['a case at the top that runs obk', 'case "$1" in a) obk health;; esac', true],
  ]) {
    assert.equal(startsBareObk(command), runs, `${label}: ${JSON.stringify(command)}`);
  }
});

// Indirection: a command word held in a string. `eval` and a shell run with
// `-c` run a string this reading does not look into, so they throw, as a
// substitution it cannot follow does. `find`'s `-exec` and `-execdir` run the
// word after them, so that is a command position, as after `xargs`.
test('eval and a shell run with -c cannot be read here, and throw; find -exec runs a command word', () => {
  for (const [label, command] of [
    ['eval', 'eval "obk health"'],
    ['eval after ;', 'cd /tmp/b; eval $cmd'],
    ['sh -c', 'sh -c "obk health"'],
    ['bash -lc', 'bash -lc "obk health"'],
    ['bash -l -c', "bash -l -c 'obk health'"],
    ['zsh -c', 'zsh -c "obk health"'],
    ['dash -c', 'dash -c "obk health"'],
    ['ksh -c', 'ksh -c "obk health"'],
    ['eval in a $( ) inside double quotes', 'echo "$(eval x)"'],
  ]) {
    assert.throws(() => startsBareObk(command), /can(?:no|')t be read/i, `${label}: ${JSON.stringify(command)}`);
  }
  assert.equal(startsBareObk('find . -name bot.yaml -exec obk health \;'), true, 'find -exec');
  assert.equal(startsBareObk('find . -execdir obk health {} +'), true, 'find -execdir');
  for (const [label, command] of [
    ['eval as an argument', 'echo eval'],
    ['-c as a flag of another program', 'grep -c obk file'],
    ['a shell running a script', 'sh script.sh'],
    ['a shell running a script, with a flag that is not -c', 'bash -e run.sh'],
  ]) {
    assert.equal(startsBareObk(command), false, `${label}: ${JSON.stringify(command)}`);
  }
});

// A heredoc inside a `$( )` is Claude Code's usual way to write a commit
// message: `git commit -m "$(cat <<'EOF' … EOF )"`. So it is read, not thrown
// on: its body is skipped while the substitution's parens are counted, so a
// paren in it does not end the substitution, and the body is then text or
// code as its end word says, as a heredoc anywhere else is (#239, round 6).
test('a heredoc inside a $( ) is read: a quoted one is text, an unquoted one expands, and a paren in its body does not end the substitution', () => {
  const commit = 'git add -- a.md && git commit -m "$(cat <<\'EOF\'\ntarget-bot: rebuild (see obk rules build)\n\nobk rules build ran; in case it matters)\nClaude-Session: x\nEOF\n)" -- a.md';
  assert.equal(startsBareObk(commit), false, `Claude Code's commit form, with obk and a ) in its message: ${JSON.stringify(commit)}`);
  assert.equal(startsBareObk('echo "$(cat <<X\nhi\nX\n)"'), false, 'an unquoted heredoc of plain text in a $( ) inside double quotes');

  for (const [label, command] of [
    ['an unquoted heredoc in "$( )" that runs obk', 'git commit -m "$(cat <<EOF\nversion $(obk health)\nEOF\n)"'],
    ['a ) in a heredoc body, obk after the heredoc, still in the $( )', 'x=$(cat <<X\n)\nX\nobk health)'],
    ['a ( in a heredoc body, obk after the heredoc, still in the $( )', "x=$(cat <<'X'\nunbalanced ( here\nX\nobk health)"],
    ['a <<- heredoc with a ) in its body, obk after it', 'x=$(cat <<-X\n\ta ) here\n\tX\nobk health)'],
    ['a ) in a heredoc body, obk after it, all in "$( )"', 'echo "$(cat <<\'X\'\na ) b\nX\nobk health)"'],
  ]) {
    assert.equal(startsBareObk(command), true, `${label}: ${JSON.stringify(command)}`);
  }
  // Read as text all through: a ) that ended the substitution early would leave
  // the body's `obk rules build` line standing as a command.
  assert.equal(startsBareObk("x=$(cat <<'X'\n)\nobk rules build\nX\n)"), false, 'a quoted body with a ) and an obk line in it, in a $( )');
});
