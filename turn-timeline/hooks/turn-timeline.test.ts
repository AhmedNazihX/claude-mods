import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { fit, fitStart, formatDuration, formatOffset } from './format'
import { toSettings } from './settings'
import { displayPath, printable, summarize, toolLabel } from './summary'
import { addCall, endTurn, finishCall, outcomeOf, startTurn, toolCounts } from './timeline'

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

const PANE_PROPS = { title: 'Turn timeline', isFocused: false, bodyColumns: 80, placement: 'dock' }

// The engine beneath the mod: a turn starts and ends, and each tool call is
// answered after the mocked clock moves on, or refused for one tool.
const engineBeneath = (on: On, clock: { advance: (ms: number) => Promise<void> }) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', async ($, e) => {
    if (e.tool === 'Write') return { deny: 'not here' }
    await clock.advance(e.tool === 'Bash' ? 42_000 : 300)
    return { result: {}, text: 'ok', isError: e.tool === 'WebFetch' } as never
  })
}

const startReply = ($: Engine, text = 'fix the failing test') =>
  $.turn.start({ turnId: 't1', text } as never)

const endReply = ($: Engine) =>
  $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)

const paneText = async ($: Engine, surface: Surface, rows = 24) => {
  const ui = await $.ui.mount({
    plugin: 'turn-timeline',
    surface,
    component: 'Pane',
    requestId: 'turn-timeline',
    props: PANE_PROPS as never,
    viewport: { columns: 80, rows } as never,
  })
  const texts = await ui.findAll({ type: 'Text' })
  return texts.map(found => found.text).join('|')
}

for (const surface of SURFACES) {
  describe(`the pane (${surface})`, () => {
    test('waits for the first reply', async ($, on) => {
      const clock = mock.clock(on, { now: 0 })
      engineBeneath(on, clock)
      expect(await paneText($, surface)).toContain('No reply yet')
    })

    test('lists each call with its outcome, offset, length and what it did', async ($, on) => {
      const clock = mock.clock(on, { now: 0 })
      engineBeneath(on, clock)
      await startReply($)
      await $.tool.call({ tool: 'Read', file_path: '/app/src/band.tsx' } as never)
      await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' } as never)
      await $.tool.call({ tool: 'WebFetch', url: 'https://example.com/docs', prompt: 'read' } as never)
      await $.tool.call({ tool: 'Write', file_path: '/app/x.ts', content: '' } as never)
      await endReply($)
      const text = await paneText($, surface)
      expect(text).toContain('✓ done ')
      expect(text).toContain('4 calls')
      expect(text).toContain('“fix the failing test”')
      expect(text).toMatch(/✓ \|\s*\+0:00 \|\s*0\.3s \|Read\s+\|\/app\/src\/band\.tsx/)
      expect(text).toMatch(/✓ \|\s*\+0:00 \|\s*42s \|Bash\s+\|Run the tests/)
      expect(text).toContain('✗ ')
      expect(text).toContain('⊘ ')
      expect(text).toContain('Read 1 · Bash 1 · WebFetch 1 · Write 1')
    })

    test('shows file paths from the project folder', async ($, on) => {
      const clock = mock.clock(on, { now: 0 })
      engineBeneath(on, clock)
      mock.env(on, { HOME: '/Users/me' })
      on('session.start', ($, e) => ({ cwd: e.cwd }))
      on('command.register', () => ({ value: undefined }) as never)
      on('ui.open', () => ({ value: { isPlaced: true } }) as never)
      await $.session.start({ cwd: '/Users/me/Workspace/app', surface, isInteractive: true } as never)
      await startReply($)
      await $.tool.call({ tool: 'Edit', file_path: '/Users/me/Workspace/app/hooks/band.tsx' } as never)
      await $.tool.call({ tool: 'Read', file_path: '/Users/me/Workspace/other/hooks/band.tsx' } as never)
      const text = await paneText($, surface)
      expect(text).toContain('|hooks/band.tsx')
      expect(text).toContain('|~/Workspace/other/hooks/band.tsx')
    })

    test('shows a running reply and marks subagent calls', async ($, on) => {
      const clock = mock.clock(on, { now: 0 })
      engineBeneath(on, clock)
      await startReply($)
      await $.tool.call({ tool: 'Read', file_path: '/a/b.ts', agentId: 'sub1' } as never)
      const text = await paneText($, surface)
      expect(text).toContain('◌ running ')
      expect(text).toContain('↳Read')
    })

    test('keeps the newest calls when the pane is short', async ($, on) => {
      const clock = mock.clock(on, { now: 0 })
      engineBeneath(on, clock)
      await startReply($)
      for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
        await $.tool.call({ tool: 'Read', file_path: `/x/${name}.ts` } as never)
      }
      const text = await paneText($, surface, 8)
      expect(text).toContain('… 4 earlier')
      expect(text).toContain('g.ts')
      expect(text).not.toContain('a.ts')
    })
  })
}

