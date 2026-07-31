# 02 · Functional Specification (FSD)

How each feature behaves — business logic, workflows, and scope guardrails. Product intent → [01_PRD](01_PRD.md); system design → [03_Architecture](03_Architecture.md); schema → [04_Database](04_Database.md); endpoints → [06_API_Specs](06_API_Specs.md).

**Legend:** ✅ shipped · ◐ partial · 🗓 planned (scoped for next iteration) · 🔮 deferred to a future enhancement.

---

## 1. Core CRM (✅)

- **Auth & access:** login page + seeded demo creds (thin `jose` session cookie). Role enforcement (`src/lib/access-control.ts`): admin/manager see the shared lead queue + directory; sales are scoped to owned leads/tasks. Server pages, server actions, and `/api/ai/copilot` all re-check the session.
- **Directory:** Leads, Companies, Contacts list pages with **search + filter + pagination** and Zod-validated create/edit. Companies/Contacts keep minimal CRUD; **Leads carry the depth**.
- **Pipeline board:** native drag/drop (`useOptimistic` + HTML5 DnD) plus a lead-detail stage mover; both route through one atomic stage-move service that writes a `STAGE_CHANGE` Activity. (Native DnD is desktop/mouse only; touch users use the lead-detail mover.)
- **Lead detail + timeline:** profile + a unified chronological **timeline** merging activities and messages. Deal fields (**value/budget in THB**, probability %, expected close date) are editable with an immutable audit Activity on meaningful edits. The value field accepts plain digits **or Thai budget text** ("1 ล้านบาท", "5 แสน", "500k") via `parseThaiBudget`, with a live formatted preview — so an officer can transcribe a customer's LINE-messaged budget directly.

## 2. AI Copilot & deterministic fallback (✅)

- **Skill contract:** `skills/crm-copilot/SKILL.md` — purpose, inputs, outputs, allowed actions, guardrails, failure behavior, and **10 evaluation cases**.
- **The contract is the prompt** (`src/lib/ai/skill.ts`): the rule sections of SKILL.md are read from the file at run time and injected into the system prompt of **every** provider call (OpenRouter and Anthropic), so changing the document changes model behaviour instead of drifting from a paraphrase. Two deliberate limits — (1) only rule sections go in; the MVP field mapping, processing workflow and the 10 eval cases are excluded (a model given the eval cases will echo their canned outputs); (2) SKILL.md's **output contract is not injected** — it documents a richer shape than `copilotResultSchema` (a flattened subset of it), so following it would fail validation on every call and silently degrade to the fallback. The caller's JSON shape wins, and the prompt says so explicitly. A missing/renamed section is a logged warning, never a throw; `skill.test.ts` guards against that drift. On Vercel the file reaches the function bundle via `outputFileTracingIncludes` in `next.config.ts`.
- **Untrusted context:** the CRM context (which carries customer-written LINE text) is fenced in a labelled data block with instructions to report injection attempts in `warnings` rather than obey them — SKILL.md eval Case 4.
- **Flow:** `POST /api/ai/copilot { leadId }` → builds CRM context → returns structured JSON → persists an `AiSuggestion(SUGGESTED)`. UI "Generate" → **Accept/Reject**. A LINE draft is saved as `Message(DRAFT)` only after an explicit click; sending still needs a separate approval.
- **Where it lives:** inside the LINE chat box (§3.4), as a **collapsed disclosure** at the top of the card — the copilot reads the conversation the rep is reading and its draft is sent from the same composer, so a separate column meant working across two halves of the screen. Collapsed by default (an assist, not the conversation), auto-opens when a suggestion is pending or the rep starts a run. The toggle and the Generate button are siblings, never a button nested in a `<summary>`, so one tap can't fire both.
- **Suggestion↔commit boundary:** AI output is a *suggestion*, never a confirmed write or an outbound send, until a human acts.
- **Deterministic fallback** (`src/lib/ai/fallback.ts`) when the model is unavailable / unkeyed / out of credits: a rule-based score (stage + activity recency + source), a templated summary, a **stage-appropriate next action** (one play per stage: qualify / send proposal / chase decision / onboard / capture loss reason, escalated when a still-open lead is stale), and a **repeat-customer signal** when the contact/company has >1 lead in the caller's scope (relationship key fact + cross-sell nudge, suppressed on `OPTED_OUT`). No fabricated model prose, no LINE draft; `recommendedStage` stays `no_change`.
- **Output language:** all natural-language fields (summary, key facts, reasons, next action, LINE draft, warnings) are **Thai** for both the model path (system-prompt rule) and the fallback; enum values and numbers stay as-is.
- **Model seam:** injectable `callModel` — production uses the Anthropic client only when a key is configured; tests inject a throwing/mock model.

