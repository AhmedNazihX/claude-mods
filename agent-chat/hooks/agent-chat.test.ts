import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PALETTE, cleanName, cleanText, finishAgent, firstLines, formatDuration, formatTokens, isCardOpen, keptCards, keptSections, latestReport, modelName, nameFor, resumeAgent, stopAgents, stoppedIds, summaryOf, usableAgents, usableCards } from './feed'
import type { FollowUp, Subagent } from '../types'

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

// What the mod wrote to the debug log, across the file's tests.
const logged: string[] = []

// The engine beneath the mod: a spawn starts a subagent with an id from its
// task's description; a run ends with the answer it is given.
const engineBeneath = (on: On, opened: unknown[] = []) => {
  on('agent.spawn', ($, e) => ({ agentId: `id-${e.description}`, model: 'claude-haiku-4-5-20251001' }) as never)
  on('tool.call', ($, e) => {
    // A sync Agent call returns the subagent's report in its result.
    if (e.tool === 'Agent') {
      return { result: { agentId: 'id-Sync', content: [], handbackReport: { text: 'Sync report.' } }, text: '' } as never
    }
    return { result: {}, text: 'ok' } as never
  })
  on('turn.complete', ($, e) => ({ text: e.answer }) as never)
  on('ui.open', ($, e) => {
    opened.push(e)
    return { value: { isPlaced: true } } as never
  })
  on('ui.log', ($, e) => {
    logged.push(String((e as { text?: unknown }).text ?? JSON.stringify(e)))
    return { value: undefined } as never
  })
}

const spawn = ($: Engine, description: string, prompt = `Please ${description}.`, subagentType = 'Explore', parentAgentId?: string) =>
  $.agent.spawn({ prompt, description, subagentType, ...(parentAgentId === undefined ? {} : { parentAgentId }) } as never)

// The session's agents as `$.agent.list()` answers them: each status the test
// gives, by id; the calls counted, so a test can tell the ticker stopped.
const listAgents = (on: On, statuses: () => Readonly<Record<string, string>>) => {
  const calls = { count: 0 }
  on('agent.list', () => {
    calls.count += 1
    return { value: Object.entries(statuses()).map(([id, status]) => ({ id, status, description: '', type: 'Explore' })) } as never
  })
  return calls
}

// A plugin beside the mod that reads out the card states it keeps: any
// plugin reads another's state, and the kit's engine has none of its own.
// It loads as a module of its own, so it names everything in place.
const peek = {
  name: 'agent-chat-peek',
  register: (on: On) => {
    on('command.run', { command: 'agent-chat-peek' }, async $ => {
      const cards = await $.state.get({ plugin: 'agent-chat', key: 'cards' })
      const expanded = await $.state.get({ plugin: 'agent-chat', key: 'expanded' })
      return { text: JSON.stringify({ cards: cards.value ?? {}, expanded: expanded.value ?? [] }) }
    })
  },
}

// The engine beneath delivers each message, or refuses it.
const deliverMessages = (on: On, isDelivered = true) =>
  on('session.send', () => (isDelivered ? { isDelivered } : { isDelivered, reason: 'nobody by that name' }) as never)

// Claude's SendMessage to a subagent, by its id or by its name.
const message = ($: Engine, to: string, text: string) => $.session.send({ to, text } as never)

const peekState = async ($: Engine) => JSON.parse((await $.command.run({ command: 'agent-chat-peek', args: '' } as never) as { text: string }).text)

const USAGE = { input_tokens: 2000, output_tokens: 400, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 0, model: 'claude-haiku-4-5-20251001' }

const finish = ($: Engine, agentId: string, answer: string, reason = 'answer') =>
  $.turn.complete({ answer, durationMs: 1, isAborted: reason === 'aborted', turnId: 't', reason, agentId, usage: USAGE } as never)

// Runs a streaming call to its end, whatever form the kit hands it back in.
const drain = async (call: unknown): Promise<void> => {
  const stream = await (call as Promise<unknown>)
  if (stream !== null && typeof stream === 'object' && Symbol.asyncIterator in stream) {
    for await (const _chunk of stream as AsyncIterable<unknown>) {
      // Each chunk passes; only the end matters here.
    }
  }
}

