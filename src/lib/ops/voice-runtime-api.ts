import { NextRequest, NextResponse } from "next/server";
import { authorizeVoiceRuntimeRequest } from "@/lib/ops/voice-runtime-auth";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export function authorizeVoiceRuntimeApi(request: NextRequest) {
  return authorizeVoiceRuntimeRequest(request);
}

export async function readVoiceRuntimeJson(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > 64_000) {
    throw new QuoteValidationError("Runtime-Payload ist zu gross.", ["payload_too_large"], 413);
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 64_000) {
    throw new QuoteValidationError("Runtime-Payload ist zu gross.", ["payload_too_large"], 413);
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new QuoteValidationError("Runtime-Payload ist kein gueltiges JSON.", ["invalid_json"], 400);
  }
}

export function voiceRuntimeApiFailure(error: unknown, operation: string) {
  if (error instanceof QuoteValidationError) {
    return NextResponse.json({ ok: false, error: error.message, issues: error.issues }, { status: error.status });
  }
  if (error instanceof SupabaseRestError) {
    console.error(`voice runtime ${operation} data request failed`, { status: error.status });
    return NextResponse.json({ ok: false, error: "voice_data_unavailable" }, { status: 502 });
  }
  console.error(`voice runtime ${operation} failed`, error instanceof Error ? error.message : "unknown error");
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}
