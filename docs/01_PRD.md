# 01 · Product Requirements (PRD)

**Assignment:** Jenosize — Lead AI Software Engineer test
**Deliverable:** Working AI CRM MVP (website + API + DB + reusable AI skill + LINE OA integration)
**Timebox:** 5 working days · **≤16 focused hours** · synthetic data only
**Grading:** Part 1 Product (50%) · Part 2 AI Skill + LINE (30%) · Part 3 Evidence + Handover (20%)

> Guiding principle from the brief: they want a **coherent vertical slice** with **sound trade-offs, readable code, and evidence that AI tools were used with human review** — *not* feature-completeness. Every scope decision optimizes score-per-hour against that rubric.

> **Companion docs:** functional behavior → [02_FSD](02_FSD.md) · system design → [03_Architecture](03_Architecture.md) · schema → [04_Database](04_Database.md) · deploy/scaling → [05_Infrastructure](05_Infrastructure.md) · endpoints → [06_API_Specs](06_API_Specs.md) · execution checklist → [PLAN](PLAN.md).

---

## 1. Goals & acceptance criteria (Definition of Done per part)

### Part 1 — Working Product (50%) · *Result-Oriented + Ownership*
- Auth: login page + seeded demo creds (thin session; guards on pages + API).
- List views with **search + filter + pagination**: Leads, Companies, Contacts, with Zod-backed create/edit.
- **Pipeline board** (drag/drop) + lead-detail stage mover, both writing a `STAGE_CHANGE` Activity via one atomic service.
- **Lead detail page**: profile + unified **timeline** (activities + messages, chronological).
- **Deployed** with persistence verified across restart/refresh (no in-memory state).
- **DoD:** a stranger logs in at the demo URL, finds a lead, moves its stage, and sees the timeline update after a hard refresh.

### Part 2 — AI Skill + LINE OA (30%) · *Growth/Agile + Entrepreneurial*
- `skills/crm-copilot/SKILL.md`: purpose, inputs, outputs, allowed actions, guardrails, failure behavior, **≥5 eval cases**.
- Copilot builds CRM context → structured JSON suggestion (`AiSuggestion`, status `SUGGESTED`); LINE draft when context + consent allow.
- UI: Generate suggestion → Accept/Reject; LINE drafts save `Message(DRAFT)`; sending needs a separate approval.
- **Deterministic fallback** when the model is unavailable (rule-based, clearly labeled — never fabricated prose).
- LINE webhook: verify signature before parse, capture inbound, map LINE user → Contact/Lead, persist, **idempotent**.
- Outbound = **approval-based draft** (`DRAFT → APPROVED → SENT|FAILED`); mock adapter for tests; no secrets committed.
- **DoD:** route tests prove invalid-signature rejection + replay idempotency; inbound proven with a real device.

### Part 3 — Evidence + Handover (20%) · *Win Together + Leave Legacy*
- **README**: architecture, DB config, setup/run/test, demo creds, API + LINE notes, monitoring.
- Architecture + data-flow diagram; `.env.example`; key trade-offs; known limitations; production next steps.
- **≥3 automated tests**: core CRM flow, AI fallback, LINE invalid-signature + replay idempotency.
- Structured logging + monitoring notes; **AI-usage log** (`docs/AI_USAGE_LOG.md`) with one reviewed/changed decision.
- Submission: repo + deployed URL + demo creds + LINE QR + 3–5 min walkthrough video.
- **DoD:** another engineer clones, runs `pnpm i && setup && dev`, and is productive in <15 min.

---

## 2. Feature landscape (product scope map)

**Legend:** ✅ built · ◐ partial · ➕ not yet built · 🗓 planned (scoped for next iteration) · 🔮 deferred to a future enhancement (groundwork may exist, feature not delivered).

**Contact & Account Management** — ✅ unified contact/company profiles · ✅ company↔contact↔lead relationships · ✅ consent/PDPA (`consentStatus`) · ➕ dedup/merge · ➕ enrichment · ➕ segmentation.

**Lead & Pipeline** — ✅ multi-source capture (website/manual/LINE) · ✅ Kanban + drag-drop · ✅ search/filter/pagination · ◐ lead scoring (heuristic + AI) · ◐ assignment (manual shipped; auto-routing deferred) · ✅ deal fields (probability %, close date) · ➕ multiple pipelines · ➕ forecasting.

**Activity, Tasks & Timeline** — ✅ unified activity timeline · ✅ audit trail · ✅ tasks & follow-up reminders · ➕ calendar/email 2-way sync.

**Communication / Omnichannel** — ✅ LINE inbound + approval-based outbound · ✅ chat-history view · ✅ AI auto-reply (default on, per-contact switch) + in-chat manual send · ✅ LIFF self-registration + account linking · ✅ LINE inbound keyword automation + inquiry→lead capture ([PLAN §5](PLAN.md)) · 🔮 email integration (draft editor + attachments) · ➕ templates · ➕ sequences · ➕ VoIP/SMS · ➕ shared inbox.

