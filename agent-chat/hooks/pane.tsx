import type { ElementTable } from 'claude-code'

import type { Subagent } from '../types'
import { colourOf, firstLines, formatDuration, statsText, tokensText } from './feed'

type Elements = Pick<ElementTable, 'Box' | 'Text' | 'Markdown' | 'Button'>

export type PaneInput = {
  agents: readonly Subagent[]
  expanded: ReadonlySet<string>
  now: number
  columns: number
  /** Draws a ruled line between the task and the report (the terminal). */
  hasRule: boolean
  onToggle: (id: string) => void
}

// The first lines of a task and of a report; the rest opens with a button,
// so one long report does not push every other card off the pane.
const TASK_LINES = 4
const REPORT_LINES = 6
// The most a Markdown element draws.
const MAX_MARKDOWN_CHARS = 10_000
// Border and padding on each side of a card.
const CARD_CHROME = 4

const STATUS = {
  running: { word: 'working', color: undefined },
  done: { word: 'done', color: 'green' },
  failed: { word: 'stopped', color: 'red' },
} as const

const statusText = (agent: Subagent, now: number): string =>
  `${STATUS[agent.status].word} · ${formatDuration((agent.endedAt ?? now) - agent.startedAt)}`

/** A block of markdown under a dim heading, its first lines unless opened in full. */
const renderSection = (
  { Box, Text, Markdown, Button }: Elements,
  key: string,
  heading: string,
  text: string,
  maxLines: number,
  isOpen: boolean,
  onToggle: () => void,
) => {
  const whole = text.slice(0, MAX_MARKDOWN_CHARS) || '(no text)'
  const shown = isOpen ? { text: whole, hiddenLines: 0 } : firstLines(whole, maxLines)
  const canToggle = isOpen || shown.hiddenLines > 0
  return (
    <Box key={key} flexDirection="column">
      <Text dimColor>{heading}</Text>
      <Box paddingLeft={2} flexDirection="column">
        <Markdown text={shown.text} />
      </Box>
      {canToggle ? (
        <Box paddingLeft={2}>
          <Button
            key={`${key}-toggle`}
            plain
            dimColor
            label={isOpen ? '▴ show less' : `▾ show ${shown.hiddenLines} more line${shown.hiddenLines === 1 ? '' : 's'}`}
            onPress={onToggle}
          />
        </Box>
      ) : null}
    </Box>
  )
}

const renderCard = (elements: Elements, agent: Subagent, input: PaneInput) => {
  const { Box, Text } = elements
  const colour = colourOf(agent.colour)
  const status = STATUS[agent.status]
  const toggle = (part: string) => () => input.onToggle(`${agent.id}:${part}`)
  const isOpen = (part: string) => input.expanded.has(`${agent.id}:${part}`)

  return (
    <Box key={agent.id} flexDirection="column" borderStyle="round" borderColor={colour} paddingX={1} marginBottom={1}>
      <Box justifyContent="space-between">
        <Text color={colour} bold>{`● ${agent.name}`}</Text>
        <Text color={status.color ?? colour}>{statusText(agent, input.now)}</Text>
      </Box>
      <Text dimColor>{statsText(agent)}</Text>
      {agent.tokens === null ? null : <Text dimColor>{tokensText(agent)}</Text>}
      {renderSection(elements, `${agent.id}-task`, `${agent.parent} asked`, agent.task, TASK_LINES, isOpen('task'), toggle('task'))}
      {agent.report === null ? (
        <Text color={colour}>{'⋯ working'}</Text>
      ) : (
        <Box flexDirection="column" marginTop={input.hasRule ? 0 : 1}>
          {input.hasRule ? <Text dimColor>{'─'.repeat(Math.max(input.columns - CARD_CHROME, 4))}</Text> : null}
          {renderSection(elements, `${agent.id}-report`, `${agent.name} replied`, agent.report, REPORT_LINES, isOpen('report'), toggle('report'))}
        </Box>
      )}
    </Box>
  )
}

/**
 * The conversations between Claude and its subagents: one card per
 * subagent in the order they started, in its colour, with the task it was
 * handed and the report it sent back. Every card is drawn; the pane scrolls.
 */
export const renderPane = (elements: Elements, input: PaneInput) => {
  const { Box, Text } = elements
  if (input.agents.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>No subagents yet. When Claude hands one a task, their conversation shows up here.</Text>
      </Box>
    )
  }
  const running = input.agents.filter(agent => agent.status === 'running').length
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text dimColor>{`${running} working · ${input.agents.length - running} finished`}</Text>
      </Box>
      {input.agents.map(agent => renderCard(elements, agent, input))}
    </Box>
  )
}
