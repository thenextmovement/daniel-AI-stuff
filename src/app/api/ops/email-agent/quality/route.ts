import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { getEmailAgentRolloutGate } from "@/lib/ops/email-agent-quality";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";

export const dynamic = "force-dynamic";

function getHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

async function hasAccess(request: NextRequest) {
  const host = getHost(request);
  if (!isOpsPortalConfigured(host)) return { ok: false as const, status: 503, error: "ops_not_configured" };
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) {
    return { ok: false as const, status: 401, error: "unauthorized" };
  }
  return { ok: true as const };
}

export async function GET(request: NextRequest) {
  const access = await hasAccess(request);
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });

  try {
    const quality = await getEmailAgentRolloutGate();
    return NextResponse.json({ ok: true, quality });
  } catch (error) {
    if (error instanceof SupabaseRestError) {
      return NextResponse.json({ ok: false, error: error.message, details: error.details }, { status: error.status });
    }
    console.error("email agent quality route failed", error);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
