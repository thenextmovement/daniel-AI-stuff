import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { recordOfferSentForSalesCalls } from "@/lib/ops/customer-call-module";
import { recordQuoteEmailSentEvidence } from "@/lib/ops/offer-send-evidence";
import { getOfferById, OpsOfferApiError, sendOfferUpdateMail, type OpsOfferSendInput } from "@/lib/ops/offers";
import { designOfferSendBlock } from "@/lib/ops/design";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function notConfigured() {
  return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
}

function failureResponse(error: unknown) {
  if (error instanceof OpsOfferApiError) {
    return NextResponse.json(
      { ok: false, error: error.message, code: error.code, issues: error.issues },
      { status: error.status },
    );
  }
  console.error("ops customer-records offers send route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

async function authorize(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return { ok: false as const, response: notConfigured() };
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) {
    return { ok: false as const, response: unauthorized() };
  }
  return { ok: true as const };
}

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function isInternalNeontripEmail(email: string) {
  return /@(neontrip\.de|neontrip\.com)$/i.test(email);
}

function isPlaceholderCustomerEmail(email: string) {
  return email.endsWith("@no-customer-email.invalid");
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ offerId: string }> }) {
  const authorized = await authorize(request);
  if (!authorized.ok) return authorized.response;

  try {
    const { offerId } = await params;
    const decodedOfferId = decodeURIComponent(offerId);
    const body = (await request.json()) as OpsOfferSendInput & {
      recordEmail?: string | null;
      requestId?: string | null;
      trelloCardId?: string | null;
    };
    const offer = await getOfferById(decodedOfferId);
    const designSendBlock = await designOfferSendBlock(decodedOfferId);
    if (designSendBlock) {
      return NextResponse.json(
        {
          ok: false,
          error: "Versand blockiert: Eine Produktänderung aus dem Design Studio benötigt noch eine geprüfte Preisfreigabe.",
          code: "design_price_review_required",
        },
        { status: 409 },
      );
    }
    const offerEmail = normalizeEmail(offer.offer.customerEmail);
    const recordEmail = normalizeEmail(body.recordEmail);
    const recipientEmail = normalizeEmail(body.recipientEmail);
    if (offerEmail && recordEmail && offerEmail !== recordEmail) {
      return NextResponse.json(
        {
          ok: false,
          error: `Versand blockiert: Das Angebot gehoert zu ${offer.offer.customerEmail}, der geoeffnete Datensatz zu ${body.recordEmail}.`,
          code: "offer_record_email_mismatch",
        },
        { status: 409 },
      );
    }
    if (recipientEmail && isInternalNeontripEmail(recipientEmail)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Versand blockiert: Die Hauptadresse ist eine interne NEONTRIP-Adresse. Bitte zuerst die echte Kunden-E-Mail im Datensatz oder Angebot korrigieren.",
          code: "internal_recipient_detected",
        },
        { status: 409 },
      );
    }
    if (!recipientEmail || isPlaceholderCustomerEmail(recipientEmail) || !isValidEmail(recipientEmail)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Versand blockiert: Es ist keine echte Kunden-E-Mail hinterlegt. Bitte zuerst die Kunden-E-Mail im Datensatz oder Angebot korrigieren.",
          code: "no_valid_customer_email",
        },
        { status: 409 },
      );
    }

    const cc = Array.isArray(body.cc) ? body.cc : [];
    const sendInput: OpsOfferSendInput = {
      recipientEmail: body.recipientEmail,
      cc,
      subject: body.subject,
      message: body.message,
      actor: body.actor,
      reason: body.reason,
      idempotencyKey: body.idempotencyKey,
    };
    const result = await sendOfferUpdateMail(decodedOfferId, sendInput);
    let opsSync: Awaited<ReturnType<typeof recordOfferSentForSalesCalls>> | { ok: boolean; error?: string; skipped?: boolean } | null = result.opsSync || null;
    let quoteEmailEvidence: { ok: boolean; error?: string; rowId?: string | number | null } | null = null;
    if (!opsSync) {
      try {
        opsSync = await recordOfferSentForSalesCalls({
          requestId: body.requestId,
          trelloCardId: body.trelloCardId || offer.trelloCardId,
          offerId: offer.offerId,
          offerNumber: offer.offerNumber,
          documentReference: offer.documentReference,
          publicUrl: offer.publicUrl,
          recipientEmail: body.recipientEmail,
          sentAt: new Date().toISOString(),
          source: "ops_customer_records_offer_send",
          sourceEventId: result.eventId,
          idempotencyKey: `neontrip-offers-send:${offer.offerId}:${body.idempotencyKey}`,
          actor: body.actor,
          payload: {
            duplicate: result.duplicate,
            cc_count: cc.length,
            reason: body.reason,
            subject: body.subject,
            direction: "outbound",
            subtype: "quote_update",
          },
        });
      } catch (syncError) {
        console.error("offer sent but sales call sync failed", syncError);
        opsSync = { ok: false, error: syncError instanceof Error ? syncError.message : "ops_sync_failed" };
      }
    }
    try {
      const evidenceRows = await recordQuoteEmailSentEvidence({
        offerId: offer.offerId,
        offerNumber: offer.offerNumber,
        requestId: body.requestId,
        trelloCardId: body.trelloCardId || offer.trelloCardId,
        recipientEmail: body.recipientEmail,
        subject: body.subject,
        status: result.duplicate ? "sent_duplicate" : "sent",
        sentAt: new Date().toISOString(),
        sourceEventId: result.eventId,
        idempotencyKey: body.idempotencyKey,
      });
      quoteEmailEvidence = { ok: true, rowId: evidenceRows?.[0]?.id || null };
    } catch (evidenceError) {
      console.error("offer sent but quote_email_log evidence failed", evidenceError);
      quoteEmailEvidence = { ok: false, error: evidenceError instanceof Error ? evidenceError.message : "quote_email_log_failed" };
    }
    return NextResponse.json({ ok: true, ...result, opsSync, quoteEmailEvidence });
  } catch (error) {
    return failureResponse(error);
  }
}
