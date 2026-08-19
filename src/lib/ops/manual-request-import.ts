import { createHash, randomUUID } from "node:crypto";
import {
  createTrelloCard,
  findTrelloCustomFieldByName,
  updateTrelloCustomField,
} from "@/lib/quotes/trello";
import { isValidEmail, normalizeEmail } from "@/lib/quotes/customer";
import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";
import {
  getCustomerSegmentOption,
  isManualRequestSegmentSource,
  type CustomerSegmentCode,
} from "@/lib/ops/customer-segments";
import { setAuthoritativeManualRequestSegment } from "@/lib/ops/manual-request-segment-rpc";
import { taskTitle, upsertSalesTask } from "@/lib/ops/sales-task-engine";
import {
  buildMockupTrelloDescription,
  type MockupContextInput,
} from "@/lib/ops/mockup-context";

type ManualImportCustomerRow = {
  id: string;
  email: string;
  billing_email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  company?: string | null;
  company_name?: string | null;
  name?: string | null;
  request_id?: string | null;
};

type ManualImportRequestRow = {
  id: string;
  request_id: string;
  customer_id?: string | null;
  trello_card_id?: string | null;
  trello_card_url?: string | null;
  segment?: string | null;
  s_kategorie?: string | null;
  segment_status?: string | null;
  segment_confidence?: number | null;
  segment_source?: string | null;
  attribution_raw?: Record<string, unknown> | null;
};

type ExistingManualImport = {
  request: ManualImportRequestRow;
  coreCompleted: boolean;
};

type ManualImportAuditRow = {
  metadata?: {
    request_id?: string;
    idempotency_key?: string;
  } | null;
};

export type ManualRequestImportInput = {
  idempotencyKey?: string | null;
  customer?: {
    firstName?: string | null;
    lastName?: string | null;
    company?: string | null;
    email?: string | null;
    phone?: string | null;
    country?: string | null;
  };
  request?: {
    title?: string | null;
    description?: string | null;
    product?: string | null;
    size?: string | null;
    color?: string | null;
    application?: string | null;
    deliveryTime?: string | null;
    customerType?: string | null;
    segment?: string | null;
    priority?: "standard" | "important" | "vip" | null;
    dueAt?: string | null;
  };
  trello?: {
    createCard?: boolean;
    listId?: string | null;
  };
  operatorName?: string | null;
};

export type ManualRequestImportActor = {
  host?: string | null;
  mode?: "local_bypass" | "ops_session";
  userAgent?: string | null;
  operatorName?: string | null;
};

export type ManualRequestImportResult = {
  requestId: string;
  customerId: string;
  customerCreated: boolean;
  requestCreated: boolean;
  salesTaskCreated: boolean;
  trello: {
    requested: boolean;
    ok: boolean;
    cardId: string | null;
    cardUrl: string | null;
    customFieldSet: boolean;
    usageFieldSet: boolean;
    usageFieldError: string | null;
    offerCustomerFieldsSet: string[];
    offerCustomerFieldWarnings: string[];
    error: string | null;
  };
  warnings: string[];
};

const DEFAULT_MANUAL_TRELLO_LIST_ID = "64ca588f8bd547afc087a6ea";
const MANUAL_IMPORT_SOURCE = "ops_manual_import";
const INTERNAL_EMAIL_DOMAINS = new Set(["neontrip.de", "angebote.neontrip.de", "fuajob.online"]);
const NERDY_FORMS_CUSTOM_FIELD_NAMES = [
  "nerdy-forms-id",
  "nerdy_forms_id",
  "nerdyforms_id",
  "nerdyform_id",
  "Nerdy-Forms-ID",
  "Nerdy Forms ID",
  "NerdyForms ID",
  "request_id",
];

function trimNullable(value: unknown) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || null;
}

function normalizePhone(value: unknown) {
  const normalized = String(value ?? "").replace(/[^\d+]/g, "").trim();
  return normalized || null;
}

function normalizePriority(value: unknown): "standard" | "important" | "vip" {
  if (value === "vip") return "vip";
  if (value === "important") return "important";
  return "standard";
}

export function manualRequestSegmentationInsertState() {
  return {
    segment: null,
    s_kategorie: null,
    segment_status: "pending" as const,
    segment_confidence: null,
    segment_source: null,
    segment_classified_at: null,
    segment_policy_version: null,
  };
}

