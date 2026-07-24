<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Release & Deploy — the way of work

This is the exact, repeatable procedure for shipping. Follow it in order. Do the
outward steps (commit/push, deploy) **only when the user explicitly asks**, and —
under `on-request` approvals — surface the command for approval before running it.

## 1. Verify before shipping

```bash
npx tsc --noEmit        # must be clean
pnpm test               # run when logic changed (skip for pure CSS/markdown)
```

## 2. Commit & push to `main`

- **Stage only the files you changed** — never `git add -A`/`.`. The working tree
  often carries untracked artifacts from parallel sessions (`docs/agent-teams.md`,
  `public/*.png`, `src/app/favicon.ico`); listing paths explicitly keeps them out.
- **Never commit secrets.** `.env` and `.env.production` are gitignored — keep them so.
- End the commit message with a co-author trailer identifying the assisting agent, e.g.
  `Co-Authored-By: Codex <noreply@openai.com>`.
- Push: `git push origin main`. (This repo commits directly to `main` by design.)
  The `origin` remote uses **SSH** (`git@github.com:…`) authenticated by the
  passphrase-less `~/.ssh/id_ed25519` key — no macOS Keychain, ssh-agent, or stored
  token needed, so it works from a sandbox. (HTTPS + Keychain does **not** work in
  the sandbox, which is why the remote is SSH.)

## 3. Deploy migrations to Neon — **only if a migration exists**, and **before** step 4

Prisma's own dotenv loads `.env`, **not** `.env.production`, and it will **not**
override variables already in the shell. So export the production URLs into the
shell first, then run the deploy:

```bash
set -a && . ./.env.production && set +a   # loads DATABASE_URL + DIRECT_URL
pnpm exec prisma migrate deploy            # uses DIRECT_URL (unpooled)
```

Expect `No pending migrations to apply.` when nothing is pending (e.g. a CSS-only
change). If a new migration exists, it **must** be applied here before the Vercel
deploy goes live, so the code never runs against an older schema.

## 4. Deploy to Vercel

```bash
npx vercel --prod --yes
```

- Builds from the **local working tree** (so commit first; uncommitted files are
  still bundled into the build).
- The project is already linked (`.vercel/`) and authed — no re-linking needed.
- Wait for `readyState: READY`, aliased to the production domain.

## 5. Health-check production

```bash
curl -s -o /dev/null -w '%{http_code}' https://jenosize-ai-crm.vercel.app/       # expect 307 → /login
curl -s -o /dev/null -w '%{http_code}' https://jenosize-ai-crm.vercel.app/login  # expect 200
```

Report outcomes honestly: the commit hash pushed, the Neon result, the Vercel
deployment id + ready state, and the health-check codes. See `README.md` for more.

> Sandbox note: `git push`, `prisma migrate deploy`, and `vercel` all need network
> access. This project is `trust_level = "trusted"` and the workspace-write sandbox
> has `network_access = true`, so these run without a network-escalation prompt.
> GitHub auth uses the SSH key (see the push step) rather than the Keychain, which a
> sandboxed process cannot read.
