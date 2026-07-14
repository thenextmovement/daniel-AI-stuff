import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import {
  addCustomerOpsNote,
  getCustomerRecordByRequestId,
  reportCustomerSpecialCase,
  updateCustomerRecord,
  type CustomerSpecialCaseKind,
  type UpdateActor,
} from "@/lib/ops/customer-records";
import { recordOfferSentForSalesCalls } from "@/lib/ops/customer-call-module";
import { createOpsInternalTask } from "@/lib/ops/internal-tasks";
import { recordQuoteEmailSentEvidence } from "@/lib/ops/offer-send-evidence";
import {
  getOfferById,
  OpsOfferApiError,
  sendOfferUpdateMail,
  type OpsOfferSendInput,
} from "@/lib/ops/offers";
import {
  normalizeCompanyBrainProblemType,
  type CompanyBrainProblemType,
} from "@/lib/ops/company-brain";
import { recordWorkflowAuditEvent } from "@/lib/ops/workflow-audit";
import {
  addTrelloCardComment,
  addTrelloCardLabel,
  getTrelloBoardLabels,
  getTrelloFailureContext,
  updateTrelloCard,
} from "@/lib/quotes/trello";
import { SupabaseRestError, supabaseRequest } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Vary": "Cookie, Cf-Access-Jwt-Assertion",
};

function jsonResponse(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...NO_STORE_HEADERS,
      ...(init?.headers || {}),
    },
  });
}

type CompanyBrainActionKey =
  | "open_problem_case"
  | "create_internal_task"
  | "save_case_note"
  | "prepare_email_correction"
  | "correct_customer_email"
  | "post_trello_status_comment"
  | "repair_trello_projection"
  | "prepare_offer_retry"
  | "guarded_offer_resend";

type CompanyBrainActionInput = {
  actionKey?: CompanyBrainActionKey;
  requestId?: string;
  problemType?: CompanyBrainProblemType | null;
  specialCaseKind?: CustomerSpecialCaseKind | null;
  title?: string | null;
  description?: string | null;
  note?: string | null;
  operatorName?: string | null;
  assigneeLabel?: string | null;
  dueAt?: string | null;
  urgent?: boolean | null;
  confirmed?: boolean;
  confirmationText?: string | null;
  offerId?: string | null;
  offerNumber?: string | null;
  recipientEmail?: string | null;
  trelloCardId?: string | null;
  subject?: string | null;
  message?: string | null;
  idempotencyKey?: string | null;
  newCustomerEmail?: string | null;
  trelloCommentText?: string | null;
};

type QuoteEmailGuardRow = {
  id?: string | number | null;
  recipient_email?: string | null;
  angebotsnummer?: string | null;
  subject?: string | null;
  status?: string | null;
  sent_at?: string | null;
  created_at?: string | null;
  card_id?: string | null;
  card_url?: string | null;
};

type OutlookMessageGuardRow = {
  id?: string | number | null;
  direction?: string | null;
  matched_email?: string | null;
  subject?: string | null;
  body_preview?: string | null;
  received_at?: string | null;
  sent_at?: string | null;
  created_at?: string | null;
  to_emails?: string[] | null;
};

type WorkflowDeliveryProofRow = {
  id?: string | null;
  document_id?: string | null;
  action?: string | null;
  status?: string | null;
  error_message?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
};

const ALLOWED_SPECIAL_CASE_KINDS: CustomerSpecialCaseKind[] = [
  "gift",
  "replacement",
  "dimmer_defect",
  "power_supply",
  "open_question",
  "other",
];

function unauthorized() {
  return jsonResponse({ ok: false, error: "unauthorized" }, { status: 401 });
}

function notConfigured() {
  return jsonResponse({ ok: false, error: "ops_not_configured" }, { status: 503 });
}

function failureResponse(error: unknown) {
  if (error instanceof OpsOfferApiError) {
    return jsonResponse(
      { ok: false, error: error.message, code: error.code, issues: error.issues },
      { status: error.status },
    );
  }
  if (error instanceof QuoteValidationError) {
    return jsonResponse({ ok: false, error: error.message, issues: error.issues }, { status: error.status });
  }
  if (error instanceof SupabaseRestError) {
    return jsonResponse({ ok: false, error: error.message, code: "supabase_error" }, { status: error.status });
  }
  console.error("ops company-brain action route failed", error);
  return jsonResponse({ ok: false, error: "internal_error" }, { status: 500 });
}

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

async function authorize(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return { ok: false as const, response: notConfigured(), host };
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) {
    return { ok: false as const, response: unauthorized(), host };
  }
  return { ok: true as const, host };
}

function cleanText(value: unknown, maxLength = 1000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "unknown_error");
}

function normalizeActionKey(value: unknown): CompanyBrainActionKey {
  if (
    value === "open_problem_case" ||
    value === "create_internal_task" ||
    value === "save_case_note" ||
    value === "prepare_email_correction" ||
    value === "correct_customer_email" ||
    value === "post_trello_status_comment" ||
    value === "repair_trello_projection" ||
    value === "prepare_offer_retry" ||
    value === "guarded_offer_resend"
  ) return value;
  throw new QuoteValidationError("Unbekannte Company-Brain-Aktion.", ["Diese Aktion ist nicht freigegeben."], 422);
}

function normalizeSpecialCaseKind(value: unknown): CustomerSpecialCaseKind {
  return ALLOWED_SPECIAL_CASE_KINDS.includes(value as CustomerSpecialCaseKind) ? value as CustomerSpecialCaseKind : "open_question";
}

function requireConfirmation(body: CompanyBrainActionInput) {
  if (!body.confirmed) {
    throw new QuoteValidationError("Bestätigung erforderlich.", ["Die Aktion muss vor Ausführung bestätigt werden."], 422);
  }
  const confirmation = cleanText(body.confirmationText, 80).toLowerCase();
  if (confirmation !== "freigabe") {
    throw new QuoteValidationError("Bestätigungstext fehlt.", ["Bitte mit 'Freigabe' bestätigen."], 422);
  }
}

