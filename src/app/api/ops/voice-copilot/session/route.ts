import { NextRequest, NextResponse } from "next/server";
import { authorizeVoiceCopilotApi, voiceCopilotApiFailure } from "@/lib/ops/voice-copilot-api";
import { isVoiceKnowledgeEnabled, updateVoiceCallSessionStatus } from "@/lib/ops/voice-knowledge";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authError = await authorizeVoiceCopilotApi(request);
  if (authError) return authError;
  if (!isVoiceKnowledgeEnabled()) return NextResponse.json({ ok: true, skipped: true });
  try {
    const body = await request.json() as { sessionId?: unknown; status?: unknown };
    const status = String(body.status || "");
    if (status !== "completed" && status !== "cancelled") {
      throw new QuoteValidationError("Sessionstatus ist ungueltig.", ["invalid_session_status"], 422);
    }
    await updateVoiceCallSessionStatus(body.sessionId, status);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return voiceCopilotApiFailure(error, "session-update");
  }
}
