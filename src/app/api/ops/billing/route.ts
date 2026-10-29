import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { listBillingCasesPage } from "@/lib/ops/billing/repository";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!isOpsPortalConfigured(host)) return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const result = await listBillingCasesPage({
      status: request.nextUrl.searchParams.get("status"),
      query: request.nextUrl.searchParams.get("query"),
      limit: request.nextUrl.searchParams.has("limit") ? Number(request.nextUrl.searchParams.get("limit")) : undefined,
      offset: request.nextUrl.searchParams.has("offset") ? Number(request.nextUrl.searchParams.get("offset")) : undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof QuoteValidationError) return NextResponse.json({ ok: false, error: error.message, issues: error.issues }, { status: error.status });
    console.error("billing list failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "billing_list_failed" }, { status: 500 });
  }
}
