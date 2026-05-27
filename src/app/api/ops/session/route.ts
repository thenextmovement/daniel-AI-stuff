import { NextRequest, NextResponse } from "next/server";
import {
  applyOpsSession,
  clearOpsSession,
  hasOpsSession,
  isOpsPortalBypassed,
  isOpsPortalConfigured,
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

  if (await hasOpsSession(host, request.headers)) {
    return NextResponse.json({ ok: true, cloudflareAccess: true });
  }

  const body = (await request.json().catch(() => null)) as { token?: string } | null;
  if (!body?.token || !validateOpsPortalToken(body.token)) {
    return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 401 });
  }

  return applyOpsSession(NextResponse.json({ ok: true }));
}

export async function DELETE() {
  return clearOpsSession(NextResponse.json({ ok: true }));
}
