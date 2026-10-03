import type { PluginOptions } from 'claude-code'

const DEFAULT_COLUMNS = 60
const MIN_COLUMNS = 30
const MAX_COLUMNS = 120
const DEFAULT_ROWS = 12
const MIN_ROWS = 5
const MAX_ROWS = 40

export type Settings = { isAutoOpen: boolean; columns: number; rows: number }

const wholeIn = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Math.max(Math.round(value), min), max)
    : fallback

/** The plugin's options, each checked, a missing or bad one at its default. */
export const toSettings = (options: PluginOptions = {}): Settings => ({
  isAutoOpen: options.autoOpen !== false,
  columns: wholeIn(options.paneColumns, MIN_COLUMNS, MAX_COLUMNS, DEFAULT_COLUMNS),
  rows: wholeIn(options.paneRows, MIN_ROWS, MAX_ROWS, DEFAULT_ROWS),
})
