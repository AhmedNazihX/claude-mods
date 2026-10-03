import type { Register } from 'claude-code'

import { rewriteSearch } from './rewrite'

/**
 * Before a Bash call runs, a recursive grep (or a hidden rg) that would read
 * .env files gets the flag that skips them, so the call goes through instead
 * of being blocked by a secrets guard and costing a turn to redo.
 */
export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    const rewrite = rewriteSearch(e.command)
    if (rewrite === null) return next(e)

    $.ui.log(`safe-search added ${rewrite.added.join(' and ')} to a search`, { to: 'debug' })
    return next({ ...e, command: rewrite.command })
  })
}
