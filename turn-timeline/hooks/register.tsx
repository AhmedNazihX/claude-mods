import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { TimelineCall } from '../types'
import { renderPane } from './pane'
import { toSettings } from './settings'
import type { Settings } from './settings'
import { summarize } from './summary'
import { addCall, endTurn, finishCall, outcomeOf, startTurn } from './timeline'

const PANE = 'turn-timeline'
const PANE_TITLE = 'Turn timeline'
const COMMAND = 'timeline'
const TICK_MS = 1000
const DEFAULT_ROWS = 24

const turn = atom({ plugin: 'turn-timeline', key: 'turn' } as const, null)
const now = atom({ plugin: 'turn-timeline', key: 'now' } as const, 0)

// While a reply runs, a timer moves `now` on each second so running calls
// and the turn's length count up; it stops when the reply ends.
let ticker: Timer | undefined
// Calls without a tool_use_id still need an id of their own.
let callCount = 0

function stopTicker() {
  ticker?.cancel()
  ticker = undefined
}

function startTicker($: EngineInterface) {
  if (ticker !== undefined) return
  ticker = $.clock.every(TICK_MS, () => {
    $.clock
      .now()
      .then(time => update($, now, () => time))
      .catch(error => $.ui.log(`turn-timeline tick failed: ${error}`, { to: 'debug' }))
  })
}

// Asks for a modest size: the width it docks at beside the conversation, the
// height it takes above the prompt. A size the person dragged it to wins.
function openPane($: EngineInterface, settings: Settings) {
  $.ui.open({ id: PANE, title: PANE_TITLE, columns: settings.columns, rows: settings.rows }).catch(error =>
    $.ui.log(`turn-timeline could not open its pane: ${error}`, { to: 'debug' }),
  )
}

export const register: Register = (on, options) => {
  const settings = toSettings(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show the tool calls of the current reply in a side pane',
    })
    if (settings.isAutoOpen) openPane($, settings)

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    openPane($, settings)
    return { text: 'Turn timeline opened.' }
  })

  on('turn.start', async ($, e, next) => {
    const time = await $.clock.now()
    await update($, now, () => time)
    await update($, turn, () => startTurn(e.turnId, e.text, time))
    startTicker($)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if ((await read($, turn)) === null) return next(e)

    callCount += 1
    const startedAt = await $.clock.now()
    const call: TimelineCall = {
      id: e.tool_use_id ?? `${e.tool}-${startedAt}-${callCount}`,
      tool: e.tool,
      summary: summarize(e.tool, e as unknown as Readonly<Record<string, unknown>>),
      isSubagent: e.agentId !== undefined,
      startedAt,
      endedAt: null,
      outcome: 'running',
    }
    await update($, turn, current => (current === null ? current : addCall(current, call)))

    try {
      const ran = await next(e)
      const endedAt = await $.clock.now()
      await update($, turn, current =>
        current === null ? current : finishCall(current, call.id, outcomeOf(ran), endedAt),
      )
      return ran
    } catch (error) {
      const endedAt = await $.clock.now()
      await update($, turn, current =>
        current === null ? current : finishCall(current, call.id, 'error', endedAt),
      )
      throw error
    }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const time = await $.clock.now()
      await update($, now, () => time)
      await update($, turn, current => (current === null ? current : endTurn(current, time)))
      stopTicker()
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) =>
    renderPane($.ui.resolve(e), {
      turn: await read($, turn),
      now: await read($, now),
      columns: e.props.bodyColumns,
      rows: e.viewport?.rows ?? DEFAULT_ROWS,
    }),
  )
}
