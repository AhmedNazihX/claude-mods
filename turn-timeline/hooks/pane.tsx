import type { ElementTable } from 'claude-code'

import type { TimelineCall, TimelineTurn } from '../types'
import { OUTCOME_MARKS, durationTone, fit, formatDuration, formatOffset } from './format'
import { toolLabel } from './summary'
import { toolCounts } from './timeline'

type Elements = Pick<ElementTable, 'Box' | 'Text'>

const TOOL_COLUMN = 10
const DURATION_COLUMN = 7
const FIXED_COLUMNS = 2 + 6 + 1 + DURATION_COLUMN + 1 + TOOL_COLUMN + 1
const CHROME_ROWS = 5
const MIN_ROWS = 3

export type PaneInput = {
  turn: TimelineTurn | null
  now: number
  columns: number
  rows: number
}

const renderCall = ({ Box, Text }: Elements, call: TimelineCall, turn: TimelineTurn, input: PaneInput) => {
  const { mark, tone } = OUTCOME_MARKS[call.outcome]
  const lengthMs = (call.endedAt ?? input.now) - call.startedAt
  const label = `${call.isSubagent ? '↳' : ''}${toolLabel(call.tool)}`
  const summaryWidth = input.columns - FIXED_COLUMNS

  return (
    <Box key={call.id}>
      <Text color={tone}>{`${mark} `}</Text>
      <Text dimColor>{`${formatOffset(call.startedAt - turn.startedAt).padStart(6)} `}</Text>
      <Text color={durationTone(lengthMs)} dimColor={call.outcome === 'running'}>
        {`${formatDuration(lengthMs).padStart(DURATION_COLUMN)} `}
      </Text>
      <Text bold={!call.isSubagent} dimColor={call.isSubagent}>
        {`${fit(label, TOOL_COLUMN).padEnd(TOOL_COLUMN)} `}
      </Text>
      <Text dimColor>{fit(call.summary, summaryWidth)}</Text>
    </Box>
  )
}

/**
 * The pane: the turn's prompt and running time, one row per tool call
 * (outcome, start offset, length, tool, what it did), newest at the bottom
 * and the oldest scrolled off when the pane is short, then a count per tool.
 */
export const renderPane = (elements: Elements, input: PaneInput) => {
  const { Box, Text } = elements
  const { turn } = input

  if (turn === null) {
    return (
      <Box flexDirection="column">
        <Text dimColor>No reply yet. Each tool call of the next reply shows up here as it runs.</Text>
      </Box>
    )
  }

  const isRunning = turn.endedAt === null
  const elapsed = formatDuration((turn.endedAt ?? input.now) - turn.startedAt)
  const room = Math.max(MIN_ROWS, input.rows - CHROME_ROWS)
  const shown = turn.calls.slice(-room)
  const hidden = turn.calls.length - shown.length
  const counts = toolCounts(turn.calls)
    .map(([tool, count]) => `${toolLabel(tool)} ${count}`)
    .join(' · ')

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={isRunning ? 'cyan' : 'green'}>{isRunning ? '◌ running ' : '✓ done '}</Text>
        <Text>{`${turn.calls.length} call${turn.calls.length === 1 ? '' : 's'} · ${elapsed}`}</Text>
      </Box>
      <Text dimColor>{fit(`“${turn.prompt}”`, input.columns)}</Text>
      {hidden > 0 ? <Text dimColor>{`  … ${hidden} earlier`}</Text> : null}
      {shown.length === 0 ? <Text dimColor>No tool calls yet.</Text> : null}
      {shown.map(call => renderCall(elements, call, turn, input))}
      {counts === '' ? null : <Text dimColor>{fit(counts, input.columns)}</Text>}
    </Box>
  )
}
