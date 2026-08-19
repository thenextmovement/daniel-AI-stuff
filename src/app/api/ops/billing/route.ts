import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { listBillingCases } from "@/lib/ops/billing/repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!isOpsPortalConfigured(host)) return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const cases = await listBillingCases({
      status: request.nextUrl.searchParams.get("status"),
      query: request.nextUrl.searchParams.get("query"),
      limit: Number(request.nextUrl.searchParams.get("limit") || 80),
    });
    return NextResponse.json({ ok: true, cases });
  } catch (error) {
    console.error("billing list failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "billing_list_failed" }, { status: 500 });
  }
}
