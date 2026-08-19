import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { getBillingCase } from "@/lib/ops/billing/repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!isOpsPortalConfigured(host)) return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { caseId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(caseId)) return NextResponse.json({ ok: false, error: "invalid_case_id" }, { status: 400 });
  try {
    const billingCase = await getBillingCase(caseId);
    if (!billingCase) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, ...billingCase });
  } catch (error) {
    console.error("billing detail failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "billing_detail_failed" }, { status: 500 });
  }
}
