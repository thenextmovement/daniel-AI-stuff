import { NextRequest, NextResponse } from "next/server";
import { verifyBillingWebhook } from "@/lib/ops/billing/auth";
import { ingestBillingCase } from "@/lib/ops/billing/repository";
import type { BillingIntake } from "@/lib/ops/billing/domain";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  const body = await request.text();
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  const auth = verifyBillingWebhook({ body, headers: request.headers });
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.code }, { status: auth.status });
  let parsed: BillingIntake;
  try {
    parsed = JSON.parse(body) as BillingIntake;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  try {
    const result = await ingestBillingCase({ ...parsed, sourceEventId: auth.eventId });
    return NextResponse.json({ ok: true, billingCase: result }, { status: result.created ? 201 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "billing_intake_failed";
    console.error("billing intake failed", { eventId: auth.eventId, message });
    const status = /fehlt|ungültig|stimmen nicht|entsprechen|enthält/.test(message) ? 422 : 500;
    return NextResponse.json({ ok: false, error: status === 422 ? message : "billing_intake_failed", requestId: auth.eventId }, { status });
  }
}
