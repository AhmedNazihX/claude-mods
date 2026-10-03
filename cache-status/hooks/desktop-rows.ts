import type { CacheView } from './format'
import type { LayoutPlan } from './layout'
import type { MetersView } from './meters'
import { renderRow } from './svg-row'
import type { Row, RowPart, Tone } from './svg-row'

const GROUP_GAP_PX = 22
const BAR_GAP_PX = 8
const METER_SEGMENTS = 10

const text = (value: string, tone: Tone): RowPart => ({ kind: 'text', text: value, tone })
const gap = (px: number): RowPart => ({ kind: 'gap', px })

/** Groups side by side with a wide, even gap between them. */
const joinGroups = (groups: readonly (readonly RowPart[])[]): RowPart[] =>
  groups.flatMap((group, index) => (index === 0 ? [...group] : [gap(GROUP_GAP_PX), ...group]))

const percentText = (percent: number): string => `${Math.round(percent)}%`

/** `ctx ▪▪▪▫▫ 7%   usage 5h ▪▫▫ 8%   week ▪▪▪▪ 97%` */
export const metersRow = (view: MetersView, isWorking: boolean): Row | null => {
  const meter = (label: string, percent: number, level: MetersView['limits'][number]['level']): RowPart[] => [
    text(label, 'dim'),
    gap(BAR_GAP_PX),
    { kind: 'bar', percent, level, segments: METER_SEGMENTS },
    gap(BAR_GAP_PX),
    text(percentText(percent), level),
  ]
  const groups = [
    ...(view.context === null ? [] : [meter('ctx', view.context.percent, view.context.level)]),
    ...view.limits.map((limit, index) =>
      meter(index === 0 ? `usage ${limit.label}` : limit.label, limit.percent, limit.level),
    ),
  ]
  return groups.length === 0 ? null : renderRow(joinGroups(groups), isWorking)
}

const statusOf = (view: CacheView, isWorking: boolean): RowPart[] => {
  if (isWorking) return [{ kind: 'dot', tone: 'dim', isHollow: true }, text('cache ', 'dim'), text('replying…', 'dim')]
  if (!view.isWarm) return [{ kind: 'dot', tone: 'red', isHollow: true }, text('cache ', 'dim'), text('cold', 'red')]
  const isExpiring = view.timeLevel === 'red'
  return [
    { kind: 'dot', tone: view.timeLevel },
    text('cache ', 'dim'),
    text(isExpiring ? `${view.remaining} expiring` : view.remaining, view.timeLevel),
  ]
}

/** `● cache 42m   ▪▪▪▪▪▪▪▪▫▫ 98% hit   cost $0.25   session $0.25` */
export const cacheRow = (view: CacheView, plan: LayoutPlan, isWorking: boolean): Row => {
  const hit: RowPart[] = [
    { kind: 'bar', percent: view.hitPercent, level: view.hitLevel, segments: plan.barSegments },
    gap(BAR_GAP_PX),
    text(percentText(view.hitPercent), 'plain'),
    text(' hit', 'dim'),
  ]
  const cost: RowPart[] =
    view.turnCost === null ? [] : [text('cost ', 'dim'), text(view.turnCost, view.costLevel)]
  const session: RowPart[] =
    plan.layout === 'narrow' || view.sessionCost === null
      ? []
      : [text(`session ${view.sessionCost}`, 'dim')]

  return renderRow(
    joinGroups([statusOf(view, isWorking), hit, cost, session].filter(group => group.length > 0)),
    isWorking,
  )
}
