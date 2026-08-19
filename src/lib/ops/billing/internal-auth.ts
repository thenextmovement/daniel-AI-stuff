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
