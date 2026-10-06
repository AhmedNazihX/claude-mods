import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { fit, fitStart, formatDuration, sequentialSpans } from './format'
import { lookOf } from './look'
import { displayPath, printable, summarize, toolLabel } from './summary'
import { addCall, endTurn, finishCall, noteOf, outcomeOf, startTurn } from './timeline'

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

// The engine beneath the mod: a turn starts and ends, rows are kept, each
// tool call is answered after the mocked clock moves on (Write is refused),
// and a reply message draws as one line of text.
const engineBeneath = (on: On, clock: { advance: (ms: number) => Promise<void> }) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', async ($, e) => {
    const isRmRf = e.tool === 'Bash' && String((e as { command?: unknown }).command).includes('rm -rf')
    if (e.tool === 'Write' || isRmRf) return { deny: 'use the trash' }
    await clock.advance(e.tool === 'Bash' ? 4_000 : 200)
    return { result: {}, text: 'Exit code 1', isError: e.tool === 'WebFetch' } as never
  })
  on('ui.render', () => h('Text', {}, 'the reply text') as never)
}

// The kit has no transcript to store rows in, so the append itself fails
// beneath the mod; the mod has noted the row's id by then.
const appendReply = async ($: Engine, uuid: string, text = 'All tests pass.') => {
  try {
    await $.session.append({
      message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
      door: 'response',
      origin: { kind: 'model' },
      uuid,
    } as never)
  } catch {
    // Expected: nothing beneath stores the row.
  }
}

const runTurn = async ($: Engine, uuid: string, calls: Record<string, unknown>[]) => {
  await $.turn.start({ turnId: `t-${uuid}`, text: 'go' } as never)
  for (const call of calls) await $.tool.call(call as never)
  await appendReply($, uuid)
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: `t-${uuid}`, reason: 'answer' } as never)
}

const mountMessage = ($: Engine, surface: Surface, requestId: string, text = 'All tests pass.') =>
  $.ui.mount({
    plugin: 'turn-timeline',
    surface,
    component: 'AssistantMessage',
    requestId,
    props: { text, isFirstOfReply: true } as never,
    viewport: { columns: 90, rows: 30 } as never,
  })

// The card's lines, then the reply: drawn by the mod as Markdown when it
// has a card, else the engine's own line.
const textsOf = async ($: Engine, surface: Surface, requestId: string, text?: string) => {
  const ui = await mountMessage($, surface, requestId, text)
  const lines = (await ui.findAll({ type: 'Text' })).map(found => found.text).filter(text => text !== '⏺ ')
  const markdown = (await ui.findAll({ type: 'Markdown' })).map(found => String(found.props.text))
  return [...lines, ...markdown]
}

