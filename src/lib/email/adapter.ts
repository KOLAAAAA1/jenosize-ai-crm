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

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
};

// Minimal shape of what nodemailer's sendMail resolves to / accepts. Injectable
// so the SMTP path is unit-testable without opening a real connection.
type SmtpSendMail = (message: {
  from: string;
  to: string;
  subject: string;
  text: string;
}) => Promise<{ messageId?: string }>;

export type EmailTransportOptions = {
  enabled?: boolean;
  transport?: "smtp" | "gateway";
  // HTTP gateway transport
  url?: string;
  token?: string;
  fetchImpl?: FetchLike;
  // SMTP transport
  smtp?: SmtpConfig;
  sendMailImpl?: SmtpSendMail;
};

// Provider-neutral email seam. Two interchangeable transports, chosen by env so
// the provider is swappable without code changes:
//
//   EMAIL_TRANSPORT=smtp     -> send directly over SMTP (Gmail, Office365, or any
//                               company mail server) via nodemailer. Works from a
//                               Node serverless function (Server Actions run on
//                               the Node runtime).
//   EMAIL_TRANSPORT=gateway  -> POST a stable payload to an external HTTP gateway
//                               that owns provider credentials.
//
// We deliberately fail closed when unconfigured rather than marking a draft as
// sent in a demo-only mock mode.
export async function sendEmailMessage(
  input: SendEmailInput,
  options: EmailTransportOptions = {},
): Promise<EmailSendResult> {
  const enabled = options.enabled ?? process.env.EMAIL_ENABLED === "true";
  if (!enabled) return { ok: false, error: "Email delivery is not configured", retryable: false, requestId: null };

  const transport = resolveTransport(options);
  if (transport === "smtp") return sendViaSmtp(input, options);
  return sendViaGateway(input, options);
}

function resolveTransport(options: EmailTransportOptions): "smtp" | "gateway" {
  if (options.transport) return options.transport;
  const fromEnv = process.env.EMAIL_TRANSPORT?.trim().toLowerCase();
  if (fromEnv === "smtp" || fromEnv === "gateway") return fromEnv;
  // No explicit choice: infer from what's configured. SMTP host present -> SMTP;
  // otherwise fall back to the HTTP gateway (preserves prior default behavior).
  if (options.smtp?.host || process.env.SMTP_HOST?.trim()) return "smtp";
  return "gateway";
}

// --- SMTP transport (Gmail / Office365 / company mail) ---------------------

function readSmtpConfigFromEnv(): Partial<SmtpConfig> {
  const host = process.env.SMTP_HOST?.trim();
  const portRaw = process.env.SMTP_PORT?.trim();
  const port = portRaw ? Number(portRaw) : 465;
  const secureRaw = process.env.SMTP_SECURE?.trim().toLowerCase();
  // Default: implicit TLS on 465, STARTTLS otherwise — override with SMTP_SECURE.
  const secure = secureRaw ? secureRaw === "true" : port === 465;
  return {
    host,
    port,
    secure,
    user: process.env.SMTP_USER?.trim(),
    pass: process.env.SMTP_PASSWORD,
  };
}

async function sendViaSmtp(input: SendEmailInput, options: EmailTransportOptions): Promise<EmailSendResult> {
  const cfg = { ...readSmtpConfigFromEnv(), ...options.smtp };
  if (!cfg.host || !cfg.user || !cfg.pass || !cfg.port) {
    return { ok: false, error: "SMTP host, port, user, and password must all be configured", retryable: false, requestId: null };
  }

  let sendMail = options.sendMailImpl;
  if (!sendMail) {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    sendMail = (message) => transporter.sendMail(message);
  }

  try {
    const info = await sendMail({ from: input.from, to: input.to, subject: input.subject, text: input.text });
    // A missing messageId is unusual but non-fatal; fall back to the idempotency
    // key so the CRM still records a stable, non-empty provider identifier.
    return { ok: true, providerMessageId: info.messageId ?? input.idempotencyKey, requestId: null };
  } catch (err) {
    // Auth/envelope/message errors won't succeed on retry; connection and
    // timeout errors (the common serverless SMTP failure mode) can.
    const code = (err as { code?: string })?.code;
    const retryable = !(code === "EAUTH" || code === "EENVELOPE" || code === "EMESSAGE");
    return { ok: false, error: (err as Error)?.message ?? "SMTP send failed", retryable, requestId: null };
  }
}

// --- HTTP gateway transport ------------------------------------------------

async function sendViaGateway(input: SendEmailInput, options: EmailTransportOptions): Promise<EmailSendResult> {
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
