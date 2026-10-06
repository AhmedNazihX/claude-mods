/** A tool's badge letter and colour: a terminal colour name and the same as hex for SVG. */
export type ToolLook = { badge: string; color: string; hex: string }

type Colour = Omit<ToolLook, 'badge'>

const BLUE: Colour = { color: 'blue', hex: '#60a5fa' }
const YELLOW: Colour = { color: 'yellow', hex: '#facc15' }
const MAGENTA: Colour = { color: 'magenta', hex: '#c084fc' }
const CYAN: Colour = { color: 'cyan', hex: '#22d3ee' }
const GREEN: Colour = { color: 'green', hex: '#4ade80' }
const GRAY: Colour = { color: 'gray', hex: '#a1a1aa' }

export const RED: Colour = { color: 'red', hex: '#f87171' }
export const TRACK_HEX = '#3f3f46'

const LOOKS: Readonly<Record<string, ToolLook>> = {
  Read: { badge: 'R', ...BLUE },
  Write: { badge: 'W', ...MAGENTA },
  Edit: { badge: 'E', ...MAGENTA },
  NotebookEdit: { badge: 'N', ...MAGENTA },
  Bash: { badge: '$', ...YELLOW },
  Grep: { badge: '?', ...CYAN },
  Glob: { badge: '*', ...CYAN },
  WebFetch: { badge: '@', ...GREEN },
  WebSearch: { badge: '@', ...GREEN },
  Agent: { badge: 'A', ...MAGENTA },
  Task: { badge: 'A', ...MAGENTA },
  Skill: { badge: 'S', ...CYAN },
}

/** How a tool is marked on the card; an MCP tool is `M`, any other its first letter. */
export const lookOf = (tool: string): ToolLook => {
  const known = LOOKS[tool]
  if (known !== undefined) return known
  if (tool.startsWith('mcp__')) return { badge: 'M', ...GRAY }
  return { badge: (tool[0] ?? '·').toUpperCase(), ...GRAY }
}
