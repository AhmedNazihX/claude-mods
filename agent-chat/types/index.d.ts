export type AgentStatus = 'running' | 'done' | 'failed'

/** A subagent of the session, as the pane names and colours it. */
export type Subagent = {
  id: string
  /** The agent type: `Explore`, `general-purpose`. */
  type: string
  /** As the pane names it: the type, with `#2` only when its colour came round again. */
  name: string
  /** Who started it: `main`, or another subagent's name. */
  parent: string
  /** Its place in the palette: each subagent of a session gets the next colour. */
  colour: number
  status: AgentStatus
  startedAt: number
  endedAt: number | null
}

/** One message between Claude and a subagent. */
export type FeedEntry =
  | { kind: 'handoff'; key: string; agentId: string; text: string }
  | { kind: 'return'; key: string; agentId: string; status: AgentStatus; durationMs: number; text: string }

declare module 'claude-code' {
  interface PluginState {
    'agent-chat': { feed: FeedEntry[]; agents: Subagent[] }
  }
}
