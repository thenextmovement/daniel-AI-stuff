import { randomUUID } from "node:crypto";
import {
  createTrelloCard,
  findTrelloCustomFieldByName,
  updateTrelloCustomField,
} from "@/lib/quotes/trello";
import { isValidEmail, normalizeEmail } from "@/lib/quotes/customer";
import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";
import { taskTitle, upsertSalesTask } from "@/lib/ops/sales-task-engine";

type ManualImportCustomerRow = {
  id: string;
  email: string;
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
  const lines = [
    "Manuell in Customer Records eingespielt.",
    "",
    `Request-ID: ${requestId}`,
    `Quelle: ${MANUAL_IMPORT_SOURCE}`,
    "",
    `Kunde: ${displayName(input)}`,
    `Firma: ${trimNullable(input.customer?.company) || "-"}`,
    `E-Mail: ${trimNullable(input.customer?.email) || "-"}`,
    `Telefon: ${trimNullable(input.customer?.phone) || "-"}`,
    "",
    `Produkt: ${trimNullable(input.request?.product) || "-"}`,
    `Groesse: ${trimNullable(input.request?.size) || "-"}`,
    `Farbe: ${trimNullable(input.request?.color) || "-"}`,
    `Einsatz: ${trimNullable(input.request?.application) || "-"}`,
    `Lieferzeit: ${trimNullable(input.request?.deliveryTime) || "-"}`,
    "",
    "Beschreibung:",
    trimNullable(input.request?.description) || "-",
  ];
  return lines.join("\n");
}

async function findExistingImportByIdempotencyKey(idempotencyKey: string) {
  const rows = await supabaseRequest<ManualImportAuditRow[]>("workflow_audit_log", undefined, {
    select: "metadata",
    workflow_name: "eq.customer_records_manual_import",
    action: "eq.manual_request_imported",
    "metadata->>idempotency_key": `eq.${idempotencyKey}`,
    order: "created_at.desc",
    limit: 1,
  });
  return trimNullable(rows[0]?.metadata?.request_id);
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
    select: "id,email,first_name,last_name,phone,company,company_name,name,request_id",
    email: `eq.${email}`,
    limit: 1,
  });
  return rows[0] || null;
}

async function findCustomerByPhone(phone: string | null) {
  if (!phone) return null;
  const rows = await supabaseRequest<ManualImportCustomerRow[]>("master_customers", undefined, {
    select: "id,email,first_name,last_name,phone,company,company_name,name,request_id",
    or: `(phone.eq.${encodeURIComponent(phone)},original_phone.eq.${encodeURIComponent(phone)})`,
    limit: 1,
  });
  return rows[0] || null;
}