## 3. LINE OA integration (✅)

- **Inbound webhook** (`POST /api/line/webhook`): verify `X-Line-Signature` (HMAC-SHA256) against the **raw body before parse**; reject mismatch (401) with a `WebhookEvent` audit row. Idempotent on `webhookEventId` / `providerMessageId`. Maps the LINE user → Contact/Lead, persists an inbound `Message(RECEIVED)` + a `LINE_IN` Activity. Unmapped users are recorded for backfill.
- **Outbound** = **approval-based draft** (`DRAFT → APPROVED → SENT|FAILED`). A draft comes from an AI suggestion **or** a **manual composer** on the lead detail (a rep types a reply → `Message(DRAFT)`) — both feed the identical approve→send path, so sending works even when the AI is on the deterministic fallback (which produces no draft). Mock adapter for local tests/dev; real push adapter with `X-Line-Retry-Key` when `LINE_ENABLED=true`. No secrets committed.
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

### 3.3 AI auto-reply (✅ — replaces the earlier greeting auto-reply)

**Default behaviour for an inbound LINE message:** the AI writes the reply and the OA sends it, with no human in the loop, while `Contact.autoReplyEnabled` is on (**default `true`**). A sale/admin flips the switch **off** to take the conversation over and type replies by hand from the lead's chat box (§3.4). This is the one capability allowed to send without approval — SKILL.md §"Auto-reply mode" governs it, and the lead-analysis copilot keeps its approve-then-send boundary unchanged.

