import type { TimelineCall } from '../types'
import { summarize } from './summary'
import type { Places } from './summary'
import { noteOf, outcomeOf } from './timeline'

// A call can fail before it runs (a tool that is not there, input the tool
// refuses), and then no `tool.call` is raised for it. Its request and its
// result are still stored as rows, so the card reads those calls from them.

export type ToolUse = { name: string; input: Readonly<Record<string, unknown>> }
export type ToolResult = { id: string; isError: boolean; text: string }

const blocksOf = (content: unknown): Record<string, unknown>[] =>
  Array.isArray(content) ? content.filter((block): block is Record<string, unknown> => typeof block === 'object' && block !== null) : []

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** The tool calls a stored reply row asks for, by tool_use id. */
export const toolUsesOf = (content: unknown): [string, ToolUse][] =>
  blocksOf(content)
    .filter(block => block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string')
    .map(block => [block.id as string, { name: block.name as string, input: isRecord(block.input) ? block.input : {} }])

const resultText = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : blocksOf(content)
        .filter(block => block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text as string)
        .join('\n')

/** The results a stored tool-result row carries. */
export const toolResultsOf = (content: unknown): ToolResult[] =>
  blocksOf(content)
    .filter(block => block.type === 'tool_result' && typeof block.tool_use_id === 'string')
    .map(block => ({ id: block.tool_use_id as string, isError: block.is_error === true, text: resultText(block.content) }))

/** A call known only from its stored request and result: it took no time. */
export const callFromResult = (result: ToolResult, use: ToolUse, places: Places, at: number): TimelineCall => {
  const summary = summarize(use.name, use.input, places)
  const ran = { isError: result.isError, text: result.text }
  const note = noteOf(ran)
  return {
    id: result.id,
    tool: use.name,
    summary: summary.text,
    isPath: summary.isPath,
    ...(summary.description === undefined ? {} : { description: summary.description }),
    isSubagent: false,
    startedAt: at,
    endedAt: at,
    outcome: outcomeOf(ran),
    ...(note === undefined ? {} : { note }),
  }
}
