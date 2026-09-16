import { NextRequest, NextResponse } from "next/server";
import {
  authorizeVoiceCopilotApi,
  readVoiceCopilotJson,
  voiceCopilotApiFailure,
} from "@/lib/ops/voice-copilot-api";
import {
  getVoiceTranscript,
  listVoiceHistory,
  persistVoiceTranscript,
} from "@/lib/ops/voice-history";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const denied = await authorizeVoiceCopilotApi(request);
  if (denied) return denied;
  try {
    const body = await readVoiceCopilotJson(request);
    const result = await persistVoiceTranscript({
      sessionId: body.sessionId,
      token: request.headers.get("x-voice-session-token"),
      segments: body.segments,
      finish: body.finish,
    });
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return voiceCopilotApiFailure(error, "transcript-write");
  }
}
export async function GET(request: NextRequest) {
  const denied = await authorizeVoiceCopilotApi(request);
  if (denied) return denied;
  try {
    const offset = Number(request.nextUrl.searchParams.get("offset") || 0),
      sessionId = request.nextUrl.searchParams.get("sessionId");
    const result = sessionId
      ? await getVoiceTranscript(sessionId, offset)
      : await listVoiceHistory(
          request.nextUrl.searchParams.get("requestId"),
          offset,
        );
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return voiceCopilotApiFailure(error, "transcript-read");
  }
}
