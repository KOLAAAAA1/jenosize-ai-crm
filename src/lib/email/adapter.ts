export type SendEmailInput = {
  from: string;
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
};

export type EmailSendResult =
  | { ok: true; providerMessageId: string; requestId: string | null }
  | { ok: false; error: string; retryable: boolean; requestId: string | null };

type FetchLike = typeof fetch;

export type EmailGatewayOptions = {
  enabled?: boolean;
  url?: string;
  token?: string;
  fetchImpl?: FetchLike;
};

// Provider-neutral email seam. A small gateway (e.g. a provider function, n8n,
// or an internal mail service) accepts this stable payload and owns provider
// credentials. We deliberately fail closed when it is unconfigured rather than
// marking a draft as sent in a demo-only mock mode.
export async function sendEmailMessage(
  input: SendEmailInput,
  options: EmailGatewayOptions = {},
): Promise<EmailSendResult> {
  const enabled = options.enabled ?? process.env.EMAIL_ENABLED === "true";
  if (!enabled) return { ok: false, error: "Email delivery is not configured", retryable: false, requestId: null };

  const url = options.url ?? process.env.EMAIL_OUTBOUND_WEBHOOK_URL?.trim();
  const token = options.token ?? process.env.EMAIL_OUTBOUND_WEBHOOK_TOKEN?.trim();
  if (!url || !token) {
    return { ok: false, error: "Email gateway URL or token is not configured", retryable: false, requestId: null };
  }

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, error: "Email gateway request failed", retryable: true, requestId: null };
  }

  const requestId = response.headers.get("x-request-id");
  const payload = await response.json().catch(() => null);
  const providerMessageId = typeof payload?.providerMessageId === "string" ? payload.providerMessageId : null;

  if (response.ok && providerMessageId) return { ok: true, providerMessageId, requestId };

  return {
    ok: false,
    error: typeof payload?.error === "string" ? payload.error : `Email gateway failed with HTTP ${response.status}`,
    retryable: response.status >= 500,
    requestId,
  };
}
