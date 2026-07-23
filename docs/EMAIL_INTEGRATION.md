# Email Integration

The CRM owns email drafts, approval, idempotency records, and the timeline.
Outbound delivery goes through one of two interchangeable transports, chosen by
the `EMAIL_TRANSPORT` env var — **no code change to switch providers**:

- **`smtp`** — send directly over SMTP (Gmail, Office365, or any company mail
  server). Runs inside the app's Node serverless function. Simplest to operate;
  credentials live only in server env.
- **`gateway`** — POST a stable payload to an external HTTP gateway that owns the
  provider credentials and translates inbound webhooks.

Either way, credentials stay server-only and never reach the browser bundle, and
the app fails closed: a draft is never marked "sent" unless `EMAIL_ENABLED=true`
and the selected transport is fully configured.

## Transport A — Direct SMTP (recommended for Gmail / Office365 / company mail)

Set these server-only variables (in `.env` locally, in Vercel Project Settings →
Environment Variables for production):

```text
EMAIL_ENABLED=true
EMAIL_TRANSPORT=smtp
EMAIL_FROM_ADDRESS=you@your-domain.example
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=you@your-domain.example
SMTP_PASSWORD=<smtp or app password>
```

Provider reference:

| Provider          | `SMTP_HOST`            | `SMTP_PORT` | `SMTP_SECURE` | Password                                              |
| ----------------- | ---------------------- | ----------- | ------------- | ----------------------------------------------------- |
| Gmail (free)      | `smtp.gmail.com`       | `465`       | `true`        | Google **App Password** (2-Step Verification on)      |
| Gmail (alt)       | `smtp.gmail.com`       | `587`       | `false`       | Same App Password (STARTTLS)                          |
| Office365 / Outlook | `smtp.office365.com` | `587`       | `false`       | Mailbox password / app password                       |
| Company mail      | your server            | varies      | per server    | per server                                            |

Notes:

- `SMTP_USER` must match `EMAIL_FROM_ADDRESS` (or an authorized alias). Gmail and
  most providers rewrite or reject a `From` that differs from the authenticated
  account.
- **Free Gmail limit:** ~500 recipients/day. Fine for a demo/low-volume CRM.
- **Serverless caveat:** SMTP from a serverless function is generally reliable on
  the Node runtime but has a known intermittent connect-timeout failure mode that
  is plan/region-dependent. The app treats timeouts as **retryable** (retry the
  same draft — the idempotency key prevents duplicate sends). If a given host
  proves flaky under load, switch `EMAIL_TRANSPORT=gateway` (Transport B) without
  touching the app. **Validate on a Vercel preview deploy with a real send before
  trusting it in production** — a local send only proves the wiring, not the
  deployed function's egress.

## Transport B — HTTP gateway

A small provider-specific gateway owns credentials and translates provider
webhooks. Use this when you want SMTP kept out of the function, or need inbound
email.

### 1. Configure the CRM

Set these server-only variables in the deployment environment:

```text
EMAIL_ENABLED=true
EMAIL_FROM_ADDRESS=sales@your-domain.example
EMAIL_OUTBOUND_WEBHOOK_URL=https://your-gateway.example/send
EMAIL_OUTBOUND_WEBHOOK_TOKEN=<long-random-token>
EMAIL_WEBHOOK_SECRET=<different-long-random-secret>
```

Do not prefix any of these with `NEXT_PUBLIC_`.

### 2. Outbound request the gateway must accept

When a user explicitly clicks **Approve & send**, the CRM makes this request:

```http
POST /send
Authorization: Bearer <EMAIL_OUTBOUND_WEBHOOK_TOKEN>
Idempotency-Key: <CRM message UUID>
Content-Type: application/json
```

```json
{
  "from": "sales@your-domain.example",
  "to": "customer@example.com",
  "subject": "Proposal for review",
  "text": "Please find the proposal attached.",
  "idempotencyKey": "<same CRM message UUID>"
}
```

Return an HTTP 2xx response with a stable provider identifier:

```json
{ "providerMessageId": "provider-message-id" }
```

The CRM retries failed sends from the same draft with the same idempotency key;
the gateway must pass that key through to the provider or dedupe it itself.

### 3. Inbound request the gateway must send

After validating the provider signature, the gateway normalizes the inbound
message and sends it to the CRM:

```http
POST https://YOUR_CRM_HOST/api/email/inbound
X-Email-Webhook-Secret: <EMAIL_WEBHOOK_SECRET>
Content-Type: application/json
```

```json
{
  "providerEventId": "delivery-event-id",
  "providerMessageId": "provider-message-id",
  "from": "customer@example.com",
  "to": "sales@your-domain.example",
  "subject": "Re: Proposal for review",
  "text": "Could we discuss this tomorrow?",
  "sentAt": "2026-07-23T09:00:00.000Z",
  "threadId": "provider-thread-id"
}
```

`providerEventId`, `from`, `to`, `subject`, and `text` are required.
`providerMessageId` defaults to the event ID when absent. The route matches the
sender against `Contact.email`, attaches the latest related lead when present,
and dedupes both event and message identifiers.

The inbound webhook (Transport B) is independent of the outbound transport: you
can send via SMTP and still receive replies through a gateway posting to
`/api/email/inbound`.

## Deploying to production (Vercel + Neon)

The live deployment predates the P1 email schema, so email needs three things in
order. **Do them in this sequence** — skipping the migration makes sends fail
with a database error, not an SMTP error.

1. **Deploy the current code** to Vercel (the P1 commit adds the `EMAIL` message
   channel and columns).
2. **Run the P1 migration against Neon:** `prisma migrate deploy` with the
   production `DATABASE_URL`/`DIRECT_URL` loaded. Without this, `Message.EMAIL`
   and the new columns don't exist in prod.
3. **Set env vars in Vercel** (Project Settings → Environment Variables,
   Production scope, server-only — never `NEXT_PUBLIC_`): the `EMAIL_*` and
   `SMTP_*` values for Transport A, or the gateway values for Transport B. Keep
   `EMAIL_ENABLED=false` until every value for the chosen transport is present,
   then set it `true` and redeploy.

## Verification checklist

1. On a **Vercel preview deploy**, open a lead whose contact has a real email,
   draft a message, and click **Approve & send**. Confirm it becomes `SENT` and
   lands in the inbox — this is the only test that validates the deployed
   function's egress (a local send only proves the wiring).
2. For inbound (Transport B): reply from the contact address and verify the
   message appears in the lead timeline exactly once after a replay.

The repository intentionally includes no provider credentials or default live
mailbox. Until a transport is configured, the CRM still supports auditable draft
creation but correctly refuses to mark an email as sent.
