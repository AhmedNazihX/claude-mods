import type { CallOutcome, TimelineCall, TimelineTurn } from '../types'

const MAX_CALLS = 500
const MAX_PROMPT_CHARS = 80

export const startTurn = (id: string, prompt: string, now: number): TimelineTurn => ({
  id,
  prompt: prompt.replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT_CHARS),
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
): TimelineTurn => ({
  ...turn,
  calls: turn.calls.map(call => (call.id === id ? { ...call, outcome, endedAt: now } : call)),
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

export type ToolResultLike = { deny?: unknown; isError?: unknown }

export const outcomeOf = (result: ToolResultLike): CallOutcome => {
  if (typeof result.deny === 'string') return 'denied'
  return result.isError === true ? 'error' : 'ok'
}

/** How many calls each tool made, most first: `Bash 8 · Edit 3 · Read 1`. */
export const toolCounts = (calls: readonly TimelineCall[]): [string, number][] =>
  [...calls.reduce((counts, call) => counts.set(call.tool, (counts.get(call.tool) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1])
