import { NextRequest, NextResponse } from "next/server";
import { isBillingWorkerAuthorized } from "@/lib/ops/billing/internal-auth";
import { ingestBillingShopifyEvent } from "@/lib/ops/billing/repository";

export const dynamic = "force-dynamic";
const EVENT_TYPES = new Set(["ORDER_DELIVERED", "ORDER_CANCELLED", "REFUND_CREATED"]);

export async function POST(request: NextRequest) {
  if (!isBillingWorkerAuthorized(request.headers)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const eventType = String(body?.eventType || "") as "ORDER_DELIVERED" | "ORDER_CANCELLED" | "REFUND_CREATED";
  const integer = (value: unknown) => Number.isSafeInteger(Number(value)) ? Number(value) : NaN;
  const input = {
    shopifyOrderId: String(body?.shopifyOrderId || "").trim(), eventId: String(body?.eventId || "").trim().slice(0, 200), eventType,
    amountCents: integer(body?.amountCents || 0), netCents: integer(body?.netCents || 0), vatCents: integer(body?.vatCents || 0),
    currency: String(body?.currency || "EUR").trim().toUpperCase(), occurredAt: String(body?.occurredAt || new Date().toISOString()),
    payload: body?.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload as Record<string, unknown> : {},
  };
  if (!input.shopifyOrderId || input.eventId.length < 8 || !EVENT_TYPES.has(eventType) || ![input.amountCents,input.netCents,input.vatCents].every(Number.isSafeInteger) || !/^[A-Z]{3}$/.test(input.currency) || !Number.isFinite(Date.parse(input.occurredAt))) return NextResponse.json({ ok: false, error: "invalid_shopify_event" }, { status: 422 });
  try {
    return NextResponse.json({ ok: true, event: await ingestBillingShopifyEvent(input) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "billing_shopify_event_failed";
    const expected = message.includes("BILLING_");
    console.error("billing Shopify event intake failed", { orderId: input.shopifyOrderId, eventId: input.eventId, eventType, message });
    return NextResponse.json({ ok: false, error: expected ? message : "billing_shopify_event_failed" }, { status: expected ? 409 : 500 });
  }
}
