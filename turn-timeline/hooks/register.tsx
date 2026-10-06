import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TimelineCall, TimelineTurn } from '../types'
import { renderCard } from './card'
import { summarize } from './summary'
import type { Places } from './summary'
import { addCall, endTurn, finishCall, noteOf, outcomeOf, startTurn } from './timeline'

// Cards kept for the session; the oldest is dropped past this many.
const MAX_CARDS = 100
const DEFAULT_COLUMNS = 80
const MAX_CARD_COLUMNS = 110
// The transcript indents a reply's text under its bullet.
const MESSAGE_INDENT = 2
// The most text a Markdown element draws; a longer block keeps no card.
const MAX_MARKDOWN_CHARS = 10_000
const REPLY_BULLET = '⏺ '

// A copy of each card the host keeps, so cards outlive a reload of the mod.
const card = atom({ plugin: 'turn-timeline', key: 'card' } as const, null)

// The transcript draws a block of reply text as soon as its row is stored
// and does not draw it again, so its card must be ready at that moment:
// everything a card needs is kept here, where it is read without waiting.
let live: TimelineTurn | null = null
const cards = new Map<string, TimelineTurn>()
const cardsByText = new Map<string, TimelineTurn>()
// The calls some card shows, by tool_use_id: their folded summary line is
// left out, since the card says the same.
const carded = new Set<string>()
// Where the running turn's current stretch begins: the calls made since
// the last block of reply text.
let stretchFrom = 0
// Calls without a tool_use_id still need an id of their own.
let callCount = 0
// Where file paths are shown from, read when the session starts.
let places: Places = { cwd: '', home: '' }

// The home folder, for `~/…` paths. Reading it must never stop the mod:
// without it, paths outside the project show in full.
async function readHome($: EngineInterface): Promise<string> {
  try {
    return (await $.env.get('HOME')) ?? ''
  } catch (error) {
    $.ui.log(`turn-timeline could not read HOME: ${error}`, { to: 'debug' })
    return ''
  }
}

// A stored row and the text it draws share the first four parts of their
// ids; the transcript numbers the row's blocks in the last part
// (`5c7d2e8d-b25d-43ea-ba24-b34b0a2a29cd` draws as `…-ba24-000000000000`).
export const rowKey = (id: string): string => id.split('-').slice(0, 4).join('-')

const TEXT_KEY_CHARS = 200

// A second way to find a card: by the start of the text it sits above. The
// desktop app names a text block by its API message (`msg_…-t0`), which
// shares nothing with the stored row's id.
const textKey = (text: string): string => text.trim().slice(0, TEXT_KEY_CHARS)

const textOf = (content: unknown): string =>
  Array.isArray(content)
    ? content
        .filter(block => block?.type === 'text' && typeof block.text === 'string')
        .map(block => block.text as string)
        .join('\n')
    : ''

const hasText = (content: unknown): boolean =>
  Array.isArray(content) &&
  content.some(block => block?.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '')

// Takes the calls made since the last block of text as a card, or none.
function takeStretch(): TimelineTurn | undefined {
  if (live === null) return undefined
  const calls = live.calls.slice(stretchFrom)
  if (calls.length === 0) return undefined
  // The card spans the calls themselves, not the thinking before them.
  const startedAt = Math.min(...calls.map(call => call.startedAt))
  const endedAt = Math.max(...calls.map(call => call.endedAt ?? call.startedAt))
  stretchFrom = live.calls.length
  return endTurn({ ...live, startedAt, calls }, endedAt)
}

// Keeps a card in memory at once, then a copy with the host for reloads.
function keepCard($: EngineInterface, rowId: string, text: string, stretch: TimelineTurn) {
  const id = rowKey(rowId)
  cards.set(id, stretch)
  if (textKey(text) !== '') cardsByText.set(textKey(text), stretch)
  for (const call of stretch.calls) carded.add(call.id)
  const dropped = [...cards.keys()].slice(0, Math.max(cards.size - MAX_CARDS, 0))
  for (const old of dropped) {
    const dropping = cards.get(old)
    for (const call of dropping?.calls ?? []) carded.delete(call.id)
    for (const [key, kept] of cardsByText) if (kept === dropping) cardsByText.delete(key)
    cards.delete(old)
  }
  update($, memberOf(card, { requestId: id }), () => stretch).catch(error =>
    $.ui.log(`turn-timeline could not keep a card: ${error}`, { to: 'debug' }),
  )
}

