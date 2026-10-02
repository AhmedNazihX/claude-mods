# secret-guard

Stops Claude from writing secrets into your files. Before every Write, Edit or NotebookEdit, it checks the new content for credentials. If it finds one, the edit is refused and Claude is told which secret it found, on which line, and to read it from an environment variable instead. You also get a toast:

```
🔒 Blocked a secret from being written to client.ts
```

The message never repeats the secret: Claude sees only its first characters, like `sk-ant…`.

## What it catches

| Secret | Recognised by |
|---|---|
| Anthropic, OpenRouter, OpenAI API keys | `sk-ant-…`, `sk-or-v1-…`, `sk-…` / `sk-proj-…` |
| Stripe secret keys | `sk_live_…`, `sk_test_…`, `rk_…` |
| Supabase secret keys | `sb_secret_…`, and **service_role** JWTs (the token is decoded; the public `anon` key is allowed) |
| AWS access keys | `AKIA…`, `ASIA…` |
| GitHub tokens | `ghp_…`, `gho_…`, `github_pat_…` |
| Slack tokens | `xoxb-…`, `xoxp-…` |
| Google API keys | `AIza…` |
| Private keys | `-----BEGIN … PRIVATE KEY-----` |
| Database passwords | `postgresql://user:password@host`, except local hosts and placeholders like `[YOUR-PASSWORD]` |

Placeholders such as `sk_live_xxxxxxxx…` or `AKIAIOSFODNN7EXAMPLE` pass.

## Where secrets are allowed

`.env`, `.env.local` and other `.env.*` files can hold secrets, since that's where they belong (keep them gitignored). Templates such as `.env.example` and `.env.sample` are still checked, because they get committed.

## Settings

In `/config`, **When a secret is found** is `block` (default) or `warn`. Use `warn` if it gets in the way, for example while writing test fixtures: the edit goes through and you still get the toast.

## Limits

It checks what Claude writes through the file tools. It doesn't check shell commands (`echo … > file`), files you edit yourself, or secrets in formats it doesn't know. Treat it as a safety net, not a replacement for a secret scanner in CI.

## Development

```
claude plugin validate .
claude plugin test .
```
