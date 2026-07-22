import { createHmac, timingSafeEqual } from "node:crypto";

export function computeLineSignature(body: string, channelSecret: string): string {
  return createHmac("sha256", channelSecret).update(body, "utf8").digest("base64");
}

export function verifyLineSignature({
  body,
  signature,
  channelSecret,
}: {
  body: string;
  signature: string | null;
  channelSecret: string | undefined;
}): boolean {
  if (!signature || !channelSecret) return false;

  const expected = Buffer.from(computeLineSignature(body, channelSecret), "base64");
  const actual = Buffer.from(signature, "base64");

  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
