import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PALETTE, cleanName, cleanText, firstLines, formatDuration, nameFor, usableAgents } from './feed'

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

// What the mod wrote to the debug log, across the file's tests.
const logged: string[] = []

// The engine beneath the mod: a spawn starts a subagent with an id from its
// task's description; a run ends with the answer it is given.
const engineBeneath = (on: On, opened: unknown[] = []) => {
  on('agent.spawn', ($, e) => ({ agentId: `id-${e.description}`, model: 'haiku' }) as never)
  on('tool.call', () => ({ result: {}, text: 'ok' }) as never)
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

const finish = ($: Engine, agentId: string, answer: string, reason = 'answer') =>
  $.turn.complete({ answer, durationMs: 1, isAborted: reason === 'aborted', turnId: 't', reason, agentId } as never)

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

  test('cleans model text and names', () => {
    expect(cleanText(`a${String.fromCharCode(27)}[2Jb\n\n\n\nc  `)).toBe('a[2Jb\n\nc')
    expect(cleanText('safe\roverwrite')).toBe('safeoverwrite')
    expect(cleanName(`Exp${String.fromCharCode(27)}]0;x${String.fromCharCode(7)}lore\nname`)).toBe('Exp]0;xlore name')
    expect(cleanName('')).toBe('agent')
    expect(formatDuration(65_000)).toBe('1m 05s')
  })
})