export function resolveExplicitManualRequestSegment(segment: unknown) {
  const normalized = trimNullable(segment);
  if (!normalized) return null;
  const option = getCustomerSegmentOption(normalized);
  if (!option) {
    throw new QuoteValidationError("Unbekanntes Segment fuer die manuelle Anfrage.");
  }
  return option.segment;
}

function manualImportPayloadFingerprint(
  input: ManualRequestImportInput,
  email: string,
  phone: string | null,
  explicitSegment: CustomerSegmentCode | null,
) {
  const payload = {
    customer: {
      firstName: trimNullable(input.customer?.firstName),
      lastName: trimNullable(input.customer?.lastName),
      company: trimNullable(input.customer?.company),
      email,
      phone,
      country: trimNullable(input.customer?.country) || "DE",
    },
    request: {
      title: trimNullable(input.request?.title),
      description: trimNullable(input.request?.description),
      product: trimNullable(input.request?.product),
      size: trimNullable(input.request?.size),
      color: trimNullable(input.request?.color),
      application: trimNullable(input.request?.application),
      deliveryTime: trimNullable(input.request?.deliveryTime),
      customerType: trimNullable(input.request?.customerType),
      segment: explicitSegment,
      priority: normalizePriority(input.request?.priority),
      dueAt: trimNullable(input.request?.dueAt),
    },
    trello: {
      createCard: Boolean(input.trello?.createCard),
      listId: trimNullable(input.trello?.listId),
    },
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function assertManualImportRetryMatches(
  request: ManualImportRequestRow,
  payloadFingerprint: string,
  explicitSegment: CustomerSegmentCode | null,
) {
  const attribution = request.attribution_raw || {};
  const frozenFingerprint = trimNullable(attribution.manual_import_payload_hash);
  const frozenSegment = trimNullable(attribution.manual_segment_candidate);
  const frozenDueAt = trimNullable(attribution.manual_import_due_at);
  if (
    !frozenFingerprint
    || frozenFingerprint !== payloadFingerprint
    || frozenSegment !== explicitSegment
    || !frozenDueAt
  ) {
    throw new QuoteValidationError(
      "Idempotency-Key gehoert zu einer anderen manuellen Anfrage.",
      ["Der vorhandene Import darf mit geaenderten Daten oder einem geaenderten Segment nicht fortgesetzt werden."],
      409,
    );
  }
  return {
    dueAt: normalizeDueAt(frozenDueAt),
    customerCreated: attribution.manual_import_customer_created === true,
  };
}

export function resolveManualCustomerRequestId(
  existingRequestId: unknown,
  nextRequestId: string,
  existingRequestFound: boolean,
) {
  void existingRequestId;
  void existingRequestFound;
  return nextRequestId;
}

function normalizeDueAt(value: unknown) {
  const normalized = trimNullable(value);
  if (!normalized) return new Date().toISOString();
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) {
    throw new QuoteValidationError("Ungueltige Faelligkeit fuer den ersten Anruf.", ["dueAt ist kein gueltiges Datum."]);
  }
  return parsed.toISOString();
}

function isInternalEmail(email: string) {
  const domain = email.split("@")[1]?.toLowerCase();
  return domain ? INTERNAL_EMAIL_DOMAINS.has(domain) : false;
}

function looseFieldValueKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9äöüß]/g, "");
}

function displayName(input: ManualRequestImportInput) {
  const firstName = trimNullable(input.customer?.firstName);
  const lastName = trimNullable(input.customer?.lastName);
  const company = trimNullable(input.customer?.company);
  return [firstName, lastName].filter(Boolean).join(" ") || company || "Manueller Kontakt";
}

function requestTitle(input: ManualRequestImportInput) {
  return trimNullable(input.request?.title) || `${displayName(input)} | manuelle Anfrage`;
}

function trelloDescription(input: ManualRequestImportInput, requestId: string) {
  return buildMockupTrelloDescription({
    ...mockupContextInput(input),
    requestId,
  });
}

function mockupContextInput(input: ManualRequestImportInput): MockupContextInput {
  return {
    customerCompany: input.customer?.company,
    customerEmail: input.customer?.email,
    requestTitle: input.request?.title,
    requestDescription: input.request?.description,
    product: input.request?.product,
    size: input.request?.size,
    color: input.request?.color,
    usage: input.request?.application,
    backboard: "Rueckplatte laut Angebot",
    customerType: input.request?.customerType,
    manualSegment: input.request?.segment,
  };
}

