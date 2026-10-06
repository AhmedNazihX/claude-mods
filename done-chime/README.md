# done-chime

Plays a short chime and shows a toast when a long Claude reply finishes, so you can switch to something else while Claude works.

```
✅ Claude finished (1m 12s)
```

It only chimes for replies in the main conversation that ran at least 30 seconds. Short replies, replies you interrupted, and subagents stay quiet. If a reply ends on an error, the toast says so: `⚠️ Claude stopped: error (2m 3s)`.

The toast goes after a few seconds, so the same line also stays in the status line under the prompt until you're back. It clears when you send your next prompt or the next reply starts.

## Settings

In `/config`:

| Setting | Default | |
|---|---|---|
| Chime after (seconds) | `30` | Replies shorter than this stay quiet. |
| Chime sound | `arpeggio` | Which sound plays (see below). |
| Play a sound | on | Off shows the toast only. |

## Notes

- The sound plays through `afplay` on macOS. Linux and Windows terminals have no player, so you get the toast only.
- Six sounds ship with the mod, all original and generated for it:

  | Sound | |
  |---|---|
  | `arpeggio` | four quick rising notes, C-E-G-C (default) |
  | `rising` | two rising notes |
  | `bell` | one struck bell with a long ring |
  | `marimba` | two soft, low wooden notes |
  | `ding-dong` | two falling notes, like a doorbell |
  | `glass` | one short, high ping |

  To use your own sound, replace one of the files in `sounds/`.

## Development

```
claude plugin validate .
claude plugin test .
```
