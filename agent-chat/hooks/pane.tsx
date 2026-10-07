import type { ElementTable } from 'claude-code'

import type { Subagent } from '../types'
import { briefStatsText, colourOf, firstLines, formatDuration, isCardOpen, latestReport, statsText, summaryOf, tokensText } from './feed'

type Elements = Pick<ElementTable, 'Box' | 'Text' | 'Markdown' | 'Button'>

export type PaneInput = {
  agents: readonly Subagent[]
  expanded: ReadonlySet<string>
  /** The cards opened or shut by hand; the rest follow their subagent's status. */
  cards: Readonly<Record<string, boolean>>
  now: number
  columns: number
  /** Draws a ruled line between the task and the report (the terminal). */
  hasRule: boolean
  onToggle: (id: string) => void
  /** Opens a shut card or shuts an open one. */
  onToggleCard: (id: string, isOpen: boolean) => void
}

// The first lines of a task and of a report; the rest opens with a button,
// so one long report does not push every other card off the pane.
const TASK_LINES = 4
const REPORT_LINES = 6
// The most a Markdown element draws.
const MAX_MARKDOWN_CHARS = 10_000
// Border and padding on each side of a card.
const CARD_CHROME = 4
// How many lines of the report a shut card's summary runs to.
const SUMMARY_LINES = 2

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

/** The card's header: the open-or-shut button, its name, and its status. */
const renderHeader = ({ Box, Text, Button }: Elements, agent: Subagent, input: PaneInput, isOpen: boolean) => {
  const colour = colourOf(agent.colour)
  return (
    <Box justifyContent="space-between">
      <Box gap={1}>
        <Button
          key={`${agent.id}-card-toggle`}
          plain
          dimColor
          label={isOpen ? '▾' : '▸'}
          onPress={() => input.onToggleCard(agent.id, isOpen)}
        />
        <Text color={colour} bold>{`● ${agent.name}`}</Text>
      </Box>
      <Text color={STATUS[agent.status].color ?? colour}>{statusText(agent, input.now)}</Text>
    </Box>
  )
}

/** One message and its reply; `ask` and `reply` name their sections (`task` and `report` for the first). */
type Exchange = { from: string; message: string; report: string | null; ask: string; reply: string }

/** The card's conversation in order: the task and its report, then each follow-up and its reply. */
const exchangesOf = (agent: Subagent): Exchange[] => [
  { from: agent.parent, message: agent.task, report: agent.report, ask: 'task', reply: 'report' },
  ...agent.followUps.map((followUp, i) => ({ ...followUp, ask: `ask-${i + 1}`, reply: `reply-${i + 1}` })),
]

/** A part set apart from the one above: a ruled line on the terminal, spacing on a desktop. */
const renderApart = ({ Box, Text }: Elements, input: PaneInput, key: string, part: ReturnType<typeof renderSection>) => (
  <Box key={key} flexDirection="column" marginTop={input.hasRule ? 0 : 1}>
    {input.hasRule ? <Text dimColor>{'─'.repeat(Math.max(input.columns - CARD_CHROME, 4))}</Text> : null}
    {part}
  </Box>
)

/**
 * One message to the subagent and its reply. A message with no reply yet
 * says the subagent works on it, unless another came after it.
 */
const renderExchange = (elements: Elements, agent: Subagent, input: PaneInput, exchange: Exchange, index: number, isLast: boolean) => {
  const { Box, Text } = elements
  const section = (part: string, heading: string, text: string, maxLines: number) =>
    renderSection(elements, `${agent.id}-${part}`, heading, text, maxLines, input.expanded.has(`${agent.id}:${part}`), () =>
      input.onToggle(`${agent.id}:${part}`),
    )
  const ask = section(exchange.ask, `${exchange.from} asked`, exchange.message, TASK_LINES)
  const isWorking = exchange.report === null && isLast && agent.status === 'running'
  return (
    <Box key={`${agent.id}-${exchange.ask}-exchange`} flexDirection="column">
      {index === 0 ? ask : renderApart(elements, input, `${agent.id}-${exchange.ask}-apart`, ask)}
      {isWorking ? <Text color={colourOf(agent.colour)}>{'⋯ working'}</Text> : null}
      {exchange.report === null
        ? null
        : renderApart(elements, input, `${agent.id}-${exchange.reply}-apart`, section(exchange.reply, `${agent.name} replied`, exchange.report, REPORT_LINES))}
    </Box>
  )
}

/** What an open card shows under its header: stats, then the task, the follow-ups and their replies. */
const renderBody = (elements: Elements, agent: Subagent, input: PaneInput) => {
  const { Box, Text } = elements
  const exchanges = exchangesOf(agent)
  return (
    <Box flexDirection="column">
      <Text dimColor>{statsText(agent)}</Text>
      {agent.tokens === null ? null : <Text dimColor>{tokensText(agent)}</Text>}
      {exchanges.map((exchange, i) => renderExchange(elements, agent, input, exchange, i, i === exchanges.length - 1))}
    </Box>
  )
}

/**
 * What a shut card shows under its header: the task in a few words, the
 * start of its latest reply, and its tools and tokens.
 */
const renderSummary = ({ Box, Text }: Elements, agent: Subagent, input: PaneInput) => {
  const width = Math.max(input.columns - CARD_CHROME, 10)
  const summary = agent.status === 'running' ? '⋯ working' : summaryOf(latestReport(agent) ?? '', width * SUMMARY_LINES)
  return (
    <Box flexDirection="column">
      {agent.description === '' ? null : <Text>{agent.description}</Text>}
      {summary === '' ? null : <Text dimColor wrap="wrap">{summary}</Text>}
      <Text dimColor>{briefStatsText(agent)}</Text>
    </Box>
  )
}

/** One subagent's card: its header and a summary when shut, everything when open. */
const renderCard = (elements: Elements, agent: Subagent, input: PaneInput) => {
  const { Box } = elements
  const isOpen = isCardOpen(agent, input.cards)
  return (
    <Box key={agent.id} flexDirection="column" borderStyle="round" borderColor={colourOf(agent.colour)} paddingX={1} marginBottom={1}>
      {renderHeader(elements, agent, input, isOpen)}
      {isOpen ? renderBody(elements, agent, input) : renderSummary(elements, agent, input)}
    </Box>
  )
}

/**
 * The conversations between Claude and its subagents: one card per
 * subagent in the order they started, in its colour, with the task it was
 * handed and the report it sent back. A finished card shuts to its header
 * until it is opened; every card is drawn and the pane scrolls.
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