const MANUAL_IMPORT_REQUEST_SELECT = [
  "id",
  "request_id",
  "customer_id",
  "trello_card_id",
  "trello_card_url",
  "segment",
  "s_kategorie",
  "segment_status",
  "segment_confidence",
  "segment_source",
  "attribution_raw",
].join(",");

async function findExistingImportByIdempotencyKey(idempotencyKey: string): Promise<ExistingManualImport | null> {
  const rows = await supabaseRequest<ManualImportAuditRow[]>("workflow_audit_log", undefined, {
    select: "metadata",
    workflow_name: "eq.customer_records_manual_import",
    action: "eq.manual_request_imported",
    "metadata->>idempotency_key": `eq.${idempotencyKey}`,
    order: "created_at.desc",
    limit: 1,
  });
  const auditedRequestId = trimNullable(rows[0]?.metadata?.request_id);
  if (auditedRequestId) {
    const requests = await supabaseRequest<ManualImportRequestRow[]>("master_requests", undefined, {
      select: MANUAL_IMPORT_REQUEST_SELECT,
      request_id: `eq.${auditedRequestId}`,
      limit: 1,
    });
    if (requests[0]) return { request: requests[0], coreCompleted: true };
  }

  const requests = await supabaseRequest<ManualImportRequestRow[]>("master_requests", undefined, {
    select: MANUAL_IMPORT_REQUEST_SELECT,
    form_id: "eq.manual_ops_import",
    "attribution_raw->>idempotency_key": `eq.${idempotencyKey}`,
    order: "created_at.desc",
    limit: 1,
  });
  return requests[0] ? { request: requests[0], coreCompleted: false } : null;
}

async function auditManualImport(input: {
  requestId: string;
  action: string;
  status?: "success" | "warning" | "error";
  errorMessage?: string | null;
  metadata: Record<string, unknown>;
}) {
  await supabaseRequest("workflow_audit_log", {
    method: "POST",
    body: JSON.stringify({
      document_id: input.requestId,
      workflow_name: "customer_records_manual_import",
      action: input.action,
      status: input.status || "success",
      error_message: input.errorMessage || null,
      metadata: input.metadata,
    }),
    headers: { Prefer: "return=minimal" },
  });
}

async function findCustomerByEmail(email: string) {
  const rows = await supabaseRequest<ManualImportCustomerRow[]>("master_customers", undefined, {
    select: "id,email,billing_email,first_name,last_name,phone,company,company_name,name,request_id",
    email: `eq.${email}`,
    limit: 1,
  });
  return rows[0] || null;
}

async function findCustomerByPhone(phone: string | null) {
  if (!phone) return null;
  const rows = await supabaseRequest<ManualImportCustomerRow[]>("master_customers", undefined, {
    select: "id,email,billing_email,first_name,last_name,phone,company,company_name,name,request_id",
    or: `(phone.eq.${encodeURIComponent(phone)},original_phone.eq.${encodeURIComponent(phone)})`,
    limit: 1,
  });
  return rows[0] || null;
}

async function requestExists(requestId: string | null) {
  if (!requestId) return false;
  const rows = await supabaseRequest<Array<{ request_id: string }>>("master_requests", undefined, {
    select: "request_id",
    request_id: `eq.${requestId}`,
    limit: 1,
  });
  return Boolean(rows[0]?.request_id);
}

async function upsertCustomer(input: ManualRequestImportInput, email: string, phone: string | null, requestId: string) {
  const existing = await findCustomerByEmail(email);
  const existingRequestFound = existing?.request_id ? await requestExists(existing.request_id) : false;
  const customerRequestId = resolveManualCustomerRequestId(existing?.request_id, requestId, existingRequestFound);
  const customerPatch = {
    email,
    billing_email: email,
    original_email: email,
    first_name: trimNullable(input.customer?.firstName),
    last_name: trimNullable(input.customer?.lastName),
    phone,
    original_phone: phone,
    company: trimNullable(input.customer?.company),
    company_name: trimNullable(input.customer?.company),
    name: displayName(input),
    country: trimNullable(input.customer?.country) || "DE",
    source: MANUAL_IMPORT_SOURCE,
    request_id: customerRequestId,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const rows = await supabaseRequest<ManualImportCustomerRow[]>(
      "master_customers",
      {
        method: "PATCH",
        body: JSON.stringify(customerPatch),
        headers: { Prefer: "return=representation" },
      },
      { id: `eq.${existing.id}` },
    );
    return { row: rows[0] || existing, created: false };
  }

  const rows = await supabaseRequest<ManualImportCustomerRow[]>("master_customers", {
    method: "POST",
    body: JSON.stringify({
      ...customerPatch,
      total_requests: 1,
      total_orders: 0,
      total_revenue: 0,
    }),
    headers: { Prefer: "return=representation" },
  });
  return { row: rows[0], created: true };
}

