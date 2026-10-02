import type { ElementTable } from 'claude-code'

import { EMPTY_TICK, FILLED_TICK, filledTicksOf } from './format'
import type { CacheView } from './format'
import type { LayoutPlan } from './layout'
import { tickShades } from './shade'

type Elements = Pick<ElementTable, 'Box' | 'Text'>

export type BandInput = {
  view: CacheView
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

/**
 * The band's one line: the countdown, the hit-rate bar (its length and its
 * colour both the share of input the cache served) and the turn's cost, as much of each as the layout leaves room for. While a reply runs the
 * line dims, its numbers being the last turn's.
 */
export const renderBand = ({ Box, Text }: Elements, input: BandInput) => {
  const { view, plan, isWorking } = input
  const filled = filledTicksOf(view.hitPercent, plan.barSegments)
  const ticks = tickShades(view.hitLevel, plan.barSegments)
    .slice(0, filled)
    .map((shade, index) => (
      <Text key={`tick-${index}`} color={shade} dimColor={isWorking}>
        {FILLED_TICK}
      </Text>
    ))
  const costs = costTextsOf(input)

  return (
    <Box>
      <Text color={isWorking ? undefined : view.timeLevel} dimColor={isWorking}>
        {statusOf(input)}
      </Text>
      <Text dimColor>{' · hit '}</Text>
      {ticks}
      <Text dimColor>{EMPTY_TICK.repeat(plan.barSegments - filled)}</Text>
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
