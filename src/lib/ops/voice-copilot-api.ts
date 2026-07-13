import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
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