function sourceRefFor(actionKey: CompanyBrainActionKey, requestId: string, problemType: CompanyBrainProblemType | null) {
  const raw = `company-brain:${actionKey}:${requestId}:${problemType || "none"}:v1`;
  return `company-brain:${createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
}

function stripTrelloFailurePrefix(name: string) {
  return cleanText(name, 300)
    .replace(/^(?:\s*(?:❌\s*)?(?:FEHLER|ERROR)\s*[:\-–—]\s*)+/i, "")
    .trim();
}

function trelloLabelNameKey(value: unknown) {
  return cleanText(value, 120).toLowerCase().replace(/[^a-z0-9äöüß]/g, "");
}

function isOfferSentTrelloLabelName(value: unknown) {
  const key = trelloLabelNameKey(value);
  return key === "angebotgesendet" || key === "quotesent";
}

function problemTypeLabel(problemType: CompanyBrainProblemType | null) {
  switch (problemType) {
    case "color_dispute":
      return "Farbkonflikt";
    case "damaged_sign":
      return "Schild beschädigt/defekt";
    case "offer_not_sent":
      return "Angebot nicht raus";
    case "customer_waiting":
      return "Kunde wartet";
    case "design_unclear":
      return "Design unklar";
    case "delivery_problem":
      return "Lieferproblem";
    case "payment_order_unclear":
      return "Zahlung/Bestellung unklar";
    case "automation_failed":
      return "Automation fehlgeschlagen";
    case "other":
      return "Sonstiger Problemfall";
    default:
      return "Company-Brain-Problemfall";
  }
}

function actorFor(host: string | null | undefined, request: NextRequest, operatorName: string | null): UpdateActor {
  return {
    host,
    mode: isOpsPortalBypassed(host) ? "local_bypass" : "ops_session",
    userAgent: request.headers.get("user-agent"),
    operatorName,
  };
}

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isInternalNeontripEmail(email: string) {
  return /@(neontrip\.de|neontrip\.com)$/i.test(email);
}

function isPlaceholderCustomerEmail(email: string) {
  return email.endsWith("@no-customer-email.invalid");
}

function normalizeOfferNumber(value: unknown) {
  const normalized = cleanText(value, 80);
  const digits = normalized.match(/\d{3,}/)?.[0] || "";
  return digits || normalized.replace(/^a\/n\s*/i, "");
}

function isDeliveryFailureText(value: unknown) {
  const text = String(value || "").toLowerCase();
  return /unzustellbar|nicht zugestellt|konnte nicht zugestellt|postfach ist nicht verfuegbar|postfach ist nicht verfügbar|recipient.*unknown|mail delivery|delivery status notification|undeliver/.test(text);
}

function rowMentionsEmail(row: OutlookMessageGuardRow, recipientEmail: string) {
  const text = [
    row.matched_email,
    row.subject,
    row.body_preview,
    ...(Array.isArray(row.to_emails) ? row.to_emails : []),
  ].filter(Boolean).join(" ").toLowerCase();
  return text.includes(recipientEmail);
}

async function fetchQuoteEmailGuardRows(recipientEmail: string, offerNumber: string | null) {
  const query: Record<string, string | number | boolean | null> = {
    select: "id,recipient_email,angebotsnummer,subject,status,sent_at,created_at,card_id,card_url",
    recipient_email: `eq.${recipientEmail}`,
    order: "created_at.desc",
    limit: 20,
  };
  if (offerNumber) query.angebotsnummer = `eq.${offerNumber}`;
  return supabaseRequest<QuoteEmailGuardRow[]>("quote_email_log", undefined, query);
}

async function fetchOutlookGuardRows(recipientEmail: string, offerNumber: string | null) {
  const query: Record<string, string | number | boolean | null> = {
    select: "id,direction,matched_email,subject,body_preview,received_at,sent_at,created_at,to_emails",
    order: "created_at.desc",
    limit: 25,
  };
  if (offerNumber) {
    query.subject = `ilike.*${offerNumber}*`;
  } else {
    query.matched_email = `eq.${recipientEmail}`;
  }
  const rows = await supabaseRequest<OutlookMessageGuardRow[]>("customer_email_messages", undefined, query);
  return rows.filter((row) => rowMentionsEmail(row, recipientEmail) || !offerNumber);
}

async function fetchWorkflowDeliveryProofRows(input: {
  requestId: string;
  offerId: string | null;
  trelloCardId: string | null;
}) {
  const filters = [
    `document_id.eq.${encodeURIComponent(input.requestId)}`,
    `metadata->>request_id.eq.${encodeURIComponent(input.requestId)}`,
    input.offerId ? `metadata->>offer_id.eq.${encodeURIComponent(input.offerId)}` : null,
    input.trelloCardId ? `metadata->>trello_card_id.eq.${encodeURIComponent(input.trelloCardId)}` : null,
  ].filter((value): value is string => Boolean(value));
  return supabaseRequest<WorkflowDeliveryProofRow[]>("workflow_audit_log", undefined, {
    select: "id,document_id,action,status,error_message,metadata,created_at",
    or: `(${filters.join(",")})`,
    order: "created_at.desc",
    limit: 20,
  });
}

function isSuccessfulDeliveryAudit(row: WorkflowDeliveryProofRow) {
  if (cleanText(row.error_message)) return false;
  const action = cleanText(row.action).toLowerCase();
  const status = cleanText(row.status).toLowerCase();
  return (action === "initial_delivery_complete" && /^(success|sent|completed|ok)$/.test(status)) ||
    (action === "guarded_offer_resend" && /^(success|sent|completed|duplicate|ok)$/.test(status));
}

function workflowAuditMetadataText(row: WorkflowDeliveryProofRow, key: string) {
  const value = row.metadata?.[key];
  return typeof value === "string" ? cleanText(value, 240) : "";
}

function workflowAuditMatchesProjectionCase(
  row: WorkflowDeliveryProofRow,
  input: { requestId: string; offerId: string | null },
) {
  const auditRequestId = cleanText(row.document_id, 240) || workflowAuditMetadataText(row, "request_id");
  if (auditRequestId !== input.requestId) return false;
  if (!input.offerId) return true;
  return workflowAuditMetadataText(row, "offer_id") === input.offerId;
}

function isFailedWorkflowAudit(row: WorkflowDeliveryProofRow) {
  return Boolean(cleanText(row.error_message) || /fail|error|blocked/i.test(cleanText(row.status)));
}

function occurredAtMs(value: string | null | undefined) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

async function recordCompanyBrainRetryAudit(input: {
  status: "blocked" | "sent" | "duplicate" | "prepared";
  requestId: string;
  trelloCardId: string | null;
  offerId: string | null;
  offerNumber: string | null;
  recipientEmail: string | null;
  idempotencyKey: string | null;
  operatorName: string | null;
  errorMessage?: string | null;
  blockers?: string[];
  eventId?: string | null;
}) {
  return recordWorkflowAuditEvent({
    workflowName: "company_brain_fix_center",
    action: "guarded_offer_resend",
    status: input.status,
    requestId: input.requestId,
    trelloCardId: input.trelloCardId,
    offerId: input.offerId,
    offerNumber: input.offerNumber,
    idempotencyKey: input.idempotencyKey,
    sourceEventId: input.eventId || null,
    errorMessage: input.errorMessage || null,
    retrySafety: input.status === "sent" || input.status === "duplicate" ? "safe_after_review" : input.status === "blocked" ? "blocked" : "unknown",
    metadata: {
      operator_name: input.operatorName,
      recipient_email: input.recipientEmail,
      blockers: input.blockers || [],
      customer_communication_sent: input.status === "sent" || input.status === "duplicate",
    },
  });
}

async function recordCompanyBrainInternalAudit(input: {
  actionKey: CompanyBrainActionKey;
  status: "prepared" | "success";
  requestId: string;
  trelloCardId: string | null;
  offerId: string | null;
  offerNumber: string | null;
  sourceRef: string;
  sourceEventId?: string | null;
  operatorName: string | null;
  taskId?: string | null;
  noteId?: string | number | null;
  specialCaseCreated?: boolean;
  metadata?: Record<string, unknown>;
}) {
  return recordWorkflowAuditEvent({
    workflowName: "company_brain_fix_center",
    action: input.actionKey,
    status: input.status,
    requestId: input.requestId,
    trelloCardId: input.trelloCardId,
    offerId: input.offerId,
    offerNumber: input.offerNumber,
    sourceEventId: input.sourceEventId || input.taskId || (input.noteId ? String(input.noteId) : null),
    idempotencyKey: input.sourceRef,
    retrySafety: "safe_after_review",
    customer_communication_sent: false,
    metadata: {
      operator_name: input.operatorName,
      task_id: input.taskId || null,
      note_id: input.noteId || null,
      special_case_created: input.specialCaseCreated === true,
      customer_communication_sent: false,
      internal_only: true,
      ...input.metadata,
    },
  });
}

export async function POST(request: NextRequest) {
  const access = await authorize(request);
  if (!access.ok) return access.response;

  try {
    const body = (await request.json()) as CompanyBrainActionInput;
    requireConfirmation(body);

    const actionKey = normalizeActionKey(body.actionKey);
    const requestId = cleanText(body.requestId, 160);
    const problemType = normalizeCompanyBrainProblemType(body.problemType || null);
    const specialCaseKind = normalizeSpecialCaseKind(body.specialCaseKind);
    const operatorName = cleanText(body.operatorName, 120) || null;
    const actor = actorFor(access.host, request, operatorName);
    const offerId = cleanText(body.offerId, 180) || null;
    const offerNumber = normalizeOfferNumber(body.offerNumber) || null;
    const trelloCardIdInput = cleanText(body.trelloCardId, 180) || null;

    if (!requestId && (actionKey === "create_internal_task" || actionKey === "post_trello_status_comment")) {
      if (!trelloCardIdInput) {
        throw new QuoteValidationError("Trello-Karte fehlt.", ["Ohne Request-ID muss eine Trello-Card-ID vorhanden sein."], 422);
      }

      const sourceRef = sourceRefFor(actionKey, `trello:${trelloCardIdInput}`, problemType);
      const title = cleanText(body.title, 160) || `${problemTypeLabel(problemType)}: Trello ${trelloCardIdInput}`;
      const description = cleanText(body.description || body.note, 6000) || "Company-Brain-Aktion ohne Beschreibung.";

      if (actionKey === "create_internal_task") {
        const task = await createOpsInternalTask(
          {
            title,
            description,
            status: "open",
            priority: body.urgent ? "urgent" : "high",
            category: "problem",
            assigneeLabel: cleanText(body.assigneeLabel, 120) || operatorName,
            dueAt: cleanText(body.dueAt, 80) || null,
            requestId: null,
            customerName: null,
            customerEmail: null,
            trelloCardId: trelloCardIdInput,
            sourceApp: "company_brain",
            sourceRef,
            metadata: {
              problem_type: problemType,
              company_brain_action: actionKey,
              source_context: "trello_only",
              offer_id: offerId,
              offer_number: offerNumber,
              recipient_email: cleanText(body.recipientEmail, 240) || null,
              idempotency_key: cleanText(body.idempotencyKey, 300) || null,
            },
          },
          { operatorName },
        );
        const audit = await recordWorkflowAuditEvent({
          workflowName: "company_brain_fix_center",
          action: actionKey,
          status: "prepared",
          documentId: `trello:${trelloCardIdInput}`,
          trelloCardId: trelloCardIdInput,
          offerId,
          offerNumber,
          sourceEventId: task?.id || null,
          idempotencyKey: sourceRef,
          retrySafety: "safe_after_review",
          customer_communication_sent: false,
          metadata: {
            operator_name: operatorName,
            task_id: task?.id || null,
            problem_type: problemType,
            internal_only: true,
            source_context: "trello_only",
            customer_communication_sent: false,
          },
        });

        return jsonResponse({
          ok: true,
          actionKey,
          requestId: null,
          task,
          audit,
          idempotencyKey: sourceRef,
          customerCommunicationSent: false,
        });
      }

      const commentText = cleanText(body.trelloCommentText || description, 1800);
      if (!commentText) {
        throw new QuoteValidationError("Trello-Kommentar fehlt.", ["Der Statuskommentar darf nicht leer sein."], 422);
      }
      let trelloComment: Awaited<ReturnType<typeof addTrelloCardComment>>;
      try {
        trelloComment = await addTrelloCardComment({
          cardId: trelloCardIdInput,
          text: commentText,
        });
      } catch (error) {
        if (/Trello API-Konfiguration fehlt/i.test(errorMessage(error))) {
          throw new QuoteValidationError(
            "Trello ist nicht konfiguriert.",
            ["TRELLO_API_KEY/TRELLO_TOKEN fehlen in der Runtime. Der Kommentar wurde nicht geschrieben."],
            503,
          );
        }
        throw error;
      }
      const audit = await recordWorkflowAuditEvent({
        workflowName: "company_brain_fix_center",
        action: "post_trello_status_comment",
        status: "success",
        documentId: `trello:${trelloCardIdInput}`,
        trelloCardId: trelloCardIdInput,
        offerId,
        offerNumber,
        sourceEventId: trelloComment?.id || null,
        idempotencyKey: `company-brain-trello-comment:${trelloCardIdInput}:${sourceRef}`,
        retrySafety: "safe_after_review",
        customer_communication_sent: false,
        metadata: {
          operator_name: operatorName,
          trello_comment_id: trelloComment?.id || null,
          projection_only: true,
          source_context: "trello_only",
          customer_communication_sent: false,
        },
      });

      return jsonResponse({
        ok: true,
        actionKey,
        requestId: null,
        trelloComment,
        audit,
        customerCommunicationSent: false,
      });
    }

    if (!requestId) throw new QuoteValidationError("Request-ID fehlt.", ["Ohne Request-ID wird keine Aktion ausgeführt."], 422);

    const record = await getCustomerRecordByRequestId(requestId);
    const sourceRef = sourceRefFor(actionKey, record.requestId, problemType);
    const title = cleanText(body.title, 160) || `${problemTypeLabel(problemType)}: ${record.requestId}`;
    const description = cleanText(body.description || body.note, 6000) || "Company-Brain-Aktion ohne Beschreibung.";
    const note = cleanText(body.note || description, 6000);
    const trelloCardId = cleanText(trelloCardIdInput || record.request?.trelloCardId, 180) || null;

    let task = null;
    let specialCase = null;
    let savedNote = null;
    let sendResult: Awaited<ReturnType<typeof sendOfferUpdateMail>> | null = null;
    let retryAudit: Awaited<ReturnType<typeof recordWorkflowAuditEvent>> | null = null;
    let actionAudit: Awaited<ReturnType<typeof recordWorkflowAuditEvent>> | null = null;
    let quoteEmailEvidence: { ok: boolean; error?: string; rowId?: string | number | null } | null = null;

    if (actionKey === "open_problem_case") {
      if (record.specialCase.status !== "open") {
        specialCase = await reportCustomerSpecialCase(
          record.requestId,
          {
            kind: specialCaseKind,
            note,
            ownerName: operatorName,
            dueAt: cleanText(body.dueAt, 80) || null,
            urgent: Boolean(body.urgent),
          },
          actor,
        );
      }
      task = await createOpsInternalTask(
        {
          title,
          description,
          status: "open",
          priority: body.urgent ? "urgent" : "high",
          category: "problem",
          assigneeLabel: cleanText(body.assigneeLabel, 120) || operatorName,
          dueAt: cleanText(body.dueAt, 80) || null,
          requestId: record.requestId,
          customerName: record.displayName || record.company || null,
          customerEmail: record.email || null,
          trelloCardId: record.request?.trelloCardId || null,
          sourceApp: "company_brain",
          sourceRef,
          metadata: {
            problem_type: problemType,
            special_case_kind: specialCaseKind,
            company_brain_action: actionKey,
          },
          },
        { operatorName },
      );
      actionAudit = await recordCompanyBrainInternalAudit({
        actionKey,
        status: "success",
        requestId: record.requestId,
        trelloCardId,
        offerId,
        offerNumber,
        sourceRef,
        operatorName,
        taskId: task?.id || null,
        specialCaseCreated: Boolean(specialCase),
        metadata: {
          problem_type: problemType,
          special_case_kind: specialCaseKind,
          task_created: Boolean(task?.id),
        },
      });
    }

    if (
      actionKey === "create_internal_task" ||
      actionKey === "prepare_email_correction" ||
      actionKey === "prepare_offer_retry"
    ) {
      const actionDescription = actionKey === "prepare_email_correction"
        ? [
            description,
            "",
            "Fix Center:",
            `- Aktion: E-Mail/Postfach korrigieren oder verifizieren`,
            `- Empfänger: ${cleanText(body.recipientEmail, 240) || record.email || "unbekannt"}`,
            `- Angebot: ${body.offerNumber || body.offerId || "unbekannt"}`,
            "- Kein Kundenkontakt durch diese Aufgabe.",
          ].join("\n")
        : actionKey === "prepare_offer_retry"
          ? [
              description,
              "",
              "Fix Center:",
              "- Aktion: Angebots-Retry fachlich prüfen und vorbereiten",
              `- Empfänger: ${cleanText(body.recipientEmail, 240) || record.email || "unbekannt"}`,
              `- Angebot: ${body.offerNumber || body.offerId || "unbekannt"}`,
              `- Idempotency: ${cleanText(body.idempotencyKey, 300) || "noch nicht verfügbar"}`,
              "- Versand erst über separate Freigabe auslösen.",
            ].join("\n")
          : description;
      task = await createOpsInternalTask(
        {
          title: actionKey === "prepare_email_correction"
            ? `E-Mail prüfen: ${body.offerNumber || record.requestId}`
            : actionKey === "prepare_offer_retry"
              ? `Angebots-Retry prüfen: ${body.offerNumber || record.requestId}`
              : title,
          description: actionDescription,
          status: "open",
          priority: body.urgent ? "urgent" : "high",
          category: "problem",
          assigneeLabel: cleanText(body.assigneeLabel, 120) || operatorName,
          dueAt: cleanText(body.dueAt, 80) || null,
          requestId: record.requestId,
          customerName: record.displayName || record.company || null,
          customerEmail: record.email || null,
          trelloCardId,
          sourceApp: "company_brain",
          sourceRef,
          metadata: {
            problem_type: problemType,
            company_brain_action: actionKey,
            offer_id: offerId,
            offer_number: offerNumber,
            recipient_email: cleanText(body.recipientEmail, 240) || null,
            idempotency_key: cleanText(body.idempotencyKey, 300) || null,
          },
        },
        { operatorName },
      );
      actionAudit = await recordCompanyBrainInternalAudit({
        actionKey,
        status: "prepared",
        requestId: record.requestId,
        trelloCardId,
        offerId,
        offerNumber,
        sourceRef,
        operatorName,
        taskId: task?.id || null,
        metadata: {
          problem_type: problemType,
          recipient_email: cleanText(body.recipientEmail, 240) || null,
          idempotency_key: cleanText(body.idempotencyKey, 300) || null,
        },
      });
    }

    if (actionKey === "correct_customer_email") {
      const newCustomerEmail = normalizeEmail(body.newCustomerEmail);
      const currentEmail = normalizeEmail(record.email);
      if (!newCustomerEmail || isPlaceholderCustomerEmail(newCustomerEmail) || !isValidEmail(newCustomerEmail)) {
        throw new QuoteValidationError("Neue Kunden-E-Mail ist ungueltig.", ["Bitte eine echte Kunden-E-Mail-Adresse eintragen."], 422);
      }
      if (isInternalNeontripEmail(newCustomerEmail)) {
        throw new QuoteValidationError(
          "Interne E-Mail blockiert.",
          ["Die Kunden-Hauptadresse darf keine interne NEONTRIP-Adresse sein."],
          409,
        );
      }
      if (newCustomerEmail === currentEmail) {
        throw new QuoteValidationError("Keine Aenderung erkannt.", ["Die neue E-Mail entspricht bereits der Kundenakte."], 422);
      }
      const updateResult = await updateCustomerRecord(
        record.requestId,
        { email: newCustomerEmail },
        actor,
      );
      retryAudit = await recordWorkflowAuditEvent({
        workflowName: "company_brain_fix_center",
        action: "correct_customer_email",
        status: "success",
        requestId: record.requestId,
        trelloCardId,
        offerId,
        offerNumber,
        idempotencyKey: `company-brain-email-correction:${record.requestId}:${newCustomerEmail}`,
        retrySafety: "safe_after_review",
        metadata: {
          operator_name: operatorName,
          previous_email: currentEmail || null,
          new_email: newCustomerEmail,
          customer_communication_sent: false,
          next_step: "resolve_again_before_retry",
        },
      });

      return jsonResponse({
        ok: true,
        actionKey,
        requestId: record.requestId,
        record: updateResult.record,
        changedTables: updateResult.changedTables,
        audit: retryAudit,
        customerCommunicationSent: false,
      });
    }

    if (actionKey === "post_trello_status_comment") {
      if (!trelloCardId) {
        throw new QuoteValidationError("Trello-Karte fehlt.", ["Ohne Trello-Card-ID wird kein Kommentar geschrieben."], 422);
      }
      const commentText = cleanText(body.trelloCommentText || description, 1800);
      if (!commentText) {
        throw new QuoteValidationError("Trello-Kommentar fehlt.", ["Der Statuskommentar darf nicht leer sein."], 422);
      }
      let trelloComment: Awaited<ReturnType<typeof addTrelloCardComment>>;
      try {
        trelloComment = await addTrelloCardComment({
          cardId: trelloCardId,
          text: commentText,
        });
      } catch (error) {
        if (/Trello API-Konfiguration fehlt/i.test(errorMessage(error))) {
          throw new QuoteValidationError(
            "Trello ist nicht konfiguriert.",
            ["TRELLO_API_KEY/TRELLO_TOKEN fehlen in der Runtime. Der Kommentar wurde nicht geschrieben."],
            503,
          );
        }
        throw error;
      }
      retryAudit = await recordWorkflowAuditEvent({
        workflowName: "company_brain_fix_center",
        action: "post_trello_status_comment",
        status: "success",
        requestId: record.requestId,
        trelloCardId,
        offerId,
        offerNumber,
        sourceEventId: trelloComment?.id || null,
        idempotencyKey: `company-brain-trello-comment:${trelloCardId}:${sourceRef}`,
        retrySafety: "safe_after_review",
        metadata: {
          operator_name: operatorName,
          trello_comment_id: trelloComment?.id || null,
          customer_communication_sent: false,
          projection_only: true,
        },
      });

      return jsonResponse({
        ok: true,
        actionKey,
        requestId: record.requestId,
        trelloComment,
        audit: retryAudit,
        customerCommunicationSent: false,
      });
    }

    if (actionKey === "repair_trello_projection") {
      if (!trelloCardId) {
        throw new QuoteValidationError("Trello-Karte fehlt.", ["Ohne Trello-Card-ID wird keine Projektion repariert."], 422);
      }

      const recipientEmail = normalizeEmail(body.recipientEmail || record.email);
      const effectiveOfferNumber = normalizeOfferNumber(offerNumber || body.offerNumber);
      const [quoteEmailResult, workflowDeliveryResult, outlookResult] = await Promise.allSettled([
        recipientEmail ? fetchQuoteEmailGuardRows(recipientEmail, effectiveOfferNumber) : Promise.resolve([]),
        fetchWorkflowDeliveryProofRows({ requestId: record.requestId, offerId, trelloCardId }),
        recipientEmail ? fetchOutlookGuardRows(recipientEmail, effectiveOfferNumber) : Promise.resolve([]),
      ]);
      const quoteEmailRows = quoteEmailResult.status === "fulfilled" ? quoteEmailResult.value : [];
      const workflowDeliveryRows = workflowDeliveryResult.status === "fulfilled" ? workflowDeliveryResult.value : [];
      const outlookRows = outlookResult.status === "fulfilled" ? outlookResult.value : [];
      const sendProof = quoteEmailRows.find((row) =>
        Boolean(row.sent_at || /sent|delivered|success|ok/i.test(String(row.status || ""))),
      );
      const workflowRowsForCase = workflowDeliveryRows
        .filter((row) => workflowAuditMatchesProjectionCase(row, { requestId: record.requestId, offerId }))
        .sort((left, right) => (occurredAtMs(right.created_at) || 0) - (occurredAtMs(left.created_at) || 0));
      const workflowSendProofCandidate = workflowRowsForCase.find(isSuccessfulDeliveryAudit) || null;
      const latestWorkflowFailure = workflowRowsForCase.find(isFailedWorkflowAudit) || null;
      const workflowSendProofTime = occurredAtMs(workflowSendProofCandidate?.created_at);
      const latestWorkflowFailureTime = occurredAtMs(latestWorkflowFailure?.created_at);
      const workflowSendProof = workflowSendProofCandidate && (
        !latestWorkflowFailure ||
        (workflowSendProofTime !== null &&
          latestWorkflowFailureTime !== null &&
          workflowSendProofTime >= latestWorkflowFailureTime)
      ) ? workflowSendProofCandidate : null;
      const hasRecordSendProof = Boolean(record.quote?.sentAt);
      const sendProofAt = sendProof?.sent_at || record.quote?.sentAt || sendProof?.created_at || workflowSendProof?.created_at || null;
      const latestDeliveryFailure = outlookRows.find((row) =>
        isDeliveryFailureText(`${row.subject || ""} ${row.body_preview || ""}`),
      ) || null;
      const deliveryFailureAt = latestDeliveryFailure?.received_at || latestDeliveryFailure?.sent_at || latestDeliveryFailure?.created_at || null;
      const sendProofTime = occurredAtMs(sendProofAt);
      const deliveryFailureTime = occurredAtMs(deliveryFailureAt);
      const deliveryFailureAfterProof = Boolean(
        latestDeliveryFailure &&
        (!sendProofTime || !deliveryFailureTime || deliveryFailureTime >= sendProofTime),
      );

      if (recipientEmail && outlookResult.status === "rejected") {
        throw new QuoteValidationError(
          "Outlook-Zustellstatus ist derzeit nicht lesbar.",
          ["Trello-Projektion wurde nicht geändert. Outlook-Spiegel erneut prüfen."],
          503,
        );
      }

      if (!sendProof && !hasRecordSendProof && !workflowSendProof && quoteEmailResult.status === "rejected" && workflowDeliveryResult.status === "rejected") {
        throw new QuoteValidationError(
          "Versandbelege sind derzeit nicht lesbar.",
          ["Trello-Projektion wurde nicht geändert. quote_email_log und workflow_audit_log erneut prüfen."],
          503,
        );
      }

      if (deliveryFailureAfterProof) {
        retryAudit = await recordWorkflowAuditEvent({
          workflowName: "company_brain_fix_center",
          action: "repair_trello_projection",
          status: "blocked",
          requestId: record.requestId,
          trelloCardId,
          offerId,
          offerNumber: effectiveOfferNumber || offerNumber,
          idempotencyKey: `company-brain-trello-projection:${record.requestId}:${trelloCardId}`,
          retrySafety: "blocked",
          customer_communication_sent: false,
          errorMessage: "Spaeterer Zustellfehler blockiert Trello-Projektionsreparatur.",
          metadata: {
            operator_name: operatorName,
            projection_only: true,
            customer_communication_sent: false,
            blocker: "delivery_failure_after_send_proof",
            delivery_failure_at: deliveryFailureAt,
          },
        });
        return jsonResponse(
          {
            ok: false,
            actionKey,
            requestId: record.requestId,
            error: "Trello-Projektion blockiert.",
            code: "delivery_failure_after_send_proof",
            blockers: ["Ein späterer Outlook-Zustellfehler ist vorhanden. Trello wird nicht auf 'Angebot gesendet' repariert."],
            audit: retryAudit,
            customerCommunicationSent: false,
          },
          { status: 409 },
        );
      }

      if (!sendProof && !hasRecordSendProof && !workflowSendProof) {
        retryAudit = await recordWorkflowAuditEvent({
          workflowName: "company_brain_fix_center",
          action: "repair_trello_projection",
          status: "blocked",
          requestId: record.requestId,
          trelloCardId,
          offerId,
          offerNumber: effectiveOfferNumber || offerNumber,
          idempotencyKey: `company-brain-trello-projection:${record.requestId}:${trelloCardId}`,
          retrySafety: "blocked",
          customer_communication_sent: false,
          errorMessage: "Kein Versandbeleg fuer Trello-Projektionsreparatur.",
          metadata: {
            operator_name: operatorName,
            projection_only: true,
            customer_communication_sent: false,
            blocker: "missing_send_proof",
          },
        });
        return jsonResponse(
          {
            ok: false,
            actionKey,
            requestId: record.requestId,
            error: "Trello-Projektion blockiert.",
            code: "missing_send_proof",
            blockers: ["Kein Versandbeleg gefunden. Trello wird nicht als Source of Truth repariert."],
            audit: retryAudit,
            customerCommunicationSent: false,
          },
          { status: 409 },
        );
      }

      let trelloContext: Awaited<ReturnType<typeof getTrelloFailureContext>>;
      try {
        trelloContext = await getTrelloFailureContext(trelloCardId);
      } catch (error) {
        if (/Trello API-Konfiguration fehlt/i.test(errorMessage(error))) {
          throw new QuoteValidationError(
            "Trello ist nicht konfiguriert.",
            ["TRELLO_API_KEY/TRELLO_TOKEN fehlen in der Runtime. Die Projektion wurde nicht geändert."],
            503,
          );
        }
        throw error;
      }

      const currentName = cleanText(trelloContext.card.name, 300);
      const repairedName = stripTrelloFailurePrefix(currentName);
      let renamed = false;
      if (repairedName && currentName && repairedName !== currentName) {
        await updateTrelloCard(trelloCardId, { name: repairedName });
        renamed = true;
      }

      const currentLabels = trelloContext.card.labels || [];
      const hasOfferSentLabel = currentLabels.some((label) => isOfferSentTrelloLabelName(label.name));
      let addedOfferSentLabel = false;
      let offerSentLabelId: string | null = null;
      if (!hasOfferSentLabel && trelloContext.card.idBoard) {
        const boardLabels = await getTrelloBoardLabels(trelloContext.card.idBoard);
        const offerSentLabel = boardLabels.find((label) => isOfferSentTrelloLabelName(label.name)) || null;
        if (offerSentLabel?.id) {
          await addTrelloCardLabel({ cardId: trelloCardId, labelId: offerSentLabel.id });
          addedOfferSentLabel = true;
          offerSentLabelId = offerSentLabel.id;
        }
      }

      let trelloComment: Awaited<ReturnType<typeof addTrelloCardComment>> | null = null;
      if (renamed || addedOfferSentLabel) {
        trelloComment = await addTrelloCardComment({
          cardId: trelloCardId,
          text: [
            "NEONTRIP Company Brain - Trello-Projektion bereinigt",
            "",
            renamed ? `Titel bereinigt: ${currentName} -> ${repairedName}` : null,
            addedOfferSentLabel ? "Tag gesetzt: Angebot gesendet" : null,
            `Versandbeleg: ${sendProofAt || "vorhanden"}`,
            "",
            "Hinweis: Trello ist nur Projektion. Source of Truth bleibt Kundenakte/Angebot/Outlook/Audit. Kein Kundenkontakt durch diese Aktion.",
          ].filter((line): line is string => Boolean(line)).join("\n"),
        });
      }

      let auditWarning: string | null = null;
      try {
        retryAudit = await recordWorkflowAuditEvent({
          workflowName: "company_brain_fix_center",
          action: "repair_trello_projection",
          status: renamed || addedOfferSentLabel ? "success" : "prepared",
          requestId: record.requestId,
          trelloCardId,
          offerId,
          offerNumber: effectiveOfferNumber || offerNumber,
          sourceEventId: trelloComment?.id || null,
          idempotencyKey: `company-brain-trello-projection:${record.requestId}:${trelloCardId}`,
          retrySafety: "safe_after_review",
          customer_communication_sent: false,
          metadata: {
            operator_name: operatorName,
            projection_only: true,
            customer_communication_sent: false,
            previous_name: currentName || null,
            repaired_name: renamed ? repairedName : null,
            renamed,
            added_offer_sent_label: addedOfferSentLabel,
            offer_sent_label_id: offerSentLabelId,
            send_proof: sendProofAt,
            send_proof_source: workflowSendProof ? "workflow_audit_log" : sendProof ? "quote_email_log" : "customer_record",
            workflow_delivery_audit_id: workflowSendProof?.id || null,
            trello_comment_id: trelloComment?.id || null,
          },
        });
      } catch (auditError) {
        console.error("company brain trello projection changed but audit confirmation failed", auditError);
        auditWarning = "Trello wurde aktualisiert, aber der interne Audit konnte nicht bestaetigt werden. Aktion nicht wiederholen.";
      }

      return jsonResponse({
        ok: true,
        actionKey,
        requestId: record.requestId,
        trelloProjectionRepair: {
          cardId: trelloCardId,
          previousName: currentName || null,
          repairedName: renamed ? repairedName : currentName || null,
          renamed,
          addedOfferSentLabel,
          offerSentLabelId,
          trelloComment,
        },
        audit: retryAudit,
        auditWarning,
        customerCommunicationSent: false,
      });
    }

    if (actionKey === "guarded_offer_resend") {
      if (!offerId) {
        throw new QuoteValidationError("Offer-ID fehlt.", ["Ohne eindeutige Offer-ID wird kein Versand ausgeführt."], 422);
      }
      const offer = await getOfferById(offerId);
      const recordEmail = normalizeEmail(record.email);
      const offerEmail = normalizeEmail(offer.offer.customerEmail);
      const offerRequestId = cleanText(offer.requestId || offer.request_id, 180);
      const recipientEmail = normalizeEmail(body.recipientEmail || record.email || offer.offer.customerEmail);
      const blockers: string[] = [];

      if (!recipientEmail || isPlaceholderCustomerEmail(recipientEmail) || !isValidEmail(recipientEmail)) {
        blockers.push("Keine gültige Kunden-E-Mail für den Retry vorhanden.");
      }
      if (recipientEmail && isInternalNeontripEmail(recipientEmail)) {
        blockers.push("Empfängeradresse ist intern; Retry an NEONTRIP-Adresse blockiert.");
      }
      if (offerRequestId && offerRequestId !== record.requestId) {
        blockers.push(`Angebot gehört zu Request ${offerRequestId}, Kundenakte zu ${record.requestId}.`);
      }
      if (offer.trelloCardId && trelloCardId && offer.trelloCardId !== trelloCardId) {
        blockers.push(`Angebot gehört zu Trello-Karte ${offer.trelloCardId}, Fallprüfung zu ${trelloCardId}.`);
      }
      if (offerEmail && recordEmail && offerEmail !== recordEmail) {
        blockers.push(`Angebot gehört zu ${offer.offer.customerEmail}, Kundenakte zu ${record.email}.`);
      }
      if (offerEmail && recipientEmail && offerEmail !== recipientEmail) {
        blockers.push(`Empfänger ${recipientEmail} passt nicht zur Angebotsadresse ${offer.offer.customerEmail}.`);
      }

      const effectiveOfferNumber = normalizeOfferNumber(offer.offerNumber || offerNumber) || offerNumber;
      const quoteEmailRows = recipientEmail
        ? await fetchQuoteEmailGuardRows(recipientEmail, effectiveOfferNumber)
        : [];
      const outlookRows = recipientEmail
        ? await fetchOutlookGuardRows(recipientEmail, effectiveOfferNumber)
        : [];
      const duplicateSend = quoteEmailRows.find((row) =>
        Boolean(row.sent_at || /sent|delivered|success|ok/i.test(String(row.status || ""))),
      );
      const bounceForRecipient = outlookRows.find((row) => isDeliveryFailureText(`${row.subject || ""} ${row.body_preview || ""}`));
      const outboundForRecipient = outlookRows.find((row) =>
        row.direction === "outbound" && !isDeliveryFailureText(`${row.subject || ""} ${row.body_preview || ""}`),
      );

      if (duplicateSend) {
        blockers.push(`Versandbeleg existiert bereits (${duplicateSend.sent_at || duplicateSend.created_at || "ohne Zeit"}).`);
      }
      if (outboundForRecipient) {
        blockers.push(`Outlook-Spiegel zeigt bereits eine ausgehende Mail (${outboundForRecipient.sent_at || outboundForRecipient.created_at || "ohne Zeit"}).`);
      }
      if (bounceForRecipient) {
        blockers.push("Outlook-Bounce liegt für die aktuelle Empfängeradresse vor; Adresse/Postfach zuerst korrigieren.");
      }

      const idempotencyKey = cleanText(body.idempotencyKey, 300) || `company-brain-offer-resend:${offer.offerId}:${recipientEmail}`;
      if (blockers.length) {
        retryAudit = await recordCompanyBrainRetryAudit({
          status: "blocked",
          requestId: record.requestId,
          trelloCardId: trelloCardId || offer.trelloCardId,
          offerId: offer.offerId,
          offerNumber: effectiveOfferNumber,
          recipientEmail,
          idempotencyKey,
          operatorName,
          errorMessage: blockers.join(" "),
          blockers,
        });
        return jsonResponse(
          {
            ok: false,
            actionKey,
            requestId: record.requestId,
            error: "Retry blockiert.",
            code: "company_brain_retry_blocked",
            blockers,
            audit: retryAudit,
            customerCommunicationSent: false,
          },
          { status: 409 },
        );
      }

      const sendInput: OpsOfferSendInput = {
        recipientEmail,
        cc: [],
        subject: cleanText(body.subject, 200) || "Ihr aktualisiertes NEONTRIP Angebot",
        message: cleanText(body.message, 4000) || "Hallo,\n\nwie besprochen haben wir Ihr Angebot aktualisiert.\n\nViele Grüße\nNEONTRIP",
        actor: operatorName || "Company Brain",
        reason: "Company Brain guarded retry after failed Trello/n8n offer send.",
        idempotencyKey,
      };
      sendResult = await sendOfferUpdateMail(offer.offerId, sendInput);
      let opsSync: Awaited<ReturnType<typeof recordOfferSentForSalesCalls>> | { ok: boolean; error?: string; skipped?: boolean } | null = sendResult.opsSync || null;
      if (!opsSync) {
        try {
          opsSync = await recordOfferSentForSalesCalls({
            requestId: record.requestId,
            trelloCardId: trelloCardId || offer.trelloCardId,
            offerId: offer.offerId,
            offerNumber: offer.offerNumber,
            documentReference: offer.documentReference,
            publicUrl: offer.publicUrl,
            recipientEmail,
            sentAt: new Date().toISOString(),
            source: "company_brain_guarded_retry",
            sourceEventId: sendResult.eventId,
            idempotencyKey: `company-brain-offer-resend:${offer.offerId}:${idempotencyKey}`,
            actor: sendInput.actor,
            payload: {
              duplicate: sendResult.duplicate,
              reason: sendInput.reason,
              subject: sendInput.subject,
              direction: "outbound",
              subtype: "quote_retry",
            },
          });
        } catch (syncError) {
          console.error("company brain offer retry sent but ops sync failed", syncError);
          opsSync = { ok: false, error: syncError instanceof Error ? syncError.message : "ops_sync_failed" };
        }
      }
      try {
        const evidenceRows = await recordQuoteEmailSentEvidence({
          offerId: offer.offerId,
          offerNumber: offer.offerNumber,
          requestId: record.requestId,
          trelloCardId: trelloCardId || offer.trelloCardId,
          recipientEmail,
          subject: sendInput.subject,
          status: sendResult.duplicate ? "sent_duplicate" : "sent",
          sentAt: new Date().toISOString(),
          sourceEventId: sendResult.eventId,
          idempotencyKey,
        });
        quoteEmailEvidence = { ok: true, rowId: evidenceRows?.[0]?.id || null };
      } catch (evidenceError) {
        console.error("company brain offer retry sent but quote_email_log evidence failed", evidenceError);
        quoteEmailEvidence = { ok: false, error: errorMessage(evidenceError) };
      }
      retryAudit = await recordCompanyBrainRetryAudit({
        status: sendResult.duplicate ? "duplicate" : "sent",
        requestId: record.requestId,
        trelloCardId: trelloCardId || offer.trelloCardId,
        offerId: offer.offerId,
        offerNumber: effectiveOfferNumber,
        recipientEmail,
        idempotencyKey,
        operatorName,
        eventId: sendResult.eventId,
      });

      return jsonResponse({
        ok: true,
        actionKey,
        requestId: record.requestId,
        sent: sendResult.sent,
        duplicate: sendResult.duplicate,
        eventId: sendResult.eventId,
        opsSync,
        quoteEmailEvidence,
        audit: retryAudit,
        customerCommunicationSent: true,
      });
    }

    if (actionKey === "save_case_note") {
      savedNote = await addCustomerOpsNote(
        record.requestId,
        {
          note,
          kind: "note",
          assigneeLabel: cleanText(body.assigneeLabel, 120) || null,
        },
        actor,
      );
      actionAudit = await recordCompanyBrainInternalAudit({
        actionKey,
        status: "success",
        requestId: record.requestId,
        trelloCardId,
        offerId,
        offerNumber,
        sourceRef: savedNote?.id ? `${sourceRef}:note:${savedNote.id}` : sourceRef,
        operatorName,
        noteId: savedNote?.id || null,
        metadata: {
          problem_type: problemType,
          note_kind: "note",
        },
      });
    }

    return jsonResponse({
      ok: true,
      actionKey,
      requestId: record.requestId,
      task,
      note: savedNote,
      specialCase,
      audit: actionAudit,
      idempotencyKey: sourceRef,
      customerCommunicationSent: false,
    });
  } catch (error) {
    return failureResponse(error);
  }
}
