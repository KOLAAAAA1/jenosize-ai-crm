# Backlog — Jenosize AI CRM

Deferred feature enhancements and housekeeping, captured so they aren't lost. **None is required for the MVP or the demo** — defer until there's real demand. Active, prioritized work (P0/P1) lives in [PLAN.md](PLAN.md); feature behavior specs live in [02_FSD](02_FSD.md).

**Legend:** `[ ]` todo · 🔮 future enhancement (groundwork may exist, feature not delivered). **Effort:** XS <1h · S 1–2h · M ~½ day · L multi-day.

---

## 1. Deferred feature enhancements (P2 — defer until real demand)

- [ ] **Email draft editor + attachments** · L · 🔮 — provider-neutral seam exists; the officer-facing compose/edit editor with file attachments + live delivery is deferred. Design record: [02_FSD §7](02_FSD.md).
- [ ] **Workflow automation** (triggers → actions) · L — high leverage but needs a rules engine; build after signal.
- [ ] **Sequences / cadences · Dedup / merge · Segmentation** · M–L — scale/marketing features; premature for an internal MVP.
- [ ] **CPQ / quotes · Mobile app · SSO · Territory management** · L — enterprise-tier; defer until the core loop is adopted.

## 2. Housekeeping

- [ ] Add `cspell.json` with a project word-list to silence domain-term dictionary noise (`ingester`, `pooler`, `backpressure`, `HMAC`, `Jenosize`, etc.) across the docs.
