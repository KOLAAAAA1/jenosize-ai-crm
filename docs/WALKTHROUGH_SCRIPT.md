# Walkthrough Video — Codex Production Runbook

A 3–5 minute walkthrough of the AI CRM MVP, **produced by Codex**: Codex drives the
deployed app through the **Chrome plugin** while the screen is captured from the shell,
then adds a voiceover and exports the final MP4. This file is both the shot list and the
operator instructions — follow it top to bottom.

- **Deployed app:** https://jenosize-ai-crm.vercel.app
- **Demo login:** `admin@jenosize.demo` / `Demo1234!`
- **Target length:** 3–5 minutes · 1080p · H.264
- **Working files:** put intermediates in `docs/submissions/` prefixed `_` (git-ignored/deleted after); final is `docs/submissions/walkthrough.mp4`.

---

## Guardrails (must hold for the whole recording)

- **No secrets on screen.** Never show `.env` / `.env.production`, Neon connection
  strings, `AUTH_SECRET`, `ANTHROPIC_API_KEY`, or the LINE console's **Channel secret /
  Channel access token** fields. The committed `docs/submissions/developers.line.biz.png`
  (Bot ID + QR + webhook URL only) is safe to show; the live console's token tabs are not.
- **Demo credentials only** — `admin@jenosize.demo`. Log out of any real GitHub/LINE/Vercel
  accounts before recording so notifications/emails don't appear.
- **Use real, current numbers.** Don't hard-code a test count — run `pnpm test` live and
  show whatever it prints.
- **Keep it 3–5 min.** Rehearse pacing; trim dead air in post.

---

## Pre-flight (Codex)

1. **Screen-recording permission** (one-time, human): System Settings → Privacy & Security
   → Screen Recording → enable for the terminal/Codex app. Codex cannot grant this itself —
   if capture produces a black frame, this is why.
2. **Toolchain present** (already verified on this machine): `ffmpeg`, `screencapture`,
   `say` are on `PATH`.
3. **Browser**: open a clean Chrome window at ~1280×800 (or 1920×1080), **light theme**,
   zoom 100%, no extra tabs/bookmarks bar. Use the Chrome plugin to control it.
4. **App is up**: `curl -s -o /dev/null -w '%{http_code}' https://jenosize-ai-crm.vercel.app/login` → expect `200`.
5. **Find the screen device index** for ffmpeg:
   `ffmpeg -f avfoundation -list_devices true -i "" 2>&1 | grep -i "screen"` (note the index, e.g. `1`).

---

## Recording method

**Method A — screen-only capture, voiceover added after (recommended, most reliable):**

Start capture (video only; ~5 min cap), run the shot list, then stop:

```bash
# option 1: ffmpeg (replace 1 with your screen index)
ffmpeg -y -f avfoundation -capture_cursor 1 -framerate 30 -i "1:none" \
  -t 300 -pix_fmt yuv420p docs/submissions/_screen.mp4
# option 2: macOS built-in (Ctrl-C to stop, or -V caps seconds)
# screencapture -v -V 300 docs/submissions/_screen.mov
```

Voiceover — **pick one**:

- **TTS (fully autonomous):** put each scene's *Narration* lines into `docs/submissions/_narration.txt`, then
  `say -v Samantha -r 180 -o docs/submissions/_narration.aiff -f docs/submissions/_narration.txt`
- **Human voiceover:** the user records `docs/submissions/_narration.aiff` (or `.m4a`) over the captured video.

Mux + export final MP4:

```bash
ffmpeg -y -i docs/submissions/_screen.mp4 -i docs/submissions/_narration.aiff \
  -map 0:v -map 1:a -c:v libx264 -crf 20 -preset veryfast \
  -c:a aac -b:a 160k -shortest docs/submissions/walkthrough.mp4
```

**Method B — single take with live narration (advanced):** play TTS through a loopback
audio device (e.g. BlackHole) and capture it alongside the screen in one pass. Only use if
a loopback device is already installed; otherwise Method A is simpler and syncs cleaner.

> **Pacing tip:** to keep audio/video aligned in Method A, record the screen actions at the
> same rhythm as the narration lines (roughly one scene's actions per that scene's lines).
> If a scene's video runs long, trim it in post before muxing.

---

## Shot list (scene → actions → narration)

Each scene lists the **on-screen actions** Codex performs (Chrome plugin) and the
**narration** to voice. Narration lines are written to be read aloud by `say` or a person.

