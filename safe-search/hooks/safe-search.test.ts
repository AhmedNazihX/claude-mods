import { describe, expect, test } from 'claude-code/testing'

import { GREP_EXCLUDE, RG_EXCLUDE, quotedPositions, rewriteSearch } from './rewrite'

const rewritten = (command: string) => rewriteSearch(command)?.command ?? null

describe('recursive grep', () => {
  test('gets the .env exclude right after the grep word', () => {
    expect(rewritten('grep -rn "TODO" src')).toBe(`grep ${GREP_EXCLUDE} -rn "TODO" src`)
    expect(rewritten('egrep -ri "a|b" .')).toBe(`egrep ${GREP_EXCLUDE} -ri "a|b" .`)
    expect(rewritten('git status && grep --recursive needle docs')).toBe(`git status && grep ${GREP_EXCLUDE} --recursive needle docs`)
  })

  test('fixes every grep in a blocked command, so none is left reading .env', () => {
    expect(rewritten('grep -rn foo . ; grep -n bar file.ts ; grep -rl baz lib')).toBe(
      `grep ${GREP_EXCLUDE} -rn foo . ; grep ${GREP_EXCLUDE} -n bar file.ts ; grep ${GREP_EXCLUDE} -rl baz lib`,
    )
    expect(rewritten('cd app && grep -rl x src | head -5')).toBe(`cd app && grep ${GREP_EXCLUDE} -rl x src | head -5`)
  })

  test('leaves alone what the guard would let through', () => {
    expect(rewriteSearch('grep -n foo file.ts')).toBeNull()
    expect(rewriteSearch(`grep -rn ${GREP_EXCLUDE} x .`)).toBeNull()
    expect(rewriteSearch('grep -R --include="*.ts" foo .')).toBeNull()
    expect(rewriteSearch('ls -la')).toBeNull()
  })

  // Found by a security review: grep lets a later --include win over an
  // earlier --exclude, so this rewrite let the guard pass and .env be read.
  test('never touches a search that asks for env files by name', () => {
    expect(rewriteSearch('grep -rn --include=".env*" KEY .')).toBeNull()
    expect(rewriteSearch('grep -rn --include .env KEY .')).toBeNull()
    expect(rewriteSearch('grep -rn --include=*.ts x . ; grep -rn --include=prod.env y .')).toBeNull()
  })
})

describe('a quoted separator', () => {
  // Found by a security review: splitting on a quoted | left the first,
  // recursive grep without the flag while the second one's flag let the
  // whole command past the hook.
  test('cannot leave a recursive grep unprotected', () => {
    expect(rewritten("grep -e 'a|b' -r . ; grep -rn z .")).toBe(
      `grep ${GREP_EXCLUDE} -e 'a|b' -r . ; grep ${GREP_EXCLUDE} -rn z .`,
    )
    expect(rewritten("grep -rn 'x;y' . && grep -rn z lib")).toBe(
      `grep ${GREP_EXCLUDE} -rn 'x;y' . && grep ${GREP_EXCLUDE} -rn z lib`,
    )
  })
})

describe('rg', () => {
  test('gets a negative glob when it searches hidden or ignored files', () => {
    expect(rewritten('rg --hidden foo')).toBe(`rg ${RG_EXCLUDE} --hidden foo`)
    expect(rewritten('rg -uu "x" src')).toBe(`rg ${RG_EXCLUDE} -uu "x" src`)
  })

  test('never touches a search with a positive glob for env files', () => {
    expect(rewriteSearch("rg --hidden -g '.env' KEY")).toBeNull()
    expect(rewriteSearch('rg -uu --glob=.env* KEY')).toBeNull()
    expect(rewriteSearch("rg --hidden --iglob '*.ENV' KEY")).toBeNull()
  })

  test('is left alone otherwise', () => {
    expect(rewriteSearch('rg foo src')).toBeNull()
    expect(rewriteSearch(`rg --hidden -g '!node_modules' foo`)).toBeNull()
  })
})

describe('commands it cannot read with certainty', () => {
  // Found by a security review: inside quotes, the inserted flag's quotes
  // end the user's, and the shell expands .env* into files grep then reads.
  test('a search word inside quotes is left to the guard', () => {
    expect(rewriteSearch("sh -c 'grep -r KEY .'")).toBeNull()
    expect(rewriteSearch('bash -c "grep -rn KEY ."')).toBeNull()
    expect(rewriteSearch("grep -rn x . && sh -c 'rg --hidden y'")).toBeNull()
  })

  test('multi-line commands, heredocs, substitution and eval are left alone', () => {
    expect(rewriteSearch('grep -rn x .\nls')).toBeNull()
    expect(rewriteSearch('cat > a.md <<EOF\nhi\nEOF\ngrep -rn y src')).toBeNull()
    expect(rewriteSearch('echo $(grep -rn x .)')).toBeNull()
    expect(rewriteSearch('echo `grep -rn x .`')).toBeNull()
    expect(rewriteSearch('eval grep -rn x .')).toBeNull()
  })

  test('quotes around arguments are fine', () => {
    expect(rewriteSearch('grep -rn "use effect" src')?.command).toBe(`grep ${GREP_EXCLUDE} -rn "use effect" src`)
  })

  test('quote tracking follows the shell', () => {
    const marks = (text: string) => quotedPositions(text).map(isQuoted => (isQuoted ? 'q' : '.')).join('')
    expect(marks(`a 'b' "c"`)).toBe("..qqq.qqq")
    expect(marks(String.raw`a "x\"y" z`)).toBe('..qqqqqq..')
    expect(marks(String.raw`a 'x\' b`)).toBe('..qqqq..')
  })
})

describe('the hook', () => {
  test('runs the fixed command in place of a blocked one', async ($, on) => {
    const ran: string[] = []
    on('tool.call', ($, e) => {
      ran.push((e as { command?: string }).command ?? '')
      return { result: {}, text: 'ok', isError: false } as never
    })
    on('ui.log', () => ({ value: undefined }) as never)
    await $.tool.call({ tool: 'Bash', command: 'grep -rn TODO src' } as never)
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    expect(ran).toEqual([`grep ${GREP_EXCLUDE} -rn TODO src`, 'npm test'])
  })
})
