# turn-timeline

A **Tool timeline** card above each of Claude's replies: every tool call it made, where each one fell in the turn, how long it took and how it ended.

```
╭───────────────────────────────────────────────────────────────────╮
│  Tool timeline                                     4 calls · 8.9s │
│                                                                   │
│   R  Read package.json   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   0.2s ✓  │
│   $  Bash rm -rf dist    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   denied  │
│   $  Bash trash dist     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   0.3s ✓  │
│   $  Bash bun test       ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   8.4s ✓  │
│                                                                   │
│  ╭─────────────────────────────────────────────────────────────╮  │
│  │ ⊘ rm -rf dist → trash dist             denied · use the trash │  │
│  ╰─────────────────────────────────────────────────────────────╯  │
╰───────────────────────────────────────────────────────────────────╯
```

## Reading the card

| Part | Meaning |
|---|---|
| Badge | The tool: `R` Read, `W` Write, `E` Edit, `$` Bash, `?` Grep, `*` Glob, `@` web, `A` subagent, `S` skill, `M` MCP |
| Text | What the call did: the command it ran (or Claude's description of it when the command is too long to read), the search, or the file path (from the project folder, `~/…` elsewhere in your home folder). `↳` marks a call made by a subagent |
| Bar | The calls laid end to end across the bar: each coloured part is one call's share of the total time, so the slow ones stand out. Time spent thinking between calls is left out. Red when it was denied or failed |
| Right | How long it took, with `✓` (yellow from 30s, red from 2 minutes), or `denied` / `failed` |
| Red box | Every denied or failed call on the card, why it didn't run (cut to its gist), and what ran in its place (`→`) when the very next call was the same tool and worked |

Each block of Claude's text gets a card for the tool calls made since the block before it, so a reply that works in stretches ("Let me check…", tools, "Now the fix…", tools, the answer) has a card above each stretch's text. Cards stay in the conversation as you scroll back. Text with no tool calls before it gets no card, and neither does a single call that went fine (its bar would be the whole bar); a single call that was denied or failed still gets one.

While Claude works, the card of the calls so far grows on the working spinner, one row per call as it starts (`running…` until it ends); when Claude's text arrives, the card moves above it.

Calls that fail before they run (a tool that isn't available, input the tool refuses) are on the card too, read from the stored request and result, with no time of their own. A long turn shows its last 12 calls (`… 8 earlier`). On the desktop app the bars are drawn as shapes. Claude Code's own folded summary line (`Ran 2 shell commands`) is left out when a card shows the same calls; ctrl+o still shows every call.
