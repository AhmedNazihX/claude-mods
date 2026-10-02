import type { ElementTable } from 'claude-code'

import { SEGMENTED_BAR_HEIGHT_PX, segmentedBarSvg, segmentedBarWidthPx } from './svg-bar'

import { EMPTY_TICK, FILLED_TICK, filledTicksOf } from './format'
import type { Level } from './format'
import { tickShades } from './shade'

type TextElement = ElementTable['Text']

/** The elements a bar may be drawn with: `Svg` only where the surface has it. */
export type BarElements = {
  Text: TextElement
  Svg?: ElementTable<'desktop'>['Svg']
}


export type TicksInput = {
  key: string
  percent: number
  segments: number
  level: Level
  isDim: boolean
}

/**
 * A bar of `segments` ticks filled to `percent`: each filled tick its own
 * shade of `level`, dark at the start and light at the end; the rest dim.
 */
export const renderTicks = (Text: TextElement, input: TicksInput) => {
  const { key, percent, segments, level, isDim } = input
  const filled = filledTicksOf(Math.min(percent, 100), segments)
  const ticks = tickShades(level, segments)
    .slice(0, filled)
    .map((shade, index) => (
      <Text key={`${key}-${index}`} color={shade} dimColor={isDim}>
        {FILLED_TICK}
      </Text>
    ))

  return [
    ...ticks,
    <Text key={`${key}-empty`} dimColor>
      {EMPTY_TICK.repeat(segments - filled)}
    </Text>,
  ]
}

/**
 * A bar as the surface draws best: rounded SVG blocks where `Svg` is given
 * (the desktop, whose proportional font turns ticks into a dashed line), the
 * shaded tick characters everywhere else.
 */
export const renderBar = ({ Text, Svg }: BarElements, input: TicksInput) => {
  if (Svg === undefined) return renderTicks(Text, input)
  return [
    <Svg
      key={`${input.key}-blocks`}
      source={segmentedBarSvg(input)}
      alt={`${Math.round(input.percent)}%`}
      width={segmentedBarWidthPx(input.segments)}
      height={SEGMENTED_BAR_HEIGHT_PX}
    />,
  ]
}