async function insertContactHistory(customerId: string, type: "email" | "phone", value: string | null) {
  if (!value) return;
  const existing = await supabaseRequest<Array<{ id: string }>>("customer_contact_history", undefined, {
    select: "id",
    customer_id: `eq.${customerId}`,
    type: `eq.${type}`,
    value: `eq.${value}`,
    limit: 1,
  });
  if (existing[0]?.id) return;
  await supabaseRequest("customer_contact_history", {
    method: "POST",
    body: JSON.stringify({
      customer_id: customerId,
      type,
      value,
      source: MANUAL_IMPORT_SOURCE,
    }),
    headers: { Prefer: "return=minimal" },
  });
}

async function insertManualRequest(
  input: ManualRequestImportInput,
  customerId: string,
  requestId: string,
  idempotencyKey: string,
  frozen: {
    payloadFingerprint: string;
    explicitSegment: CustomerSegmentCode | null;
    dueAt: string;
    customerCreated: boolean;
  },
) {
  const rows = await supabaseRequest<ManualImportRequestRow[]>("master_requests", {
    method: "POST",
    body: JSON.stringify({
      customer_id: customerId,
      request_id: requestId,
      title: requestTitle(input),
      description: trimNullable(input.request?.description),
      ...manualRequestSegmentationInsertState(),
      status: "new",
      deal_status: "open",
      size: trimNullable(input.request?.size),
      color: trimNullable(input.request?.color) ? [trimNullable(input.request?.color)] : [],
      application: trimNullable(input.request?.application),
      delivery_time: trimNullable(input.request?.deliveryTime),
      customer_type: trimNullable(input.request?.customerType),
      country: trimNullable(input.customer?.country) || "DE",
      form_id: "manual_ops_import",
      referrer: "ops_customer_records",
      attribution_raw: {
        source: MANUAL_IMPORT_SOURCE,
        idempotency_key: idempotencyKey,
        manual_import_payload_hash: frozen.payloadFingerprint,
        manual_segment_candidate: frozen.explicitSegment,
        manual_import_due_at: frozen.dueAt,
        manual_import_customer_created: frozen.customerCreated,
        auto_reply_suppressed: true,
        created_by: trimNullable(input.operatorName),
        product: trimNullable(input.request?.product),
      },
    }),
    headers: { Prefer: "return=representation" },
  });
  return rows[0];
}

