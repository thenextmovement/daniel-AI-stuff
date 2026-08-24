import { NextRequest, NextResponse } from "next/server";
import { verifyBillingWebhook } from "@/lib/ops/billing/auth";
import { billingWorkerEventId } from "@/lib/ops/billing/internal-auth";
import { ingestBillingCase } from "@/lib/ops/billing/repository";
import type { BillingIntake } from "@/lib/ops/billing/domain";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  const body = await request.text();
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  let parsed: BillingIntake;
  try {
    parsed = JSON.parse(body) as BillingIntake;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const workerEventId = billingWorkerEventId(request.headers, parsed.sourceEventId);
  const webhookAuth = workerEventId ? null : verifyBillingWebhook({ body, headers: request.headers });
  if (!workerEventId && webhookAuth && !webhookAuth.ok) {
    return NextResponse.json({ ok: false, error: webhookAuth.code }, { status: webhookAuth.status });
  }
  const eventId = workerEventId || (webhookAuth && webhookAuth.ok ? webhookAuth.eventId : "");
  try {
    const result = await ingestBillingCase({ ...parsed, sourceEventId: eventId });
    return NextResponse.json({ ok: true, billingCase: result }, { status: result.created ? 201 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "billing_intake_failed";
    console.error("billing intake failed", { eventId, message });
    const status = /fehlt|ungültig|stimmen nicht|entsprechen|enthält/.test(message) ? 422 : 500;
    return NextResponse.json({ ok: false, error: status === 422 ? message : "billing_intake_failed", requestId: eventId }, { status });
  }
}
