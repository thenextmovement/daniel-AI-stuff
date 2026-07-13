import { NextRequest, NextResponse } from "next/server";
import { authorizeVoiceCopilotApi, voiceCopilotApiFailure } from "@/lib/ops/voice-copilot-api";
import { getVoiceCustomerContext, searchVoiceCustomerContexts } from "@/lib/ops/voice-knowledge";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = await authorizeVoiceCopilotApi(request);
  if (authError) return authError;
  try {
    const requestId = request.nextUrl.searchParams.get("requestId");
    if (requestId) {
      const context = await getVoiceCustomerContext(requestId);
      return NextResponse.json({ ok: true, context }, { headers: { "cache-control": "no-store" } });
    }
    const results = await searchVoiceCustomerContexts(request.nextUrl.searchParams.get("query"));
    return NextResponse.json({ ok: true, results }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return voiceCopilotApiFailure(error, "context-read");
  }
}
