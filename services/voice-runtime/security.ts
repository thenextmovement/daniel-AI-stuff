import { createHmac, timingSafeEqual } from "node:crypto";

export function bearerMatches(header: string | undefined, expected: string) {
  const supplied = String(header || "").replace(/^Bearer\s+/i, "");
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

export function verifyTwilioSignature(input: {
  signature: string | undefined;
  url: string;
  params: URLSearchParams;
  authToken: string;
}) {
  const pairs = [...input.params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const signed = pairs.reduce((value, [key, entry]) => `${value}${key}${entry}`, input.url);
  const expected = createHmac("sha1", input.authToken).update(signed).digest("base64");
  const left = Buffer.from(String(input.signature || ""));
  const right = Buffer.from(expected);
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

export function xmlEscape(value: string) {
  return value.replace(/[<>&'\"]/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;",
  })[character] || character);
}

export function signAttemptBinding(attemptId: string, secret: string) {
  return createHmac("sha256", secret).update(`neontrip:voice-attempt:${attemptId}`).digest("hex");
}

export function verifyAttemptBinding(attemptId: string, supplied: string, secret: string) {
  const expected = Buffer.from(signAttemptBinding(attemptId, secret));
  const received = Buffer.from(String(supplied || ""));
  return received.length === expected.length && timingSafeEqual(received, expected);
}
