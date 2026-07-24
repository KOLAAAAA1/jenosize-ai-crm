# AI CRM MVP

Internal AI CRM for a 20-person commercial team — a responsive CRM website, persistent database, a reusable `crm-copilot` AI skill, and LINE OA integration. Built as one coherent vertical slice.

> **Status:** work in progress. See [`docs/PLAN.md`](docs/PLAN.md) for the full implementation plan, scope per part, and trade-offs.

---

## System architecture

One Next.js app, one audit boundary: everything the AI or LINE produces is a **suggestion or a record** until a human approves it — that gate is the audit trail.

```mermaid
flowchart TD
    subgraph CLIENT["Client"]
        UI["Salesperson · Browser CRM UI<br/>list · search / filter · timeline · Ask AI"]
        LINE["LINE Platform<br/>inbound messages from LINE OA users"]
    end

    subgraph APP["Application — Next.js on Vercel · runtime = nodejs"]
        CRM["/api/crm/*<br/>CRUD · stage move writes STAGE_CHANGE"]
        COP["/api/ai/copilot<br/>builds CRM context"]
        WH["/api/line/webhook<br/>verify X-Line-Signature · dedupe · map lineUserId"]
    end

    BOUNDARY{{"Suggestion → Commit boundary<br/>AI output and inbound LINE are records, not silent writes<br/>human Accept / Approve before it becomes CRM truth"}}

    subgraph BACKEND["Backend services"]
        SKILL["crm-copilot skill → Claude API<br/>summary · score · next-best action · draft reply<br/>fallback: deterministic scorer"]
        DB[("Prisma → PostgreSQL · Neon<br/>9 tables · migrations · idempotency constraints")]
    end

    UI -->|"fetch (Zod-typed)"| CRM
    UI --> COP
    LINE -->|"POST webhook"| WH

    CRM --> BOUNDARY
    COP --> BOUNDARY
    WH --> BOUNDARY

    BOUNDARY --> SKILL
    BOUNDARY --> DB
    SKILL -->|"AiSuggestion SUGGESTED"| DB

    classDef line stroke:#06a94a,stroke-width:1.5px;
    classDef ai stroke:#cf7a2e,stroke-width:1.5px;
    classDef data stroke:#0f9384,stroke-width:1.5px;
    class LINE,WH line;
    class SKILL ai;
    class DB data;
```

> An interactive, theme-aware version of this diagram lives at [`docs/architecture.html`](docs/architecture.html) — open it in a browser.

### Key data flows

Four request paths that exercise the boundary above. Each is a graded flow in the assignment.

| # | Flow | Path |
|---|------|------|
| 01 | **LINE inbound message** | `LINE → /api/line/webhook →` verify sig `→` dedupe `→` persist `Message` + `WebhookEvent` `→` map to lead `→` timeline |
| 02 | **Ask AI on a lead** | `UI → /api/ai/copilot →` build context `→` Claude (or fallback) `→ AiSuggestion (SUGGESTED) →` Accept writes `Activity` |
| 03 | **Approve & send LINE reply** | draft `→` human **Approve** `→` LINE send (mock adapter when disabled) `→ Message (SENT)` `→` retry-safe |
| 04 | **Move a lead stage** | board drag `→` server action `→` update `stage` `→` write `STAGE_CHANGE` activity `→` timeline |
| 05 | **Email inbound / outbound** | email gateway `→ /api/email/inbound →` map sender to Contact/Lead `→` timeline; CRM draft `→` explicit approval `→` gateway send |

---

## Database configuration

The app connects through the Prisma **pg driver adapter**, so a single connection
string targets any Postgres. **Switching targets is an env change, not a code change.**

| Target | When | `DATABASE_URL` |
|---|---|---|
| **Local Docker** (default) | day-to-day dev | `postgresql://crm:crm@localhost:5432/crm?schema=public` |
| Local native / remote server | own/hosted Postgres | `postgresql://USER:PASS@HOST:5432/crm?schema=public` |
| **Neon serverless** | production / final migration | pooled endpoint (`...-pooler...?sslmode=require&pgbouncer=true`) |

`DATABASE_URL` is used by the app at runtime; `DIRECT_URL` is used by `prisma migrate`
(same value unless the target has a pooler, e.g. Neon). If `DATABASE_URL` is unset in
development it defaults to local Docker; in production it is **required** (no silent fallback).

### Quickstart (local Docker — default)
```bash
pnpm db:up        # start the Postgres container
pnpm db:migrate   # apply migrations
pnpm db:seed      # load synthetic data (deterministic)
pnpm dev          # http://localhost:3000
```

