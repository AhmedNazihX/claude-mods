import type { CallOutcome, TimelineCall, TimelineTurn } from '../types'
import { printable } from './summary'

const MAX_CALLS = 500

export const startTurn = (id: string, now: number): TimelineTurn => ({
  id,
  startedAt: now,
  endedAt: null,
  calls: [],
})

export const addCall = (turn: TimelineTurn, call: TimelineCall): TimelineTurn => ({
  ...turn,
  calls: [...turn.calls, call].slice(-MAX_CALLS),
})

export const finishCall = (
  turn: TimelineTurn,
  id: string,
  outcome: CallOutcome,
  now: number,
  note?: string,
): TimelineTurn => ({
  ...turn,
  calls: turn.calls.map(call =>
    call.id === id ? { ...call, outcome, endedAt: now, ...(note === undefined ? {} : { note }) } : call,
  ),
})

/**
 * Ends the turn; a call still marked running when the turn ends (the reply
 * was interrupted mid-call) is closed as an error at the same moment.
 */
export const endTurn = (turn: TimelineTurn, now: number): TimelineTurn => ({
  ...turn,
  endedAt: now,
  calls: turn.calls.map(call =>
    call.outcome === 'running' ? { ...call, outcome: 'error', endedAt: now } : call,
  ),
})

export type ToolResultLike = { deny?: unknown; isError?: unknown; text?: unknown }

// A call a settings hook blocked, or the person refused at the permission
// prompt, comes back as an error; its text says which. An OS error such as
// `EACCES: permission denied` is a failure, not a refusal, so the wording
// matched is the hook's and the prompt's own.
const REFUSED = [/hook error:/i, /^\s*BLOCKED\b/i, /doesn't want to proceed/i]

export const outcomeOf = (result: ToolResultLike): CallOutcome => {
  if (typeof result.deny === 'string') return 'denied'
  if (result.isError !== true) return 'ok'
  const text = typeof result.text === 'string' ? result.text : ''
  return REFUSED.some(pattern => pattern.test(text)) ? 'denied' : 'error'
}

const MAX_REASON_CHARS = 60

/**
 * Why a call was denied or failed, cut to its gist for the card's note:
 * the first line, without a hook's `PreToolUse:Bash hook error: [path]:`
 * and `BLOCKED:` prefixes or the quoted command the row already shows,
 * up to the end of its first sentence.
 */
export const noteOf = (result: ToolResultLike): string | undefined => {
  const reason = typeof result.deny === 'string' ? result.deny : result.isError === true ? result.text : undefined
  if (typeof reason !== 'string') return undefined
  const firstLine = reason.split('\n').map(printable).find(line => line !== '')
  if (firstLine === undefined) return undefined
  const stripped = firstLine
    .replace(/^.*?hook error: \[[^\]]*\]:\s*/i, '')
    .replace(/^BLOCKED:\s*/i, '')
    .replace(/^(['"`]).*?\1\s*/, '')
  const gist = (stripped.split(/(?<=\.)\s/)[0] ?? '').replace(/\.$/, '').trim()
  return (gist === '' ? firstLine : gist).slice(0, MAX_REASON_CHARS)
}
