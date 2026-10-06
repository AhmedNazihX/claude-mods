import type { EngineInterface, HookFailure, Register } from 'claude-code'

import { describeFindings, findSecrets, isSecretFile } from './scan'

type Mode = 'block' | 'warn'

const toMode = (value: unknown): Mode => (value === 'warn' ? 'warn' : 'block')

/**
 * What to do with text about to land in `path`: nothing when it is clean or
 * the file is a gitignored secrets file, else the refusal Claude reads.
 */
function verdictFor(path: string, text: string): string | undefined {
  if (isSecretFile(path)) return undefined
  const findings = findSecrets(text)
  return findings.length === 0 ? undefined : describeFindings(path, findings)
}

// A file name could carry control characters (ESC sequences) that would
// reach the terminal through the toast; they are dropped first.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g

function report($: EngineInterface, mode: Mode, path: string, reason: string) {
  const fileName = (path.split('/').pop() ?? path).replace(CONTROL_CHARS, '')
  $.ui.toast(
    mode === 'block'
      ? `🔒 Blocked a secret from being written to ${fileName}`
      : `⚠️ A secret was written to ${fileName}`,
  )
  $.ui.log(reason, { to: 'debug' })
}

// What Claude reads when a write could not be scanned: unchecked, it may
// hold a secret, so it does not go through.
const UNSCANNED =
  'secret-guard: refused this write because it could not be scanned for secrets. ' +
  'Try it again; if it keeps being refused, the reason is in the debug log.'

/**
 * The answer in place of a guard that failed (threw, ran out of time) before
 * calling `next`. In block mode the write is refused, since a guard that fails
 * open lets a secret through on any bug; in warn mode it goes on as a found
 * secret would. On re-entry the guard did not run and `$` is closed to it, so
 * nothing is logged.
 */
function onUnscanned($: EngineInterface, mode: Mode, path: string, error: HookFailure) {
  if (error.kind !== 're-entry') {
    $.ui.log(
      `secret-guard: could not scan ${path} (${error.kind}: ${error.message ?? 'no detail'})`,
      { to: 'debug' },
    )
  }
  return mode === 'block' ? { deny: UNSCANNED } : undefined
}

export const register: Register = (on, options) => {
  const mode = toMode(options?.mode)

  on('tool.call', { tool: 'Write' }, ($, e, next) => {
    const reason = verdictFor(e.file_path, e.content)
    if (reason === undefined) return next(e)
    report($, mode, e.file_path, reason)
    return mode === 'block' ? { deny: reason } : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : onUnscanned($, mode, e.file_path, next.error)))

  on('tool.call', { tool: 'Edit' }, ($, e, next) => {
    const reason = verdictFor(e.file_path, e.new_string)
    if (reason === undefined) return next(e)
    report($, mode, e.file_path, reason)
    return mode === 'block' ? { deny: reason } : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : onUnscanned($, mode, e.file_path, next.error)))

  on('tool.call', { tool: 'NotebookEdit' }, ($, e, next) => {
    const reason = verdictFor(e.notebook_path, e.new_source)
    if (reason === undefined) return next(e)
    report($, mode, e.notebook_path, reason)
    return mode === 'block' ? { deny: reason } : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : onUnscanned($, mode, e.notebook_path, next.error)))
}
