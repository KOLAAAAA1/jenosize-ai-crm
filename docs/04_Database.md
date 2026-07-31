# 04 · Database Design

Data model, constraints, and seed. **The authoritative schema is [`prisma/schema.prisma`](../prisma/schema.prisma)** + the migrations under `prisma/migrations/`; this doc is the human-readable map. Behavior → [02_FSD](02_FSD.md); endpoints → [06_API_Specs](06_API_Specs.md).

---

## 1. Models (10 tables)

```
User            id, name, email(unique), role(UserRole), passwordHash, createdAt
Company         id, name, industry, size, website, notes, createdAt
Contact         id, companyId→Company, firstName, lastName, email, phone, title,
                lineUserId(unique, nullable),        # LINE→CRM mapping key
                consentStatus(ConsentStatus, default UNKNOWN),
                autoReplyEnabled(bool, default true),   # AI auto-reply switch (per contact)
                pendingIntent(PendingIntent?),       # LINE inquiry→lead capture state
                createdAt
Lead            id, title, companyId→Company, contactId→Contact, ownerId→User,
                stage(Stage), source(Source), valueTHB, score(int?), scoreReason(text?),
                probability(int?), expectedCloseAt(DateTime?),   # deal fields (P1)
                createdAt, updatedAt
Task            id, leadId→Lead, ownerId→User, title, dueAt(DateTime?),
                status(TaskStatus, default OPEN), completedAt(DateTime?), createdAt
Activity        id, leadId→Lead, userId→User(nullable), type(ActivityType), body,
                metadata(json?), createdAt          # immutable timeline
Message         id, leadId→Lead(nullable), contactId→Contact,
                channel(MessageChannel, default LINE), direction(MessageDirection),
                providerMessageId(unique, nullable),   # idempotency
                status(MessageStatus), body,
                subject, fromAddress, toAddress, providerThreadId,   # email fields
                createdAt
AiSuggestion    id, leadId→Lead, type(SuggestionType), payload(json), model,
                status(SuggestionStatus, default SUGGESTED), createdBy, createdAt
WebhookEvent    id, provider, providerEventId(unique), signatureValid(bool),
                rawPayload(json), status(WebhookStatus), processedAt   # dedupe + audit
ActivityLog     id, path, method, query(json?), payload(json?), statusCode(int),
                durationMs(int), userId→User(nullable, SetNull), ipAddress, userAgent,
                device, createdAt        # HTTP API audit trail (src/app/api/** only)
```

> The model count grew from the original 8 (Task was added for follow-up reminders, and `Contact`/`Lead`/`Message` gained consent, auto-reply, deal, email, and `pendingIntent` fields).
>
> `Contact.pendingIntent` (nullable enum `PendingIntent = AWAITING_INQUIRY`; migration `add_contact_pending_intent`) is a lightweight one-column conversation-state marker for the LINE inquiry→lead capture flow ([02_FSD §3.5](02_FSD.md) · [PLAN §5](PLAN.md)): set when the customer taps "ask for more info", read to capture their next message into a lead, then cleared. Deliberately a single column, not a conversation-state table.
>
> `ActivityLog` (migrations `add_activity_log`, then `rename_activity_logs_to_activity_log` — it first shipped as `activity_logs` and was renamed to match the PascalCase convention of every other table — then `activity_log_nullable_response_fields`) is the API audit trail, written by the Next **proxy** at `src/proxy.ts` (logic in `src/lib/proxy-log.ts`, pure helpers in `src/lib/api-log.ts`). Its `matcher: "/api/:path*"` means **every** route under `src/app/api/**` is logged automatically — a new endpoint needs no wrapper and cannot ship unlogged. It records **API requests only** — Server Actions and page navigations are deliberately excluded, so CRM edits made through the UI do not appear here; they remain on the `Activity` timeline. Secret-ish keys (`password`, `*token*`, `*secret*`, `signature`, …) are redacted recursively before the payload is stored, non-JSON and >64 KB bodies are skipped, and serialized payloads are capped at 8 KB. The write runs off the response path via `event.waitUntil()` and is fully try/caught — logging can never fail a request. Set `API_ACTIVITY_LOG=false` to disable.
>
> **Page views (`kind = "page"`) are counted high.** Next strips its own routing headers (`rsc`, `next-router-prefetch`, `next-action`) before the proxy runs — a header dump there yields only `accept`, `host`, `user-agent` and `x-forwarded-*` — so the proxy cannot tell a full page load, an RSC client-side navigation and a prefetch apart. Measured against a production build in a real browser: a prefetch (viewport and hover) produced **no** rows, but a single client-side navigation produced **two** requests ~19ms apart. So treat page-view rows as an activity signal, not an exact visit count; de-duplicate on `(path, userId)` within a short window when counting. Server Action POSTs are excluded by the GET check, which is the only thing filtering them now that `next-action` is invisible.
>
> **`statusCode` and `durationMs` are null on proxy-written rows.** Next's proxy runs *before* the request completes and has no continuation hook, so the handler's response is never visible to it — this is the price of automatic coverage. Rows written by the earlier per-route `withApiLog()` wrapper (retired 2026-07-28) still carry values. The proxy reads the request body from a `clone()`, never the original, so the LINE webhook's HMAC over the exact raw bytes still verifies.
>
> **Planned schema addition:** an `EmailAttachment` model for the deferred email editor ([02_FSD §7](02_FSD.md)).

