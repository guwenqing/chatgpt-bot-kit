// A command of the kit's, as a line the kit typed into a session names it for
// the session to run (#238: the grooming job's prompt tells the session which
// `temp retire` and `temp make` to run at each fire).
//
// The command stands in prose, so where it ends is read the way a person reads
// it: at a backtick or a newline, or at a `,`, `.`, `;`, `:` or `)` followed by
// a space or the end of the line, outside quotes. A value with one of those in
// it, such as a path, runs on. Single quotes, double quotes and a backslash are read as the
// shell reads them, so a word keeps its spaces and quotes.
//
// Each word is kept as it was written (`raw`) and as the shell would read it
// (`value`). `raw` is what a test hands a real shell to run it, after putting a
// real name in place of a placeholder with `withWord`; `value` is for finding
// the word. This is not a shell parser: `$( )`, `$VAR` and globs are left as
// written, for the shell that runs the command to deal with.

/** Where each spelling of the command starts in `text`: `cli` in any of `spellings`, then ` ${sub}`. */
function startOf(text, spellings, sub) {
  const found = spellings
    .map((spelling) => ({ at: text.indexOf(`${spelling} ${sub}`), spelling }))
    .filter((one) => one.at >= 0)
    .sort((left, right) => left.at - right.at);
  return found[0];
}

/** Where the command ends: a backtick or a newline, or punctuation followed by a space or the end. */
const endsHere = (text, at) => /[`\n]/.test(text[at])
  || (/[,.;:)]/.test(text[at]) && (at + 1 === text.length || /\s/.test(text[at + 1])));

/** The words of the command starting at `from`, up to where it ends. */
function wordsFrom(text, from) {
  const words = [];
  let at = from;
  for (;;) {
    while (text[at] === ' ' || text[at] === '\t') at += 1;
    if (at >= text.length || endsHere(text, at)) break;
    const start = at;
    let value = '';
    while (at < text.length && !/\s/.test(text[at]) && !endsHere(text, at)) {
      const here = text[at];
      if (here === '\'') {
        const close = text.indexOf('\'', at + 1);
        if (close < 0) throw new Error(`an unclosed ' in the command at ${start}: ${text.slice(start)}`);
        value += text.slice(at + 1, close);
        at = close + 1;
      } else if (here === '"') {
        at += 1;
        while (text[at] !== '"') {
          if (at >= text.length) throw new Error(`an unclosed " in the command at ${start}: ${text.slice(start)}`);
          if (text[at] === '\\' && '"\\$`'.includes(text[at + 1])) {
            value += text[at + 1];
            at += 2;
          } else {
            value += text[at];
            at += 1;
          }
        }
        at += 1;
      } else if (here === '\\') {
        value += text[at + 1] ?? '';
        at += 2;
      } else {
        value += here;
        at += 1;
      }
    }
    words.push({ value, raw: text.slice(start, at) });
  }
  return words;
}

/**
 * Every command in `text` that starts with the CLI, spelled any of `spellings`,
 * followed by `sub` (`temp make`), in the order they stand: `{ at, words }`,
 * where `words` begins with the CLI's own word. Empty when there is none.
 */
export function commandsIn(text, spellings, sub) {
  const found = [];
  let from = 0;
  for (;;) {
    const next = startOf(text.slice(from), spellings, sub);
    if (next === undefined) return found;
    const at = from + next.at;
    found.push({ at, words: wordsFrom(text, at) });
    from = at + next.spelling.length;
  }
}

/** The value given to `flag` among a command's words, as `flag value` or `flag=value`; undefined when not given. */
export function flagValue(words, flag) {
  for (let one = 0; one < words.length; one += 1) {
    if (words[one].value === flag) return words[one + 1]?.value;
    if (words[one].value.startsWith(`${flag}=`)) return words[one].value.slice(flag.length + 1);
  }
  return undefined;
}

/**
 * The command as a shell would be handed it, with the value of `flag` written
 * as `replacement`, quoted for the shell: for a placeholder the session fills
 * in when it runs the command, such as `--name groom-<YYYYMMDD-HHMM>`.
 */
export function withWord(words, flag, replacement) {
  const quoted = `'${replacement.replaceAll('\'', '\'\\\'\'')}'`;
  const out = [];
  for (let one = 0; one < words.length; one += 1) {
    if (words[one].value === flag && one + 1 < words.length) {
      out.push(words[one].raw, quoted);
      one += 1;
    } else if (words[one].value.startsWith(`${flag}=`)) {
      out.push(`${flag}=${quoted}`);
    } else {
      out.push(words[one].raw);
    }
  }
  return out.join(' ');
}
