const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const SLOW_CALL_MS = 30_000
const VERY_SLOW_CALL_MS = 120_000
const SUB_SECOND_MS = 1000

export type Tone = 'green' | 'yellow' | 'red' | undefined

/** `0.4s`, `12s`, `1m 05s`: a call's length, finer when it is short. */
export const formatDuration = (ms: number): string => {
  if (ms < SUB_SECOND_MS) return `${(ms / MS_PER_SECOND).toFixed(1)}s`
  const totalSeconds = Math.round(ms / MS_PER_SECOND)
  if (totalSeconds < SECONDS_PER_MINUTE) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE)
  const seconds = String(totalSeconds % SECONDS_PER_MINUTE).padStart(2, '0')
  return `${minutes}m ${seconds}s`
}

export const durationTone = (ms: number): Tone => {
  if (ms >= VERY_SLOW_CALL_MS) return 'red'
  if (ms >= SLOW_CALL_MS) return 'yellow'
  return undefined
}

/** Cuts `text` to `width` characters, marking the cut with an ellipsis. */
export const fit = (text: string, width: number): string =>
  width <= 0 ? '' : text.length <= width ? text : `${text.slice(0, Math.max(width - 1, 0))}…`

/** Cuts `text` to `width` from the left, so a path keeps its file name: `…/hooks/band.tsx`. */
export const fitStart = (text: string, width: number): string =>
  width <= 0 ? '' : text.length <= width ? text : `…${text.slice(text.length - Math.max(width - 1, 0))}`

export type Span = { before: number; length: number; after: number }

/**
 * The calls laid end to end on a bar `width` cells wide, as the card draws
 * them: each takes a share of the cells by its length (at least one), and
 * the next starts where it ends, so idle time and overlaps leave no gaps.
 */
export const sequentialSpans = (lengthsMs: readonly number[], width: number): Span[] => {
  if (width <= 0 || lengthsMs.length === 0) return lengthsMs.map(() => ({ before: 0, length: 0, after: 0 }))
  const total = lengthsMs.reduce((sum, ms) => sum + Math.max(ms, 0), 0)
  const cells = lengthsMs.map(ms => (total === 0 ? 1 : Math.max(1, Math.round((Math.max(ms, 0) / total) * width))))
  // Rounding can miss the width by a few cells: the longest call absorbs it.
  const longest = cells.indexOf(Math.max(...cells))
  const fitted = cells.map((count, index) =>
    index === longest ? Math.max(1, count + width - cells.reduce((sum, c) => sum + c, 0)) : count,
  )
  return fitted.reduce<Span[]>((spans, length) => {
    const last = spans.at(-1)
    const before = last === undefined ? 0 : last.before + last.length
    const shown = Math.max(Math.min(length, width - before), 0)
    return [...spans, { before: Math.min(before, width), length: shown, after: Math.max(width - before - shown, 0) }]
  }, [])
}