---

## 2. Enums

- `UserRole = ADMIN | MANAGER | SALES`
- `Stage = NEW | QUALIFIED | PROPOSAL | WON | LOST`
- `Source = WEBSITE | MANUAL | LINE_OA`
- `ActivityType = NOTE | CALL | EMAIL | STAGE_CHANGE | AI_SUGGESTION | LINE_IN | LINE_OUT`
- `MessageChannel = LINE | EMAIL`
- `MessageDirection = IN | OUT`
- `MessageStatus = RECEIVED | DRAFT | APPROVED | SENT | FAILED`
- `SuggestionType = SUMMARY | SCORE | NEXT_ACTION | LINE_DRAFT`
- `SuggestionStatus = SUGGESTED | ACCEPTED | REJECTED`
- `WebhookStatus = RECEIVED | PROCESSED | DUPLICATE | INVALID | FAILED`
- `ConsentStatus = UNKNOWN | OPTED_IN | OPTED_OUT`
- `TaskStatus = OPEN | DONE`
- `PendingIntent = AWAITING_INQUIRY`

---

## 3. Constraints that show intent

- **Unique** `Contact.lineUserId` — the LINE↔CRM mapping key; also the DB guard for account linking ([02_FSD §3.2](02_FSD.md)).
- **Unique** `Message.providerMessageId` and **unique** `WebhookEvent.providerEventId` — idempotency at the DB layer (`INSERT ... ON CONFLICT DO NOTHING` is the dedupe; re-delivery can't double-persist).
- **Unique** `User.email`.
- `Stage`/`Source`/`Status` as **enums, not free strings**.
- **FK cascades chosen deliberately:** `onDelete: Cascade` on Contact/Lead/Task/Message→parents; `Lead.owner` is `onDelete: Restrict` (an owner can't be deleted out from under a lead); `Activity.user` is `SetNull`; `Message.lead` is `SetNull`.
- Indexes on hot paths: `Lead` by company/contact/owner/stage/source/expectedCloseAt; `Task` by `[ownerId, status]` (powers "my open tasks") and `dueAt`; `Message`/`Activity` by their parents.

---

## 4. Seed

Deterministic (fixed faker seed, `fakerTH` for Thai names/phones), bulk-inserted in batches: ~20 users, ~150 companies, **~2,000 contacts, ~300 leads** across all stages, plus activities and a few LINE messages — matching the scenario scale (20-person team, 2,000 contacts, 300 active leads). Seeding to scale is what makes **search/filter + pagination** demonstrate real value rather than looking trivial on 200 rows. A demo LINE chat thread is seeded onto one lead so the chat-history panel renders realistically.
