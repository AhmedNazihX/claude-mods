import type { CallOutcome } from '../types'

const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const SLOW_CALL_MS = 30_000
const VERY_SLOW_CALL_MS = 120_000
const SUB_SECOND_MS = 1000

export type Tone = 'green' | 'yellow' | 'red' | 'cyan' | undefined

/** `0.4s`, `12s`, `1m 05s`: a call's length, finer when it is short. */
export const formatDuration = (ms: number): string => {
  if (ms < SUB_SECOND_MS) return `${(ms / MS_PER_SECOND).toFixed(1)}s`
  const totalSeconds = Math.round(ms / MS_PER_SECOND)
  if (totalSeconds < SECONDS_PER_MINUTE) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE)
  const seconds = String(totalSeconds % SECONDS_PER_MINUTE).padStart(2, '0')
  return `${minutes}m ${seconds}s`
}

/** `+0:03`, `+1:12`: when a call started, counted from the turn's start. */
export const formatOffset = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / MS_PER_SECOND))
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE)
  const seconds = String(totalSeconds % SECONDS_PER_MINUTE).padStart(2, '0')
  return `+${minutes}:${seconds}`
}

export const durationTone = (ms: number): Tone => {
  if (ms >= VERY_SLOW_CALL_MS) return 'red'
  if (ms >= SLOW_CALL_MS) return 'yellow'
  return undefined
}

export const OUTCOME_MARKS: Readonly<Record<CallOutcome, { mark: string; tone: Tone }>> = {
  running: { mark: '◌', tone: 'cyan' },
  ok: { mark: '✓', tone: 'green' },
  error: { mark: '✗', tone: 'red' },
  denied: { mark: '⊘', tone: 'yellow' },
}

/** Cuts `text` to `width` characters, marking the cut with an ellipsis. */
export const fit = (text: string, width: number): string =>
  width <= 0 ? '' : text.length <= width ? text : `${text.slice(0, Math.max(width - 1, 0))}…`

/** Cuts `text` to `width` from the left, so a path keeps its file name: `…/hooks/band.tsx`. */
export const fitStart = (text: string, width: number): string =>
  width <= 0 ? '' : text.length <= width ? text : `…${text.slice(text.length - Math.max(width - 1, 0))}`