async function projectToTrello(input: ManualRequestImportInput, requestId: string) {
  if (!input.trello?.createCard) {
    return {
      requested: false,
      ok: false,
      cardId: null,
      cardUrl: null,
      customFieldSet: false,
      usageFieldSet: false,
      usageFieldError: null,
      offerCustomerFieldsSet: [],
      offerCustomerFieldWarnings: [],
      error: null,
    };
  }

  const listId = trimNullable(input.trello.listId) || process.env.OPS_MANUAL_IMPORT_TRELLO_LIST_ID || DEFAULT_MANUAL_TRELLO_LIST_ID;
  const card = await createTrelloCard({
    listId,
    name: requestTitle(input),
    desc: trelloDescription(input, requestId),
  });
  const boardId = card.idBoard;
  if (!boardId) {
    throw new Error("Trello Board-ID fehlt nach Kartenerstellung.");
  }
  const field = await findTrelloCustomFieldByName(boardId, NERDY_FORMS_CUSTOM_FIELD_NAMES);
  const customFieldError = field ? null : "Trello Custom Field nerdyforms_id wurde nicht gefunden.";
  if (field) {
    await updateTrelloCustomField({
      cardId: card.id,
      fieldId: field.id,
      type: field.type || "text",
      value: requestId,
    });
  }

  let usageFieldSet = false;
  let usageFieldError: string | null = null;
  const usage = trimNullable(input.request?.application);
  if (usage) {
    const usageField = await findTrelloCustomFieldByName(boardId, ["Usage"]);
    if (!usageField) {
      usageFieldError = "Trello Custom Field Usage wurde nicht gefunden.";
    } else {
      let usageValue: string | boolean | null = usage;
      if (usageField.type === "list") {
        const usageKey = looseFieldValueKey(usage);
        const option = (usageField.options || []).find((candidate) => {
          const label = String(candidate.value?.text || "");
          return looseFieldValueKey(label) === usageKey;
        });
        if (option?.id) {
          usageValue = option.id;
        } else {
          usageValue = null;
          usageFieldError = `Usage-Option "${usage}" wurde auf dem Trello-Board nicht gefunden.`;
        }
      }

      if (usageValue !== null) {
        await updateTrelloCustomField({
          cardId: card.id,
          fieldId: usageField.id,
          type: usageField.type || "text",
          value: usageValue,
        });
        usageFieldSet = true;
      }
    }
  }

  const offerCustomerFieldsSet: string[] = [];
  const offerCustomerFieldWarnings: string[] = [];
  const customerOfferFields: Array<{ names: string[]; value: string | null }> = [
    {
      names: ["customer_email", "customer email", "kunden email", "kunden e-mail", "e-mail", "email"],
      value: normalizeEmail(trimNullable(input.customer?.email) || ""),
    },
    {
      names: ["customer_first_name", "customer first name", "first_name", "vorname", "kunden vorname"],
      value: trimNullable(input.customer?.firstName),
    },
    {
      names: ["customer_last_name", "customer last name", "last_name", "nachname", "kunden nachname"],
      value: trimNullable(input.customer?.lastName),
    },
    {
      names: ["customer_phone", "customer phone", "phone", "telefon", "kunden telefon"],
      value: normalizePhone(input.customer?.phone),
    },
    {
      names: ["customer_company", "customer company", "company", "firma", "kunden firma"],
      value: trimNullable(input.customer?.company),
    },
  ];

  for (const customerField of customerOfferFields) {
    if (!customerField.value) continue;
    const offerField = await findTrelloCustomFieldByName(boardId, customerField.names);
    const canonicalName = customerField.names[0] || "customer_field";
    if (!offerField) {
      offerCustomerFieldWarnings.push(`Trello Custom Field ${canonicalName} wurde nicht gefunden.`);
      continue;
    }
    await updateTrelloCustomField({
      cardId: card.id,
      fieldId: offerField.id,
      type: offerField.type || "text",
      value: customerField.value,
    });
    offerCustomerFieldsSet.push(offerField.name || canonicalName);
  }

  return {
    requested: true,
    ok: true,
    cardId: card.id,
    cardUrl: card.url || card.shortUrl || null,
    customFieldSet: Boolean(field),
    usageFieldSet,
    usageFieldError,
    offerCustomerFieldsSet,
    offerCustomerFieldWarnings,
    error: customFieldError,
  };
}

async function patchRequestTrelloProjection(requestId: string, trello: { cardId: string | null; cardUrl: string | null }) {
  if (!trello.cardId && !trello.cardUrl) return;
  await supabaseRequest("master_requests", {
    method: "PATCH",
    body: JSON.stringify({
      trello_card_id: trello.cardId,
      trello_card_url: trello.cardUrl,
      updated_at: new Date().toISOString(),
    }),
    headers: { Prefer: "return=minimal" },
  }, {
    request_id: `eq.${requestId}`,
  });
}

