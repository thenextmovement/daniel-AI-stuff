import { NextRequest, NextResponse } from "next/server";
import { isInternalRequestAuthorized } from "@/lib/ops/seventeen-track";
import { prepareInstallationMail } from "@/lib/ops/shipping-installation-documents";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/** Preparation only. This endpoint never claims a notification, creates a draft or sends mail. */
export async function POST(request: NextRequest) {
  if (!isInternalRequestAuthorized(request.headers)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers });
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 1_000_000) return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413, headers });
  let body: { order?: unknown; fulfillmentId?: unknown } | null;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400, headers }); }
  if (!body || typeof body.fulfillmentId !== "string" || !/^\d+$/.test(body.fulfillmentId) || !body.order || typeof body.order !== "object") {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400, headers });
  }
  try {
    const result = await prepareInstallationMail(body.order, body.fulfillmentId);
    return NextResponse.json({ ok: true, ...result }, { headers });
  } catch {
    // Do not log customer payloads or base64 attachments. Missing/changed files must block preparation.
    return NextResponse.json({ ok: false, error: "document_preparation_failed" }, { status: 422, headers });
  }
}
