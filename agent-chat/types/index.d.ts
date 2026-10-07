export type AgentStatus = 'running' | 'done' | 'failed'

/** A subagent of the session: who it is, the task it was handed, and its report. */
export type Subagent = {
  id: string
  /** The agent type, or the name the Agent call gave it. */
  type: string
  /** As the pane names it: the type, with `#2` only when its colour came round again. */
  name: string
  /** The few words the Agent call gave its task ('' when an older version kept none). */
  description: string
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
  /**
   * Its last model request's tokens, as Claude Code's agent card counts
   * them: the whole input (new, cached and caching) plus the reply. Not a
   * sum: each request replaces it, so it reads as how big the context got.
   */
  tokens: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'agent-chat': {
      agents: Subagent[]
      /** The task and report sections opened past their first lines, as `id:task` and `id:report`. */
      expanded: string[]
      /** The cards the person opened (true) or shut (false) by hand, by subagent id. */
      cards: Record<string, boolean>
      /** The time the live timers read, moved on each second while a subagent works. */
      now: number
    }
  }
}