async function completeManualImportCore(input: {
  importInput: ManualRequestImportInput;
  actor: ManualRequestImportActor;
  request: ManualImportRequestRow;
  customerId: string;
  customerCreated: boolean;
  email: string;
  phone: string | null;
  idempotencyKey: string;
  dueAt: string;
}) {
  await Promise.all([
    insertContactHistory(input.customerId, "email", input.email),
    insertContactHistory(input.customerId, "phone", input.phone),
  ]);

  const task = await upsertSalesTask({
    requestId: input.request.request_id,
    taskType: "call_new_inquiry",
    status: new Date(input.dueAt).getTime() > Date.now() ? "waiting" : "open",
    title: taskTitle("call_new_inquiry"),
    detail: trimNullable(input.importInput.request?.description) || "Manuell eingespielte Anfrage in Customer Records.",
    dueAt: input.dueAt,
    priorityTier: normalizePriority(input.importInput.request?.priority),
    assigneeLabel: trimNullable(input.actor.operatorName || input.importInput.operatorName),
    source: "manual",
    sourceRef: MANUAL_IMPORT_SOURCE,
    idempotencyKey: `manual-import-call:${input.request.request_id}`,
    payload: {
      manual_import: true,
      auto_reply_suppressed: true,
      idempotency_key: input.idempotencyKey,
    },
  });

  await auditManualImport({
    requestId: input.request.request_id,
    action: "manual_request_imported",
    metadata: {
      request_id: input.request.request_id,
      customer_id: input.customerId,
      customer_created: input.customerCreated,
      idempotency_key: input.idempotencyKey,
      source: MANUAL_IMPORT_SOURCE,
      auto_reply_suppressed: true,
      operator_name: trimNullable(input.actor.operatorName || input.importInput.operatorName),
      host: input.actor.host || null,
      user_agent: input.actor.userAgent || null,
      trello_requested: Boolean(input.importInput.trello?.createCard),
    },
  });

  return Boolean(task);
}

async function completeManualImportTrello(
  input: ManualRequestImportInput,
  requestId: string,
  warnings: string[],
): Promise<ManualRequestImportResult["trello"]> {
  try {
    const trello = await projectToTrello(input, requestId);
    if (trello.usageFieldError) warnings.push(trello.usageFieldError);
    if (trello.error) warnings.push(trello.error);
    if (trello.offerCustomerFieldWarnings.length) warnings.push(...trello.offerCustomerFieldWarnings);
    if (trello.ok) {
      await patchRequestTrelloProjection(requestId, {
        cardId: trello.cardId,
        cardUrl: trello.cardUrl,
      });
      await auditManualImport({
        requestId,
        action: "manual_request_trello_projected",
        metadata: {
          request_id: requestId,
          trello_card_id: trello.cardId,
          trello_card_url: trello.cardUrl,
          custom_field: "nerdy-forms-id",
          custom_field_set: trello.customFieldSet,
          custom_field_value: trello.customFieldSet ? requestId : null,
          custom_field_error: trello.customFieldSet ? null : trello.error,
          usage_field_set: trello.usageFieldSet,
          usage_field_error: trello.usageFieldError,
          usage_value: trimNullable(input.request?.application),
          offer_customer_fields_set: trello.offerCustomerFieldsSet,
          offer_customer_field_warnings: trello.offerCustomerFieldWarnings,
          source: MANUAL_IMPORT_SOURCE,
        },
      });
    }
    return trello;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Trello-Projektion fehlgeschlagen.";
    warnings.push("Trello-Projektion fehlgeschlagen. DB-Datensatz und Call-Aufgabe wurden trotzdem angelegt.");
    await auditManualImport({
      requestId,
      action: "manual_request_trello_projected",
      status: "error",
      errorMessage: message,
      metadata: {
        request_id: requestId,
        source: MANUAL_IMPORT_SOURCE,
        custom_field: "nerdy-forms-id",
      },
    });
    return {
      requested: Boolean(input.trello?.createCard),
      ok: false,
      cardId: null,
      cardUrl: null,
      customFieldSet: false,
      usageFieldSet: false,
      usageFieldError: null,
      offerCustomerFieldsSet: [],
      offerCustomerFieldWarnings: [],
      error: message,
    };
  }
}

