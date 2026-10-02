import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { CacheSnapshot } from '../types'
import { renderBand } from './band'
import { remainingMsOf, toView, turnCostOf } from './format'
import { planLayout } from './layout'
import { toSettings } from './settings'
import type { Settings } from './settings'

const TICK_MS = 15 * 1000

const last = atom({ plugin: 'cache-status', key: 'last' } as const, null)
const now = atom({ plugin: 'cache-status', key: 'now' } as const, 0)
const costBaseline = atom(
  { plugin: 'cache-status', key: 'costBaseline' } as const,
  null,
)

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

export const register: Register = (on, options) => {
  const settings = toSettings(options)
  on('session.start', async ($, e, next) => {
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snapshot = await read($, last)
    if (e.props.hasSurvey || snapshot === null) {
      return next(e)
    }

    return renderBand($.ui.resolve(e), {
      view: toView(snapshot, await read($, now), settings),
      plan: planLayout(e.props.bodyColumns, settings.barSegments),
      isWorking: e.props.isWorking,
    })
  })
}
