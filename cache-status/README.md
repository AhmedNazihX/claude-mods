# cache-status

A band above the Claude Code prompt that shows how the prompt cache is doing and what each reply costs.

```
● cache warm · 52m · ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱ 94% from cache (120k read, 3k written) · turn $0.08 · session $3.21
```

It appears after the first reply of a session and works in the terminal, the desktop app and VS Code.

## Reading the band

| Part | Meaning |
|---|---|
| `● cache warm · 52m` | The cache is warm and expires in 52 minutes unless you send another message. Green, then yellow below 50% of the lifetime, then red below 20%. |
| `○ cache cold` | The cache expired: the next message re-caches the whole context, which costs more. |
| `◌ replying…` | A reply is running; the dimmed numbers are the previous turn's. |
| The bar | How much of the last turn's input came from the cache, one tick per 5%. Its colour follows the turn's cost (green, yellow, red), shaded dark to light along the bar. |
| `turn $0.08` | What the last turn cost: every request it made, tool calls and subagents included. |
| `session $3.21` | The session total, the same figure `/cost` shows. |

Costs come from Claude Code's own ledger, at list prices (or your organization's configured pricing). On a subscription they show what the usage would cost on the API, not what you are charged.

On a narrow window the band drops the token counts, then the session total, and halves the bar.

## Settings

Open `/config` and find the `cache-status` rows:

| Setting | Default | |
|---|---|---|
| Cache lifetime | `1h` | Set to `5m` if your sessions use the 5-minute cache, or the countdown will be wrong. |
| Yellow from ($) | `0.10` | A turn costing this much or more turns the bar yellow. |
| Red from ($) | `0.50` | A turn costing this much or more turns the bar red. |
| Bar length | `20` | Ticks in the bar, 5 to 40. |

## What it does and doesn't do

It reads each turn's token usage and the session's cost total, and draws the band. It makes no network calls, runs no commands, and reads or writes no files.

## Development

```
claude plugin validate .
claude plugin test .
```

Smoothly shaded ticks need a terminal with 24-bit colour (Ghostty, iTerm2, kitty, VS Code); others round the shades.
