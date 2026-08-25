import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { listDunningDashboard } from "@/lib/ops/dunning";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!isOpsPortalConfigured(host)) return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const dashboard = await listDunningDashboard();
    return NextResponse.json({ ok: true, dashboard });
  } catch (error) {
    console.error("dunning dashboard failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "dunning_dashboard_failed" }, { status: 500 });
  }
}
