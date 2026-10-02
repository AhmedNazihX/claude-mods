import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  costLevelOf,
  hitLevelOf,
  formatUsd,
  remainingMsOf,
  timeLevelOf,
  toBar,
  turnCostOf,
} from './format'
import { planLayout } from './layout'
import { compactAtPercentOf, contextLevelOf, limitLabelOf, limitLevelOf } from './meters'
import { toSettings } from './settings'
import { tickShades } from './shade'

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

const DEFAULTS = toSettings()
const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
const WIDE = 140
const NARROW = 50

const USAGE = {
  model: 'claude-opus-5-5',
  input_tokens: 1000,
  output_tokens: 500,
  cache_read_input_tokens: 90000,
  cache_creation_input_tokens: 9000,
}
const TURN = {
  answer: 'ok',
  durationMs: 1000,
  isAborted: false,
  turnId: 't1',
  reason: 'answer',
  usage: USAGE,
} as const

const WINDOW = 1_000_000
const COMPACT_THRESHOLD = 830_000

// Stands in for the engine beneath the plugin: the session's cost ledger and
// context window (auto-compact at 83%), the end of a turn, and an empty band.
const engineBeneath = (on: On, cost: { usd: number }) => {
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: {
        window: WINDOW,
        breakdown: { isAutoCompactEnabled: true, autoCompactThreshold: COMPACT_THRESHOLD } as never,
      },
      rateLimits: [],
      cost,
    },
  }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.render', () => ({ type: 'Box' }) as never)
}

const MEASURE = {
  context: { window: WINDOW, tokens: 620_000, percent: 62 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 41 },
    { kind: 'seven_day', percentUsed: 18 },
  ],
  changed: ['context', 'rateLimits'],
} as const

const startSession = ($: Engine, surface: Surface) =>
  $.session.start({ cwd: '/', surface, isInteractive: true } as never)

const completeTurn = ($: Engine) => $.turn.complete(TURN as never)

const bandText = async (
  $: Engine,
  surface: Surface,
  { columns = WIDE, isWorking = false } = {},
) => {
  const ui = await $.ui.mount({
    plugin: 'cache-status',
    surface,
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking, maxRows: 10, bodyColumns: columns } as never,
  })
  const texts = await ui.findAll({ type: 'Text' })
  return texts.map(found => found.text).join('')
}

