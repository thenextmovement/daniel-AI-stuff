import { createHmac, timingSafeEqual } from "node:crypto";
import { QuoteValidationError } from "@/lib/quotes/validation";

export function signVoiceConsentWebhook(rawBody: string, timestamp: string, secret: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function verifyVoiceConsentWebhook(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  now?: number;
}) {
  const secret = String(process.env.VOICE_CONSENT_INGEST_SECRET || "").trim();
  if (!secret) throw new QuoteValidationError("Consent-Ingest ist nicht konfiguriert.", ["consent_ingest_unavailable"], 503);
  const timestamp = String(input.timestamp || "");
  const timeMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timeMs) || Math.abs((input.now || Date.now()) - timeMs) > 5 * 60_000) {
    throw new QuoteValidationError("Consent-Ingest Zeitstempel ist ungueltig.", ["invalid_webhook_timestamp"], 401);
  }
  const expected = Buffer.from(signVoiceConsentWebhook(input.rawBody, timestamp, secret), "utf8");
  const received = Buffer.from(String(input.signature || ""), "utf8");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new QuoteValidationError("Consent-Ingest Signatur ist ungueltig.", ["invalid_webhook_signature"], 401);
  }
}
