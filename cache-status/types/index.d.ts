export type CacheSnapshot = {
  respondedAt: number
  readTokens: number
  writtenTokens: number
  uncachedTokens: number
  turnUsd: number | null
  sessionUsd: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'cache-status': {
      last: CacheSnapshot | null
      now: number
      costBaseline: number | null
    }
  }
}
