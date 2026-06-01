import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { recordOfferSentForSalesCalls } from "@/lib/ops/customer-call-module";
import { getOfferById, OpsOfferApiError, sendOfferUpdateMail, type OpsOfferSendInput } from "@/lib/ops/offers";

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
    const offerEmail = normalizeEmail(offer.offer.customerEmail);
    const recordEmail = normalizeEmail(body.recordEmail);
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

    const sendInput: OpsOfferSendInput = {
      recipientEmail: body.recipientEmail,
      cc: body.cc,
      subject: body.subject,
      message: body.message,
      actor: body.actor,
      reason: body.reason,
      idempotencyKey: body.idempotencyKey,
    };
    const result = await sendOfferUpdateMail(decodedOfferId, sendInput);
    let opsSync: Awaited<ReturnType<typeof recordOfferSentForSalesCalls>> | { ok: false; error: string } | null = null;
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
        idempotencyKey: `ops-offer-send:${body.requestId || offer.trelloCardId || offer.offerId}:${offer.offerId}:${result.eventId}`,
        actor: body.actor,
        payload: {
          duplicate: result.duplicate,
          cc_count: body.cc.length,
          reason: body.reason,
        },
      });
    } catch (syncError) {
      console.error("offer sent but sales call sync failed", syncError);
      opsSync = { ok: false, error: syncError instanceof Error ? syncError.message : "ops_sync_failed" };
    }
    return NextResponse.json({ ok: true, ...result, opsSync });
  } catch (error) {
    return failureResponse(error);
  }
}
