import { describe, expect, it, vi } from "vitest";
import { sendEmailMessage } from "./adapter";

const input = {
  from: "sales@example.test",
  to: "customer@example.test",
  subject: "Proposal",
  text: "Here is the proposal.",
  idempotencyKey: "email-message-123",
};

describe("email gateway adapter", () => {
  it("does not claim an email was sent when the gateway is unconfigured", async () => {
    await expect(sendEmailMessage(input, { enabled: false })).resolves.toMatchObject({
      ok: false,
      retryable: false,
      error: "Email delivery is not configured",
    });
  });

  it("sends an authenticated, idempotent request to the configured gateway", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ providerMessageId: "provider-123" }), { status: 202 }),
    );

    const result = await sendEmailMessage(input, {
      enabled: true,
      url: "https://mail-gateway.example.test/send",
      token: "gateway-token",
      fetchImpl,
    });

    expect(result).toEqual({ ok: true, providerMessageId: "provider-123", requestId: null });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://mail-gateway.example.test/send",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer gateway-token",
          "Idempotency-Key": input.idempotencyKey,
        }),
      }),
    );
  });
});

const smtp = { host: "smtp.gmail.com", port: 465, secure: true, user: "sales@example.test", pass: "app-password" };

describe("email SMTP transport", () => {
  it("fails closed (non-retryable) when SMTP is not fully configured", async () => {
    await expect(
      sendEmailMessage(input, { enabled: true, transport: "smtp", smtp: { ...smtp, pass: "" } }),
    ).resolves.toMatchObject({ ok: false, retryable: false });
  });

  it("sends over SMTP and returns the provider message id", async () => {
    const sendMailImpl = vi.fn().mockResolvedValue({ messageId: "<abc@gmail.com>" });

    const result = await sendEmailMessage(input, { enabled: true, transport: "smtp", smtp, sendMailImpl });

    expect(result).toEqual({ ok: true, providerMessageId: "<abc@gmail.com>", requestId: null });
    expect(sendMailImpl).toHaveBeenCalledWith({
      from: input.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
  });

  it("marks auth failures non-retryable but connection timeouts retryable", async () => {
    const authErr = Object.assign(new Error("Invalid login"), { code: "EAUTH" });
    const timeoutErr = Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" });

    await expect(
      sendEmailMessage(input, { enabled: true, transport: "smtp", smtp, sendMailImpl: vi.fn().mockRejectedValue(authErr) }),
    ).resolves.toMatchObject({ ok: false, retryable: false });

    await expect(
      sendEmailMessage(input, { enabled: true, transport: "smtp", smtp, sendMailImpl: vi.fn().mockRejectedValue(timeoutErr) }),
    ).resolves.toMatchObject({ ok: false, retryable: true });
  });
});
