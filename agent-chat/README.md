# agent-chat

A side pane with the messages between Claude and its subagents, live: the task Claude handed each subagent, and the report it sent back. What a subagent does along the way stays out, and so does the main conversation, which is in the transcript already. Claude Code shows a subagent there as one `Agent` row; this pane shows the conversation.

```
1 running · 1 finished

main → ● Explore
  In cache-status, find where the band above the prompt
  is drawn (the ui.render hook for AbovePrompt …)

● Explore → main   done · 22s
  I found both: the hook is in register.tsx and the
  function that builds the band is renderBand in band.tsx.
  … 9 more lines

main → ● Explore
  In done-chime, list each hook the mod registers …
  ⋯ working
```

Each subagent is named by its type and keeps one colour (a dot and its name), so two `Explore` subagents read apart by colour: blue, pink, yellow, violet, cyan, orange, teal, in the order they start, none of them the green and red the pane keeps for `done` and `stopped`. Past seven, when a colour comes round again for the same type, the name gets a number (`Explore #2`). A subagent started by another names that one instead of `main`. A message shows its first 6 lines and counts the rest; a run cut short reads `stopped`.

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
