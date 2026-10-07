# agent-chat

A side pane with the conversations between Claude and its subagents, live: one card per subagent with the task Claude handed it and the report it sent back. What a subagent does along the way stays out, and so does the main conversation, which is in the transcript already. Claude Code shows a subagent there as one `Agent` row; this pane shows the conversation.

```
1 working · 1 finished

╭──────────────────────────────────────────────────╮
│ ▸ ● Explore                          done · 22s  │
│ Find the cache band                              │
│ I found both: the hook is in register.tsx and    │
│ the band is built by renderBand in band.tsx. It… │
│ 6 tools · 12k tokens                             │
╰──────────────────────────────────────────────────╯
╭──────────────────────────────────────────────────╮
│ ▾ ● Explore                         working · 8s │
│ haiku 4.5 · 2 tools · 0 skills · 0 agents        │
│ 4k tokens                                        │
│ main asked                                       │
│   In done-chime, list each hook …                │
│ ⋯ working                                        │
╰──────────────────────────────────────────────────╯
```

- **A card is open while its subagent works and shuts to a summary once it's done**: the task in a few words, the start of the report as plain text (two lines' worth), and its tools and tokens. Click `▸` to open it in full, `▾` to shut it again. A card you open or shut by hand stays that way, even when its subagent finishes.
- **One card per subagent**, in the order they started (or were last sent a follow-up), its border, dot and name in the subagent's colour. Two `Explore` subagents read apart by colour: blue, pink, yellow, violet, cyan, orange, teal, none of them the green and red kept for `done` and `stopped`. Past seven, when a colour comes round again for the same type, the name gets a number (`Explore #2`).
- **Under the name, what it ran on and did**: its model, its own tool calls (counted live, with the skills it used and the subagents it started among them), and its tokens on a line of their own, counted as Claude Code's own agent card counts them: its last model request's whole input (cached or not) plus the reply, so they read as how big its context got, not a sum of every request. They follow it live, one model request at a time, while the subagent works, and stop on the same number Claude Code shows when it's done.
- **The task and the report are drawn as markdown**, as a reply is: bold, code, lists and links read as they should.
- **Long ones are cut** to their first lines (4 of a task, 6 of a report); `▾ show N more lines` opens the rest and `▴ show less` shuts it again. Click it, or press it once the pane has the keys.
- **The time counts up live** while a subagent works, and stays at its total once it is done.
- **Follow-ups join the conversation.** When Claude sends a finished subagent more work (new instructions, review feedback) with `SendMessage`, its card works again and moves to the end of the pane: the message reads under the first report as `main asked`, and the new reply under it, with the earlier ones kept. Its time counts the new run, and a shut card shows the latest reply and how many follow-ups it had (`6 tools · 1 follow-up · 12k tokens`).
- A subagent started by another says who asked it; a run cut short reads `stopped`.

Scroll the pane with the wheel or trackpad to read back. It follows the newest message while you're at the bottom, and stays where you are once you scroll up, until you scroll back down.

## Opening it

It opens by itself the first time Claude starts a subagent in a session, once the window is wide enough (144 columns) to dock it beside the conversation. Otherwise type `/agent-chat`.

## Settings

In `/config`:

| Setting | Default | |
|---|---|---|
| Open when a subagent starts | on | Off: open it with `/agent-chat` only. |
| Pane width (columns) | 60 | How wide it docks beside the conversation, 30 to 120. A width you drag it to wins. |

Nothing the pane shows reaches the model: it only reads what happens.
