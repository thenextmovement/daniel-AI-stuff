import { getTrelloCard, updateTrelloCard } from "@/lib/quotes/trello";
import { supabaseRequest, supabaseRpc } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";
import {
  recordWorkflowAuditEvent,
  type WorkflowAuditEventInput,
} from "@/lib/ops/workflow-audit";
import { buildKeyCustomerTrelloTitle } from "@/lib/ops/trello-card-title";

export const KEY_CUSTOMER_MIN_PAID_ORDERS = 2;
export const KEY_CUSTOMER_PAID_VALUE_THRESHOLD_EUR = 1200;
export const KEY_CUSTOMER_RULE_VERSION = "key_customer_v1_20260827";

type RequestLookupRow = {
  id: string;
  request_id?: string | null;
  customer_id?: string | null;
  trello_card_id?: string | null;
  trello_card_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type CustomerLookupRow = {
  id: string;
  email?: string | null;
};

export type KeyCustomerOrderRow = {
  id: string;
  shopify_order_id?: string | null;
  shopify_order_number?: string | null;
  order_value?: number | string | null;
  currency?: string | null;
  status?: string | null;
  cancelled_at?: string | null;
  shopify_created_at?: string | null;
  created_at?: string | null;
};

type DomainFacts = {
  email_domain?: string | null;
  is_valid_dns_host?: boolean | null;
  is_freemail?: boolean | null;
  is_shared_provider?: boolean | null;
  email_domain_cache_allowed?: boolean | null;
};

export type KeyCustomerTitleSyncInput = {
  requestId?: string | null;
  trelloCardId?: string | null;
  dryRun?: boolean | null;
  operatorName?: string | null;
};

export type KeyCustomerQualification = {
  eligible: boolean;
  emailDomain: string | null;
  paidOrderCount: number;
  paidOrderValueEur: number;
  minimumPaidOrders: number;
  paidValueThresholdEur: number;
  shippingIncluded: true;
  ruleVersion: string;
};

export type KeyCustomerTitleSyncReason =
  | "missing_customer_email"
  | "not_business_domain"
  | "insufficient_paid_orders"
  | "paid_value_not_over_threshold"
  | "missing_card"
  | "already_current";

export type KeyCustomerTitleSyncResponse = {
  ok: true;
  status: "updated" | "would_update" | "skipped";
  reason?: KeyCustomerTitleSyncReason;
  requestId: string;
  trelloCardId: string | null;
  dryRun: boolean;
  qualification: KeyCustomerQualification;
  previousTitle?: string;
  nextTitle?: string;
};

export type KeyCustomerTitleSyncDeps = {
  findRequest: (requestId: string, trelloCardId: string | null) => Promise<RequestLookupRow | null>;
  findCustomer: (customerId: string) => Promise<CustomerLookupRow | null>;
  getDomainFacts: (email: string) => Promise<DomainFacts>;
  listCustomersByDomain: (domain: string) => Promise<CustomerLookupRow[]>;
  listPaidOrders: (customerIds: string[]) => Promise<KeyCustomerOrderRow[]>;
  getCard: typeof getTrelloCard;
  updateCard: typeof updateTrelloCard;
  recordAudit: (input: WorkflowAuditEventInput) => Promise<unknown>;
  trelloConfigured: () => boolean;
};

function cleanText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function numericValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function trelloCardIdFromValue(value: unknown) {
  const text = cleanText(value);
  if (!text) return null;
  const fromUrl = text.match(/trello\.com\/c\/([a-z0-9_-]{6,32})/i)?.[1] || null;
  const cardId = fromUrl || text;
  return /^[a-z0-9_-]{6,32}$/i.test(cardId) ? cardId : null;
}

function requestTimestamp(row: RequestLookupRow) {
  const value = cleanText(row.created_at) || cleanText(row.updated_at);
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function orderTimestamp(row: KeyCustomerOrderRow) {
  const value = cleanText(row.shopify_created_at) || cleanText(row.created_at);
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function orderIdentityKeys(row: KeyCustomerOrderRow) {
  return [
    cleanText(row.shopify_order_id) ? `shopify_id:${cleanText(row.shopify_order_id)}` : null,
    cleanText(row.shopify_order_number) ? `shopify_number:${cleanText(row.shopify_order_number)?.toUpperCase()}` : null,
  ].filter((value): value is string => Boolean(value));
}

export function qualifyKeyCustomerOrders(
  rows: KeyCustomerOrderRow[],
  requestCreatedAt: string | null | undefined,
) {
  const requestMs = requestCreatedAt ? Date.parse(requestCreatedAt) : Number.NaN;
  if (!Number.isFinite(requestMs)) {
    throw new QuoteValidationError("Zeitpunkt der aktuellen Anfrage fehlt.", [], 422);
  }

  const seen = new Set<string>();
  let paidOrderCount = 0;
  let paidOrderValueEur = 0;

  for (const row of rows) {
    if (cleanText(row.status)?.toLowerCase() !== "paid") continue;
    if (cleanText(row.cancelled_at)) continue;
    if ((cleanText(row.currency) || "").toUpperCase() !== "EUR") continue;
    const createdMs = orderTimestamp(row);
    if (createdMs === null || createdMs >= requestMs) continue;

    const value = numericValue(row.order_value);
    if (value === null || value < 0) continue;
    const identityKeys = orderIdentityKeys(row);
    const fallbackKey = `row:${row.id}`;
    if (identityKeys.some((key) => seen.has(key)) || (!identityKeys.length && seen.has(fallbackKey))) continue;
    for (const key of identityKeys.length ? identityKeys : [fallbackKey]) seen.add(key);

    paidOrderCount += 1;
    paidOrderValueEur += value;
  }

  const roundedValue = roundCurrency(paidOrderValueEur);
  return {
    paidOrderCount,
    paidOrderValueEur: roundedValue,
    eligible:
      paidOrderCount >= KEY_CUSTOMER_MIN_PAID_ORDERS
      && roundedValue > KEY_CUSTOMER_PAID_VALUE_THRESHOLD_EUR,
  };
}

function baseQualification(overrides: Partial<KeyCustomerQualification> = {}): KeyCustomerQualification {
  return {
    eligible: false,
    emailDomain: null,
    paidOrderCount: 0,
    paidOrderValueEur: 0,
    minimumPaidOrders: KEY_CUSTOMER_MIN_PAID_ORDERS,
    paidValueThresholdEur: KEY_CUSTOMER_PAID_VALUE_THRESHOLD_EUR,
    shippingIncluded: true,
    ruleVersion: KEY_CUSTOMER_RULE_VERSION,
    ...overrides,
  };
}

function responseStatusForReason(reason: KeyCustomerTitleSyncReason) {
  return reason === "already_current" ? "success" : "skipped";
}

async function recordDecisionAudit(
  deps: KeyCustomerTitleSyncDeps,
  input: {
    request: RequestLookupRow;
    trelloCardId: string | null;
    operatorName: string | null;
    qualification: KeyCustomerQualification;
    status: "success" | "skipped" | "failed";
    reason: string;
    titleChanged: boolean;
  },
) {
  const requestId = input.request.request_id || input.request.id;
  return deps.recordAudit({
    workflowName: "NEONTRIP Key Customer Title Sync",
    workflowId: "ELpwCfdWOCRZ22gy",
    action: "key_customer_title_sync",
    status: input.status,
    requestId,
    trelloCardId: input.trelloCardId,
    idempotencyKey: [
      "key-customer-title",
      input.request.id,
      input.trelloCardId || "no-card",
      input.qualification.paidOrderCount,
      input.qualification.paidOrderValueEur.toFixed(2),
      input.reason,
    ].join(":"),
    stage: "trello_title_projection",
    safeActionKey: input.status === "failed" ? "inspect_n8n_run" : "none",
    terminal: true,
    customer_communication_sent: false,
    summary: input.reason,
    metadata: {
      operator_name: input.operatorName,
      rule_version: input.qualification.ruleVersion,
      email_domain: input.qualification.emailDomain,
      minimum_paid_orders: input.qualification.minimumPaidOrders,
      paid_order_count: input.qualification.paidOrderCount,
      paid_value_threshold_eur: input.qualification.paidValueThresholdEur,
      paid_order_value_eur: input.qualification.paidOrderValueEur,
      shipping_included: input.qualification.shippingIncluded,
      eligible: input.qualification.eligible,
      title_changed: input.titleChanged,
      reason: input.reason,
    },
  });
}

async function skippedResponse(
  deps: KeyCustomerTitleSyncDeps,
  input: {
    request: RequestLookupRow;
    trelloCardId: string | null;
    operatorName: string | null;
    qualification: KeyCustomerQualification;
    reason: KeyCustomerTitleSyncReason;
    dryRun: boolean;
  },
): Promise<KeyCustomerTitleSyncResponse> {
  await recordDecisionAudit(deps, {
    request: input.request,
    trelloCardId: input.trelloCardId,
    operatorName: input.operatorName,
    qualification: input.qualification,
    status: responseStatusForReason(input.reason),
    reason: input.reason,
    titleChanged: false,
  });
  return {
    ok: true,
    status: "skipped",
    reason: input.reason,
    requestId: input.request.request_id || input.request.id,
    trelloCardId: input.trelloCardId,
    dryRun: input.dryRun,
    qualification: input.qualification,
  };
}

export const defaultKeyCustomerTitleSyncDeps: KeyCustomerTitleSyncDeps = {
  async findRequest(requestId, trelloCardId) {
    const baseQuery = {
      select: "id,request_id,customer_id,trello_card_id,trello_card_url,created_at,updated_at",
      order: "updated_at.desc",
      limit: 1,
    } as const;
    if (requestId) {
      const key = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
        ? "id"
        : "request_id";
      const rows = await supabaseRequest<RequestLookupRow[]>("master_requests", undefined, {
        ...baseQuery,
        [key]: `eq.${requestId}`,
      });
      if (rows[0]) return rows[0];
    }
    if (!trelloCardId) return null;
    const exactRows = await supabaseRequest<RequestLookupRow[]>("master_requests", undefined, {
      ...baseQuery,
      trello_card_id: `eq.${trelloCardId}`,
    });
    if (exactRows[0]) return exactRows[0];
    const urlRows = await supabaseRequest<RequestLookupRow[]>("master_requests", undefined, {
      ...baseQuery,
      trello_card_url: `ilike.*${trelloCardId}*`,
    });
    return urlRows[0] || null;
  },
  async findCustomer(customerId) {
    const rows = await supabaseRequest<CustomerLookupRow[]>("master_customers", undefined, {
      select: "id,email",
      id: `eq.${customerId}`,
      limit: 1,
    });
    return rows[0] || null;
  },
  async getDomainFacts(email) {
    return supabaseRpc<DomainFacts>("neontrip_request_segmentation_domain_facts", { p_value: email });
  },
  async listCustomersByDomain(domain) {
    return supabaseRequest<CustomerLookupRow[]>("master_customers", undefined, {
      select: "id,email",
      email: `ilike.*@${domain}`,
      order: "created_at.asc",
      limit: 1000,
    });
  },
  async listPaidOrders(customerIds) {
    const rows: KeyCustomerOrderRow[] = [];
    for (let index = 0; index < customerIds.length; index += 100) {
      const batch = customerIds.slice(index, index + 100);
      rows.push(...await supabaseRequest<KeyCustomerOrderRow[]>("master_orders", undefined, {
        select: "id,shopify_order_id,shopify_order_number,order_value,currency,status,cancelled_at,shopify_created_at,created_at",
        customer_id: `in.(${batch.join(",")})`,
        status: "eq.paid",
        cancelled_at: "is.null",
        currency: "eq.EUR",
        order: "shopify_created_at.asc,created_at.asc",
        limit: 1000,
      }));
    }
    return rows;
  },
  getCard: getTrelloCard,
  updateCard: updateTrelloCard,
  recordAudit: recordWorkflowAuditEvent,
  trelloConfigured() {
    return Boolean(process.env.TRELLO_API_KEY && process.env.TRELLO_TOKEN);
  },
};

export async function syncKeyCustomerTrelloTitle(
  input: KeyCustomerTitleSyncInput,
  deps: KeyCustomerTitleSyncDeps = defaultKeyCustomerTitleSyncDeps,
): Promise<KeyCustomerTitleSyncResponse> {
  const requestIdInput = cleanText(input.requestId);
  const trelloCardIdInput = trelloCardIdFromValue(input.trelloCardId);
  if (!requestIdInput && !trelloCardIdInput) {
    throw new QuoteValidationError("requestId oder trelloCardId ist erforderlich.", [], 400);
  }

  const request = await deps.findRequest(requestIdInput || "", trelloCardIdInput);
  if (!request) throw new QuoteValidationError("Kein master_requests-Datensatz gefunden.", [], 404);
  if (!request.customer_id) throw new QuoteValidationError("Anfrage hat keinen verknuepften Kunden.", [], 422);
  const requestCreatedAt = request.created_at || request.updated_at;
  if (requestTimestamp(request) === null || !requestCreatedAt) {
    throw new QuoteValidationError("Zeitpunkt der aktuellen Anfrage fehlt.", [], 422);
  }

  const trelloCardId = trelloCardIdInput
    || trelloCardIdFromValue(request.trello_card_id)
    || trelloCardIdFromValue(request.trello_card_url);
  const dryRun = Boolean(input.dryRun);
  const operatorName = cleanText(input.operatorName);
  const customer = await deps.findCustomer(request.customer_id);
  const email = cleanText(customer?.email)?.toLowerCase() || null;
  if (!email) {
    return skippedResponse(deps, {
      request,
      trelloCardId,
      operatorName,
      qualification: baseQualification(),
      reason: "missing_customer_email",
      dryRun,
    });
  }

  const domainFacts = await deps.getDomainFacts(email);
  const domain = cleanText(domainFacts.email_domain)?.toLowerCase() || null;
  const businessDomain = Boolean(
    domain
    && domainFacts.is_valid_dns_host === true
    && domainFacts.is_freemail !== true
    && domainFacts.is_shared_provider !== true
    && domainFacts.email_domain_cache_allowed === true,
  );
  if (!businessDomain || !domain) {
    return skippedResponse(deps, {
      request,
      trelloCardId,
      operatorName,
      qualification: baseQualification({ emailDomain: domain }),
      reason: "not_business_domain",
      dryRun,
    });
  }

  const domainCustomers = await deps.listCustomersByDomain(domain);
  const customerIds = Array.from(new Set(domainCustomers.map((row) => cleanText(row.id)).filter((value): value is string => Boolean(value))));
  const history = customerIds.length ? await deps.listPaidOrders(customerIds) : [];
  const orderQualification = qualifyKeyCustomerOrders(history, requestCreatedAt);
  const qualification = baseQualification({
    eligible: orderQualification.eligible,
    emailDomain: domain,
    paidOrderCount: orderQualification.paidOrderCount,
    paidOrderValueEur: orderQualification.paidOrderValueEur,
  });

  if (qualification.paidOrderCount < KEY_CUSTOMER_MIN_PAID_ORDERS) {
    return skippedResponse(deps, {
      request,
      trelloCardId,
      operatorName,
      qualification,
      reason: "insufficient_paid_orders",
      dryRun,
    });
  }
  if (qualification.paidOrderValueEur <= KEY_CUSTOMER_PAID_VALUE_THRESHOLD_EUR) {
    return skippedResponse(deps, {
      request,
      trelloCardId,
      operatorName,
      qualification,
      reason: "paid_value_not_over_threshold",
      dryRun,
    });
  }
  if (!trelloCardId) {
    return skippedResponse(deps, {
      request,
      trelloCardId: null,
      operatorName,
      qualification,
      reason: "missing_card",
      dryRun,
    });
  }
  if (!deps.trelloConfigured()) {
    throw new QuoteValidationError("Trello API-Konfiguration fehlt: TRELLO_API_KEY/TRELLO_TOKEN.", [], 503);
  }

  const card = await deps.getCard(trelloCardId);
  const previousTitle = typeof card.name === "string" ? card.name : "";
  const nextTitle = buildKeyCustomerTrelloTitle(previousTitle);
  if (!nextTitle) throw new QuoteValidationError("Trello-Kartentitel fehlt.", [], 422);
  if (nextTitle === previousTitle) {
    const response = await skippedResponse(deps, {
      request,
      trelloCardId,
      operatorName,
      qualification,
      reason: "already_current",
      dryRun,
    });
    return { ...response, previousTitle, nextTitle };
  }

  if (!dryRun) {
    try {
      await deps.updateCard(trelloCardId, { name: nextTitle });
    } catch (error) {
      await recordDecisionAudit(deps, {
        request,
        trelloCardId,
        operatorName,
        qualification,
        status: "failed",
        reason: "trello_title_update_failed",
        titleChanged: false,
      }).catch(() => undefined);
      throw error;
    }
  }

  await recordDecisionAudit(deps, {
    request,
    trelloCardId,
    operatorName,
    qualification,
    status: "success",
    reason: dryRun ? "would_update" : "updated",
    titleChanged: !dryRun,
  });

  return {
    ok: true,
    status: dryRun ? "would_update" : "updated",
    requestId: request.request_id || request.id,
    trelloCardId,
    dryRun,
    qualification,
    previousTitle,
    nextTitle,
  };
}
