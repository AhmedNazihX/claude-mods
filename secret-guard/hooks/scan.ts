import { PLACEHOLDER, SECRET_PATTERNS } from './patterns'

const VISIBLE_PREFIX = 6

export type Finding = { name: string; line: number; preview: string }

type Match = Finding & { start: number; end: number }

// Files meant to hold secrets, kept out of git: `.env`, `.env.local`,
// `.env.production.local`, but not the committed `.env.example` and kin.
const SECRET_FILE = /(^|\/)\.env(\.[\w.-]+)?$/
const TEMPLATE_FILE = /\.(example|sample|template|dist)$/

export const isSecretFile = (path: string): boolean =>
  SECRET_FILE.test(path) && !TEMPLATE_FILE.test(path)

/** The secret cut to its first characters, so a message never repeats it. */
export const mask = (secret: string): string =>
  `${secret.slice(0, VISIBLE_PREFIX)}…`

const lineOf = (text: string, index: number): number =>
  text.slice(0, index).split('\n').length

const matchesOf = (text: string): Match[] =>
  SECRET_PATTERNS.flatMap(({ name, pattern, isSecret }) =>
    [...text.matchAll(new RegExp(pattern.source, pattern.flags))]
      .filter(match => !PLACEHOLDER.test(match[0]))
      .filter(match => isSecret?.(match as RegExpExecArray) ?? true)
      .map(match => {
        const start = match.index ?? 0
        return {
          name,
          line: lineOf(text, start),
          preview: mask(match[0]),
          start,
          end: start + match[0].length,
        }
      }),
  )

const overlaps = (a: Match, b: Match): boolean => a.start < b.end && b.start < a.end

/**
 * Every recognisable secret in `text`, with the line it is on and a masked
 * preview. Matches that read as placeholders or examples are skipped, and
 * where two patterns match the same text the earlier, more specific one
 * names it (an Anthropic key is not also reported as an OpenAI one).
 */
export const findSecrets = (text: string): Finding[] =>
  matchesOf(text)
    .filter((match, index, all) => !all.slice(0, index).some(earlier => overlaps(earlier, match)))
    .map(({ name, line, preview }) => ({ name, line, preview }))

export const describeFindings = (path: string, findings: Finding[]): string => {
  const list = findings
    .map(finding => `${finding.name} on line ${finding.line} (${finding.preview})`)
    .join('; ')
  return (
    `secret-guard: refused to write ${path}: it contains ${list}. ` +
    'Read the value from an environment variable instead (for example process.env.NAME), ' +
    'and keep the real value in a gitignored .env file.'
  )
}
