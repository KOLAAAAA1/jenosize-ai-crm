# 02 · Functional Specification (FSD)

How each feature behaves — business logic, workflows, and scope guardrails. Product intent → [01_PRD](01_PRD.md); system design → [03_Architecture](03_Architecture.md); schema → [04_Database](04_Database.md); endpoints → [06_API_Specs](06_API_Specs.md).

**Legend:** ✅ shipped · ◐ partial · 🔮 deferred to a future enhancement.

---

## 1. Core CRM (✅)

- **Auth & access:** login page + seeded demo creds (thin `jose` session cookie). Role enforcement (`src/lib/access-control.ts`): admin/manager see the shared lead queue + directory; sales are scoped to owned leads/tasks. Server pages, server actions, and `/api/ai/copilot` all re-check the session.
- **Directory:** Leads, Companies, Contacts list pages with **search + filter + pagination** and Zod-validated create/edit. Companies/Contacts keep minimal CRUD; **Leads carry the depth**.
- **Pipeline board:** native drag/drop (`useOptimistic` + HTML5 DnD) plus a lead-detail stage mover; both route through one atomic stage-move service that writes a `STAGE_CHANGE` Activity. (Native DnD is desktop/mouse only; touch users use the lead-detail mover.)
- **Lead detail + timeline:** profile + a unified chronological **timeline** merging activities and messages. Deal fields (probability %, expected close date) are editable with an immutable audit Activity on meaningful edits.

## 2. AI Copilot & deterministic fallback (✅)

- **Skill contract:** `skills/crm-copilot/SKILL.md` — purpose, inputs, outputs, allowed actions, guardrails, failure behavior, and **10 evaluation cases**.
- **Flow:** `POST /api/ai/copilot { leadId }` → builds CRM context → returns structured JSON → persists an `AiSuggestion(SUGGESTED)`. UI "Generate suggestion" → **Accept/Reject**. A LINE draft is saved as `Message(DRAFT)` only after an explicit click; sending still needs a separate approval.
- **Suggestion↔commit boundary:** AI output is a *suggestion*, never a confirmed write or an outbound send, until a human acts.
- **Deterministic fallback** (`src/lib/ai/fallback.ts`) when the model is unavailable / unkeyed / out of credits: a rule-based score (stage + activity recency + source), a templated summary, a **stage-appropriate next action** (one play per stage: qualify / send proposal / chase decision / onboard / capture loss reason, escalated when a still-open lead is stale), and a **repeat-customer signal** when the contact/company has >1 lead in the caller's scope (relationship key fact + cross-sell nudge, suppressed on `OPTED_OUT`). No fabricated model prose, no LINE draft; `recommendedStage` stays `no_change`.
- **Output language:** all natural-language fields (summary, key facts, reasons, next action, LINE draft, warnings) are **Thai** for both the model path (system-prompt rule) and the fallback; enum values and numbers stay as-is.
- **Model seam:** injectable `callModel` — production uses the Anthropic client only when a key is configured; tests inject a throwing/mock model.

## 3. LINE OA integration (✅)

- **Inbound webhook** (`POST /api/line/webhook`): verify `X-Line-Signature` (HMAC-SHA256) against the **raw body before parse**; reject mismatch (401) with a `WebhookEvent` audit row. Idempotent on `webhookEventId` / `providerMessageId`. Maps the LINE user → Contact/Lead, persists an inbound `Message(RECEIVED)` + a `LINE_IN` Activity. Unmapped users are recorded for backfill.
- **Outbound** = **approval-based draft** (`DRAFT → APPROVED → SENT|FAILED`). Mock adapter for local tests/dev; real push adapter with `X-Line-Retry-Key` when `LINE_ENABLED=true`. No secrets committed.
- **Retry/idempotency + best-effort:** provider re-delivery can't double-send or double-persist; a reply failure never turns the 200 into a 500 (which would trigger LINE retries).