Demo users after seeding:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@jenosize.demo` | `Demo1234!` |
| Manager | `manager@jenosize.demo` | `Demo1234!` |
| Sales | `sales@jenosize.demo` | `Demo1234!` |

### Verification
```bash
pnpm exec tsc --noEmit
pnpm exec eslint
pnpm test
pnpm predeploy:check # strict: expects remote DB + deployed APP_URL
pnpm submission:audit
pnpm smoke:deploy   # targets APP_URL/SMOKE_BASE_URL; works for local or deployed smoke
```

For the final deployed submission, run the audit in strict external mode:

```bash
SUBMISSION_REQUIRE_EXTERNAL="true" pnpm submission:audit
```

In this local environment, clear `NODE_OPTIONS` before running Node/pnpm commands if your shell inherits an IDE debugger bootloader:

```bash
export NODE_OPTIONS=
pnpm test
```

### Migrating to Neon (after development)
1. Create a Neon project; copy both the **pooled** and **direct** connection strings.
2. Set them in your deploy env (Vercel dashboard) or `.env`:
   `DATABASE_URL=<pooled>` and `DIRECT_URL=<direct>`.
3. Run `pnpm predeploy:check` once `APP_URL` is set to the deployed HTTPS URL.
4. Apply the schema against Neon: `pnpm exec prisma migrate deploy` (uses `DIRECT_URL`).
5. Optionally seed: `pnpm db:seed`.

The app then runs against Neon unchanged. See [`docs/PLAN.md`](docs/PLAN.md) §10 for why the
runtime uses the pooled endpoint (connection-exhaustion under load).

---

## Deploy to Vercel

The app deploys to Vercel; the database is Neon (above). The build command
(`prisma generate && next build`) is defined in `package.json`.

**One-time setup** (skip `npm i -g vercel` if you use `npx vercel`):

```bash
npm i -g vercel
vercel login
vercel link          # link this folder to the Vercel project
```

Set the production env vars in the Vercel dashboard, mirroring
[`.env.example`](.env.example): `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`,
`ANTHROPIC_API_KEY`, and the `LINE_*` vars.

**Deploy — order matters: migrate the database before shipping code that reads it.**

```bash
# 1. Apply pending migrations to prod Neon (uses DIRECT_URL)
export DATABASE_URL="<pooled>" DIRECT_URL="<direct>"
pnpm exec prisma migrate deploy

