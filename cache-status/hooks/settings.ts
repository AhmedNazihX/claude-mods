import type { PluginOptions } from 'claude-code'

const MS_PER_MINUTE = 60 * 1000

const TTL_CHOICES: Readonly<Record<string, number>> = {
  '5m': 5 * MS_PER_MINUTE,
  '1h': 60 * MS_PER_MINUTE,
}

const DEFAULTS = {
  ttl: '1h',
  costYellowUsd: 0.1,
  costRedUsd: 0.5,
  barSegments: 20,
} as const

const MIN_BAR_SEGMENTS = 5
const MAX_BAR_SEGMENTS = 40

export type Settings = {
  ttlMs: number
  costYellowUsd: number
  costRedUsd: number
  barSegments: number
}

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback

/**
 * The plugin's options as the band uses them: each value checked, and the
 * default standing in for one that is missing or out of range.
 */
export const toSettings = (options: PluginOptions = {}): Settings => {
  const ttl = typeof options.ttl === 'string' ? options.ttl : DEFAULTS.ttl
  const costYellowUsd = numberOr(options.costYellowUsd, DEFAULTS.costYellowUsd)
  const costRedUsd = numberOr(options.costRedUsd, DEFAULTS.costRedUsd)
  const barSegments = Math.round(
    numberOr(options.barSegments, DEFAULTS.barSegments),
  )

  return {
    ttlMs: TTL_CHOICES[ttl] ?? TTL_CHOICES[DEFAULTS.ttl] ?? 60 * MS_PER_MINUTE,
    costYellowUsd,
    costRedUsd: Math.max(costRedUsd, costYellowUsd),
    barSegments: Math.min(
      Math.max(barSegments, MIN_BAR_SEGMENTS),
      MAX_BAR_SEGMENTS,
    ),
  }
}
