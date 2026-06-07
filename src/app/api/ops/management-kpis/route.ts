import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { getManagementKpiDashboard, type ManagementKpiInput } from "@/lib/ops/management-kpis";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function notConfigured() {
  return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
}

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

function failureResponse(error: unknown) {
  if (error instanceof SupabaseRestError) {
    return NextResponse.json({ ok: false, error: error.message, details: error.details }, { status: error.status });
  }
  console.error("ops management kpis route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

function kpiInputFromUrl(request: NextRequest): ManagementKpiInput {
  const params = request.nextUrl.searchParams;
  return {
    range: params.get("range"),
    from: params.get("from"),
    to: params.get("to"),
    query: params.get("query"),
    source: params.get("source"),
    segment: params.get("segment"),
    country: params.get("country"),
    customerType: params.get("customerType"),
  };
}

export async function GET(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return notConfigured();
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return unauthorized();

  try {
    const dashboard = await getManagementKpiDashboard(kpiInputFromUrl(request));
    return NextResponse.json({ ok: true, dashboard });
  } catch (error) {
    return failureResponse(error);
  }
}
