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
        DB[("Prisma → PostgreSQL · Neon<br/>8 tables · migrations · idempotency constraints")]
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
| 04 | **Move a lead stage** | board drag `→ /api/crm/leads/:id →` update `stage` `→` write `STAGE_CHANGE` activity `→` timeline |

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

## LINE OA integration

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

## API Notes

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/auth/login` | public | Credentials login; sets HttpOnly session cookie |
| `POST /api/auth/logout` | session | Clears session cookie |
| `GET /api/me` | session | Returns the current demo user |
| `POST /api/ai/copilot` | session | Builds lead context, runs Claude or fallback, persists `AiSuggestion(SUGGESTED)` |
| `POST /api/line/webhook` | LINE signature | Receives LINE webhooks; signature is the auth boundary |

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
- LINE send failures are persisted as `Message(FAILED)` plus a `LINE_OUT` Activity with retryability metadata.

Production next steps:

- Replace console logging with structured JSON logs carrying `requestId`, route, lead/contact/message IDs, provider request ID, and outcome.
- Monitor webhook 401/400/5xx rate, duplicate webhook count, LINE send failures, AI fallback rate, DB connection pool utilization, and queue depth if the webhook is moved async.
- Alert on LINE invalid-signature spikes, DLQ/non-retryable send failures, and sustained AI fallback rate.

---

## Documentation

- [`docs/PLAN.md`](docs/PLAN.md) — implementation plan, stack rationale, data model, scope per part, scaling design, backlog
- [`docs/architecture.html`](docs/architecture.html) — interactive architecture & data-flow diagram
- [`docs/AI_USAGE_LOG.md`](docs/AI_USAGE_LOG.md) — sample AI tasks, human review notes, rejected output, verification record
- [`docs/SUBMISSION_CHECKLIST.md`](docs/SUBMISSION_CHECKLIST.md) — deploy prerequisites, smoke test checklist, final package checklist
- [`docs/WALKTHROUGH_SCRIPT.md`](docs/WALKTHROUGH_SCRIPT.md) — 3-5 minute demo recording outline
