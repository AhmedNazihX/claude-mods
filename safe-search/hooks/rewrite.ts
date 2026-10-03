// The patterns git-guardrails' block-secrets hook blocks on, mirrored so a
// command is rewritten exactly when the hook would otherwise refuse it.
const RECURSIVE_GREP =
  /(^|[^A-Za-z0-9_-])[ef]?grep\s([^;&|]*\s)?(-[A-Za-z]*[rR][A-Za-z]*|--recursive|--dereference-recursive)(\s|$)/
const EXCLUDES_ENV = /--exclude(=|\s+)['"]?[^\s]*env/
const HAS_INCLUDE = /--include(=|\s+)/
const INCLUDES_ENV = /--include(=|\s+)['"]?[^\s]*env/
const HIDDEN_RG = /(^|[^A-Za-z0-9_-])rg\s([^;&|]*\s)?(-[A-Za-z]*u[A-Za-z]*|--hidden|--no-ignore[A-Za-z-]*)(\s|$)/
const RG_NEGATIVE_GLOB = /(-g|--glob)\s+['"]?!/
// A search that asks for env files by name. grep's --include and rg's
// positive globs override an exclude placed before them (the later flag
// wins), so such a command is never rewritten: the guard blocks it.
const ASKS_FOR_ENV = /--include(=|\s+)['"]?[^\s'"]*env|(-g|--glob|--iglob)(=|\s+)['"]?[^!\s'"][^\s'"]*env/i

// Every command word, so the flag lands right after each one.
const GREP_WORDS = /(^|[^A-Za-z0-9_-])([ef]?grep)(?=\s)/g
const RG_WORDS = /(^|[^A-Za-z0-9_-])(rg)(?=\s)/g

export const GREP_EXCLUDE = "--exclude='.env*'"
export const RG_EXCLUDE = "-g '!.env*'"

// A heredoc opener: `cat > f <<EOF`, `<<-'EOF'`; not a here-string (`<<<`).
const HEREDOC_OPENER = /(^|[^<])<<(-?)[ \t]*["']?([A-Za-z_][A-Za-z0-9_]*)["']?/

type Line = { text: string; isHeredocBody: boolean }

/**
 * The command's lines, each marked when it belongs to a heredoc body: file
 * content, which the hook does not check and this rewrite must not touch.
 */
export const markHeredocs = (command: string): Line[] => {
  const lines = command.split('\n')
  const marked = lines.reduce<{ out: Line[]; terminator: string | null; isDash: boolean }>(
    (acc, text) => {
      if (acc.terminator !== null) {
        const compared = acc.isDash ? text.replace(/^\t+/, '') : text
        const isEnd = compared === acc.terminator
        return { out: [...acc.out, { text, isHeredocBody: true }], terminator: isEnd ? null : acc.terminator, isDash: acc.isDash }
      }
      const opener = HEREDOC_OPENER.exec(text)
      return {
        out: [...acc.out, { text, isHeredocBody: false }],
        terminator: opener?.[3] ?? null,
        isDash: opener?.[2] === '-',
      }
    },
    { out: [], terminator: null, isDash: false },
  )
  return marked.out
}

const insertAfterEach = (text: string, words: RegExp, flag: string): string =>
  text.replace(words, (_match, before: string, name: string) => `${before}${name} ${flag}`)

// Every occurrence of the word, and how many already carry the flag after it.
const isEveryWordFlagged = (text: string, words: RegExp, flag: string): boolean => {
  const all = [...text.matchAll(words)].length
  const flagged = text.split(flag).length - 1
  return flagged >= all
}

export type Rewrite = { command: string; added: string[] }

/**
 * `command` with `--exclude='.env*'` after every grep word and `-g '!.env*'`
 * after every rg word, when the secrets hook would otherwise block it; null
 * when it would not block, so nothing changes.
 *
 * The flag goes after each word, not only the ones that look recursive: a
 * command is not split into parts here, because a quoted `|` or `;` would
 * split it wrongly and leave one recursive search unprotected while another
 * one's flag satisfied the hook. Narrowing a search that did not need it
 * costs nothing; missing one would leak .env. As a last check, a rewrite
 * that does not reach every word is dropped, and the hook blocks as before.
 */
export const rewriteSearch = (command: string): Rewrite | null => {
  const lines = markHeredocs(command)
  const checked = lines.filter(line => !line.isHeredocBody).map(line => line.text).join('\n')

  const isGrepBlocked =
    RECURSIVE_GREP.test(checked) &&
    !EXCLUDES_ENV.test(checked) &&
    !(HAS_INCLUDE.test(checked) && !INCLUDES_ENV.test(checked))
  const isRgBlocked = HIDDEN_RG.test(checked) && !RG_NEGATIVE_GLOB.test(checked)
  if (!isGrepBlocked && !isRgBlocked) return null
  if (ASKS_FOR_ENV.test(checked)) return null

  const fix = (text: string): string => {
    const withGrep = isGrepBlocked ? insertAfterEach(text, GREP_WORDS, GREP_EXCLUDE) : text
    return isRgBlocked ? insertAfterEach(withGrep, RG_WORDS, RG_EXCLUDE) : withGrep
  }
  const rewrittenLines = lines.map(line => (line.isHeredocBody ? line : { ...line, text: fix(line.text) }))
  const rewritten = rewrittenLines.map(line => line.text).join('\n')
  const rewrittenChecked = rewrittenLines.filter(line => !line.isHeredocBody).map(line => line.text).join('\n')

  const isComplete =
    (!isGrepBlocked || isEveryWordFlagged(rewrittenChecked, GREP_WORDS, GREP_EXCLUDE)) &&
    (!isRgBlocked || isEveryWordFlagged(rewrittenChecked, RG_WORDS, RG_EXCLUDE))
  if (!isComplete || rewritten === command) return null

  return {
    command: rewritten,
    added: [...(isGrepBlocked ? [GREP_EXCLUDE] : []), ...(isRgBlocked ? [RG_EXCLUDE] : [])],
  }
}