for (const surface of SURFACES) {
  describe(`the card (${surface})`, () => {
    test('sits above the reply text with each call, its time and how it ended', async ($, on) => {
      const clock = mock.clock(on, { now: 0 })
      engineBeneath(on, clock)
      await runTurn($, 'm1', [
        { tool: 'Read', file_path: '/app/package.json' },
        { tool: 'Write', file_path: '/app/x.ts', content: '' },
        { tool: 'Bash', command: 'bun test', description: 'bun test' },
      ])
      const texts = await textsOf($, surface, 'm1')
      const all = texts.join('|')
      expect(texts[0]).toBe('Tool timeline')
      expect(all).toContain('3 calls · 4s')
      expect(all).toContain('/app/package.json')
      expect(all).toContain('denied')
      expect(all).toContain('denied · use the trash')
      expect(all).toMatch(/\s4s/)
      expect(texts[texts.length - 1]).toBe('All tests pass.')
    })

    test('finds the card under the id the transcript draws the text with', async ($, on) => {
      const clock = mock.clock(on, { now: 0 })
      engineBeneath(on, clock)
      await runTurn($, '5c7d2e8d-b25d-43ea-ba24-b34b0a2a29cd', [{ tool: 'Read', file_path: '/a.ts' }])
      const texts = await textsOf($, surface, '5c7d2e8d-b25d-43ea-ba24-000000000000')
      expect(texts[0]).toBe('Tool timeline')
    })

    test('leaves out the folded summary line of calls a card shows', async ($, on) => {
      const clock = mock.clock(on, { now: 0 })
      engineBeneath(on, clock)
      await runTurn($, 'm4', [{ tool: 'Bash', command: 'ls', tool_use_id: 'tu1' }])
      let mounts = 0
      const group = (ids: string[], isActive = false) =>
        $.ui.mount({
          plugin: 'turn-timeline',
          surface,
          component: 'ToolGroup',
          requestId: `g${(mounts += 1)}`,
          props: { calls: ids.map(id => ({ tool_use_id: id, tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false })), isActive, isExpanded: false } as never,
        })
      const textOf = async (ids: string[], isActive?: boolean) =>
        (await (await group(ids, isActive)).findAll({ type: 'Text' })).map(found => found.text)
      expect(await textOf(['tu1'])).toEqual([])
      expect(await textOf(['tu1'], true)).toEqual(['the reply text'])
      expect(await textOf(['tu1', 'other'])).toEqual(['the reply text'])
    })

    test('shows the description when the command is too long to read', async ($, on) => {
      const clock = mock.clock(on, { now: 0 })
      engineBeneath(on, clock)
      const long = `grep -rn --exclude='.env*' "barSpan" . ; echo "exit=$?" ${'x'.repeat(80)}`
      await runTurn($, 'm5', [
        { tool: 'Bash', command: long, description: 'Search turn-timeline for barSpan' },
        { tool: 'Bash', command: 'git log -3', description: 'Show recent commits' },
      ])
      const all = (await textsOf($, surface, 'm5')).join('|')
      expect(all).toContain('Search turn-timeline for barSpan')
      expect(all).toContain('git log -3')
      expect(all).not.toContain('Show recent commits')
    })

    test('notes every refusal and links only a direct replacement', async ($, on) => {
      const clock = mock.clock(on, { now: 0 })
      engineBeneath(on, clock)
      await runTurn($, 'm6', [
        { tool: 'Write', file_path: '/a/one.ts', content: '' },
        { tool: 'Write', file_path: '/a/two.ts', content: '' },
        { tool: 'Read', file_path: '/a/between.ts' },
        { tool: 'Write', file_path: '/a/three.ts', content: '' },
        { tool: 'Write', file_path: '/a/four.ts', content: '' },
        { tool: 'Write', file_path: '/a/five.ts', content: '' },
      ])
      const all = (await textsOf($, surface, 'm6')).join('|')
      for (const name of ['one', 'two', 'three', 'four', 'five']) expect(all).toContain(`/a/${name}.ts`)
      expect(all).not.toContain('more')
      // Write after Write was refused too, and a Read sits between: no arrow anywhere.
      expect(all).not.toContain('→')
    })

    test('links a refused call to the same tool run right after it', async ($, on) => {
      const clock = mock.clock(on, { now: 0 })
      engineBeneath(on, clock)
      await runTurn($, 'm7', [
        { tool: 'Write', file_path: '/a/x.ts', content: '' },
        { tool: 'Bash', command: 'rm -rf dist' },
        { tool: 'Bash', command: 'trash dist' },
      ])
      const all = (await textsOf($, surface, 'm7')).join('|')
      expect(all).toContain('→ trash dist')
      // The refused Write is followed by a Bash call: a different tool, so no arrow.
      expect(all).not.toMatch(/x\.ts[^|]*→/)
    })

    test('finds the card by its text when the surface names the block another way', async ($, on) => {
      const clock = mock.clock(on, { now: 0 })
      engineBeneath(on, clock)
      await runTurn($, 'row-8', [{ tool: 'Read', file_path: '/a.ts' }])
      // mountMessage draws 'All tests pass.', the text runTurn appended.
      expect((await textsOf($, surface, 'msg_somethingelse'))[0]).toBe('Tool timeline')
      // Taken once: another block with the same words gets no card.
      expect(await textsOf($, surface, 'msg_again')).toEqual(['the reply text'])
    })

    test('shows why a call failed', async ($, on) => {
      const clock = mock.clock(on, { now: 0 })
      engineBeneath(on, clock)
      await runTurn($, 'm2', [{ tool: 'WebFetch', url: 'https://example.com/a', prompt: 'x' }])
      const all = (await textsOf($, surface, 'm2')).join('|')
      expect(all).toContain('failed · Exit code 1')
    })

    test('leaves other messages and turns without tool calls alone', async ($, on) => {
      const clock = mock.clock(on, { now: 0 })
      engineBeneath(on, clock)
      await runTurn($, 'm3', [])
      expect(await textsOf($, surface, 'm3')).toEqual(['the reply text'])
      expect(await textsOf($, surface, 'other', 'Something else.')).toEqual(['the reply text'])
    })

    test('gives each block of text the calls made since the last one', async ($, on) => {
      const clock = mock.clock(on, { now: 0 })
      engineBeneath(on, clock)
      await $.turn.start({ turnId: 't', text: 'go' } as never)
      await $.tool.call({ tool: 'Read', file_path: '/a.ts' } as never)
      await appendReply($, 'first', 'Read it.')
      await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
      await $.tool.call({ tool: 'Bash', command: 'pwd' } as never)
      await appendReply($, 'second')
      const first = (await textsOf($, surface, 'first')).join('|')
      const second = (await textsOf($, surface, 'second')).join('|')
      expect(first).toContain('1 call · ')
      expect(first).not.toContain('pwd')
      expect(second).toContain('2 calls · 8s')
      expect(second).not.toContain('/a.ts')
    })

    test('no card on text before any tool ran', async ($, on) => {
      const clock = mock.clock(on, { now: 0 })
      engineBeneath(on, clock)
      await $.turn.start({ turnId: 't', text: 'go' } as never)
      await appendReply($, 'early', 'Looking first.')
      await $.tool.call({ tool: 'Read', file_path: '/a.ts' } as never)
      await appendReply($, 'late')
      await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
      expect(await textsOf($, surface, 'early', 'Looking first.')).toEqual(['the reply text'])
      expect((await textsOf($, surface, 'late'))[0]).toBe('Tool timeline')
    })
  })
}

