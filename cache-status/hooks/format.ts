import type { CacheSnapshot } from '../types'
import type { Settings } from './settings'

const MS_PER_MINUTE = 60 * 1000
const MS_PER_SECOND = 1000
export const FILLED_TICK = '▰'
export const EMPTY_TICK = '▱'

const TIME_GREEN_MIN_FRACTION = 0.5
const TIME_YELLOW_MIN_FRACTION = 0.2

export type Level = 'green' | 'yellow' | 'red'

export type CacheView = {
  isWarm: boolean
  remaining: string
  timeLevel: Level
  hitPercent: number
  costLevel: Level
  read: string
  written: string
  turnCost: string | null
  sessionCost: string | null
}

export const formatTokens = (count: number): string =>
  count >= 1000 ? `${Math.round(count / 1000)}k` : String(count)

const formatRemaining = (ms: number): string =>
  ms >= MS_PER_MINUTE
    ? `${Math.ceil(ms / MS_PER_MINUTE)}m`
    : `${Math.ceil(ms / MS_PER_SECOND)}s`

export const filledTicksOf = (percent: number, segments: number): number =>
  Math.round((percent / 100) * segments)

export const toBar = (percent: number, segments: number): string => {
  const filled = filledTicksOf(percent, segments)
  return FILLED_TICK.repeat(filled) + EMPTY_TICK.repeat(segments - filled)
}

export const formatUsd = (usd: number): string =>
  usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`

/**
 * What the turn cost: the session total's growth since the last turn. A total
 * that went down was reset (`/clear`, a resume), so it counts from zero.
 */
export const turnCostOf = (
  sessionUsd: number | null,
  baseline: number | null,
): number | null => {
  if (sessionUsd === null || baseline === null) return null
  return sessionUsd < baseline ? sessionUsd : sessionUsd - baseline
}

export const costLevelOf = (usd: number | null, settings: Settings): Level => {
  if (usd === null || usd < settings.costYellowUsd) return 'green'
  if (usd < settings.costRedUsd) return 'yellow'
  return 'red'
}

export const timeLevelOf = (remainingMs: number, settings: Settings): Level => {
  const fraction = remainingMs / settings.ttlMs
  if (fraction > TIME_GREEN_MIN_FRACTION) return 'green'
  if (fraction > TIME_YELLOW_MIN_FRACTION) return 'yellow'
  return 'red'
}

export const remainingMsOf = (
  snapshot: CacheSnapshot,
  now: number,
  settings: Settings,
): number => Math.max(snapshot.respondedAt + settings.ttlMs - now, 0)

export const toView = (
  snapshot: CacheSnapshot,
  now: number,
  settings: Settings,
): CacheView => {
  const remainingMs = remainingMsOf(snapshot, now, settings)
  const total =
    snapshot.readTokens + snapshot.writtenTokens + snapshot.uncachedTokens
  const hitPercent =
    total === 0 ? 0 : Math.round((snapshot.readTokens / total) * 100)

  return {
    isWarm: remainingMs > 0,
    remaining: formatRemaining(remainingMs),
    timeLevel: timeLevelOf(remainingMs, settings),
    hitPercent,
    costLevel: costLevelOf(snapshot.turnUsd, settings),
    read: formatTokens(snapshot.readTokens),
    written: formatTokens(snapshot.writtenTokens),
    turnCost: snapshot.turnUsd === null ? null : formatUsd(snapshot.turnUsd),
    sessionCost:
      snapshot.sessionUsd === null ? null : formatUsd(snapshot.sessionUsd),
  }
}
