import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PALETTE, cleanName, cleanText, formatDuration, nameFor, usableAgents, usableFeed } from './feed'
import { wrap } from './pane'

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

// The engine beneath the mod: a spawn starts a subagent with an id from its
// task's description; a run ends with the answer it is given.
// What the mod wrote to the debug log, across the file's tests.
const logged: string[] = []

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

const mountPane = ($: Engine, surface: Surface, rows = 40) =>
  $.ui.mount({
    plugin: 'agent-chat',
    surface,
    component: 'Pane',
    requestId: 'agent-chat',
    props: { title: 'Agent chat', isFocused: false, bodyColumns: 70, placement: 'dock' } as never,
    viewport: { columns: 70, rows } as never,
  })

type Mounted = Awaited<ReturnType<typeof mountPane>>
const textOf = async (ui: Mounted) => (await ui.findAll({ type: 'Text' })).map(found => found.text).join('|')

const paneText = async ($: Engine, surface: Surface, rows = 40) => textOf(await mountPane($, surface, rows))

for (const surface of SURFACES) {
  describe(`the pane (${surface})`, () => {
    test('waits for the first subagent', async ($, on) => {
      engineBeneath(on)
      expect(await paneText($, surface)).toContain('No subagents yet')
    })

    test('shows the task handed over and the report sent back, under a name from the task', async ($, on) => {
      const clock = mock.clock(on, { now: 0 })
      engineBeneath(on)
      await spawn($, 'Find the band', 'In cache-status, find where the band is drawn.')
      const ui = await mountPane($, surface)
      expect(await textOf(ui)).toContain('⋯ working')
      await clock.advance(22_000)
      await finish($, 'id-Find the band', 'It is drawn in register.tsx:137.')
      // The same pane, drawn again as the report arrives.
      const all = await textOf(ui)
      expect(all).toContain('0 running · 1 finished')
      expect(all).toContain('main| → |● Explore')
      expect(all).toContain('In cache-status, find where the band is drawn.')
      expect(all).toContain('● Explore| → |main|   done| · 22s')
      expect(all).toContain('It is drawn in register.tsx:137.')
      expect(all).not.toContain('⋯ working')
    })

    test('tells two subagents of a type apart by colour', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      await spawn($, 'Find the band')
      await spawn($, 'List the hooks')
      const ui = await mountPane($, surface)
      expect(await textOf(ui)).toContain('2 running · 0 finished')
      const names = (await ui.findAll({ type: 'Text' })).filter(found => found.text === '● Explore')
      const colours = new Set(names.map(found => found.props.color))
      expect(colours).toEqual(new Set([PALETTE[0], PALETTE[1]]))
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

    test('cuts a long report to its first lines and counts the rest', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      await spawn($, 'Long')
      await finish($, 'id-Long', Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n'))
      const all = await paneText($, surface)
      expect(all).toContain('line 6')
      expect(all).not.toContain('line 7')
      expect(all).toContain('… 4 more lines')
    })

    test('names the subagent that started a nested one, and marks a run cut short', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      await spawn($, 'Outer', 'Go.', 'general-purpose')
      await spawn($, 'Inner', 'Look.', 'Explore', 'id-Outer')
      await finish($, 'id-Inner', 'partial', 'aborted')
      const all = await paneText($, surface)
      expect(all).toContain('general-purpose| → |● Explore')
      expect(all).toContain('stopped')
    })

    test('draws every message for the pane to scroll, and follows the newest', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      for (const name of ['first', 'second', 'third', 'fourth']) await spawn($, name)
      const all = await paneText($, surface, 8)
      expect(all).toContain('Please first.')
      expect(all).toContain('Please fourth.')
      // The kit has no window to scroll, so each move the mod asks for comes
      // back unanswered and is logged; that it asked is what is checked.
      expect(logged.filter(line => line.includes('could not scroll the pane')).length).toBeGreaterThan(0)
    })

    test('gives subagents started at the same moment different colours', async ($, on) => {
      mock.clock(on, { now: 0 })
      engineBeneath(on)
      await Promise.all([spawn($, 'one'), spawn($, 'two'), spawn($, 'three')])
      const ui = await mountPane($, surface)
      const names = (await ui.findAll({ type: 'Text' })).filter(found => found.text === '● Explore')
      expect(new Set(names.map(found => found.props.color)).size).toBe(3)
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
  const agent = (type: string, colour: number) => ({ id: `${type}${colour}`, type, name: type, parent: 'main', colour, status: 'running' as const, startedAt: 0, endedAt: null })

  test('nameFor gives the type, numbered only when its colour comes round again', () => {
    expect(nameFor([], 'Explore', 0)).toBe('Explore')
    expect(nameFor([agent('Explore', 0)], 'Explore', 1)).toBe('Explore')
    const lap = PALETTE.map((_, colour) => agent('Explore', colour))
    expect(nameFor(lap, 'Explore', PALETTE.length)).toBe('Explore #2')
    expect(nameFor(lap, 'Plan', PALETTE.length)).toBe('Plan')
  })

  test('wrap breaks at spaces and splits words longer than the width', () => {
    expect(wrap('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc'])
    expect(wrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
    expect(wrap('one\n\ntwo', 10)).toEqual(['one', '', 'two'])
  })

  test('leaves out what an older version stored', () => {
    const old = [
      { kind: 'tool', key: 't1', agentId: 'a', tool: 'Bash', summary: 'ls', isPath: false, outcome: 'ok' },
      { kind: 'say', key: 's1', agentId: 'a', text: 'hi' },
      { kind: 'handoff', key: 'h1', agentId: 'a', text: 'Go.' },
      null,
    ]
    expect(usableFeed(old).map(entry => entry.key)).toEqual(['h1'])
    expect(usableAgents([{ id: 'a', label: 'Explore' }, { id: 'b', type: 'Explore', name: 'Find' }]).map(agent => agent.id)).toEqual(['b'])
  })

  test('cleanText drops control characters and extra blank lines', () => {
    expect(cleanText(`a${String.fromCharCode(27)}[2Jb\n\n\n\nc  `)).toBe('a[2Jb\n\nc')
    expect(cleanText('safe\roverwrite')).toBe('safeoverwrite')
    expect(cleanName(`Exp${String.fromCharCode(27)}]0;x${String.fromCharCode(7)}lore\nname`)).toBe('Exp]0;xlore name')
    expect(cleanName('')).toBe('agent')
    expect(formatDuration(65_000)).toBe('1m 05s')
  })
})
