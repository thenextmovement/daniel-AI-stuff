import { NextRequest, NextResponse } from "next/server";
import {
  applyOpsSession,
  clearOpsSession,
  isOpsPortalBypassed,
  isOpsPortalConfigured,
  validateCloudflareAccess,
  validateOpsPortalToken,
} from "@/lib/ops/auth";

export const dynamic = "force-dynamic";

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

export async function POST(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) {
    return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
  }

  if (isOpsPortalBypassed(host)) {
    return NextResponse.json({ ok: true, bypassed: true });
  }

  const access = await validateCloudflareAccess(request.headers);
  if (access.ok) {
    return NextResponse.json({ ok: true, cloudflareAccess: true });
  }

  const body = (await request.json().catch(() => null)) as { token?: string; operatorName?: string } | null;
  if (!body?.token || !validateOpsPortalToken(body.token)) {
    return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 401 });
  }
  if (!body.operatorName || body.operatorName.trim().length < 2) {
    return NextResponse.json({ ok: false, error: "operator_required" }, { status: 422 });
  }

  return applyOpsSession(NextResponse.json({ ok: true }), body.token, body.operatorName);
}

export async function DELETE() {
  return clearOpsSession(NextResponse.json({ ok: true }));
}
