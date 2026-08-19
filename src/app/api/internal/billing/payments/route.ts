import { NextRequest, NextResponse } from "next/server";
import { isBillingWorkerAuthorized } from "@/lib/ops/billing/internal-auth";
import { ingestBillingPayment } from "@/lib/ops/billing/repository";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isBillingWorkerAuthorized(request.headers)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const amountCents = Number(body?.amountCents);
  const bookedAt = String(body?.bookedAt || "");
  const input = {
    shopifyOrderId: String(body?.shopifyOrderId || "").trim(), provider: String(body?.provider || "").trim().slice(0, 80),
    providerTransactionId: String(body?.providerTransactionId || "").trim().slice(0, 200), amountCents,
    currency: String(body?.currency || "").trim().toUpperCase(), bookedAt,
    sourceEventId: String(body?.sourceEventId || "").trim().slice(0, 200),
    evidence: body?.evidence && typeof body.evidence === "object" && !Array.isArray(body.evidence) ? body.evidence as Record<string, unknown> : {},
  };
  if (!input.shopifyOrderId || !input.provider || !input.providerTransactionId || !Number.isSafeInteger(amountCents) || amountCents <= 0 || !/^[A-Z]{3}$/.test(input.currency) || !Number.isFinite(Date.parse(bookedAt)) || input.sourceEventId.length < 8) return NextResponse.json({ ok: false, error: "invalid_payment" }, { status: 422 });
  try {
    return NextResponse.json({ ok: true, payment: await ingestBillingPayment(input) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "billing_payment_failed";
    const expected = message.includes("BILLING_");
    console.error("billing payment intake failed", { orderId: input.shopifyOrderId, eventId: input.sourceEventId, message });
    return NextResponse.json({ ok: false, error: expected ? message : "billing_payment_failed" }, { status: expected ? 409 : 500 });
  }
}
