import { NextRequest, NextResponse } from "next/server";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import {
  assignSupplierSale,
  applyNoPaymentReminderShopifyTag,
  cleanupSupplierAssignmentTasks,
  createSupplierDeadlineTasks,
  generateSupplierOrderConfirmationPdf,
  listSupplierSalesBoard,
  requestSupplierPaymentReminder,
  retrySupplierSaleShopifyTag,
  runSupplierSalesLiveCheck,
  sendSupplierOrderConfirmationEmail,
  syncCompletedOffersFromOffersApp,
  updateSupplierSalePaymentDecision,
  upsertSupplierSaleFromPayload,
  type SupplierSaleActor,
  type SupplierSaleAssignmentStatus,
  type SupplierSalePaymentDecision,
  type SupplierSalePaymentStatus,
  type SupplierSaleRecommendation,
  type SupplierSaleSupplier,
  type SupplierSaleUrgencyFilter,
} from "@/lib/ops/supplier-sales";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

const MAX_POST_BYTES = 1_000_000;
const SIGNATURE_REPLAY_WINDOW_MS = 10 * 60 * 1000;

type SupplierSalesPostBody = {
  action?:
    | "upsert_sale"
    | "assign_supplier"
    | "update_payment_decision"
    | "request_payment_reminder"
    | "send_order_confirmation_email"
    | "retry_shopify_tag"
    | "apply_no_payment_reminder_tag"
    | "create_deadline_tasks"
    | "cleanup_supplier_assignment_tasks"
    | "sync_completed_offers"
    | "diagnose_sales_flow";
  payload?: unknown;
  sale?: unknown;
  order?: unknown;
  saleId?: string | null;
  supplier?: SupplierSaleSupplier | null;
  requestedDeliveryDate?: string | null;
  specialSupplierName?: string | null;
  assignmentNote?: string | null;
  paymentDecisionStatus?: SupplierSalePaymentDecision | null;
  paymentDueAt?: string | null;
  requestedBy?: string | null;
  recipientEmail?: string | null;
  paymentLink?: string | null;
  message?: string | null;
  operatorName?: string | null;
  assigneeLabel?: string | null;
  agentToken?: string | null;
  idempotencyKey?: string | null;
  limit?: number | string | null;
};

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function notConfigured() {
  return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
}

