import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { decodeBase64Url, jwtRoleOf } from './jwt'
import { findSecrets, isSecretFile, mask } from './scan'

// Fake credentials in each format, assembled at run time so this file itself
// holds no string a scanner would take for a real key.
const fake = (...parts: string[]) => parts.join('')
const BODY = 'Q7vLm2Rt9WkXz4Hp8NcYb3Jf6Ds1Ga5E'
const ANTHROPIC = fake('sk-', 'ant-', 'api03-', BODY)
const OPENROUTER = fake('sk-', 'or-', 'v1-', 'a3f9'.repeat(16))
const STRIPE = fake('sk_', 'live_', BODY)
const GITHUB = fake('gh', 'p_', BODY, 'abcd')
const AWS = fake('AK', 'IA', 'Q7VLM2RT9WKXZ4HP')
const SUPABASE_SECRET = fake('sb_', 'secret_', BODY)
const PRIVATE_KEY = fake('-----BEGIN ', 'RSA PRIVATE KEY-----')
const DB_URL = fake('postgresql://', 'postgres:', 'Vq8Lm2Rt9Wk', '@db.abcdefgh.supabase.co:5432/postgres')

const base64Url = (text: string) =>
  btoaPolyfill(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const btoaPolyfill = (text: string) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < text.length; i += 3) {
    const [a = 0, b = 0, c = 0] = [0, 1, 2].map(o => text.charCodeAt(i + o) || 0)
    const n = (a << 16) | (b << 8) | c
    out += [18, 12, 6, 0].map(s => alphabet[(n >> s) & 63]).join('')
  }
  const pad = text.length % 3
  return pad === 0 ? out : out.slice(0, out.length - (3 - pad)) + '='.repeat(3 - pad)
}
const jwt = (role: string) =>
  [base64Url('{"alg":"HS256","typ":"JWT"}'), base64Url(`{"iss":"supabase","role":"${role}","iat":1700000000}`), 'c2lnbmF0dXJlLXNpZ25hdHVyZQ'].join('.')

const namesIn = (text: string) => findSecrets(text).map(finding => finding.name)

describe('finding secrets', () => {
  test('recognises each format', () => {
    expect(namesIn(`const key = "${ANTHROPIC}"`)).toEqual(['Anthropic API key'])
    expect(namesIn(`OPENROUTER_API_KEY="${OPENROUTER}"`)).toEqual(['OpenRouter API key'])
    expect(namesIn(`stripe(${JSON.stringify(STRIPE)})`)).toEqual(['Stripe secret key'])
    expect(namesIn(`token: ${GITHUB}`)).toEqual(['GitHub token'])
    expect(namesIn(`aws_access_key_id = ${AWS}`)).toEqual(['AWS access key'])
    expect(namesIn(`SUPABASE_KEY=${SUPABASE_SECRET}`)).toEqual(['Supabase secret key'])
    expect(namesIn(`${PRIVATE_KEY}\nMIIE...`)).toEqual(['private key'])
    expect(namesIn(`DATABASE_URL="${DB_URL}"`)).toEqual(['database password in a connection URL'])
  })

  test("flags Supabase's service_role key but not the public anon key", () => {
    expect(namesIn(`createClient(url, "${jwt('service_role')}")`)).toEqual(['Supabase service_role key'])
    expect(namesIn(`createClient(url, "${jwt('anon')}")`)).toEqual([])
  })

  test('reports the line and never the whole secret', () => {
    const [finding] = findSecrets(`line one\nline two\nconst k = "${ANTHROPIC}"`)
    expect(finding?.line).toBe(3)
    expect(finding?.preview).toBe(mask(ANTHROPIC))
    expect(finding?.preview).not.toContain(BODY)
  })

  test('lets ordinary code, env lookups and placeholders through', () => {
    expect(findSecrets('const key = process.env.ANTHROPIC_API_KEY')).toEqual([])
    expect(findSecrets(`export const STRIPE_KEY = "${fake('sk_', 'live_', 'x'.repeat(24))}"`)).toEqual([])
    expect(findSecrets(`aws_access_key_id = ${fake('AK', 'IA', 'IOSFODNN7', 'EXAMPLE')}`)).toEqual([])
    expect(findSecrets('postgresql://postgres:postgres@localhost:54322/postgres')).toEqual([])
    expect(findSecrets('postgresql://postgres:[YOUR-PASSWORD]@db.x.supabase.co:5432/postgres')).toEqual([])
    expect(findSecrets('const id = "eyJhbGciOiJIUzI1NiJ9 is a header"')).toEqual([])
  })
})

