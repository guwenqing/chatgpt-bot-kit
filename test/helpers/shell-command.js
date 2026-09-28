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
// stands as one word, `_`. What `$( )` and backticks run is code, wherever they
// stand: in the command, inside double quotes, and in the body of a heredoc
// whose end word is unquoted (`<<EOF`), which the shell expands; a quoted end
// word (`<<'EOF'`, `<<"EOF"`, `<<\EOF`) keeps the body literal (review of PR
// #430). Such a body is read whole, since a substitution in it can span lines.
// A `#` that starts a word starts a comment, inside a substitution as well as
// outside one, so a `)` in a comment does not close a `$( )`; `$#`, `${#x}` and
// `a#b` are not comments.
//
// A heredoc inside a `$( )` is read too, since it is Claude Code's usual way to
// write a commit message (`git commit -m "$(cat <<'EOF' … EOF )"`): while the
// substitution's parens are counted its body is skipped, so a paren in it does
// not end the substitution, and the body is then text or code as its end word
// says, as anywhere else.
//
// It is not a shell parser, and where it cannot follow the shell it says so
// rather than guess (review of 46959aa): a `case` inside a `$( )` or backtick
// substitution makes `codeOf`, and so `startsBareObk`, throw an Error that
// names it and the command. A `case` pattern's `)` would close the substitution
// early here, and a command after it would be missed. A caller that meets the
// Error has a command it cannot judge, which is not a command that runs no
// `obk`. Outside a substitution a `case` is read, its pattern's `)` as a place a
// command word can follow. `eval` and a shell run with `-c` (`sh`, `bash`, `zsh`,
// `dash`, `ksh`, flags before it included, as in `bash -lc`) run a string this
// does not look into, so at a command position they throw the same way. `find`'s
// `-exec` and `-execdir` run the word after them, so that is a command position,
// as after `xargs`.
//
// What text cannot judge, this does not claim to: a command word held in a
// variable (`c=obk; $c health`), a script file the bot writes and then runs,
// and a function or alias defined in an earlier command. Where #239's live test
// relies on this, its other checks stand beside it: the rebuilt AGENTS.md has to
// name the checkout's CLI, and the machine's obk has to be as it was.

/** Whether a `#` at `at` in `text` starts a word, and so a comment. */
const startsWord = (text, at) => at === 0 || /[\s;&|(]/.test(text[at - 1]);

/**
 * The heredoc that opens at `at` in `text`, as `{ length, strip, end, expands }`,
 * or undefined when no heredoc opens there: `<<` (not `<<<`), an optional `-`,
 * and an end word, whose quoting says whether the body expands.
 */
function heredocAt(text, at) {
  if (!text.startsWith('<<', at) || text[at + 2] === '<' || text[at - 1] === '<') return undefined;
  const found = /^<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|([^\s;&|<>()]+))/.exec(text.slice(at));
  if (found === null) return undefined;
  const bare = found[4];
  return {
    length: found[0].length,
    strip: found[1] === '-',
    end: bare === undefined ? found[2] ?? found[3] : bare.replaceAll('\\', ''),
    expands: bare !== undefined && !bare.includes('\\'),
  };
}

/**
 * The bodies of the heredocs opened on the line that ends at the newline at
 * `at`, read off in order: `{ bodies, after }`, each body as its lines and
 * `after` where the text goes on past the last end-word line.
 */
function heredocBodies(text, at, opened) {
  let next = at + 1;
  const bodies = opened.map(({ strip, end }) => {
    const lines = [];
    while (next < text.length) {
      const stop = text.indexOf('\n', next);
      const line = text.slice(next, stop < 0 ? text.length : stop);
      next = stop < 0 ? text.length : stop + 1;
      if ((strip ? line.replace(/^\t+/, '') : line) === end) break;
      lines.push(line);
    }
    return lines;
  });
  return { bodies, after: next };
}

/** An Error for a construct this reading cannot follow. */
const unreadable = (what) => Object.assign(new Error(`${what} cannot be read here`), { unreadable: true });

/**
 * The text up to the matching `)` of a `$(` whose `(` is at `from` in `text`,
 * and where it ends. A paren inside quotes, after a `\`, or in a comment is not
 * counted.
 */
function substitution(text, from) {
  let depth = 0;
  const opened = [];
  for (let end = from; end < text.length; end += 1) {
    const heredoc = heredocAt(text, end);
    if (heredoc !== undefined) {
      opened.push(heredoc);
      end += heredoc.length - 1;
    } else if (text[end] === '\n' && opened.length > 0) {
      end = heredocBodies(text, end, opened.splice(0)).after - 1;
    } else if (text[end] === '\\') {
      end += 1;
    } else if (text[end] === '\'') {
      const close = text.indexOf('\'', end + 1);
      end = close < 0 ? text.length : close;
    } else if (text[end] === '"') {
      let close = end + 1;
      while (close < text.length && text[close] !== '"') close += text[close] === '\\' ? 2 : 1;
      end = close;
    } else if (text[end] === '#' && startsWord(text, end)) {
      const close = text.indexOf('\n', end);
      end = close < 0 ? text.length : close - 1;
    } else if (text[end] === '(') depth += 1;
    else if (text[end] === ')') {
      depth -= 1;
      if (depth === 0) return { body: text.slice(from + 1, end), end: end + 1 };
    }
  }
  return { body: text.slice(from + 1), end: text.length };
}

/** The text of a backtick substitution whose opening backtick is at `from`, and where it ends: at the first backtick not after a `\`. */
function backticks(text, from) {
  for (let end = from + 1; end < text.length; end += 1) {
    if (text[end] === '\\') end += 1;
    else if (text[end] === '`') return { body: text.slice(from + 1, end), end: end + 1 };
  }
  return { body: text.slice(from + 1), end: text.length };
}

