import type { ElementTable } from 'claude-code'

import type { Subagent, FeedEntry } from '../types'
import { colourOf, formatDuration } from './feed'

type Elements = Pick<ElementTable, 'Box' | 'Text'>

export type PaneInput = { feed: readonly FeedEntry[]; agents: readonly Subagent[]; columns: number }

// The first lines of a message; the rest is counted, so one long report
// does not push every other message off the pane.
const MAX_BODY_LINES = 6
const INDENT = '  '

/** One row of the pane, in its parts and their colours. */
type Part = { text: string; color?: string; dim?: boolean; bold?: boolean }
type Row = { key: string; parts: Part[] }


/** Breaks `text` into lines of at most `width` characters, at spaces where it can. */
export const wrap = (text: string, width: number): string[] =>
  text.split('\n').flatMap(paragraph => {
    if (paragraph.trim() === '') return ['']
    const lines: string[] = []
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const pieces = word.length > width ? (word.match(new RegExp(`.{1,${width}}`, 'g')) ?? [word]) : [word]
      for (const piece of pieces) {
        if (line === '') line = piece
        else if (line.length + 1 + piece.length <= width) line = `${line} ${piece}`
        else {
          lines.push(line)
          line = piece
        }
      }
    }
    return [...lines, line]
  })

const bodyRows = (key: string, text: string, width: number, dim: boolean): Row[] => {
  const lines = wrap(text === '' ? '(no text)' : text, Math.max(width - INDENT.length, 10))
  const shown = lines.slice(0, MAX_BODY_LINES)
  const more = lines.length - shown.length
  return [
    ...shown.map((line, index) => ({ key: `${key}-${index}`, parts: [{ text: `${INDENT}${line}`, dim }] })),
    ...(more > 0 ? [{ key: `${key}-more`, parts: [{ text: `${INDENT}… ${more} more line${more === 1 ? '' : 's'}`, dim: true }] }] : []),
  ]
}

const entryRows = (entry: FeedEntry, agent: Subagent | undefined, width: number, isLastOfAgent: boolean): Row[] => {
  // Each subagent keeps its colour, dot and name, so its messages read as one voice.
  const name: Part = { text: `● ${agent?.name ?? 'agent'}`, color: colourOf(agent?.colour ?? 0), bold: true }
  const parent: Part = { text: agent?.parent ?? 'main', dim: true }
  if (entry.kind === 'handoff') {
    const working = agent?.status === 'running' && isLastOfAgent
    return [
      { key: `${entry.key}-h`, parts: [parent, { text: ' → ', dim: true }, name] },
      ...bodyRows(entry.key, entry.text, width, true),
      ...(working ? [{ key: `${entry.key}-w`, parts: [{ text: `${INDENT}⋯ working`, color: 'cyan' }] }] : []),
      { key: `${entry.key}-gap`, parts: [{ text: '' }] },
    ]
  }
  const isDone = entry.status === 'done'
  return [
    {
      key: `${entry.key}-h`,
      parts: [
        name,
        { text: ' → ', dim: true },
        parent,
        { text: `   ${isDone ? 'done' : 'stopped'}`, color: isDone ? 'green' : 'red' },
        { text: ` · ${formatDuration(entry.durationMs)}`, dim: true },
      ],
    },
    ...bodyRows(entry.key, entry.text, width, false),
    { key: `${entry.key}-gap`, parts: [{ text: '' }] },
  ]
}

/**
 * The messages between Claude and its subagents, newest at the bottom:
 * each task Claude handed over and each report sent back, under the
 * subagent's coloured name. Every message is drawn; the pane scrolls over
 * them and follows the newest while the person stays at the bottom.
 */
export const renderPane = ({ Box, Text }: Elements, { feed, agents, columns }: PaneInput) => {
  if (agents.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>No subagents yet. When Claude hands one a task, their messages show up here.</Text>
      </Box>
    )
  }
  const byId = new Map(agents.map(agent => [agent.id, agent]))
  const lastOfAgent = new Map(feed.map(entry => [entry.agentId, entry.key]))
  const all = feed.flatMap(entry => entryRows(entry, byId.get(entry.agentId), columns, lastOfAgent.get(entry.agentId) === entry.key))
  const running = agents.filter(agent => agent.status === 'running').length

  return (
    <Box flexDirection="column">
      <Text dimColor>{`${running} running · ${agents.length - running} finished`}</Text>
      <Text>{''}</Text>
      {all.map(row => (
        <Box key={row.key}>
          <Text wrap="truncate">
            {row.parts.map((part, index) => (
              <Text key={`${row.key}-${index}`} color={part.color} dimColor={part.dim} bold={part.bold}>
                {part.text}
              </Text>
            ))}
          </Text>
        </Box>
      ))}
    </Box>
  )
}
