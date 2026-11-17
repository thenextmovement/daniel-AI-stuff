import { NextRequest, NextResponse } from "next/server";
import { authorizeVoiceCopilotApi, voiceCopilotApiFailure } from "@/lib/ops/voice-copilot-api";
import { currentPhoneDevice } from "@/lib/ops/voice-phone-identity";
import { requireVoiceUuid } from "@/lib/ops/voice-platform-contract";
import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await authorizeVoiceCopilotApi(request);
  if (denied) return denied;
  try {
    const callId = requireVoiceUuid(request.nextUrl.searchParams.get("callId"), "Anrufkennung");
    const current = await currentPhoneDevice();
    if (!current) throw new QuoteValidationError("Bitte melde dein Telefon an.", ["phone_identity_required"], 403);
    const [call] = await supabaseRequest<Array<{provider_ended_at: string | null; provider_checked_at: string | null; dispatch_key: string; dialed_at: string | null}>>("voice_placetel_calls", {}, {
      select: "provider_ended_at,provider_checked_at,dispatch_key,dialed_at", session_id: "eq."+callId, staff_id: "eq."+current.staff.id, limit: 1,
    });
    if (!call) throw new QuoteValidationError("Anruf nicht gefunden.", ["placetel_call_missing"], 404);
    const now = Date.now();
    if (!call.provider_ended_at && call.dialed_at && now - Date.parse(call.dialed_at) < 86400000 &&
        (!call.provider_checked_at || now - Date.parse(call.provider_checked_at) >= 4000)) {
      // The webhook only acknowledges receipt. Only an authenticated provider record can set the end time.
      const response = await fetch("https://fuajob.online/webhook/ops-placetel-call-end-v1", {
        method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({key:call.dispatch_key}),
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error("placetel_status_check_unavailable");
    }
    return NextResponse.json({endedAt:call.provider_ended_at}, {headers:{"cache-control":"no-store"}});
  } catch (error) {
    return voiceCopilotApiFailure(error, "placetel_status");
  }
}
