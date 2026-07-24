# 04 · Database Design

Data model, constraints, and seed. **The authoritative schema is [`prisma/schema.prisma`](../prisma/schema.prisma)** + the migrations under `prisma/migrations/`; this doc is the human-readable map. Behavior → [02_FSD](02_FSD.md); endpoints → [06_API_Specs](06_API_Specs.md).

---

## 1. Models (9 tables)

```
User            id, name, email(unique), role(UserRole), passwordHash, createdAt
Company         id, name, industry, size, website, notes, createdAt
Contact         id, companyId→Company, firstName, lastName, email, phone, title,
                lineUserId(unique, nullable),        # LINE→CRM mapping key
                consentStatus(ConsentStatus, default UNKNOWN),
                autoReplyEnabled(bool, default false), createdAt
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
```

> The model count grew from the original 8 (Task was added for follow-up reminders, and `Contact`/`Lead`/`Message` gained consent, auto-reply, deal, and email fields). A future `EmailAttachment` model is planned for the deferred email editor ([02_FSD §7](02_FSD.md)).

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
