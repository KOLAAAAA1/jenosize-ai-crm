# Email Gateway Contract

The CRM owns email drafts, approval, idempotency records, and the timeline. A
small provider-specific gateway owns email-provider credentials and translates
provider webhooks. This keeps provider choice reversible and prevents secrets
from entering the app or browser bundle.

## 1. Configure the CRM

Set these server-only variables in the deployment environment:

```text
EMAIL_ENABLED=true
EMAIL_FROM_ADDRESS=sales@your-domain.example
EMAIL_OUTBOUND_WEBHOOK_URL=https://your-gateway.example/send
EMAIL_OUTBOUND_WEBHOOK_TOKEN=<long-random-token>
EMAIL_WEBHOOK_SECRET=<different-long-random-secret>
```

Do not prefix any of these with `NEXT_PUBLIC_`.

## 2. Outbound request the gateway must accept

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

## 3. Inbound request the gateway must send

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

## 4. Provider activation checklist

1. Choose the mailbox provider and deploy the gateway in the same trusted
   environment as its credentials.
2. Configure verified sender/domain and inbound routing with that provider.
3. Configure the gateway with both CRM secrets above.
4. Add the five `EMAIL_*` variables to Vercel; keep `EMAIL_ENABLED=false`
   until all other values are present.
5. Send a real outbound email from a mapped lead and verify it becomes `SENT`.
6. Reply from the contact address and verify the inbound message appears in the
   lead timeline exactly once after a replay.

The repository intentionally includes no provider credentials or default live
mailbox. Until this checklist is complete, the CRM still supports auditable
draft creation but correctly refuses to mark an email as sent.
