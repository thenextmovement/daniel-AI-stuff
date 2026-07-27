import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ingestUndeliverableOffer, proposeUndeliverableCandidate } from "@/lib/ops/undeliverable-offers";
import { supabaseRequest, supabaseRpc } from "@/lib/quotes/supabase-rest";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function authorized(request: NextRequest) {
  const expected = [process.env.OPS_INTERNAL_API_KEY, process.env.QUOTE_INTERNAL_API_TOKEN].filter((value): value is string => Boolean(value && value.length >= 24));
  const received = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!expected.length || !received) return false;
  return expected.some((value) => {
    const left = Buffer.from(value); const right = Buffer.from(received);
    return left.length === right.length && timingSafeEqual(left, right);
  });
}

function invalid() { return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 }); }

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, service: "undeliverable-offers", version: 1 });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = String(body?.action || "");
  try {
    if (action === "ingest") {
      if (!UUID.test(String(body?.correlationId || ""))) return invalid();
      const result = await ingestUndeliverableOffer({
        sourceMessageId: String(body?.sourceMessageId || ""), sourceInternetMessageId: body?.sourceInternetMessageId ? String(body.sourceInternetMessageId) : null,
        mailbox: String(body?.mailbox || ""), receivedAt: String(body?.receivedAt || ""), failedEmail: String(body?.failedEmail || ""),
        diagnosticCode: body?.diagnosticCode ? String(body.diagnosticCode) : null, diagnosticText: body?.diagnosticText ? String(body.diagnosticText) : null,
        subject: String(body?.subject || ""), offerId: body?.offerId ? String(body.offerId) : null, requestId: body?.requestId ? String(body.requestId) : null,
        correlationId: String(body?.correlationId),
      });
      return NextResponse.json({ ok: true, result });
    }
    if (action === "list-research") {
      const cases = await supabaseRequest<Array<{ id: string; failed_email: string; offer_number: string | null; request_id: string | null }>>("undeliverable_offer_cases", undefined, { select: "id,failed_email,offer_number,request_id", status: "eq.needs_research", order: "received_at.asc", limit: 5 });
      const items = await Promise.all(cases.map(async (item) => {
        const context = item.request_id ? await supabaseRequest<Array<{ company: string | null; first_name: string | null; last_name: string | null }>>("master_requests", undefined, { select: "company,first_name,last_name", request_id: `eq.${item.request_id}`, limit: 1 }) : [];
        return { caseId: item.id, failedEmail: item.failed_email, offerNumber: item.offer_number, requestId: item.request_id, company: context[0]?.company || null, customerName: [context[0]?.first_name, context[0]?.last_name].filter(Boolean).join(" ") || null };
      }));
      return NextResponse.json({ ok: true, items });
    }
    if (action === "propose") {
      if (!UUID.test(String(body?.caseId || "")) || !UUID.test(String(body?.idempotencyKey || "")) || !Array.isArray(body?.evidence)) return invalid();
      const result = await proposeUndeliverableCandidate({ caseId: String(body.caseId), proposedEmail: String(body?.proposedEmail || ""), confidence: Number(body?.confidence), evidence: body.evidence as never, actor: String(body?.actor || "n8n:research"), idempotencyKey: String(body.idempotencyKey) });
      return NextResponse.json({ ok: true, result });
    }
    if (action === "execute-one") {
      if (!UUID.test(String(body?.executionId || ""))) return invalid();
      const claimed = await supabaseRpc<Record<string, unknown> | null>("claim_undeliverable_offer_execution_v1", { p_worker: "n8n:executor", p_execution_idempotency_key: String(body?.executionId) });
      if (!claimed) return NextResponse.json({ ok: true, claimed: false });
      const caseId = String(claimed.id || "");
      try {
        const correction = await supabaseRpc<Record<string, unknown>>("apply_undeliverable_email_correction_v1", { p_case_id: caseId, p_actor: "n8n:executor" });
        const offersBase = String(process.env.NEONTRIP_OFFERS_INTERNAL_URL || "").replace(/\/$/, "");
        const offersKey = String(process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY || "");
        const offerId = String(correction.offer_id || "");
        if (!offersBase || offersKey.length < 24 || !offerId) throw new Error("offers_handoff_not_configured");
        let response: Response;
        try {
          response = await fetch(`${offersBase}/api/internal/offers/${encodeURIComponent(offerId)}/send`, {
            method: "POST", headers: { Authorization: `Bearer ${offersKey}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(45_000),
            body: JSON.stringify({ recipientEmail: correction.recipient_email, cc: [], subject: `Ihr korrigiertes NEONTRIP-Angebot A/N ${correction.offer_number || ""}`.trim(), message: "Guten Tag, bei der ersten Zustellung Ihres Angebots ist ein Adressfehler aufgetreten. Hier erhalten Sie Ihr Angebot erneut.", actor: "undeliverable-offer-agent", reason: `Adresskorrektur nach Unzustellbarkeit; Fall ${caseId}`, idempotencyKey: correction.send_idempotency_key, includePdf: false, includeWhatsApp: false, deliveryPurpose: "MANUAL_RESEND" }),
          });
        } catch (error) {
          await supabaseRpc("complete_undeliverable_offer_execution_v1", { p_case_id: caseId, p_result: "unknown", p_provider_message_id: null, p_provider_conversation_id: null, p_failure_reason: error instanceof Error ? error.message : "unknown_provider_outcome", p_actor: "ops:executor" });
          return NextResponse.json({ ok: false, claimed: true, caseId, status: "unknown" }, { status: 502 });
        }
        const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
        if (!response.ok || !payload?.ok) {
          await supabaseRpc("complete_undeliverable_offer_execution_v1", { p_case_id: caseId, p_result: response.status >= 500 ? "unknown" : "failed", p_provider_message_id: null, p_provider_conversation_id: null, p_failure_reason: String(payload?.error || payload?.message || `offers_http_${response.status}`), p_actor: "ops:executor" });
          return NextResponse.json({ ok: false, claimed: true, caseId, status: response.status >= 500 ? "unknown" : "failed" }, { status: 502 });
        }
        const messageId = String(payload.providerMessageId || payload.messageId || payload.id || "");
        if (!messageId) {
          await supabaseRpc("complete_undeliverable_offer_execution_v1", { p_case_id: caseId, p_result: "unknown", p_provider_message_id: null, p_provider_conversation_id: null, p_failure_reason: "provider_receipt_missing", p_actor: "ops:executor" });
          return NextResponse.json({ ok: false, claimed: true, caseId, status: "unknown" }, { status: 502 });
        }
        await supabaseRpc("complete_undeliverable_offer_execution_v1", { p_case_id: caseId, p_result: "sent", p_provider_message_id: messageId, p_provider_conversation_id: payload.conversationId || null, p_failure_reason: null, p_actor: "ops:executor" });
        return NextResponse.json({ ok: true, claimed: true, caseId, status: "sent", providerMessageId: messageId });
      } catch (error) {
        await supabaseRpc("complete_undeliverable_offer_execution_v1", { p_case_id: caseId, p_result: "failed", p_provider_message_id: null, p_provider_conversation_id: null, p_failure_reason: error instanceof Error ? error.message : "execution_failed", p_actor: "ops:executor" }).catch(() => null);
        return NextResponse.json({ ok: false, claimed: true, caseId, status: "failed" }, { status: 500 });
      }
    }
    return invalid();
  } catch (error) {
    console.error("undeliverable internal route failed", error);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
