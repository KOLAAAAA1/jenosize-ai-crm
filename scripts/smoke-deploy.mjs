import "dotenv/config";
import { createHmac } from "node:crypto";

const BASE_URL = (process.env.SMOKE_BASE_URL || process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const EMAIL = process.env.SMOKE_EMAIL || "admin@jenosize.demo";
const PASSWORD = process.env.SMOKE_PASSWORD || "Demo1234!";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15000);

const results = [];

function lineSignature(body, channelSecret) {
  return createHmac("sha256", channelSecret).update(body, "utf8").digest("base64");
}

async function request(path, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${BASE_URL}${path}`, { ...init, signal: controller.signal, redirect: "manual" });
  } finally {
    clearTimeout(timeout);
  }
}

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
}

async function expectStatus(name, path, expected, init = {}) {
  const res = await request(path, init);
  const ok = res.status === expected;
  record(name, ok, `HTTP ${res.status}`);
  if (!ok) throw new Error(`${name}: expected HTTP ${expected}, got ${res.status}`);
  return res;
}

function cookieHeaderFrom(res) {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("login did not set a session cookie");
  return setCookie.split(";")[0];
}

async function main() {
  console.log(`Smoke target: ${BASE_URL}`);

  await expectStatus("login page", "/login", 200);
  await expectStatus("unauthenticated /api/me", "/api/me", 401);

  const login = await expectStatus("demo login", "/api/auth/login", 200, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const cookie = cookieHeaderFrom(login);

  const me = await expectStatus("authenticated /api/me", "/api/me", 200, {
    headers: { Cookie: cookie },
  });
  const meJson = await me.json();
  if (meJson?.user?.email !== EMAIL) throw new Error(`expected logged-in user ${EMAIL}`);
  record("session user matches demo email", true, EMAIL);

  await expectStatus("leads page", "/leads", 200, { headers: { Cookie: cookie } });
  await expectStatus("board page", "/board", 200, { headers: { Cookie: cookie } });

  const unsigned = await expectStatus("unsigned LINE webhook rejected", "/api/line/webhook", 401, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events: [] }),
  });
  const unsignedJson = await unsigned.json();
  if (unsignedJson?.status !== "blocked") throw new Error("unsigned LINE webhook did not return blocked status");
  record("unsigned LINE webhook body", true, "status=blocked");

  if (process.env.SMOKE_LINE_USER_ID) {
    const eventId = `smoke_${Date.now()}`;
    const messageId = `smoke_msg_${Date.now()}`;
    const body = JSON.stringify({
      destination: "smoke-destination",
      events: [
        {
          type: "message",
          webhookEventId: eventId,
          deliveryContext: { isRedelivery: false },
          timestamp: Date.now(),
          source: { type: "user", userId: process.env.SMOKE_LINE_USER_ID },
          message: { type: "text", id: messageId, text: "Smoke test LINE webhook message." },
        },
      ],
    });
    const secret = process.env.LINE_CHANNEL_SECRET;
    if (!secret) throw new Error("SMOKE_LINE_USER_ID was set, but LINE_CHANNEL_SECRET is missing");

    const signed = await expectStatus("signed LINE webhook accepted", "/api/line/webhook", 200, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-line-signature": lineSignature(body, secret),
      },
      body,
    });
    const signedJson = await signed.json();
    const expectProcessed = process.env.SMOKE_EXPECT_LINE_PROCESSED === "true";
    const processed = Number(signedJson?.processed || 0);
    if (expectProcessed && processed < 1) {
      throw new Error(`signed LINE webhook was accepted but not processed: ${JSON.stringify(signedJson)}`);
    }
    record("signed LINE webhook result", true, JSON.stringify(signedJson));
  } else {
    record("signed LINE webhook", true, "skipped; set SMOKE_LINE_USER_ID to exercise mapping");
  }

  await expectStatus("logout", "/api/auth/logout", 200, {
    method: "POST",
    headers: { Cookie: cookie },
  });

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