for (const surface of SURFACES) {
  describe(`the band (${surface})`, () => {
    test('shows nothing before the first turn', async ($, on) => {
      mock.clock(on, { now: 1_000 })
      engineBeneath(on, { usd: 0 })
      expect(await bandText($, surface)).toBe('')
    })

    test('shows the countdown, the bar and the hit rate after a turn', async ($, on) => {
      mock.clock(on, { now: 1_000 })
      engineBeneath(on, { usd: 0 })
      await startSession($, surface)
      await completeTurn($)
      const text = await bandText($, surface)
      expect(text).toContain('cache warm · 60m')
      expect(text).toContain('hit ' + '▰'.repeat(18) + '▱'.repeat(2))
      expect(text).toContain('90% from cache (90k read, 9k written)')
    })

    test('shows the turn and session cost', async ($, on) => {
      mock.clock(on, { now: 1_000 })
      const cost = { usd: 1.0 }
      engineBeneath(on, cost)
      await startSession($, surface)
      cost.usd = 1.25
      await completeTurn($)
      const text = await bandText($, surface)
      expect(text).toContain('cost $0.25')
      expect(text).toContain('session $1.25')
    })

    test('turns cold once the lifetime passes', async ($, on) => {
      const clock = mock.clock(on, { now: 1_000 })
      engineBeneath(on, { usd: 0 })
      await startSession($, surface)
      await completeTurn($)
      await clock.advance(HOUR_MS + 30_000)
      expect(await bandText($, surface)).toContain('cache cold')
    })

    test('says the cache is expiring once the countdown turns red', async ($, on) => {
      const clock = mock.clock(on, { now: 1_000 })
      engineBeneath(on, { usd: 0 })
      await startSession($, surface)
      await completeTurn($)
      await clock.advance(30 * MINUTE_MS)
      expect(await bandText($, surface)).toContain('● cache warm · 30m')
      await clock.advance(20 * MINUTE_MS)
      const text = await bandText($, surface)
      expect(text).toContain('◐ cache expiring · 10m')
      expect(text).not.toContain('cache warm')
      expect(await bandText($, surface, { columns: NARROW })).toContain('◐ 10m')
    })

    test('a 5m lifetime goes cold after five minutes', { options: { ttl: '5m' } }, async ($, on) => {
      const clock = mock.clock(on, { now: 1_000 })
      engineBeneath(on, { usd: 0 })
      await startSession($, surface)
      await completeTurn($)
      expect(await bandText($, surface)).toContain('cache warm · 5m')
      await clock.advance(6 * MINUTE_MS)
      expect(await bandText($, surface)).toContain('cache cold')
    })

    test('a narrow band keeps the countdown, a half bar and the turn cost', async ($, on) => {
      mock.clock(on, { now: 1_000 })
      const cost = { usd: 1.0 }
      engineBeneath(on, cost)
      await startSession($, surface)
      cost.usd = 1.25
      await completeTurn($)
      const text = await bandText($, surface, { columns: NARROW })
      expect(text).toContain('● 60m')
      expect(text).toContain('▰'.repeat(9) + '▱ 90%')
      expect(text).toContain('cost $0.25')
      expect(text).not.toContain('read')
      expect(text).not.toContain('session')
    })

    test('shows no meters line before any reading', async ($, on) => {
      mock.clock(on, { now: 1_000 })
      engineBeneath(on, { usd: 0 })
      await startSession($, surface)
      await completeTurn($)
      expect(await bandText($, surface)).not.toContain('ctx')
    })

    test('shows the context fill against the compact point and the plan usage', async ($, on) => {
      mock.clock(on, { now: 1_000 })
      engineBeneath(on, { usd: 0 })
      await startSession($, surface)
      await completeTurn($)
      await $.session.measure(MEASURE as never)
      const text = await bandText($, surface)
      expect(text).toContain('ctx ' + '▰'.repeat(6) + '▱'.repeat(4) + ' 62% (compacts at 83%)')
      expect(text).toContain('usage 5h ' + '▰'.repeat(4) + '▱'.repeat(6) + ' 41%')
      expect(text).toContain('week ' + '▰'.repeat(2) + '▱'.repeat(8) + ' 18%')
    })

    test('a narrow band shows the meters as percentages only', async ($, on) => {
      mock.clock(on, { now: 1_000 })
      engineBeneath(on, { usd: 0 })
      await startSession($, surface)
      await completeTurn($)
      await $.session.measure(MEASURE as never)
      expect(await bandText($, surface, { columns: NARROW })).toContain('ctx 62% · usage 5h 41% · week 18%')
    })

    test('says a reply is running while one is', async ($, on) => {
      mock.clock(on, { now: 1_000 })
      engineBeneath(on, { usd: 0 })
      await startSession($, surface)
      await completeTurn($)
      const text = await bandText($, surface, { isWorking: true })
      expect(text).toContain('◌ replying…')
      expect(text).not.toContain('cache warm')
    })
  })
}

describe('the turn cost', () => {
  test('is the growth of the session total', () => {
    expect(turnCostOf(1.25, 1.0)).toBe(0.25)
  })

  test('counts from zero when the total was reset', () => {
    expect(turnCostOf(0.3, 4.0)).toBe(0.3)
  })

  test('is unknown without both totals', () => {
    expect(turnCostOf(null, 1)).toBeNull()
    expect(turnCostOf(1, null)).toBeNull()
  })

  test('reads as dollars', () => {
    expect(formatUsd(0.004)).toBe('<$0.01')
    expect(formatUsd(0.237)).toBe('$0.24')
    expect(formatUsd(3.2)).toBe('$3.20')
  })

  test('turns yellow then red at the configured thresholds', () => {
    expect(costLevelOf(0.04, DEFAULTS)).toBe('green')
    expect(costLevelOf(0.2, DEFAULTS)).toBe('yellow')
    expect(costLevelOf(0.8, DEFAULTS)).toBe('red')
    expect(costLevelOf(null, DEFAULTS)).toBe('green')
    const strict = toSettings({ costYellowUsd: 0.01, costRedUsd: 0.05 })
    expect(costLevelOf(0.03, strict)).toBe('yellow')
  })
})

describe('the hit rate', () => {
  test('colours the bar green, then yellow below 80%, then red below 50%', () => {
    expect(hitLevelOf(94)).toBe('green')
    expect(hitLevelOf(80)).toBe('green')
    expect(hitLevelOf(48 + 12)).toBe('yellow')
    expect(hitLevelOf(48)).toBe('red')
  })
})

