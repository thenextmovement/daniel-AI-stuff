import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured, resolveOpsRequestActor } from "@/lib/ops/auth";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

export async function authorizeVoiceCopilotApi(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) {
    return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
  }
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function resolveVoiceCopilotActor(request: NextRequest) {
  return resolveOpsRequestActor(getOpsHost(request), request.headers);
}

export async function readVoiceCopilotJson(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > 64_000) {
    throw new QuoteValidationError("Voice-Copilot-Payload ist zu gross.", ["payload_too_large"], 413);
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 64_000) {
    throw new QuoteValidationError("Voice-Copilot-Payload ist zu gross.", ["payload_too_large"], 413);
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new QuoteValidationError("Voice-Copilot-Payload ist kein gueltiges JSON.", ["invalid_json"], 400);
  }
}

export function voiceCopilotApiFailure(error: unknown, operation: string) {
  if (error instanceof QuoteValidationError) {
    return NextResponse.json({ ok: false, error: error.message, issues: error.issues }, { status: error.status });
  }
  if (error instanceof SupabaseRestError) {
    console.error(`voice copilot ${operation} data request failed`, { status: error.status });
    return NextResponse.json({ ok: false, error: "voice_data_unavailable" }, { status: 502 });
  }
  console.error(`voice copilot ${operation} failed`, error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}