function failureResponse(error: unknown) {
  if (error instanceof QuoteValidationError) {
    return NextResponse.json({ ok: false, error: error.message, issues: error.issues }, { status: error.status });
  }
  if (error instanceof SupabaseRestError) {
    console.error("ops supplier-sales supabase request failed", { status: error.status, details: error.details });
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  console.error("ops supplier-sales route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

function digest(value: string) {
  return createHash("sha256").update(`neontrip:supplier-sales-agent:${value}`).digest("hex");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function tokenMatches(candidate: string, expected: string) {
  return Boolean(candidate && expected && safeEqual(digest(candidate), digest(expected)));
}

function getAutomationToken(request: NextRequest, bodyToken?: string | null) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return String(bodyToken || request.headers.get("x-supplier-sales-agent-token") || bearer || "").trim();
}

function hasSupplierSalesAutomationAccess(request: NextRequest, bodyToken?: string | null) {
  const expected = String(
    process.env.SUPPLIER_SALES_AGENT_API_TOKEN ||
      process.env.QUOTE_INTERNAL_API_TOKEN ||
      process.env.OPS_INTERNAL_API_KEY ||
      process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY ||
      "",
  ).trim();
  return tokenMatches(getAutomationToken(request, bodyToken), expected);
}

function signatureSecret() {
  return String(
    process.env.SUPPLIER_SALES_WEBHOOK_SECRET ||
      process.env.SHOPIFY_SALE_WEBHOOK_SECRET ||
      process.env.N8N_SHOPIFY_SALE_WEBHOOK_SECRET ||
      "",
  ).trim();
}

function validSignatureTimestamp(timestamp: string | null) {
  if (!timestamp) return true;
  const parsed = Number(timestamp);
  const millis = Number.isFinite(parsed) && parsed < 10_000_000_000 ? parsed * 1000 : parsed;
  return Number.isFinite(millis) && Math.abs(Date.now() - millis) <= SIGNATURE_REPLAY_WINDOW_MS;
}

function verifySignature(rawBody: string, signature: string | null, timestamp: string | null) {
  const secret = signatureSecret();
  if (!secret || !signature) return false;
  if (!validSignatureTimestamp(timestamp)) return false;
  const expectedPayloads = timestamp ? [`${timestamp}.${rawBody}`, rawBody] : [rawBody];
  return expectedPayloads.some((payload) => {
    const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
    return safeEqual(signature.trim(), expected);
  });
}

async function getOpsActor(request: NextRequest, operatorName?: string | null): Promise<SupplierSaleActor | null> {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return null;
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return null;
  return {
    host,
    mode: isOpsPortalBypassed(host) ? "local_bypass" : "ops_session",
    userAgent: request.headers.get("user-agent"),
    operatorName: operatorName || null,
  };
}

async function assertOpsAccess(request: NextRequest, operatorName?: string | null) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return { ok: false as const, response: notConfigured(), host, actor: null };
  const actor = await getOpsActor(request, operatorName);
  if (!actor) return { ok: false as const, response: unauthorized(), host, actor: null };
  return { ok: true as const, host, actor };
}

async function getActorOrAutomation(
  request: NextRequest,
  rawBody: string,
  body: SupplierSalesPostBody | null,
  operatorName?: string | null,
) {
  const actor = await getOpsActor(request, operatorName);
  if (actor) return actor;
  if (
    hasSupplierSalesAutomationAccess(request, body?.agentToken || null) ||
    verifySignature(rawBody, request.headers.get("x-neontrip-signature"), request.headers.get("x-neontrip-timestamp"))
  ) {
    return {
      host: getOpsHost(request),
      mode: "ops_session" as const,
      userAgent: request.headers.get("user-agent"),
      operatorName: operatorName || "Supplier Sales Agent",
    };
  }
  return null;
}

function parseJsonBody(rawBody: string) {
  try {
    return JSON.parse(rawBody) as SupplierSalesPostBody;
  } catch {
    throw new QuoteValidationError("JSON-Payload ist ungueltig.", ["JSON-Payload ist ungueltig."], 400);
  }
}

function payloadFromBody(body: SupplierSalesPostBody) {
  if (body.payload !== undefined) return body.payload;
  if (body.sale !== undefined) return body.sale;
  if (body.order !== undefined) return { order: body.order };
  return body;
}

export async function GET(request: NextRequest) {
  const access = await assertOpsAccess(request);
  if (!access.ok) return access.response;

  try {
    const params = request.nextUrl.searchParams;
    if (params.get("action") === "order_confirmation_pdf" || params.get("action") === "snapshot_pdf") {
      const pdf = await generateSupplierOrderConfirmationPdf(String(params.get("saleId") || ""));
      return new NextResponse(Buffer.from(pdf.bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${pdf.fileName.replace(/"/g, "")}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const board = await listSupplierSalesBoard({
      scope: (params.get("scope") || "active") as "active" | "ready" | "payment" | "assigned" | "deadline" | "sync" | "all",
      supplier: (params.get("supplier") || "all") as SupplierSaleSupplier | SupplierSaleRecommendation | "all",
      payment: (params.get("payment") || "all") as SupplierSalePaymentStatus | "unpaid" | "all",
      urgency: (params.get("urgency") || "all") as SupplierSaleUrgencyFilter,
      query: params.get("q"),
      limit: Number(params.get("limit") || 50),
    });
    return NextResponse.json({ ok: true, board });
  } catch (error) {
    return failureResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (rawBody.length > MAX_POST_BYTES) {
    return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  }

  const body = parseJsonBody(rawBody || "{}");
  const action = body.action || "upsert_sale";
  let actor: SupplierSaleActor | null = null;
  if (action === "upsert_sale" || action === "create_deadline_tasks" || action === "sync_completed_offers") {
    actor = await getActorOrAutomation(request, rawBody, body, body.operatorName || null);
  } else {
    const access = await assertOpsAccess(request, body.operatorName || null);
    if (!access.ok) return access.response;
    actor = access.actor;
  }
  if (!actor) return unauthorized();

  try {
    if (action === "upsert_sale") {
      const result = await upsertSupplierSaleFromPayload(payloadFromBody(body), actor);
      const board = await listSupplierSalesBoard({ scope: "active" });
      return NextResponse.json({ ok: true, action, sale: result.sale, warnings: result.warnings, board });
    }

    if (action === "update_payment_decision") {
      const sale = await updateSupplierSalePaymentDecision({
        saleId: String(body.saleId || ""),
        paymentDecisionStatus: body.paymentDecisionStatus || "pending",
        paymentDueAt: body.paymentDueAt || null,
        operatorName: body.operatorName || null,
      }, actor);
      return NextResponse.json({ ok: true, action, sale });
    }

    if (action === "request_payment_reminder") {
      const sale = await requestSupplierPaymentReminder({
        saleId: String(body.saleId || ""),
        requestedBy: body.requestedBy || body.operatorName || null,
        recipientEmail: body.recipientEmail || null,
        paymentLink: body.paymentLink || null,
        message: body.message || null,
        operatorName: body.operatorName || null,
        idempotencyKey: body.idempotencyKey || null,
      }, actor);
      return NextResponse.json({ ok: true, action, sale });
    }

    if (action === "send_order_confirmation_email") {
      const result = await sendSupplierOrderConfirmationEmail({
        saleId: String(body.saleId || ""),
        requestedBy: body.requestedBy || body.operatorName || null,
        recipientEmail: body.recipientEmail || null,
        operatorName: body.operatorName || null,
        idempotencyKey: body.idempotencyKey || null,
      }, actor);
      return NextResponse.json({ ok: true, action, sale: result.sale, orderConfirmationEmail: result });
    }

    if (action === "retry_shopify_tag") {
      const sale = await retrySupplierSaleShopifyTag({
        saleId: String(body.saleId || ""),
        operatorName: body.operatorName || null,
      }, actor);
      return NextResponse.json({ ok: true, action, sale });
    }

    if (action === "apply_no_payment_reminder_tag") {
      const result = await applyNoPaymentReminderShopifyTag({
        saleId: String(body.saleId || ""),
        operatorName: body.operatorName || null,
      }, actor);
      return NextResponse.json({ ok: true, action, sale: result.sale, noPaymentReminderTag: result.tag });
    }

    if (action === "create_deadline_tasks") {
      const deadlineTasks = await createSupplierDeadlineTasks(actor);
      return NextResponse.json({ ok: true, action, deadlineTasks });
    }

    if (action === "cleanup_supplier_assignment_tasks") {
      const assignmentTaskCleanup = await cleanupSupplierAssignmentTasks();
      return NextResponse.json({ ok: true, action, assignmentTaskCleanup });
    }

    if (action === "sync_completed_offers") {
      const completedOffersSync = await syncCompletedOffersFromOffersApp(actor, { limit: Number(body.limit || 50) });
      return NextResponse.json({ ok: true, action, completedOffersSync });
    }

    if (action === "diagnose_sales_flow") {
      const liveCheck = await runSupplierSalesLiveCheck({ limit: Number(body.limit || 10) });
      const board = await listSupplierSalesBoard({ scope: "active" });
      return NextResponse.json({ ok: true, action, liveCheck, board });
    }

    if (action === "assign_supplier") {
      const sale = await assignSupplierSale({
        saleId: String(body.saleId || ""),
        supplier: body.supplier || "said",
        requestedDeliveryDate: String(body.requestedDeliveryDate || ""),
        specialSupplierName: body.specialSupplierName || null,
        assignmentNote: body.assignmentNote || null,
        paymentDecisionStatus: body.paymentDecisionStatus || null,
        operatorName: body.operatorName || null,
        assigneeLabel: body.assigneeLabel || null,
      }, actor);
      return NextResponse.json({ ok: true, action, sale });
    }

    return NextResponse.json({ ok: false, error: "unsupported_action" }, { status: 400 });
  } catch (error) {
    return failureResponse(error);
  }
}