### 3.1 LIFF self-registration (✅ §11.4-origin)

Public `/liff` form (name required · phone/email · PDPA consent) → `POST /api/line/liff-register`. **Server-side ID-token verification** (`liff-verify.ts` — channel id from `LINE_LIFF_ID` prefix or `LINE_LOGIN_CHANNEL_ID`) → **upsert Contact on `lineUserId`** under a sentinel *"LINE Self-Registered"* company (`liff-register.ts`; re-submit updates the same record). Desktop landing (`liff-desktop-landing.tsx`) shows a QR + open-in-LINE for PC/external browsers. **Security guardrail:** never trust a client-sent `userId`; trust only the verified `sub`. `follow`/`unfollow` handled (`follow.ts`): welcome new followers with the LIFF link; on `unfollow` set the Contact to `OPTED_OUT`. Tests: `liff-register.test.ts`, `follow.test.ts`.

### 3.2 LIFF account linking — existing Contact ↔ LINE user (✅ §11.9-origin)

The same `/liff` page serves **both** modes: **no token → first-time registration** (3.1, unchanged); **officer-minted token → link** the customer's verified LINE identity to a *specific* existing Contact.

- **Trust model:** an officer mints a **signed, short-TTL link token** (`link-token.ts` — jose HS256 over `AUTH_SECRET`, 30-min TTL, mandatory `purpose` claim so link tokens ≠ session tokens). The `contactId` is baked **inside** the token, never a plain client param. The token is read **client-side after `liff.init()`** (LIFF wraps the query in `liff.state` across the login redirect).
- **Endpoint** `POST /api/line/liff-connect`: verifies the LINE ID token + the link token, then binds via `liff-connect.ts`.
- **Conflict rule:** free `lineUserId` → link; same contact → idempotent; a **leadless sentinel** self-registration → fold in (move its messages, drop the sentinel, link); a contact already linked to a **different** LINE user → reject (never overwrite); any **other real contact** already holding the id → reject. Full contact-merge is deferred.
- **Officer UI:** `contacts/[id]/line-connect.tsx` — link status, or a *Generate connect link/QR* button (30-min expiry, copy). PDPA one-tap confirm on the customer's link screen.
- Tests: `link-token.test.ts` (incl. session-token cross-rejection, expiry), `liff-connect.test.ts` (link / idempotent / sentinel-relink / already-linked / not-found).

### 3.3 Greeting auto-reply (✅ §11.5-origin)

A narrow, opt-in exception to the receive-only design: the OA sends a **canned greeting** (never AI output) via the reply API, **only when a sale/admin enables `Contact.autoReplyEnabled`** (default `false`). Fires on `follow` or a greeting-word text (Thai/English). Best-effort (a failure never 500s). Control: an Auto-Reply toggle card on the contact page (saves instantly) + a badge on the contacts list. Deliberately narrow: writes no `LINE_OUT` Activity, greetings only — not a general auto-responder. Tests: `autoreply.test.ts`.

### 3.4 Chat-history view (✅ §11.6-origin)

Read-only chat-thread rendering of the persisted LINE `Message` rows on the lead detail (`chat-history.tsx`) — customer-left / sales-right bubbles, status pills, timestamps, framed as **handover evidence** so a rep taking over reads the full conversation. No schema change (reuses existing rows). **Known limitation:** outbound bubbles are labeled with the lead's *current* owner (no per-message `senderUserId`); content is preserved, true-sender-across-owner-change is deferred.

## 4. Tasks & follow-up reminders (✅ §11.2-origin)

`Task` table (`title`, `dueAt?`, `leadId`, `ownerId`, `status: OPEN|DONE`, `completedAt?`; migration `add_task`). Two write actions (`createTask` owner = session user; `toggleTaskDone` owner-guarded, sets/clears `completedAt`). Two views: a **Tasks panel** on the lead detail (add form + checkbox, overdue tinted) and a **"My tasks due"** page (`/tasks`, overdue first). Test: `tasks-flow.test.ts`. **Scope guardrails (not built):** recurring tasks, push/email/LINE reminders, calendar sync, cross-user assignment, priorities/subtasks.

