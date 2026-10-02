const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const BITS_PER_CHAR = 6
const BITS_PER_BYTE = 8
const BYTE_MASK = 0xff

/**
 * Decodes base64url text to a string of its bytes, or null when it holds a
 * character outside the alphabet. Written out because the module runs with no
 * Node and no DOM, so neither `Buffer` nor `atob` can be counted on.
 */
export const decodeBase64Url = (text: string): string | null => {
  let buffer = 0
  let bits = 0
  let output = ''
  for (const char of text.replace(/=+$/, '')) {
    const value = BASE64URL_ALPHABET.indexOf(char)
    if (value === -1) return null
    buffer = (buffer << BITS_PER_CHAR) | value
    bits += BITS_PER_CHAR
    if (bits >= BITS_PER_BYTE) {
      bits -= BITS_PER_BYTE
      output += String.fromCharCode((buffer >> bits) & BYTE_MASK)
    }
  }
  return output
}

/**
 * The `role` claim of a JWT's payload, or null when the token does not
 * decode. Supabase keys are JWTs whose role says what they may do.
 */
export const jwtRoleOf = (token: string): string | null => {
  const payload = token.split('.')[1]
  if (payload === undefined) return null
  const json = decodeBase64Url(payload)
  if (json === null) return null
  try {
    const claims: unknown = JSON.parse(json)
    if (typeof claims !== 'object' || claims === null || !('role' in claims)) return null
    return typeof claims.role === 'string' ? claims.role : null
  } catch {
    return null
  }
}
