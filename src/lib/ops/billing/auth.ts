import { createHmac, timingSafeEqual } from "node:crypto";

const REPLAY_WINDOW_SECONDS = 5 * 60;

type HeaderReader = { get(name: string): string | null };

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function billingWebhookSecret() {
  return String(process.env.BILLING_WEBHOOK_SECRET || "").trim();
}

export function signBillingWebhook(body: string, timestamp: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export function verifyBillingWebhook(input: {
  body: string;
  headers: HeaderReader;
  nowSeconds?: number;
  secret?: string;
}) {
  const secret = input.secret ?? billingWebhookSecret();
  if (secret.length < 32) return { ok: false as const, status: 503, code: "BILLING_WEBHOOK_NOT_CONFIGURED" };
  const timestamp = String(input.headers.get("x-neontrip-timestamp") || "").trim();
  const signature = String(input.headers.get("x-neontrip-signature") || "").trim();
  const eventId = String(input.headers.get("x-neontrip-event-id") || input.headers.get("x-neontrip-idempotency-key") || "").trim();
  if (!/^\d{10}$/.test(timestamp) || !/^sha256=[a-f0-9]{64}$/i.test(signature) || !/^[A-Za-z0-9:._/-]{8,200}$/.test(eventId)) {
    return { ok: false as const, status: 401, code: "INVALID_BILLING_SIGNATURE" };
  }
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > REPLAY_WINDOW_SECONDS) {
    return { ok: false as const, status: 401, code: "STALE_BILLING_SIGNATURE" };
  }
  const expected = signBillingWebhook(input.body, timestamp, secret);
  if (!safeEqual(signature, expected)) return { ok: false as const, status: 401, code: "INVALID_BILLING_SIGNATURE" };
  return { ok: true as const, eventId, timestamp };
}