## 5. Reporting dashboard (✅)

Scoped summary cards (open pipeline value, win rate, 7-day activity, counts) plus four **independently filterable** report cards — each with a compact filter tray (person / lead-created month / company / stage), active-filter chips, and reset: a six-month lead-creation line chart, a pipeline-value-by-stage bar chart, a monthly stacked horizontal stage-value chart, and a stage-distribution donut. Aggregation lives in a pure, tested `dashboard-metrics` module reused server-side (summary tiles) and client-side (per-filter charts). Filtering to a month anchors the six-month window to that month so trend/monthly charts stay in sync. Thai chart tooltip labels. **Scope caps:** no custom report builder, BI tool, scheduled exports, or per-user drill-down.

## 6. Responsive (✅ §11.7-origin)

Mobile-first Tailwind across the app shell, list pages (container-scroll tables), detail/board/dashboard grids, forms, login, and the customer LIFF pages. Nav header wraps below `md`; forms are `grid-cols-1 sm:grid-cols-2`. Scope cap: Tailwind utilities only — no separate mobile app, UA sniffing, or new deps. **Pending:** a manual 375px/768px devtools verification pass (not yet run).

## 7. Email draft editor & attachments (🔮 future enhancement)

> **Deferred, not built.** Groundwork only: a provider-neutral outbound gateway + normalized inbound webhook (`src/lib/email/`, `src/app/api/email/`) and a `Message` model that already carries `channel EMAIL`, `subject`, `fromAddress`, `toAddress`, `providerThreadId`, and the `DRAFT → APPROVED → SENT|FAILED` states. No officer-facing editor and no attachments yet.

**Goal:** let an officer compose, save, and edit a draft email (subject/recipients/body) tied to a lead/contact and **attach files**, all before the existing human-approval gate.

- **Data model:** new `EmailAttachment` (`messageId → Message`, `filename`, `contentType`, `sizeBytes`, `storageKey`, `createdAt`); back-relation on `Message`. **Blob bytes live in object storage** (Vercel Blob `access: "private"` in prod, local dir in dev) — only key + metadata in Postgres; downloads via signed URL.
- **Server actions** (owner/manager-guarded, mutate only while `DRAFT`): `createEmailDraft`, `updateEmailDraft` (reject after `APPROVED`/`SENT`; audit Activity on edits), `addEmailAttachment`/`removeEmailAttachment`. Approve/send reuses the gateway.
- **Editor UI:** grow `email-panel.tsx` — recipient/subject/body (plain textarea first) + attachment chips (upload/remove); disable once past `DRAFT`; Thai copy.
- **Upload handling:** sanitize filename (`path.basename`), type allowlist (PDF/PNG/JPG/DOCX/XLSX), size caps (≤10 MB/file, ≤25 MB/message), stream to Blob.
- **Delivery:** extend the gateway payload for attachments; provider activation stays external (see `docs/EMAIL_INTEGRATION.md`).
- **Tests:** create/edit-while-draft, edit-rejected-after-sent, attachment add/remove, oversized/disallowed rejected, RBAC guard.
- **Scope guardrails (not in this slice):** rich HTML/inline images, threading, templates/sequences, scheduled send, OAuth mailbox sync, AV scanning.
- **Effort:** M–L (~1–2 days) — attachment storage + upload validation is the real work.

---

## Cross-cutting scope guardrails (deliberately NOT built)

Recurring/notification engines, calendar sync, provider-native OAuth mail sync, sequences/cadences, CPQ/quotes, mobile app, SSO, dedup/merge UI, multiple pipelines, and automated lead routing. Each is a ranked roadmap item in [PLAN.md](PLAN.md), kept out to avoid over-engineering a focused MVP.