// Each model request of a subagent ends with its usage: the one for its index.
const answerSteps = (on: On, usages: readonly (typeof USAGE)[]) =>
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...usages[e.index] } } as never
  })

const step = ($: Engine, agentId: string, index: number) =>
  drain($.turn.step({ turnId: 't', index, model: 'haiku', messageCount: 1, agentId } as never))

const mountPane = ($: Engine, surface: Surface) =>
  $.ui.mount({
    plugin: 'agent-chat',
    surface,
    component: 'Pane',
    requestId: 'agent-chat',
    props: { title: 'Agent chat', isFocused: false, bodyColumns: 70, placement: 'dock' } as never,
    viewport: { columns: 70, rows: 40 } as never,
  })

type Mounted = Awaited<ReturnType<typeof mountPane>>

// Everything the pane says: its text, its markdown and its buttons, in order.
const textOf = async (ui: Mounted) => {
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  const markdown = (await ui.findAll({ type: 'Markdown' })).map(found => String(found.props.text))
  const buttons = (await ui.findAll({ type: 'Button' })).map(found => String(found.props.label))
  return [...texts, ...markdown, ...buttons].join('|')
}

const paneText = async ($: Engine, surface: Surface) => textOf(await mountPane($, surface))

// Opens or shuts a subagent's card, as a click on its header does.
const pressCard = (ui: Mounted, agentId: string) => ui.press({ key: `${agentId}-card-toggle` } as never)

// The pane's text with the given finished cards opened, as a person reads them.
const openedText = async ($: Engine, surface: Surface, ...agentIds: string[]) => {
  const ui = await mountPane($, surface)
  for (const id of agentIds) await pressCard(ui, id)
  return textOf(ui)
}

