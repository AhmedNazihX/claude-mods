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

Everything else runs unchanged. Heredoc bodies (text being written to a file) are never touched. Each change is noted in the debug log (`claude --debug`).

It only ever *adds* an exclusion: a command can read less after the change, never more.

## Development

```
claude plugin validate .
claude plugin test .
```
