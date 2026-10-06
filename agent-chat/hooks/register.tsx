import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, Timer } from 'claude-code'

import type { Subagent } from '../types'
import { addAgent, cleanName, cleanText, finishAgent, nameFor, toggle, usableAgents } from './feed'
import { renderPane } from './pane'

const PANE = 'agent-chat'
const PANE_TITLE = 'Agent chat'
const COMMAND = 'agent-chat'
const DEFAULT_COLUMNS = 60
const MIN_COLUMNS = 30
const MAX_COLUMNS = 120

const TICK_MS = 1000

const agents = atom({ plugin: 'agent-chat', key: 'agents' } as const, [] as Subagent[])
const expanded = atom({ plugin: 'agent-chat', key: 'expanded' } as const, [] as string[])
const now = atom({ plugin: 'agent-chat', key: 'now' } as const, 0)

type Settings = { isAutoOpen: boolean; columns: number }

const toSettings = (options: PluginOptions = {}): Settings => ({
  isAutoOpen: options.autoOpen !== false,
  columns:
    typeof options.paneColumns === 'number' && Number.isFinite(options.paneColumns)
      ? Math.min(Math.max(Math.round(options.paneColumns), MIN_COLUMNS), MAX_COLUMNS)
      : DEFAULT_COLUMNS,
})

// Moves the live timers on each second while a subagent works.
let ticker: Timer | undefined
// The pane opens by itself once a session, at the first subagent.
let hasAutoOpened = false
// The next subagent's colour. Taken in one step as a subagent starts, so two
// started together cannot both read the same count before either is kept.
let nextColour = 0
// Whether the pane follows new messages: true until the person scrolls up,
// and again once they scroll back to the bottom.
let isFollowing = true

function log($: EngineInterface, what: string, error: unknown) {
  $.ui.log(`agent-chat: ${what}: ${error}`, { to: 'debug' })
}

function openPane($: EngineInterface, settings: Settings) {
  $.ui
    .open({ id: PANE, title: PANE_TITLE, columns: settings.columns })
    .then(() => followNewest($))
    .catch(error => log($, 'could not open the pane', error))
}

function stopTicker() {
  ticker?.cancel()
  ticker = undefined
}

function tick($: EngineInterface) {
  $.clock
    .now()
    .then(time => update($, now, () => time))
    .catch(error => log($, 'could not move the timers', error))
}

function startTicker($: EngineInterface) {
  if (ticker !== undefined) return
  tick($)
  ticker = $.clock.every(TICK_MS, () => tick($))
}

// Shows the newest message, unless the person scrolled up to read.
function followNewest($: EngineInterface) {
  if (!isFollowing) return
  $.ui.scroll({ in: PANE, to: 'end' }).catch(error => log($, 'could not scroll the pane', error))
}

export const register: Register = (on, options) => {
  const settings = toSettings(options)

  on('session.start', async ($, e, next) => {
    // A reload starts the module over; colours go on from those already given.
    const known = usableAgents(await read($, agents))
    nextColour = Math.max(nextColour, ...known.map(agent => agent.colour + 1))
    if (known.some(agent => agent.status === 'running')) startTicker($)
    await $.command
      .register({ name: COMMAND, description: 'Show the messages between Claude and its subagents in a side pane' })
      .catch(error => log($, `could not register /${COMMAND}`, error))
    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    openPane($, settings)
    return { text: 'Agent chat opened.' }
  })

  // Claude (or a subagent) hands a subagent its task.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.agentId === undefined) return started
    const colour = nextColour
    nextColour += 1
    const time = await $.clock.now()
    const known = usableAgents(await read($, agents))
    const parentAgent = known.find(agent => agent.id === e.parentAgentId)
    const type = cleanName(e.name ?? e.subagentType)
    const agent: Subagent = {
      id: started.agentId,
      type,
      name: nameFor(known, type, colour),
      parent: parentAgent?.name ?? 'main',
      colour,
      status: 'running',
      startedAt: time,
      endedAt: null,
      task: cleanText(e.prompt),
      report: null,
    }
    await update($, agents, list => addAgent(usableAgents(list), agent))
    startTicker($)
    if (settings.isAutoOpen && !hasAutoOpened) {
      hasAutoOpened = true
      openPane($, settings)
    } else followNewest($)
    return started
  })

  // The subagent's run ends: its report goes back.
  on('turn.complete', async ($, e, next) => {
    const agent = e.agentId === undefined ? undefined : usableAgents(await read($, agents)).find(one => one.id === e.agentId)
    if (agent !== undefined) {
      const time = await $.clock.now()
      const status = e.reason === 'answer' ? 'done' : 'failed'
      const after = await update($, agents, list => finishAgent(usableAgents(list), agent.id, status, time, cleanText(e.answer)))
      if (!after.some(one => one.status === 'running')) stopTicker()
      followNewest($)
    }
    return next(e)
  })

  // The pane scrolls itself; the hook only notes whether the person left
  // the bottom, so new messages do not pull them back while they read.
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)
    if (e.origin.kind !== 'plugin') isFollowing = e.offset + e.bodyRows >= e.contentRows
    return moved
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) =>
    renderPane($.ui.resolve(e), {
      agents: usableAgents(await read($, agents)),
      expanded: new Set(await read($, expanded)),
      now: await read($, now),
      columns: e.props.bodyColumns,
      onToggle: id => {
        update($, expanded, ids => toggle(ids, id)).catch(error => log($, 'could not open the card', error))
      },
    }),
  )
}
