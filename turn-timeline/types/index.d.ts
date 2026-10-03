export type CallOutcome = 'running' | 'ok' | 'error' | 'denied'

export type TimelineCall = {
  id: string
  tool: string
  summary: string
  isPath: boolean
  isSubagent: boolean
  startedAt: number
  endedAt: number | null
  outcome: CallOutcome
}

export type TimelineTurn = {
  id: string
  prompt: string
  startedAt: number
  endedAt: number | null
  calls: TimelineCall[]
}

declare module 'claude-code' {
  interface PluginState {
    'turn-timeline': { turn: TimelineTurn | null; now: number }
  }
}
