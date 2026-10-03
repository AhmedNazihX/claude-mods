import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { CacheSnapshot, Meters } from '../types'
import { renderBand } from './band'
import { remainingMsOf, toView, turnCostOf } from './format'
import { planLayout } from './layout'
import { compactAtPercentOf, toMetersView } from './meters'
import { toSettings } from './settings'
import type { Settings } from './settings'

const TICK_MS = 15 * 1000

const last = atom({ plugin: 'cache-status', key: 'last' } as const, null)
const now = atom({ plugin: 'cache-status', key: 'now' } as const, 0)
const costBaseline = atom(
  { plugin: 'cache-status', key: 'costBaseline' } as const,
  null,
)
const EMPTY_METERS: Meters = {
  contextPercent: null,
  compactAtPercent: null,
  rateLimits: [],
}
const meters = atom({ plugin: 'cache-status', key: 'meters' } as const, EMPTY_METERS)

async function readSessionUsd($: EngineInterface): Promise<number | null> {
  try {
    const usage = await $.session.usage()
    return usage.cost?.usd ?? null
  } catch (error) {
    $.ui.log(`cache-status could not read the session cost: ${error}`, { to: 'debug' })
    return null
  }
}

// The countdown's timer: one per loaded module, a reload starting afresh.
let ticker: Timer | undefined

function stopTicker() {
  ticker?.cancel()
  ticker = undefined
}

// Moves the countdown on; once the cache is cold nothing changes until the
// next turn, so the timer stops there.
async function tick($: EngineInterface, settings: Settings) {
  const time = await $.clock.now()
  await update($, now, () => time)
  const snapshot = await read($, last)
  if (snapshot === null || remainingMsOf(snapshot, time, settings) === 0) {
    stopTicker()
  }
}

function startTicker($: EngineInterface, settings: Settings) {
  if (ticker !== undefined) return
  ticker = $.clock.every(TICK_MS, () => {
    tick($, settings).catch(error =>
      $.ui.log(`cache-status tick failed: ${error}`, { to: 'debug' }),
    )
  })
}

// The window the auto-compact point was last read for: a new one (a model
// switch) means reading it again.
let compactWindow: number | undefined

// Reads where auto-compact runs, as a percentage of the window. The summary
// breakdown is estimated locally and sends no request.
async function refreshCompactPoint($: EngineInterface) {
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    const breakdown = usage.context.breakdown
    compactWindow = usage.context.window
    const compactAtPercent = breakdown?.isAutoCompactEnabled
      ? compactAtPercentOf(breakdown.autoCompactThreshold, usage.context.window)
      : null
    await update($, meters, current => ({ ...current, compactAtPercent }))
  } catch (error) {
    $.ui.log(`cache-status could not read the auto-compact point: ${error}`, { to: 'debug' })
  }
}

export const register: Register = (on, options) => {
  const settings = toSettings(options)
  on('session.start', async ($, e, next) => {
    await refreshCompactPoint($)
    const sessionUsd = await readSessionUsd($)
    await update($, costBaseline, () => sessionUsd)
    const snapshot = await read($, last)
    const time = await $.clock.now()
    if (snapshot !== null && remainingMsOf(snapshot, time, settings) > 0) {
      await update($, now, () => time)
      startTicker($, settings)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const isMainLoop = e.agentId === undefined
    if (isMainLoop && e.usage) {
      const sessionUsd = await readSessionUsd($)
      const baseline = await read($, costBaseline)
      await update($, costBaseline, () => sessionUsd)

      const snapshot: CacheSnapshot = {
        respondedAt: await $.clock.now(),
        readTokens: e.usage.cache_read_input_tokens,
        writtenTokens: e.usage.cache_creation_input_tokens,
        uncachedTokens: e.usage.input_tokens,
        turnUsd: turnCostOf(sessionUsd, baseline),
        sessionUsd,
      }
      await update($, last, () => snapshot)
      await update($, now, () => snapshot.respondedAt)
      startTicker($, settings)
    }

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (compactWindow !== e.context.window) {
      await refreshCompactPoint($)
    }
    await update($, meters, current => ({
      ...current,
      contextPercent: e.context.percent ?? current.contextPercent,
      rateLimits: e.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })),
    }))

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snapshot = await read($, last)
    if (e.props.hasSurvey || snapshot === null) {
      return next(e)
    }

    // The desktop draws text in a proportional font, where tick characters
    // read as a dashed line; it gets SVG pills, every other surface ticks.
    const table = $.ui.resolve(e)
    const Svg = e.surface === 'desktop' && 'Svg' in table ? table.Svg : undefined

    return renderBand({ Box: table.Box, Text: table.Text, Svg }, {
      view: toView(snapshot, await read($, now), settings),
      meters: toMetersView(await read($, meters), await read($, now)),
      plan: planLayout(e.props.bodyColumns, settings.barSegments),
      isWorking: e.props.isWorking,
    })
  })
}
