import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { Subagent, FeedEntry } from '../types'
import { addAgent, appendEntry, cleanText, endAgent, nameFor, usableAgents, usableFeed } from './feed'
import { renderPane } from './pane'

const PANE = 'agent-chat'
const PANE_TITLE = 'Agent chat'
const COMMAND = 'agent-chat'
const DEFAULT_COLUMNS = 60
const MIN_COLUMNS = 30
const MAX_COLUMNS = 120

const feed = atom({ plugin: 'agent-chat', key: 'feed' } as const, [] as FeedEntry[])
const agents = atom({ plugin: 'agent-chat', key: 'agents' } as const, [] as Subagent[])

type Settings = { isAutoOpen: boolean; columns: number }

const toSettings = (options: PluginOptions = {}): Settings => ({
  isAutoOpen: options.autoOpen !== false,
  columns:
    typeof options.paneColumns === 'number' && Number.isFinite(options.paneColumns)
      ? Math.min(Math.max(Math.round(options.paneColumns), MIN_COLUMNS), MAX_COLUMNS)
      : DEFAULT_COLUMNS,
})

// Messages without an id of their own still need one.
let entryCount = 0
// The pane opens by itself once a session, at the first subagent.
let hasAutoOpened = false
// The next subagent's colour. Taken in one step as a subagent starts, so two
// started together cannot both read the same count before either is kept.
let nextColour = 0
// Whether the pane follows new messages: true until the person scrolls up,
// and again once they scroll back to the bottom.
let isFollowing = true

const nextKey = (prefix: string): string => `${prefix}-${(entryCount += 1)}`

function log($: EngineInterface, what: string, error: unknown) {
  $.ui.log(`agent-chat: ${what}: ${error}`, { to: 'debug' })
}

function openPane($: EngineInterface, settings: Settings) {
  $.ui
    .open({ id: PANE, title: PANE_TITLE, columns: settings.columns })
    .then(() => followNewest($))
    .catch(error => log($, 'could not open the pane', error))
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
    const now = await $.clock.now()
    const known = usableAgents(await read($, agents))
    const parentAgent = known.find(agent => agent.id === e.parentAgentId)
    const agent: Subagent = {
      id: started.agentId,
      type: e.name ?? e.subagentType,
      name: nameFor(known, e.name ?? e.subagentType, colour),
      parent: parentAgent?.name ?? 'main',
      colour,
      status: 'running',
      startedAt: now,
      endedAt: null,
    }
    await update($, agents, list => addAgent(usableAgents(list), agent))
    await update($, feed, list => appendEntry(usableFeed(list), { kind: 'handoff', key: nextKey('handoff'), agentId: agent.id, text: cleanText(e.prompt) }))
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
      const now = await $.clock.now()
      const status = e.reason === 'answer' ? 'done' : 'failed'
      await update($, agents, list => endAgent(usableAgents(list), agent.id, status, now))
      await update($, feed, list =>
        appendEntry(usableFeed(list), { kind: 'return', key: nextKey('return'), agentId: agent.id, status, durationMs: now - agent.startedAt, text: cleanText(e.answer) }),
      )
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
      feed: usableFeed(await read($, feed)),
      agents: usableAgents(await read($, agents)),
      columns: e.props.bodyColumns,
    }),
  )
}