- **Generation** (`src/lib/ai/chat-reply.ts`): its own narrow prompt — answer the latest message, commit to nothing (no price, discount, date, or capability claim), never disclose internal CRM data, hand off to a human when unsure. Any model failure (no key, no credits, timeout, bad JSON) degrades to a fixed acknowledgement, so the customer is never left on read. Bounded at **20s** — the webhook holds the request open, unlike the copilot's 5-minute budget.
- **Delivery** (`src/lib/line/ai-autoreply.ts`): the **push** API, not the single-use `replyToken` (it expires in ~1 min and the OA console's own greeting may consume it). Persists `Message(OUT, SENT)` so the reply appears in the chat box, plus an `Activity(LINE_OUT, userId=null)` on the timeline when the contact has a lead (a contact with no lead yet has no timeline to write to), tagged with whether the text came from the model or the fallback.
- **Consent:** `OPTED_OUT` blocks the reply; `UNKNOWN` (the seed default) does not — answering a message the customer just sent is not outreach. Outreach in the approval path keeps needing a human approval regardless (SKILL.md consent mapping).
- **Gates:** unmapped LINE user → silent (no contact = no toggle, no consent state); switch off → silent; `consentStatus = OPTED_OUT` → silent; a message already answered by keyword automation (§3.5) → silent, via the `handledMessageIds` hand-off that keeps a rich-menu tap from getting two replies.
- **Idempotency:** the outbound row claims `providerMessageId = "line-ai:<inbound message id>"`, whose unique index makes a webhook redelivery lose the race and skip instead of double-messaging. A send failure leaves a `FAILED` draft a rep can retry from the LINE drafts panel.
- Best-effort throughout (never turns the webhook's 200 into a 500). Tests: `ai-autoreply.test.ts` (pure gate matrix + DB-backed happy path, idempotency, opt-out, failed send), `chat-reply.test.ts`.

### 3.4 Chat-history view (✅ §11.6-origin)

Chat-thread rendering of the persisted LINE `Message` rows on the lead detail (`chat-history.tsx`) — customer-left / sales-right bubbles, status pills, timestamps, framed as **handover evidence** so a rep taking over reads the full conversation.

It is also where the conversation is **driven**, in reading order: **AI copilot** (collapsible, §2) → thread → **LINE drafts** waiting on a human (a saved copilot draft, or an AI auto-reply whose send failed) → composer. The AI auto-reply switch sits in the header (`chat-controls.tsx`). Deciding who answers, deciding what to say, and saying it are one place instead of two columns. `ChatHistory` takes the copilot and drafts as **node slots**, so it never has to know about AI payloads or message ids. With AI on, the composer is closed (a rep typing would race the AI) and shows why; with AI off, the rep types and hits Send — one click that runs the same audited `saveLineDraftManual` → `approveAndSendLineDraft` path (sending *is* the approval), so a failed send still leaves a recoverable `FAILED` draft. AI-sent bubbles are labelled **✨ AI auto-reply** rather than the owner's name.

**Responsive:** on a phone the switch becomes its own full-width labelled row (a bare toggle under the heading reads as an orphan) and the Send button collapses to a thumb-sized circle; from `sm` up the switch sits inline beside the heading and the button regains its label. The composer auto-grows to ~140px, the thread caps at 60vh (28rem on larger screens) and opens scrolled to the newest message, and **Enter-to-send is enabled only for fine pointers** (`useSyncExternalStore` over `(pointer: fine)`) — on a touch keyboard Enter must still mean "new line".

**Known limitation:** human outbound bubbles are labeled with the lead's *current* owner (no per-message `senderUserId`); content is preserved, true-sender-across-owner-change is deferred.

### 3.5 LINE inbound keyword automation & lead capture (✅ shipped)

> **Shipped:** `src/lib/line/inbound-intents.ts` (+ `inbound-intents.test.ts`), wired into the webhook route after the other best-effort reply modules; migration `add_contact_pending_intent` adds `Contact.pendingIntent` (enum `PendingIntent = AWAITING_INQUIRY`). Default lead owner via `LINE_LEAD_DEFAULT_OWNER_ID` (else earliest ADMIN/MANAGER).

The rich-menu message buttons ("ขอติดต่อทีมงาน", "ขอสอบถามข้อมูลเพิ่มเติม") previously only logged an inbound `Message`; they are now actionable. All handlers slot into the existing webhook after signature-verify + mapping + persistence, and reply via the reply API (`replyToken`), so they inherit idempotency (`webhookEventId`) and the **mock adapter** used in tests. Every reply is **best-effort** — a failure never turns the webhook's 200 into a 500.

**A · "ขอติดต่อทีมงาน" → auto-acknowledge.** On this exact keyword, send a **fixed** reply ("รับเรื่องแล้ว ทีมงานจะติดต่อกลับโดยเร็ว") — never AI. Then log a follow-up signal on the mapped lead (an `Activity`, or optionally an OPEN `Task`) so a rep sees the request. Unlike the AI auto-reply (§3.3), this is **not** gated by `Contact.autoReplyEnabled`: it's a direct customer request, so acknowledging is consent-safe. The handler reports the message ids it answered so the AI stays quiet on those (§3.3).

**B · "ขอสอบถามข้อมูลเพิ่มเติม" → inquiry → lead.** A minimal two-step capture without a full chatbot:
1. On the keyword, reply asking for details (สินค้า/บริการที่สนใจ · ความต้องการ · งบประมาณ) and set `Contact.pendingIntent = AWAITING_INQUIRY` (a lightweight state marker — see [04_Database](04_Database.md)).
2. The customer's **next** inbound message (while `pendingIntent = AWAITING_INQUIRY`) is treated as the inquiry: **create a Lead** (`source LINE_OA`, `stage NEW`, title/first `Activity` from the text) for the mapped contact, clear `pendingIntent`, and reply a confirmation ("ได้รับข้อมูลแล้ว ทีมขายจะติดต่อกลับ"). A salesperson then qualifies the new lead in the pipeline.

*Owner assignment:* `Lead.ownerId` is required (`onDelete: Restrict`), so a captured lead needs a default owner (config, or a manager) until the P1 auto-routing rule exists — do **not** invent round-robin here. *Alternative considered:* instead of auto-creating the lead, create an approval-based `Message(DRAFT)`/suggestion for a rep to confirm — chosen against for MVP because lead capture from a genuine inquiry is standard CRM behavior; the human still qualifies at `stage NEW`.

**C · Safe mapping / persistence / reply (guardrail for A & B).** Both handlers must: map the LINE user → Contact (create-if-unknown per §3.1, so an unfollowed/unregistered sender still gets a record), persist the inbound `Message` + `WebhookEvent` idempotently, and respond via the reply API **or** an approval-based draft where a human should confirm. Each path is unit-tested with the **mock adapter** — no live LINE calls. This case exists so A and B can't quietly bypass the shipped webhook/outbound safety (signature verify, idempotency, human-approval for outbound).

**Known limitations (accepted, not engineered around):** while `AWAITING_INQUIRY`, *any* next text becomes the lead — including a one-word greeting (→ a thin lead a rep can discard); non-text events (stickers/images) are naturally ignored since only text messages are parsed. A capture and the AI auto-reply no longer collide: this handler runs first and claims the message id, and the AI path pushes rather than competing for the same single-use `replyToken`. Captured leads take a default owner until the P1 auto-routing rule exists.

**Scope guardrails (not built):** free-text NLU / general chatbot, multi-turn qualification forms, AI scoring of captured leads, and automatic lead assignment.

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
