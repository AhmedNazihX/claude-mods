import type { ElementTable } from 'claude-code'

import type { TimelineCall, TimelineTurn } from '../types'
import { countText, isBad, lengthOf, longestLabel, notedCalls, reasonText, shownCalls, summaryFit, toolText } from './card-model'
import type { Fitted } from './card-model'
import { cardSvg } from './card-svg'
import { durationTone, fit, formatDuration, sequentialSpans } from './format'
import type { Span } from './format'
import { RED, TRACK_HEX, lookOf } from './look'

export type CardElements = {
  Box: ElementTable['Box']
  Text: ElementTable['Text']
  Svg?: ElementTable<'desktop'>['Svg']
}

export type CardInput = { turn: TimelineTurn; columns: number }

const BADGE_COLUMNS = 4
const RIGHT_COLUMNS = 9
const MIN_LABEL = 12
const MAX_LABEL = 56
const MIN_BAR = 6
// Leaves the bar at least this much of the row however long the labels are.
const MAX_LABEL_SHARE = 0.5
// Border and padding on each side.
const CHROME_COLUMNS = 6
const CHECK = '✓'
const NO_SPAN: Span = { before: 0, length: 0, after: 0 }

/** `Bash bun test`, cut to `width`; a path keeps its file name. */
const labelText = (call: TimelineCall, width: number): { tool: string; summary: Fitted } => {
  const tool = fit(toolText(call), width)
  return { tool, summary: summaryFit(call, width - tool.length - 1) }
}

const renderBar = ({ Text }: CardElements, call: TimelineCall, span: Span) => {
  const colour = isBad(call) ? RED : lookOf(call.tool)
  return (
    <Text key={`${call.id}-bar`}>
      <Text color={TRACK_HEX}>{'━'.repeat(span.before)}</Text>
      <Text color={colour.color}>{'━'.repeat(span.length)}</Text>
      <Text color={TRACK_HEX}>{'━'.repeat(span.after)}</Text>
    </Text>
  )
}

// `0.7s ✓` in its tone, or `denied` / `failed` in red, right-aligned.
const renderRight = ({ Text }: CardElements, call: TimelineCall) => {
  if (call.outcome === 'running') return <Text color="cyan">{'running'.padStart(RIGHT_COLUMNS - 1)}</Text>
  if (isBad(call)) {
    const word = call.outcome === 'denied' ? 'denied' : 'failed'
    return <Text color={RED.color}>{word.padStart(RIGHT_COLUMNS - 1)}</Text>
  }
  const ms = lengthOf(call)
  return (
    <Text>
      <Text color={durationTone(ms)}>{formatDuration(ms).padStart(RIGHT_COLUMNS - 3)}</Text>
      <Text color="green">{` ${CHECK}`}</Text>
    </Text>
  )
}

const renderRow = (elements: CardElements, call: TimelineCall, span: Span, label: number, bar: number) => {
  const { Box, Text } = elements
  const look = lookOf(call.tool)
  const isDenied = call.outcome === 'denied'
  const { tool, summary } = labelText(call, label)

  return (
    <Box key={call.id} gap={1}>
      <Text color="black" backgroundColor={look.color}>{` ${look.badge} `}</Text>
      <Box width={label}>
        <Text color={isDenied ? RED.color : undefined} wrap="truncate">
          {tool}
          <Text dimColor={!isDenied} italic={summary.isDescription}>{summary.text === '' ? '' : ` ${summary.text}`}</Text>
        </Text>
      </Box>
      {bar >= MIN_BAR ? renderBar(elements, call, span) : null}
      {renderRight(elements, call)}
    </Box>
  )
}

const renderFitted = (Text: CardElements['Text'], fitted: Fitted, color: string, fallback: string) => (
  <Text color={color} italic={fitted.isDescription}>{fitted.text || fallback}</Text>
)

const renderNotes = ({ Box, Text }: CardElements, calls: readonly TimelineCall[], inner: number) => {
  const noted = notedCalls(calls)
  if (noted.length === 0) return null
  const half = Math.floor((inner - 6) / 2)

  return (
    <Box key="notes" flexDirection="column" borderStyle="round" borderColor={RED.color} paddingX={1} marginTop={1}>
      {noted.map(({ call, replacement }) => (
        <Box key={`${call.id}-note`} justifyContent="space-between" gap={2}>
          {/* The command gives way first: the reason is the point of the note. */}
          <Box flexShrink={1} flexGrow={1}>
            <Text wrap="truncate">
              <Text color={RED.color}>{'⊘ '}</Text>
              {renderFitted(Text, summaryFit(call, half), RED.color, toolText(call))}
              {replacement === undefined ? null : (
                <Text color="green">
                  {' → '}
                  {renderFitted(Text, summaryFit(replacement, half), 'green', '')}
                </Text>
              )}
            </Text>
          </Box>
          <Box flexShrink={0}>
            <Text color={RED.color}>{reasonText(call)}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/**
 * The calls as a card: a header with the count and the time they covered, one
 * row per call (badge, what it did, its share of the time with the calls
 * laid end to end, how long or how it ended), and a note for each call that
 * was denied or failed, with what replaced it.
 */
export const renderCard = (elements: CardElements, { turn, columns }: CardInput) => {
  const { Box, Text, Svg } = elements
  if (Svg !== undefined) {
    const drawn = cardSvg(turn)
    return (
      <Box marginBottom={1}>
        <Svg source={drawn.source} alt={drawn.alt} />
      </Box>
    )
  }
  const { shown, hidden } = shownCalls(turn)
  const inner = Math.max(columns - CHROME_COLUMNS, MIN_LABEL + BADGE_COLUMNS + RIGHT_COLUMNS)
  // As wide as the longest shown label needs, so the bars start right after the text.
  const label = Math.min(Math.max(longestLabel(shown), MIN_LABEL), MAX_LABEL, Math.floor(inner * MAX_LABEL_SHARE))
  const bar = inner - BADGE_COLUMNS - label - 1 - RIGHT_COLUMNS - 1
  const spans = sequentialSpans(shown.map(lengthOf), bar)

  return (
    <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={2} marginBottom={1} width={columns}>
      <Box justifyContent="space-between" marginBottom={1}>
        <Text>Tool timeline</Text>
        <Text dimColor>{countText(turn)}</Text>
      </Box>
      {hidden > 0 ? <Text dimColor>{`… ${hidden} earlier`}</Text> : null}
      {shown.map((call, index) => renderRow(elements, call, spans[index] ?? NO_SPAN, label, bar))}
      {renderNotes(elements, shown, inner)}
    </Box>
  )
}
