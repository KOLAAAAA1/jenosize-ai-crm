# AI Usage Log

This log is the human-review record for the Jenosize AI CRM MVP. It documents where agent output was used, what was changed after review, and what was rejected.

## Summary

- AI agents were used for planning, implementation scaffolding, code review prompts, and documentation drafting.
- Human review focused on security boundaries, persistence, idempotency, data-model fit, and whether the work matched the assignment rather than a generic CRM.
- No live secrets were copied into tracked files. `.env.example` contains placeholders only.

## Reviewed AI-Assisted Work

| Area | Sample prompt/task | AI-assisted output | Human review and decision |
|---|---|---|---|
| Scope and architecture | "Turn the Jenosize assignment into a 16-hour MVP plan with defensible trade-offs." | Single Next.js app plan, Prisma/Postgres data model, AI/LINE audit boundary. | Kept the single-app architecture because it maximizes product depth under the timebox. Rejected split frontend/backend deployment as unnecessary for this assignment. |
| Data model and seed | "Design CRM tables for users, companies, contacts, leads, activities, messages, AI suggestions, and webhooks." | Eight-table Prisma schema with idempotency constraints and deterministic seed. | Reviewed FK cascade behavior and uniqueness. Added `Contact.consentStatus` after checking the copilot skill's opt-out evaluation case needed real data. |
| AI copilot | "Implement a provider-agnostic Claude copilot with structured output and deterministic fallback." | `src/lib/ai/*`, injectable `callModel` seam, schema validation, fallback scorer. | Kept the seam and schema validation. Rejected fabricated fallback prose; fallback now exposes only deterministic fields and a visible warning. |
| LINE webhook | "Implement LINE webhook signature verification, inbound persistence, mapping, and idempotency." | Raw-body verification, event parsing, `WebhookEvent` dedupe, inbound `Message(RECEIVED)`. | Verified against official LINE docs. Kept raw-body verification before parsing. Rejected processing unsigned or invalid bodies beyond minimal security metadata. |
| Outbound LINE | "Complete approval-based outbound LINE flow with a mock adapter." | Draft save, approve/send action, mock adapter, real push adapter. | Meaningful change after review: use LINE push messages with `X-Line-Retry-Key`, not webhook reply tokens, because human approval can happen after reply tokens expire. Kept send as a separate approval click rather than making Accept auto-send. |
| Tests | "Fill the required CRM, AI fallback, and LINE security/idempotency tests." | Vitest integration coverage for stage moves, AI fallback, invalid signature, replay dedupe, outbound approval. | Ran focused and full suites against local Postgres. Fixed the route-handler `revalidatePath` test-runtime issue without weakening production revalidation. |

## Rejected or Revised Agent Output

- Rejected any automatic LINE send from an AI suggestion. The approved boundary is `AiSuggestion(SUGGESTED)` -> `Message(DRAFT)` -> explicit **Approve & send**.
- Rejected storing invalid webhook bodies as CRM messages. Invalid signatures persist only safe audit metadata.
- Rejected relying on model availability for demos. The deterministic fallback is always available and tested.
- Revised the LINE outbound transport from reply-token based sending to push-message based sending with retry keys.

## Verification Record

Latest local gates run after the LINE work:

```bash
export NODE_OPTIONS=
pnpm exec tsc --noEmit
pnpm exec eslint
pnpm test
pnpm build
```

Observed results:

- TypeScript: passed
- ESLint: passed
- Vitest: 10 files / 63 tests passed
- Next production build: passed after allowing network access for `next/font` Google Fonts
