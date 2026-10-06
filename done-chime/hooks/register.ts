import type { EngineInterface, Register } from 'claude-code'

import { messageFor, shouldChime, toSettings } from './format'
import type { Chime } from './format'

// Each sound is one of the mod's own files, named as the setting names it.
const SOUND_FILES: Readonly<Record<Chime, string>> = {
  arpeggio: 'sounds/arpeggio.wav',
  rising: 'sounds/rising.wav',
  bell: 'sounds/bell.wav',
  marimba: 'sounds/marimba.wav',
  'ding-dong': 'sounds/ding-dong.wav',
  glass: 'sounds/glass.wav',
}

// The chime plays alongside the turn's end and never holds it up; a terminal
// with no player (Linux, Windows) skips it, and a failure only reaches the log.
function chime($: EngineInterface, sound: Chime) {
  $.audio.play({ asset: SOUND_FILES[sound] }).catch(error =>
    $.ui.log(`done-chime could not play the chime: ${error}`, { to: 'debug' }),
  )
}

const unpin = ($: EngineInterface) => $.ui.status(undefined)

export const register: Register = (on, options) => {
  const settings = toSettings(options)

  on('turn.complete', ($, e, next) => {
    const turn = {
      durationMs: e.durationMs,
      isAborted: e.isAborted,
      isSubagent: e.agentId !== undefined,
      reason: e.reason,
    }
    if (shouldChime(turn, settings)) {
      const message = messageFor(turn)
      $.ui.toast(message)
      $.ui.status(message)
      if (settings.hasSound) chime($, settings.chime)
    }

    return next(e)
  })

  // The toast is gone in a few seconds, so its line also stays pinned under the
  // prompt until the person is back: at their next prompt, or the next turn (a
  // prompt typed while the long one ran was submitted before the pin went up).
  on('prompt.submit', ($, e, next) => {
    unpin($)
    return next(e)
  })
  on('turn.start', ($, e, next) => {
    unpin($)
    return next(e)
  })
}
