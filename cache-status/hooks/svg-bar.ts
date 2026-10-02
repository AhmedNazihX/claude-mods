import type { Level } from './format'
import { tickShades } from './shade'

const EMPTY_BLOCK_COLOUR = '#3f3f46'
const BLOCK_WIDTH_PX = 7
const BLOCK_GAP_PX = 2
const BLOCK_HEIGHT_PX = 5
const BLOCK_RADIUS_PX = 1
const FULL_PERCENT = 100

export type SegmentedBarInput = {
  percent: number
  level: Level
  segments: number
}

export const segmentedBarWidthPx = (segments: number): number =>
  segments * (BLOCK_WIDTH_PX + BLOCK_GAP_PX) - BLOCK_GAP_PX

export const SEGMENTED_BAR_HEIGHT_PX = BLOCK_HEIGHT_PX

/**
 * A bar of small rounded blocks as SVG markup: the filled ones in the level's
 * shades, dark at the start and brightening toward the end, the rest dark
 * grey. The same reading as the terminal's ticks, drawn as shapes so a
 * proportional font cannot bend them.
 */
export const segmentedBarSvg = ({ percent, level, segments }: SegmentedBarInput): string => {
  const share = Math.min(Math.max(percent, 0), FULL_PERCENT) / FULL_PERCENT
  const filled = Math.round(share * segments)
  const shades = tickShades(level, segments)
  const width = segmentedBarWidthPx(segments)
  const blocks = shades.map((shade, index) => {
    const x = index * (BLOCK_WIDTH_PX + BLOCK_GAP_PX)
    const fill = index < filled ? shade : EMPTY_BLOCK_COLOUR
    return `<rect x="${x}" width="${BLOCK_WIDTH_PX}" height="${BLOCK_HEIGHT_PX}" rx="${BLOCK_RADIUS_PX}" fill="${fill}"/>`
  })

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${BLOCK_HEIGHT_PX}" viewBox="0 0 ${width} ${BLOCK_HEIGHT_PX}">`,
    ...blocks,
    '</svg>',
  ].join('')
}
