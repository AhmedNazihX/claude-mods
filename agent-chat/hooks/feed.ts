import type { AgentStatus, Subagent, TokenCounts } from '../types'

const MAX_AGENTS = 50
const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60

/**
 * The subagents' colours, one each in the order they start: distinct from
 * each other and from the green and red the pane keeps for done and stopped.
 */
export const PALETTE = ['#60a5fa', '#f472b6', '#facc15', '#a78bfa', '#22d3ee', '#fb923c', '#2dd4bf'] as const

// Control characters (ESC and kin) would reach the terminal as escape
// sequences, and a carriage return would draw over its own line; the pane
// shows model text, so all of them but the newline and tab are dropped.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g

const NAME_CHARS = 40

/** Text as the pane shows it: control characters out, blank lines collapsed, ends trimmed. */
export const cleanText = (text: string): string =>
  text
    .replace(CONTROL_CHARS, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

/** A subagent's type or given name as one printable line: the model chose it. */
export const cleanName = (name: string): string =>
  cleanText(name).replace(/\s+/g, ' ').slice(0, NAME_CHARS) || 'agent'

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

/** Adds a subagent, dropping the oldest past MAX_AGENTS. */
export const addAgent = (agents: readonly Subagent[], agent: Subagent): Subagent[] => [...agents, agent].slice(-MAX_AGENTS)

/** Its run ended: its status, when, and the report it sent back. */
export const finishAgent = (agents: readonly Subagent[], id: string, status: AgentStatus, now: number, report: string): Subagent[] =>
  agents.map(agent => (agent.id === id ? { ...agent, status, endedAt: now, report } : agent))

export const toggle = (ids: readonly string[], id: string): string[] =>
  ids.includes(id) ? ids.filter(one => one !== id) : [...ids, id]

export type Shown = { text: string; hiddenLines: number }

/**
 * The first `maxLines` lines of a markdown text, and how many are left out.
 * A cut inside a code fence closes the fence, so the rest is not drawn as code.
 */
export const firstLines = (text: string, maxLines: number): Shown => {
  const lines = text.split('\n')
  if (lines.length <= maxLines) return { text, hiddenLines: 0 }
  const kept = lines.slice(0, maxLines)
  const fences = kept.filter(line => line.trimStart().startsWith('```')).length
  return { text: [...kept, ...(fences % 2 === 1 ? ['```'] : [])].join('\n'), hiddenLines: lines.length - maxLines }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/**
 * The subagents as this version draws them. Stored state outlives a reload
 * of the mod, so it can hold what an older version kept (agents without a
 * task); those are left out, not drawn.
 */
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

// A count an older version kept as one number has no split: it is left out.
const asCounts = (value: unknown): TokenCounts | null =>
  isRecord(value)
    ? { input: count(value.input), output: count(value.output), cacheRead: count(value.cacheRead), cacheWrite: count(value.cacheWrite) }
    : null

/** A stored subagent with the stats an older version did not keep filled in. */
const withStats = (agent: Subagent): Subagent => ({
  ...agent,
  model: typeof agent.model === 'string' ? cleanText(agent.model).replace(/\s+/g, ' ') : '',
  tools: count(agent.tools),
  skills: count(agent.skills),
  agents: count(agent.agents),
  tokens: asCounts(agent.tokens),
})

export const usableAgents = (agents: readonly unknown[]): Subagent[] =>
  agents
    .filter(
    (agent): agent is Subagent =>
      isRecord(agent) &&
      typeof agent.id === 'string' &&
      typeof agent.type === 'string' &&
      typeof agent.name === 'string' &&
      typeof agent.task === 'string' &&
      (agent.report === null || typeof agent.report === 'string'),
    )
    .map(withStats)

/** Counts one call of a subagent: a tool, and a skill or a subagent it started. */
export const countTool = (agents: readonly Subagent[], id: string, tool: string): Subagent[] =>
  agents.map(agent =>
    agent.id === id
      ? { ...agent, tools: agent.tools + 1, skills: agent.skills + (tool === 'Skill' ? 1 : 0), agents: agent.agents + (tool === 'Agent' ? 1 : 0) }
      : agent,
  )

export type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

/** A run's tokens by kind. */
export const tokensOf = (usage: Usage | undefined): TokenCounts => ({
  input: count(usage?.input_tokens),
  output: count(usage?.output_tokens),
  cacheRead: count(usage?.cache_read_input_tokens),
  cacheWrite: count(usage?.cache_creation_input_tokens),
})

/** Two counts added up, kind by kind; a subagent woken again runs more than once. */
export const addTokens = (a: TokenCounts | null, b: TokenCounts): TokenCounts =>
  a === null
    ? b
    : { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite }

const totalOf = (tokens: TokenCounts): number => tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite

/** `claude-haiku-4-5-20251001` reads as `haiku 4.5`. */
export const modelName = (model: string): string =>
  model
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .replace(/-(\d+)-(\d+)$/, ' $1.$2')

/** `950`, `12.4k`, `1.2M`. */
export const formatTokens = (tokens: number): string => {
  if (tokens < 1000) return String(tokens)
  if (tokens < 1_000_000) return `${Number((tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0))}k`
  return `${Number((tokens / 1_000_000).toFixed(1))}M`
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** `12k tokens · 2k in · 400 out · 10k cache read · 0 cache write`; empty until a run ends. */
export const tokensText = (agent: Subagent): string => {
  const tokens = agent.tokens
  if (tokens === null) return ''
  return [
    `${formatTokens(totalOf(tokens))} tokens`,
    `${formatTokens(tokens.input)} in`,
    `${formatTokens(tokens.output)} out`,
    `${formatTokens(tokens.cacheRead)} cache read`,
    `${formatTokens(tokens.cacheWrite)} cache write`,
  ].join(' · ')
}

/** `haiku 4.5 · 6 tools · 1 skill · 0 agents`. */
export const statsText = (agent: Subagent): string =>
  [
    agent.model === '' ? undefined : modelName(agent.model),
    plural(agent.tools, 'tool'),
    plural(agent.skills, 'skill'),
    plural(agent.agents, 'agent'),
  ]
    .filter((part): part is string => part !== undefined)
    .join(' · ')

/** `0.4s`, `12s`, `1m 05s`. */
export const formatDuration = (ms: number): string => {
  if (ms < MS_PER_SECOND) return `${(ms / MS_PER_SECOND).toFixed(1)}s`
  const totalSeconds = Math.round(ms / MS_PER_SECOND)
  if (totalSeconds < SECONDS_PER_MINUTE) return `${totalSeconds}s`
  const seconds = String(totalSeconds % SECONDS_PER_MINUTE).padStart(2, '0')
  return `${Math.floor(totalSeconds / SECONDS_PER_MINUTE)}m ${seconds}s`
}
