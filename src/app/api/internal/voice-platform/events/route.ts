import { NextRequest, NextResponse } from "next/server";
import { recordVoiceCallEvent } from "@/lib/ops/voice-platform-data";
import { authorizeVoiceRuntimeApi, readVoiceRuntimeJson, voiceRuntimeApiFailure } from "@/lib/ops/voice-runtime-api";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authError = authorizeVoiceRuntimeApi(request);
  if (authError) return authError;
  try {
    const body = await readVoiceRuntimeJson(request);
    const result = await recordVoiceCallEvent({
      attemptId: body.attemptId,
      source: body.source,
      eventType: body.eventType,
      idempotencyKey: body.idempotencyKey,
      providerEventId: body.providerEventId,
      payload: body.payload,
      occurredAt: body.occurredAt,
    });
    return NextResponse.json({ ok: true, result: result[0] || null });
  } catch (error) {
    return voiceRuntimeApiFailure(error, "event");
  }
}
