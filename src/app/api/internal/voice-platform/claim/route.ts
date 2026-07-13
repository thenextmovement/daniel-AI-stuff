import { NextRequest, NextResponse } from "next/server";
import { claimNextVoiceRuntimeSession } from "@/lib/ops/voice-platform-data";
import { authorizeVoiceRuntimeApi, readVoiceRuntimeJson, voiceRuntimeApiFailure } from "@/lib/ops/voice-runtime-api";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authError = authorizeVoiceRuntimeApi(request);
  if (authError) return authError;
  try {
    const body = await readVoiceRuntimeJson(request);
    const session = await claimNextVoiceRuntimeSession(body.workerId);
    return session
      ? NextResponse.json({ ok: true, claimed: true, session })
      : NextResponse.json({ ok: true, claimed: false });
  } catch (error) {
    return voiceRuntimeApiFailure(error, "claim");
  }
}
