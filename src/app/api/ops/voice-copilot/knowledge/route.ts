import { NextRequest, NextResponse } from "next/server";
import { authorizeVoiceCopilotApi, voiceCopilotApiFailure } from "@/lib/ops/voice-copilot-api";
import { createVoiceKnowledgeDraft, isVoiceKnowledgeEnabled, listVoiceKnowledge } from "@/lib/ops/voice-knowledge";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = await authorizeVoiceCopilotApi(request);
  if (authError) return authError;
  if (!isVoiceKnowledgeEnabled()) {
    return NextResponse.json({ ok: true, enabled: false, entries: [] }, { headers: { "cache-control": "no-store" } });
  }
  try {
    const entries = await listVoiceKnowledge();
    return NextResponse.json({ ok: true, enabled: true, entries }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return voiceCopilotApiFailure(error, "knowledge-list");
  }
}

export async function POST(request: NextRequest) {
  const authError = await authorizeVoiceCopilotApi(request);
  if (authError) return authError;
  if (!isVoiceKnowledgeEnabled()) {
    return NextResponse.json({ ok: false, error: "voice_knowledge_not_enabled" }, { status: 503 });
  }
  try {
    const result = await createVoiceKnowledgeDraft(await request.json());
    return NextResponse.json({ ok: true, result }, { status: 201 });
  } catch (error) {
    return voiceCopilotApiFailure(error, "knowledge-create");
  }
}
