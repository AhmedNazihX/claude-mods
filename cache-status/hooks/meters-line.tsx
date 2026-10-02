import type { ElementTable } from 'claude-code'

import type { LayoutPlan } from './layout'
import type { MetersView } from './meters'
import { renderBar } from './ticks'
import type { BarElements } from './ticks'

type Elements = Pick<ElementTable, 'Box'> & BarElements

const METER_SEGMENTS = 10
const SEPARATOR = ' · '
const USAGE_LABEL = 'usage '

const formatPercent = (percent: number): string => `${Math.round(percent)}%`

/**
 * The dashboard's second line: the context window's fill against the point
 * where it compacts, then each plan usage window. Wide and medium bands draw
 * a bar for each; a narrow one only the percentages.
 */
export const renderMetersLine = (
  elements: Elements,
  view: MetersView,
  plan: LayoutPlan,
  isWorking: boolean,
) => {
  const { Box, Text } = elements
  const hasBars = plan.layout !== 'narrow'
  const meter = (key: string, label: string, percent: number, level: MetersView['limits'][number]['level'], suffix = '') => [
    <Text key={`${key}-label`} dimColor>
      {`${label} `}
    </Text>,
    ...(hasBars
      ? [
          ...renderBar(elements, { key, percent, segments: METER_SEGMENTS, level, isDim: isWorking }),
          <Text key={`${key}-gap`}> </Text>,
        ]
      : []),
    <Text key={`${key}-value`} color={level} dimColor={isWorking}>
      {formatPercent(percent)}
    </Text>,
    ...(suffix === '' ? [] : [<Text key={`${key}-suffix`} dimColor>{suffix}</Text>]),
  ]

  const context = view.context
  const parts = [
    ...(context === null
      ? []
      : [
          meter(
            'ctx',
            'ctx',
            context.percent,
            context.level,
            context.compactAt !== null && plan.layout === 'wide'
              ? ` (compacts at ${formatPercent(context.compactAt)})`
              : '',
          ),
        ]),
    ...view.limits.map((limit, index) => [
      // The plan windows read as one group: `usage 5h … · week …`.
      ...(index === 0 ? [<Text key="usage-label" dimColor>{USAGE_LABEL}</Text>] : []),
      ...meter(`limit-${limit.label}`, limit.label, limit.percent, limit.level),
    ]),
  ]

  return (
    <Box alignItems="center">
      {parts.flatMap((part, index) =>
        index === 0 ? part : [<Text key={`sep-${index}`} dimColor>{SEPARATOR}</Text>, ...part],
      )}
    </Box>
  )
}
