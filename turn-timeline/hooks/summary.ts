const MAX_SUMMARY_CHARS = 120

const stringField = (input: Readonly<Record<string, unknown>>, key: string): string | undefined => {
  const value = input[key]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** Where paths are shown from: the session's folder, and the home folder for `~`. */
export type Places = { cwd: string; home: string }

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'NotebookEdit'])

/**
 * A path as the pane shows it: relative to the session's folder when inside
 * it, `~/…` when elsewhere in the home folder, otherwise in full.
 */
export const displayPath = (path: string, places: Places): string => {
  const inside = (root: string) => root !== '' && path.startsWith(`${root.replace(/\/$/, '')}/`)
  if (inside(places.cwd)) return path.slice(places.cwd.replace(/\/$/, '').length + 1)
  if (inside(places.home)) return `~/${path.slice(places.home.replace(/\/$/, '').length + 1)}`
  return path
}

// Control characters (ESC and kin) would reach the terminal as escape
// sequences; the pane shows command text, so they are dropped first.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g

/** One printable line: control characters removed, whitespace collapsed. */
export const printable = (text: string): string =>
  text.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim()

const oneLine = printable

const hostOf = (url: string): string => {
  const match = /^[a-z]+:\/\/([^/?#]+)/i.exec(url)
  return match?.[1] ?? url
}

export type Summary = { text: string; isPath: boolean }

/**
 * A few words saying what a tool call does, from its arguments: the command
 * a Bash call runs, the path of the file an Edit touches, the pattern a
 * search looks for. An unknown tool falls back to its first string argument.
 */
export const summarize = (
  tool: string,
  input: Readonly<Record<string, unknown>>,
  places: Places = { cwd: '', home: '' },
): Summary => {
  const pick = (...keys: string[]) => keys.map(key => stringField(input, key)).find(Boolean)
  const path = pick('file_path', 'notebook_path', 'path')

  if (FILE_TOOLS.has(tool)) {
    return { text: path === undefined ? '' : oneLine(displayPath(path, places)), isPath: path !== undefined }
  }

  const summary = (() => {
    switch (tool) {
      case 'Bash':
        return pick('description', 'command') ?? ''
      case 'Grep':
      case 'Glob':
        return pick('pattern') ?? ''
      case 'Agent':
      case 'Task':
        return pick('description', 'subagent_type') ?? ''
      case 'Skill':
        return pick('skill') ?? ''
      case 'WebFetch':
        return hostOf(pick('url') ?? '')
      case 'WebSearch':
        return pick('query') ?? ''
      default:
        return Object.values(input).find((value): value is string => typeof value === 'string') ?? ''
    }
  })()

  return { text: oneLine(summary).slice(0, MAX_SUMMARY_CHARS), isPath: false }
}

/** `mcp__plugin_playwright_playwright__browser_click` reads as `playwright·browser_click`. */
export const toolLabel = (tool: string): string => {
  if (!tool.startsWith('mcp__')) return tool
  const [, server = '', ...rest] = tool.split('__')
  const name = server.replace(/^plugin_/, '').split('_').pop() ?? server
  return `${name}·${rest.join('__')}`
}
