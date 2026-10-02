import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { formatDuration, messageFor, shouldChime, toSettings } from './format'

const DEFAULTS = toSettings()
const TURN = { answer: 'ok', isAborted: false, turnId: 't1', reason: 'answer' } as const

// The engine beneath the mod, recording each toast and each clip it is asked for.
const engineBeneath = (on: On) => {
  const heard = { toasts: [] as string[], clips: [] as string[] }
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.toast', ($, e) => {
    heard.toasts.push(String((e as { text?: unknown }).text ?? JSON.stringify(e)))
    return { value: undefined } as never
  })
  on('audio.play', ($, e) => {
    heard.clips.push(JSON.stringify(e))
    return { value: undefined } as never
  })
  return heard
}

const finish = ($: Engine, fields: Record<string, unknown>) =>
  $.turn.complete({ ...TURN, ...fields } as never)

describe('the chime', () => {
  test('plays with a toast when a long reply finishes', async ($, on) => {
    const heard = engineBeneath(on)
    await finish($, { durationMs: 72_000 })
    expect(heard.toasts.join()).toContain('Claude finished (1m 12s)')
    expect(heard.clips.join()).toContain('sounds/arpeggio.wav')
  })

  test('stays quiet for a short reply, an interrupt or a subagent', async ($, on) => {
    const heard = engineBeneath(on)
    await finish($, { durationMs: 5_000 })
    await finish($, { durationMs: 90_000, isAborted: true, reason: 'aborted' })
    await finish($, { durationMs: 90_000, agentId: 'a1' })
    expect(heard.toasts).toEqual([])
    expect(heard.clips).toEqual([])
  })

  test('shows only the toast with the sound off', { options: { sound: false } }, async ($, on) => {
    const heard = engineBeneath(on)
    await finish($, { durationMs: 72_000 })
    expect(heard.toasts).toHaveLength(1)
    expect(heard.clips).toEqual([])
  })

  test('plays the chosen sound', { options: { chime: 'bell' } }, async ($, on) => {
    const heard = engineBeneath(on)
    await finish($, { durationMs: 72_000 })
    expect(heard.clips.join()).toContain('sounds/bell.wav')
  })

  test('follows a lower threshold', { options: { minSeconds: 5 } }, async ($, on) => {
    const heard = engineBeneath(on)
    await finish($, { durationMs: 6_000 })
    expect(heard.toasts).toHaveLength(1)
  })
})

describe('the helpers', () => {
  test('format durations', () => {
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(72_000)).toBe('1m 12s')
    expect(formatDuration(720_000)).toBe('12m')
  })

  test('say when a reply stopped on an error', () => {
    expect(messageFor({ durationMs: 40_000, isAborted: false, isSubagent: false, reason: 'error' })).toContain('stopped: error')
  })

  test('fall back to defaults for bad settings', () => {
    expect(toSettings({ minSeconds: -3 })).toEqual(DEFAULTS)
    expect(toSettings({ chime: 'kazoo' }).chime).toBe('arpeggio')
    expect(DEFAULTS).toEqual({ minMs: 30_000, hasSound: true, chime: 'arpeggio' })
    expect(shouldChime({ durationMs: 30_000, isAborted: false, isSubagent: false, reason: 'answer' }, DEFAULTS)).toBe(true)
  })
})