describe('summaries', () => {
  test('say what each tool did', () => {
    const text = (tool: string, input: Record<string, unknown>) => summarize(tool, input).text
    expect(text('Bash', { command: 'npm run lint', description: 'Lint the app' })).toBe('Lint the app')
    expect(text('Bash', { command: 'git   status\n--short' })).toBe('git status --short')
    expect(text('Grep', { pattern: 'useEffect' })).toBe('useEffect')
    expect(text('WebFetch', { url: 'https://docs.anthropic.com/en/x' })).toBe('docs.anthropic.com')
    expect(text('Agent', { description: 'Survey work', prompt: '…' })).toBe('Survey work')
    expect(text('Mystery', { count: 3, note: 'hello' })).toBe('hello')
  })

  test('give file tools their path, from the project folder or ~', () => {
    const places = { cwd: '/Users/me/Workspace/app', home: '/Users/me' }
    expect(summarize('Edit', { file_path: '/Users/me/Workspace/app/src/band.tsx' }, places)).toEqual({ text: 'src/band.tsx', isPath: true })
    expect(summarize('Read', { file_path: '/Users/me/.claude/settings.json' }, places).text).toBe('~/.claude/settings.json')
    expect(summarize('Write', { file_path: '/etc/hosts' }, places).text).toBe('/etc/hosts')
    expect(displayPath('/Users/me/Workspace/app2/x.ts', places)).toBe('~/Workspace/app2/x.ts')
  })

  test('drop terminal escape sequences and other control characters', () => {
    const esc = String.fromCharCode(27)
    const bell = String.fromCharCode(7)
    expect(summarize('Bash', { command: `echo ${esc}[2J${esc}]0;pwned${bell}hi` }).text).toBe('echo [2J]0;pwnedhi')
    expect(summarize('Edit', { file_path: `/a/${esc}[2Jb.ts` }).text).toBe('/a/[2Jb.ts')
    expect(printable(`a${esc}[31mb\tc`)).toBe('a[31mb c')
    expect(startTurn('t', `fix ${esc}[1mthis`, 0).prompt).toBe('fix [1mthis')
  })

  test('shorten MCP tool names', () => {
    expect(toolLabel('mcp__plugin_playwright_playwright__browser_click')).toBe('playwright·browser_click')
    expect(toolLabel('mcp__claude_ai_Gmail__authenticate')).toBe('Gmail·authenticate')
    expect(toolLabel('Bash')).toBe('Bash')
  })
})

describe('the settings', () => {
  test('open a modest pane by default', () => {
    expect(toSettings()).toEqual({ isAutoOpen: true, columns: 60, rows: 12 })
  })

  test('keep sizes in range', () => {
    expect(toSettings({ paneColumns: 500, paneRows: 1 })).toMatchObject({ columns: 120, rows: 5 })
    expect(toSettings({ paneColumns: 'wide' })).toMatchObject({ columns: 60 })
  })
})

describe('opening the pane', () => {
  test('asks for the configured size', { options: { paneColumns: 48, paneRows: 10 } }, async ($, on) => {
    const opened: unknown[] = []
    on('command.register', () => ({ value: undefined }) as never)
    on('ui.open', ($, e) => {
      opened.push(e)
      return { value: { isPlaced: true } } as never
    })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    expect(opened).toEqual([expect.objectContaining({ id: 'turn-timeline', columns: 48, rows: 10 })])
  })
})

describe('formatting', () => {
  test('durations and offsets', () => {
    expect(formatDuration(420)).toBe('0.4s')
    expect(formatDuration(12_000)).toBe('12s')
    expect(formatDuration(65_000)).toBe('1m 05s')
    expect(formatOffset(72_500)).toBe('+1:12')
  })

  test('fitStart cuts a path from the left, keeping the file name', () => {
    expect(fitStart('cache-status/hooks/band.tsx', 16)).toBe('…/hooks/band.tsx')
    expect(fitStart('band.tsx', 16)).toBe('band.tsx')
  })

  test('fit cuts with an ellipsis', () => {
    expect(fit('abcdef', 4)).toBe('abc…')
    expect(fit('abc', 4)).toBe('abc')
    expect(fit('abc', 0)).toBe('')
  })
})

describe('the timeline state', () => {
  test('closes calls left running when the turn ends', () => {
    const call = { id: 'c1', tool: 'Bash', summary: '', isPath: false, isSubagent: false, startedAt: 0, endedAt: null, outcome: 'running' as const }
    const ended = endTurn(addCall(startTurn('t', 'p', 0), call), 5_000)
    expect(ended.calls[0]).toMatchObject({ outcome: 'error', endedAt: 5_000 })
    expect(ended.endedAt).toBe(5_000)
  })

  test('finishes one call without touching the others', () => {
    const base = startTurn('t', 'p', 0)
    const one = { id: 'a', tool: 'Read', summary: '', isPath: false, isSubagent: false, startedAt: 0, endedAt: null, outcome: 'running' as const }
    const two = { ...one, id: 'b' }
    const done = finishCall(addCall(addCall(base, one), two), 'a', 'ok', 10)
    expect(done.calls.map(call => call.outcome)).toEqual(['ok', 'running'])
  })

  test('reads outcomes and counts tools', () => {
    expect(outcomeOf({ deny: 'no' })).toBe('denied')
    expect(outcomeOf({ isError: true })).toBe('error')
    expect(outcomeOf({})).toBe('ok')
    const calls = ['Bash', 'Edit', 'Bash'].map((tool, i) => ({ id: String(i), tool, summary: '', isPath: false, isSubagent: false, startedAt: 0, endedAt: 0, outcome: 'ok' as const }))
    expect(toolCounts(calls)).toEqual([['Bash', 2], ['Edit', 1]])
  })
})
