import { describe, expect, test } from 'claude-code/testing'

import { GREP_EXCLUDE, RG_EXCLUDE, markHeredocs, rewriteSearch } from './rewrite'

const rewritten = (command: string) => rewriteSearch(command)?.command ?? null

describe('recursive grep', () => {
  test('gets the .env exclude right after the grep word', () => {
    expect(rewritten('grep -rn "TODO" src')).toBe(`grep ${GREP_EXCLUDE} -rn "TODO" src`)
    expect(rewritten('egrep -ri "a|b" .')).toBe(`egrep ${GREP_EXCLUDE} -ri "a|b" .`)
    expect(rewritten('git status && grep --recursive needle docs')).toBe(`git status && grep ${GREP_EXCLUDE} --recursive needle docs`)
  })

  test('fixes every recursive grep in a chain, and only those', () => {
    expect(rewritten('grep -rn foo . ; grep -n bar file.ts ; grep -rl baz lib')).toBe(
      `grep ${GREP_EXCLUDE} -rn foo . ; grep -n bar file.ts ; grep ${GREP_EXCLUDE} -rl baz lib`,
    )
    expect(rewritten('cd app && grep -rl x src | head -5')).toBe(`cd app && grep ${GREP_EXCLUDE} -rl x src | head -5`)
  })

  test('leaves alone what the guard would let through', () => {
    expect(rewriteSearch('grep -n foo file.ts')).toBeNull()
    expect(rewriteSearch(`grep -rn ${GREP_EXCLUDE} x .`)).toBeNull()
    expect(rewriteSearch('grep -R --include="*.ts" foo .')).toBeNull()
    expect(rewriteSearch('ls -la')).toBeNull()
  })

  test('still fixes a search whose --include selects .env', () => {
    expect(rewritten('grep -rn --include=".env*" KEY .')).toBe(`grep ${GREP_EXCLUDE} -rn --include=".env*" KEY .`)
  })
})

describe('rg', () => {
  test('gets a negative glob when it searches hidden or ignored files', () => {
    expect(rewritten('rg --hidden foo')).toBe(`rg ${RG_EXCLUDE} --hidden foo`)
    expect(rewritten('rg -uu "x" src')).toBe(`rg ${RG_EXCLUDE} -uu "x" src`)
  })

  test('is left alone otherwise', () => {
    expect(rewriteSearch('rg foo src')).toBeNull()
    expect(rewriteSearch(`rg --hidden -g '!node_modules' foo`)).toBeNull()
  })
})

describe('heredocs', () => {
  test('a heredoc body is file content and is never changed', () => {
    const command = 'cat > notes.md <<EOF\nrun grep -rn x . to find it\nEOF\ngrep -rn y src'
    expect(rewritten(command)).toBe(`cat > notes.md <<EOF\nrun grep -rn x . to find it\nEOF\ngrep ${GREP_EXCLUDE} -rn y src`)
  })

  test('a search only inside a heredoc body needs nothing', () => {
    expect(rewriteSearch("cat > a.sh <<'EOF'\ngrep -rn x .\nEOF")).toBeNull()
  })

  test('<<- ends at a tab-indented terminator; <<< is no heredoc', () => {
    expect(markHeredocs('cat <<-END\n\tgrep -r x .\n\tEND\nls').map(line => line.isHeredocBody)).toEqual([false, true, true, false])
    expect(markHeredocs('grep x <<< "$v"\nls').map(line => line.isHeredocBody)).toEqual([false, false])
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
