import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { getOfferById, OpsOfferApiError } from "@/lib/ops/offers";

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
  if (error instanceof OpsOfferApiError) {
    return NextResponse.json({ ok: false, error: error.message, issues: error.issues, code: error.code }, { status: error.status });
  }

  console.error("ops design offer route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ offerId: string }> },
) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return notConfigured();
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return unauthorized();

  try {
    const { offerId } = await params;
    const offer = await getOfferById(decodeURIComponent(offerId));
    return NextResponse.json({ ok: true, offer });
  } catch (error) {
    return failureResponse(error);
  }
}
