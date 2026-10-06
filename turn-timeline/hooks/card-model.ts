import type { TimelineCall, TimelineTurn } from '../types'
import { fit, fitStart, formatDuration } from './format'
import { toolLabel } from './summary'

// What the terminal card and the desktop SVG card both need to know about a
// stretch of calls, so the two draw the same thing.

/** The most rows a card shows; earlier calls are counted as `… N earlier`. */
export const MAX_ROWS = 12

export const lengthOf = (call: TimelineCall): number => Math.max((call.endedAt ?? call.startedAt) - call.startedAt, 0)

export const isBad = (call: TimelineCall): boolean => call.outcome === 'denied' || call.outcome === 'error'

export const toolText = (call: TimelineCall): string => `${call.isSubagent ? '↳' : ''}${toolLabel(call.tool)}`

export type Fitted = { text: string; isDescription: boolean }

/**
 * What a row says a call did, in `chars` characters: the command when it
 * fits; else Claude's description of it, which reads better than a command
 * cut short but is a claim about the command, so it is marked to be drawn in
 * italics. A path is cut from the left, keeping its file name.
 */
export const summaryFit = (call: TimelineCall, chars: number): Fitted => {
  if (chars <= 0) return { text: '', isDescription: false }
  if (call.isPath) return { text: fitStart(call.summary, chars), isDescription: false }
  const isDescription = call.summary.length > chars && call.description !== undefined
  return { text: fit(isDescription ? (call.description ?? '') : call.summary, chars), isDescription }
}

/** How many characters the longest label of these calls needs: `Bash bun test`. */
export const longestLabel = (calls: readonly TimelineCall[]): number =>
  Math.max(0, ...calls.map(call => `${toolText(call)} ${call.summary}`.length))

/**
 * The time the calls cover, overlaps counted once: calls run in parallel,
 * or a subagent's calls inside its Agent call, do not add up.
 */
export const coveredMs = (calls: readonly TimelineCall[]): number => {
  const spans = calls
    .map(call => [call.startedAt, call.endedAt ?? call.startedAt] as const)
    .sort((a, b) => a[0] - b[0])
  const merged = spans.reduce<(readonly [number, number])[]>((acc, [start, end]) => {
    const last = acc.at(-1)
    if (last !== undefined && start <= last[1]) return [...acc.slice(0, -1), [last[0], Math.max(last[1], end)] as const]
    return [...acc, [start, end] as const]
  }, [])
  return merged.reduce((sum, [start, end]) => sum + (end - start), 0)
}

/** `4 calls · 8.9s`: the count and the time the calls covered. */
export const countText = (turn: TimelineTurn): string =>
  `${turn.calls.length} call${turn.calls.length === 1 ? '' : 's'} · ${formatDuration(coveredMs(turn.calls))}`

/** The rows a card draws (the last MAX_ROWS) and how many earlier ones it leaves out. */
export const shownCalls = (turn: TimelineTurn): { shown: TimelineCall[]; hidden: number } => {
  const shown = turn.calls.slice(-MAX_ROWS)
  return { shown, hidden: turn.calls.length - shown.length }
}

export type Noted = { call: TimelineCall; replacement: TimelineCall | undefined }

/**
 * Each denied or failed call with a reason, and the call that took its
 * place: the very next call, when it is the same tool and went fine. A call
 * in between means no guess is made.
 */
export const notedCalls = (calls: readonly TimelineCall[]): Noted[] =>
  calls
    .map((call, index) => {
      const next = calls[index + 1]
      const replacement = next !== undefined && next.tool === call.tool && next.outcome === 'ok' ? next : undefined
      return { call, replacement }
    })
    .filter(({ call }) => isBad(call) && call.note !== undefined)

/** `denied · use the trash`, or `failed · …`. */
export const reasonText = (call: TimelineCall): string => `${call.outcome === 'denied' ? 'denied' : 'failed'} · ${call.note ?? ''}`
