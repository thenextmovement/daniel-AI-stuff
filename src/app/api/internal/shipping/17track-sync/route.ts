import { NextRequest, NextResponse } from "next/server";
import { claimAndSyncOutbound17TrackShipments, isInternalRequestAuthorized } from "@/lib/ops/seventeen-track";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isInternalRequestAuthorized(request.headers)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { limit?: number };
  const limit = Number.isFinite(Number(body.limit)) ? Math.max(1, Math.min(Number(body.limit), 50)) : 20;
  try {
    const result = await claimAndSyncOutbound17TrackShipments(limit);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("outbound 17track sync route failed", error);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
