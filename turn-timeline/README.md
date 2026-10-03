# turn-timeline

A live side pane listing every tool call of the current reply: what ran, when, how long it took and how it ended.

```
◌ running 6 calls · 1m 12s
“fix the failing test”
✓  +0:00    0.3s Read       band.tsx
✓  +0:01     42s Bash       Run the tests
✗  +0:43    1.2s WebFetch   docs.anthropic.com
⊘  +0:45    0.0s Write      x.ts
✓  +0:46    0.4s ↳Read      format.ts
◌  +0:47      9s Bash       npm run lint
Read 2 · Bash 2 · WebFetch 1 · Write 1
```

## Reading the pane

| Part | Meaning |
|---|---|
| `✓` `◌` `✗` `⊘` | done, running, failed, blocked (by a hook or a permission) |
| `+0:43` | when the call started, counted from your message |
| `42s` | how long it took; yellow from 30s, red from 2 minutes. Running calls count up live |
| `↳Read` | a call made by a subagent |
| last line | how many calls each tool made |

The header shows whether the reply is still running, its number of calls and its total time, with your message under it. The last reply stays on screen until you send the next one. In a short pane the oldest calls scroll off (`… 4 earlier`).

## Opening it

It opens by itself when a session starts, once the window is wide enough (144 columns). Otherwise type `/timeline`.

## Settings

In `/config`:

| Setting | Default | |
|---|---|---|
| Open at session start | on | Off: open it with `/timeline` only. |
| Pane width (columns) | `60` | How wide it docks beside the conversation (30 to 120). |
| Pane height (rows) | `12` | How tall it is above the prompt (5 to 40). |

A size you drag the pane to wins over these.

## What it does and doesn't do

It watches tool calls and turn starts and ends, and draws the pane. It doesn't change, block or delay any call, and it makes no network calls and touches no files.

## Development

```
claude plugin validate .
claude plugin test .
```