**AI / Automation** — ✅ summary + qualification score/reasons + next action · ✅ AI draft LINE reply (separated from sends) · ✅ deterministic fallback · ➕ workflow automation · ➕ sentiment · ➕ predictive forecasting.

**Reporting & Analytics** — ✅ dashboard (scoped summary cards + filterable trend/value/stage charts) · ➕ conversion/quota/leaderboards/forecast reports.

**Collaboration, Access & Admin** — ✅ auth + role enforcement (admin/manager/sales) · ✅ structured logging · ➕ SSO · ➕ territory mgmt · ➕ coaching views.

**Sales Productivity** — ➕ CPQ/quotes · ➕ product catalog · ➕ mobile app · ➕ smart notifications.

> The ranked build order lives in [PLAN.md](PLAN.md); the functional detail of each shipped item lives in [02_FSD.md](02_FSD.md).

---

## 3. Open assumptions (documented, not blocking)

- **Demo auth** = seeded credentials over HTTPS. Role enforcement is shipped (admin/manager shared; sales limited to owned leads/tasks); SSO, user lifecycle, richer permissions are production next steps.
- Single LINE OA channel; one-to-one LINE user ↔ Contact mapping via `lineUserId`.
- Synthetic data only; no real PII. Seed matches the scenario scale (~2,000 contacts, ~300 leads) so list/search/filter/pagination are exercised realistically — demo scale, not a throughput target.
- "Reusable AI skill" = a documented `SKILL.md` contract + a provider-agnostic call site, liftable into other Jenosize projects.

---

## 4. Clarifying questions for stakeholders

The brief is deliberately open; treating vague requirements as a blocker is a red flag, so the default is **assume and proceed**. Documenting these *is* the requirement-discovery signal the rubric grades.

**Business rules — would confirm with BA / SA:**
- **Lead scoring:** existing qualification rubric, or model-defined? Factors/weights (budget/authority/need/timeline)? *MVP: heuristic from stage/recency/source, clearly labeled, swappable.*
- **Stage criteria & SLA:** entry/exit criteria and time-in-stage SLAs? *MVP: free transitions with an audit Activity per move.*
- **PDPA / consent:** is opt-in required before any LINE outbound, and how is consent evidence stored? *MVP: `consentStatus`; outbound refuses `OPTED_OUT`. The policy is a business/legal decision.*
- **Dedup / merge:** match key (email / phone / `lineUserId`) and merge behavior across sources? *MVP: 1:1 LINE-user↔Contact; no auto-merge.*
- **Lead assignment:** round-robin, territory, or manual across the 20-person team? *MVP: explicit `owner`; no auto-routing.*
- **Output language:** Thai, English, or match the customer? *MVP: AI output defaults to Thai (see [02_FSD](02_FSD.md)).*

**Technical / NFR — assumed, would confirm:**
- Real SSO (Google/Azure) + role tiers? → assumed seeded demo auth.
- Mandated cloud / Thailand data residency? → assumed Vercel + Neon Postgres.
- Website intake mechanism (form POST / webhook / API)? → assumed a standard ingestion endpoint.
- LINE plan tier / rate limits; Rich Menu or LIFF needs? → assumed basic Messaging API (+ LIFF, now shipped).
- Monitoring stack (Sentry/Datadog) + secrets manager? → JSON logging + env secrets in MVP.

**Logistics — would confirm with HR:** demo-URL lifetime after submission; walkthrough language/audience; required repo host/visibility; whether the 16h budget is a hard cap.

---

## 5. Top risks & mitigations

| Risk | Mitigation |
|---|---|
| LINE OA setup friction (verified webhook needs public HTTPS) | Deploy to Vercel early so the webhook URL is stable; mock adapter for local dev |
| LLM latency/cost/flakiness in the demo | Small model + strict `max_tokens` + timeout + deterministic fallback |
| Over-scoping Part 1 CRUD | Companies/Contacts get minimal CRUD; **Leads** get the depth (where the rubric is) |
| Persistence "gotcha" (in-memory) | Neon Postgres from hour 1; explicit restart test |
| Time overrun | Part 1 is the floor; Parts 2 & 3 layered so a partial submission is still coherent |

---

## 6. Appendix — walkthrough talking points

1. Why one Next.js app over split services — a *delivery* trade-off under a 16h budget.
2. The suggestion↔commit boundary and why it's the audit trail (separates AI from truth).
3. Idempotency + signature verification as the two things that make a webhook production-safe.
4. Where AI was used, what was **rejected**, and the one change made after review.
5. Production next steps: real SSO/RBAC, queue for outbound, eval harness in CI, PII handling for LINE data.
