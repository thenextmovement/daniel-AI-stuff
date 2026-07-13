import { NextRequest, NextResponse } from "next/server";
import { listRecoverableVoiceRuntimeSessions } from "@/lib/ops/voice-platform-data";
import { authorizeVoiceRuntimeApi, voiceRuntimeApiFailure } from "@/lib/ops/voice-runtime-api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = authorizeVoiceRuntimeApi(request);
  if (authError) return authError;
  try {
    const workerId = new URL(request.url).searchParams.get("workerId");
    return NextResponse.json({ ok: true, sessions: await listRecoverableVoiceRuntimeSessions(workerId) });
  } catch (error) {
    return voiceRuntimeApiFailure(error, "recover");
  }
}
