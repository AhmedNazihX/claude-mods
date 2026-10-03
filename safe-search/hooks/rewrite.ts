// The patterns git-guardrails' block-secrets hook blocks on, mirrored so a
// command is rewritten exactly when the hook would otherwise refuse it.
const RECURSIVE_GREP =
  /(^|[^A-Za-z0-9_-])[ef]?grep\s([^;&|]*\s)?(-[A-Za-z]*[rR][A-Za-z]*|--recursive|--dereference-recursive)(\s|$)/
const EXCLUDES_ENV = /--exclude(=|\s+)['"]?[^\s]*env/
const HAS_INCLUDE = /--include(=|\s+)/
const INCLUDES_ENV = /--include(=|\s+)['"]?[^\s]*env/
const HIDDEN_RG = /(^|[^A-Za-z0-9_-])rg\s([^;&|]*\s)?(-[A-Za-z]*u[A-Za-z]*|--hidden|--no-ignore[A-Za-z-]*)(\s|$)/
const RG_NEGATIVE_GLOB = /(-g|--glob)\s+['"]?!/

// The command word itself, so the flag lands right after it.
const GREP_WORD = /(^|[^A-Za-z0-9_-])([ef]?grep)(?=\s)/
const RG_WORD = /(^|[^A-Za-z0-9_-])(rg)(?=\s)/

export const GREP_EXCLUDE = "--exclude='.env*'"
export const RG_EXCLUDE = "-g '!.env*'"

// A heredoc opener: `cat > f <<EOF`, `<<-'EOF'`; not a here-string (`<<<`).
const HEREDOC_OPENER = /(^|[^<])<<(-?)[ \t]*["']?([A-Za-z_][A-Za-z0-9_]*)["']?/
// Splits a line into command segments, keeping the separators.
const SEPARATORS = /(&&|\|\||;|\|)/

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

const insertAfter = (segment: string, word: RegExp, flag: string): string =>
  segment.replace(word, (_match, before: string, name: string) => `${before}${name} ${flag}`)

const rewriteSegment = (segment: string, needs: { grep: boolean; rg: boolean }): string => {
  const withGrep =
    needs.grep && RECURSIVE_GREP.test(segment) && !EXCLUDES_ENV.test(segment)
      ? insertAfter(segment, GREP_WORD, GREP_EXCLUDE)
      : segment
  return needs.rg && HIDDEN_RG.test(withGrep) && !RG_NEGATIVE_GLOB.test(withGrep)
    ? insertAfter(withGrep, RG_WORD, RG_EXCLUDE)
    : withGrep
}

export type Rewrite = { command: string; added: string[] }

/**
 * `command` with `--exclude='.env*'` added to each recursive grep, and
 * `-g '!.env*'` to each hidden or no-ignore rg, where the secrets hook would
 * otherwise block it; null when it would not block, so nothing changes.
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

  const needs = { grep: isGrepBlocked, rg: isRgBlocked }
  const rewritten = lines
    .map(line =>
      line.isHeredocBody
        ? line.text
        : line.text
            .split(SEPARATORS)
            .map(part => (SEPARATORS.test(part) && part.length <= 2 ? part : rewriteSegment(part, needs)))
            .join(''),
    )
    .join('\n')

  return rewritten === command
    ? null
    : { command: rewritten, added: [...(isGrepBlocked ? [GREP_EXCLUDE] : []), ...(isRgBlocked ? [RG_EXCLUDE] : [])] }
}
