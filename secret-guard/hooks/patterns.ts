import { jwtRoleOf } from './jwt'

export type SecretPattern = {
  name: string
  pattern: RegExp
  /** A further check on a match: false lets it pass (a public key, a local URL). */
  isSecret?: (match: RegExpExecArray) => boolean
}

const LOCAL_HOSTS = /@(localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal)[:/]/
const PASSWORD_PLACEHOLDER = /^(\$\{.*\}|\[.*\]|<.*>|\*+|password|postgres|pass)$/i

/**
 * Formats that are a live credential on sight: each has a prefix or shape
 * distinctive enough that a match is very unlikely to be anything else.
 * Order matters where prefixes nest (Anthropic's `sk-ant-` and OpenRouter's
 * `sk-or-` before OpenAI's `sk-`), and an `sk-` key starts its own token, so
 * the `sk-` inside a kebab-case name such as `task-list-item-…` is not one.
 */
export const SECRET_PATTERNS: readonly SecretPattern[] = [
  { name: 'private key', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g },
  { name: 'Anthropic API key', pattern: /(?<![\w-])sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'OpenRouter API key', pattern: /(?<![\w-])sk-or-(?:v1-)?[A-Za-z0-9]{32,}/g },
  { name: 'OpenAI API key', pattern: /(?<![\w-])sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/g },
  { name: 'Stripe secret key', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { name: 'Supabase secret key', pattern: /\bsb_secret_[A-Za-z0-9_-]{16,}/g },
  {
    name: 'Supabase service_role key',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    isSecret: match => jwtRoleOf(match[0]) === 'service_role',
  },
  { name: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g },
  { name: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  {
    name: 'database password in a connection URL',
    pattern: /\bpostgres(?:ql)?:\/\/[^:\s/@]+:([^@\s]+)@[^\s'"`]+/g,
    isSecret: match =>
      !LOCAL_HOSTS.test(match[0]) && !PASSWORD_PLACEHOLDER.test(match[1] ?? ''),
  },
]

/** Text that marks a match as a documented example, not a real credential. */
export const PLACEHOLDER = /x{6,}|EXAMPLE|your[_-]?(?:api[_-]?)?key|<[^>]*>|\.\.\./i
