# Postman collection — Jenosize AI CRM

Exercise the JSON API from Postman against **localhost** or the **Cloudflare tunnel**.

## Files
- `jenosize-crm.postman_collection.json` — the requests.
- `jenosize-crm.local.postman_environment.json` — `baseUrl = http://localhost:3000`.
- `jenosize-crm.tunnel.postman_environment.json` — `baseUrl = <your tunnel URL>` (edit after each `pnpm tunnel` run).

## Import
Postman → **Import** → drop all three files. Then pick an environment from the
top-right dropdown (**Local** or **Tunnel**). With no environment selected, the
collection falls back to `http://localhost:3000`.

For the tunnel: run `pnpm tunnel`, copy the printed `https://<random>.trycloudflare.com`
URL into the **Tunnel** environment's `baseUrl` (the subdomain changes every run).

## Endpoints
| Request | Method + path | Notes |
|---|---|---|
| Auth / Login | `POST /api/auth/login` | Sets the `crm_session` cookie. **Run this first.** |
| Auth / Me | `GET /api/me` | Current user, or 401. |
| Auth / Logout | `POST /api/auth/logout` | Clears the cookie. |
| AI Copilot / Generate suggestion | `POST /api/ai/copilot` | Body `{ leadId }`. Needs a login. |
| LINE Webhook / Inbound (valid) | `POST /api/line/webhook` | Auto-signs `X-Line-Signature`. |
| LINE Webhook / Inbound (invalid) | `POST /api/line/webhook` | Bad signature → 401. |

## Auth & cookies
Login sets an **HttpOnly** `crm_session` cookie. Postman's cookie jar stores it
per-domain and sends it automatically on later requests to the **same base URL**.
localhost and the tunnel are different domains, so **log in once per environment**.
(Keep "Automatically follow cookies" on — Postman's default.)

## LINE webhook signature
The webhook verifies `X-Line-Signature = base64(HMAC-SHA256(rawBody, LINE_CHANNEL_SECRET))`.
Set the **`lineChannelSecret`** collection variable to your channel secret
(`LINE_CHANNEL_SECRET` in `.env`) — the "valid" request's pre-request script
computes the header from the exact body at send time. It must match the running
server's `LINE_CHANNEL_SECRET`.

Behavior of the "valid" request:
- First send → `processed: 1` (persists Message(RECEIVED) + LINE_IN activity when
  `lineUserId` maps to a Contact).
- Re-send unchanged → `duplicate: 1` (idempotent on `webhookEventId`).
- Unmapped `lineUserId` → `unmapped: 1` (signed FAILED audit row).

Change `lineWebhookEventId` + `lineMessageId` to process a fresh event.

## Collection variables (defaults, editable after import)
| Variable | Default | Purpose |
|---|---|---|
| `baseUrl` | `http://localhost:3000` | Fallback when no environment is selected. |
| `adminEmail` | `admin@jenosize.demo` | Seeded login (also `manager@`, `sales@`). |
| `password` | `Demo1234!` | Seeded `DEMO_PASSWORD` (dev only, not a real secret). |
| `leadId` | `led_00249` | Any seeded `led_XXXXX`. |
| `lineUserId` | `Ucfc1aef0dc311aacc408deee9b5225ed` | A seeded LINE-linked contact. |
| `lineChannelSecret` | _(empty)_ | **Set this** to your `LINE_CHANNEL_SECRET`. |
| `lineWebhookEventId` / `lineMessageId` | `pm_evt_demo` / `pm_msg_demo` | Change for a fresh (non-duplicate) event. |
| `lineMessageText` | _sample_ | Inbound message text. |
