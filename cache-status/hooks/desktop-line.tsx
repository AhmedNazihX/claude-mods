import type { ElementTable } from 'claude-code'

import type { CacheView } from './format'
import type { LayoutPlan } from './layout'
import { renderBar } from './ticks'
import type { BarElements } from './ticks'

type Elements = Pick<ElementTable, 'Box'> & BarElements

export type CacheLineInput = {
  view: CacheView
  plan: LayoutPlan
  isWorking: boolean
  turnCost?: string
  sessionCost?: string
}

const markOf = ({ view, isWorking }: CacheLineInput): string => {
  if (isWorking) return '◌'
  if (!view.isWarm) return '○'
  return view.timeLevel === 'red' ? '◐' : '●'
}

const timeOf = ({ view, isWorking }: CacheLineInput): string => {
  if (isWorking) return 'replying…'
  if (!view.isWarm) return 'cold'
  return view.timeLevel === 'red' ? `${view.remaining} expiring` : view.remaining
}

/**
 * The cache line as the desktop draws it, in the reference's quiet style:
 * `● cache 42m  ▪▪▪▪▪▪▪▪▫▫  98% hit · cost $0.25 · session $0.25`, the
 * labels dim, the countdown and the cost coloured, the bar in blocks.
 */
export const renderDesktopCacheLine = (elements: Elements, input: CacheLineInput) => {
  const { Box, Text } = elements
  const { view, plan, isWorking } = input
  const timeColour = isWorking ? undefined : view.timeLevel

  return (
    <Box alignItems="center">
      <Text color={timeColour} dimColor={isWorking}>{`${markOf(input)} `}</Text>
      <Text dimColor>{'cache '}</Text>
      <Text color={timeColour} dimColor={isWorking}>{timeOf(input)}</Text>
      <Text>{'  '}</Text>
      {renderBar(elements, {
        key: 'hit',
        percent: view.hitPercent,
        segments: plan.barSegments,
        level: view.hitLevel,
        isDim: isWorking,
      })}
      <Text dimColor={isWorking}>{`  ${view.hitPercent}%`}</Text>
      <Text dimColor>{' hit'}</Text>
      {input.turnCost === undefined ? null : [
        <Text key="cost-label" dimColor>{' · cost '}</Text>,
        <Text key="cost-value" color={view.costLevel} dimColor={isWorking}>{input.turnCost}</Text>,
      ]}
      {input.sessionCost === undefined ? null : (
        <Text dimColor>{` · session ${input.sessionCost}`}</Text>
      )}
    </Box>
  )
}
