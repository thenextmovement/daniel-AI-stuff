import { NextRequest, NextResponse } from "next/server";
import { authorizeVoiceCopilotApi, resolveVoiceCopilotActor, voiceCopilotApiFailure } from "@/lib/ops/voice-copilot-api";
import { isVoiceKnowledgeEnabled, reviewEmailSupportKnowledge } from "@/lib/ops/voice-knowledge";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authError = await authorizeVoiceCopilotApi(request);
  if (authError) return authError;
  if (!isVoiceKnowledgeEnabled()) {
    return NextResponse.json({ ok: false, error: "voice_knowledge_not_enabled" }, { status: 503 });
  }
  try {
    const input = (await request.json()) as Record<string, unknown>;
    const authenticatedActor = (await resolveVoiceCopilotActor(request)) || "ops-session";
    const operatorName = String(input.reviewer || "").trim().slice(0, 120);
    if (operatorName.length < 2) {
      return NextResponse.json({ ok: false, error: "reviewer_identity_required" }, { status: 400 });
    }
    const result = await reviewEmailSupportKnowledge({
      ...input,
      reviewer: `${authenticatedActor}:${operatorName}`.slice(0, 120),
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return voiceCopilotApiFailure(error, "email-knowledge-review");
  }
}
