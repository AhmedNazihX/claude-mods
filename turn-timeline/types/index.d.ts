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
  /** Claude's own words for what the call does, shown when the command is too long to read. */
  description?: string
  /** Why a call was denied or failed, one line; absent when it went fine. */
  note?: string
}

export type TimelineTurn = {
  id: string
  startedAt: number
  endedAt: number | null
  calls: TimelineCall[]
}

declare module 'claude-code' {
  interface PluginState {
    'turn-timeline': {
      /** A finished turn's card, keyed by the id of the reply text it sits above. */
      card: StateFamily<TimelineTurn | null>
    }
  }
}
