import type { Meters } from '../types'
import type { Level } from './format'

const CONTEXT_GREEN_MAX_SHARE = 0.75
const CONTEXT_YELLOW_MAX_SHARE = 0.9
const LIMIT_GREEN_MAX_PERCENT = 60
const LIMIT_YELLOW_MAX_PERCENT = 85
const FULL_PERCENT = 100

const LIMIT_LABELS: Readonly<Record<string, string>> = {
  five_hour: '5h',
  seven_day: 'week',
  spend_limit: 'spend',
}

export type LimitView = { label: string; percent: number; level: Level }

export type MetersView = {
  context: { percent: number; compactAt: number | null; level: Level } | null
  limits: LimitView[]
}

/**
 * How near the context is to being compacted: its fill as a share of the
 * auto-compact point (or of the whole window when auto-compact is off).
 */
export const contextLevelOf = (percent: number, compactAt: number | null): Level => {
  const share = percent / (compactAt ?? FULL_PERCENT)
  if (share < CONTEXT_GREEN_MAX_SHARE) return 'green'
  if (share < CONTEXT_YELLOW_MAX_SHARE) return 'yellow'
  return 'red'
}

export const limitLevelOf = (percent: number): Level => {
  if (percent < LIMIT_GREEN_MAX_PERCENT) return 'green'
  if (percent < LIMIT_YELLOW_MAX_PERCENT) return 'yellow'
  return 'red'
}

export const limitLabelOf = (kind: string): string => LIMIT_LABELS[kind] ?? kind

/**
 * The auto-compact point as a percentage of the window, or null when
 * auto-compact is off or the figures are missing.
 */
export const compactAtPercentOf = (
  threshold: number | undefined,
  window: number,
): number | null =>
  threshold === undefined || window <= 0
    ? null
    : Math.round((threshold / window) * FULL_PERCENT)

export const toMetersView = (meters: Meters): MetersView => ({
  context:
    meters.contextPercent === null
      ? null
      : {
          percent: meters.contextPercent,
          compactAt: meters.compactAtPercent,
          level: contextLevelOf(meters.contextPercent, meters.compactAtPercent),
        },
  limits: meters.rateLimits.map(limit => ({
    label: limitLabelOf(limit.kind),
    percent: limit.percentUsed,
    level: limitLevelOf(limit.percentUsed),
  })),
})

export const hasMeters = (view: MetersView): boolean =>
  view.context !== null || view.limits.length > 0
