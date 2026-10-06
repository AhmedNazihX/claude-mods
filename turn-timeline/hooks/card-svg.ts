import type { TimelineCall, TimelineTurn } from '../types'
import { fit, fitStart, formatDuration, sequentialSpans } from './format'
import { RED, lookOf } from './look'
import { toolLabel } from './summary'

// The desktop draws the card as one SVG, laid out like the app's own panels:
// a filled rounded panel, rounded badges and bars, a proportional font for
// names and a monospace one for commands and times.
const WIDTH_PX = 720
const PAD_PX = 20
const HEADER_Y_PX = 30
const FIRST_ROW_Y_PX = 62
const ROW_PX = 30
const BADGE_PX = 20
const LABEL_X_PX = PAD_PX + BADGE_PX + 12
const MAX_LABEL_PX = 300
const RIGHT_PX = 84
const BAR_GAP_PX = 18
const BAR_HEIGHT_PX = 6
const NOTE_ROW_PX = 28
const NOTES_GAP_PX = 14
const BOTTOM_PAD_PX = 18
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
const MONO = "ui-monospace, 'SF Mono', Menlo, monospace"
const MONO_CHAR_PX = 13 * 0.6
// Names and commands share the monospace font, as the app's own timeline does.

const COLOURS = {
  panel: '#1c1c1f',
  border: '#2e2e33',
  title: '#e4e4e7',
  text: '#d4d4d8',
  dim: '#8b8b93',
  track: '#2a2a2f',
  badgeText: '#18181b',
  green: '#4ade80',
  noteFill: 'rgba(248, 113, 113, 0.08)',
  noteBorder: 'rgba(248, 113, 113, 0.45)',
} as const

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const lengthOf = (call: TimelineCall): number => Math.max((call.endedAt ?? call.startedAt) - call.startedAt, 0)
const isBad = (call: TimelineCall): boolean => call.outcome === 'denied' || call.outcome === 'error'

type Fitted = { text: string; isDescription: boolean }

// As on the terminal: the command when it fits, else Claude's description in italics.
const fittedSummary = (call: TimelineCall, chars: number): Fitted => {
  if (chars <= 0) return { text: '', isDescription: false }
  if (call.isPath) return { text: fitStart(call.summary, chars), isDescription: false }
  const isDescription = call.summary.length > chars && call.description !== undefined
  return { text: fit(isDescription ? (call.description ?? '') : call.summary, chars), isDescription }
}

const text = (x: number, y: number, body: string, attrs: string): string =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" ${attrs}>${escapeXml(body)}</text>`

const renderRow = (call: TimelineCall, y: number, labelPx: number, barX: number, barPx: number, span: { before: number; length: number }) => {
  const look = lookOf(call.tool)
  const isDenied = call.outcome === 'denied'
  const tool = `${call.isSubagent ? '↳' : ''}${toolLabel(call.tool)}`
  const toolPx = Math.min(tool.length * MONO_CHAR_PX, labelPx)
  const summary = fittedSummary(call, Math.floor((labelPx - toolPx - 8) / MONO_CHAR_PX))
  const strike = isDenied ? ' text-decoration="line-through"' : ''
  const labelColour = isDenied ? RED.hex : COLOURS.text
  const fill = isBad(call) ? RED.hex : look.hex
  const right = call.outcome === 'running'
    ? text(WIDTH_PX - PAD_PX, y + 4, 'running…', `text-anchor="end" font-family="${MONO}" font-size="12.5" fill="#22d3ee"`)
    : isBad(call)
    ? text(WIDTH_PX - PAD_PX, y + 4, call.outcome === 'denied' ? 'denied' : 'failed', `text-anchor="end" font-family="${MONO}" font-size="12.5" fill="${RED.hex}"`)
    : `<text x="${WIDTH_PX - PAD_PX}" y="${y + 4}" text-anchor="end" font-family="${MONO}" font-size="12.5" fill="${COLOURS.dim}">${escapeXml(formatDuration(lengthOf(call)))}<tspan fill="${COLOURS.green}"> ✓</tspan></text>`

  return [
    `<rect x="${PAD_PX}" y="${y - BADGE_PX / 2 - 1}" width="${BADGE_PX}" height="${BADGE_PX}" rx="5" fill="${look.hex}"/>`,
    text(PAD_PX + BADGE_PX / 2, y + 3.5, look.badge, `text-anchor="middle" font-family="${MONO}" font-size="11" font-weight="700" fill="${COLOURS.badgeText}"`),
    text(LABEL_X_PX, y + 4.5, tool, `font-family="${MONO}" font-size="13" fill="${labelColour}"${strike}${isDenied ? ' opacity="0.85"' : ''}`),
    summary.text === ''
      ? ''
      : text(LABEL_X_PX + toolPx + 8, y + 4.5, summary.text, `font-family="${MONO}" font-size="13" fill="${isDenied ? RED.hex : COLOURS.dim}"${summary.isDescription ? ' font-style="italic"' : ''}${strike}`),
    `<rect x="${barX}" y="${y - BAR_HEIGHT_PX / 2}" width="${barPx}" height="${BAR_HEIGHT_PX}" rx="3" fill="${COLOURS.track}"/>`,
    `<rect x="${(barX + span.before).toFixed(1)}" y="${y - BAR_HEIGHT_PX / 2}" width="${Math.max(span.length, 3).toFixed(1)}" height="${BAR_HEIGHT_PX}" rx="3" fill="${fill}"/>`,
    right,
  ].join('')
}

