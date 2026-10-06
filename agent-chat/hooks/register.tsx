import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, Timer } from 'claude-code'

import type { Subagent } from '../types'
import { addAgent, addTokens, cleanDescription, cleanName, cleanText, countTool, finishAgent, nameFor, toggle, tokensOf, usableAgents, usableCards } from './feed'
import { renderPane } from './pane'
import { agentResultReport, handbackText, isHandback, rowText } from './reports'

const PANE = 'agent-chat'
const PANE_TITLE = 'Agent chat'
const COMMAND = 'agent-chat'
const DEFAULT_COLUMNS = 60
const MIN_COLUMNS = 30
const MAX_COLUMNS = 120

const TICK_MS = 1000

const agents = atom({ plugin: 'agent-chat', key: 'agents' } as const, [] as Subagent[])
const expanded = atom({ plugin: 'agent-chat', key: 'expanded' } as const, [] as string[])
const cards = atom({ plugin: 'agent-chat', key: 'cards' } as const, {} as Record<string, boolean>)
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
// What each running subagent said last and handed back, by its id: its
// report is the hand-back, else its final text, else the last thing it said.
const handedBack = new Map<string, string>()
const lastSaid = new Map<string, string>()
// The subagents whose tokens are counted request by request as they work;
// their run's total at the end is the same tokens again, not added twice.
const countedLive = new Set<string>()
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
      description: cleanDescription(e.description),
      parent: parentAgent?.name ?? 'main',
      colour,
      status: 'running',
      startedAt: time,
      endedAt: null,
      task: cleanText(e.prompt),
      report: null,
      model: started.model === undefined ? '' : cleanName(started.model),
      tools: 0,
      skills: 0,
      agents: 0,
      tokens: null,
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
  // A subagent hands its report back through a tool; a sync Agent call
  // returns it in its result. Either fills a report its final text left empty.
  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined && isHandback(e.tool)) {
      const text = handbackText(e)
      if (text.trim() !== '') handedBack.set(e.agentId, text)
    } else if (e.agentId !== undefined) {
      // A subagent's own call: counted for its card as it starts.
      const id = e.agentId
      const known = usableAgents(await read($, agents)).some(one => one.id === id)
      if (known) await update($, agents, list => countTool(usableAgents(list), id, e.tool))
    }
    const ran = await next(e)
    if (e.agentId === undefined && e.tool === 'Agent') {
      const { agentId, text } = agentResultReport((ran as { result?: unknown }).result)
      if (agentId !== undefined && text.trim() !== '') {
        await update($, agents, list =>
          usableAgents(list).map(one => (one.id === agentId && !one.report ? { ...one, report: cleanText(text) } : one)),
        )
      }
    }
    return ran
  })

  // Each model request of a subagent adds its tokens as it ends, so the
  // count goes up while the subagent works.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const id = e.agentId
    if (id !== undefined && result.usage !== null && usableAgents(await read($, agents)).some(one => one.id === id)) {
      countedLive.add(id)
      const step = tokensOf(result.usage)
      await update($, agents, list => usableAgents(list).map(one => (one.id === id ? { ...one, tokens: addTokens(one.tokens, step) } : one)))
    }
    return result
  })

  // The last thing each subagent said, the report of last resort.
  on('session.append', { door: 'response' }, ($, e, next) => {
    const text = rowText(e.message.content)
    if (e.agentId !== undefined && text.trim() !== '') lastSaid.set(e.agentId, text)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const agent = e.agentId === undefined ? undefined : usableAgents(await read($, agents)).find(one => one.id === e.agentId)
    if (agent !== undefined) {
      const time = await $.clock.now()
      const status = e.reason === 'answer' ? 'done' : 'failed'
      const report = handedBack.get(agent.id) || e.answer || lastSaid.get(agent.id) || ''
      handedBack.delete(agent.id)
      lastSaid.delete(agent.id)
      // Counted request by request already, or else from the run's total.
      const isCounted = countedLive.delete(agent.id)
      const tokens = tokensOf(e.usage)
      const after = await update($, agents, list =>
        finishAgent(usableAgents(list), agent.id, status, time, cleanText(report)).map(one =>
          one.id === agent.id ? { ...one, tokens: isCounted ? one.tokens : addTokens(one.tokens, tokens), model: one.model || (e.usage === undefined ? '' : cleanName(e.usage.model)) } : one,
        ),
      )
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
      cards: usableCards(await read($, cards)),
      now: await read($, now),
      columns: e.props.bodyColumns,
      // A desktop draws text in a proportional font, where a ruled line
      // of characters runs past the card; it gets spacing instead.
      hasRule: e.surface !== 'desktop',
      onToggle: id => {
        update($, expanded, ids => toggle(ids, id)).catch(error => log($, 'could not open the card', error))
      },
      onToggleCard: (id, isOpen) => {
        update($, cards, states => ({ ...usableCards(states), [id]: !isOpen })).catch(error =>
          log($, isOpen ? 'could not shut the card' : 'could not open the card', error),
        )
      },
    }),
  )
}