describe('the meters', () => {
  test('colour the context by how near it is to compacting', () => {
    expect(contextLevelOf(40, 80)).toBe('green')
    expect(contextLevelOf(65, 80)).toBe('yellow')
    expect(contextLevelOf(75, 80)).toBe('red')
    expect(contextLevelOf(70, null)).toBe('green')
  })

  test('colour plan usage green, then yellow from 60%, then red from 85%', () => {
    expect(limitLevelOf(41)).toBe('green')
    expect(limitLevelOf(70)).toBe('yellow')
    expect(limitLevelOf(90)).toBe('red')
  })

  test('place the compact point as a share of the window', () => {
    expect(compactAtPercentOf(830_000, 1_000_000)).toBe(83)
    expect(compactAtPercentOf(undefined, 1_000_000)).toBeNull()
    expect(compactAtPercentOf(1, 0)).toBeNull()
  })

  test('name the usage windows briefly', () => {
    expect(limitLabelOf('five_hour')).toBe('5h')
    expect(limitLabelOf('seven_day')).toBe('week')
    expect(limitLabelOf('something_new')).toBe('something_new')
  })
})

describe('the countdown', () => {
  test('turns yellow then red near the end', () => {
    expect(timeLevelOf(HOUR_MS * 0.9, DEFAULTS)).toBe('green')
    expect(timeLevelOf(HOUR_MS * 0.4, DEFAULTS)).toBe('yellow')
    expect(timeLevelOf(HOUR_MS * 0.1, DEFAULTS)).toBe('red')
    expect(timeLevelOf(0, DEFAULTS)).toBe('red')
  })

  test('reaches zero once the lifetime passes, which stops the timer', () => {
    const snapshot = {
      respondedAt: 0,
      readTokens: 0,
      writtenTokens: 0,
      uncachedTokens: 0,
      turnUsd: null,
      sessionUsd: null,
    }
    expect(remainingMsOf(snapshot, HOUR_MS - 1, DEFAULTS)).toBe(1)
    expect(remainingMsOf(snapshot, HOUR_MS + 1, DEFAULTS)).toBe(0)
  })
})

describe('the settings', () => {
  test('default to a 1h lifetime and a 20-tick bar', () => {
    expect(DEFAULTS).toEqual({ ttlMs: HOUR_MS, costYellowUsd: 0.1, costRedUsd: 0.5, barSegments: 20 })
  })

  test('fall back to the default for values out of range', () => {
    const settings = toSettings({ ttl: '3d', costYellowUsd: -1, barSegments: 500 })
    expect(settings.ttlMs).toBe(HOUR_MS)
    expect(settings.costYellowUsd).toBe(0.1)
    expect(settings.barSegments).toBe(40)
  })

  test('never put red below yellow', () => {
    expect(toSettings({ costYellowUsd: 1, costRedUsd: 0.5 }).costRedUsd).toBe(1)
  })
})

describe('the layout', () => {
  test('drops detail as the band narrows', () => {
    expect(planLayout(140, 20)).toEqual({ layout: 'wide', barSegments: 20 })
    expect(planLayout(80, 20)).toEqual({ layout: 'medium', barSegments: 20 })
    expect(planLayout(50, 20)).toEqual({ layout: 'narrow', barSegments: 10 })
  })
})

describe('the bar', () => {
  test('fills one tick per 5% at 20 ticks', () => {
    expect(toBar(0, 20)).toBe('▱'.repeat(20))
    expect(toBar(94, 20)).toBe('▰'.repeat(19) + '▱')
    expect(toBar(100, 20)).toBe('▰'.repeat(20))
  })

  test('runs from the darkest shade to the lightest', () => {
    const shades = tickShades('green', 20)
    const brightness = (hex = '') =>
      parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16)
    expect(shades).toHaveLength(20)
    expect(shades[0]).toBe('#14532d')
    expect(shades[19]).toBe('#86efac')
    expect(brightness(shades[10])).toBeGreaterThan(brightness(shades[0]))
    expect(brightness(shades[19])).toBeGreaterThan(brightness(shades[10]))
  })
})

describe('the band order', () => {
  test('puts the meters above the cache line', async ($, on) => {
    mock.clock(on, { now: 1_000 })
    engineBeneath(on, { usd: 0 })
    await startSession($, 'terminal')
    await completeTurn($)
    await $.session.measure(MEASURE as never)
    const text = await bandText($, 'terminal')
    expect(text.indexOf('ctx')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('ctx')).toBeLessThan(text.indexOf('cache warm'))
  })
})
