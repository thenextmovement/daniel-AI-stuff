import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";

export const dynamic = "force-dynamic";

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

function offersBaseUrl() {
  return String(process.env.NEONTRIP_OFFERS_BASE_URL || "").trim().replace(/\/+$/, "");
}

async function authorize(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 }) };
  }
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }) };
  }
  return { ok: true as const };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ offerId: string }> }) {
  const authorized = await authorize(request);
  if (!authorized.ok) return authorized.response;

  const baseUrl = offersBaseUrl();
  if (!baseUrl) {
    return NextResponse.json({ ok: false, error: "NEONTRIP_OFFERS_BASE_URL fehlt." }, { status: 503 });
  }

  const { offerId } = await params;
  const target = new URL(`/admin/offers/${encodeURIComponent(decodeURIComponent(offerId))}`, baseUrl);
  return NextResponse.redirect(target);
}
