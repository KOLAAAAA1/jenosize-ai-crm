import { randomUUID } from "node:crypto";

export type LineSendResult =
  | { ok: true; providerMessageId: string; mode: "mock" | "line"; requestId: string | null; alreadyAccepted?: boolean }
  | { ok: false; error: string; retryable: boolean; mode: "mock" | "line"; requestId: string | null };

export type SendLineTextInput = {
  to: string;
  text: string;
  retryKey: string;
};

export async function sendLineTextMessage(input: SendLineTextInput): Promise<LineSendResult> {
  const enabled = process.env.LINE_ENABLED === "true";
  if (!enabled) {
    return {
      ok: true,
      providerMessageId: `mock:${input.retryKey}`,
      mode: "mock",
      requestId: null,
    };
  }

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  if (!token) {
    return { ok: false, error: "LINE_CHANNEL_ACCESS_TOKEN is not configured", retryable: false, mode: "line", requestId: null };
  }

  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Line-Retry-Key": input.retryKey || randomUUID(),
    },
    body: JSON.stringify({
      to: input.to,
      messages: [{ type: "text", text: input.text }],
    }),
  });

  const requestId = res.headers.get("x-line-request-id");
  const acceptedRequestId = res.headers.get("x-line-accepted-request-id");
  const json = await res.json().catch(() => null);
  const sentId = getSentMessageId(json);

  if (res.ok || res.status === 409) {
    return {
      ok: true,
      providerMessageId: sentId ?? `line:${acceptedRequestId ?? requestId ?? input.retryKey}`,
      mode: "line",
      requestId: acceptedRequestId ?? requestId,
      alreadyAccepted: res.status === 409,
    };
  }

  return {
    ok: false,
    error: typeof json?.message === "string" ? json.message : `LINE send failed with HTTP ${res.status}`,
    retryable: res.status >= 500,
    mode: "line",
    requestId,
  };
}

export type ReplyLineTextInput = {
  replyToken: string;
  text: string;
};

// Reply API — free, but the replyToken is single-use and expires ~1 minute after
// the webhook event. Used only by the test auto-reply (autoreply.ts); the real
// sales path uses the push API above. Mirrors sendLineTextMessage's mock gating.
export async function replyLineTextMessage(input: ReplyLineTextInput): Promise<LineSendResult> {
  const enabled = process.env.LINE_ENABLED === "true";
  if (!enabled) {
    return { ok: true, providerMessageId: `mock:reply:${input.replyToken}`, mode: "mock", requestId: null };
  }

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  if (!token) {
    return { ok: false, error: "LINE_CHANNEL_ACCESS_TOKEN is not configured", retryable: false, mode: "line", requestId: null };
  }

  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      replyToken: input.replyToken,
      messages: [{ type: "text", text: input.text }],
    }),
  });

  const requestId = res.headers.get("x-line-request-id");
  if (res.ok) {
    return { ok: true, providerMessageId: `line:reply:${requestId ?? input.replyToken}`, mode: "line", requestId };
  }

  const json = await res.json().catch(() => null);
  return {
    ok: false,
    // A 400 here is usually an expired/used replyToken (e.g. the console greeting
    // consumed it first) — retrying won't help, so it is not retryable.
    error: typeof json?.message === "string" ? json.message : `LINE reply failed with HTTP ${res.status}`,
    retryable: res.status >= 500,
    mode: "line",
    requestId,
  };
}

function getSentMessageId(json: unknown): string | null {
  if (!json || typeof json !== "object" || !("sentMessages" in json)) return null;
  const sentMessages = (json as { sentMessages?: unknown }).sentMessages;
  if (!Array.isArray(sentMessages)) return null;
  const first = sentMessages[0];
  if (!first || typeof first !== "object" || !("id" in first)) return null;
  const id = (first as { id?: unknown }).id;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}
