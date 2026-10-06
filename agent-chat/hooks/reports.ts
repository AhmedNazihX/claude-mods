// Where a subagent's report comes from. A subagent may hand it back through
// a hand-back tool (its final text then says nothing), or Claude Code may
// return it in the Agent call's result; plain final text is the last resort.

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const REPORT_KEYS = ['report', 'text', 'message', 'content', 'summary', 'result'] as const

/** True for the tool a subagent hands its report back through. */
export const isHandback = (tool: string): boolean => /handback/i.test(tool)

/** The report a hand-back call carries: a known field, else its longest text. */
export const handbackText = (input: unknown): string => {
  if (!isRecord(input)) return ''
  for (const key of REPORT_KEYS) {
    const value = input[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  const texts = Object.values(input).filter((value): value is string => typeof value === 'string')
  return texts.reduce((longest, text) => (text.length > longest.length ? text : longest), '')
}

/** The report an Agent call's result carries: its hand-back report, else its text. */
export const agentResultReport = (result: unknown): { agentId?: string; text: string } => {
  if (!isRecord(result)) return { text: '' }
  const agentId = typeof result.agentId === 'string' ? result.agentId : undefined
  const handback = isRecord(result.handbackReport) && typeof result.handbackReport.text === 'string' ? result.handbackReport.text : ''
  const content = Array.isArray(result.content)
    ? result.content
        .filter((block): block is { text: string } => isRecord(block) && typeof block.text === 'string')
        .map(block => block.text)
        .join('\n')
    : ''
  return { ...(agentId === undefined ? {} : { agentId }), text: handback || content }
}

/** Text blocks of a stored row, joined. */
export const rowText = (content: unknown): string =>
  Array.isArray(content)
    ? content
        .filter((block): block is { type: string; text: string } => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('\n')
    : ''