### 0:00–0:30 — Context & trade-off
- **Show:** `README.md` architecture diagram (or `docs/architecture.html` in a tab), then `docs/PLAN.md` scope/status table.
- **Narration:** "This is a working AI CRM MVP for a twenty-person commercial team — about two thousand contacts and three hundred active leads. I built it as one Next.js full-stack app with Prisma and Postgres, so the timebox went into product depth, persistence, AI safety, and LINE integration instead of split-service plumbing."

### 0:30–1:30 — Core CRM flow
- **Actions:** open the deployed URL → log in as `admin@jenosize.demo` → click **Leads** → demo the search box + a stage/owner filter + pagination → open a lead detail page → change the **Stage** dropdown → **hard-refresh** (Cmd-R) and show the stage + timeline persisted → click **Pipeline** (the `/board` view).
- **Narration:** "Login is demo auth over an HttpOnly session. Here's the lead list with server-side search, filtering, and pagination. Opening a lead, I move its stage — that's a shared service wrapped by a server action: it updates the lead and appends an immutable stage-change activity. After a hard refresh, the change persisted; nothing is in-memory. The pipeline board shows the same data by stage."

### 1:30–2:30 — AI copilot boundary
- **Actions:** on a lead detail page, click **Generate suggestion** → show the returned **summary**, **qualification score with reasons**, and **next-best action** (point out the fallback label if Anthropic credits are unavailable) → **Accept** or **Reject** a suggestion → if a LINE draft is offered, save it and show it becomes a **Message (DRAFT)**, not an automatic send.
- **Narration:** "The copilot builds CRM context and returns a summary, a qualification score with reasons, and a next-best action. If the model is unavailable it falls back to a deterministic scorer, clearly labelled. The key design point: AI output is never CRM truth by itself — it's stored as a suggestion and needs explicit human accept or reject. A drafted LINE reply is saved as a draft, never sent automatically."

### 2:30–3:30 — LINE OA safety
- **Actions:** show `README.md` §"LINE OA integration" / API notes for `POST /api/line/webhook` → briefly show the committed `docs/submissions/qr-line-official.png` and the LINE Developers webhook-URL screenshot (Bot ID + webhook only — **not** token tabs) → show a mapped inbound LINE message on a lead timeline → click **Approve & send** on an outbound draft.
- **Narration:** "Inbound LINE hits this webhook. The signature is verified against the raw request body before parsing, and events are de-duplicated on the LINE event and message IDs, so replays never double-write. A mapped message lands on the contact's lead timeline. Outbound is approval-gated: approving sends a LINE push with a retry key, because human approval can happen after the webhook's reply token expires."

### 3:30–4:30 — Evidence & handover
- **Actions:** in a terminal on screen, run `export NODE_OPTIONS= && pnpm test` and show the **actual** pass count → open `docs/AI_USAGE_LOG.md`, `docs/SUBMISSION_CHECKLIST.md`, and `README.md` setup/deploy/monitoring sections.
- **Narration:** "The required automated tests cover a core CRM flow, the AI fallback path, and LINE webhook signature-and-idempotency, plus outbound approval. The README carries setup, deploy, API notes, and monitoring notes; there's an AI-usage log and a submission checklist for handover."

### 4:30–5:00 — Production next steps
- **Show:** the README "Production next steps" list (or say them over the dashboard).
- **Narration:** "Deliberately deferred for production: real auth and RBAC instead of demo credentials, queue-based LINE ingestion for high traffic, structured log aggregation and alerts, more AI eval cases in CI, and a PII retention and deletion policy for real customer data."

---

## Post-production & publish

1. **Trim** to 3–5 min; confirm 1080p H.264 and that audio is in sync.
2. **Verify** it plays: `ffprobe docs/submissions/walkthrough.mp4` (check duration/streams) and open it once.
3. **Clean up** intermediates: delete `docs/submissions/_screen.*` and `docs/submissions/_narration.*`.
4. **Publish the link, don't commit a large binary.** A 3–5 min 1080p file is tens of MB; prefer
   uploading to **YouTube (unlisted)** or **Google Drive (link-shareable)** and pasting the URL into
   `docs/SUBMISSION_CHECKLIST.md` → Submission Package → walkthrough-video item. Only commit the
   MP4 to `docs/submissions/` if it stays under ~50 MB (else use Git LFS).
5. Tick the walkthrough item in `docs/SUBMISSION_CHECKLIST.md` once the link is live.
