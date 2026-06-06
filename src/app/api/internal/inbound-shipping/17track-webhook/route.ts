import { NextRequest, NextResponse } from "next/server";
import {
  buildInboundCarrierPayloadFrom17Track,
  fetch17TrackInfo,
  is17TrackWebhookAuthorized,
  readBoundedWebhookBody,
  record17TrackInboundPayload,
  record17TrackTrackingError,
} from "@/lib/ops/seventeen-track";

export const dynamic = "force-dynamic";

function parseWebhookPayload(rawBody: string) {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }
}

function numericCarrier(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function trackingNumberFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const data = "data" in payload ? (payload as { data?: unknown }).data : payload;
  if (!data || typeof data !== "object") return null;
  return String((data as { number?: unknown }).number || "").trim() || null;
}

function carrierFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const data = "data" in payload ? (payload as { data?: unknown }).data : payload;
  if (!data || typeof data !== "object") return null;
  return numericCarrier((data as { carrier?: unknown }).carrier);
}

function shipmentIdFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const data = "data" in payload ? (payload as { data?: unknown }).data : payload;
  if (!data || typeof data !== "object") return null;
  const tag = String((data as { tag?: unknown }).tag || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tag) ? tag : null;
}

export async function POST(request: NextRequest) {
  if (!is17TrackWebhookAuthorized(request.headers, request.nextUrl)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let rawBody = "";
  try {
    rawBody = await readBoundedWebhookBody(request);
  } catch {
    return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  }

  const payload = parseWebhookPayload(rawBody);
  if (!payload) return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });

  try {
    const originalShipmentId = shipmentIdFromPayload(payload);
    let carrierPayload = buildInboundCarrierPayloadFrom17Track(payload);
    if (!carrierPayload?.events.length) {
      const number = trackingNumberFromPayload(payload);
      if (!number) return NextResponse.json({ ok: false, error: "missing_tracking_number" }, { status: 400 });
      const snapshot = await fetch17TrackInfo(number, carrierFromPayload(payload));
      carrierPayload = buildInboundCarrierPayloadFrom17Track(snapshot);
      if (carrierPayload && originalShipmentId && !carrierPayload.shipmentId) {
        carrierPayload = { ...carrierPayload, shipmentId: originalShipmentId };
      }
      if (!carrierPayload?.events.length) {
        if (originalShipmentId) {
          await record17TrackTrackingError({
            shipmentId: originalShipmentId,
            trackingNumber: number,
            detail: "17TRACK Webhook enthielt keine Tracking-Events und gettrackinfo lieferte keine verwertbaren Events.",
            rawResponse: snapshot,
          });
        }
        return NextResponse.json({ ok: true, recorded: false, reason: "no_events" });
      }
    }

    await record17TrackInboundPayload(carrierPayload);
    return NextResponse.json({ ok: true, recorded: true, eventCount: carrierPayload.events.length });
  } catch (error) {
    console.error("17track webhook route failed", error);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
