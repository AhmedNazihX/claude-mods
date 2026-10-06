import type { ElementTable } from 'claude-code'

import type { TimelineCall, TimelineTurn } from '../types'
import { durationTone, fit, fitStart, formatDuration, sequentialSpans } from './format'
import type { Span } from './format'
import { RED, TRACK_HEX, lookOf } from './look'
import { toolLabel } from './summary'

export type CardElements = {
  Box: ElementTable['Box']
  Text: ElementTable['Text']
  Svg?: ElementTable<'desktop'>['Svg']
}

export type CardInput = { turn: TimelineTurn; columns: number }

const MAX_ROWS = 12
const BADGE_COLUMNS = 4
const RIGHT_COLUMNS = 9
const MIN_LABEL = 12
const MAX_LABEL = 56
const MIN_BAR = 6
// Leaves the bar at least this much of the row however long the labels are.
const MAX_LABEL_SHARE = 0.5
// Border and padding on each side.
const CHROME_COLUMNS = 6
const BAR_CELL_PX = 7
const BAR_HEIGHT_PX = 6
const BAR_RADIUS_PX = 3
const CHECK = '✓'
const NO_SPAN: Span = { before: 0, length: 0, after: 0 }

const lengthOf = (call: TimelineCall): number => Math.max((call.endedAt ?? call.startedAt) - call.startedAt, 0)

const isBad = (call: TimelineCall): boolean => call.outcome === 'denied' || call.outcome === 'error'

const toolText = (call: TimelineCall): string => `${call.isSubagent ? '↳' : ''}${toolLabel(call.tool)}`

// The command when it fits; else Claude's description of it, which reads
// better than a command cut short.
const summaryFit = (call: TimelineCall, width: number): string => {
  if (width <= 0) return ''
  if (call.isPath) return fitStart(call.summary, width)
  const text = call.summary.length > width && call.description !== undefined ? call.description : call.summary
  return fit(text, width)
}

/** `Bash bun test`, cut to `width`; a path keeps its file name. */
const labelText = (call: TimelineCall, width: number): { tool: string; summary: string } => {
  const tool = fit(toolText(call), width)
  return { tool, summary: summaryFit(call, width - tool.length - 1) }
}

const barSvg = (span: Span, fill: string): string => {
  const width = (span.before + span.length + span.after) * BAR_CELL_PX
  const x = span.before * BAR_CELL_PX
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${BAR_HEIGHT_PX}" viewBox="0 0 ${width} ${BAR_HEIGHT_PX}">`,
    `<rect width="${width}" height="${BAR_HEIGHT_PX}" rx="${BAR_RADIUS_PX}" fill="${TRACK_HEX}"/>`,
    `<rect x="${x}" width="${span.length * BAR_CELL_PX}" height="${BAR_HEIGHT_PX}" rx="${BAR_RADIUS_PX}" fill="${fill}"/>`,
    '</svg>',
  ].join('')
}

const renderBar = ({ Text, Svg }: CardElements, call: TimelineCall, span: Span) => {
  const colour = isBad(call) ? RED : lookOf(call.tool)
  if (Svg !== undefined) {
    // The SVG's own size, in CSS pixels; the element's width and height are pixels too.
    return <Svg key={`${call.id}-bar`} source={barSvg(span, colour.hex)} alt={formatDuration(lengthOf(call))} />
  }
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
          <Text dimColor={!isDenied}>{summary === '' ? '' : ` ${summary}`}</Text>
        </Text>
      </Box>
      {bar >= MIN_BAR ? renderBar(elements, call, span) : null}
      {renderRight(elements, call)}
    </Box>
  )
}

// The call that took a refused one's place: the very next call, when it is
// the same tool and went fine. A call in between means no guess is made.
const replacementOf = (calls: readonly TimelineCall[], call: TimelineCall, index: number): TimelineCall | undefined => {
  const next = calls[index + 1]
  return next !== undefined && next.tool === call.tool && next.outcome === 'ok' ? next : undefined
}

const renderNotes = ({ Box, Text }: CardElements, calls: readonly TimelineCall[], inner: number) => {
  const noted = calls
    .map((call, index) => ({ call, replacement: replacementOf(calls, call, index) }))
    .filter(({ call }) => isBad(call) && call.note !== undefined)
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
              <Text color={RED.color}>{summaryFit(call, half) || toolText(call)}</Text>
              {replacement === undefined ? null : <Text color="green">{` → ${summaryFit(replacement, half)}`}</Text>}
            </Text>
          </Box>
          <Box flexShrink={0}>
            <Text color={RED.color}>{`${call.outcome === 'denied' ? 'denied' : 'failed'} · ${call.note}`}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/**
 * The calls as a card: a header with the count and their total time, one
 * row per call (badge, what it did, its share of the time with the calls
 * laid end to end, how long or how it ended), and a note for each call that
 * was denied or failed, with what replaced it.
 */
export const renderCard = (elements: CardElements, { turn, columns }: CardInput) => {
  const { Box, Text } = elements
  const inner = Math.max(columns - CHROME_COLUMNS, MIN_LABEL + BADGE_COLUMNS + RIGHT_COLUMNS)
  // As wide as the longest label needs, so the bars start right after the text.
  const longest = Math.max(...turn.calls.map(call => `${toolText(call)} ${call.summary}`.length))
  const label = Math.min(Math.max(longest, MIN_LABEL), MAX_LABEL, Math.floor(inner * MAX_LABEL_SHARE))
  const bar = inner - BADGE_COLUMNS - label - 1 - RIGHT_COLUMNS - 1
  const shown = turn.calls.slice(-MAX_ROWS)
  const hidden = turn.calls.length - shown.length
  const spans = sequentialSpans(shown.map(lengthOf), bar)
  const totalMs = turn.calls.reduce((sum, call) => sum + lengthOf(call), 0)
  const count = `${turn.calls.length} call${turn.calls.length === 1 ? '' : 's'} · ${formatDuration(totalMs)}`

  return (
    <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={2} marginBottom={1} width={columns}>
      <Box justifyContent="space-between" marginBottom={1}>
        <Text>Tool timeline</Text>
        <Text dimColor>{count}</Text>
      </Box>
      {hidden > 0 ? <Text dimColor>{`… ${hidden} earlier`}</Text> : null}
      {shown.map((call, index) => renderRow(elements, call, spans[index] ?? NO_SPAN, label, bar))}
      {renderNotes(elements, shown, inner)}
    </Box>
  )
}
