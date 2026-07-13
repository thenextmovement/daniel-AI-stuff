import { NextRequest, NextResponse } from "next/server";
import { createVoiceConsent } from "@/lib/ops/voice-platform-data";
import { verifyVoiceConsentWebhook } from "@/lib/ops/voice-consent-webhook";
import { voiceRuntimeApiFailure } from "@/lib/ops/voice-runtime-api";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > 32_000) throw new QuoteValidationError("Consent-Payload ist zu gross.", ["payload_too_large"], 413);
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > 32_000) throw new QuoteValidationError("Consent-Payload ist zu gross.", ["payload_too_large"], 413);
    verifyVoiceConsentWebhook({
      rawBody,
      timestamp: request.headers.get("x-neontrip-timestamp"),
      signature: request.headers.get("x-neontrip-signature"),
    });
    let body: Record<string, unknown>;
    try { body = JSON.parse(rawBody) as Record<string, unknown>; }
    catch { throw new QuoteValidationError("Consent-Payload ist kein gueltiges JSON.", ["invalid_json"], 400); }
    const consent = await createVoiceConsent(body);
    return NextResponse.json({ ok: true, consent }, { status: 201 });
  } catch (error) {
    return voiceRuntimeApiFailure(error, "consent-ingest");
  }
}
