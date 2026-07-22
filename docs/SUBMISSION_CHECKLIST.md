# Submission Checklist

Use this as the final handover checklist before sending the Jenosize assignment.

## ✅ Live Deployment (2026-07-22)

- **Live URL:** https://jenosize-ai-crm.vercel.app
- **Demo login:** `admin@jenosize.demo` / `Demo1234!` (all seeded users share this password)
- **Hosting:** Vercel project `kolaaaaa/jenosize-ai-crm`
- **Database:** Neon Postgres (ap-southeast-1) — 4 migrations applied, seeded 2000 contacts / 300 leads
- **LINE:** `LINE_ENABLED=true` + live channel creds set in Vercel; production webhook = `https://jenosize-ai-crm.vercel.app/api/line/webhook`
- **Live smoke test:** `scripts/smoke-deploy.mjs` → **11/11 PASS** against the deployed URL
- Prod secrets live in gitignored `.env.production`; all 11 env vars pushed to Vercel. Nothing secret committed.

## Local Readiness

- [x] Local Docker Postgres runs with `pnpm db:up`.
- [x] Migrations exist under `prisma/migrations`.
- [x] Deterministic seed creates scenario-scale synthetic data.
- [x] Demo users documented in `README.md`.
- [x] Required tests are present: CRM flow, AI fallback, LINE webhook security/idempotency.
- [x] README has architecture, setup, DB config, API notes, LINE setup, and monitoring notes.
- [x] AI usage log exists at `docs/AI_USAGE_LOG.md`.
- [x] Walkthrough recording outline exists at `docs/WALKTHROUGH_SCRIPT.md`.

## Verification Commands

Always clear inherited IDE debugger options first:

```bash
export NODE_OPTIONS=
pnpm exec tsc --noEmit
pnpm exec eslint
pnpm test
pnpm build
pnpm predeploy:check
pnpm submission:audit
pnpm smoke:deploy
pnpm line:events
pnpm line:backfill
```

Current local result:

- `pnpm exec tsc --noEmit`: passed
- `pnpm exec eslint`: passed
- `pnpm test`: 11 files / 75 tests passed
- `pnpm build`: passed (Vercel production build completed in 47s)
- `pnpm predeploy:check`: passes against `.env.production` (Neon pooled/direct URLs, https remote `APP_URL`). Still fails against local `.env` by design (local Docker URLs, local HTTP `APP_URL`).
- `pnpm submission:audit`: checks required evidence files, package scripts, known test-count docs, secret-looking tracked values, and current deploy-env readiness. Local mode passes with a deploy-env warning; `SUBMISSION_REQUIRE_EXTERNAL=true pnpm submission:audit` correctly fails until remote `APP_URL` and DB env are set.
- `pnpm smoke:deploy`: **11/11 PASS against the live deployment** (https://jenosize-ai-crm.vercel.app) — login/session/core pages/webhook rejection/logout
- `pnpm line:events`: available to discover recent signed LINE `lineUserId`s for contact mapping
- `pnpm line:backfill`: available to recover signed `FAILED` LINE webhooks after a contact is mapped

## Deploy Prerequisites

Current blocker from local state: `.env` points `DATABASE_URL` and `DIRECT_URL` at local Docker (`localhost:5432`). A Vercel deployment needs remote Postgres values, preferably Neon:

- `DATABASE_URL`: Neon pooled runtime URL
- `DIRECT_URL`: Neon direct migration URL
- `AUTH_SECRET`: long random string
- `ANTHROPIC_API_KEY`: set in Vercel env only
- `CRM_AI_MODEL`: optional model override
- `LINE_CHANNEL_SECRET`: LINE Developers channel secret
- `LINE_CHANNEL_ACCESS_TOKEN`: LINE Developers channel access token
- `LINE_ENABLED=true` for the real LINE adapter
- `APP_URL`: final Vercel URL

Do not commit any filled `.env` file.

Deploy audit on 2026-07-22 (**satisfied**):

- Vercel: deployed via `npx vercel` (project `kolaaaaa/jenosize-ai-crm`, `.vercel/project.json` present).
- Database env: prod Neon URLs in `.env.production` (gitignored) and pushed to Vercel; local `.env` still Docker (intentional).
- LINE and Anthropic env values: set in Vercel prod env via `vercel env add`, never committed.

## Deploy Steps

**Status: ✅ all steps completed 2026-07-22** (kept below as the reproducible runbook / for a redeploy).

1. Create a Neon project and copy pooled/direct connection strings.
2. Set Vercel environment variables listed above.
3. Run the strict predeploy gate:

```bash
export NODE_OPTIONS=
pnpm predeploy:check
```

4. Run production migrations against Neon:

```bash
export NODE_OPTIONS=
DATABASE_URL="NEON_POOLED_URL" DIRECT_URL="NEON_DIRECT_URL" pnpm exec prisma migrate deploy
```

5. Seed synthetic demo data if the deployed DB is empty:

```bash
export NODE_OPTIONS=
DATABASE_URL="NEON_POOLED_URL" DIRECT_URL="NEON_DIRECT_URL" pnpm db:seed
```

6. Deploy the app to Vercel.
7. Set the LINE webhook URL to:

```text
https://YOUR_VERCEL_HOST/api/line/webhook
```

## Smoke Test

Automated baseline (**passed 11/11 against the live URL**):

```bash
SMOKE_BASE_URL="https://jenosize-ai-crm.vercel.app" pnpm smoke:deploy
```

Optional signed LINE webhook smoke (set `SMOKE_LINE_USER_ID` to a userId already linked on **prod** — the local link is not in Neon):

```bash
SMOKE_BASE_URL="https://jenosize-ai-crm.vercel.app" \
SMOKE_LINE_USER_ID="U..." \
SMOKE_EXPECT_LINE_PROCESSED="true" \
pnpm smoke:deploy
```

- [ ] Open deployed `/login`.
- [ ] Log in as `admin@jenosize.demo`.
- [ ] Open `/leads`, search/filter, and open a lead detail page.
- [ ] Move a lead stage and hard-refresh; stage and timeline update persist.
- [ ] Generate an AI suggestion; fallback path is acceptable if Anthropic credits are unavailable.
- [ ] Send an invalid LINE webhook request; deployed route returns 401.
- [ ] Send a real LINE OA message from a mapped user; message appears on the mapped lead timeline.
- [ ] If the LINE user is not mapped yet, run `DATABASE_URL="NEON_POOLED_URL" pnpm line:events`, copy the source `lineUserId`, and edit a contact with that value.
- [ ] If `pnpm line:events` shows no IDs, confirm a real one-on-one LINE message reached the webhook; `LINE_EVENTS_INCLUDE_EMPTY=true pnpm line:events` can inspect signed rows without source user IDs.
- [ ] After mapping, run `DATABASE_URL="NEON_POOLED_URL" pnpm line:backfill` to recover signed events that were captured before mapping.
- [ ] Save a LINE draft from an AI suggestion and click **Approve & send**.
- [ ] Replay the same webhook event; no duplicate message/activity is created.

## Submission Package

- [ ] Source repo URL — *no git remote yet; push to GitHub and paste the URL*
- [x] Deployed Vercel URL — **https://jenosize-ai-crm.vercel.app**
- [x] Demo credentials — **`admin@jenosize.demo` / `Demo1234!`**
- [ ] LINE OA QR code or test instructions — *from LINE Developers console (Bot basic ID `@488yhaah`); repoint webhook to the Vercel URL first*
- [x] `docs/AI_USAGE_LOG.md`
- [ ] 3-5 minute walkthrough video using `docs/WALKTHROUGH_SCRIPT.md`
