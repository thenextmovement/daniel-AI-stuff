import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  completeCustomerInternalTask,
  createCustomerInternalTask,
  listCustomerInternalTasks,
  logCustomerCall,
  searchCustomerRecords,
  type CustomerCallLogInput,
  type CustomerSearchResult,
  type UpdateActor,
} from "@/lib/ops/customer-records";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

type OfferCallTaskAction =
  | "create_inquiry_call_task"
  | "create_offer_sent_call_task"
  | "create_unopened_24h_call_task"
  | "complete_task"
  | "log_call";

type OfferCallTaskRequest = {
  action?: OfferCallTaskAction;
  requestId?: string | null;
  taskId?: string | null;
  note?: string | null;
  operatorName?: string | null;
  call?: CustomerCallLogInput;
  offer?: {
    offerId?: string | null;
    offerNumber?: string | null;
    documentReference?: string | null;
    publicUrl?: string | null;
    trelloCardId?: string | null;
    customerEmail?: string | null;
    customerPhone?: string | null;
    customerName?: string | null;
    customerCompany?: string | null;
  };
};

const SHARED_CALL_ASSIGNEE = "Daniel + Fabienne";
const INQUIRY_CALL_SOURCE_TYPE = "neontrip_inquiry_call";
const OFFER_CALL_SOURCE_TYPE = "neontrip_offer_call";

function configuredInternalKeys() {
  return [
    process.env.OPS_INTERNAL_API_KEY,
    process.env.QUOTE_INTERNAL_API_TOKEN,
    process.env.INTERNAL_API_KEY,
  ].filter((value): value is string => Boolean(value && value.length >= 24));
}

function bearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || request.headers.get("x-neontrip-internal-key") || "";
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function safeEqual(left: string, right: string) {
  return timingSafeEqual(digest(left), digest(right));
}

function isAuthorized(request: NextRequest) {
  const expectedKeys = configuredInternalKeys();
  const received = bearerToken(request);
  return Boolean(expectedKeys.length && received && expectedKeys.some((expected) => safeEqual(received, expected)));
}

function trimNullable(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeEmail(value: unknown) {
  const normalized = trimNullable(value)?.toLowerCase() || null;
  return normalized && normalized.includes("@") ? normalized : null;
}

function normalizePhone(value: unknown) {
  const normalized = trimNullable(value);
  if (!normalized) return null;
  return normalized.replace(/\D/g, "").length >= 6 ? normalized : null;
}

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host") || "internal";
}

function automationActor(request: NextRequest, operatorName?: string | null): UpdateActor {
  return {
    host: getOpsHost(request),
    mode: "automation",
    userAgent: request.headers.get("user-agent"),
    operatorName: trimNullable(operatorName) || "NEONTRIP Offers",
  };
}