describe('summaries', () => {
  test('say what each tool did', () => {
    const text = (tool: string, input: Record<string, unknown>) => summarize(tool, input).text
    expect(text('Bash', { command: 'npm run lint', description: 'Lint the app' })).toBe('npm run lint')
    expect(text('Bash', { command: 'git   status\n--short' })).toBe('git status --short')
    expect(text('Bash', { command: 'cd ~/Workspace/claude-mods && sleep 3 && git log -3' })).toBe('sleep 3 && git log -3')
    expect(text('Bash', { command: 'cd "/a b"; cd sub && grep -r TODO .' })).toBe('grep -r TODO .')
    expect(text('Bash', { command: 'cd /tmp' })).toBe('cd /tmp')
    expect(text('Bash', { description: 'List files' })).toBe('List files')
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
  })

  test('shorten MCP tool names', () => {
    expect(toolLabel('mcp__plugin_playwright_playwright__browser_click')).toBe('playwright·browser_click')
    expect(toolLabel('mcp__claude_ai_Gmail__authenticate')).toBe('Gmail·authenticate')
    expect(toolLabel('Bash')).toBe('Bash')
  })
})

describe('formatting', () => {
  test('durations and offsets', () => {
    expect(formatDuration(420)).toBe('0.4s')
    expect(formatDuration(12_000)).toBe('12s')
    expect(formatDuration(65_000)).toBe('1m 05s')
  })

  test('sequentialSpans lays calls end to end across the whole bar', () => {
    expect(sequentialSpans([500, 500], 10)).toEqual([
      { before: 0, length: 5, after: 5 },
      { before: 5, length: 5, after: 0 },
    ])
    // A very short call still gets a cell; the longest absorbs the rounding.
    expect(sequentialSpans([1, 999], 10)).toEqual([
      { before: 0, length: 1, after: 9 },
      { before: 1, length: 9, after: 0 },
    ])
    expect(sequentialSpans([0, 0], 4).map(span => span.length)).toEqual([3, 1])
    expect(sequentialSpans([10], 0)).toEqual([{ before: 0, length: 0, after: 0 }])
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
    const ended = endTurn(addCall(startTurn('t', 0), call), 5_000)
    expect(ended.calls[0]).toMatchObject({ outcome: 'error', endedAt: 5_000 })
    expect(ended.endedAt).toBe(5_000)
  })

  test('finishes one call without touching the others', () => {
    const base = startTurn('t', 0)
    const one = { id: 'a', tool: 'Read', summary: '', isPath: false, isSubagent: false, startedAt: 0, endedAt: null, outcome: 'running' as const }
    const two = { ...one, id: 'b' }
    const done = finishCall(addCall(addCall(base, one), two), 'a', 'ok', 10)
    expect(done.calls.map(call => call.outcome)).toEqual(['ok', 'running'])
  })

  test('reads outcomes and the reason a call was denied or failed', () => {
    expect(outcomeOf({ deny: 'no' })).toBe('denied')
    expect(outcomeOf({ isError: true })).toBe('error')
    expect(outcomeOf({ isError: true, text: 'PreToolUse:Bash hook error: ["/x.sh"]: BLOCKED: no' })).toBe('denied')
    expect(outcomeOf({ isError: true, text: "The user doesn't want to proceed with this tool use." })).toBe('denied')
    expect(outcomeOf({ isError: true, text: 'Exit code 1' })).toBe('error')
    expect(outcomeOf({})).toBe('ok')
    expect(noteOf({ deny: 'use the trash' })).toBe('use the trash')
    expect(noteOf({ isError: true, text: '\n  Exit code 1\nmore' })).toBe('Exit code 1')
    const guard = 'PreToolUse:Bash hook error: ["/x/block-secrets.sh"]: BLOCKED: \'grep -r TODO .\' searches recursively and would read .env files. Add --exclude.'
    expect(noteOf({ isError: true, text: guard })).toBe('searches recursively and would read .env files')
    expect(noteOf({ text: 'fine' })).toBeUndefined()
  })
})

describe('tool looks', () => {
  test('badge each tool', () => {
    expect(lookOf('Read')).toMatchObject({ badge: 'R', color: 'blue' })
    expect(lookOf('Bash')).toMatchObject({ badge: '$', color: 'yellow' })
    expect(lookOf('mcp__x__y').badge).toBe('M')
    expect(lookOf('Mystery').badge).toBe('M')
  })
})
