import { NextRequest, NextResponse } from "next/server";
import { isInternalRequestAuthorized } from "@/lib/ops/seventeen-track";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isInternalRequestAuthorized(request.headers)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Retired by the owner on 2026-11-03. Acknowledge without claims, provider calls or writes.
  return NextResponse.json({ ok: true, disabled: true, reason: "provider_retired", claimed: 0, recorded: false });
}