for (const surface of SURFACES) {
  describe(`the pane (${surface})`, () => {
    test('waits for the first subagent', async ($, on) => {
      engineBeneath(on)
      expect(await paneText($, surface)).toContain('No subagents yet')
    })

    test('shows one card with the task handed over and, once back, the report', async ($, on) => {
      const clock = mock.clock(on, { now: 0 })
      engineBeneath(on)
      await spawn($, 'Find the band', 'In **cache-status**, find where the band is drawn.')
      const ui = await mountPane($, surface)
      const working = await textOf(ui)
      expect(working).toContain('● Explore')
      expect(working).toContain('main asked')
      expect(working).toContain('In **cache-status**, find where the band is drawn.')
      expect(working).toContain('⋯ working')
      await clock.advance(22_000)
      await finish($, 'id-Find the band', 'It is drawn in `register.tsx:137`.')
      await pressCard(ui, 'id-Find the band')
      const done = await textOf(ui)
      expect(done).toContain('0 working · 1 finished')
      expect(done).toContain('done · 22s')
      expect(done).toContain('Explore replied')
      expect(done).toContain('It is drawn in `register.tsx:137`.')
      expect(done).not.toContain('⋯ working')
    })

    test('counts the time of a subagent still at work', async ($, on) => {
      const clock = mock.clock(on, { now: 0 })
      engineBeneath(on)
      await spawn($, 'Slow')
      const ui = await mountPane($, surface)
      await clock.advance(8000)
      expect(await textOf(ui)).toContain('working · 8s')
    })

    test('tells two subagents of a type apart by colour, started together or not', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      await Promise.all([spawn($, 'one'), spawn($, 'two'), spawn($, 'three')])
      const ui = await mountPane($, surface)
      expect(await textOf(ui)).toContain('3 working · 0 finished')
      const names = (await ui.findAll({ type: 'Text' })).filter(found => found.text === '● Explore')
      expect(new Set(names.map(found => found.props.color))).toEqual(new Set([PALETTE[0], PALETTE[1], PALETTE[2]]))
    })

    test('opens a long report in full and shuts it again', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      await spawn($, 'Long')
      await finish($, 'id-Long', Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n'))
      const ui = await mountPane($, surface)
      await pressCard(ui, 'id-Long')
      const short = await textOf(ui)
      expect(short).toContain('line 6')
      expect(short).not.toContain('line 7')
      expect(short).toContain('▾ show 4 more lines')
      await ui.press({ key: 'id-Long-report-toggle' } as never)
      const full = await textOf(ui)
      expect(full).toContain('line 10')
      expect(full).toContain('▴ show less')
      await ui.press({ key: 'id-Long-report-toggle' } as never)
      expect(await textOf(ui)).not.toContain('line 10')
    })

    test('leaves out what a subagent does along the way, and the main conversation', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      await spawn($, 'Busy')
      await $.tool.call({ tool: 'Bash', command: 'sub work', agentId: 'id-Busy' } as never)
      await $.tool.call({ tool: 'Bash', command: 'main work' } as never)
      const all = await paneText($, surface)
      expect(all).not.toContain('sub work')
      expect(all).not.toContain('main work')
    })

    test('takes the report a subagent hands back through its tool, when its final text is empty', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      await spawn($, 'Hand')
      await $.tool.call({ tool: 'SubagentHandback', report: 'Handed **back**.', agentId: 'id-Hand' } as never)
      await finish($, 'id-Hand', '')
      const all = await openedText($, surface, 'id-Hand')
      expect(all).toContain('Handed **back**.')
      expect(all).not.toContain('(no text)')
    })

    test('takes the report a sync Agent call returns', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      await spawn($, 'Sync')
      await finish($, 'id-Sync', '')
      await $.tool.call({ tool: 'Agent', prompt: 'go', description: 'Sync', subagent_type: 'Explore' } as never)
      expect(await openedText($, surface, 'id-Sync')).toContain('Sync report.')
    })

    test('falls back to the last thing a subagent said', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      await spawn($, 'Quiet')
      try {
        await $.session.append({ message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'Last words.' }] }, door: 'response', origin: { kind: 'model' }, uuid: 'u1', agentId: 'id-Quiet' } as never)
      } catch {
        // Expected: nothing beneath stores the row.
      }
      await finish($, 'id-Quiet', '')
      expect(await openedText($, surface, 'id-Quiet')).toContain('Last words.')
    })

    test('rules the task off from the report on the terminal only', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      await spawn($, 'Ruled')
      await finish($, 'id-Ruled', 'Done.')
      expect((await openedText($, surface, 'id-Ruled')).includes('────')).toBe(surface === 'terminal')
    })

    test('shows the model and counts tools, skills and agents live', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      await spawn($, 'Counted')
      const ui = await mountPane($, surface)
      expect(await textOf(ui)).toContain('haiku 4.5 · 0 tools · 0 skills · 0 agents')
      for (const tool of ['Read', 'Grep', 'Skill', 'Agent']) {
        await $.tool.call({ tool, agentId: 'id-Counted' } as never)
      }
      expect(await textOf(ui)).toContain('haiku 4.5 · 4 tools · 1 skill · 1 agent')
      await finish($, 'id-Counted', 'Done.')
      await pressCard(ui, 'id-Counted')
      const done = await textOf(ui)
      expect(done).toContain('haiku 4.5 · 4 tools · 1 skill · 1 agent')
      // The run's usage sums every request, so it is not drawn as tokens.
      expect(done).not.toContain('tokens')
    })

    test('shows the last request of a subagent as its tokens, live, as Claude Code counts them, not a sum', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      // The context grows: the second request reads more from the cache.
      answerSteps(on, [USAGE, { ...USAGE, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 1000 }])
      await spawn($, 'Live')
      const ui = await mountPane($, surface)
      await step($, 'id-Live', 0)
      // 2k in + 10k cache read + 0 cache write + 400 out.
      expect(await textOf(ui)).toContain('12k tokens')
      await step($, 'id-Live', 1)
      // 2k + 20k + 1k + 400, not the 36k of both added up.
      expect(await textOf(ui)).toContain('23k tokens')
      await finish($, 'id-Live', 'Done.')
      await pressCard(ui, 'id-Live')
      const done = await textOf(ui)
      expect(done).toContain('23k tokens')
      expect(done).not.toContain('36k')
    })

    test('names the subagent that started a nested one, and marks a run cut short', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      await spawn($, 'Outer', 'Go.', 'general-purpose')
      await spawn($, 'Inner', 'Look.', 'Explore', 'id-Outer')
      await finish($, 'id-Inner', 'partial', 'aborted')
      const all = await openedText($, surface, 'id-Inner')
      expect(all).toContain('general-purpose asked')
      expect(all).toContain('stopped · ')
    })

    test('shuts a finished card to a summary and opens it on a click', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      answerSteps(on, [USAGE])
      await spawn($, 'Folded', 'Find it.')
      await $.tool.call({ tool: 'Read', agentId: 'id-Folded' } as never)
      await step($, 'id-Folded', 0)
      await finish($, 'id-Folded', '## Found it\n\nIn **band.tsx**, see `renderBand`.')
      const ui = await mountPane($, surface)
      const shut = await textOf(ui)
      expect(shut).toContain('● Explore')
      expect(shut).toContain('done · ')
      expect(shut).toContain('▸')
      expect(shut).toContain('Folded')
      expect(shut).toContain('Found it In band.tsx, see renderBand.')
      expect(shut).toContain('1 tool · 12k tokens')
      expect(shut).not.toContain('main asked')
      expect(shut).not.toContain('Explore replied')
      await pressCard(ui, 'id-Folded')
      const open = await textOf(ui)
      expect(open).toContain('▾')
      expect(open).toContain('main asked')
      expect(open).toContain('In **band.tsx**, see `renderBand`.')
      await pressCard(ui, 'id-Folded')
      expect(await textOf(ui)).not.toContain('Explore replied')
    })

    test('keeps a running card open, and one shut by hand stays shut when it finishes', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      await spawn($, 'Busy one', 'Work on it.')
      await spawn($, 'Busy two', 'Work on that.')
      const ui = await mountPane($, surface)
      const working = await textOf(ui)
      expect(working).toContain('Work on it.')
      expect(working).toContain('Work on that.')
      await pressCard(ui, 'id-Busy one')
      expect(await textOf(ui)).not.toContain('Work on it.')
      await finish($, 'id-Busy one', 'Done one.')
      await finish($, 'id-Busy two', 'Done two.')
      await pressCard(ui, 'id-Busy two')
      const done = await textOf(ui)
      expect(done).not.toContain('Work on it.')
      expect(done).toContain('Work on that.')
    })

    test('marks a card stopped once the session lists its subagent as killed, and stops the timers', async ($, on) => {
      const clock = mock.clock(on, { now: 0 })
      engineBeneath(on)
      let statuses: Record<string, string> = { 'id-Killed': 'running' }
      const listed = listAgents(on, () => statuses)
      await spawn($, 'Killed')
      try {
        await $.session.append({ message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'Halfway there.' }] }, door: 'response', origin: { kind: 'model' }, uuid: 'u1', agentId: 'id-Killed' } as never)
      } catch {
        // Expected: nothing beneath stores the row.
      }
      const ui = await mountPane($, surface)
      await clock.advance(2000)
      expect(await textOf(ui)).toContain('working · 2s')
      statuses = { 'id-Killed': 'killed' }
      await clock.advance(1000)
      const lookedAt = listed.count
      await clock.advance(5000)
      await pressCard(ui, 'id-Killed')
      const stopped = await textOf(ui)
      expect(stopped).toContain('stopped · 3s')
      expect(stopped).toContain('Halfway there.')
      expect(stopped).not.toContain('⋯ working')
      expect(listed.count).toBe(lookedAt)
    })

    test('keeps a card working through a reload while its subagent runs on, and stops only the one that ended', async ($, on) => {
      const clock = mock.clock(on, { now: 0 })
      engineBeneath(on)
      on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
      let statuses: Record<string, string> = { 'id-Running': 'running', 'id-Lost': 'running' }
      listAgents(on, () => statuses)
      await spawn($, 'Running')
      await spawn($, 'Lost')
      // A reload starts the session again: the cards still working stay so.
      await $.session.start({ cwd: '/', surface, isInteractive: true } as never)
      const ui = await mountPane($, surface)
      await clock.advance(2000)
      expect(await textOf(ui)).toContain('2 working · 0 finished')
      statuses = { 'id-Running': 'running', 'id-Lost': 'failed' }
      await clock.advance(2000)
      await pressCard(ui, 'id-Lost')
      const all = await textOf(ui)
      expect(all).toContain('1 working · 1 finished')
      expect(all).toContain('working · 4s')
      expect(all).toContain('stopped · 3s')
    })

    test('lets go of the open and shut states of the cards dropped off the end', { plugins: [peek] }, async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      const longTask = Array.from({ length: 10 }, (_, i) => `step ${i + 1}`).join('\n')
      await spawn($, 'Oldest', longTask)
      await spawn($, 'Next', longTask)
      const ui = await mountPane($, surface)
      for (const id of ['id-Oldest', 'id-Next']) {
        await pressCard(ui, id)
        await pressCard(ui, id)
        await ui.press({ key: `${id}-task-toggle` } as never)
      }
      expect(await peekState($)).toEqual({ cards: { 'id-Oldest': true, 'id-Next': true }, expanded: ['id-Oldest:task', 'id-Next:task'] })
      for (let i = 0; i < 49; i += 1) await spawn($, `more ${i}`)
      expect(await peekState($)).toEqual({ cards: { 'id-Next': true }, expanded: ['id-Next:task'] })
    })

    test('opens a finished card again when Claude messages its subagent, at the end, keeping both replies', async ($, on) => {
      const clock = mock.clock(on, { now: 0 })
      engineBeneath(on)
      deliverMessages(on)
      await spawn($, 'Review')
      await spawn($, 'Other')
      await clock.advance(5000)
      await finish($, 'id-Review', 'First pass done.')
      await finish($, 'id-Other', 'Other done.')
      await clock.advance(10_000)
      await message($, 'id-Review', 'Now fix the **two** nits.')
      await clock.advance(3000)
      const ui = await mountPane($, surface)
      const working = await textOf(ui)
      expect(working).toContain('1 working · 1 finished')
      expect(working).toContain('working · 3s')
      expect(working).toContain('First pass done.')
      expect(working).toContain('Now fix the **two** nits.')
      expect(working).toContain('⋯ working')
      // The card it came back to moves after the one that started later.
      const names = (await ui.findAll({ type: 'Text' })).filter(found => found.text === '● Explore')
      expect(names.map(found => found.props.color)).toEqual([PALETTE[1], PALETTE[0]])
      await finish($, 'id-Review', 'Fixed both.')
      const shut = await textOf(ui)
      expect(shut).toContain('done · 3s')
      expect(shut).toContain('Fixed both.')
      expect(shut).toContain('0 tools · 1 follow-up')
      await pressCard(ui, 'id-Review')
      const open = await textOf(ui)
      expect(open.split('main asked').length - 1).toBe(2)
      expect(open.split('Explore replied').length - 1).toBe(2)
      expect(open).toContain('First pass done.')
      expect(open).toContain('Fixed both.')
      expect(open).not.toContain('⋯ working')
    })

    test('finds the subagent a message names', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      on('agent.list', () => ({ value: [{ id: 'id-Named', status: 'completed', description: '', type: 'Explore', name: 'reviewer' }] }) as never)
      deliverMessages(on)
      await spawn($, 'Named')
      await finish($, 'id-Named', 'Done.')
      await message($, 'reviewer', 'One more thing.')
      const ui = await mountPane($, surface)
      const working = await textOf(ui)
      expect(working).toContain('1 working · 0 finished')
      expect(working).toContain('One more thing.')
    })

    test('leaves a finished card be when a message to it is not delivered', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      deliverMessages(on, false)
      await spawn($, 'Refused')
      await finish($, 'id-Refused', 'Done.')
      await message($, 'id-Refused', 'Never arrives.')
      const all = await openedText($, surface, 'id-Refused')
      expect(all).toContain('0 working · 1 finished')
      expect(all).not.toContain('Never arrives.')
    })

    test('opens a finished card again when its subagent starts a new run the pane saw no message for', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      answerSteps(on, [USAGE])
      await spawn($, 'Unseen')
      await finish($, 'id-Unseen', 'First.')
      await step($, 'id-Unseen', 0)
      const ui = await mountPane($, surface)
      expect(await textOf(ui)).toContain('1 working · 0 finished')
      await finish($, 'id-Unseen', 'Second.')
      await pressCard(ui, 'id-Unseen')
      const all = await textOf(ui)
      expect(all).toContain('First.')
      expect(all).toContain('Second.')
      expect(all).toContain('(no text)')
    })

    test('keeps a stopped subagent it messaged working while the list still says killed, and drops what its last run said', async ($, on) => {
      const clock = mock.clock(on, { now: 0 })
      engineBeneath(on)
      deliverMessages(on)
      let statuses: Record<string, string> = { 'id-Again': 'running' }
      listAgents(on, () => statuses)
      await spawn($, 'Again')
      await $.tool.call({ tool: 'SubagentHandback', report: 'Old handback.', agentId: 'id-Again' } as never)
      statuses = { 'id-Again': 'killed' }
      await clock.advance(1000)
      await message($, 'id-Again', 'Pick it up again.')
      await clock.advance(3000)
      const ui = await mountPane($, surface)
      const working = await textOf(ui)
      expect(working).toContain('1 working · 0 finished')
      expect(working).toContain('working · 3s')
      statuses = { 'id-Again': 'running' }
      await finish($, 'id-Again', 'New answer.')
      await pressCard(ui, 'id-Again')
      const done = await textOf(ui)
      expect(done).toContain('New answer.')
      expect(done.split('Old handback.').length - 1).toBe(1)
      expect(done).not.toContain('(no text)')
    })

    test('places a message once, whether the resumed run makes its first request after it or before', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      deliverMessages(on)
      answerSteps(on, [USAGE])
      await spawn($, 'After')
      await spawn($, 'Before')
      await finish($, 'id-After', 'First.')
      await finish($, 'id-Before', 'First.')
      await message($, 'id-After', 'Go on.')
      await step($, 'id-After', 0)
      await step($, 'id-Before', 0)
      await message($, 'id-Before', 'Go on.')
      await finish($, 'id-After', 'Second.')
      await finish($, 'id-Before', 'Second.')
      const all = await openedText($, surface, 'id-After', 'id-Before')
      expect(all.split('main asked').length - 1).toBe(4)
      expect(all).not.toContain('(no text)')
    })

    test('adds a message to a subagent still at work to its conversation, and leaves out one for nobody it knows', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      deliverMessages(on)
      listAgents(on, () => ({ 'id-Busy': 'running' }))
      await spawn($, 'Busy', 'Start here.')
      await message($, 'id-Busy', 'Also check the tests.')
      await message($, 'someone-else', 'Not for it.')
      const ui = await mountPane($, surface)
      const working = await textOf(ui)
      expect(working).toContain('Start here.')
      expect(working).toContain('Also check the tests.')
      expect(working).not.toContain('Not for it.')
      expect(working.split('⋯ working').length - 1).toBe(1)
      await finish($, 'id-Busy', 'Both done.')
      await pressCard(ui, 'id-Busy')
      const done = await textOf(ui)
      expect(done.split('Explore replied').length - 1).toBe(1)
      expect(done).toContain('Both done.')
    })

    test('follows the newest card', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      for (const name of ['first', 'second']) await spawn($, name)
      // The kit has no window to scroll, so each move the mod asks for comes
      // back unanswered and is logged; that it asked is what is checked.
      expect(logged.filter(line => line.includes('could not scroll the pane')).length).toBeGreaterThan(0)
    })
  })
}

