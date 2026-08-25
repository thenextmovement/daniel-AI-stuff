import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { getDunningCaseDetail, normalizeDunningOrderNumber } from "@/lib/ops/dunning";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ orderKey: string }> }) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!isOpsPortalConfigured(host)) return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { orderKey } = await params;
  if (!normalizeDunningOrderNumber(orderKey)) return NextResponse.json({ ok: false, error: "invalid_order_key" }, { status: 400 });
  try {
    const detail = await getDunningCaseDetail(orderKey);
    if (!detail) return NextResponse.json({ ok: false, error: "dunning_case_not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, detail });
  } catch (error) {
    console.error("dunning detail failed", { orderKey, message: error instanceof Error ? error.message : error });
    return NextResponse.json({ ok: false, error: "dunning_detail_failed" }, { status: 500 });
  }
}
