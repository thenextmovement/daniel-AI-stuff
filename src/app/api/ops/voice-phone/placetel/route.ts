import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authorizeVoiceCopilotApi, readVoiceCopilotJson, voiceCopilotApiFailure } from "@/lib/ops/voice-copilot-api";
import { currentPhoneDevice } from "@/lib/ops/voice-phone-identity";
import { phoneRequestIsSameOrigin } from "@/lib/ops/voice-phone-contract";
import { normalizePhoneE164, requireVoiceUuid } from "@/lib/ops/voice-platform-contract";
import { createVoiceCallSession } from "@/lib/ops/voice-knowledge";
import { loadVoiceContextRecord } from "@/lib/ops/voice-context-record";
import { transcriptTokenHash } from "@/lib/ops/voice-history";
import { supabaseRequest, supabaseRpc, SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";
const webhook = "https://fuajob.online/webhook/ops-placetel-dial-v1";
const headers = { "cache-control": "no-store" };

function result(callId: string, state: unknown) {
  if (state === "rejected") throw new QuoteValidationError("Placetel hat den Anruf abgelehnt. Bitte prüfe deinen Anschluss.", ["placetel_rejected"], 409);
  return NextResponse.json({ ok: true, callId, state: state === "accepted" ? "accepted" : "pending" }, { headers });
}

export async function POST(request: NextRequest) {
  const denied = await authorizeVoiceCopilotApi(request);
  if (denied) return denied;
  try {
    if (!phoneRequestIsSameOrigin(request.headers.get("origin"), request.headers.get("x-forwarded-host") || request.headers.get("host"), request.headers.get("sec-fetch-site"), process.env.NODE_ENV === "production")) {
      throw new QuoteValidationError("Diese Telefonaktion ist nicht erlaubt.", ["invalid_phone_origin"], 403);
    }
    const input = await readVoiceCopilotJson(request);
    if (input?.recordingConsent !== true) throw new QuoteValidationError("Bitte bestätige zuerst die Einwilligung zur Gesprächsaufzeichnung.", ["placetel_consent_required"], 422);
    const key = requireVoiceUuid(input.requestKey, "Anrufkennung");
    const customerId = requireVoiceUuid(input.customerId, "Kunde");
    if (typeof input.requestId !== "string" || !input.requestId.trim()) throw new QuoteValidationError("Wähle einen Kundenvorgang aus.", ["placetel_request_required"], 422);
    const current = await currentPhoneDevice();
    if (!current) throw new QuoteValidationError("Melde dein Gerät im persönlichen Telefonprofil an.", ["phone_identity_required"], 403);
    const record = await loadVoiceContextRecord(input.requestId, customerId);
    const raw = (record.phone || "").trim().replace(/^(?:\+|00)49\s*\(0\)/, "+49");
    const phone = normalizePhoneE164(raw.startsWith("0") && !raw.startsWith("00") ? "+49" + raw.slice(1) : raw);
    const tokenHash = transcriptTokenHash(randomBytes(32).toString("hex"));
    let callId: string;
    try {
      callId = await createVoiceCallSession({
        context: { requestId: record.requestId, offer: null },
        knowledgeMatches: [], operatorName: current.staff.display_name, mode: "follow_up", interactionMode: "live_copilot",
        consentStatus: "confirmed", transcriptWriteTokenHash: tokenHash,
        consentEvidence: { method: "operator_attestation", confirmedBy: current.staff.id, wordingVersion: "placetel-recording-v1", confirmedAt: new Date().toISOString() },
        placetel: { requestKey: key, staffId: current.staff.id, phone, customerId },
      });
    } catch (error) {
      if (!(error instanceof SupabaseRestError) || error.status !== 409) throw error;
      const [existing] = await supabaseRequest<Array<{ id: string; bound_request_id: string; context_snapshot: { placetel_staff_id: string; placetel_customer_id: string } }>>("voice_call_sessions", {}, { select: "id,bound_request_id,context_snapshot", idempotency_key: "eq.placetel:" + key, limit: 1 });
      if (!existing || existing.bound_request_id !== record.requestId || existing.context_snapshot?.placetel_staff_id !== current.staff.id || existing.context_snapshot?.placetel_customer_id !== customerId) throw new QuoteValidationError("Die Anrufkennung gehört zu einem anderen Vorgang.", ["placetel_key_conflict"], 409);
      const [row] = await supabaseRequest<Array<{dispatch_status: string}>>("voice_placetel_calls", {}, { select: "dispatch_status", session_id: "eq." + existing.id, limit: 1 });
      return result(existing.id, row?.dispatch_status);
    }
    const booking = await supabaseRpc<{dispatch: boolean; dispatch_key?: string; status?: string}>("reserve_voice_placetel_dial", {
      p_session_id: callId, p_token_hash: tokenHash, p_phone: phone, p_staff_id: current.staff.id,
    });
    if (!booking.dispatch || !booking.dispatch_key) return result(callId, booking.status);
    // Only the server-created, short-lived one-use key leaves OPS. A timeout must never cause a second dial.
    try {
      const response = await fetch(webhook, { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ dispatchKey: booking.dispatch_key }), signal: AbortSignal.timeout(25000), cache: "no-store", redirect: "error" });
      if (!response.ok) console.error("Placetel dispatch response unavailable", { callId, status: response.status });
    } catch { console.error("Placetel dispatch acknowledgement unavailable", { callId }); }
    const [row] = await supabaseRequest<Array<{dispatch_status: string}>>("voice_placetel_calls", {}, { select: "dispatch_status", session_id: "eq." + callId, limit: 1 });
    return result(callId, row?.dispatch_status);
  } catch (error) {
    return voiceCopilotApiFailure(error, "placetel_dial");
  }
}
