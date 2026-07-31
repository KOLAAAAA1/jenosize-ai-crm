# 06 · API & Server-Action Specifications

The HTTP surface. Most UI↔DB mutations go through **React Server Actions** (guarded, Zod-validated); dedicated **Route Handlers** exist for auth, the AI copilot, LINE, and email — anything an external system or a client fetch must call. Behavior → [02_FSD](02_FSD.md); schema → [04_Database](04_Database.md).

All handlers run on the Node runtime (Prisma) and validate input with Zod. Bodies below are the essential fields, not exhaustive.

---

## 1. Route Handlers

### Auth
| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/login` | public | Credentials login → sets HttpOnly `crm_session` cookie (jose JWT). Body `{ email, password }`. 401 on bad creds (constant-time bcrypt). |
| `POST` | `/api/auth/logout` | session | Clears the session cookie. |
| `GET` | `/api/me` | session | Returns the current `SessionUser` (`{ id, email, name, role }`) or 401. |

### AI copilot
| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/ai/copilot` | session (lead-scoped) | Body `{ leadId }`. Loads the lead within the caller's scope (404 if out of scope), builds context, runs the copilot (real model or deterministic fallback), persists an `AiSuggestion(SUGGESTED)`, returns `{ id, suggestion }`. Degrades to fallback automatically when the model is unavailable/unkeyed/out-of-credits. |

**Suggestion payload** (schema-validated, Thai natural-language fields): `{ status, summary{overview,keyFacts[],openQuestions[]}, qualification{score,confidence,reasons[],recommendedStage}, nextAction{action,reason,priority}|null, lineReply{draft,requiresApproval:true}|null, warnings[] }` + run metadata `{ source: "ai"|"fallback", model, generatedAt }`.

### LINE
| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/line/webhook` | **LINE signature** | Verifies `X-Line-Signature` (HMAC-SHA256) on the **raw body before parse** → 401 + `WebhookEvent(INVALID)` on mismatch. Idempotent on event/message id. Maps user → Contact/Lead, persists inbound `Message(RECEIVED)` + `LINE_IN` Activity; handles `follow`/`unfollow`, keyword automation, and the per-contact **AI auto-reply** (generates + pushes the reply, persisting `Message(OUT)` + `Activity`). Always returns 200 on accepted events (best-effort side effects never 500). |
| `POST` | `/api/line/liff-register` | **LIFF ID token** | Body `{ idToken, firstName, lastName, email?, phone?, consent }`. Server-side verifies the ID token (trusts only `sub`), upserts a Contact on `lineUserId` under the sentinel company. 401 on unverifiable token; 400 on invalid form. |
| `POST` | `/api/line/liff-connect` | **LIFF ID token + signed link token** | Body `{ idToken, token, consent }`. Verifies both tokens, binds the verified `lineUserId` to the `contactId` inside the signed token. Returns `{ ok, outcome: "linked"|"already_linked"|"relinked_from_sentinel" }`, or 401 (bad/expired token), 404 (contact gone), 409 (LINE user linked elsewhere / contact already linked to a different user). |

> ✅ **Also handled (no new endpoint):** `/api/line/webhook` handles rich-menu keyword messages — auto-acknowledge "ขอติดต่อทีมงาน", and the "ขอสอบถามข้อมูลเพิ่มเติม" → inquiry → **lead capture** flow (via a `Contact.pendingIntent` state marker), all within the existing verify → map → persist → reply pipeline (`src/lib/line/inbound-intents.ts`). See [02_FSD §3.5](02_FSD.md) · [PLAN §5](PLAN.md).

### Email
| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/email/inbound` | **shared-secret webhook** | Normalized inbound-email webhook: maps sender → Contact/Lead, records a `Message(EMAIL, RECEIVED)` + Activity. Provider-neutral seam (see `docs/EMAIL_INTEGRATION.md`); outbound send is gated behind the draft/approval flow, not a public route. |

---

## 2. Server Actions (the mutation surface)

Guarded (`getSessionUser` + role checks via `access-control.ts`), Zod-validated, `revalidatePath` on success. Key actions:

- **Leads:** `moveLeadStage` (atomic stage move + `STAGE_CHANGE` Activity), deal-field edits (probability/close date + audit Activity), owner assignment (`changeLeadOwner`, manager/admin), `createTask` / `toggleTaskDone`, LINE draft generate/approve/send, `sendLineChatMessage` (type-and-send from the chat box: draft + approve + send in one action), `setLeadAiAutoReply` (AI auto-reply switch, lead-scoped so the assigned rep can flip it), email draft actions (deferred — [02_FSD §7](02_FSD.md)).
- **Contacts:** `saveContact` (create/edit), `setContactAutoReply` (AI auto-reply switch; admin/manager), `createContactLineConnectLink` (mint a signed LIFF connect link/QR for account linking; manager/admin).
- **Companies/Contacts CRUD** via their forms.

---

## 3. Cross-cutting contract notes

- **Auth:** session is a jose HS256 JWT in an HttpOnly cookie; pages/handlers/actions re-check it. Signed **LIFF link tokens** are also HS256 over `AUTH_SECRET` but carry a mandatory `purpose` claim so they can't be used as session tokens.
- **Idempotency:** LINE inbound dedupes on `WebhookEvent.providerEventId` / `Message.providerMessageId` (DB unique constraints); outbound push carries `X-Line-Retry-Key`.
- **Validation & errors:** Zod at every boundary; 400 (bad input), 401 (unauthenticated / unverifiable token), 404 (out of scope / missing), 409 (conflict), 500 (misconfiguration). AI/LINE side effects degrade rather than hard-fail.
- **Postman collection:** see `docs/postman/` for runnable examples.
