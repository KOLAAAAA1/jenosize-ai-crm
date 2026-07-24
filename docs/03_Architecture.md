# 03 · System Architecture & Tech Stack

Design decisions and the security boundary. Requirements → [01_PRD](01_PRD.md); behavior → [02_FSD](02_FSD.md); schema → [04_Database](04_Database.md); deploy/scaling → [05_Infrastructure](05_Infrastructure.md).

---

## 1. Chosen stack & why

| Layer | Choice | One-line justification |
|---|---|---|
| Frontend | **Next.js (App Router) + React + Tailwind** | One app, one deploy target; server components keep it fast under a tight timebox |
| API | **Next.js Route Handlers + Server Actions** | No separate service to wire/deploy; still a real REST surface (see [06_API_Specs](06_API_Specs.md)) |
| Validation | **Zod** | Shared request/response schemas at every boundary |
| ORM / DB | **Prisma + PostgreSQL (Neon serverless)** | Real migrations, constraints, relations; persistence survives restart (rubric-critical) |
| Auth | **Credentials + seeded demo users** (thin `jose` JWT session) | "login or documented demo auth" — simple, documented, testable |
| AI | **Anthropic Claude** (`claude-opus-4-8`) with structured JSON output | Score/summary/next-action; clean deterministic-fallback wiring |
| LINE | **LINE Messaging API + LIFF** (webhook + reply/push) | Signature verify + mock adapter for local tests |
| Tests | **Vitest** (unit/integration) | Covers the required flows without over-investing |
| Deploy | **Vercel** (app) + **Neon** (DB) | Free tier, single `git push` deploy, public demo URL |
| Observability | Lightweight JSON logger + DB audit rows | "structured logging + monitoring notes" without extra deploy risk |

**Trade-off headline:** a single Next.js full-stack app over split FE/BE — spend the 16h budget on *product depth and the AI/LINE safety boundary*, not on plumbing two deploy targets.

---

## 2. Target architecture

```
Browser (CRM UI)
   │  fetch / Server Actions (Zod-typed)
   ▼
Next.js Route Handlers ──► Prisma ──► PostgreSQL (Neon)
   │                                    ▲
   │                                    │ persist events / suggestions / audit
   ├─► crm-copilot skill ──► Claude API ─┘   (fallback: deterministic scorer)
   │        (returns SUGGESTIONS only)
   │
   └─► /api/line/webhook ◄── LINE Platform
            • verify X-Line-Signature (HMAC-SHA256) on the raw body
            • idempotency on event / message id
            • persist inbound Message + map LINE user → Contact/Lead
            • outbound reply requires human approval (draft → approved → sent)
            • mock adapter when LINE_ENABLED=false
```

**The one boundary that wins Part 2:** AI output and inbound LINE events are **suggestions/records**, never silent side effects. Nothing reaches the customer or becomes a confirmed CRM fact until a human approves it. That boundary *is* the audit trail.

**Layering:** pure, testable core logic (`src/lib/*` — AI scoring, LINE signature/service, token signing, dashboard metrics, access control) is kept free of Next/DB imports and injected with dependencies, so it unit-tests without a network or a running DB. Route handlers and server actions are the thin, auth-guarded I/O shell around it.

---

## 3. Security & judgment checklist ("AI-native but not AI-blind")

- Verify the LINE signature **before** parsing the body; reject on mismatch (401) — test covers it.
- Server-side **ID-token verification** for LIFF; never trust a client-sent `userId`.
- Signed link tokens carry a mandatory `purpose` claim so they are non-interchangeable with the session JWT (both HS256 over `AUTH_SECRET`).
- Secrets only in env / the Vercel dashboard; `.env.example` has placeholders; no secrets committed.
- **AI never writes a confirmed record or sends a message without human approval.**
- All AI-generated code reviewed before merge (documented in `docs/AI_USAGE_LOG.md` — this is graded).
- Idempotency + retry on LINE so provider re-delivery can't double-send or double-persist.
- Input validation at every API boundary (Zod); DB constraints as the second line of defense.
- Rate-limit / timeout the LLM call; the deterministic fallback is always available so the demo never hard-fails.
- RBAC re-checked on server pages, server actions, and the copilot API — sales scoped to owned records; directory hidden from sales; cross-lead history counts scoped to the caller so peers' data isn't disclosed.
