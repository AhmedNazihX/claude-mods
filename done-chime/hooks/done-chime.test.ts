import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { formatDuration, messageFor, shouldChime, toSettings } from './format'

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

const DEFAULTS = toSettings()
const TURN = { answer: 'ok', isAborted: false, turnId: 't1', reason: 'answer' } as const

// The engine beneath the mod, recording each toast, each status line (null for
// a cleared one), each clip it is asked for and each debug line; with
// `isMuted`, every clip fails as on a terminal with no player.
const engineBeneath = (on: On, { isMuted = false } = {}) => {
  const heard = { toasts: [] as string[], statuses: [] as (string | null)[], clips: [] as string[], logs: [] as string[] }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.toast', ($, e) => {
    heard.toasts.push(e.text)
    return { value: undefined } as never
  })
  on('ui.status', ($, e) => {
    heard.statuses.push(e.text ?? null)
    return { value: undefined } as never
  })
  on('ui.log', ($, e) => {
    if (e.to === 'debug') heard.logs.push(e.text)
    return { value: undefined } as never
  })
  on('audio.play', ($, e) => {
    if (isMuted) throw new Error('no player')
    heard.clips.push(JSON.stringify(e))
    return { value: undefined } as never
  })
  return heard
}

const startSession = ($: Engine, surface: Surface) =>
  $.session.start({ cwd: '/', surface, isInteractive: true })

const finish = ($: Engine, fields: Record<string, unknown>) =>
  $.turn.complete({ ...TURN, ...fields } as never)

for (const surface of SURFACES) {
  describe(`the chime (${surface})`, () => {
    test('plays with a toast when a long reply finishes', async ($, on) => {
      const heard = engineBeneath(on)
      await startSession($, surface)
      await finish($, { durationMs: 72_000 })
      expect(heard.toasts.join()).toContain('Claude finished (1m 12s)')
      expect(heard.clips.join()).toContain('sounds/arpeggio.wav')
    })

    test('stays quiet for a short reply, an interrupt or a subagent', async ($, on) => {
      const heard = engineBeneath(on)
      await startSession($, surface)
      await finish($, { durationMs: 5_000 })
      await finish($, { durationMs: 90_000, isAborted: true, reason: 'aborted' })
      await finish($, { durationMs: 90_000, agentId: 'a1' })
      expect(heard.toasts).toEqual([])
      expect(heard.statuses).toEqual([])
      expect(heard.clips).toEqual([])
    })

    test('says when a reply was refused', async ($, on) => {
      const heard = engineBeneath(on)
      await startSession($, surface)
      await finish($, { durationMs: 40_000, reason: 'refusal', refusal: { category: null, explanation: null } })
      expect(heard.toasts).toEqual(['⚠️ Claude stopped: refusal (40s)'])
      expect(heard.clips).toHaveLength(1)
    })

    test('shows the toast and logs when the sound fails', async ($, on) => {
      const heard = engineBeneath(on, { isMuted: true })
      await startSession($, surface)
      await expect(finish($, { durationMs: 72_000 })).resolves.toEqual({ text: 'ok' })
      // The turn never waits on the chime, so its failure lands a tick later.
      await Promise.resolve()
      expect(heard.toasts).toHaveLength(1)
      expect(heard.logs.join()).toContain('done-chime could not play the chime')
    })

    test('pins the line until the next prompt', async ($, on) => {
      const heard = engineBeneath(on)
      await startSession($, surface)
      await finish($, { durationMs: 72_000 })
      expect(heard.statuses).toEqual(['✅ Claude finished (1m 12s)'])
      await $.prompt.submit({ text: 'next', wait: false } as never)
      expect(heard.statuses.at(-1)).toBeNull()
    })

    test('unpins the line when the next turn starts', async ($, on) => {
      const heard = engineBeneath(on)
      await startSession($, surface)
      await finish($, { durationMs: 72_000 })
      await $.turn.start({ text: '', turnId: 't2' } as never)
      expect(heard.statuses).toEqual(['✅ Claude finished (1m 12s)', null])
    })

    test('shows only the toast with the sound off', { options: { sound: false } }, async ($, on) => {
      const heard = engineBeneath(on)
      await startSession($, surface)
      await finish($, { durationMs: 72_000 })
      expect(heard.toasts).toHaveLength(1)
      expect(heard.clips).toEqual([])
    })

    test('plays the chosen sound', { options: { chime: 'bell' } }, async ($, on) => {
      const heard = engineBeneath(on)
      await startSession($, surface)
      await finish($, { durationMs: 72_000 })
      expect(heard.clips.join()).toContain('sounds/bell.wav')
    })

    test('follows a lower threshold', { options: { minSeconds: 5 } }, async ($, on) => {
      const heard = engineBeneath(on)
      await startSession($, surface)
      await finish($, { durationMs: 6_000 })
      expect(heard.toasts).toHaveLength(1)
    })
  })
}

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
