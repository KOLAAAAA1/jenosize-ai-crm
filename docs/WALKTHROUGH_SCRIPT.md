# Walkthrough Script

Target length: 3-5 minutes.

## 0:00-0:30 — Context and Trade-off

This is a working AI CRM MVP for a 20-person commercial team managing about 2,000 contacts and 300 active leads. I chose one Next.js full-stack app with Prisma and Postgres so the timebox went into product depth, persistence, AI safety, and LINE integration instead of split-service plumbing.

Point to:

- `README.md` architecture diagram
- `docs/PLAN.md` scope/status table

## 0:30-1:30 — Core CRM Flow

1. Open the deployed app.
2. Log in as `admin@jenosize.demo`.
3. Open `/leads`.
4. Show search/filter/pagination.
5. Open a lead detail page.
6. Move the stage.
7. Hard-refresh and show the stage/timeline persisted.
8. Open `/board` and show the pipeline view.

Talking point: the stage move is a shared service wrapped by server actions; it updates the lead and appends an immutable `STAGE_CHANGE` Activity.

## 1:30-2:30 — AI Copilot Boundary

1. On a lead detail page, click **Generate suggestion**.
2. Show summary, qualification score/reasons, next action, and fallback labeling if Anthropic is unavailable.
3. Accept or reject a suggestion.
4. If a LINE draft exists, show that saving a draft creates `Message(DRAFT)` rather than sending automatically.

Talking point: AI output is never CRM truth by itself. It is stored as `AiSuggestion(SUGGESTED)` and requires explicit human review.

## 2:30-3:30 — LINE OA Safety

1. Show `POST /api/line/webhook` in the README/API notes.
2. Explain raw-body `X-Line-Signature` verification before parsing.
3. Show webhook event/message idempotency via `WebhookEvent.providerEventId` and `Message.providerMessageId`.
4. Send or describe a LINE OA message from a mapped user; show it appears in the timeline.
5. Show **Approve & send** for an outbound draft.

Talking point: approvals use LINE push messages with `X-Line-Retry-Key`, because human approval can happen after webhook reply tokens expire.

## 3:30-4:30 — Evidence and Handover

Show:

- `pnpm test` result: 12 files / 82 tests
- `docs/AI_USAGE_LOG.md`
- `docs/SUBMISSION_CHECKLIST.md`
- `README.md` setup/deploy/monitoring notes

Talking point: the required automated tests cover core CRM, AI fallback, and LINE webhook security/idempotency, with extra coverage for outbound approval.

## 4:30-5:00 — Production Next Steps

Call out deliberately deferred production work:

- Real auth/RBAC instead of demo credentials
- Queue-based LINE ingestion for high traffic
- Structured log aggregation and alerts
- More AI eval cases in CI
- PII retention/deletion policy for real customer data
