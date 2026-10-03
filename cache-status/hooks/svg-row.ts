import type { Level } from './format'
import { SEGMENTED_BAR_HEIGHT_PX, segmentedBarSvgBody, segmentedBarWidthPx } from './svg-bar'

// The desktop draws a Text in its own large UI font, which no prop can size,
// so each desktop line is one SVG: small monospace text whose advance is a
// fixed share of its size, which lets every part be placed exactly.
const FONT_SIZE_PX = 11
const CHAR_WIDTH_PX = FONT_SIZE_PX * 0.6
const ROW_HEIGHT_PX = 18
const DOT_RADIUS_PX = 3.5
const DOT_SLOT_PX = 12
const TEXT_BASELINE_PX = 12.5
const FONT_FAMILY = "ui-monospace, 'SF Mono', Menlo, monospace"

const COLOURS = {
  green: '#4ade80',
  yellow: '#facc15',
  red: '#f87171',
  dim: '#8b8b8b',
  plain: '#d4d4d4',
} as const

export type Tone = Level | 'dim' | 'plain'

export type RowPart =
  | { kind: 'text'; text: string; tone: Tone }
  | { kind: 'bar'; percent: number; level: Level; segments: number }
  | { kind: 'gap'; px: number }
  | { kind: 'dot'; tone: Tone; isHollow?: boolean }

export type Row = { source: string; width: number; height: number; alt: string }

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const widthOf = (part: RowPart): number => {
  if (part.kind === 'text') return [...part.text].length * CHAR_WIDTH_PX
  if (part.kind === 'bar') return segmentedBarWidthPx(part.segments)
  if (part.kind === 'dot') return DOT_SLOT_PX
  return part.px
}

const drawPart = (part: RowPart, x: number, isDim: boolean): string => {
  if (part.kind === 'gap') return ''
  if (part.kind === 'bar') {
    const y = (ROW_HEIGHT_PX - SEGMENTED_BAR_HEIGHT_PX) / 2
    const opacity = isDim ? ' opacity="0.5"' : ''
    return `<g transform="translate(${x.toFixed(1)} ${y})"${opacity}>${segmentedBarSvgBody(part)}</g>`
  }
  const tone = isDim ? 'dim' : part.tone
  if (part.kind === 'dot') {
    const paint = part.isHollow
      ? `fill="none" stroke="${COLOURS[tone]}" stroke-width="1.2"`
      : `fill="${COLOURS[tone]}"`
    return `<circle cx="${(x + DOT_RADIUS_PX).toFixed(1)}" cy="${ROW_HEIGHT_PX / 2}" r="${DOT_RADIUS_PX}" ${paint}/>`
  }
  // textLength pins the text to the width the layout gave it, so a font a
  // little wider or narrower than expected can never overlap its neighbour.
  const width = widthOf(part).toFixed(1)
  return `<text x="${x.toFixed(1)}" y="${TEXT_BASELINE_PX}" textLength="${width}" lengthAdjust="spacingAndGlyphs" fill="${COLOURS[tone]}" xml:space="preserve">${escapeXml(part.text)}</text>`
}

const altOf = (parts: readonly RowPart[]): string =>
  parts
    .map(part => {
      if (part.kind === 'text') return part.text
      if (part.kind === 'dot') return part.isHollow ? '○ ' : '● '
      return ' '
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Lays `parts` out left to right as one SVG line. `isDim` greys the whole
 * line, as while a reply is running.
 */
export const renderRow = (parts: readonly RowPart[], isDim = false): Row => {
  const placed = parts.reduce<{ x: number; drawn: readonly string[] }>(
    (acc, part) => ({
      x: acc.x + widthOf(part),
      drawn: [...acc.drawn, drawPart(part, acc.x, isDim)],
    }),
    { x: 0, drawn: [] },
  )
  const width = Math.ceil(placed.x)

  return {
    source: [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${ROW_HEIGHT_PX}" viewBox="0 0 ${width} ${ROW_HEIGHT_PX}" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE_PX}">`,
      ...placed.drawn,
      '</svg>',
    ].join(''),
    width,
    height: ROW_HEIGHT_PX,
    alt: altOf(parts),
  }
}
