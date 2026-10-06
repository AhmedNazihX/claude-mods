export type AgentStatus = 'running' | 'done' | 'failed'

/** A subagent of the session: who it is, the task it was handed, and its report. */
export type Subagent = {
  id: string
  /** The agent type, or the name the Agent call gave it. */
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
  /** The task it was handed, as markdown. */
  task: string
  /** What it sent back, as markdown; null while it works. */
  report: string | null
  /** The model it runs on, as Claude Code resolved it ('' when not told). */
  model: string
  /** Its own calls so far: every tool, and of them its skills and the subagents it started. */
  tools: number
  skills: number
  agents: number
  /** The tokens its runs went through, split by kind, once a run ended. */
  tokens: TokenCounts | null
}

/** A subagent's tokens: input and output, and the cache it read and wrote. */
export type TokenCounts = { input: number; output: number; cacheRead: number; cacheWrite: number }

declare module 'claude-code' {
  interface PluginState {
    'agent-chat': {
      agents: Subagent[]
      /** The ids of the cards the person opened in full. */
      expanded: string[]
      /** The time the live timers read, moved on each second while a subagent works. */
      now: number
    }
  }
}
