import { NextRequest, NextResponse } from "next/server";
import { isInternalRequestAuthorized } from "@/lib/ops/seventeen-track";
import { prepareInstallationMail } from "@/lib/ops/shipping-installation-documents";

import { reserveInstallationDelivery, checkpointInstallationDelivery } from "@/lib/ops/shipping-installation-delivery";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/** Graph calls remain in the existing n8n shipping workflow. This route validates and records their handoffs. */
export async function POST(request: NextRequest) {
  if (!isInternalRequestAuthorized(request.headers)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers });
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 5_000_000) return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413, headers });
  let body: Record<string, any> | null;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400, headers }); }
  if (body && ["authorize", "complete"].includes(body.action)) {
    try {
      return NextResponse.json({ ok: true, ...await checkpointInstallationDelivery(body, body.action === "complete") }, { headers });
    } catch { return NextResponse.json({ ok: false, error: "installation_checkpoint_failed_no_retry" }, { status: 422, headers }); }
  }
  if (Buffer.byteLength(raw) > 1_000_000) return NextResponse.json({ ok: false, error: "order_payload_too_large" }, { status: 413, headers });
  if (body?.action && !["prepare", "reserve"].includes(body.action)) return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 400, headers });
  if (!body || typeof body.fulfillmentId !== "string" || !/^\d+$/.test(body.fulfillmentId) || !body.order || typeof body.order !== "object") {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400, headers });
  }
  try {
    const result = body.action === "reserve" ? await reserveInstallationDelivery(body) : await prepareInstallationMail(body.order, body.fulfillmentId);
    return NextResponse.json({ ok: true, ...result }, { headers });
  } catch {
    // Do not log customer payloads or base64 attachments. Missing/changed files must block preparation.
    return NextResponse.json({ ok: false, error: "document_preparation_failed" }, { status: 422, headers });
  }
}
