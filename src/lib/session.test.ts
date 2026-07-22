import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import { signSession, verifySession, verifyPassword, type SessionUser } from "@/lib/session";

const user: SessionUser = { id: "usr_1", email: "a@b.com", name: "Ada B", role: "ADMIN" };

describe("session token round-trip", () => {
  it("signs and verifies back the same user", async () => {
    const token = await signSession(user);
    const out = await verifySession(token);
    expect(out).toMatchObject({ id: "usr_1", email: "a@b.com", name: "Ada B", role: "ADMIN" });
  });

  it("returns null for a tampered token", async () => {
    const token = await signSession(user);
    const tampered = token.slice(0, -4) + "AAAA";
    expect(await verifySession(tampered)).toBeNull();
  });

  it("returns null for garbage input", async () => {
    expect(await verifySession("not-a-jwt")).toBeNull();
    expect(await verifySession("")).toBeNull();
  });
});

describe("verifyPassword", () => {
  it("is true for the correct password", async () => {
    const hash = bcrypt.hashSync("s3cret", 10);
    expect(await verifyPassword("s3cret", hash)).toBe(true);
  });

  it("is false for a wrong password", async () => {
    const hash = bcrypt.hashSync("s3cret", 10);
    expect(await verifyPassword("nope", hash)).toBe(false);
  });

  it("is false when the user is missing (null hash) — still runs a compare", async () => {
    expect(await verifyPassword("anything", null)).toBe(false);
  });
});
