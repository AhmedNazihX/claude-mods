# safe-search

Stops recursive searches from being blocked for reading `.env` files: the mod adds the flag that skips them before the command runs.

| Claude runs | What actually runs |
|---|---|
| `grep -rn TODO src` | `grep --exclude='.env*' -rn TODO src` |
| `cd app && grep -rl x src \| head` | `cd app && grep --exclude='.env*' -rl x src \| head` |
| `rg --hidden foo` | `rg -g '!.env*' --hidden foo` |

## Why

A secrets guard such as git-guardrails' `block-secrets` hook blocks a recursive `grep` (and an `rg` that searches hidden or ignored files) because it would read `.env` files into the transcript. Each block costs a turn: Claude reads the refusal, adds the flag and runs the command again. This mod adds the flag up front, so the search goes through the first time and still never reads `.env`.

## When it changes a command

Only when the guard would block it, using the same rules:

- `grep`, `egrep` or `fgrep` with `-r`, `-R` or `--recursive`, and no `--exclude` mentioning `env` (an `--include` that doesn't select `.env` already makes it safe)
- `rg` with `-u`, `--hidden` or `--no-ignore`, and no `-g '!…'`

…and only when it can read the command with certainty. These are left unchanged, so the guard blocks them as before:

| Left to the guard | Why |
|---|---|
| a search word inside quotes, e.g. `sh -c 'grep -r …'` | the flag's own quotes would end the user's, and the shell would turn `.env*` into file names that grep then reads |
| a search that asks for env files, e.g. `--include='.env*'`, `rg -g '.env'` | the later flag would override the exclude |
| more than one line (heredocs, `\` continuations), `$(…)`, backticks, `eval` | the shell may read these differently from a pattern match |

When it does change a command, every `grep` word gets the exclude and every `rg` the glob, not only the recursive ones, so no search in a chain is missed. Each change is noted in the debug log (`claude --debug`).

It only ever *adds* an exclusion: a command can read less after the change, never more.

**Limit:** `grep -R` follows symlinks, and the exclude matches file *names*. A symlink with another name pointing at a `.env` file would still be read. The guard has the same gap.

## Development

```
claude plugin validate .
claude plugin test .
```
