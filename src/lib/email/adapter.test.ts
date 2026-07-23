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
