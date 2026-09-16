import { NextRequest, NextResponse } from "next/server";
import { authorizeVoiceCopilotApi, readVoiceCopilotJson, voiceCopilotApiFailure } from "@/lib/ops/voice-copilot-api";
import { isVoiceKnowledgeEnabled, updateVoiceCallSessionStatus } from "@/lib/ops/voice-knowledge";
import { persistVoiceTranscript } from "@/lib/ops/voice-history";
import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import { requireVoiceUuid } from "@/lib/ops/voice-platform-contract";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authError = await authorizeVoiceCopilotApi(request);
  if (authError) return authError;
  if (!isVoiceKnowledgeEnabled()) return NextResponse.json({ ok: true, skipped: true });
  try {
    const body = await readVoiceCopilotJson(request);
    const status = String(body.status || "");
    if (status !== "completed" && status !== "cancelled") {
      throw new QuoteValidationError("Sessionstatus ist ungueltig.", ["invalid_session_status"], 422);
    }
    const id = requireVoiceUuid(body.sessionId, "Session-ID");
    const rows = await supabaseRequest<Array<{ transcript_storage_enabled: boolean }>>("voice_call_sessions", undefined, { select: "transcript_storage_enabled", id: "eq." + id, limit: 1 });
    if (rows[0]?.transcript_storage_enabled) {
      await persistVoiceTranscript({ sessionId: id, token: request.headers.get("x-voice-session-token"), segments: [], finish: status === "completed" ? "complete" : "interrupted" });
    }
    await updateVoiceCallSessionStatus(id, status);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return voiceCopilotApiFailure(error, "session-update");
  }
}
