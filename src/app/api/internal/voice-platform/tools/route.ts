import { NextRequest, NextResponse } from "next/server";
import { executeVoiceTool } from "@/lib/ops/voice-platform-data";
import { authorizeVoiceRuntimeApi, readVoiceRuntimeJson, voiceRuntimeApiFailure } from "@/lib/ops/voice-runtime-api";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authError = authorizeVoiceRuntimeApi(request);
  if (authError) return authError;
  try {
    const body = await readVoiceRuntimeJson(request);
    const result = await executeVoiceTool({
      attemptId: body.attemptId,
      toolCallId: body.toolCallId,
      toolName: body.toolName,
      argumentsValue: body.arguments,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return voiceRuntimeApiFailure(error, "tool");
  }
}
