import type { PluginOptions } from 'claude-code'

const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const DEFAULT_MIN_SECONDS = 30

const CHIMES = ['arpeggio', 'rising', 'bell', 'marimba', 'ding-dong', 'glass'] as const
export type Chime = (typeof CHIMES)[number]
const DEFAULT_CHIME: Chime = 'arpeggio'

const isChime = (value: unknown): value is Chime =>
  typeof value === 'string' && (CHIMES as readonly string[]).includes(value)

export type Settings = { minMs: number; hasSound: boolean; chime: Chime }

export const toSettings = (options: PluginOptions = {}): Settings => {
  const minSeconds =
    typeof options.minSeconds === 'number' && Number.isFinite(options.minSeconds) && options.minSeconds >= 0
      ? options.minSeconds
      : DEFAULT_MIN_SECONDS
  return {
    minMs: minSeconds * MS_PER_SECOND,
    hasSound: options.sound !== false,
    chime: isChime(options.chime) ? options.chime : DEFAULT_CHIME,
  }
}

/** `45s`, `1m 12s`, `12m`: how long a reply took, to the second. */
export const formatDuration = (ms: number): string => {
  const totalSeconds = Math.round(ms / MS_PER_SECOND)
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE)
  const seconds = totalSeconds % SECONDS_PER_MINUTE
  if (minutes === 0) return `${seconds}s`
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`
}

export type TurnEnd = {
  durationMs: number
  isAborted: boolean
  isSubagent: boolean
  reason: string
}

/**
 * Whether a finished turn is worth a chime: the main conversation's, not one
 * you interrupted yourself, and long enough that you may have looked away.
 */
export const shouldChime = (turn: TurnEnd, settings: Settings): boolean =>
  !turn.isSubagent && !turn.isAborted && turn.durationMs >= settings.minMs

export const messageFor = (turn: TurnEnd): string =>
  turn.reason === 'answer'
    ? `✅ Claude finished (${formatDuration(turn.durationMs)})`
    : `⚠️ Claude stopped: ${turn.reason} (${formatDuration(turn.durationMs)})`