/**
 * The code a substitution's body runs, set apart by `;` so its first word
 * stands where a command word does. Throws on what cannot be followed in it: a
 * `case`, outside quotes, comments and heredoc bodies.
 */
function substituted(body) {
  const opened = [];
  for (let at = 0; at < body.length; at += 1) {
    const here = body[at];
    const heredoc = heredocAt(body, at);
    if (heredoc !== undefined) {
      opened.push(heredoc);
      at += heredoc.length - 1;
    } else if (here === '\n' && opened.length > 0) {
      at = heredocBodies(body, at, opened.splice(0)).after - 1;
    } else if (here === '\\') {
      at += 1;
    } else if (here === '\'') {
      const close = body.indexOf('\'', at + 1);
      at = close < 0 ? body.length : close;
    } else if (here === '"') {
      let close = at + 1;
      while (close < body.length && body[close] !== '"') close += body[close] === '\\' ? 2 : 1;
      at = close;
    } else if (here === '#' && startsWord(body, at)) {
      const close = body.indexOf('\n', at);
      at = close < 0 ? body.length : close - 1;
    } else if (body.startsWith('case', at) && startsWord(body, at) && /\s/.test(body[at + 4] ?? '')) {
      throw unreadable('a `case` inside a command substitution');
    }
  }
  return `;${read(body)};`;
}

/** The code the `$( )` and backticks in a piece of expanded text run. A `\` keeps the next character literal. */
function substitutionsIn(text) {
  let code = '';
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] === '\\') {
      at += 1;
    } else if (text.startsWith('$(', at)) {
      const inner = substitution(text, at + 1);
      code += substituted(inner.body);
      at = inner.end - 1;
    } else if (text[at] === '`') {
      const inner = backticks(text, at);
      code += substituted(inner.body);
      at = inner.end - 1;
    }
  }
  return code;
}

/** The code of a shell command, as the header says. */
function read(command) {
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
          code += substituted(inner.body);
          text += 'x';
          end = inner.end;
        } else if (command[end] === '`') {
          const inner = backticks(command, end);
          code += substituted(inner.body);
          text += 'x';
          end = inner.end;
        } else {
          text += command[end];
          end += 1;
        }
      }
      out += word(text) + code;
      at = end + 1;
      continue;
    }

    if (command.startsWith('$(', at)) {
      const inner = substitution(command, at + 1);
      out += substituted(inner.body);
      at = inner.end;
      continue;
    }

    if (here === '`') {
      const inner = backticks(command, at);
      out += substituted(inner.body);
      at = inner.end;
      continue;
    }

    if (here === '#' && startsWord(command, at)) {
      while (at < command.length && command[at] !== '\n') at += 1;
      continue;
    }

    const heredoc = heredocAt(command, at);
    if (heredoc !== undefined) {
      heredocs.push(heredoc);
      out += ' ';
      at += heredoc.length;
      continue;
    }

    if (here === '\n' && heredocs.length > 0) {
      out += '\n';
      // Each heredoc's body, in the order they were opened, up to its end word:
      // text, but for what an expanding one runs through `$( )` and backticks,
      // read over the whole body at once, since one can span lines.
      const opened = heredocs.splice(0);
      const { bodies, after } = heredocBodies(command, at, opened);
      opened.forEach(({ expands }, one) => {
        if (expands) out += substitutionsIn(bodies[one].join('\n'));
      });
      at = after;
      continue;
    }

    out += here;
    at += 1;
  }
  return out;
}

/**
 * The code of a shell command: quoted text, literal heredoc bodies and comments
 * taken out, as the header says. Throws, naming the command, on what cannot be
 * read.
 */
export function codeOf(command) {
  try {
    const code = read(command);
    if (EVAL.test(code)) throw unreadable('`eval`');
    if (SHELL_C.test(code)) throw unreadable('a shell run with -c');
    return code;
  } catch (error) {
    if (error.unreadable !== true) throw error;
    throw new Error(`${error.message}, so whether this command runs obk is not known: ${JSON.stringify(command)}`);
  }
}

/**
 * Where a command word stands: at the start, or after a newline, `;`, `&`,
 * `|`, `(`, `)` (a `case` pattern's), `{`, a backtick, or `find`'s `-exec` or
 * `-execdir`, past any variables set for it and the words that start a command
 * of their own.
 */
const COMMAND_AT = String.raw`(?:^|[\n;&|()\`{]|\s-exec(?:dir)?(?=\s))[ \t]*(?:(?:!|then|do|else|elif|if|while|until|time|exec|command|env|sudo|nohup|xargs)[ \t]+|[A-Za-z_][A-Za-z0-9_]*=\S*[ \t]+)*`;

/** A bare `obk` as a command word. */
const BARE_OBK = new RegExp(`${COMMAND_AT}obk(?=[\\s;&|)\`}]|$)`);

/** `eval` as a command word. */
const EVAL = new RegExp(`${COMMAND_AT}eval(?=\\s|$)`);

/** A shell as a command word, run with `-c`, flags before it included. */
const SHELL_C = new RegExp(`${COMMAND_AT}(?:ba|z|da|k)?sh(?:[ \\t]+--?[A-Za-z-]+)*?[ \\t]+-[A-Za-z]*c[A-Za-z]*(?=\\s|$)`);

/** Whether a shell command runs a bare `obk` where a command word stands: not `"${OBK_CLI:-obk}"`, and not in text. Throws, as `codeOf` does. */
export const startsBareObk = (command) => BARE_OBK.test(codeOf(command));
