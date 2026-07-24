# Development Plan — Jenosize AI CRM

The **execution checklist**: what's done, what's next, in priority order. Detailed docs live alongside:
[01_PRD](01_PRD.md) · [02_FSD](02_FSD.md) · [03_Architecture](03_Architecture.md) · [04_Database](04_Database.md) · [05_Infrastructure](05_Infrastructure.md) · [06_API_Specs](06_API_Specs.md). Non-blocking follow-ups: [BACKLOG](BACKLOG.md).

**Legend:** `[x]` done · `[ ]` todo · `[~]` partial / in progress. **Priority:** P0 (do first) → P2 (defer until demand). **Effort:** XS <1h · S 1–2h · M ~½ day · L multi-day.

---

## 1. Delivery status (rubric parts)

- [x] **Part 1 — Working product** · deployed to Vercel + Neon, persistence verified (11/11 smoke test)
- [x] **Part 2 — AI skill + LINE** · SKILL.md + copilot + fallback; LINE webhook secure & idempotent; inbound proven on a real device; outbound code-complete
- [~] **Part 3 — Evidence + handover** · README, diagram, tests, AI-usage log, docs split done — **LINE QR + walkthrough video + real outbound-send screenshot pending**

Live: https://jenosize-ai-crm.vercel.app · demo `admin@jenosize.demo` / `Demo1234!`

---

## 2. Shipped ✅ (detail in [02_FSD](02_FSD.md))

- [x] Auth + role enforcement (admin/manager/sales)
- [x] Leads / Companies / Contacts — search · filter · pagination · Zod CRUD
- [x] Pipeline board (drag/drop) + lead-detail stage mover · unified timeline
- [x] Deal fields (probability %, expected close date) + audit Activity
- [x] AI copilot → `AiSuggestion` (Accept/Reject) + **deterministic fallback** (stage plays + repeat-customer signal, **Thai** output)
- [x] LINE webhook — signature verify · idempotency · Contact/Lead mapping · `LINE_IN`
- [x] LINE outbound — approval-based draft (`DRAFT→APPROVED→SENT`), mock + real push adapter
- [x] LIFF self-registration + `follow`/`unfollow`
- [x] LIFF account linking (existing Contact ↔ LINE user) via signed link token
- [x] Greeting auto-reply (per-contact, default off) · chat-history handover view
- [x] Tasks & follow-up reminders (`/tasks` + lead panel)
- [x] Reporting dashboard (summary cards + filterable trend/value/stage charts)
- [x] Mobile/tablet responsive pass (Tailwind)

---

## 3. Pending — closing the two ◐ blocks (manual, ordered #9 → #11)

Code-complete; what remains is **evidence capture** (real phone, LINE console, screen recorder).

- [ ] **Block 9 — real outbound LINE send + evidence** *(do first)* — link a Contact to a real LINE user (contact page or the LIFF connect link) → generate/approve/**send** a LINE draft → capture CRM `Message(SENT)`+`LINE_OUT` and the phone screenshot.
- [ ] **Block 11 — LINE QR + 3–5 min walkthrough video** *(do second, reuses #9's send)* — grab the OA add-friend QR → record login → board → AI suggestion → LINE inbound→draft→approve→send → dashboard.
- [ ] **LIFF account-linking in-LINE device check** — verify the signed connect token survives the `liff.login()` redirect (`liff.state`) on a real device (same session as Block 9).
- [ ] **Responsive verification** — manual 375px / 768px devtools pass (no browser this session).

---

## 4. Prioritized roadmap (active next features)

### P0 — completes the core loop / manager adoption
- [x] Tasks & follow-up reminders · S
- [x] Basic reporting dashboard · S
- [ ] **Global search** · S — one top-bar box → `contains` across Contacts/Leads/Companies
- [ ] **Won/Lost reason capture** · XS — enum + note onto the stage-change Activity

### P1 — high value, moderate cost
- [x] Deal fields (probability %, close date) · S
- [x] RBAC (admin/manager/sales) · M
- [~] **Lead assignment/routing** · M — manual assignment shipped; **auto round-robin/territory** needs a business rule (see [01_PRD §4](01_PRD.md))

> Deferred P2 feature enhancements (email draft editor, workflow automation, sequences, CPQ, mobile, SSO, …) and housekeeping now live in [BACKLOG.md](BACKLOG.md).