# 2. Deploy to production (builds from the local tree; aliases the prod domain)
vercel --prod        # or: npx vercel --prod
```

`vercel --prod` builds from your **local working tree**, so commit first for a
reproducible deploy. A preview (non-production) deploy is just `vercel`. After it
finishes, verify with the [smoke test](#deploy-smoke-test).

---

## Portability — moving off Vercel + Neon

The app is deliberately platform-neutral: a standard Next.js **Node.js** server plus a
single Postgres connection string. Nothing depends on Vercel- or Neon-specific APIs, so
another team can run it on containers/Kubernetes, EC2/VMs, or any other cloud by changing
two things only: **a container image and environment variables** — not application code.

**What makes it portable**

- DB access goes through Prisma's **pg driver adapter** — any Postgres works by swapping `DATABASE_URL` / `DIRECT_URL` (see [Database configuration](#database-configuration)). No Neon lock-in.
- No Vercel-only primitives (no Edge runtime, no `@vercel/*` packages); every route runs on the Node runtime and `next start` serves them with zero extra config, including `next/image` optimization.
- All configuration is env-driven and mirrored in [`.env.example`](.env.example).

**1. Containerize the app** — sample `Dockerfile` (Node 24):

```dockerfile
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build                 # prisma generate && next build

FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN corepack enable
COPY --from=build /app ./
EXPOSE 3000
CMD ["pnpm", "start"]          # next start
```

For a slimmer image, set `output: "standalone"` in `next.config.ts` and copy only
`.next/standalone`, `.next/static`, and `public` into the run stage.

**2. Pick a runtime** — the image runs anywhere that runs a container or Node:

| Target | Notes |
|---|---|
| **EC2 / any VM** | `docker run -p 3000:3000 --env-file .env`, or `pnpm build && pnpm start` behind nginx/Caddy for TLS |
| **ECS Fargate / Cloud Run / App Runner** | push the image to a registry, set env vars, front it with the platform's HTTPS load balancer |
| **Kubernetes (EKS/GKE/AKS)** | `Deployment` + `Service` + `Ingress` (TLS); env from `Secret`/`ConfigMap`; run migrations as a `Job` / init container |
| **Fly.io / Render / Railway** | point at the `Dockerfile`; set env vars in their dashboard |

**3. Provision Postgres** — swap Neon for any managed or self-hosted Postgres: RDS / Aurora,
Cloud SQL, Azure Database, or in-cluster **CloudNativePG / StackGres**. Set `DATABASE_URL`
(pooled if the target has a pooler; otherwise same as direct) and `DIRECT_URL`. Keep a
pooler (PgBouncer) or a modest replica count to avoid connection exhaustion.

**4. Run migrations on release, not per replica** — once per deploy, before traffic:

```bash
DATABASE_URL=<pooled> DIRECT_URL=<direct> pnpm exec prisma migrate deploy
```

On Kubernetes this is a pre-deploy `Job` or init container; on ECS a one-off task; on a VM a release step.

**5. Secrets & TLS**

- Move env values into the platform's secret store (AWS Secrets Manager / SSM, GCP Secret Manager, k8s `Secret`) instead of a file — `.env*` stay gitignored.
- The **LINE webhook requires public HTTPS**: terminate TLS at the load balancer / ingress and repoint the LINE Developers **Webhook URL** to `https://NEW_HOST/api/line/webhook`.
- Set `AUTH_SECRET`, `ANTHROPIC_API_KEY`, `LINE_*`, and the DB URLs in the new environment (mirror `.env.example`).

**Not carried over automatically**

- Vercel's build-from-local-tree convenience → replace with CI that builds and pushes the image.
- Vercel-managed HTTPS/CDN → provide your own load balancer / CDN and TLS certificates.
- On glibc Linux, `next/image` (sharp) may need a memory-allocator tweak under sustained load — see the Next.js self-hosting guide.

---

## LINE OA integration

### Add the test LINE OA (QR code)

Scan to add the Messaging API test Official Account (Bot basic ID **`@488yhaah`**),
then send it a one-on-one message to exercise the inbound webhook flow:

<img src="docs/submissions/qr-line-official.png" alt="LINE Official Account QR code — @488yhaah" width="220" />

> For inbound messages to map and for approved replies to send, the channel's
> **Webhook URL** must point at the deployed app
> (`https://YOUR_DEPLOYED_HOST/api/line/webhook`) with **Use webhook** enabled, and
> `LINE_CHANNEL_SECRET` must match the channel. See the setup steps below.

Webhook endpoint:

```text
POST /api/line/webhook
```

Behavior:

- Verifies `X-Line-Signature` against the **raw request body** before JSON parsing.
- Dedupes on LINE `webhookEventId` via `WebhookEvent.providerEventId`.
- Persists mapped inbound text messages as `Message(RECEIVED)` and appends a `LINE_IN` Activity to the lead timeline.
- Records invalid signatures as safe audit metadata only; it does not persist the untrusted message body as a CRM message.
- Uses `Contact.lineUserId` as the LINE user → CRM contact mapping key.

Outbound behavior:

- AI suggestions may contain a draft LINE reply when there is recent LINE context and consent permits it.
- Saving a draft creates `Message(DRAFT)`.
- The salesperson must click **Approve & send** before the app calls the LINE adapter.
- `LINE_ENABLED=false` uses the mock adapter for local development and automated tests.
- `LINE_ENABLED=true` sends a LINE push message with `X-Line-Retry-Key` so retries do not double-send.

Local LINE setup:

1. Create a LINE Messaging API channel in the LINE Developers console.
2. Set `LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN` in `.env` or Vercel env.
3. Deploy the app to HTTPS and set the webhook URL to:
   `https://YOUR_DEPLOYED_HOST/api/line/webhook`.
4. Send a LINE message once; if it is not mapped yet, inspect the signed webhook source ID:
   `DATABASE_URL="NEON_POOLED_URL" pnpm line:events`.
5. Create or edit a contact so `lineUserId` matches the webhook source user ID.
6. Backfill the first captured unmapped event if needed:
   `DATABASE_URL="NEON_POOLED_URL" pnpm line:backfill`.
7. Send another LINE message, then open that contact's lead timeline in the CRM.

### Local webhook via Cloudflare Tunnel

To receive real LINE webhooks against your local dev server (no deploy needed),
expose `localhost:3000` over a public HTTPS URL with a Cloudflare **quick
tunnel** — ephemeral, no Cloudflare account or domain required:

```bash
brew install cloudflared   # once (macOS)
pnpm dev                    # terminal 1 — Next on :3000
pnpm tunnel                 # terminal 2 — prints the public LINE webhook URL
```

`pnpm tunnel` prints a banner like:

```text
Public base:   https://<random>.trycloudflare.com
LINE webhook:  https://<random>.trycloudflare.com/api/line/webhook
```

Paste the **LINE webhook** URL into LINE Developers console (Messaging API →
Webhook URL → **Verify**, then enable **Use webhook**). `LINE_CHANNEL_SECRET` in
`.env` must match this channel — the route rejects any request whose
`X-Line-Signature` doesn't verify (HTTP 401).

Notes:

- The quick-tunnel URL **changes every run**; re-paste it into the LINE console
  each session. For a stable URL, use a Cloudflare **named tunnel**
  (`cloudflared tunnel login` → `create` → `route dns` → `run`), which needs a
  Cloudflare account and a domain.
- Override the local target with `TUNNEL_PORT` (default `3000`).

## Email integration

Email uses the same deliberate safety model as LINE: composing creates an
auditable `Message(DRAFT)` and a user must click **Approve & send** before any
provider call. The CRM contains a provider-neutral gateway seam rather than an
embedded mail-provider credential:

- Outbound delivery posts an authenticated, idempotent payload to
  `EMAIL_OUTBOUND_WEBHOOK_URL` only when `EMAIL_ENABLED=true`.
- Inbound mail is normalized by that gateway and posted to
  `POST /api/email/inbound`, authenticated by `X-Email-Webhook-Secret`.
- Inbound mail maps by the sender email (`Contact.email`), dedupes both delivery
  event and provider message IDs, then persists an `EMAIL` message and timeline
  activity.

Set the five `EMAIL_*` environment variables in `.env.example` only after a
mail gateway is available. The exact request/response contract and a provider
activation checklist are in [`docs/EMAIL_INTEGRATION.md`](docs/EMAIL_INTEGRATION.md).

## Roles and access

The seeded `ADMIN`, `MANAGER`, and `SALES` roles are now enforced on every
protected server action and API path:

- **Admin / Manager:** shared lead queue, directory management, and manual lead reassignment.
- **Sales:** only their own leads, tasks, AI suggestions, and outbound drafts; directory pages and mutations are unavailable.

Manual assignment is intentionally the first routing increment. Automatic
round-robin or territory assignment remains a business-rule decision rather
than hidden behavior.

## API Notes

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/auth/login` | public | Credentials login; sets HttpOnly session cookie |
| `POST /api/auth/logout` | session | Clears session cookie |
| `GET /api/me` | session | Returns the current demo user |
| `POST /api/ai/copilot` | session | Builds lead context, runs Claude or fallback, persists `AiSuggestion(SUGGESTED)` |
| `POST /api/line/webhook` | LINE signature | Receives LINE webhooks; signature is the auth boundary |
| `POST /api/email/inbound` | email gateway secret | Receives normalized inbound email; maps/dedupes it into the lead timeline |

Server Actions own CRM mutations from the UI: stage moves, company/contact saves, suggestion review, LINE draft save, and LINE approve/send.

## Deploy Smoke Test

After starting the app locally or deploying it, run:

```bash
SMOKE_BASE_URL="https://YOUR_DEPLOYED_HOST" pnpm smoke:deploy
```

Defaults use the seeded admin credentials. To also test a signed LINE webhook against a mapped contact, provide:

```bash
SMOKE_LINE_USER_ID="U..." SMOKE_EXPECT_LINE_PROCESSED="true" pnpm smoke:deploy
```

To discover recent signed LINE source IDs from the connected database:

```bash
pnpm line:events
```

If you need to inspect signed webhook rows that did not include a source user ID, run:

```bash
LINE_EVENTS_INCLUDE_EMPTY="true" pnpm line:events
```

After mapping a contact, recover signed webhook events that were captured before mapping:

```bash
pnpm line:backfill
```

To reprocess one event:

```bash
LINE_BACKFILL_EVENT_ID="01H..." pnpm line:backfill
```

## Logging & Monitoring Notes

Current MVP logging is intentionally small:

- Copilot model failures are logged as structured JSON before deterministic fallback is returned.
- LINE webhook invalid signatures are persisted as `WebhookEvent(INVALID)` with a body hash and signature presence flag.
- LINE and email send failures are persisted as `Message(FAILED)` plus an Activity with retryability metadata.

Production next steps:

- Replace console logging with structured JSON logs carrying `requestId`, route, lead/contact/message IDs, provider request ID, and outcome.
- Monitor webhook 401/400/5xx rate, duplicate webhook count, LINE/email send failures, AI fallback rate, DB connection pool utilization, and queue depth if the webhook is moved async.
- Alert on LINE invalid-signature spikes, mail-gateway authorization failures, DLQ/non-retryable send failures, and sustained AI fallback rate.

---

## Documentation

- [`docs/PLAN.md`](docs/PLAN.md) — implementation plan, stack rationale, data model, scope per part, scaling design, backlog
- [`docs/architecture.html`](docs/architecture.html) — interactive architecture & data-flow diagram
- [`docs/AI_USAGE_LOG.md`](docs/AI_USAGE_LOG.md) — sample AI tasks, human review notes, rejected output, verification record
- [`docs/SUBMISSION_CHECKLIST.md`](docs/SUBMISSION_CHECKLIST.md) — deploy prerequisites, smoke test checklist, final package checklist
- [`docs/WALKTHROUGH_SCRIPT.md`](docs/WALKTHROUGH_SCRIPT.md) — 3-5 minute demo recording outline
