import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { getBillingCase, listBillingCaseRecords } from "@/lib/ops/billing/repository";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!isOpsPortalConfigured(host)) return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { caseId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(caseId)) return NextResponse.json({ ok: false, error: "invalid_case_id" }, { status: 400 });
  try {
    if (request.nextUrl.searchParams.has("collection")) {
      for (const name of request.nextUrl.searchParams.keys()) {
        if (!["collection", "limit", "offset"].includes(name)) {
          throw new QuoteValidationError("Unbekannter Billing-Sammlungsparameter.", ["invalid_collection_parameter"], 422);
        }
      }
      const records = await listBillingCaseRecords(caseId, {
        collection: request.nextUrl.searchParams.get("collection") || "",
        limit: request.nextUrl.searchParams.has("limit") ? Number(request.nextUrl.searchParams.get("limit")) : undefined,
        offset: request.nextUrl.searchParams.has("offset") ? Number(request.nextUrl.searchParams.get("offset")) : undefined,
      });
      if (!records) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
      return NextResponse.json({ ok: true, ...records });
    }
    const billingCase = await getBillingCase(caseId, {
      eventLimit: request.nextUrl.searchParams.has("eventLimit") ? Number(request.nextUrl.searchParams.get("eventLimit")) : undefined,
      eventOffset: request.nextUrl.searchParams.has("eventOffset") ? Number(request.nextUrl.searchParams.get("eventOffset")) : undefined,
    });
    if (!billingCase) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, ...billingCase });
  } catch (error) {
    if (error instanceof QuoteValidationError) return NextResponse.json({ ok: false, error: error.message, issues: error.issues }, { status: error.status });
    console.error("billing detail failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "billing_detail_failed" }, { status: 500 });
  }
}
