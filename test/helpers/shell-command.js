// What a shell command a harness ran actually runs, read from the text of the
// command (#239's live test reads its bot's commands out of Claude Code's
// transcript).
//
// Text runs nothing: what is inside quotes, a heredoc's body and a comment are
// words, not commands (seen: a commit message that said `obk rules build` at
// the start of one of its lines, taken for a command). So the command is first
// read down to its code, and only then looked through. A quoted piece with no
// space in it is kept as the word it is (`"obk" health` runs `obk`, and
// `"${OBK_CLI:-obk}"` stays the kit's word); one with a space in it is text and
// stands as one word, `_`. What `$( )` and backticks run inside double quotes is
// code, and is kept as code. So is what they run in the body of a heredoc whose
// end word is unquoted (`<<EOF`), which the shell expands; a quoted end word
// (`<<'EOF'`, `<<"EOF"`, `<<\EOF`) keeps the body literal (review of PR #430).

/** The text up to the matching `)` of a `$(` whose `(` is at `from` in `text`, and where it ends. */
function substitution(text, from) {
  let depth = 0;
  for (let end = from; end < text.length; end += 1) {
    if (text[end] === '(') depth += 1;
    else if (text[end] === ')') {
      depth -= 1;
      if (depth === 0) return { body: text.slice(from + 1, end), end: end + 1 };
    }
  }
  return { body: text.slice(from + 1), end: text.length };
}

/** The code the `$( )` and backticks in a piece of expanded text run, each set apart by `;`. A `\` keeps the next character literal. */
function substitutionsIn(text) {
  let code = '';
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] === '\\') {
      at += 1;
    } else if (text.startsWith('$(', at)) {
      const inner = substitution(text, at + 1);
      code += `;${codeOf(inner.body)};`;
      at = inner.end - 1;
    } else if (text[at] === '`') {
      const close = text.indexOf('`', at + 1);
      const stop = close < 0 ? text.length : close;
      code += `;${codeOf(text.slice(at + 1, stop))};`;
      at = stop;
    }
  }
  return code;
}

/** The code of a shell command: quoted text, literal heredoc bodies and comments taken out, as above. */
export function codeOf(command) {
  let out = '';
  let at = 0;
  const heredocs = [];

  /** A quoted piece as it stands in the code: the word itself, or `_` for text. */
  const word = (text) => (/\s/.test(text) ? '_' : text);

  while (at < command.length) {
    const here = command[at];

    if (here === '\\') {
      out += command.slice(at, at + 2);
      at += 2;
      continue;
    }

    if (here === '\'') {
      const end = command.indexOf('\'', at + 1);
      const stop = end < 0 ? command.length : end;
      out += word(command.slice(at + 1, stop));
      at = stop + 1;
      continue;
    }

    if (here === '"') {
      let text = '';
      let code = '';
      let end = at + 1;
      while (end < command.length && command[end] !== '"') {
        if (command[end] === '\\') {
          text += command.slice(end, end + 2);
          end += 2;
        } else if (command.startsWith('$(', end)) {
          const inner = substitution(command, end + 1);
          code += `;${codeOf(inner.body)};`;
          text += 'x';
          end = inner.end;
        } else if (command[end] === '`') {
          const close = command.indexOf('`', end + 1);
          const stop = close < 0 ? command.length : close;
          code += `;${codeOf(command.slice(end + 1, stop))};`;
          text += 'x';
          end = stop + 1;
        } else {
          text += command[end];
          end += 1;
        }
      }
      out += word(text) + code;
      at = end + 1;
      continue;
    }

    if (here === '#' && (at === 0 || /\s/.test(command[at - 1]))) {
      while (at < command.length && command[at] !== '\n') at += 1;
      continue;
    }

    if (command.startsWith('<<', at) && command[at + 2] !== '<') {
      const found = /^<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|([^\s;&|<>()]+))/.exec(command.slice(at));
      if (found !== null) {
        const bare = found[4];
        heredocs.push({
          strip: found[1] === '-',
          end: bare === undefined ? found[2] ?? found[3] : bare.replaceAll('\\', ''),
          expands: bare !== undefined && !bare.includes('\\'),
        });
        out += ' ';
        at += found[0].length;
        continue;
      }
    }

    if (here === '\n' && heredocs.length > 0) {
      out += '\n';
      at += 1;
      // Each heredoc's body, in the order they were opened, up to its end word:
      // text, but for what an expanding one runs through `$( )` and backticks.
      for (const { strip, end, expands } of heredocs.splice(0)) {
        while (at < command.length) {
          const next = command.indexOf('\n', at);
          const line = command.slice(at, next < 0 ? command.length : next);
          at = next < 0 ? command.length : next + 1;
          if ((strip ? line.replace(/^\t+/, '') : line) === end) break;
          if (expands) out += substitutionsIn(line);
        }
      }
      continue;
    }

    out += here;
    at += 1;
  }
  return out;
}

/**
 * A command word: at the start, or after a newline, `;`, `&`, `|`, `(`, `{` or
 * a backtick, past any variables set for it and the words that start a command
 * of their own.
 */
const BARE_OBK = /(?:^|[\n;&|(`{])[ \t]*(?:(?:!|then|do|else|elif|if|while|until|time|exec|command|env|sudo|nohup|xargs)[ \t]+|[A-Za-z_][A-Za-z0-9_]*=\S*[ \t]+)*obk(?=[\s;&|)`}]|$)/;

/** Whether a shell command runs a bare `obk` where a command word stands: not `"${OBK_CLI:-obk}"`, and not in text. */
export const startsBareObk = (command) => BARE_OBK.test(codeOf(command));
