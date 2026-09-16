import { NextRequest, NextResponse } from "next/server";
import {
  authorizeVoiceRuntimeApi,
  readVoiceRuntimeJson,
  voiceRuntimeApiFailure,
} from "@/lib/ops/voice-runtime-api";
import { saveRuntimeTranscript } from "@/lib/ops/voice-runtime-transcripts";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const error = authorizeVoiceRuntimeApi(request);
  if (error) return error;
  try {
    return NextResponse.json(
      await saveRuntimeTranscript(await readVoiceRuntimeJson(request)),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return voiceRuntimeApiFailure(error, "transcript");
  }
}
