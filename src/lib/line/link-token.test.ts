import { describe, it, expect } from "vitest";
import { signContactLinkToken, verifyContactLinkToken } from "./link-token";
import { signSession } from "@/lib/session";

describe("contact link token", () => {
  it("round-trips a contactId through sign → verify", async () => {
    const token = await signContactLinkToken("con_abc123");
    expect(await verifyContactLinkToken(token)).toBe("con_abc123");
  });

  it("rejects a tampered or garbage token", async () => {
    expect(await verifyContactLinkToken("not-a-jwt")).toBeNull();
    const token = await signContactLinkToken("con_abc123");
    expect(await verifyContactLinkToken(token + "x")).toBeNull();
  });

  it("rejects a session token — the `purpose` claim keeps the two token types non-interchangeable", async () => {
    // Same secret + HS256 as the link token, but no link purpose.
    const session = await signSession({ id: "usr_1", email: "a@b.co", name: "A", role: "SALES" });
    expect(await verifyContactLinkToken(session)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signContactLinkToken("con_abc123", -10); // already expired
    expect(await verifyContactLinkToken(token)).toBeNull();
  });
});
