// The patterns git-guardrails' block-secrets hook blocks on, mirrored so a
// command is rewritten exactly when the hook would otherwise refuse it.
const RECURSIVE_GREP =
  /(^|[^A-Za-z0-9_-])[ef]?grep[ \t]([^;&|]*[ \t])?(-[A-Za-z]*[rR][A-Za-z]*|--recursive|--dereference-recursive)([ \t]|$)/
const EXCLUDES_ENV = /--exclude(=|[ \t]+)['"]?[^ \t]*env/
const HAS_INCLUDE = /--include(=|[ \t]+)/
const INCLUDES_ENV = /--include(=|[ \t]+)['"]?[^ \t]*env/
const HIDDEN_RG = /(^|[^A-Za-z0-9_-])rg[ \t]([^;&|]*[ \t])?(-[A-Za-z]*u[A-Za-z]*|--hidden|--no-ignore[A-Za-z-]*)([ \t]|$)/
const RG_NEGATIVE_GLOB = /(-g|--glob)[ \t]+['"]?!/
// A search that asks for env files by name. grep's --include and rg's
// positive globs override an exclude placed before them (the later flag
// wins), so such a command is never rewritten: the guard blocks it.
const ASKS_FOR_ENV = /--include(=|[ \t]+)['"]?[^ \t'"]*env|(-g|--glob|--iglob)(=|[ \t]+)['"]?[^! \t'"][^ \t'"]*env/i

// Shell the rewrite does not try to read: more than one line (heredocs,
// continuations), command substitution, eval. A command holding any of
// these is left to the guard, unchanged.
const UNREADABLE = /[\n\r`]|\$\(|<<|(^|[^A-Za-z0-9_-])eval([ \t]|$)/

const GREP_WORDS = /(^|[^A-Za-z0-9_-])([ef]?grep)(?=[ \t])/g
// Every "grep" in the command, flaggable or not (rgrep, ggrep, zgrep, …).
const ANY_GREP = /grep/g
const RG_WORDS = /(^|[^A-Za-z0-9_-])(rg)(?=[ \t])/g

export const GREP_EXCLUDE = "--exclude='.env*'"
export const RG_EXCLUDE = "-g '!.env*'"

/**
 * Whether each position of `text` is inside quotes, as the shell reads it:
 * single quotes take everything literally, double quotes honour a backslash.
 */
export const quotedPositions = (text: string): boolean[] => {
  const state = [...text].reduce<{ quote: "'" | '"' | null; isEscaped: boolean; marks: boolean[] }>(
    (acc, char) => {
      const isQuoted = acc.quote !== null
      if (acc.isEscaped) return { ...acc, isEscaped: false, marks: [...acc.marks, isQuoted] }
      if (char === '\\' && acc.quote !== "'") return { ...acc, isEscaped: true, marks: [...acc.marks, isQuoted] }
      if (acc.quote === null && (char === "'" || char === '"')) return { ...acc, quote: char, marks: [...acc.marks, true] }
      if (acc.quote === char) return { ...acc, quote: null, marks: [...acc.marks, true] }
      return { ...acc, marks: [...acc.marks, isQuoted] }
    },
    { quote: null, isEscaped: false, marks: [] },
  )
  return state.marks
}

/** Whether every match of `words` starts outside quotes. */
const isEveryWordUnquoted = (text: string, words: RegExp, quoted: readonly boolean[]): boolean =>
  [...text.matchAll(words)].every(match => {
    const wordStart = (match.index ?? 0) + (match[1]?.length ?? 0)
    return quoted[wordStart] !== true
  })

const insertAfterEach = (text: string, words: RegExp, flag: string): string =>
  text.replace(words, (_match, before: string, name: string) => `${before}${name} ${flag}`)

export type Rewrite = { command: string; added: string[] }

/**
 * `command` with `--exclude='.env*'` after every grep word and `-g '!.env*'`
 * after every rg word, when the secrets hook would otherwise block it; null
 * when it would not block, or when the command is not one this can read
 * with certainty, so the hook blocks it as before.
 *
 * Certainty here means: one line, no substitution or eval, and every search
 * word outside quotes. Inside quotes (`sh -c 'grep -r …'`) the inserted
 * flag's own quotes would end the user's, and the shell would expand
 * `.env*` into file names that grep then reads. The flag goes after every
 * search word, not only recursive ones, so no part of a chain is missed.
 */
export const rewriteSearch = (command: string): Rewrite | null => {
  const isGrepBlocked =
    RECURSIVE_GREP.test(command) &&
    !EXCLUDES_ENV.test(command) &&
    !(HAS_INCLUDE.test(command) && !INCLUDES_ENV.test(command))
  const isRgBlocked = HIDDEN_RG.test(command) && !RG_NEGATIVE_GLOB.test(command)
  if (!isGrepBlocked && !isRgBlocked) return null
  if (ASKS_FOR_ENV.test(command) || UNREADABLE.test(command)) return null

  // A grep-family word this can't flag (rgrep, ggrep, zgrep …) would be left
  // reading .env while a plain grep's flag satisfied the guard.
  if ([...command.matchAll(ANY_GREP)].length !== [...command.matchAll(GREP_WORDS)].length) return null

  const quoted = quotedPositions(command)
  if (!isEveryWordUnquoted(command, GREP_WORDS, quoted) || !isEveryWordUnquoted(command, RG_WORDS, quoted)) return null

  const withGrep = isGrepBlocked ? insertAfterEach(command, GREP_WORDS, GREP_EXCLUDE) : command
  const rewritten = isRgBlocked ? insertAfterEach(withGrep, RG_WORDS, RG_EXCLUDE) : withGrep
  if (rewritten === command) return null

  return {
    command: rewritten,
    added: [...(isGrepBlocked ? [GREP_EXCLUDE] : []), ...(isRgBlocked ? [RG_EXCLUDE] : [])],
  }
}
