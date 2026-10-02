const WIDE_MIN_COLUMNS = 115
const MEDIUM_MIN_COLUMNS = 65
const NARROW_BAR_DIVISOR = 2

export type Layout = 'wide' | 'medium' | 'narrow'

export type LayoutPlan = {
  layout: Layout
  barSegments: number
}

/**
 * How much of the band fits in `columns`: everything, the labels shortened
 * and the token counts dropped, or only the countdown, a half bar and the cost.
 */
export const planLayout = (columns: number, barSegments: number): LayoutPlan => {
  if (columns >= WIDE_MIN_COLUMNS) return { layout: 'wide', barSegments }
  if (columns >= MEDIUM_MIN_COLUMNS) return { layout: 'medium', barSegments }
  return {
    layout: 'narrow',
    barSegments: Math.max(Math.round(barSegments / NARROW_BAR_DIVISOR), 1),
  }
}
