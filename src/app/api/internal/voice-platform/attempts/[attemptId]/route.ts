import { NextRequest, NextResponse } from "next/server";
import { getVoiceRuntimeSessionByAttempt, updateVoiceAttemptProvider } from "@/lib/ops/voice-platform-data";
import { authorizeVoiceRuntimeApi, readVoiceRuntimeJson, voiceRuntimeApiFailure } from "@/lib/ops/voice-runtime-api";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ attemptId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const authError = authorizeVoiceRuntimeApi(request);
  if (authError) return authError;
  try {
    const { attemptId } = await params;
    return NextResponse.json({ ok: true, session: await getVoiceRuntimeSessionByAttempt(attemptId) });
  } catch (error) {
    return voiceRuntimeApiFailure(error, "attempt-read");
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const authError = authorizeVoiceRuntimeApi(request);
  if (authError) return authError;
  try {
    const { attemptId } = await params;
    const body = await readVoiceRuntimeJson(request);
    const attempt = await updateVoiceAttemptProvider({ attemptId, ...body });
    return NextResponse.json({ ok: true, attempt });
  } catch (error) {
    return voiceRuntimeApiFailure(error, "attempt-update");
  }
}