// A card found by its text is taken once and kept under the block's own id,
// so a later reply with the same words ("Done.") does not show it again.
function claimByText(id: string, text: string): TimelineTurn | undefined {
  const key = textKey(text)
  const stretch = cardsByText.get(key)
  if (stretch === undefined) return undefined
  cardsByText.delete(key)
  cards.set(id, stretch)
  return stretch
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    places = { cwd: e.cwd, home: await readHome($) }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const time = await $.clock.now()
    live = startTurn(e.turnId, time)
    stretchFrom = 0
    return next(e)
  })

  // A block of reply text gets a card for the calls made since the last one.
  on('session.append', { door: 'response' }, ($, e, next) => {
    if (e.agentId === undefined && e.message.type === 'assistant' && hasText(e.message.content)) {
      const stretch = takeStretch()
      if (stretch !== undefined) keepCard($, e.uuid, textOf(e.message.content), stretch)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (live === null) return next(e)

    callCount += 1
    const startedAt = await $.clock.now()
    const summary = summarize(e.tool, e as unknown as Readonly<Record<string, unknown>>, places)
    const call: TimelineCall = {
      id: e.tool_use_id ?? `${e.tool}-${startedAt}-${callCount}`,
      tool: e.tool,
      summary: summary.text,
      isPath: summary.isPath,
      ...(summary.description === undefined ? {} : { description: summary.description }),
      isSubagent: e.agentId !== undefined,
      startedAt,
      endedAt: null,
      outcome: 'running',
    }
    live = addCall(live, call)

    try {
      const ran = await next(e)
      const endedAt = await $.clock.now()
      if (live !== null) live = finishCall(live, call.id, outcomeOf(ran), endedAt, noteOf(ran))
      return ran
    } catch (error) {
      const endedAt = await $.clock.now()
      if (live !== null) live = finishCall(live, call.id, 'error', endedAt)
      throw error
    }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && live !== null) {
      live = endTurn(live, await $.clock.now())
    }
    return next(e)
  })

  // `Ran 1 shell command` repeats what a card shows: once every call it
  // folds is on a card, it is drawn as nothing. Unfolded (ctrl+o) it stays.
  on('ui.render', { component: 'ToolGroup' }, ($, e, next) => {
    const ids = e.props.calls.map(call => call.tool_use_id)
    const isCarded = ids.length > 0 && ids.every(id => id !== undefined && carded.has(id))
    if (e.props.isActive || e.props.isExpanded || !isCarded) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const id = rowKey(e.requestId)
    const stretch = cards.get(id) ?? claimByText(id, e.props.text) ?? (await read($, memberOf(card, { requestId: id })))
    if (stretch === null || e.props.text.length > MAX_MARKDOWN_CHARS) return next(e)

    // The engine's own drawing of the text cannot sit inside a plugin's tree,
    // so the text is drawn here, as the transcript draws a reply.
    const table = $.ui.resolve(e)
    const { Box, Markdown, Text } = table
    const Svg = e.surface === 'desktop' && 'Svg' in table ? table.Svg : undefined
    const columns = Math.min((e.viewport?.columns ?? DEFAULT_COLUMNS) - MESSAGE_INDENT, MAX_CARD_COLUMNS)

    return (
      <Box flexDirection="column">
        {renderCard({ Box, Text, Svg }, { turn: stretch, columns })}
        <Box>
          {e.props.isFirstOfReply ? <Text>{REPLY_BULLET}</Text> : null}
          <Box flexDirection="column" flexGrow={1}>
            <Markdown text={e.props.text} />
          </Box>
        </Box>
      </Box>
    )
  })
}
