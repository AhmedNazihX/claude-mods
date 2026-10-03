export type CacheSnapshot = {
  respondedAt: number
  readTokens: number
  writtenTokens: number
  uncachedTokens: number
  turnUsd: number | null
  sessionUsd: number | null
}

export type RateLimitReading = { kind: string; percentUsed: number; resetsAt?: string }

export type Meters = {
  contextPercent: number | null
  compactAtPercent: number | null
  rateLimits: RateLimitReading[]
}

declare module 'claude-code' {
  interface PluginState {
    'cache-status': {
      last: CacheSnapshot | null
      now: number
      costBaseline: number | null
      meters: Meters
    }
  }
}
