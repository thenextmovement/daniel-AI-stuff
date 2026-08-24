import { createHash, timingSafeEqual } from "node:crypto";

function safeEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function isBillingWorkerAuthorized(headers: Headers) {
  const expected = String(process.env.BILLING_WORKER_API_TOKEN || "").trim();
  if (expected.length < 24) return false;
  const authorization = String(headers.get("authorization") || "");
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  return Boolean(token) && safeEqual(token, expected);
}

export function billingWorkerEventId(headers: Headers, payloadEventId: unknown) {
  if (!isBillingWorkerAuthorized(headers)) return null;
  const eventId = String(headers.get("x-neontrip-event-id") || payloadEventId || "").trim();
  return /^[A-Za-z0-9:._/-]{8,200}$/.test(eventId) ? eventId : null;
}
