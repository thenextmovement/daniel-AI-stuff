import { NextRequest, NextResponse } from "next/server";
import { authorizeVoiceCopilotApi, voiceCopilotApiFailure } from "@/lib/ops/voice-copilot-api";
import { isVoiceKnowledgeEnabled, reviewVoiceKnowledgeVersion } from "@/lib/ops/voice-knowledge";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authError = await authorizeVoiceCopilotApi(request);
  if (authError) return authError;
  if (!isVoiceKnowledgeEnabled()) {
    return NextResponse.json({ ok: false, error: "voice_knowledge_not_enabled" }, { status: 503 });
  }
  try {
    const result = await reviewVoiceKnowledgeVersion(await request.json());
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return voiceCopilotApiFailure(error, "knowledge-review");
  }
}