function failureResponse(error: unknown) {
  if (error instanceof QuoteValidationError) {
    return NextResponse.json(
      { ok: false, error: error.message, issues: error.issues },
      { status: error.status },
    );
  }

  if (error instanceof SupabaseRestError) {
    return NextResponse.json(
      { ok: false, error: error.message, details: error.details },
      { status: error.status },
    );
  }

  console.error("internal offer call tasks route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

function offerSearchQueries(body: OfferCallTaskRequest) {
  const offer = body.offer || {};
  const requestId = trimNullable(body.requestId);
  if (requestId) return [requestId];

  const trelloCardId = trimNullable(offer.trelloCardId);
  const email = normalizeEmail(offer.customerEmail);
  const phone = normalizePhone(offer.customerPhone);

  return [
    trelloCardId ? `trello:${trelloCardId}` : null,
    email,
    phone,
  ].filter((value): value is string => Boolean(value));
}

async function resolveCustomerRecord(body: OfferCallTaskRequest) {
  for (const query of offerSearchQueries(body)) {
    const records = await searchCustomerRecords(query);
    if (records[0]) return records[0];
  }
  throw new QuoteValidationError("Kein passender Customer Record gefunden.", [], 404);
}

function offerLabel(body: OfferCallTaskRequest) {
  const offer = body.offer || {};
  return trimNullable(offer.offerNumber) || trimNullable(offer.documentReference) || trimNullable(offer.offerId) || "Angebot";
}

function customerLabel(record: CustomerSearchResult, body: OfferCallTaskRequest) {
  const offer = body.offer || {};
  return record.displayName || trimNullable(offer.customerName) || trimNullable(offer.customerCompany) || record.email;
}

function taskDescription(record: CustomerSearchResult, body: OfferCallTaskRequest, reason: string) {
  const offer = body.offer || {};
  const lines = [
    reason,
    `Kunde: ${customerLabel(record, body)}`,
    `Angebot: ${offerLabel(body)}`,
    trimNullable(offer.publicUrl) ? `Link: ${trimNullable(offer.publicUrl)}` : null,
    "Gemeinsame Aufgabe fuer Daniel und Fabienne; erledigt ist erledigt fuer beide.",
  ].filter(Boolean);
  return lines.join("\n").slice(0, 1200);
}

async function completeOpenInquiryTasks(requestId: string, actor: UpdateActor) {
  const board = await listCustomerInternalTasks({ requestId, includeDone: false, limit: 2000 });
  const inquiryTasks = board.tasks.filter((task) => (
    task.status === "open" &&
    task.category === "call" &&
    task.sourceType === INQUIRY_CALL_SOURCE_TYPE
  ));

  for (const task of inquiryTasks) {
    await completeCustomerInternalTask(
      task.id,
      "Automatisch geschlossen: Angebot wurde verschickt; neue Angebots-Call-Aufgabe uebernimmt.",
      actor,
    );
  }

  return inquiryTasks.length;
}

async function createCallTask(body: OfferCallTaskRequest, request: NextRequest) {
  const action = body.action;
  const actor = automationActor(request, body.operatorName);
  const record = await resolveCustomerRecord(body);
  const offerId = trimNullable(body.offer?.offerId) || trimNullable(body.offer?.documentReference) || record.requestId;
  const now = new Date().toISOString();

  if (action === "create_inquiry_call_task") {
    const task = await createCustomerInternalTask({
      title: "Anfrage erhalten - bitte anrufen",
      description: taskDescription(record, body, "Neue Anfrage ist eingegangen und soll telefonisch qualifiziert werden."),
      assigneeName: SHARED_CALL_ASSIGNEE,
      dueAt: now,
      category: "call",
      priority: "high",
      requestId: record.requestId,
      idempotencyKey: `ops-call:request:${record.requestId}:inquiry`,
      sourceType: INQUIRY_CALL_SOURCE_TYPE,
      sourceId: record.requestId,
    }, actor);
    return NextResponse.json({ ok: true, action, requestId: record.requestId, task, closedInquiryTasks: 0 });
  }

  const closedInquiryTasks = action === "create_offer_sent_call_task"
    ? await completeOpenInquiryTasks(record.requestId, actor)
    : 0;
  const unopened = action === "create_unopened_24h_call_task";
  const task = await createCustomerInternalTask({
    title: unopened ? "Angebot nicht geoeffnet - nachfassen" : "Erstes Angebot jetzt bitte anrufen",
    description: taskDescription(
      record,
      body,
      unopened
        ? "Angebot wurde laenger als 24 Stunden nicht geoeffnet."
        : "Angebot wurde verschickt; bitte zeitnah anrufen.",
    ),
    assigneeName: SHARED_CALL_ASSIGNEE,
    dueAt: now,
    category: "call",
    priority: unopened ? "normal" : "high",
    requestId: record.requestId,
    idempotencyKey: `ops-call:offer:${offerId}:${unopened ? "unopened-24h" : "first-offer-sent"}`,
    sourceType: OFFER_CALL_SOURCE_TYPE,
    sourceId: `${offerId}:${unopened ? "unopened-24h" : "first-offer-sent"}`,
  }, actor);

  return NextResponse.json({ ok: true, action, requestId: record.requestId, task, closedInquiryTasks });
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: OfferCallTaskRequest | null = null;
  try {
    body = (await request.json()) as OfferCallTaskRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  try {
    if (
      body?.action === "create_inquiry_call_task" ||
      body?.action === "create_offer_sent_call_task" ||
      body?.action === "create_unopened_24h_call_task"
    ) {
      return await createCallTask(body, request);
    }

    if (body?.action === "complete_task") {
      const task = await completeCustomerInternalTask(String(body.taskId || ""), body.note, automationActor(request, body.operatorName));
      return NextResponse.json({ ok: true, action: body.action, task });
    }

    if (body?.action === "log_call") {
      const record = await resolveCustomerRecord(body);
      const result = await logCustomerCall(record.requestId, body.call || {
        reached: false,
        leftVoicemail: false,
        customerOnVacation: false,
        askedForCallback: false,
        noInterest: false,
        emailConfirmed: false,
        offerDiscussed: false,
        whatsappPreferred: false,
        deleteRequested: false,
        note: body.note || null,
      }, automationActor(request, body.operatorName));
      return NextResponse.json({ ok: true, action: body.action, ...result });
    }

    return NextResponse.json({ ok: false, error: "unsupported_action" }, { status: 400 });
  } catch (error) {
    return failureResponse(error);
  }
}