async function upsertCustomer(input: ManualRequestImportInput, email: string, phone: string | null, requestId: string) {
  const existing = await findCustomerByEmail(email);
  const customerPatch = {
    email,
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
    request_id: existing?.request_id || requestId,
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

async function insertManualRequest(input: ManualRequestImportInput, customerId: string, requestId: string) {
  const now = new Date().toISOString();
  const rows = await supabaseRequest<ManualImportRequestRow[]>("master_requests", {
    method: "POST",
    body: JSON.stringify({
      customer_id: customerId,
      request_id: requestId,
      title: requestTitle(input),
      description: trimNullable(input.request?.description),
      segment: trimNullable(input.request?.segment),
      segment_status: trimNullable(input.request?.segment) ? "confirmed" : "needs_review",
      segment_confidence: trimNullable(input.request?.segment) ? 1 : null,
      segment_source: MANUAL_IMPORT_SOURCE,
      segment_classified_at: trimNullable(input.request?.segment) ? now : null,
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
  if (!field) {
    throw new Error("Trello Custom Field nerdy-forms-id wurde nicht gefunden.");
  }
  await updateTrelloCustomField({
    cardId: card.id,
    fieldId: field.id,
    type: field.type || "text",
    value: requestId,
  });

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

  return {
    requested: true,
    ok: true,
    cardId: card.id,
    cardUrl: card.url || card.shortUrl || null,
    customFieldSet: true,
    usageFieldSet,
    usageFieldError,
    error: null,
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

  const existingRequestId = await findExistingImportByIdempotencyKey(idempotencyKey);
  if (existingRequestId) {
    const rows = await supabaseRequest<ManualImportRequestRow[]>("master_requests", undefined, {
      select: "request_id,customer_id,trello_card_id,trello_card_url",
      request_id: `eq.${existingRequestId}`,
      limit: 1,
    });
    const row = rows[0];
    if (row?.customer_id) {
      return {
        requestId: row.request_id,
        customerId: row.customer_id,
        customerCreated: false,
        requestCreated: false,
        salesTaskCreated: false,
        trello: {
          requested: Boolean(input.trello?.createCard),
          ok: Boolean(row.trello_card_id),
          cardId: row.trello_card_id || null,
          cardUrl: row.trello_card_url || null,
          customFieldSet: Boolean(row.trello_card_id),
          usageFieldSet: false,
          usageFieldError: null,
          error: null,
        },
        warnings: ["Diese manuelle Einspielung wurde bereits verarbeitet."],
      };
    }
  }

  const phoneDuplicate = await findCustomerByPhone(phone);
  if (phoneDuplicate?.id && phoneDuplicate.email !== email) {
    warnings.push(`Telefonnummer existiert bereits bei ${phoneDuplicate.email}. Bitte Fall nach dem Speichern prüfen.`);
  }

  const requestId = randomUUID();
  const customer = await upsertCustomer(input, email, phone, requestId);
  const request = await insertManualRequest(input, customer.row.id, requestId);

  await Promise.all([
    insertContactHistory(customer.row.id, "email", email),
    insertContactHistory(customer.row.id, "phone", phone),
  ]);

  const dueAt = normalizeDueAt(input.request?.dueAt);
  const task = await upsertSalesTask({
    requestId,
    taskType: "call_new_inquiry",
    status: new Date(dueAt).getTime() > Date.now() ? "waiting" : "open",
    title: taskTitle("call_new_inquiry"),
    detail: trimNullable(input.request?.description) || "Manuell eingespielte Anfrage in Customer Records.",
    dueAt,
    priorityTier: normalizePriority(input.request?.priority),
    assigneeLabel: trimNullable(actor.operatorName || input.operatorName),
    source: "manual",
    sourceRef: MANUAL_IMPORT_SOURCE,
    idempotencyKey: `manual-import-call:${requestId}`,
    payload: {
      manual_import: true,
      auto_reply_suppressed: true,
      idempotency_key: idempotencyKey,
    },
  });

  await auditManualImport({
    requestId,
    action: "manual_request_imported",
    metadata: {
      request_id: request.request_id,
      customer_id: customer.row.id,
      customer_created: customer.created,
      idempotency_key: idempotencyKey,
      source: MANUAL_IMPORT_SOURCE,
      auto_reply_suppressed: true,
      operator_name: trimNullable(actor.operatorName || input.operatorName),
      host: actor.host || null,
      user_agent: actor.userAgent || null,
      trello_requested: Boolean(input.trello?.createCard),
    },
  });

  let trello: ManualRequestImportResult["trello"];
  try {
    trello = await projectToTrello(input, requestId);
    if (trello.usageFieldError) warnings.push(trello.usageFieldError);
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
          custom_field_value: requestId,
          usage_field_set: trello.usageFieldSet,
          usage_field_error: trello.usageFieldError,
          usage_value: trimNullable(input.request?.application),
          source: MANUAL_IMPORT_SOURCE,
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Trello-Projektion fehlgeschlagen.";
    trello = {
      requested: Boolean(input.trello?.createCard),
      ok: false,
      cardId: null,
      cardUrl: null,
      customFieldSet: false,
      usageFieldSet: false,
      usageFieldError: null,
      error: message,
    };
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
  }

  return {
    requestId,
    customerId: customer.row.id,
    customerCreated: customer.created,
    requestCreated: true,
    salesTaskCreated: Boolean(task),
    trello,
    warnings,
  };
}