describe('secret files', () => {
  test('.env and its local variants may hold secrets', () => {
    expect(isSecretFile('/app/.env')).toBe(true)
    expect(isSecretFile('/app/.env.local')).toBe(true)
    expect(isSecretFile('/app/.env.production.local')).toBe(true)
  })

  test('committed templates and ordinary files may not', () => {
    expect(isSecretFile('/app/.env.example')).toBe(false)
    expect(isSecretFile('/app/.env.sample')).toBe(false)
    expect(isSecretFile('/app/src/env.ts')).toBe(false)
    expect(isSecretFile('/app/config/.environment.ts')).toBe(false)
  })
})

describe('JWT decoding', () => {
  test('reads the role claim', () => {
    expect(jwtRoleOf(jwt('service_role'))).toBe('service_role')
    expect(jwtRoleOf('not.a.jwt')).toBeNull()
    expect(decodeBase64Url('aGk')).toBe('hi')
    expect(decodeBase64Url('a$b')).toBeNull()
  })
})

// The engine beneath the guard: a write that reaches it succeeds. Returns
// the lines logged, as they arrive.
const engineBeneath = (on: On) => {
  const logged: string[] = []
  on('tool.call', () => ({ result: { type: 'create' }, text: 'written', isError: false }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.log', ($, e) => {
    logged.push(e.text)
    return { value: undefined } as never
  })
  return logged
}

const write = ($: Engine, file_path: string, content: string) =>
  $.tool.call({ tool: 'Write', file_path, content } as never)

describe('the guard', () => {
  test('blocks a Write that holds a secret and tells Claude why', async ($, on) => {
    engineBeneath(on)
    const result = JSON.stringify(await write($, '/app/src/client.ts', `const key = "${ANTHROPIC}"`))
    expect(result).not.toContain('written')
    expect(result).toContain('Anthropic API key on line 1')
    expect(result).toContain('environment variable')
    expect(result).not.toContain(BODY)
  })

  test('blocks an Edit that adds a secret', async ($, on) => {
    engineBeneath(on)
    const result = JSON.stringify(await $.tool.call({ tool: 'Edit', file_path: '/app/db.ts', old_string: 'url', new_string: DB_URL } as never))
    expect(result).not.toContain('written')
    expect(result).toContain('database password')
  })

  test('lets clean writes and .env files through', async ($, on) => {
    engineBeneath(on)
    expect(await write($, '/app/src/client.ts', 'const key = process.env.KEY')).toMatchObject({ text: 'written' })
    expect(await write($, '/app/.env.local', `ANTHROPIC_API_KEY=${ANTHROPIC}`)).toMatchObject({ text: 'written' })
  })

  test('in warn mode lets the write through', { options: { mode: 'warn' } }, async ($, on) => {
    engineBeneath(on)
    expect(await write($, '/app/src/client.ts', `const key = "${ANTHROPIC}"`)).toMatchObject({ text: 'written' })
  })

  // Content that is not text makes the scan throw, standing in for any bug in it.
  test('refuses a write it could not scan, and logs why', async ($, on) => {
    const logged = engineBeneath(on)
    const result = JSON.stringify(await write($, '/app/src/client.ts', null as never))
    expect(result).not.toContain('written')
    expect(result).toContain('could not be scanned for secrets')
    expect(logged.some(line => line.includes('could not scan /app/src/client.ts'))).toBe(true)
  })

  test('in warn mode lets a write it could not scan through', { options: { mode: 'warn' } }, async ($, on) => {
    engineBeneath(on)
    expect(await write($, '/app/src/client.ts', null as never)).toMatchObject({ text: 'written' })
  })
})
