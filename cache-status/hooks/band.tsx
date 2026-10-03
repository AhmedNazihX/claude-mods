import type { ElementTable } from 'claude-code'

import type { CacheView } from './format'
import type { LayoutPlan } from './layout'
import { hasMeters } from './meters'
import type { MetersView } from './meters'
import { renderMetersLine } from './meters-line'
import { cacheRow, metersRow } from './desktop-rows'
import type { Row } from './svg-row'
import { renderBar } from './ticks'
import type { BarElements } from './ticks'

type Elements = Pick<ElementTable, 'Box'> & BarElements

export type BandInput = {
  view: CacheView
  meters: MetersView
  plan: LayoutPlan
  isWorking: boolean
}

const statusOf = ({ view, plan, isWorking }: BandInput): string => {
  if (isWorking) return '◌ replying…'
  if (!view.isWarm) {
    return plan.layout === 'wide'
      ? '○ cache cold · next message re-caches the context'
      : '○ cold'
  }
  const isExpiring = view.timeLevel === 'red'
  const [mark, word] = isExpiring ? ['◐', 'expiring'] : ['●', 'warm']
  if (plan.layout === 'wide') return `${mark} cache ${word} · ${view.remaining}`
  if (plan.layout === 'medium') return `${mark} ${word} · ${view.remaining}`
  return `${mark} ${view.remaining}`
}

const hitTextOf = ({ view, plan }: BandInput): string =>
  plan.layout === 'wide'
    ? ` ${view.hitPercent}% from cache (${view.read} read, ${view.written} written)`
    : ` ${view.hitPercent}%`

const costTextsOf = ({ view, plan }: BandInput): { turn?: string; session?: string } => ({
  ...(view.turnCost === null ? {} : { turn: ` · cost ${view.turnCost}` }),
  ...(plan.layout === 'narrow' || view.sessionCost === null
    ? {}
    : { session: ` · session ${view.sessionCost}` }),
})

const renderCacheLine = (elements: Elements, input: BandInput) => {
  const { Box, Text } = elements
  const { view, plan, isWorking } = input
  const costs = costTextsOf(input)

  return (
    <Box alignItems="center">
      <Text color={isWorking ? undefined : view.timeLevel} dimColor={isWorking}>
        {statusOf(input)}
      </Text>
      <Text dimColor>{' · hit '}</Text>
      {renderBar(elements, {
        key: 'hit',
        percent: view.hitPercent,
        segments: plan.barSegments,
        level: view.hitLevel,
        isDim: isWorking,
      })}
      <Text dimColor>{hitTextOf(input)}</Text>
      {costs.turn === undefined ? null : (
        <Text color={view.costLevel} dimColor={isWorking}>
          {costs.turn}
        </Text>
      )}
      {costs.session === undefined ? null : <Text dimColor>{costs.session}</Text>}
    </Box>
  )
}

const renderRowSvg = (Svg: NonNullable<Elements['Svg']>, key: string, row: Row) => (
  <Svg key={key} source={row.source} alt={row.alt} width={row.width} height={row.height} />
)

/**
 * The band: the meters line (context fill, plan usage) once there are
 * figures, and under it, next to the prompt, the cache line (countdown,
 * hit-rate bar, the turn's cost). The desktop, whose Text no prop can size,
 * gets each line drawn whole as a small SVG; every other surface gets text.
 */
export const renderBand = (elements: Elements, input: BandInput) => {
  const { Box, Svg } = elements

  if (Svg !== undefined) {
    const meters = metersRow(input.meters, input.isWorking)
    return (
      <Box flexDirection="column">
        {meters === null ? null : renderRowSvg(Svg, 'meters', meters)}
        {renderRowSvg(Svg, 'cache', cacheRow(input.view, input.plan, input.isWorking))}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {hasMeters(input.meters)
        ? renderMetersLine(elements, input.meters, input.plan, input.isWorking)
        : null}
      {renderCacheLine(elements, input)}
    </Box>
  )
}
