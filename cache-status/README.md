# cache-status

A band above the Claude Code prompt that shows how the prompt cache is doing and what each reply costs.

```
ctx ▰▰▰▰▰▰▱▱▱▱ 62% (compacts at 83%) · usage 5h ▰▰▰▰▱▱▱▱▱▱ 41% (resets in 3h 20m) · week ▰▰▱▱▱▱▱▱▱▱ 18% (resets in 2d 4h)
● cache warm · 52m · hit ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱ 94% from cache (120k read, 3k written) · cost $0.08 · session $3.21
```

It appears after the first reply of a session and works in the terminal, the desktop app and VS Code.

In the desktop app, whose UI font is large and proportional, each line is drawn as one compact SVG instead: small monospace text, rounded block bars and wide, even gaps.

```
ctx ▪▫▫▫▫▫▫▫▫▫ 7%    usage 5h ▪▫▫▫▫▫▫▫▫▫ 8%    week ▪▪▪▪▪▪▪▪▪▪ 97%
● cache 42m    ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪ 98% hit    cost $0.25    session $0.25
```

Its colours are tuned for the desktop's dark theme.

## Reading the band

| Part | Meaning |
|---|---|
| `● cache warm · 52m` | The cache is warm and expires in 52 minutes unless you send another message. Green, then yellow below 50% of the lifetime, then red below 20%. |
| `◐ cache expiring · 10m` | Less than 20% of the lifetime is left (12 minutes on the 1h cache): send a message soon to keep it. |
| `○ cache cold` | The cache expired: the next message re-caches the whole context, which costs more. |
| `◌ replying…` | A reply is running; the dimmed numbers are the previous turn's. |
| `hit` bar | How much of the last turn's input came from the cache, one tick per 5%. Green from 80%, yellow from 50%, red below; shaded dark to light along the bar. |
| `cost $0.08` | What the last turn cost: every request it made, tool calls and subagents included. Green, then yellow and red at the thresholds in Settings. |
| `session $3.21` | The session total, the same figure `/cost` shows. |
| `ctx 62% (compacts at 83%)` | How full the context window is, and where auto-compact will summarise it. Green, yellow from 75% of the way to that point, red from 90%. |
| `usage 5h 41%` · `week 18%` | Your plan's usage windows (Pro/Max), as Claude Code reads them. Green, yellow from 60%, red from 85%. After each, how long until it resets. Not shown on API-key billing. |

Costs come from Claude Code's own ledger, at list prices (or your organization's configured pricing). On a subscription they show what the usage would cost on the API, not what you are charged.

On a narrow window the band drops the token counts, then the session total, halves the bar, and shows the meters as percentages only.

## Settings

Open `/config` and find the `cache-status` rows:

| Setting | Default | |
|---|---|---|
| Cache lifetime | `1h` | Set to `5m` if your sessions use the 5-minute cache, or the countdown will be wrong. |
| Yellow from ($) | `0.10` | A turn costing this much or more turns the cost yellow. |
| Red from ($) | `0.50` | A turn costing this much or more turns the cost red. |
| Bar length | `20` | Ticks in the bar, 5 to 40. |

## What it does and doesn't do

It reads each turn's token usage, the session's cost total, the context window's fill and the plan usage windows, and draws the band. It makes no network calls, runs no commands, and reads or writes no files.

## Development

```
claude plugin validate .
claude plugin test .
```

Smoothly shaded ticks need a terminal with 24-bit colour (Ghostty, iTerm2, kitty, VS Code); others round the shades.
