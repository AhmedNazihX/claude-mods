import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PALETTE, cleanName, cleanText, firstLines, formatDuration, formatTokens, modelName, nameFor, usableAgents } from './feed'

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
      const all = await paneText($, surface)
      expect(all).toContain('Handed **back**.')
      expect(all).not.toContain('(no text)')
    })

    test('takes the report a sync Agent call returns', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      await spawn($, 'Sync')
      await finish($, 'id-Sync', '')
      await $.tool.call({ tool: 'Agent', prompt: 'go', description: 'Sync', subagent_type: 'Explore' } as never)
      expect(await paneText($, surface)).toContain('Sync report.')
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
      expect(await paneText($, surface)).toContain('Last words.')
    })

    test('rules the task off from the report on the terminal only', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      await spawn($, 'Ruled')
      await finish($, 'id-Ruled', 'Done.')
      expect((await paneText($, surface)).includes('────')).toBe(surface === 'terminal')
    })

    test('shows the model and counts tools, skills and agents live, then the tokens', async ($, on) => {
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
      const done = await textOf(ui)
      expect(done).toContain('haiku 4.5 · 4 tools · 1 skill · 1 agent')
      expect(done).toContain('12k tokens · 2k in · 400 out · 10k cache read · 0 cache write')
    })

    test('counts tokens request by request while a subagent works, and not twice at the end', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      // Each model request of the subagent ends with its usage.
      on('turn.step', async function* ($, e) {
        return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...USAGE } } as never
      })
      await spawn($, 'Live')
      const ui = await mountPane($, surface)
      const step = (index: number) => drain($.turn.step({ turnId: 't', index, model: 'haiku', messageCount: 1, agentId: 'id-Live' } as never))
      await step(0)
      expect(await textOf(ui)).toContain('12k tokens · 2k in · 400 out')
      await step(1)
      expect(await textOf(ui)).toContain('25k tokens · 4k in · 800 out')
      await finish($, 'id-Live', 'Done.')
      expect(await textOf(ui)).toContain('25k tokens · 4k in · 800 out')
    })

    test('names the subagent that started a nested one, and marks a run cut short', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      await spawn($, 'Outer', 'Go.', 'general-purpose')
      await spawn($, 'Inner', 'Look.', 'Explore', 'id-Outer')
      await finish($, 'id-Inner', 'partial', 'aborted')
      const all = await paneText($, surface)
      expect(all).toContain('general-purpose asked')
      expect(all).toContain('stopped · ')
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
    // A count kept as one number has no split, so it is left out.
    expect(usableAgents([{ ...old, tokens: 12_000 }])[0]?.tokens).toBeNull()
  })

  test('cleans model text and names', () => {
    expect(cleanText(`a${String.fromCharCode(27)}[2Jb\n\n\n\nc  `)).toBe('a[2Jb\n\nc')
    expect(cleanText('safe\roverwrite')).toBe('safeoverwrite')
    expect(cleanName(`Exp${String.fromCharCode(27)}]0;x${String.fromCharCode(7)}lore\nname`)).toBe('Exp]0;xlore name')
    expect(cleanName('')).toBe('agent')
    expect(formatDuration(65_000)).toBe('1m 05s')
  })
})