const replacementOf = (calls: readonly TimelineCall[], call: TimelineCall, index: number): TimelineCall | undefined => {
  const next = calls[index + 1]
  return next !== undefined && next.tool === call.tool && next.outcome === 'ok' ? next : undefined
}

const renderNotes = (calls: readonly TimelineCall[], top: number): { body: string; height: number } => {
  const noted = calls
    .map((call, index) => ({ call, replacement: replacementOf(calls, call, index) }))
    .filter(({ call }) => isBad(call) && call.note !== undefined)
  if (noted.length === 0) return { body: '', height: 0 }
  const height = noted.length * NOTE_ROW_PX + 12
  const inner = WIDTH_PX - PAD_PX * 2
  const halfChars = Math.floor((inner * 0.45) / MONO_CHAR_PX / 2)
  const lines = noted.map(({ call, replacement }, index) => {
    const y = top + 6 + index * NOTE_ROW_PX + NOTE_ROW_PX / 2 + 4
    const what = fittedSummary(call, halfChars)
    const instead = replacement === undefined ? undefined : fittedSummary(replacement, halfChars)
    const reason = `${call.outcome === 'denied' ? 'denied' : 'failed'} · ${call.note ?? ''}`
    const italic = (fitted: Fitted) => (fitted.isDescription ? ' font-style="italic"' : '')
    return [
      `<text x="${PAD_PX + 14}" y="${y}" font-family="${MONO}" font-size="12.5" fill="${RED.hex}">`,
      `<tspan>⊘ </tspan>`,
      `<tspan${call.outcome === 'denied' ? ' text-decoration="line-through"' : ''}${italic(what)}>${escapeXml(what.text || call.tool)}</tspan>`,
      instead === undefined ? '' : `<tspan fill="${COLOURS.dim}"> → </tspan><tspan fill="${COLOURS.green}"${italic(instead)}>${escapeXml(instead.text)}</tspan>`,
      '</text>',
      text(WIDTH_PX - PAD_PX - 14, y, reason, `text-anchor="end" font-family="${SANS}" font-size="12.5" fill="${RED.hex}"`),
    ].join('')
  })
  return {
    body: `<rect x="${PAD_PX}" y="${top}" width="${inner}" height="${height}" rx="8" fill="${COLOURS.noteFill}" stroke="${COLOURS.noteBorder}"/>${lines.join('')}`,
    height,
  }
}

export type CardSvg = { source: string; alt: string }

/** The card for the desktop: one SVG, its height fitted to its rows and notes. */
export const cardSvg = (turn: TimelineTurn, maxRows: number): CardSvg => {
  const shown = turn.calls.slice(-maxRows)
  const hidden = turn.calls.length - shown.length
  const longestChars = Math.max(...shown.map(call => toolLabel(call.tool).length + call.summary.length + 1))
  const labelPx = Math.min(MAX_LABEL_PX, Math.max(140, longestChars * MONO_CHAR_PX + 12))
  const barX = LABEL_X_PX + labelPx + BAR_GAP_PX
  const barPx = Math.max(WIDTH_PX - PAD_PX - RIGHT_PX - BAR_GAP_PX - barX, 40)
  // Spans in pixels: the bar is laid out one pixel per cell.
  const spans = sequentialSpans(shown.map(lengthOf), Math.round(barPx))
  const totalMs = turn.calls.reduce((sum, call) => sum + lengthOf(call), 0)
  const count = `${turn.calls.length} call${turn.calls.length === 1 ? '' : 's'} · ${formatDuration(totalMs)}`
  const firstRow = FIRST_ROW_Y_PX + (hidden > 0 ? ROW_PX * 0.7 : 0)
  const rowsEnd = firstRow + (shown.length - 1) * ROW_PX + ROW_PX / 2
  const notes = renderNotes(shown, rowsEnd + NOTES_GAP_PX)
  const height = Math.ceil(rowsEnd + (notes.height > 0 ? NOTES_GAP_PX + notes.height : 0) + BOTTOM_PAD_PX)

  const body = [
    `<rect x="0.5" y="0.5" width="${WIDTH_PX - 1}" height="${height - 1}" rx="12" fill="${COLOURS.panel}" stroke="${COLOURS.border}"/>`,
    text(PAD_PX, HEADER_Y_PX, 'Tool timeline', `font-family="${SANS}" font-size="14" font-weight="600" fill="${COLOURS.title}"`),
    text(WIDTH_PX - PAD_PX, HEADER_Y_PX, count, `text-anchor="end" font-family="${SANS}" font-size="13" fill="${COLOURS.dim}"`),
    hidden > 0 ? text(PAD_PX, FIRST_ROW_Y_PX - 8, `… ${hidden} earlier`, `font-family="${SANS}" font-size="12" fill="${COLOURS.dim}"`) : '',
    ...shown.map((call, index) => {
      const span = spans[index] ?? { before: 0, length: 0 }
      return renderRow(call, firstRow + index * ROW_PX, labelPx, barX, barPx, span)
    }),
    notes.body,
  ].join('')

  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH_PX}" height="${height}" viewBox="0 0 ${WIDTH_PX} ${height}">${body}</svg>`,
    alt: `Tool timeline: ${count}`,
  }
}