describe('opening', () => {
  test('opens by itself at the first subagent, once', async ($, on) => {
    const opened: unknown[] = []
    mock.clock(on, { now: 0 })
    engineBeneath(on, opened)
    await spawn($, 'one')
    await spawn($, 'two')
    expect(opened).toEqual([expect.objectContaining({ id: 'agent-chat', columns: 60 })])
  })

  test('stays shut when auto-open is off', { options: { autoOpen: false } }, async ($, on) => {
    const opened: unknown[] = []
    mock.clock(on, { now: 0 })
    engineBeneath(on, opened)
    await spawn($, 'quiet')
    expect(opened).toEqual([])
  })
})

describe('helpers', () => {
  const agent = (type: string, colour: number) => ({
    id: `${type}${colour}`,
    type,
    name: type,
    description: '',
    parent: 'main',
    colour,
    status: 'running' as const,
    startedAt: 0,
    endedAt: null,
    task: 'go',
    report: null,
    model: '',
    tools: 0,
    skills: 0,
    agents: 0,
    tokens: null,
    followUps: [] as FollowUp[],
  })

  test('nameFor gives the type, numbered only when its colour comes round again', () => {
    expect(nameFor([], 'Explore', 0)).toBe('Explore')
    expect(nameFor([agent('Explore', 0)], 'Explore', 1)).toBe('Explore')
    const lap = PALETTE.map((_, colour) => agent('Explore', colour))
    expect(nameFor(lap, 'Explore', PALETTE.length)).toBe('Explore #2')
    expect(nameFor(lap, 'Plan', PALETTE.length)).toBe('Plan')
  })

  test('firstLines keeps the first lines and closes a fence it cuts', () => {
    expect(firstLines('a\nb', 5)).toEqual({ text: 'a\nb', hiddenLines: 0 })
    expect(firstLines('a\n```\ncode\nmore\n```', 3)).toEqual({ text: 'a\n```\ncode\n```', hiddenLines: 2 })
  })

  test('leaves out what an older version stored', () => {
    const old = [{ id: 'a', label: 'Explore' }, { id: 'b', type: 'Explore', name: 'Explore' }, agent('Explore', 3), null]
    expect(usableAgents(old).map(one => one.id)).toEqual(['Explore3'])
  })

  test('model names and token counts read short', () => {
    expect(modelName('claude-haiku-4-5-20251001')).toBe('haiku 4.5')
    expect(modelName('claude-opus-5-5')).toBe('opus 5.5')
    expect(modelName('custom-model')).toBe('custom-model')
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(1234)).toBe('1.2k')
    expect(formatTokens(2000)).toBe('2k')
    expect(formatTokens(12_400)).toBe('12k')
    expect(formatTokens(1_250_000)).toBe('1.3M')
  })

  test('cleans a model name before it is drawn', async () => {
    const esc = String.fromCharCode(27)
    expect(usableAgents([{ id: 'a', type: 'Explore', name: 'Explore', task: 'go', report: null, model: `ha${esc}]0;x\niku` }])[0]?.model).toBe('ha]0;x iku')
  })

  test('fills in the stats an older version did not store', () => {
    const old = { id: 'a', type: 'Explore', name: 'Explore', task: 'go', report: null }
    expect(usableAgents([old])[0]).toMatchObject({ model: '', tools: 0, skills: 0, agents: 0, tokens: null })
    // A count kept split by kind summed every request, so it is left out.
    expect(usableAgents([{ ...old, tokens: { input: 2000, output: 400, cacheRead: 10_000, cacheWrite: 0 } }])[0]?.tokens).toBeNull()
    expect(usableAgents([{ ...old, tokens: 12_400 }])[0]?.tokens).toBe(12_400)
    expect(usableAgents([old])[0]?.followUps).toEqual([])
    const kept = { from: 'main', message: 'More.', report: null }
    expect(usableAgents([{ ...old, followUps: [kept, { from: 'main' }, 'More.', null] }])[0]?.followUps).toEqual([kept])
  })

  test('a message opens a finished card again at the end, and its reply answers the message', () => {
    const done = { ...agent('Explore', 0), status: 'done' as const, endedAt: 5, report: 'First.' }
    const other = agent('Plan', 1)
    const message = { from: 'main', message: 'More.', report: null }
    const resumed = resumeAgent([done, other], 'Explore0', 9, message)
    expect(resumed.map(one => one.id)).toEqual(['Plan1', 'Explore0'])
    expect(resumed[1]).toMatchObject({ status: 'running', startedAt: 9, endedAt: null, report: 'First.', followUps: [message] })
    expect(done.status).toBe('done')
    const finished = finishAgent(resumed, 'Explore0', 'done', 12, 'Second.')
    expect(finished[1]).toMatchObject({ report: 'First.', followUps: [{ ...message, report: 'Second.' }] })
    expect(latestReport(finished[1] as Subagent)).toBe('Second.')
  })

  test('a run seen before its message waits for it, and a working card takes a message in place', () => {
    const done = { ...agent('Explore', 0), status: 'done' as const, endedAt: 5, report: 'First.' }
    const seen = resumeAgent([done], 'Explore0', 9)
    expect(seen[0]?.followUps).toEqual([{ from: 'main', message: '', report: null }])
    // Its run seen again while it works changes nothing.
    expect(resumeAgent(seen, 'Explore0', 10)).toEqual(seen)
    const message = { from: 'main', message: 'More.', report: null }
    const placed = resumeAgent(seen, 'Explore0', 10, message)
    expect(placed[0]).toMatchObject({ startedAt: 9, followUps: [message] })
    const other = agent('Plan', 1)
    expect(resumeAgent([other, ...placed], 'Explore0', 11, { ...message, message: 'And this.' }).map(one => one.id)).toEqual(['Plan1', 'Explore0'])
    expect(resumeAgent(placed, 'Explore0', 11, { ...message, message: 'And this.' })[0]?.followUps.length).toBe(2)
    expect(resumeAgent([other], 'missing', 11, message)).toEqual([other])
  })

  test('a card is open while its subagent works, shut once done, unless set by hand', () => {
    const agent = { id: 'a', status: 'running' } as Subagent
    const done = { ...agent, status: 'done' } as Subagent
    expect(isCardOpen(agent, {})).toBe(true)
    expect(isCardOpen(done, {})).toBe(false)
    expect(isCardOpen(done, { a: true })).toBe(true)
    expect(isCardOpen(agent, { a: false })).toBe(false)
  })

  test('summaryOf runs a report together as plain text and cuts it at a word', () => {
    expect(summaryOf('# Title\n\n- **one** [link](http://x)\n1. `two`', 100)).toBe('Title one link two')
    expect(summaryOf('alpha beta gamma delta', 12)).toBe('alpha beta…')
    expect(summaryOf('', 50)).toBe('')
  })

  test('keeps the card states and opened sections of the subagents still kept', () => {
    const kept = [agent('Explore', 1), agent('Plan', 2)]
    const cards = { Explore0: true, Explore1: false, Plan2: true }
    expect(keptCards(cards, kept)).toEqual({ Explore1: false, Plan2: true })
    expect(cards).toEqual({ Explore0: true, Explore1: false, Plan2: true })
    expect(keptSections(['Explore0:task', 'Explore1:report', 'Plan2:task', 'Plan2:report'], kept)).toEqual(['Explore1:report', 'Plan2:task', 'Plan2:report'])
    expect(keptSections(['a:b:task'], [{ ...agent('x', 0), id: 'a:b' }])).toEqual(['a:b:task'])
  })

  test('stops only the running cards whose subagent is listed killed or failed', () => {
    const running = agent('Explore', 0)
    const done = { ...agent('Plan', 1), status: 'done' as const, endedAt: 5, report: 'Done.' }
    const listed = [
      { id: 'Explore0', status: 'killed' },
      { id: 'Plan1', status: 'killed' },
      { id: 'Other', status: 'failed' },
    ]
    expect(stoppedIds([running, done], listed, 0)).toEqual(new Set(['Explore0']))
    expect(stoppedIds([running], [{ id: 'Explore0', status: 'failed' }], 0)).toEqual(new Set(['Explore0']))
    for (const status of ['running', 'idle', 'waiting', 'completed']) {
      expect(stoppedIds([running], [{ id: 'Explore0', status }], 0).size).toBe(0)
    }
    // A card just messaged again is left be while the list still shows its last run's end.
    const resumed = { ...running, startedAt: 100, followUps: [{ from: 'main', message: 'More.', report: null }] }
    expect(stoppedIds([resumed], [{ id: 'Explore0', status: 'killed' }], 4000).size).toBe(0)
    expect(stoppedIds([resumed], [{ id: 'Explore0', status: 'killed' }], 6000)).toEqual(new Set(['Explore0']))
    const after = stopAgents([running, done], new Set(['Explore0', 'Plan1']), 9, id => `${id} said`)
    expect(after).toEqual([{ ...running, status: 'failed', endedAt: 9, report: 'Explore0 said' }, done])
    expect(running.status).toBe('running')
  })

  test('leaves out card states that are not a yes or no', () => {
    expect(usableCards({ a: true, b: false, c: 'yes', d: null })).toEqual({ a: true, b: false })
    expect(usableCards(null)).toEqual({})
    expect(usableCards('cards')).toEqual({})
  })

  test('cleans model text and names', () => {
    expect(cleanText(`a${String.fromCharCode(27)}[2Jb\n\n\n\nc  `)).toBe('a[2Jb\n\nc')
    expect(cleanText('safe\roverwrite')).toBe('safeoverwrite')
    expect(cleanName(`Exp${String.fromCharCode(27)}]0;x${String.fromCharCode(7)}lore\nname`)).toBe('Exp]0;xlore name')
    expect(cleanName('')).toBe('agent')
    expect(formatDuration(65_000)).toBe('1m 05s')
  })
})