export async function createManualRequestImport(
  input: ManualRequestImportInput,
  actor: ManualRequestImportActor = {},
): Promise<ManualRequestImportResult> {
  const email = normalizeEmail(trimNullable(input.customer?.email) || "");
  const phone = normalizePhone(input.customer?.phone);
  const idempotencyKey = trimNullable(input.idempotencyKey) || randomUUID();
  const warnings: string[] = [];

  if (!email || !isValidEmail(email)) {
    throw new QuoteValidationError("Gueltige Kunden-E-Mail erforderlich.", ["Eine manuelle Einspielung braucht aktuell eine echte Kunden-E-Mail."]);
  }
  if (isInternalEmail(email)) {
    throw new QuoteValidationError("Interne NEONTRIP-Adresse darf nicht als Kundenmail gespeichert werden.", ["Bitte echte Kunden-E-Mail eintragen, nicht support@neontrip.de oder eine interne Adresse."]);
  }
  const explicitSegment = resolveExplicitManualRequestSegment(input.request?.segment);
  const payloadFingerprint = manualImportPayloadFingerprint(input, email, phone, explicitSegment);

  const existingImport = await findExistingImportByIdempotencyKey(idempotencyKey);
  const existingCustomerId = existingImport?.request.customer_id;
  if (existingImport && existingCustomerId) {
    const existingRequest = existingImport.request;
    const frozen = assertManualImportRetryMatches(existingRequest, payloadFingerprint, explicitSegment);

    if (existingImport.coreCompleted) {
      const trelloRequested = Boolean(input.trello?.createCard);
      const trelloMissing = trelloRequested && !existingRequest.trello_card_id;
      const trelloError = trelloMissing
        ? "Trello-Projektion ist trotz abgeschlossenem DB-Core nicht nachweisbar. Bitte manuell prüfen; es wird kein automatischer Retry ausgeführt."
        : null;
      return {
        requestId: existingRequest.request_id,
        customerId: existingCustomerId,
        customerCreated: false,
        requestCreated: false,
        salesTaskCreated: false,
        trello: {
          requested: trelloRequested,
          ok: Boolean(existingRequest.trello_card_id),
          cardId: existingRequest.trello_card_id || null,
          cardUrl: existingRequest.trello_card_url || null,
          customFieldSet: Boolean(existingRequest.trello_card_id),
          usageFieldSet: false,
          usageFieldError: null,
          offerCustomerFieldsSet: [],
          offerCustomerFieldWarnings: [],
          error: trelloError,
        },
        warnings: [
          trelloMissing
            ? "DB-Core und Import-Audit sind abgeschlossen, aber die angeforderte Trello-Karte fehlt. Bitte die Projektion manuell prüfen; kein automatischer Retry wurde gestartet."
            : "Diese manuelle Einspielung wurde bereits vollständig verarbeitet.",
        ],
      };
    }

    if (explicitSegment) {
      if (isManualRequestSegmentSource(existingRequest.segment_source)) {
        warnings.push("Eine neuere manuelle Segment-Autorität wurde beibehalten.");
      } else {
        await setAuthoritativeManualRequestSegment({
          requestId: existingRequest.id,
          segment: explicitSegment,
          source: "manual_ops_import",
          actor: {
            ...actor,
            operatorName: trimNullable(actor.operatorName || input.operatorName),
          },
          reason: "manual_request_import_explicit_segment_retry",
        });
      }
    }

    const salesTaskCreated = await completeManualImportCore({
      importInput: input,
      actor,
      request: existingRequest,
      customerId: existingCustomerId,
      customerCreated: frozen.customerCreated,
      email,
      phone,
      idempotencyKey,
      dueAt: frozen.dueAt,
    });
    const trello = await completeManualImportTrello(input, existingRequest.request_id, warnings);
    return {
      requestId: existingRequest.request_id,
      customerId: existingCustomerId,
      customerCreated: false,
      requestCreated: false,
      salesTaskCreated,
      trello,
      warnings,
    };
  }

  const phoneDuplicate = await findCustomerByPhone(phone);
  if (phoneDuplicate?.id && phoneDuplicate.email !== email) {
    warnings.push(`Telefonnummer existiert bereits bei ${phoneDuplicate.email}. Bitte Fall nach dem Speichern prüfen.`);
  }

  const requestId = randomUUID();
  const dueAt = normalizeDueAt(input.request?.dueAt);
  const customer = await upsertCustomer(input, email, phone, requestId);
  const request = await insertManualRequest(input, customer.row.id, requestId, idempotencyKey, {
    payloadFingerprint,
    explicitSegment,
    dueAt,
    customerCreated: customer.created,
  });

  if (explicitSegment) {
    await setAuthoritativeManualRequestSegment({
      requestId: request.id,
      segment: explicitSegment,
      source: "manual_ops_import",
      actor: {
        ...actor,
        operatorName: trimNullable(actor.operatorName || input.operatorName),
      },
      reason: "manual_request_import_explicit_segment",
    });
  }

  const salesTaskCreated = await completeManualImportCore({
    importInput: input,
    actor,
    request,
    customerId: customer.row.id,
    customerCreated: customer.created,
    email,
    phone,
    idempotencyKey,
    dueAt,
  });
  const trello = await completeManualImportTrello(input, requestId, warnings);

  return {
    requestId,
    customerId: customer.row.id,
    customerCreated: customer.created,
    requestCreated: true,
    salesTaskCreated,
    trello,
    warnings,
  };
}
