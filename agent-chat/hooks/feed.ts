import type { Subagent, AgentStatus, FeedEntry } from '../types'

const MAX_ENTRIES = 200
const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60

/**
 * The subagents' colours, one each in the order they start: distinct from
 * each other and from the green and red the pane keeps for done and stopped.
 */
export const PALETTE = ['#60a5fa', '#f472b6', '#facc15', '#a78bfa', '#22d3ee', '#fb923c', '#2dd4bf'] as const

// Control characters (ESC and kin) would reach the terminal as escape
// sequences; the pane shows model text, so they are dropped first.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g

/** Text as the pane shows it: control characters out, blank lines collapsed, ends trimmed. */
export const cleanText = (text: string): string =>
  text
    .replace(CONTROL_CHARS, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

export const colourOf = (colour: number): string => PALETTE[colour % PALETTE.length] ?? PALETTE[0]

/**
 * A subagent's name: its type, told apart from others of the type by its
 * colour. Only past the palette, when a colour comes round again, does one
 * of the same type and colour get a number (`Explore #2`).
 */
export const nameFor = (agents: readonly Subagent[], type: string, colour: number): string => {
  const same = agents.filter(agent => agent.type === type && agent.colour % PALETTE.length === colour % PALETTE.length).length
  return same === 0 ? type : `${type} #${same + 1}`
}

export const addAgent = (agents: readonly Subagent[], agent: Subagent): Subagent[] => [...agents, agent]

export const endAgent = (agents: readonly Subagent[], id: string, status: AgentStatus, now: number): Subagent[] =>
  agents.map(agent => (agent.id === id ? { ...agent, status, endedAt: now } : agent))

/** Adds a message, dropping the oldest past MAX_ENTRIES. */
export const appendEntry = (feed: readonly FeedEntry[], entry: FeedEntry): FeedEntry[] => [...feed, entry].slice(-MAX_ENTRIES)

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/**
 * The messages and subagents as this version draws them. Stored state
 * outlives a reload of the mod, so it can hold what an older version kept
 * (tool lines, agents without a name); those are left out, not drawn.
 */
export const usableFeed = (feed: readonly unknown[]): FeedEntry[] =>
  feed.filter(
    (entry): entry is FeedEntry =>
      isRecord(entry) &&
      (entry.kind === 'handoff' || entry.kind === 'return') &&
      typeof entry.key === 'string' &&
      typeof entry.agentId === 'string' &&
      typeof entry.text === 'string',
  )

export const usableAgents = (agents: readonly unknown[]): Subagent[] =>
  agents.filter(
    (agent): agent is Subagent =>
      isRecord(agent) && typeof agent.id === 'string' && typeof agent.type === 'string' && typeof agent.name === 'string',
  )

/** `0.4s`, `12s`, `1m 05s`. */
export const formatDuration = (ms: number): string => {
  if (ms < MS_PER_SECOND) return `${(ms / MS_PER_SECOND).toFixed(1)}s`
  const totalSeconds = Math.round(ms / MS_PER_SECOND)
  if (totalSeconds < SECONDS_PER_MINUTE) return `${totalSeconds}s`
  const seconds = String(totalSeconds % SECONDS_PER_MINUTE).padStart(2, '0')
  return `${Math.floor(totalSeconds / SECONDS_PER_MINUTE)}m ${seconds}s`
}
