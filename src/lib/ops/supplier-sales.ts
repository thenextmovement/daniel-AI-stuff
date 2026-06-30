import { createHash } from "node:crypto";
import { createOpsInternalTask, listOpsInternalTasks, type OpsInternalTaskActor } from "@/lib/ops/internal-tasks";
import { createTrelloCard, getTrelloCard, updateTrelloCard } from "@/lib/quotes/trello";
import { SupabaseRestError, supabaseRequest } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const SUPPLIER_SALE_SUPPLIERS = ["quentin", "said", "special"] as const;
export const SUPPLIER_RECOMMENDATIONS = ["quentin", "said", "special", "manual_review", "unknown"] as const;
export const SUPPLIER_PAYMENT_STATUSES = [
  "unknown",
  "pending",
  "authorized",
  "paid",
  "partially_paid",
  "partially_refunded",
  "refunded",
  "voided",
  "expired",
] as const;
export const SUPPLIER_PAYMENT_DECISIONS = [
  "pending",
  "wait_for_payment",
  "manual_approved_unpaid",
  "paid_confirmed",
  "canceled",
  "refunded",
] as const;
export const SUPPLIER_ASSIGNMENT_STATUSES = [
  "needs_review",
  "payment_open",
  "ready_to_assign",
  "assigned",
  "in_production",
  "blocked",
  "completed",
  "canceled",
] as const;
export const SUPPLIER_SYNC_STATUSES = ["not_started", "pending", "synced", "failed", "skipped"] as const;

export type SupplierSaleSupplier = (typeof SUPPLIER_SALE_SUPPLIERS)[number];
export type SupplierSaleRecommendation = (typeof SUPPLIER_RECOMMENDATIONS)[number];
export type SupplierSalePaymentStatus = (typeof SUPPLIER_PAYMENT_STATUSES)[number];
export type SupplierSalePaymentDecision = (typeof SUPPLIER_PAYMENT_DECISIONS)[number];
export type SupplierSaleAssignmentStatus = (typeof SUPPLIER_ASSIGNMENT_STATUSES)[number];
export type SupplierSaleSyncStatus = (typeof SUPPLIER_SYNC_STATUSES)[number];
export type SupplierSaleUrgencyFilter = "all" | "rush" | "standard";

export const SUPPLIER_RULE_VERSION = "supplier_rules_v1_20260609";

type JsonRecord = Record<string, unknown>;

type MasterRequestTrelloRow = {
  request_id?: string | null;
  trello_card_id?: string | null;
  trello_card_url?: string | null;
  updated_at?: string | null;
};

export type SupplierSaleRow = {
  id: string;
  sale_key: string;
  source: string;
  shopify_order_id: string | null;
  shopify_order_name: string | null;
  shopify_order_url: string | null;
  shopify_payment_status: SupplierSalePaymentStatus;
  payment_decision_status: SupplierSalePaymentDecision;
  payment_due_at: string | null;
  last_payment_reminder_at: string | null;
  payment_reminder_count: number;
  offer_id: string | null;
  offer_number: string | null;
  document_reference: string | null;
  offer_public_url: string | null;
  final_pdf_url: string | null;
  trello_card_id: string | null;
  request_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_company: string | null;
  currency: string;
  subtotal_price: number | string | null;
  total_price: number | string | null;
  customer_due_date: string | null;
  supplier_due_date: string | null;
  due_date_source: string | null;
  due_date_note: string | null;
  recommended_supplier: SupplierSaleRecommendation;
  recommendation_reasons: string[];
  assigned_supplier: SupplierSaleSupplier | null;
  special_supplier_name: string | null;
  assignment_status: SupplierSaleAssignmentStatus;
  assignment_note: string | null;
  assigned_at: string | null;
  assigned_by: string | null;
  shopify_tag_sync_status: SupplierSaleSyncStatus;
  shopify_tag_value: string | null;
  shopify_tag_synced_at: string | null;
  shopify_tag_error: string | null;
  trello_projection_status: SupplierSaleSyncStatus;
  supplier_trello_card_id: string | null;
  supplier_trello_card_url: string | null;
  trello_projection_error: string | null;
  task_sync_status: SupplierSaleSyncStatus;
  active_task_id: string | null;
  task_sync_error: string | null;
  product_summary: string | null;
  primary_image_url: string | null;
  raw_shopify: JsonRecord;
  offer_snapshot: JsonRecord;
  metadata: JsonRecord;
  created_at: string;
  updated_at: string;
};

export type SupplierSaleItemRow = {
  id: string;
  sale_id: string;
  line_item_key: string;
  title: string;
  sku: string | null;
  variant_title: string | null;
  quantity: number;
  product_type: string | null;
  image_url: string | null;
  requires_quentin: boolean;
  rule_reasons: string[];
  raw_line_item: JsonRecord;
  created_at: string;
  updated_at: string;
};

export type SupplierSaleEventRow = {
  id: string;
  sale_id: string | null;
  event_type: string;
  actor: string | null;
  idempotency_key: string;
  payload: JsonRecord;
  created_at: string;
};

export type SupplierSalePostOrderReview = {
  status: "open" | "closed" | "change_requested" | "unknown";
  signedAt: string | null;
  expiresAt: string | null;
  changeRequestedAt: string | null;
  message: string | null;
  eventId: string | null;
};

export type SupplierSale = {
  id: string;
  saleKey: string;
  source: string;
  shopifyOrderId: string | null;
  shopifyOrderName: string | null;
  shopifyOrderUrl: string | null;
  paymentLink: string | null;
  shopifyPaymentStatus: SupplierSalePaymentStatus;
  paymentDecisionStatus: SupplierSalePaymentDecision;
  paymentDueAt: string | null;
  lastPaymentReminderAt: string | null;
  paymentReminderCount: number;
  offerId: string | null;
  offerNumber: string | null;
  documentReference: string | null;
  offerPublicUrl: string | null;
  finalPdfUrl: string | null;
  trelloCardId: string | null;
  sourceTrelloCardUrl: string | null;
  quentinTrelloBoardUrl: string | null;
  quentinTrelloSearchUrl: string | null;
  requestId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  customerCompany: string | null;
  currency: string;
  subtotalPrice: number | null;
  totalPrice: number | null;
  customerDueDate: string | null;
  supplierDueDate: string | null;
  dueDateSource: string | null;
  dueDateNote: string | null;
  recommendedSupplier: SupplierSaleRecommendation;
  recommendationReasons: string[];
  assignedSupplier: SupplierSaleSupplier | null;
  specialSupplierName: string | null;
  assignmentStatus: SupplierSaleAssignmentStatus;
  assignmentNote: string | null;
  assignedAt: string | null;
  assignedBy: string | null;
  shopifyTagSyncStatus: SupplierSaleSyncStatus;
  shopifyTagValue: string | null;
  shopifyTagSyncedAt: string | null;
  shopifyTagError: string | null;
  trelloProjectionStatus: SupplierSaleSyncStatus;
  supplierTrelloCardId: string | null;
  supplierTrelloCardUrl: string | null;
  trelloProjectionError: string | null;
  taskSyncStatus: SupplierSaleSyncStatus;
  activeTaskId: string | null;
  taskSyncError: string | null;
  productSummary: string | null;
  primaryImageUrl: string | null;
  rushOrder: boolean;
  createdAt: string;
  updatedAt: string;
  items: SupplierSaleItem[];
  latestEvent: SupplierSaleEvent | null;
  orderConfirmationEmail: SupplierOrderConfirmationEmailState | null;
  postOrderReview: SupplierSalePostOrderReview;
};

export type SupplierSaleItem = {
  id: string;
  saleId: string;
  lineItemKey: string;
  title: string;
  sku: string | null;
  variantTitle: string | null;
  description: string | null;
  selectionDetails: string[];
  quantity: number;
  productType: string | null;
  imageUrl: string | null;
  requiresQuentin: boolean;
  ruleReasons: string[];
  createdAt: string;
  updatedAt: string;
};

export type SupplierSaleEvent = {
  id: string;
  saleId: string | null;
  eventType: string;
  actor: string | null;
  idempotencyKey: string;
  payload: JsonRecord;
  createdAt: string;
};

export type SupplierSaleBoard = {
  items: SupplierSale[];
  counts: {
    total: number;
    readyToAssign: number;
    paymentOpen: number;
    assigned: number;
    dueSoon: number;
    overdue: number;
    rushOrders: number;
    quentinRecommended: number;
    saidRecommended: number;
    syncIssues: number;
  };
  diagnostics: SupplierSalesDiagnostics;
};

export type SupplierSalesDiagnosticStatus = "ok" | "warning" | "missing";

export type SupplierSalesDiagnostic = {
  key: string;
  status: SupplierSalesDiagnosticStatus;
  label: string;
  detail: string;
};

export type SupplierSalesDiagnostics = {
  ready: boolean;
  items: SupplierSalesDiagnostic[];
  missing: string[];
};

export type SupplierLineItemInput = {
  lineItemKey?: string | null;
  title?: string | null;
  sku?: string | null;
  variantTitle?: string | null;
  quantity?: number | string | null;
  productType?: string | null;
  imageUrl?: string | null;
  section?: string | null;
  description?: string | null;
  rawLineItem?: JsonRecord;
};

export type SupplierSaleInput = {
  saleKey: string;
  source?: string | null;
  shopifyOrderId?: string | number | null;
  shopifyOrderName?: string | number | null;
  shopifyOrderUrl?: string | null;
  shopifyPaymentStatus?: string | null;
  paymentDueAt?: string | null;
  offerId?: string | null;
  offerNumber?: string | null;
  documentReference?: string | null;
  offerPublicUrl?: string | null;
  finalPdfUrl?: string | null;
  trelloCardId?: string | null;
  requestId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerCompany?: string | null;
  currency?: string | null;
  subtotalPrice?: number | string | null;
  totalPrice?: number | string | null;
  customerDueDate?: string | null;
  supplierDueDate?: string | null;
  dueDateSource?: string | null;
  dueDateNote?: string | null;
  productSummary?: string | null;
  primaryImageUrl?: string | null;
  rawShopify?: JsonRecord;
  offerSnapshot?: JsonRecord;
  metadata?: JsonRecord;
  idempotencyKey?: string | null;
  lineItems: SupplierLineItemInput[];
};

export type SupplierSaleActor = OpsInternalTaskActor & {
  host?: string | null;
  mode?: "local_bypass" | "ops_session";
  userAgent?: string | null;
};

export type SupplierSalePayloadParseResult = {
  sale: SupplierSaleInput;
  warnings: string[];
};

export type SupplierSaleAssignInput = {
  saleId: string;
  supplier: SupplierSaleSupplier;
  requestedDeliveryDate: string;
  specialSupplierName?: string | null;
  assignmentNote?: string | null;
  paymentDecisionStatus?: SupplierSalePaymentDecision | null;
  operatorName?: string | null;
  assigneeLabel?: string | null;
};

export type SupplierPaymentReminderInput = {
  saleId: string;
  requestedBy?: string | null;
  recipientEmail?: string | null;
  paymentLink?: string | null;
  message?: string | null;
  operatorName?: string | null;
  idempotencyKey?: string | null;
};

export type SupplierOrderConfirmationEmailStatus = "sent" | "failed" | "skipped";

export type SupplierOrderConfirmationEmailState = {
  status: SupplierOrderConfirmationEmailStatus;
  recipientEmail: string | null;
  requestedAt: string | null;
  sentAt: string | null;
  requestedBy: string | null;
  providerMessageId: string | null;
  error: string | null;
};

export type SupplierOrderConfirmationEmailInput = {
  saleId: string;
  requestedBy?: string | null;
  recipientEmail?: string | null;
  operatorName?: string | null;
  idempotencyKey?: string | null;
};

export type SupplierOrderConfirmationEmailResult = {
  sale: SupplierSale;
  status: SupplierOrderConfirmationEmailStatus;
  recipientEmail: string | null;
  providerMessageId: string | null;
  error: string | null;
};

export type SupplierShopifyTagRetryInput = {
  saleId: string;
  operatorName?: string | null;
};

export type SupplierNoPaymentReminderTagInput = {
  saleId: string;
  operatorName?: string | null;
};

export type SupplierDeadlineTaskResult = {
  checked: number;
  created: number;
  skipped: number;
  failed: number;
  taskIds: string[];
  errors: Array<{ saleId: string; error: string }>;
};

export type SupplierCompletedOffersSyncResult = {
  status: "synced" | "partial" | "skipped" | "failed";
  checked: number;
  upserted: number;
  failed: number;
  errors: Array<{ offerId: string | null; error: string }>;
  warnings: string[];
  sources?: {
    completedOffers: { checked: number; upserted: number; failed: number };
    shopifyOrders: { checked: number; upserted: number; failed: number; skipped: boolean };
    activeShopifyRows?: { checked: number; upserted: number; failed: number; skipped: boolean };
  };
};

export type SupplierSalesLiveCheckResult = {
  status: "ok" | "warning" | "failed" | "skipped";
  checkedAt: string;
  offersFeed: {
    configured: boolean;
    checked: number;
    failed: number;
    warnings: string[];
    errors: Array<{ offerId: string | null; error: string }>;
  };
  latestCompletedOffers: Array<{
    offerId: string | null;
    offerNumber: string | null;
    documentReference: string | null;
    status: string | null;
    acceptedAt: string | null;
    updatedAt: string | null;
    inVergabe: boolean;
    supplierSale: {
      saleId: string;
      source: string;
      createdAt: string;
      updatedAt: string;
      assignmentStatus: SupplierSaleAssignmentStatus;
      shopifyTagSyncStatus: SupplierSaleSyncStatus;
      shopifyOrderName: string | null;
    } | null;
  }>;
  latestVergabeSales: Array<{
    saleId: string;
    offerId: string | null;
    offerNumber: string | null;
    documentReference: string | null;
    source: string;
    createdAt: string;
    updatedAt: string;
    assignmentStatus: SupplierSaleAssignmentStatus;
    shopifyTagSyncStatus: SupplierSaleSyncStatus;
    shopifyOrderName: string | null;
  }>;
  missingOfferIds: string[];
  sortCheck: {
    order: "created_at.desc,updated_at.desc";
    latestCompletedOfferId: string | null;
    newestVergabeOfferId: string | null;
    latestCompletedOfferInTopVergabe: boolean | null;
  };
};

export type SupplierAssignmentTaskCleanupResult = {
  archivedDedicatedTasks: number;
  closedFallbackTasks: number;
  clearedSales: number;
};

export type SupplierShopifyTagActionResult = {
  status: SupplierSaleSyncStatus;
  tagValue: string | null;
  error: string | null;
};

export type SupplierOrderConfirmationPdf = {
  fileName: string;
  bytes: Uint8Array;
};

type CompletedOfferFeedEntry = {
  offerId: string | null;
  offerNumber: string | null;
  documentReference: string | null;
  status: string | null;
  acceptedAt: string | null;
  updatedAt: string | null;
  payload: unknown;
};

type CompletedOfferFeedResult = {
  status: "synced" | "skipped" | "failed";
  configured: boolean;
  sales: CompletedOfferFeedEntry[];
  checked: number;
  failed: number;
  errors: Array<{ offerId: string | null; error: string }>;
  warnings: string[];
};

type SupplierRecommendationResult = {
  recommendedSupplier: SupplierSaleRecommendation;
  recommendationReasons: string[];
  lineItems: Array<SupplierLineItemInput & { requiresQuentin: boolean; ruleReasons: string[] }>;
};

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function arrayRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(jsonRecord).filter((entry) => Object.keys(entry).length > 0) : [];
}

function cleanText(value: unknown, maxLength = 500) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : "";
}

function nullableText(value: unknown, maxLength = 500) {
  const text = cleanText(value, maxLength);
  return text || null;
}

function lowerNullable(value: unknown, maxLength = 500) {
  return nullableText(value, maxLength)?.toLowerCase() || null;
}

function numericValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function intValue(value: unknown, fallback = 1) {
  const number = numericValue(value);
  return number && number > 0 ? Math.round(number) : fallback;
}

function encodeFilterValue(value: string) {
  return encodeURIComponent(value);
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function normalizedTag(value: unknown) {
  return cleanText(value, 120)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function supplierTagKey(value: unknown) {
  return cleanText(value, 120).toLowerCase();
}

function upsertPath(path: string, conflictColumn: string) {
  return `${path}?on_conflict=${encodeURIComponent(conflictColumn)}`;
}

function inList(values: string[]) {
  return `in.(${values.map(encodeFilterValue).join(",")})`;
}

function recordString(record: JsonRecord, keys: string[], maxLength = 500) {
  for (const key of keys) {
    const text = nullableText(record[key], maxLength);
    if (text) return text;
  }
  return null;
}

function nestedString(record: JsonRecord, path: string[], maxLength = 500): string | null {
  let cursor: unknown = record;
  for (const key of path) {
    cursor = jsonRecord(cursor)[key];
  }
  return nullableText(cursor, maxLength);
}

function dateOnlyFromParts(year: number, month: number, day: number) {
  if (year < 2020 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

export function normalizeDateOnly(value: unknown) {
  const text = cleanText(value, 80);
  if (!text) return null;

  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) return dateOnlyFromParts(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]));

  const germanDate = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (germanDate) return dateOnlyFromParts(Number(germanDate[3]), Number(germanDate[2]), Number(germanDate[1]));

  const parsed = new Date(text);
  if (Number.isFinite(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

function normalizeIsoTimestamp(value: unknown, label: string) {
  const text = cleanText(value, 80);
  if (!text) return null;
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) {
    throw new QuoteValidationError(`${label} ist ungueltig.`, [`${label} ist ungueltig.`], 422);
  }
  return date.toISOString();
}

export function normalizeShopifyPaymentStatus(value: unknown): SupplierSalePaymentStatus {
  const text = cleanText(value, 80).toLowerCase().replace(/[\s-]+/g, "_");
  if (SUPPLIER_PAYMENT_STATUSES.includes(text as SupplierSalePaymentStatus)) return text as SupplierSalePaymentStatus;
  if (text === "pending_payment" || text === "payment_pending" || text === "unpaid") return "pending";
  if (text === "partiallypaid") return "partially_paid";
  if (text === "partiallyrefunded") return "partially_refunded";
  if (text === "cancelled" || text === "canceled") return "voided";
  return "unknown";
}

export function derivePaymentDecisionStatus(
  paymentStatus: SupplierSalePaymentStatus,
  current?: SupplierSalePaymentDecision | null,
): SupplierSalePaymentDecision {
  if (paymentStatus === "paid") return "paid_confirmed";
  if (paymentStatus === "refunded" || paymentStatus === "partially_refunded") return "refunded";
  if (paymentStatus === "voided" || paymentStatus === "expired") return "canceled";
  if (current === "manual_approved_unpaid" || current === "wait_for_payment") return current;
  return "pending";
}

export function deriveAssignmentStatus(input: {
  paymentDecisionStatus: SupplierSalePaymentDecision;
  assignedSupplier?: SupplierSaleSupplier | null;
  currentStatus?: SupplierSaleAssignmentStatus | null;
  completedOfferSource?: boolean;
}): SupplierSaleAssignmentStatus {
  if (input.paymentDecisionStatus === "canceled" || input.paymentDecisionStatus === "refunded") return "canceled";
  if (input.assignedSupplier) {
    if (input.currentStatus === "in_production" || input.currentStatus === "completed" || input.currentStatus === "blocked") {
      return input.currentStatus;
    }
    return "assigned";
  }
  if (input.paymentDecisionStatus === "paid_confirmed" || input.paymentDecisionStatus === "manual_approved_unpaid") {
    return "ready_to_assign";
  }
  if (input.completedOfferSource && input.paymentDecisionStatus === "pending") return "ready_to_assign";
  if (input.paymentDecisionStatus === "wait_for_payment" || input.paymentDecisionStatus === "pending") return "payment_open";
  return "needs_review";
}

function lineItemText(item: SupplierLineItemInput) {
  return [
    item.title,
    item.variantTitle,
    item.sku,
    item.productType,
    item.section,
    item.description,
    item.rawLineItem ? JSON.stringify(item.rawLineItem) : null,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const RUSH_ORDER_PATTERN = /\b(express|eilauftrag|eilproduktion|eilbestellung|eilig|rush|urgent|priority|asap|sofort|dringend|schnellstmoeglich|schnellstmoglich)\b|(^|\s)eilt(\s|$)/;

function searchableSignalText(value: unknown, maxLength = 16000) {
  let text = "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    text = String(value);
  } else if (value && typeof value === "object") {
    try {
      text = JSON.stringify(value);
    } catch {
      text = "";
    }
  }
  return cleanText(text, maxLength)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

function hasRushOrderSignal(text: string) {
  return RUSH_ORDER_PATTERN.test(text);
}

function isNonProductionLine(item: SupplierLineItemInput) {
  const text = lineItemText(item);
  return /versand|shipping|lieferung|rabatt|discount|anzahlung|restzahlung|zahlung|payment|montage|installation/.test(text);
}

function isStandardNeonFlex(text: string) {
  if (/ohne\s+neon|kein\s+neon|nicht\s+neon|non[\s-]*neon/.test(text)) return false;
  return /led[\s-]*neon|neon[\s-]*flex|neonflex|neonschild|neon\s+sign|standard.*neon|\bneon\b/.test(text);
}

function quentinReasonsForItem(item: SupplierLineItemInput) {
  const text = lineItemText(item);
  const reasons: string[] = [];
  if (/uv[\s-]*print|uvdruck|uv[\s-]*druck/.test(text)) reasons.push("uv_print");
  if (/vollflaechig|vollflachig|vollflachig beleuchtet|vollflaechig beleuchtet/.test(text)) reasons.push("full_surface_lit_letters");
  if (/\b3d\b|3[\s-]*d|3d[\s-]*buchstaben|profilbuchstaben|buchstaben/.test(text)) reasons.push("three_d_letters");
  if (/rueckbeleuchtet|rueckleucht|backlit|halo[\s-]*lit|hinterleuchtet/.test(text)) reasons.push("backlit_letters");
  if (/acryl[\s-]*light[\s-]*box|acrylbox|light[\s-]*box|leuchtkasten|acryl[\s-]*kasten/.test(text)) reasons.push("acryl_light_box");
  if (/aussen|outdoor|wasserdicht|wetterfest|ip65|ip67|fuer aussen|fur aussen/.test(text)) reasons.push("outdoor");
  if (!reasons.length && !isNonProductionLine(item) && !isStandardNeonFlex(text)) reasons.push("non_standard_neon");
  return Array.from(new Set(reasons));
}

export function deriveSupplierRecommendation(items: SupplierLineItemInput[]): SupplierRecommendationResult {
  const productionItems = items.filter((item) => !isNonProductionLine(item));
  const decorated = items.map((item) => {
    const ruleReasons = quentinReasonsForItem(item);
    return {
      ...item,
      requiresQuentin: ruleReasons.length > 0,
      ruleReasons,
    };
  });

  const reasons = Array.from(new Set(decorated.flatMap((item) => item.ruleReasons)));
  if (reasons.length) {
    return {
      recommendedSupplier: "quentin",
      recommendationReasons: [`${SUPPLIER_RULE_VERSION}:quentin`, ...reasons],
      lineItems: decorated,
    };
  }

  if (productionItems.length && productionItems.every((item) => isStandardNeonFlex(lineItemText(item)))) {
    return {
      recommendedSupplier: "said",
      recommendationReasons: [`${SUPPLIER_RULE_VERSION}:standard_neon_flex`],
      lineItems: decorated,
    };
  }

  return {
    recommendedSupplier: productionItems.length ? "manual_review" : "unknown",
    recommendationReasons: [`${SUPPLIER_RULE_VERSION}:manual_review`],
    lineItems: decorated,
  };
}

function paymentLinkFromPayload(payload: JsonRecord) {
  return (
    recordString(payload, [
      "payment_url",
      "paymentUrl",
      "payment_link",
      "paymentLink",
      "invoice_url",
      "invoiceUrl",
      "invoiceUrlForCustomer",
      "checkout_url",
      "checkoutUrl",
      "checkout_web_url",
      "checkoutWebUrl",
      "order_status_url",
      "orderStatusUrl",
      "status_page_url",
      "statusPageUrl",
      "status_url",
      "statusUrl",
    ], 1000) ||
    nestedString(payload, ["order", "payment_url"], 1000) ||
    nestedString(payload, ["order", "payment_link"], 1000) ||
    nestedString(payload, ["order", "invoice_url"], 1000) ||
    nestedString(payload, ["order", "checkout_url"], 1000) ||
    nestedString(payload, ["order", "order_status_url"], 1000) ||
    nestedString(payload, ["order", "status_page_url"], 1000) ||
    nestedString(payload, ["order", "statusPageUrl"], 1000) ||
    nestedString(payload, ["order", "status_url"], 1000) ||
    nestedString(payload, ["checkout", "web_url"], 1000) ||
    nestedString(payload, ["checkout", "webUrl"], 1000) ||
    nestedString(payload, ["invoice", "url"], 1000) ||
    null
  );
}

function shopifyFulfillmentStatusFromPayload(payload: JsonRecord) {
  return normalizedTag(
    recordString(payload, ["fulfillment_status", "fulfillmentStatus", "displayFulfillmentStatus"], 120) ||
      recordString(jsonRecord(payload.order), ["fulfillment_status", "fulfillmentStatus", "displayFulfillmentStatus"], 120) ||
      recordString(jsonRecord(payload.fulfillment), ["status", "shipment_status", "shipmentStatus"], 120) ||
      recordString(jsonRecord(payload.shipping), ["status", "shipment_status", "shipmentStatus"], 120),
  );
}

function isCompletedShopifyFulfillmentStatus(value: unknown) {
  const status = normalizedTag(value);
  return [
    "fulfilled",
    "shipped",
    "delivered",
    "complete",
    "completed",
  ].includes(status);
}

function envConfigured(...keys: string[]) {
  return keys.some((key) => Boolean(nullableText(process.env[key], 1000)));
}

function supplierSalesAutomationToken() {
  return nullableText(
    process.env.SUPPLIER_SALES_AGENT_API_TOKEN ||
      process.env.QUOTE_INTERNAL_API_TOKEN ||
      process.env.OPS_INTERNAL_API_KEY ||
      process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY,
    1000,
  );
}

function offersAppBaseUrl() {
  return nullableText(
    process.env.NEONTRIP_OFFERS_BASE_URL ||
      process.env.OFFERS_BASE_URL ||
      process.env.NEXT_PUBLIC_OFFERS_BASE_URL ||
      "https://angebote.neontrip.de",
    1000,
  )?.replace(/\/+$/, "");
}

function offersInternalApiKeys() {
  const candidates = [
    process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY,
    process.env.OFFERS_INTERNAL_API_KEY,
    process.env.QUOTE_INTERNAL_API_TOKEN,
    process.env.OPS_INTERNAL_API_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  ]
    .map((value) => nullableText(value, 1000))
    .filter((value): value is string => Boolean(value));
  return [...new Set(candidates)];
}

function shopifyAdminToken() {
  return nullableText(
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
      process.env.SHOPIFY_ADMIN_TOKEN ||
      process.env.SHOPIFY_ADMIN_API_TOKEN ||
      process.env.SHOPIFY_ACCESS_TOKEN,
    500,
  );
}

function shopifyShopDomain() {
  return nullableText(
    process.env.SHOPIFY_SHOP_DOMAIN ||
      process.env.SHOPIFY_STORE_DOMAIN ||
      process.env.SHOPIFY_SHOP ||
      "neontrip.myshopify.com",
    260,
  )?.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function diagnostic(
  key: string,
  status: SupplierSalesDiagnosticStatus,
  label: string,
  detail: string,
): SupplierSalesDiagnostic {
  return { key, status, label, detail };
}

export function buildSupplierSalesDiagnostics(): SupplierSalesDiagnostics {
  const items: SupplierSalesDiagnostic[] = [];

  const incomingTokenReady = Boolean(supplierSalesAutomationToken());
  const incomingSignatureReady = envConfigured("SUPPLIER_SALES_WEBHOOK_SECRET", "SHOPIFY_SALE_WEBHOOK_SECRET", "N8N_SHOPIFY_SALE_WEBHOOK_SECRET");
  items.push(diagnostic(
    "incoming_sales_auth",
    incomingTokenReady || incomingSignatureReady ? "ok" : "missing",
    "Offer-/Shopify-Import",
    incomingTokenReady || incomingSignatureReady
      ? "Automatische Sales koennen serverseitig authentifiziert in die Produktion schreiben."
      : "SUPPLIER_SALES_AGENT_API_TOKEN, ein interner Ops/Offers-Key oder SUPPLIER_SALES_WEBHOOK_SECRET fehlt. Neue Sales koennen nicht automatisiert importiert werden.",
  ));

  const completedOffersPullReady = Boolean(offersAppBaseUrl() && offersInternalApiKeys().length);
  items.push(diagnostic(
    "completed_offers_pull",
    completedOffersPullReady ? "ok" : "missing",
    "Completed-Offers Pull",
    completedOffersPullReady
      ? "Ops kann abgeschlossene Angebote aktiv aus der Angebote-App nachziehen."
      : "NEONTRIP_OFFERS_INTERNAL_API_KEY muss in Ops und Angebote-App gleich gesetzt sein. Sonst kann Ops Completed Offers nicht aktiv nachziehen.",
  ));

  const shopifyAdminReady = Boolean(shopifyAdminToken() && shopifyShopDomain());
  items.push(diagnostic(
    "shopify_admin_api",
    shopifyAdminReady ? "ok" : "missing",
    "Shopify Admin API",
    shopifyAdminReady
      ? "Shopify Admin API ist konfiguriert; Shopify-Sales und Supplier-Tags koennen abgeglichen werden."
      : "SHOPIFY_ADMIN_API_ACCESS_TOKEN/SHOPIFY_ADMIN_TOKEN plus SHOPIFY_SHOP_DOMAIN muessen in Coolify gesetzt sein. Keine Secrets committen.",
  ));

  const quentinTagReady = Boolean(supplierTagValue("quentin"));
  const saidTagReady = Boolean(supplierTagValue("said"));
  const specialTagReady = Boolean(supplierTagValue("special"));
  const requiredSupplierTagsReady = quentinTagReady && saidTagReady;
  items.push(diagnostic(
    "shopify_supplier_tags",
    shopifyAdminReady && requiredSupplierTagsReady ? "ok" : requiredSupplierTagsReady ? "warning" : "missing",
    "Shopify-Tags",
    shopifyAdminReady && requiredSupplierTagsReady
      ? `Quentin/Saeid Tags sind konfiguriert${specialTagReady ? ", Sonder-Supplier ebenfalls." : "."}`
      : requiredSupplierTagsReady
        ? "Quentin/Saeid Tags sind vorbereitet; fuer den Shopify-Abgleich fehlt noch die Shopify Admin API."
      : "Shopify Admin API plus SUPPLIER_TAG_QUENTIN und SUPPLIER_TAG_SAID muessen gesetzt sein, damit Vergaben in Shopify getaggt werden.",
  ));

  const trelloAuthReady = envConfigured("TRELLO_API_KEY") && envConfigured("TRELLO_TOKEN");
  items.push(diagnostic(
    "trello_api_key",
    trelloAuthReady ? "ok" : "missing",
    "Trello API Key",
    trelloAuthReady
      ? "TRELLO_API_KEY und TRELLO_TOKEN sind konfiguriert."
      : "TRELLO_API_KEY und TRELLO_TOKEN fehlen oder sind unvollstaendig. Trello bleibt Projektion, nicht Source of Truth.",
  ));

  const quentinListReady = Boolean(supplierTrelloListId("quentin"));
  const saidListReady = Boolean(supplierTrelloListId("said"));
  const specialListReady = Boolean(supplierTrelloListId("special"));
  items.push(diagnostic(
    "supplier_trello_projection",
    trelloAuthReady && quentinListReady && saidListReady ? "ok" : "warning",
    "Supplier-Trello",
    trelloAuthReady && quentinListReady && saidListReady
      ? `Quentin/Saeid Listen sind konfiguriert${specialListReady ? ", Sonder-Supplier ebenfalls." : "."}`
      : "Trello-Projektion wird uebersprungen, bis TRELLO_API_KEY/TRELLO_TOKEN und die Supplier-Listen-IDs gesetzt sind.",
  ));

  const reminderWebhookReady = Boolean(paymentReminderWebhookUrl());
  items.push(diagnostic(
    "payment_reminders",
    reminderWebhookReady ? "ok" : "warning",
    "Zahlungserinnerungen",
    reminderWebhookReady
      ? "Zahlungserinnerungen koennen an den konfigurierten Workflow uebergeben werden."
      : "Kein Reminder-Webhook gesetzt. Die Software erstellt stattdessen interne Aufgaben, damit nichts verloren geht.",
  ));

  const missing = items.filter((item) => item.status === "missing").map((item) => item.key);
  return {
    ready: missing.length === 0,
    items,
    missing,
  };
}

function noteAttributeValue(payload: JsonRecord, keys: string[]) {
  const normalizedKeys = new Set(keys.map((key) => key.toLowerCase().replace(/[^a-z0-9]/g, "")));
  const candidates = [
    ...arrayRecords(payload.note_attributes),
    ...arrayRecords(payload.noteAttributes),
    ...arrayRecords(jsonRecord(payload.order).note_attributes),
    ...arrayRecords(jsonRecord(payload.order).noteAttributes),
  ];
  for (const candidate of candidates) {
    const name = cleanText(candidate.name || candidate.key || candidate.label, 120).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalizedKeys.has(name)) return candidate.value;
  }
  return null;
}

function noteAttributeString(payload: JsonRecord, keys: string[], maxLength = 500) {
  return cleanText(noteAttributeValue(payload, keys), maxLength);
}

function shopifyNoteText(payload: JsonRecord) {
  const order = jsonRecord(payload.order);
  const attributes = [
    ...arrayRecords(payload.note_attributes),
    ...arrayRecords(payload.noteAttributes),
    ...arrayRecords(order.note_attributes),
    ...arrayRecords(order.noteAttributes),
  ]
    .map((attribute) => `${cleanText(attribute.name || attribute.key || attribute.label, 120)}: ${cleanText(attribute.value, 1000)}`.trim())
    .filter(Boolean);
  return [
    recordString(payload, ["note", "notes", "note_text", "noteText"], 5000),
    recordString(order, ["note", "notes", "note_text", "noteText"], 5000),
    ...attributes,
  ].filter(Boolean).join("\n");
}

function shopifyNoteMatch(payload: JsonRecord, pattern: RegExp, maxLength = 500) {
  const match = shopifyNoteText(payload).match(pattern);
  return match ? cleanText(match[1], maxLength) : null;
}

function shopifyOfferReferences(payload: JsonRecord) {
  const noteText = shopifyNoteText(payload);
  const offerNumberPattern = /(A\/N\s*\d+)/i;
  return {
    offerId:
      noteAttributeString(payload, ["NEONTRIP Offer ID", "Offer ID", "offer_id", "offerId"], 180) ||
      shopifyNoteMatch(payload, /NEONTRIP\s+Offer\s+ID\s*:?\s*([a-z0-9_-]+)/i, 180),
    offerNumber:
      noteAttributeString(payload, ["NEONTRIP Offer Number", "NEONTRIP Angebot", "Offer Number", "offer_number", "offerNumber"], 120) ||
      shopifyNoteMatch(payload, /NEONTRIP\s+Offer\s+Number\s*:?\s*(A\/N\s*\d+)/i, 120) ||
      shopifyNoteMatch(payload, /NEONTRIP\s+Angebot\s*:?\s*(A\/N\s*\d+)/i, 120) ||
      cleanText(noteText.match(offerNumberPattern)?.[1], 120),
    offerPublicUrl:
      noteAttributeString(payload, ["NEONTRIP Offer URL", "Angebotslink", "Offer URL", "offer_public_url", "offerPublicUrl"], 1000) ||
      shopifyNoteMatch(payload, /(?:NEONTRIP\s+Offer\s+URL|Angebotslink)\s*:?\s*(https?:\/\/\S+)/i, 1000),
    finalPdfUrl:
      noteAttributeString(payload, ["NEONTRIP PDF Snapshot", "PDF Snapshot", "final_pdf_url", "finalPdfUrl"], 1000) ||
      shopifyNoteMatch(payload, /(?:NEONTRIP\s+PDF\s+Snapshot|PDF\s+Snapshot)\s*:?\s*(https?:\/\/\S+)/i, 1000),
    trelloCardId:
      noteAttributeString(payload, ["Trello Card ID", "trello_card_id", "trelloCardId"], 160) ||
      shopifyNoteMatch(payload, /Trello\s+Card\s+ID\s*:?\s*([0-9a-f]{24})/i, 160),
    requestId:
      noteAttributeString(payload, [
        "Nerdy-Forms_ID",
        "Nerdy Forms ID",
        "NerdyForms ID",
        "nerdy_forms_id",
        "nerdyforms_id",
        "nerdyform_id",
        "request_id",
        "requestId",
        "Unique Identifier Code",
      ], 160) ||
      shopifyNoteMatch(payload, /(?:Nerdy[-_\s]*Forms(?:[_\s-]*ID)?|nerdy[_\s-]*forms[_\s-]*id|request[_\s-]*id|unique\s+identifier\s+code)\s*:?\s*([a-z0-9_-]+)/i, 160),
    idempotencyKey:
      noteAttributeString(payload, ["Idempotency Key", "idempotency_key", "idempotencyKey"], 260) ||
      shopifyNoteMatch(payload, /Idempotency\s+Key\s*:?\s*([^\s]+)/i, 260),
  };
}

function extractDueDate(payload: JsonRecord) {
  const keys = [
    "deadline",
    "due_date",
    "duedate",
    "customer_due_date",
    "customerDueDate",
    "supplier_due_date",
    "supplierDueDate",
    "requested_delivery_date",
    "requestedDeliveryDate",
    "deliveryDateIso",
    "delivery_date",
    "deliveryDate",
    "lieferdatum",
    "liefertermin",
    "wunschdatum",
    "benoetigt_bis",
    "needed_by",
    "estimated_delivery_date",
    "estimatedDeliveryDate",
  ];
  const direct =
    recordString(payload, keys, 120) ||
    recordString(jsonRecord(payload.order), keys, 120) ||
    nestedString(payload, ["delivery", "requestedDate"], 120) ||
    nestedString(payload, ["delivery", "date"], 120) ||
    nestedString(payload, ["shipping", "requestedDate"], 120);
  const noteValue = noteAttributeValue(payload, keys);
  const due = normalizeDateOnly(direct || noteValue);
  return {
    date: due,
    source: due ? (direct ? "payload" : "shopify_note_attribute") : null,
    note: due ? cleanText(direct || noteValue, 200) : null,
  };
}

function customerNameFromParts(parts: Array<unknown>) {
  const values = parts.map((part) => cleanText(part, 120)).filter(Boolean);
  const fullName = values.find((value) => /\s/.test(value));
  if (fullName) return fullName;
  const uniqueParts = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  const text = uniqueParts.join(" ").trim();
  return text || null;
}

function firstImageUrlFromValue(value: unknown, depth = 0): string | null {
  if (depth > 5) return null;
  if (typeof value === "string") {
    const text = nullableText(value, 1000);
    if (text && /^https?:\/\//i.test(text) && /\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(text)) return text;
    return null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const image = firstImageUrlFromValue(entry, depth + 1);
      if (image) return image;
    }
    return null;
  }
  const record = jsonRecord(value);
  if (!Object.keys(record).length) return null;
  const direct = recordString(record, [
    "imageUrl",
    "image_url",
    "sourceUrl",
    "source_url",
    "localUrl",
    "local_url",
    "previewUrl",
    "preview_url",
    "posterUrl",
    "poster_url",
    "previewVideoPosterUrl",
    "src",
    "url",
  ], 1000);
  if (direct && /^https?:\/\//i.test(direct) && !/\.pdf(?:[?#].*)?$/i.test(direct)) return direct;
  for (const key of ["image", "images", "mockups", "media", "preview", "thumbnail", "asset", "file"]) {
    const image = firstImageUrlFromValue(record[key], depth + 1);
    if (image) return image;
  }
  return null;
}

function selectedImageFromOfferItem(item: JsonRecord, payload: JsonRecord) {
  return firstImageUrlFromValue(item) || selectedImageFromOfferPayload(payload);
}

function selectedImageFromOfferPayload(payload: JsonRecord) {
  const media = jsonRecord(payload.media);
  const mockups = arrayRecords(media.mockups);
  return (
    recordString(mockups[0] || {}, ["url", "sourceUrl", "localUrl"], 1000) ||
    recordString(media, ["posterUrl", "previewVideoPosterUrl"], 1000) ||
    firstImageUrlFromValue(payload.images) ||
    firstImageUrlFromValue(jsonRecord(payload.offer).images) ||
    firstImageUrlFromValue(payload.lineItems) ||
    firstImageUrlFromValue(media)
  );
}

function parseOfferCompletedPayload(payload: JsonRecord): SupplierSalePayloadParseResult | null {
  if (recordString(payload, ["source"]) !== "neontrip-offers" || recordString(payload, ["event"]) !== "offer.completed") return null;

  const offer = jsonRecord(payload.offer);
  const customer = jsonRecord(payload.customer);
  const totals = jsonRecord(payload.totals);
  const lineItems = arrayRecords(payload.lineItems).map((item, index): SupplierLineItemInput => ({
    lineItemKey: recordString(item, ["id"], 120) || `offer-line:${index + 1}`,
    title: recordString(item, ["title"], 500) || "Angebotsposition",
    sku: recordString(item, ["sku"], 120),
    variantTitle: recordString(item, ["variantTitle"], 500),
    quantity: numericValue(item.quantity) || numericValue(item.normalizedQuantity) || 1,
    productType: recordString(item, ["section"], 120),
    imageUrl: selectedImageFromOfferItem(item, payload),
    section: recordString(item, ["section"], 120),
    description: recordString(item, ["description"], 4000),
    rawLineItem: item,
  }));

  const due = extractDueDate(payload);
  const offerId = recordString(offer, ["id"], 160);
  const idempotencyKey = recordString(payload, ["idempotencyKey"], 260);
  const saleKey = offerId ? `offer:${offerId}` : idempotencyKey || `offer-payload:${hashPayload(payload)}`;
  const totalGross = numericValue(totals.totalGross);
  const subtotalNet = numericValue(totals.subtotalNet);

  return {
    warnings: due.date ? [] : ["Kein Lieferdatum im Angebots-Payload gefunden."],
    sale: {
      saleKey,
      source: "neontrip-offers",
      shopifyOrderId: recordString(payload, ["shopifyOrderId", "orderId"], 120),
      shopifyOrderName: recordString(payload, ["shopifyOrderName", "orderName"], 120),
      shopifyOrderUrl: recordString(payload, ["shopifyOrderUrl", "orderUrl"], 1000),
      shopifyPaymentStatus: recordString(payload, ["financial_status", "financialStatus", "paymentStatus"], 80) || "unknown",
      offerId,
      offerNumber: recordString(offer, ["offerNumber"], 120),
      documentReference: recordString(offer, ["documentReference"], 160),
      offerPublicUrl: recordString(offer, ["publicUrl"], 1000),
      finalPdfUrl: recordString(offer, ["finalPdfUrl"], 1000),
      trelloCardId: recordString(offer, ["trelloCardId"], 160),
      requestId: recordString(offer, ["requestId"], 160),
      customerName: customerNameFromParts([
        customer.firstName,
        customer.lastName,
        customer.signerName,
        jsonRecord(payload.billingAddress).name,
        jsonRecord(payload.deliveryAddress).name,
      ]),
      customerEmail: recordString(customer, ["email", "signerEmail"], 260),
      customerPhone: recordString(customer, ["phone"], 120),
      customerCompany: recordString(customer, ["company"], 260),
      currency: recordString(offer, ["currency"], 12) || "EUR",
      subtotalPrice: subtotalNet,
      totalPrice: totalGross,
      customerDueDate: due.date,
      supplierDueDate: due.date,
      dueDateSource: due.source,
      dueDateNote: due.note,
      productSummary: lineItems.map((item) => cleanText(item.title, 120)).filter(Boolean).slice(0, 3).join(", ") || null,
      primaryImageUrl: selectedImageFromOfferPayload(payload),
      rawShopify: {},
      offerSnapshot: payload,
      metadata: {
        source_event: "offer.completed",
        accepted_at: recordString(offer, ["acceptedAt"], 80),
        signed_at: recordString(offer, ["signedAt"], 80),
        tax_exempt: Boolean(totals.taxExempt),
        payment_link: paymentLinkFromPayload(payload),
        post_order_review: jsonRecord(payload.postOrderReview),
      },
      idempotencyKey,
      lineItems,
    },
  };
}

function lineItemImage(item: JsonRecord) {
  return (
    nestedString(item, ["image", "src"], 1000) ||
    nestedString(item, ["image", "url"], 1000) ||
    nestedString(item, ["variant", "image", "src"], 1000) ||
    nestedString(item, ["variant", "image", "url"], 1000) ||
    recordString(item, ["image_url", "imageUrl"], 1000)
  );
}

function parseShopifyOrderPayload(payload: JsonRecord): SupplierSalePayloadParseResult {
  const order = jsonRecord(payload.order);
  const source = Object.keys(order).length ? order : payload;
  const lineItems = [
    ...arrayRecords(source.line_items),
    ...arrayRecords(source.lineItems),
  ].map((item, index): SupplierLineItemInput => ({
    lineItemKey: recordString(item, ["id", "admin_graphql_api_id", "lineItemKey"], 180) || `shopify-line:${index + 1}`,
    title: recordString(item, ["title", "name"], 500) || "Shopify-Position",
    sku: recordString(item, ["sku"], 120),
    variantTitle: recordString(item, ["variant_title", "variantTitle"], 500),
    quantity: numericValue(item.quantity) || 1,
    productType: recordString(item, ["product_type", "productType"], 160),
    imageUrl: lineItemImage(item),
    description: [
      recordString(item, ["name"], 500),
      recordString(item, ["vendor"], 160),
      JSON.stringify(item.properties || item.customAttributes || []),
    ].filter(Boolean).join(" "),
    rawLineItem: item,
  }));

  const due = extractDueDate(source);
  const shopifyOrderId = recordString(source, ["id", "order_id", "shopify_order_id"], 160);
  const shopifyGraphqlId = recordString(source, ["admin_graphql_api_id", "adminGraphqlApiId"], 260);
  const shopifyOrderName = recordString(source, ["name", "order_number", "shopify_order_number", "shopify_order_name"], 160);
  const customer = jsonRecord(source.customer);
  const billing = jsonRecord(source.billing_address || source.billingAddress);
  const shipping = jsonRecord(source.shipping_address || source.shippingAddress);
  const references = shopifyOfferReferences(source);
  const saleKey = shopifyOrderId || shopifyGraphqlId || shopifyOrderName
    ? `shopify:order:${shopifyOrderId || shopifyGraphqlId || shopifyOrderName}`
    : `shopify-payload:${hashPayload(payload)}`;

  return {
    warnings: due.date ? [] : ["Kein Lieferdatum im Shopify-Payload gefunden."],
    sale: {
      saleKey,
      source: "shopify",
      shopifyOrderId: shopifyOrderId || shopifyGraphqlId,
      shopifyOrderName,
      shopifyOrderUrl: recordString(source, ["admin_url", "adminUrl", "order_status_url", "orderStatusUrl"], 1000),
      shopifyPaymentStatus: recordString(source, ["financial_status", "financialStatus", "payment_status", "paymentStatus"], 80) || "unknown",
      offerId: recordString(source, ["offer_id", "offerId", "quote_id", "quoteId"], 160) || references.offerId,
      offerNumber: recordString(source, ["offer_number", "offerNumber", "quote_number", "quoteNumber"], 120) || references.offerNumber,
      documentReference: recordString(source, ["document_reference", "documentReference"], 160),
      offerPublicUrl: recordString(source, ["offer_public_url", "offerPublicUrl"], 1000) || references.offerPublicUrl,
      finalPdfUrl: recordString(source, ["final_pdf_url", "finalPdfUrl"], 1000) || references.finalPdfUrl,
      trelloCardId: recordString(source, ["trello_card_id", "trelloCardId"], 160) || references.trelloCardId,
      requestId: recordString(source, ["request_id", "requestId", "nerdy_forms_id", "nerdyforms_id", "Nerdy-Forms_ID"], 160) || references.requestId,
      customerName:
        recordString(source, ["customer_name", "customerName"], 260) ||
        customerNameFromParts([customer.first_name, customer.firstName, customer.last_name, customer.lastName]) ||
        recordString(billing, ["name"], 260) ||
        recordString(shipping, ["name"], 260),
      customerEmail:
        recordString(source, ["email", "contact_email", "customer_email", "customerEmail"], 260) ||
        recordString(customer, ["email"], 260) ||
        recordString(billing, ["email"], 260) ||
        recordString(shipping, ["email"], 260),
      customerPhone:
        recordString(source, ["phone", "customer_phone", "customerPhone"], 120) ||
        recordString(customer, ["phone"], 120) ||
        recordString(billing, ["phone"], 120) ||
        recordString(shipping, ["phone"], 120),
      customerCompany: recordString(source, ["customer_company", "customerCompany"], 260) || recordString(billing, ["company"], 260) || recordString(shipping, ["company"], 260),
      currency: recordString(source, ["currency", "currency_code", "currencyCode"], 12) || "EUR",
      subtotalPrice: numericValue(source.subtotal_price || source.current_subtotal_price || source.subtotalPrice),
      totalPrice: numericValue(source.total_price || source.current_total_price || source.totalPrice),
      customerDueDate: due.date,
      supplierDueDate: due.date,
      dueDateSource: due.source,
      dueDateNote: due.note,
      productSummary: lineItems.map((item) => cleanText(item.title, 120)).filter(Boolean).slice(0, 3).join(", ") || null,
      primaryImageUrl: lineItems.map((item) => nullableText(item.imageUrl, 1000)).find(Boolean) || null,
      rawShopify: source,
      offerSnapshot: {},
      metadata: {
        source_event: recordString(payload, ["event"], 120) || "shopify_order",
        payment_link: paymentLinkFromPayload(source),
        admin_graphql_api_id: shopifyGraphqlId,
        fulfillment_status: shopifyFulfillmentStatusFromPayload(source) || null,
        idempotency_key: references.idempotencyKey,
      },
      idempotencyKey: recordString(payload, ["idempotencyKey", "idempotency_key"], 260) || recordString(source, ["idempotencyKey", "idempotency_key"], 260) || references.idempotencyKey,
      lineItems,
    },
  };
}

export function buildSupplierSaleInputFromPayload(payload: unknown): SupplierSalePayloadParseResult {
  const record = jsonRecord(payload);
  if (!Object.keys(record).length) {
    throw new QuoteValidationError("Sale-Payload fehlt.", ["Sale-Payload fehlt."], 422);
  }
  const offerCompleted = parseOfferCompletedPayload(record);
  if (offerCompleted) return offerCompleted;
  if (recordString(record, ["source"]) === "neontrip-offers") {
    throw new QuoteValidationError(
      "Nur offer.completed Events koennen als Produktion importiert werden.",
      ["Unsupported neontrip-offers event."],
      422,
    );
  }
  return parseShopifyOrderPayload(record);
}

function itemDetailLine(label: string, value: unknown, maxLength = 220) {
  const text = nullableText(value, maxLength);
  return text ? `${label}: ${text}` : null;
}

function optionDetailLines(value: unknown) {
  const records = arrayRecords(value);
  return records.map((entry) => {
    const name = recordString(entry, ["name", "label", "title", "key"], 80);
    const optionValue = recordString(entry, ["value", "text", "selected", "option"], 180);
    if (!name && !optionValue) return null;
    return name && optionValue ? `${name}: ${optionValue}` : name || optionValue;
  }).filter((line): line is string => Boolean(line));
}

function itemSelectionDetails(row: SupplierSaleItemRow) {
  const raw = jsonRecord(row.raw_line_item);
  const details = [
    itemDetailLine("Bereich", row.product_type || raw.section || raw.category),
    itemDetailLine("Variante", row.variant_title || raw.variantTitle),
    itemDetailLine("SKU", row.sku || raw.sku),
    itemDetailLine("Groesse", raw.size || raw.format || raw.dimensions),
    itemDetailLine("Breite", raw.width),
    itemDetailLine("Hoehe", raw.height),
    itemDetailLine("Farbe", raw.color || raw.lightColor || raw.ledColor),
    itemDetailLine("Rueckwand", raw.backboard || raw.backing || raw.acrylic),
    itemDetailLine("Montage", raw.mounting || raw.installation),
    itemDetailLine("Outdoor", raw.outdoor),
    ...optionDetailLines(raw.options),
    ...optionDetailLines(raw.properties),
    ...optionDetailLines(raw.selectedOptions),
  ].filter((line): line is string => Boolean(line));

  return [...new Set(details)].slice(0, 10);
}

function mapItem(row: SupplierSaleItemRow): SupplierSaleItem {
  const raw = jsonRecord(row.raw_line_item);
  return {
    id: row.id,
    saleId: row.sale_id,
    lineItemKey: row.line_item_key,
    title: row.title,
    sku: row.sku,
    variantTitle: row.variant_title,
    description: recordString(raw, ["description", "summary", "details"], 1000),
    selectionDetails: itemSelectionDetails(row),
    quantity: Number(row.quantity || 1),
    productType: row.product_type,
    imageUrl: row.image_url,
    requiresQuentin: Boolean(row.requires_quentin),
    ruleReasons: row.rule_reasons || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: SupplierSaleEventRow): SupplierSaleEvent {
  return {
    id: row.id,
    saleId: row.sale_id,
    eventType: row.event_type,
    actor: row.actor,
    idempotencyKey: row.idempotency_key,
    payload: row.payload || {},
    createdAt: row.created_at,
  };
}

function mapOrderConfirmationEmailState(metadata: JsonRecord): SupplierOrderConfirmationEmailState | null {
  const raw = jsonRecord(metadata.order_confirmation_email);
  const status = cleanText(raw.status, 40) as SupplierOrderConfirmationEmailStatus;
  if (!["sent", "failed", "skipped"].includes(status)) return null;
  return {
    status,
    recipientEmail: lowerNullable(raw.recipient_email ?? raw.recipientEmail, 260),
    requestedAt: nullableText(raw.requested_at ?? raw.requestedAt, 80),
    sentAt: nullableText(raw.sent_at ?? raw.sentAt, 80),
    requestedBy: nullableText(raw.requested_by ?? raw.requestedBy, 120),
    providerMessageId: nullableText(raw.provider_message_id ?? raw.providerMessageId, 260),
    error: nullableText(raw.error, 1000),
  };
}

function paymentLinkFromSaleRow(row: SupplierSaleRow, latestEvent: SupplierSaleEvent | null) {
  return (
    nullableText(row.metadata?.payment_link, 1000) ||
    nullableText(row.metadata?.paymentLink, 1000) ||
    nullableText(latestEvent?.payload?.payment_link, 1000) ||
    nullableText(latestEvent?.payload?.paymentLink, 1000) ||
    paymentLinkFromPayload(row.raw_shopify || {}) ||
    paymentLinkFromPayload(jsonRecord(row.raw_shopify?.order)) ||
    null
  );
}

function postOrderReviewFromRow(row: SupplierSaleRow): SupplierSalePostOrderReview {
  const metadataReview = jsonRecord(row.metadata?.post_order_review);
  const snapshotReview = jsonRecord(row.offer_snapshot?.postOrderReview);
  const review = Object.keys(metadataReview).length ? metadataReview : snapshotReview;
  const signedAt = nullableText(review.signedAt, 80);
  const expiresAt = nullableText(review.expiresAt, 80);
  const changeRequestedAt = nullableText(review.changeRequestedAt, 80);
  const message = nullableText(review.message, 2000);
  const eventId = nullableText(review.eventId, 160);
  const rawStatus = nullableText(review.status, 60);
  const expiresMs = expiresAt ? new Date(expiresAt).getTime() : NaN;
  const status: SupplierSalePostOrderReview["status"] =
    rawStatus === "change_requested" || Boolean(message || changeRequestedAt)
      ? "change_requested"
      : Number.isFinite(expiresMs)
        ? Date.now() < expiresMs ? "open" : "closed"
        : rawStatus === "open" || rawStatus === "closed"
          ? rawStatus
          : "unknown";

  return { status, signedAt, expiresAt, changeRequestedAt, message, eventId };
}

const QUENTIN_NEON_BOARD_URL = "https://trello.com/b/9QNAfkv4/quentin-neon-signs";
const QUENTIN_NEON_BOARD_ID = "62bae9b97705e7419ed64593";

function trelloCardUrlFromId(value: unknown) {
  const cardId = trelloCardIdFromValue(value);
  return cardId ? `https://trello.com/c/${encodeURIComponent(cardId)}` : null;
}

function supplierSaleTrelloSearchUrl(row: SupplierSaleRow) {
  const query = nullableText(
    row.shopify_order_name ||
      row.offer_number ||
      row.document_reference ||
      row.offer_id ||
      row.request_id ||
      row.sale_key,
    180,
  );
  if (!query) return QUENTIN_NEON_BOARD_URL;
  return `https://trello.com/search?q=${encodeURIComponent(`${query} board:${QUENTIN_NEON_BOARD_ID}`)}`;
}

function supplierSaleHasRushSignal(row: SupplierSaleRow, items: SupplierSaleItem[] = []) {
  const rowText = searchableSignalText([
    row.product_summary,
    row.due_date_note,
    row.metadata,
    row.raw_shopify,
    row.offer_snapshot,
  ]);
  if (hasRushOrderSignal(rowText)) return true;
  return items.some((item) =>
    hasRushOrderSignal(searchableSignalText([
      item.title,
      item.variantTitle,
      item.sku,
      item.productType,
      item.ruleReasons,
    ])),
  );
}

function mapSale(row: SupplierSaleRow, items: SupplierSaleItem[] = [], latestEvent: SupplierSaleEvent | null = null): SupplierSale {
  const itemImage = items.map((item) => nullableText(item.imageUrl, 1000)).find(Boolean) || null;
  return {
    id: row.id,
    saleKey: row.sale_key,
    source: row.source,
    shopifyOrderId: row.shopify_order_id,
    shopifyOrderName: row.shopify_order_name,
    shopifyOrderUrl: row.shopify_order_url,
    paymentLink: paymentLinkFromSaleRow(row, latestEvent),
    shopifyPaymentStatus: row.shopify_payment_status,
    paymentDecisionStatus: row.payment_decision_status,
    paymentDueAt: row.payment_due_at,
    lastPaymentReminderAt: row.last_payment_reminder_at,
    paymentReminderCount: Number(row.payment_reminder_count || 0),
    offerId: row.offer_id,
    offerNumber: row.offer_number,
    documentReference: row.document_reference,
    offerPublicUrl: row.offer_public_url,
    finalPdfUrl: row.final_pdf_url,
    trelloCardId: row.trello_card_id,
    sourceTrelloCardUrl: trelloCardUrlFromId(row.trello_card_id),
    quentinTrelloBoardUrl: QUENTIN_NEON_BOARD_URL,
    quentinTrelloSearchUrl: supplierSaleTrelloSearchUrl(row),
    requestId: row.request_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    customerCompany: row.customer_company,
    currency: row.currency || "EUR",
    subtotalPrice: numericValue(row.subtotal_price),
    totalPrice: numericValue(row.total_price),
    customerDueDate: row.customer_due_date,
    supplierDueDate: row.supplier_due_date,
    dueDateSource: row.due_date_source,
    dueDateNote: row.due_date_note,
    recommendedSupplier: row.recommended_supplier,
    recommendationReasons: row.recommendation_reasons || [],
    assignedSupplier: row.assigned_supplier,
    specialSupplierName: row.special_supplier_name,
    assignmentStatus: row.assignment_status,
    assignmentNote: row.assignment_note,
    assignedAt: row.assigned_at,
    assignedBy: row.assigned_by,
    shopifyTagSyncStatus: row.shopify_tag_sync_status,
    shopifyTagValue: row.shopify_tag_value,
    shopifyTagSyncedAt: row.shopify_tag_synced_at,
    shopifyTagError: row.shopify_tag_error,
    trelloProjectionStatus: row.trello_projection_status,
    supplierTrelloCardId: row.supplier_trello_card_id,
    supplierTrelloCardUrl: row.supplier_trello_card_url,
    trelloProjectionError: row.trello_projection_error,
    taskSyncStatus: row.task_sync_status,
    activeTaskId: row.active_task_id,
    taskSyncError: row.task_sync_error,
    productSummary: row.product_summary,
    primaryImageUrl: row.primary_image_url || itemImage,
    rushOrder: supplierSaleHasRushSignal(row, items),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items,
    latestEvent,
    orderConfirmationEmail: mapOrderConfirmationEmailState(row.metadata || {}),
    postOrderReview: postOrderReviewFromRow(row),
  };
}

function assignmentPriority(row: SupplierSaleRow) {
  if (row.assignment_status === "ready_to_assign") return 0;
  if (row.assignment_status === "payment_open") return 1;
  if (row.assignment_status === "needs_review") return 2;
  if (row.assignment_status === "assigned") return 3;
  return 4;
}

function dateTimeMs(value: unknown) {
  const text = nullableText(value, 80);
  if (!text) return null;
  const timestamp = new Date(text).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function saleRecencyMs(row: SupplierSaleRow) {
  const metadata = jsonRecord(row.metadata);
  const snapshot = jsonRecord(row.offer_snapshot);
  const offer = jsonRecord(snapshot.offer);
  return (
    dateTimeMs(metadata.accepted_at) ||
    dateTimeMs(metadata.acceptedAt) ||
    dateTimeMs(metadata.signed_at) ||
    dateTimeMs(metadata.signedAt) ||
    dateTimeMs(offer.acceptedAt) ||
    dateTimeMs(offer.signedAt) ||
    dateTimeMs(snapshot.acceptedAt) ||
    dateTimeMs(snapshot.signedAt) ||
    dateTimeMs(row.raw_shopify?.created_at) ||
    dateTimeMs(row.raw_shopify?.processed_at) ||
    dateTimeMs(row.created_at) ||
    dateTimeMs(row.updated_at) ||
    0
  );
}

function buildSupplierSaleCountsFromRows(saleRows: SupplierSaleRow[], now = new Date()): SupplierSaleBoard["counts"] {
  const today = now.toISOString().slice(0, 10);
  const dueSoonLimit = new Date(now);
  dueSoonLimit.setUTCDate(dueSoonLimit.getUTCDate() + 7);
  const dueSoon = dueSoonLimit.toISOString().slice(0, 10);
  const activeRows = saleRows.filter((row) => !hasExternalSupplierAssignmentSignal(row) && !hasCompletedShopifyFulfillmentSignal(row));
  return {
    total: saleRows.length,
    readyToAssign: activeRows.filter((row) => row.assignment_status === "ready_to_assign").length,
    paymentOpen: activeRows.filter((row) => row.assignment_status === "payment_open").length,
    assigned: saleRows.filter((row) => ["assigned", "in_production"].includes(row.assignment_status)).length,
    dueSoon: saleRows.filter((row) => {
      const dueDate = row.supplier_due_date || row.customer_due_date;
      return Boolean(dueDate && dueDate >= today && dueDate <= dueSoon && !["completed", "canceled"].includes(row.assignment_status));
    }).length,
    overdue: saleRows.filter((row) => {
      const dueDate = row.supplier_due_date || row.customer_due_date;
      return Boolean(dueDate && dueDate < today && !["completed", "canceled"].includes(row.assignment_status));
    }).length,
    rushOrders: saleRows.filter((row) => supplierSaleHasRushSignal(row)).length,
    quentinRecommended: saleRows.filter((row) => row.recommended_supplier === "quentin").length,
    saidRecommended: saleRows.filter((row) => row.recommended_supplier === "said").length,
    syncIssues: saleRows.filter((row) => {
      if (["completed", "canceled"].includes(row.assignment_status)) return false;
      return [row.shopify_tag_sync_status, row.trello_projection_status, row.task_sync_status].includes("failed");
    }).length,
  };
}

export function buildSupplierSaleBoardFromRows(
  saleRows: SupplierSaleRow[],
  itemRows: SupplierSaleItemRow[],
  eventRows: SupplierSaleEventRow[] = [],
  now = new Date(),
  sortMode: "newest" | "deadline" = "newest",
  countsOverride?: SupplierSaleBoard["counts"],
): SupplierSaleBoard {
  const itemsBySale = new Map<string, SupplierSaleItem[]>();
  for (const row of itemRows) {
    const list = itemsBySale.get(row.sale_id) || [];
    list.push(mapItem(row));
    itemsBySale.set(row.sale_id, list);
  }

  const latestEventBySale = new Map<string, SupplierSaleEvent>();
  for (const row of eventRows) {
    if (!row.sale_id) continue;
    const event = mapEvent(row);
    const existing = latestEventBySale.get(row.sale_id);
    if (!existing || new Date(event.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
      latestEventBySale.set(row.sale_id, event);
    }
  }

  const rowsById = new Map(saleRows.map((row) => [row.id, row]));
  const items = saleRows.map((row) => mapSale(row, itemsBySale.get(row.id) || [], latestEventBySale.get(row.id) || null));
  items.sort((left, right) => {
    const leftRow = rowsById.get(left.id) || rowFromSale(left);
    const rightRow = rowsById.get(right.id) || rowFromSale(right);
    if (sortMode === "deadline") {
      const rank = assignmentPriority(leftRow) - assignmentPriority(rightRow);
      if (rank !== 0) return rank;
      const leftDue = left.supplierDueDate ? new Date(left.supplierDueDate).getTime() : Number.POSITIVE_INFINITY;
      const rightDue = right.supplierDueDate ? new Date(right.supplierDueDate).getTime() : Number.POSITIVE_INFINITY;
      if (leftDue !== rightDue) return leftDue - rightDue;
    }
    const recency = saleRecencyMs(rightRow) - saleRecencyMs(leftRow);
    if (recency !== 0) return recency;
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });

  return {
    items,
    counts: countsOverride || buildSupplierSaleCountsFromRows(saleRows, now),
    diagnostics: buildSupplierSalesDiagnostics(),
  };
}

export function supplierSaleNeedsDeadlineTask(row: SupplierSaleRow, now = new Date()) {
  const dueDate = row.supplier_due_date || row.customer_due_date;
  if (!dueDate) return false;
  if (["completed", "canceled"].includes(row.assignment_status)) return false;
  const today = now.toISOString().slice(0, 10);
  if (dueDate > today) return false;
  const metadata = jsonRecord(row.metadata);
  if (nullableText(metadata.deadline_task_id, 120)) return false;
  return true;
}

function rowFromSale(sale: SupplierSale): SupplierSaleRow {
  return {
    id: sale.id,
    sale_key: sale.saleKey,
    source: sale.source,
    shopify_order_id: sale.shopifyOrderId,
    shopify_order_name: sale.shopifyOrderName,
    shopify_order_url: sale.shopifyOrderUrl,
    shopify_payment_status: sale.shopifyPaymentStatus,
    payment_decision_status: sale.paymentDecisionStatus,
    payment_due_at: sale.paymentDueAt,
    last_payment_reminder_at: sale.lastPaymentReminderAt,
    payment_reminder_count: sale.paymentReminderCount,
    offer_id: sale.offerId,
    offer_number: sale.offerNumber,
    document_reference: sale.documentReference,
    offer_public_url: sale.offerPublicUrl,
    final_pdf_url: sale.finalPdfUrl,
    trello_card_id: sale.trelloCardId,
    request_id: sale.requestId,
    customer_name: sale.customerName,
    customer_email: sale.customerEmail,
    customer_phone: sale.customerPhone,
    customer_company: sale.customerCompany,
    currency: sale.currency,
    subtotal_price: sale.subtotalPrice,
    total_price: sale.totalPrice,
    customer_due_date: sale.customerDueDate,
    supplier_due_date: sale.supplierDueDate,
    due_date_source: sale.dueDateSource,
    due_date_note: sale.dueDateNote,
    recommended_supplier: sale.recommendedSupplier,
    recommendation_reasons: sale.recommendationReasons,
    assigned_supplier: sale.assignedSupplier,
    special_supplier_name: sale.specialSupplierName,
    assignment_status: sale.assignmentStatus,
    assignment_note: sale.assignmentNote,
    assigned_at: sale.assignedAt,
    assigned_by: sale.assignedBy,
    shopify_tag_sync_status: sale.shopifyTagSyncStatus,
    shopify_tag_value: sale.shopifyTagValue,
    shopify_tag_synced_at: sale.shopifyTagSyncedAt,
    shopify_tag_error: sale.shopifyTagError,
    trello_projection_status: sale.trelloProjectionStatus,
    supplier_trello_card_id: sale.supplierTrelloCardId,
    supplier_trello_card_url: sale.supplierTrelloCardUrl,
    trello_projection_error: sale.trelloProjectionError,
    task_sync_status: sale.taskSyncStatus,
    active_task_id: sale.activeTaskId,
    task_sync_error: sale.taskSyncError,
    product_summary: sale.productSummary,
    primary_image_url: sale.primaryImageUrl,
    raw_shopify: {},
    offer_snapshot: {},
    metadata: sale.paymentLink ? { payment_link: sale.paymentLink } : {},
    created_at: sale.createdAt,
    updated_at: sale.updatedAt,
  };
}

async function fetchSaleRowById(saleId: string) {
  const rows = await supabaseRequest<SupplierSaleRow[]>("supplier_sales", undefined, {
    select: "*",
    id: `eq.${saleId}`,
    limit: 1,
  });
  return rows[0] || null;
}

async function fetchExistingSaleRow(input: SupplierSaleInput) {
  const shopifyOrderId = nullableText(input.shopifyOrderId, 180);
  if (shopifyOrderId) {
    const rows = await supabaseRequest<SupplierSaleRow[]>("supplier_sales", undefined, {
      select: "*",
      shopify_order_id: `eq.${shopifyOrderId}`,
      limit: 1,
    });
    if (rows[0]) return rows[0];
  }

  const offerId = nullableText(input.offerId, 180);
  if (offerId) {
    const rows = await supabaseRequest<SupplierSaleRow[]>("supplier_sales", undefined, {
      select: "*",
      offer_id: `eq.${offerId}`,
      limit: 1,
    });
    if (rows[0]) return rows[0];
  }

  const documentReference = nullableText(input.documentReference, 180);
  if (documentReference) {
    const rows = await supabaseRequest<SupplierSaleRow[]>("supplier_sales", undefined, {
      select: "*",
      document_reference: `eq.${documentReference}`,
      limit: 2,
    });
    if (rows.length === 1) return rows[0];
  }

  const offerNumber = nullableText(input.offerNumber, 120);
  if (offerNumber) {
    const rows = await supabaseRequest<SupplierSaleRow[]>("supplier_sales", undefined, {
      select: "*",
      offer_number: `eq.${offerNumber}`,
      limit: 2,
    });
    if (rows.length === 1) return rows[0];
  }

  const source = nullableText(input.source, 80);
  const customerEmail = lowerNullable(input.customerEmail, 260);
  const totalPrice = numericValue(input.totalPrice);
  if (source === "shopify" && customerEmail && totalPrice !== null) {
    const rows = await supabaseRequest<SupplierSaleRow[]>("supplier_sales", undefined, {
      select: "*",
      source: "eq.neontrip-offers",
      shopify_order_id: "is.null",
      customer_email: `eq.${customerEmail}`,
      total_price: `eq.${totalPrice}`,
      order: "created_at.desc",
      limit: 2,
    });
    if (rows.length === 1) return rows[0];
  }

  const rows = await supabaseRequest<SupplierSaleRow[]>("supplier_sales", undefined, {
    select: "*",
    sale_key: `eq.${input.saleKey}`,
    limit: 1,
  });
  return rows[0] || null;
}

async function fetchItemsForSale(saleId: string) {
  return supabaseRequest<SupplierSaleItemRow[]>("supplier_sale_items", undefined, {
    select: "*",
    sale_id: `eq.${saleId}`,
    order: "created_at.asc",
    limit: 500,
  });
}

async function fetchLatestEventForSale(saleId: string) {
  const rows = await supabaseRequest<SupplierSaleEventRow[]>("supplier_sale_events", undefined, {
    select: "*",
    sale_id: `eq.${saleId}`,
    order: "created_at.desc",
    limit: 1,
  });
  return rows[0] || null;
}

export async function getSupplierSale(saleId: string) {
  const id = nullableText(saleId, 120);
  if (!id) throw new QuoteValidationError("Sale-ID fehlt.", ["Sale-ID fehlt."], 422);
  const row = await fetchSaleRowById(id);
  if (!row) throw new QuoteValidationError("Sale wurde nicht gefunden.", ["Sale wurde nicht gefunden."], 404);
  const [items, latestEvent] = await Promise.all([fetchItemsForSale(row.id), fetchLatestEventForSale(row.id)]);
  return mapSale(row, items.map(mapItem), latestEvent ? mapEvent(latestEvent) : null);
}

async function patchSaleRow(saleId: string, patch: Partial<SupplierSaleRow>) {
  const rows = await supabaseRequest<SupplierSaleRow[]>(
    "supplier_sales",
    {
      method: "PATCH",
      body: JSON.stringify(patch),
      headers: { Prefer: "return=representation" },
    },
    {
      id: `eq.${saleId}`,
      select: "*",
      limit: 1,
    },
  );
  if (!rows[0]) throw new QuoteValidationError("Sale wurde nicht aktualisiert.", ["Sale wurde nicht aktualisiert."], 404);
  return rows[0];
}

async function insertEvent(input: {
  saleId?: string | null;
  eventType: SupplierSaleEventRow["event_type"];
  actor?: SupplierSaleActor | null;
  idempotencyKey: string;
  payload?: JsonRecord;
}) {
  try {
    await supabaseRequest("supplier_sale_events", {
      method: "POST",
      body: JSON.stringify({
        sale_id: input.saleId || null,
        event_type: input.eventType,
        actor: input.actor?.operatorName || input.actor?.mode || null,
        idempotency_key: input.idempotencyKey,
        payload: input.payload || {},
      }),
      headers: { Prefer: "return=minimal" },
    });
    return true;
  } catch {
    // Event idempotency collisions are expected during webhook retries.
    return false;
  }
}

function shopifyTagsFromInput(input: SupplierSaleInput) {
  const rawTags = [
    input.rawShopify?.tags,
    jsonRecord(input.rawShopify?.order).tags,
    input.metadata?.shopify_tags,
  ];
  const tags: string[] = [];
  for (const value of rawTags) {
    if (Array.isArray(value)) tags.push(...value.map((entry) => cleanText(entry, 120)).filter(Boolean));
    else if (typeof value === "string") tags.push(...value.split(",").map((entry) => cleanText(entry, 120)).filter(Boolean));
  }
  return [...new Set(tags)];
}

function hasConfiguredSupplierTag(tags: Set<string>, candidates: Array<string | null | undefined>) {
  return candidates.some((candidate) => {
    const tag = supplierTagKey(candidate);
    return Boolean(tag && tags.has(tag));
  });
}

function supplierTagCandidates(supplier: SupplierSaleSupplier) {
  const configured = supplierTagValue(supplier);
  if (supplier === "quentin") return [configured, "Quentin (schon bezahlt)"];
  return [configured];
}

function assignedSupplierFromShopifyTags(input: SupplierSaleInput): SupplierSaleSupplier | null {
  const tags = new Set(shopifyTagsFromInput(input).map(supplierTagKey));
  if (!tags.size) return null;
  if (hasConfiguredSupplierTag(tags, supplierTagCandidates("quentin"))) return "quentin";
  if (hasConfiguredSupplierTag(tags, supplierTagCandidates("said"))) return "said";
  if (hasConfiguredSupplierTag(tags, supplierTagCandidates("special"))) return "special";
  return null;
}

function supplierTagsFromRow(row: SupplierSaleRow) {
  const rawTags = [
    row.shopify_tag_value,
    row.raw_shopify?.tags,
    jsonRecord(row.raw_shopify?.order).tags,
    row.metadata?.shopify_tags,
  ];
  const tags: string[] = [];
  for (const value of rawTags) {
    if (Array.isArray(value)) tags.push(...value.map((entry) => cleanText(entry, 120)).filter(Boolean));
    else if (typeof value === "string") tags.push(...value.split(",").map((entry) => cleanText(entry, 120)).filter(Boolean));
  }
  return [...new Set(tags)];
}

function assignedSupplierFromRowTags(row: SupplierSaleRow): SupplierSaleSupplier | null {
  const tags = new Set(supplierTagsFromRow(row).map(supplierTagKey));
  if (!tags.size) return null;
  if (hasConfiguredSupplierTag(tags, supplierTagCandidates("quentin"))) return "quentin";
  if (hasConfiguredSupplierTag(tags, supplierTagCandidates("said"))) return "said";
  if (hasConfiguredSupplierTag(tags, supplierTagCandidates("special"))) return "special";
  return null;
}

function hasExternalSupplierAssignmentSignal(row: SupplierSaleRow) {
  return Boolean(row.assigned_supplier || assignedSupplierFromRowTags(row));
}

function hasCompletedShopifyFulfillmentSignal(row: SupplierSaleRow) {
  return [
    row.metadata?.fulfillment_status,
    row.metadata?.fulfillmentStatus,
    row.raw_shopify?.fulfillment_status,
    row.raw_shopify?.fulfillmentStatus,
    row.raw_shopify?.displayFulfillmentStatus,
    jsonRecord(row.raw_shopify?.order).fulfillment_status,
    jsonRecord(row.raw_shopify?.order).fulfillmentStatus,
    jsonRecord(row.raw_shopify?.order).displayFulfillmentStatus,
  ].some(isCompletedShopifyFulfillmentStatus);
}

function buildSalePayload(input: SupplierSaleInput, existing?: SupplierSaleRow | null) {
  const lineItems = input.lineItems || [];
  if (!input.saleKey) throw new QuoteValidationError("Sale-Key fehlt.", ["Sale-Key fehlt."], 422);
  if (!lineItems.length) throw new QuoteValidationError("Sale braucht mindestens eine Position.", ["Sale braucht mindestens eine Position."], 422);

  const recommendation = deriveSupplierRecommendation(lineItems);
  const source = nullableText(input.source, 80) || "shopify";
  const completedOfferSource = source === "neontrip-offers" && recordString(input.metadata || {}, ["source_event"], 80) === "offer.completed";
  const paymentStatus = normalizeShopifyPaymentStatus(input.shopifyPaymentStatus);
  const paymentDecision = derivePaymentDecisionStatus(paymentStatus, existing?.payment_decision_status);
  const taggedSupplier = assignedSupplierFromShopifyTags(input);
  const assignedSupplier = existing?.assigned_supplier || taggedSupplier || null;
  const detectedTagValue = taggedSupplier ? supplierTagValue(taggedSupplier) : null;
  const existingTagStatus = existing?.shopify_tag_sync_status;
  const fulfillmentCompleted = isCompletedShopifyFulfillmentStatus(shopifyFulfillmentStatusFromPayload(input.rawShopify || {}));
  const assignmentStatus = fulfillmentCompleted && source === "shopify"
    ? "completed"
    : deriveAssignmentStatus({
    paymentDecisionStatus: paymentDecision,
    assignedSupplier,
    currentStatus: existing?.assignment_status,
    completedOfferSource,
  });

  return {
    sale_key: cleanText(input.saleKey, 260),
    source,
    shopify_order_id: nullableText(input.shopifyOrderId, 180) || existing?.shopify_order_id || null,
    shopify_order_name: nullableText(input.shopifyOrderName, 120) || existing?.shopify_order_name || null,
    shopify_order_url: nullableText(input.shopifyOrderUrl, 1000) || existing?.shopify_order_url || null,
    shopify_payment_status: paymentStatus,
    payment_decision_status: paymentDecision,
    payment_due_at: normalizeIsoTimestamp(input.paymentDueAt, "Zahlungsfrist") || existing?.payment_due_at || null,
    offer_id: nullableText(input.offerId, 180) || existing?.offer_id || null,
    offer_number: nullableText(input.offerNumber, 120) || existing?.offer_number || null,
    document_reference: nullableText(input.documentReference, 160) || existing?.document_reference || null,
    offer_public_url: nullableText(input.offerPublicUrl, 1000) || existing?.offer_public_url || null,
    final_pdf_url: nullableText(input.finalPdfUrl, 1000) || existing?.final_pdf_url || null,
    trello_card_id: nullableText(input.trelloCardId, 160) || existing?.trello_card_id || null,
    request_id: nullableText(input.requestId, 160) || existing?.request_id || null,
    customer_name: nullableText(input.customerName, 260) || existing?.customer_name || null,
    customer_email: lowerNullable(input.customerEmail, 260) || existing?.customer_email || null,
    customer_phone: nullableText(input.customerPhone, 120) || existing?.customer_phone || null,
    customer_company: nullableText(input.customerCompany, 260) || existing?.customer_company || null,
    currency: (nullableText(input.currency, 12) || existing?.currency || "EUR").toUpperCase(),
    subtotal_price: numericValue(input.subtotalPrice) ?? numericValue(existing?.subtotal_price),
    total_price: numericValue(input.totalPrice) ?? numericValue(existing?.total_price),
    customer_due_date: normalizeDateOnly(input.customerDueDate) || existing?.customer_due_date || null,
    supplier_due_date: normalizeDateOnly(input.supplierDueDate) || normalizeDateOnly(input.customerDueDate) || existing?.supplier_due_date || null,
    due_date_source: nullableText(input.dueDateSource, 80) || existing?.due_date_source || null,
    due_date_note: nullableText(input.dueDateNote, 500) || existing?.due_date_note || null,
    recommended_supplier: recommendation.recommendedSupplier,
    recommendation_reasons: recommendation.recommendationReasons,
    assigned_supplier: assignedSupplier,
    special_supplier_name: existing?.special_supplier_name || null,
    assignment_status: assignmentStatus,
    shopify_tag_value: existing?.shopify_tag_value || detectedTagValue || null,
    shopify_tag_sync_status: existingTagStatus && existingTagStatus !== "not_started"
      ? existingTagStatus
      : detectedTagValue ? "synced" : existingTagStatus || "not_started",
    shopify_tag_synced_at: existing?.shopify_tag_synced_at || (detectedTagValue ? new Date().toISOString() : null),
    shopify_tag_error: detectedTagValue ? null : existing?.shopify_tag_error || null,
    product_summary: nullableText(input.productSummary, 600) || lineItems.map((item) => cleanText(item.title, 120)).filter(Boolean).slice(0, 3).join(", ") || existing?.product_summary || null,
    primary_image_url: nullableText(input.primaryImageUrl, 1000) || lineItems.map((item) => nullableText(item.imageUrl, 1000)).find(Boolean) || existing?.primary_image_url || null,
    raw_shopify: Object.keys(input.rawShopify || {}).length ? input.rawShopify : existing?.raw_shopify || {},
    offer_snapshot: Object.keys(input.offerSnapshot || {}).length ? input.offerSnapshot : existing?.offer_snapshot || {},
    metadata: {
      ...(existing?.metadata || {}),
      ...(input.metadata || {}),
      supplier_rule_version: SUPPLIER_RULE_VERSION,
      fulfillment_status: shopifyFulfillmentStatusFromPayload(input.rawShopify || {}) || nullableText(input.metadata?.fulfillment_status, 120) || nullableText(existing?.metadata?.fulfillment_status, 120) || null,
    },
  };
}

async function replaceSaleItems(
  saleId: string,
  lineItems: Array<SupplierLineItemInput & { requiresQuentin: boolean; ruleReasons: string[] }>,
) {
  await supabaseRequest("supplier_sale_items", {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  }, {
    sale_id: `eq.${saleId}`,
  });

  if (!lineItems.length) return [];
  const rows = await supabaseRequest<SupplierSaleItemRow[]>("supplier_sale_items", {
    method: "POST",
    body: JSON.stringify(lineItems.map((item, index) => ({
      sale_id: saleId,
      line_item_key: nullableText(item.lineItemKey, 180) || `line:${index + 1}`,
      title: nullableText(item.title, 500) || "Position",
      sku: nullableText(item.sku, 120),
      variant_title: nullableText(item.variantTitle, 500),
      quantity: intValue(item.quantity),
      product_type: nullableText(item.productType || item.section, 160),
      image_url: nullableText(item.imageUrl, 1000),
      requires_quentin: item.requiresQuentin,
      rule_reasons: item.ruleReasons,
      raw_line_item: item.rawLineItem || {},
    }))),
    headers: { Prefer: "return=representation" },
  });
  return rows;
}

function trelloConfigured() {
  return Boolean(process.env.TRELLO_API_KEY && process.env.TRELLO_TOKEN);
}

function trelloCardIdFromValue(value: unknown) {
  const text = nullableText(value, 1000);
  if (!text) return null;
  const fromUrl =
    text.match(/trello\.com\/c\/([a-z0-9]+)/i)?.[1] ||
    text.match(/\/cards\/([a-z0-9]{8,24})/i)?.[1];
  const cardId = fromUrl || text;
  return /^[a-z0-9_-]{6,32}$/i.test(cardId) ? cardId : null;
}

function normalizeShopifyOrderTitlePrefix(value: unknown) {
  const text = nullableText(value, 120)?.replace(/\s+/g, " ");
  if (!text) return null;
  return text.startsWith("#") ? text : `#${text}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeLeadingShopifyOrderTitlePrefix(title: string, prefix: string) {
  const exactPrefix = new RegExp(`^${escapeRegExp(prefix)}(?:\\s+|\\s*[-:|]\\s*)?`, "i");
  const withoutExact = title.replace(exactPrefix, "").trim();
  if (withoutExact !== title.trim()) return withoutExact;
  return title.replace(/^#(?:NEON[-\s]?T|NT)?\d+\s*(?:[-:|]\s*)?/i, "").trim();
}

export function buildShopifyOrderTrelloTitle(currentTitle: unknown, shopifyOrderName: unknown) {
  const prefix = normalizeShopifyOrderTitlePrefix(shopifyOrderName);
  if (!prefix) return null;
  const title = cleanText(currentTitle, 1000);
  const baseTitle = removeLeadingShopifyOrderTitlePrefix(title, prefix);
  return baseTitle ? `${prefix} ${baseTitle}`.slice(0, 500) : prefix;
}

async function listRequestTrelloCardIds(requestId: string | null, fallbackCardId: string | null) {
  const ids = new Set<string>();
  if (fallbackCardId) ids.add(fallbackCardId);
  if (!requestId) return [...ids];

  const rows = await supabaseRequest<MasterRequestTrelloRow[]>("master_requests", undefined, {
    select: "request_id,trello_card_id,trello_card_url,updated_at",
    request_id: `eq.${encodeFilterValue(requestId)}`,
    order: "updated_at.desc",
    limit: 500,
  });

  for (const row of rows) {
    const cardId = trelloCardIdFromValue(row.trello_card_id) || trelloCardIdFromValue(row.trello_card_url);
    if (cardId) ids.add(cardId);
  }
  return [...ids];
}

async function syncShopifyOrderNumberToSourceTrelloCards(row: SupplierSaleRow, actor?: SupplierSaleActor | null) {
  const orderPrefix = normalizeShopifyOrderTitlePrefix(row.shopify_order_name);
  if (!orderPrefix || !trelloConfigured()) return;

  const requestId = nullableText(row.request_id, 160);
  const fallbackCardId = trelloCardIdFromValue(row.trello_card_id);
  if (!requestId && !fallbackCardId) return;

  try {
    const cardIds = await listRequestTrelloCardIds(requestId, fallbackCardId);
    if (!cardIds.length) return;

    const updated: Array<{ cardId: string; previousName: string | null; nextName: string }> = [];
    const skipped: Array<{ cardId: string; reason: string }> = [];
    const failed: Array<{ cardId: string; error: string }> = [];

    for (const cardId of cardIds) {
      try {
        const card = await getTrelloCard(cardId);
        const nextName = buildShopifyOrderTrelloTitle(card.name || "", orderPrefix);
        if (!nextName) {
          skipped.push({ cardId, reason: "missing_order_name" });
          continue;
        }
        if (nextName === cleanText(card.name, 1000)) {
          skipped.push({ cardId, reason: "already_current" });
          continue;
        }
        await updateTrelloCard(cardId, { name: nextName });
        updated.push({ cardId, previousName: nullableText(card.name, 500), nextName });
      } catch (error) {
        failed.push({ cardId, error: error instanceof Error ? error.message : "unknown_error" });
      }
    }

    await insertEvent({
      saleId: row.id,
      eventType: failed.length ? "source_trello_order_title_sync_failed" : "source_trello_order_title_synced",
      actor,
      idempotencyKey: `supplier-sale:${row.id}:source-trello-order-title:${hashPayload({
        orderPrefix,
        cardIds,
        failed: failed.map((entry) => entry.cardId),
      })}`,
      payload: {
        request_id: requestId,
        shopify_order_name: orderPrefix,
        updated,
        skipped,
        failed,
      },
    });
  } catch (error) {
    await insertEvent({
      saleId: row.id,
      eventType: "source_trello_order_title_sync_failed",
      actor,
      idempotencyKey: `supplier-sale:${row.id}:source-trello-order-title:error:${hashPayload({
        orderPrefix,
        requestId,
        message: error instanceof Error ? error.message : "unknown_error",
      })}`,
      payload: {
        request_id: requestId,
        shopify_order_name: orderPrefix,
        error: error instanceof Error ? error.message : "unknown_error",
      },
    });
  }
}

export async function upsertSupplierSale(input: SupplierSaleInput, actor?: SupplierSaleActor | null) {
  const existing = await fetchExistingSaleRow(input);
  const payload = buildSalePayload(input, existing);
  const recommendation = deriveSupplierRecommendation(input.lineItems);
  const rows = existing
    ? await supabaseRequest<SupplierSaleRow[]>(
        "supplier_sales",
        {
          method: "PATCH",
          body: JSON.stringify(payload),
          headers: { Prefer: "return=representation" },
        },
        { id: `eq.${existing.id}`, select: "*", limit: 1 },
      )
    : await supabaseRequest<SupplierSaleRow[]>(
        upsertPath("supplier_sales", "sale_key"),
        {
          method: "POST",
          body: JSON.stringify(payload),
          headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        },
      );

  const saleRow = rows[0];
  const items = await replaceSaleItems(saleRow.id, recommendation.lineItems);
  await insertEvent({
    saleId: saleRow.id,
    eventType: existing ? "sale_updated" : "sale_upserted",
    actor,
    idempotencyKey: nullableText(input.idempotencyKey, 260) || `supplier-sale:${saleRow.sale_key}:upsert:${hashPayload({
      payment: saleRow.shopify_payment_status,
      total: saleRow.total_price,
      items: items.length,
    })}`,
    payload: {
      sale_key: saleRow.sale_key,
      shopify_order_id: saleRow.shopify_order_id,
      recommended_supplier: saleRow.recommended_supplier,
      payment_status: saleRow.shopify_payment_status,
    },
  });

  await syncShopifyOrderNumberToSourceTrelloCards(saleRow, actor);

  if (saleRow.assignment_status === "ready_to_assign" && !saleRow.active_task_id && supplierAssignmentTasksEnabled()) {
    await ensureSupplierAssignmentTask(saleRow.id, actor || undefined).catch(async (error) => {
      await patchSaleRow(saleRow.id, {
        task_sync_status: "failed",
        task_sync_error: error instanceof Error ? error.message : "Aufgabe konnte nicht erstellt werden.",
      });
    });
  } else if (saleRow.assignment_status === "ready_to_assign" && !supplierAssignmentTasksEnabled()) {
    await patchSaleRow(saleRow.id, {
      active_task_id: null,
      task_sync_status: "skipped",
      task_sync_error: null,
    }).catch(() => null);
  }

  return getSupplierSale(saleRow.id);
}

export async function upsertSupplierSaleFromPayload(payload: unknown, actor?: SupplierSaleActor | null) {
  const parsed = buildSupplierSaleInputFromPayload(payload);
  const sale = await upsertSupplierSale(parsed.sale, actor);
  return { sale, warnings: parsed.warnings };
}

function shopifyOrderNumericId(gid: unknown) {
  const text = nullableText(gid, 260);
  return text?.match(/\/Order\/(\d+)$/)?.[1] || null;
}

function shopifyMoneyAmount(value: unknown) {
  return recordString(jsonRecord(jsonRecord(value).shopMoney), ["amount"], 80);
}

function shopifyAddressPayload(value: unknown) {
  const address = jsonRecord(value);
  return {
    name: recordString(address, ["name"], 260),
    company: recordString(address, ["company"], 260),
    email: recordString(address, ["email"], 260),
    phone: recordString(address, ["phone"], 120),
    address1: recordString(address, ["address1"], 260),
    address2: recordString(address, ["address2"], 260),
    city: recordString(address, ["city"], 160),
    zip: recordString(address, ["zip"], 80),
    country: recordString(address, ["country", "countryCodeV2"], 120),
  };
}

function shopifyCustomAttributes(value: unknown) {
  return arrayRecords(value).map((attribute) => ({
    name: recordString(attribute, ["key", "name"], 120),
    value: recordString(attribute, ["value"], 500),
  })).filter((attribute) => attribute.name || attribute.value);
}

function shopifyOrderPayloadFromGraphql(order: JsonRecord, domain: string) {
  const orderGid = recordString(order, ["id"], 260);
  const numericId = shopifyOrderNumericId(orderGid);
  const customer = jsonRecord(order.customer);
  const currency = nestedString(order, ["totalPriceSet", "shopMoney", "currencyCode"], 12) || "EUR";
  return {
    id: numericId || orderGid,
    admin_graphql_api_id: orderGid,
    name: recordString(order, ["name"], 120),
    admin_url: numericId ? `https://${domain}/admin/orders/${numericId}` : null,
    order_status_url: recordString(order, ["statusPageUrl"], 1000),
    financial_status: recordString(order, ["displayFinancialStatus"], 80)?.toLowerCase(),
    fulfillment_status: recordString(order, ["displayFulfillmentStatus"], 120)?.toLowerCase(),
    tags: Array.isArray(order.tags) ? order.tags.map((tag) => cleanText(tag, 120)).filter(Boolean) : [],
    created_at: recordString(order, ["createdAt"], 80),
    processed_at: recordString(order, ["processedAt"], 80),
    currency,
    email: recordString(order, ["email"], 260) || recordString(customer, ["email"], 260),
    phone: recordString(order, ["phone"], 120) || recordString(customer, ["phone"], 120),
    total_price: shopifyMoneyAmount(order.totalPriceSet),
    subtotal_price: shopifyMoneyAmount(order.subtotalPriceSet),
    customer: {
      first_name: recordString(customer, ["firstName"], 120),
      last_name: recordString(customer, ["lastName"], 120),
      email: recordString(customer, ["email"], 260),
      phone: recordString(customer, ["phone"], 120),
    },
    billing_address: shopifyAddressPayload(order.billingAddress),
    shipping_address: shopifyAddressPayload(order.shippingAddress),
    note_attributes: shopifyCustomAttributes(order.customAttributes),
    line_items: arrayRecords(jsonRecord(order.lineItems).nodes).map((item) => ({
      id: recordString(item, ["id"], 260),
      title: recordString(item, ["title", "name"], 500),
      sku: recordString(item, ["sku"], 120),
      variant_title: recordString(item, ["variantTitle"], 500),
      quantity: numericValue(item.quantity) || 1,
      product_type: nestedString(item, ["product", "productType"], 160),
      image: { src: nestedString(item, ["image", "url"], 1000) || nestedString(item, ["variant", "image", "url"], 1000) },
      properties: shopifyCustomAttributes(item.customAttributes),
    })),
    idempotencyKey: orderGid ? `shopify-order:${orderGid}:supplier-sales:v1` : undefined,
  };
}

function shopifyReconcileSince(daysBack?: number | string | null) {
  const days = Math.min(Math.max(Number(daysBack || process.env.SHOPIFY_SUPPLIER_SALES_RECONCILE_DAYS || 14), 1), 60);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  return since.toISOString().slice(0, 10);
}

function completedOfferFeedEntry(entry: JsonRecord): CompletedOfferFeedEntry {
  return {
    offerId: recordString(entry, ["offerId"], 180),
    offerNumber: recordString(entry, ["offerNumber"], 180),
    documentReference: recordString(entry, ["documentReference"], 180),
    status: recordString(entry, ["status"], 80),
    acceptedAt: recordString(entry, ["acceptedAt"], 80),
    updatedAt: recordString(entry, ["updatedAt"], 80),
    payload: entry.payload,
  };
}

async function fetchCompletedOffersFeed(options?: { limit?: number }): Promise<CompletedOfferFeedResult> {
  const baseUrl = offersAppBaseUrl();
  const tokens = offersInternalApiKeys();
  if (!baseUrl || !tokens.length) {
    return {
      status: "skipped",
      configured: false,
      sales: [],
      checked: 0,
      failed: 0,
      errors: [],
      warnings: ["Completed-Offers Pull ist nicht konfiguriert."],
    };
  }

  const url = new URL("/api/internal/offers/completed-sales", baseUrl);
  url.searchParams.set("limit", String(Math.min(Math.max(Number(options?.limit || 50), 1), 100)));
  let response: Response | null = null;
  let body: unknown = null;
  let authFallbacks = 0;
  try {
    for (const [index, token] of tokens.entries()) {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(15_000)
      });
      body = await response.json().catch(() => null);
      if (response.ok && jsonRecord(body).ok) break;
      if ((response.status === 401 || response.status === 403) && index < tokens.length - 1) {
        authFallbacks += 1;
        continue;
      }
      break;
    }
  } catch (error) {
    return {
      status: "failed",
      configured: true,
      sales: [],
      checked: 0,
      failed: 1,
      errors: [{ offerId: null, error: error instanceof Error ? error.message : "Completed-Offers Feed konnte nicht aufgerufen werden." }],
      warnings: [],
    };
  }

  if (!response) {
    return {
      status: "failed",
      configured: true,
      sales: [],
      checked: 0,
      failed: 1,
      errors: [{ offerId: null, error: "Completed-Offers Feed konnte nicht aufgerufen werden." }],
      warnings: [],
    };
  }
  if (!response.ok || !jsonRecord(body).ok) {
    const message = recordString(jsonRecord(body), ["error", "message", "code"], 240) || `Completed-Offers Feed HTTP ${response.status}`;
    return {
      status: "failed",
      configured: true,
      sales: [],
      checked: 0,
      failed: 1,
      errors: [{ offerId: null, error: message }],
      warnings: [],
    };
  }

  const sales = arrayRecords(jsonRecord(body).sales).map(completedOfferFeedEntry);
  return {
    status: "synced",
    configured: true,
    sales,
    checked: sales.length,
    failed: 0,
    errors: [],
    warnings: authFallbacks > 0
      ? ["Completed-Offers Pull nutzt einen alternativen internen Server-Key. NEONTRIP_OFFERS_INTERNAL_API_KEY sollte in Ops und Angebote-App angeglichen werden."]
      : [],
  };
}

async function syncRecentShopifyOrdersFromAdmin(
  actor?: SupplierSaleActor | null,
  options?: { limit?: number; daysBack?: number | string | null },
) {
  const config = shopifyConfig();
  if (!config) {
    return {
      status: "skipped" as const,
      checked: 0,
      upserted: 0,
      failed: 0,
      errors: [] as Array<{ offerId: string | null; error: string }>,
      warnings: ["Shopify Admin API ist nicht konfiguriert; Shopify-Fallback wurde uebersprungen."],
    };
  }

  const limit = Math.min(Math.max(Number(options?.limit || 50), 1), 100);
  const since = shopifyReconcileSince(options?.daysBack);
  const response = await fetch(`https://${config.domain}/admin/api/${config.version}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": config.token,
    },
    body: JSON.stringify({
      query: `
        query SupplierSalesRecentOrders($first: Int!, $query: String!) {
          orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
            nodes {
              id
              name
              email
              phone
              tags
              statusPageUrl
              createdAt
              processedAt
              displayFinancialStatus
              displayFulfillmentStatus
              customAttributes { key value }
              totalPriceSet { shopMoney { amount currencyCode } }
              subtotalPriceSet { shopMoney { amount currencyCode } }
              customer { firstName lastName email phone }
              billingAddress { name company phone address1 address2 city zip country countryCodeV2 }
              shippingAddress { name company phone address1 address2 city zip country countryCodeV2 }
              lineItems(first: 50) {
                nodes {
                  id
                  title
                  sku
                  quantity
                  variantTitle
                  customAttributes { key value }
                  image { url }
                  variant { image { url } }
                  product { productType }
                }
              }
            }
          }
        }
      `,
      variables: { first: limit, query: `created_at:>=${since}` },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null) as JsonRecord | null;
  if (!response.ok) {
    return {
      status: "failed" as const,
      checked: 0,
      upserted: 0,
      failed: 1,
      errors: [{ offerId: null, error: `Shopify Orders-Fallback HTTP ${response.status}` }],
      warnings: [] as string[],
    };
  }
  const graphErrors = arrayRecords(body?.errors);
  if (graphErrors.length) {
    return {
      status: "failed" as const,
      checked: 0,
      upserted: 0,
      failed: 1,
      errors: [{
        offerId: null,
        error: graphErrors.map((error) => cleanText(error.message || JSON.stringify(error), 200)).filter(Boolean).join("; ") || "Shopify Orders-Fallback fehlgeschlagen.",
      }],
      warnings: [] as string[],
    };
  }

  const errors: Array<{ offerId: string | null; error: string }> = [];
  let upserted = 0;
  const orders = arrayRecords(jsonRecord(jsonRecord(body?.data).orders).nodes);
  for (const order of orders) {
    try {
      await upsertSupplierSaleFromPayload(shopifyOrderPayloadFromGraphql(order, config.domain), actor);
      upserted += 1;
    } catch (error) {
      errors.push({
        offerId: recordString(order, ["name", "id"], 160),
        error: error instanceof Error ? error.message : "Shopify Order konnte nicht synchronisiert werden.",
      });
    }
  }

  return {
    status: errors.length ? "failed" as const : "synced" as const,
    checked: orders.length,
    upserted,
    failed: errors.length,
    errors,
    warnings: [] as string[],
  };
}

async function fetchShopifyOrderByGid(config: NonNullable<ReturnType<typeof shopifyConfig>>, orderGid: string) {
  const response = await fetch(`https://${config.domain}/admin/api/${config.version}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": config.token,
    },
    body: JSON.stringify({
      query: `
        query SupplierSalesOrderById($id: ID!) {
          node(id: $id) {
            ... on Order {
              id
              name
              email
              phone
              tags
              statusPageUrl
              createdAt
              processedAt
              displayFinancialStatus
              displayFulfillmentStatus
              customAttributes { key value }
              totalPriceSet { shopMoney { amount currencyCode } }
              subtotalPriceSet { shopMoney { amount currencyCode } }
              customer { firstName lastName email phone }
              billingAddress { name company phone address1 address2 city zip country countryCodeV2 }
              shippingAddress { name company phone address1 address2 city zip country countryCodeV2 }
              lineItems(first: 50) {
                nodes {
                  id
                  title
                  sku
                  quantity
                  variantTitle
                  customAttributes { key value }
                  image { url }
                  variant { image { url } }
                  product { productType }
                }
              }
            }
          }
        }
      `,
      variables: { id: orderGid },
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.json().catch(() => null) as JsonRecord | null;
  if (!response.ok) return { order: null as JsonRecord | null, error: `Shopify Order-Abgleich HTTP ${response.status}` };
  const graphErrors = arrayRecords(body?.errors);
  if (graphErrors.length) {
    return {
      order: null as JsonRecord | null,
      error: graphErrors.map((error) => cleanText(error.message || JSON.stringify(error), 200)).filter(Boolean).join("; ") || "Shopify Order-Abgleich fehlgeschlagen.",
    };
  }
  const order = jsonRecord(jsonRecord(body?.data).node);
  return { order: Object.keys(order).length ? order : null, error: null as string | null };
}

async function syncActiveSupplierSalesFromShopifyAdmin(
  actor?: SupplierSaleActor | null,
  options?: { limit?: number },
) {
  const config = shopifyConfig();
  if (!config) {
    return {
      status: "skipped" as const,
      checked: 0,
      upserted: 0,
      failed: 0,
      errors: [] as Array<{ offerId: string | null; error: string }>,
      warnings: ["Shopify Admin API ist nicht konfiguriert; aktiver Vergabe-Abgleich wurde uebersprungen."],
    };
  }

  const limit = Math.min(Math.max(Number(options?.limit || 10), 1), 25);
  const activeRows = await supabaseRequest<SupplierSaleRow[]>("supplier_sales", undefined, {
    select: "*",
    assignment_status: "not.in.(assigned,in_production,completed,canceled)",
    shopify_order_id: "not.is.null",
    order: "updated_at.desc,created_at.desc",
    limit,
  });

  const errors: Array<{ offerId: string | null; error: string }> = [];
  const warnings: string[] = [];
  let upserted = 0;
  for (const row of activeRows) {
    try {
      const orderGid = shopifyOrderGid(row);
      if (!orderGid) {
        if (warnings.length < 5) warnings.push(`${row.shopify_order_name || row.offer_number || row.sale_key}: Shopify Order-ID fehlt; aktiver Kurzabgleich ueberspringt Referenzsuche.`);
        continue;
      }
      const fetched = await fetchShopifyOrderByGid(config, orderGid);
      if (!fetched.order) {
        if (fetched.error) errors.push({ offerId: row.offer_id || row.offer_number || row.sale_key, error: fetched.error });
        continue;
      }
      await upsertSupplierSaleFromPayload(shopifyOrderPayloadFromGraphql(fetched.order, config.domain), actor);
      upserted += 1;
    } catch (error) {
      errors.push({
        offerId: row.offer_id || row.offer_number || row.sale_key,
        error: error instanceof Error ? error.message : "Aktive Vergabe konnte nicht mit Shopify abgeglichen werden.",
      });
    }
  }

  return {
    status: errors.length ? "failed" as const : "synced" as const,
    checked: activeRows.length,
    upserted,
    failed: errors.length,
    errors,
    warnings,
  };
}

export async function syncCompletedOffersFromOffersApp(
  actor?: SupplierSaleActor | null,
  options?: { limit?: number },
): Promise<SupplierCompletedOffersSyncResult> {
  const errors: Array<{ offerId: string | null; error: string }> = [];
  const warnings: string[] = [];
  let completedChecked = 0;
  let completedUpserted = 0;
  let completedFailed = 0;
  const feed = await fetchCompletedOffersFeed({ limit: options?.limit });
  warnings.push(...feed.warnings);
  if (feed.status === "failed") {
    completedFailed += feed.failed;
    errors.push(...feed.errors);
  } else if (feed.status === "skipped") {
    // Keep the Shopify fallback active even when the offers pull is not configured.
  } else {
    completedChecked = feed.sales.length;
    for (const entry of feed.sales) {
      try {
        const result = await upsertSupplierSaleFromPayload(entry.payload, actor);
        completedUpserted += 1;
        warnings.push(...result.warnings.map((warning) => `${entry.offerId || "offer"}: ${warning}`));
      } catch (error) {
        completedFailed += 1;
        errors.push({
          offerId: entry.offerId,
          error: error instanceof Error ? error.message : "Completed Offer konnte nicht synchronisiert werden."
        });
      }
    }
  }

  const shopify = await syncRecentShopifyOrdersFromAdmin(actor, { limit: options?.limit }).catch((error) => ({
    status: "failed" as const,
    checked: 0,
    upserted: 0,
    failed: 1,
    errors: [{ offerId: null, error: error instanceof Error ? error.message : "Shopify Orders-Fallback fehlgeschlagen." }],
    warnings: [] as string[],
  }));
  errors.push(...shopify.errors);
  warnings.push(...shopify.warnings);

  const activeShopify = await syncActiveSupplierSalesFromShopifyAdmin(actor, { limit: 10 }).catch((error) => ({
    status: "failed" as const,
    checked: 0,
    upserted: 0,
    failed: 1,
    errors: [{ offerId: null, error: error instanceof Error ? error.message : "Aktive Shopify-Vergabezeilen konnten nicht abgeglichen werden." }],
    warnings: [] as string[],
  }));
  errors.push(...activeShopify.errors);
  warnings.push(...activeShopify.warnings);
  const checked = completedChecked + shopify.checked + activeShopify.checked;
  const upserted = completedUpserted + shopify.upserted + activeShopify.upserted;
  const failed = completedFailed + shopify.failed + activeShopify.failed;
  const completedConfigured = feed.configured;
  const shopifySkipped = shopify.status === "skipped";
  const activeShopifySkipped = activeShopify.status === "skipped";
  const status = failed
    ? (upserted > 0 || checked > failed ? "partial" : "failed")
    : (!completedConfigured && shopifySkipped && activeShopifySkipped ? "skipped" : "synced");
  return {
    status,
    checked,
    upserted,
    failed,
    errors,
    warnings,
    sources: {
      completedOffers: { checked: completedChecked, upserted: completedUpserted, failed: completedFailed },
      shopifyOrders: { checked: shopify.checked, upserted: shopify.upserted, failed: shopify.failed, skipped: shopifySkipped },
      activeShopifyRows: { checked: activeShopify.checked, upserted: activeShopify.upserted, failed: activeShopify.failed, skipped: activeShopifySkipped },
    },
  };
}

function supplierSaleLiveSummary(row: SupplierSaleRow) {
  return {
    saleId: row.id,
    offerId: row.offer_id,
    offerNumber: row.offer_number,
    documentReference: row.document_reference,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assignmentStatus: row.assignment_status,
    shopifyTagSyncStatus: row.shopify_tag_sync_status,
    shopifyOrderName: row.shopify_order_name,
  };
}

export async function runSupplierSalesLiveCheck(options?: { limit?: number }): Promise<SupplierSalesLiveCheckResult> {
  const limit = Math.min(Math.max(Number(options?.limit || 10), 1), 25);
  const checkedAt = new Date().toISOString();
  const feed = await fetchCompletedOffersFeed({ limit });
  const latestVergabeRows = await supabaseRequest<SupplierSaleRow[]>("supplier_sales", undefined, {
    select: "*",
    order: "created_at.desc,updated_at.desc",
    limit,
  });
  const offerIds = feed.sales.map((entry) => entry.offerId).filter((value): value is string => Boolean(value));
  const matchedRows = offerIds.length
    ? await supabaseRequest<SupplierSaleRow[]>("supplier_sales", undefined, {
      select: "*",
      offer_id: inList(offerIds),
      order: "created_at.desc,updated_at.desc",
      limit: Math.max(limit, offerIds.length),
    })
    : [];
  const saleByOfferId = new Map(matchedRows.map((row) => [row.offer_id, row]));
  const latestCompletedOffers = feed.sales.map((entry) => {
    const sale = entry.offerId ? saleByOfferId.get(entry.offerId) || null : null;
    return {
      offerId: entry.offerId,
      offerNumber: entry.offerNumber,
      documentReference: entry.documentReference,
      status: entry.status,
      acceptedAt: entry.acceptedAt,
      updatedAt: entry.updatedAt,
      inVergabe: Boolean(sale),
      supplierSale: sale ? {
        saleId: sale.id,
        source: sale.source,
        createdAt: sale.created_at,
        updatedAt: sale.updated_at,
        assignmentStatus: sale.assignment_status,
        shopifyTagSyncStatus: sale.shopify_tag_sync_status,
        shopifyOrderName: sale.shopify_order_name,
      } : null,
    };
  });
  const missingOfferIds = latestCompletedOffers
    .filter((entry) => entry.offerId && !entry.inVergabe)
    .map((entry) => entry.offerId as string);
  const latestVergabeSales = latestVergabeRows.map(supplierSaleLiveSummary);
  const latestCompletedOfferId = latestCompletedOffers[0]?.offerId || null;
  const newestVergabeOfferId = latestVergabeSales[0]?.offerId || null;
  const latestCompletedOfferInTopVergabe = latestCompletedOfferId
    ? latestVergabeSales.some((sale) => sale.offerId === latestCompletedOfferId)
    : null;
  const status = feed.status === "skipped"
    ? "skipped"
    : feed.status === "failed"
      ? "failed"
      : missingOfferIds.length || latestCompletedOfferInTopVergabe === false
        ? "warning"
        : "ok";
  return {
    status,
    checkedAt,
    offersFeed: {
      configured: feed.configured,
      checked: feed.checked,
      failed: feed.failed,
      warnings: feed.warnings,
      errors: feed.errors,
    },
    latestCompletedOffers,
    latestVergabeSales,
    missingOfferIds,
    sortCheck: {
      order: "created_at.desc,updated_at.desc",
      latestCompletedOfferId,
      newestVergabeOfferId,
      latestCompletedOfferInTopVergabe,
    },
  };
}

export async function listSupplierSalesBoard(options?: {
  scope?: "active" | "ready" | "payment" | "assigned" | "deadline" | "sync" | "all";
  supplier?: SupplierSaleSupplier | SupplierSaleRecommendation | "all" | null;
  payment?: SupplierSalePaymentStatus | "unpaid" | "all" | null;
  urgency?: SupplierSaleUrgencyFilter | null;
  query?: string | null;
  limit?: number;
}): Promise<SupplierSaleBoard> {
  const scope = options?.scope || "active";
  const requestedLimit = Math.min(Math.max(Number(options?.limit || 50), 1), 500);
  const needsPostFilter = ["active", "ready", "payment", "deadline", "sync"].includes(scope);
  const fetchLimit = needsPostFilter ? Math.min(Math.max(requestedLimit * 4, 100), 500) : requestedLimit;
  const now = new Date();
  const dueSoonLimit = new Date(now);
  dueSoonLimit.setUTCDate(dueSoonLimit.getUTCDate() + 7);
  const dueSoon = dueSoonLimit.toISOString().slice(0, 10);
  const query: Record<string, string | number | boolean | null> = {
    select: "*",
    order: scope === "deadline" ? "supplier_due_date.asc.nullslast,updated_at.desc" : "updated_at.desc,created_at.desc",
    limit: fetchLimit,
  };
  if (scope === "ready") query.assignment_status = "eq.ready_to_assign";
  else if (scope === "payment") query.assignment_status = "eq.payment_open";
  else if (scope === "assigned") query.assignment_status = "in.(assigned,in_production)";
  else if (scope === "deadline") {
    query.assignment_status = "not.in.(completed,canceled)";
    query.or = `(supplier_due_date.lte.${dueSoon},and(supplier_due_date.is.null,customer_due_date.lte.${dueSoon}))`;
  }
  else if (scope === "active") query.assignment_status = "not.in.(assigned,in_production,completed,canceled)";
  else if (scope !== "all") query.assignment_status = "not.in.(completed,canceled)";

  const payment = options?.payment;
  if (payment && payment !== "all") {
    query.shopify_payment_status = payment === "unpaid" ? "not.eq.paid" : `eq.${payment}`;
  }

  const statsQuery: Record<string, string | number | boolean | null> = {
    select: [
      "id",
      "assignment_status",
      "shopify_payment_status",
      "supplier_due_date",
      "customer_due_date",
      "recommended_supplier",
      "assigned_supplier",
      "shopify_tag_sync_status",
      "shopify_tag_value",
      "trello_projection_status",
      "task_sync_status",
      "product_summary",
      "due_date_note",
      "raw_shopify",
      "offer_snapshot",
      "metadata",
      "customer_name",
      "customer_email",
      "shopify_order_name",
      "offer_number",
      "document_reference",
      "created_at",
      "updated_at",
    ].join(","),
    assignment_status: "not.in.(completed,canceled)",
    order: "created_at.desc,updated_at.desc",
    limit: 2000,
  };
  if (payment && payment !== "all") {
    statsQuery.shopify_payment_status = payment === "unpaid" ? "not.eq.paid" : `eq.${payment}`;
  }

  let statsRows = await supabaseRequest<SupplierSaleRow[]>("supplier_sales", undefined, statsQuery);
  let saleRows = await supabaseRequest<SupplierSaleRow[]>("supplier_sales", undefined, query);
  if (scope === "active" || scope === "ready" || scope === "payment") {
    saleRows = saleRows.filter((row) => !hasExternalSupplierAssignmentSignal(row) && !hasCompletedShopifyFulfillmentSignal(row));
  }
  if (scope === "sync") {
    saleRows = saleRows.filter((row) => {
      if (["completed", "canceled"].includes(row.assignment_status)) return false;
      return [row.shopify_tag_sync_status, row.trello_projection_status, row.task_sync_status].includes("failed");
    });
  } else if (scope === "deadline") {
    saleRows = saleRows.filter((row) => {
      const dueDate = row.supplier_due_date || row.customer_due_date;
      return Boolean(dueDate && dueDate <= dueSoon && !["completed", "canceled"].includes(row.assignment_status));
    });
  }
  const supplier = options?.supplier;
  if (supplier && supplier !== "all") {
    saleRows = saleRows.filter((row) => row.assigned_supplier === supplier || row.recommended_supplier === supplier);
    statsRows = statsRows.filter((row) => row.assigned_supplier === supplier || row.recommended_supplier === supplier);
  }
  const search = nullableText(options?.query, 160)?.toLowerCase();
  if (search) {
    const matchesSearch = (row: SupplierSaleRow) => [
      row.customer_name,
      row.customer_email,
      row.shopify_order_name,
      row.offer_number,
      row.document_reference,
      row.product_summary,
    ].some((value) => String(value || "").toLowerCase().includes(search));
    saleRows = saleRows.filter(matchesSearch);
    statsRows = statsRows.filter(matchesSearch);
  }
  const urgency = options?.urgency || "all";
  if (urgency !== "all") {
    const matchesUrgency = (row: SupplierSaleRow) => supplierSaleHasRushSignal(row) === (urgency === "rush");
    saleRows = saleRows.filter(matchesUrgency);
    statsRows = statsRows.filter(matchesUrgency);
  }
  saleRows = saleRows.slice(0, requestedLimit);
  const counts = buildSupplierSaleCountsFromRows(statsRows, now);
  if (!saleRows.length) return buildSupplierSaleBoardFromRows([], [], [], now, scope === "deadline" ? "deadline" : "newest", counts);
  const saleIds = saleRows.map((row) => row.id);
  const [itemRows, eventRows] = await Promise.all([
    supabaseRequest<SupplierSaleItemRow[]>("supplier_sale_items", undefined, {
      select: "*",
      sale_id: inList(saleIds),
      order: "created_at.asc",
      limit: 1000,
    }),
    supabaseRequest<SupplierSaleEventRow[]>("supplier_sale_events", undefined, {
      select: "*",
      sale_id: inList(saleIds),
      order: "created_at.desc",
      limit: 1000,
    }),
  ]);
  return buildSupplierSaleBoardFromRows(saleRows, itemRows, eventRows, now, scope === "deadline" ? "deadline" : "newest", counts);
}

function supplierLabel(supplier: SupplierSaleSupplier, specialSupplierName?: string | null) {
  if (supplier === "quentin") return "Quentin";
  if (supplier === "said") return "Saeid";
  return nullableText(specialSupplierName, 120) || "Sonder-Supplier";
}

function supplierTagValue(supplier: SupplierSaleSupplier) {
  const values: Record<SupplierSaleSupplier, string | undefined> = {
    quentin: process.env.SUPPLIER_TAG_QUENTIN || process.env.SHOPIFY_SUPPLIER_TAG_QUENTIN || "Quentin (noch bezahlen)",
    said: process.env.SUPPLIER_TAG_SAID || process.env.SHOPIFY_SUPPLIER_TAG_SAID || "Saeid (schon bezahlt)",
    special: process.env.SUPPLIER_TAG_SPECIAL || process.env.SHOPIFY_SUPPLIER_TAG_SPECIAL,
  };
  const value = nullableText(values[supplier], 80);
  if (supplier === "quentin" && supplierTagKey(value) === supplierTagKey("Quentin (schon bezahlt)")) {
    return "Quentin (noch bezahlen)";
  }
  return value;
}

function noPaymentReminderTagValue() {
  return nullableText(
    process.env.SHOPIFY_NO_PAYMENT_REMINDER_TAG ||
      process.env.SUPPLIER_NO_PAYMENT_REMINDER_TAG ||
      "Keine Zahlungserinnerung n8n",
    120,
  );
}

function supplierTrelloListId(supplier: SupplierSaleSupplier) {
  const values: Record<SupplierSaleSupplier, string | undefined> = {
    quentin: process.env.SUPPLIER_TRELLO_QUENTIN_LIST_ID || process.env.OPS_SUPPLIER_TRELLO_QUENTIN_LIST_ID,
    said: process.env.SUPPLIER_TRELLO_SAID_LIST_ID || process.env.OPS_SUPPLIER_TRELLO_SAID_LIST_ID,
    special: process.env.SUPPLIER_TRELLO_SPECIAL_LIST_ID || process.env.OPS_SUPPLIER_TRELLO_SPECIAL_LIST_ID,
  };
  return nullableText(values[supplier], 180);
}

function supplierAssignmentTasksEnabled() {
  return String(process.env.SUPPLIER_ASSIGNMENT_TASKS_ENABLED || "")
    .trim()
    .toLowerCase() === "true";
}

function shopifyConfig() {
  const token = shopifyAdminToken();
  const domain = shopifyShopDomain();
  const version = nullableText(process.env.SHOPIFY_ADMIN_API_VERSION, 40) || "2026-01";
  if (!token || !domain) return null;
  return { token, domain, version };
}

function shopifyOrderGid(row: SupplierSaleRow) {
  const rawGid = nullableText(row.metadata?.admin_graphql_api_id, 260) || nullableText(row.raw_shopify?.admin_graphql_api_id, 260) || nullableText(row.shopify_order_id, 260);
  if (!rawGid) return null;
  if (rawGid.startsWith("gid://shopify/Order/")) return rawGid;
  if (/^\d+$/.test(rawGid)) return `gid://shopify/Order/${rawGid}`;
  return null;
}

function shopifySearchTerm(value: unknown) {
  return nullableText(value, 180)?.replace(/["\\]/g, " ").trim() || null;
}

async function findShopifyOrderGid(config: NonNullable<ReturnType<typeof shopifyConfig>>, row: SupplierSaleRow) {
  const candidates = [
    shopifySearchTerm(row.document_reference),
    shopifySearchTerm(row.offer_number),
  ].filter((value): value is string => Boolean(value));
  for (const query of candidates) {
    const response = await fetch(`https://${config.domain}/admin/api/${config.version}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": config.token,
      },
      body: JSON.stringify({
        query: `
          query SupplierSalesOrderLookup($query: String!) {
            orders(first: 3, query: $query, sortKey: CREATED_AT, reverse: true) {
              nodes { id name email tags }
            }
          }
        `,
        variables: { query },
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const body = await response.json().catch(() => null) as JsonRecord | null;
    if (!response.ok) return { orderGid: null, error: `Shopify Order-Suche HTTP ${response.status}` };
    const errors = arrayRecords(body?.errors);
    if (errors.length) {
      return {
        orderGid: null,
        error: errors.map((error) => cleanText(error.message || JSON.stringify(error), 200)).filter(Boolean).join("; ") || "Shopify Order-Suche fehlgeschlagen.",
      };
    }
    const orders = arrayRecords(jsonRecord(jsonRecord(body?.data).orders).nodes);
    if (orders.length === 1) {
      const id = recordString(orders[0], ["id"], 260);
      if (id?.startsWith("gid://shopify/Order/")) return { orderGid: id, error: null };
    }
    if (orders.length > 1) return { orderGid: null, error: `Shopify Order-Suche ist nicht eindeutig fuer ${query}.` };
  }
  return { orderGid: null, error: "Shopify Order-ID fehlt; keine eindeutige Shopify Order zur Angebotsreferenz gefunden." };
}

async function syncShopifyOrderTag(row: SupplierSaleRow, tagValue: string | null, missingMessage: string) {
  if (!tagValue) return { status: "skipped" as const, error: missingMessage, orderGid: null };
  const config = shopifyConfig();
  if (!config) return { status: "skipped" as const, error: "Shopify Admin API ist nicht konfiguriert.", orderGid: null };
  const localOrderGid = shopifyOrderGid(row);
  const lookup = localOrderGid ? { orderGid: localOrderGid, error: null } : await findShopifyOrderGid(config, row);
  const orderGid = lookup.orderGid;
  if (!orderGid) return { status: "failed" as const, error: lookup.error || "Shopify Order-ID fehlt.", orderGid: null };

  const response = await fetch(`https://${config.domain}/admin/api/${config.version}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": config.token,
    },
    body: JSON.stringify({
      query: `
        mutation SupplierTagsAdd($id: ID!, $tags: [String!]!) {
          tagsAdd(id: $id, tags: $tags) {
            node { id }
            userErrors { field message }
          }
        }
      `,
      variables: { id: orderGid, tags: [tagValue] },
    }),
    signal: AbortSignal.timeout(12_000),
  });

  const body = await response.json().catch(() => null) as JsonRecord | null;
  if (!response.ok) return { status: "failed" as const, error: `Shopify TagsAdd HTTP ${response.status}`, orderGid };
  const errors = arrayRecords(jsonRecord(body?.data).tagsAdd ? jsonRecord(jsonRecord(body?.data).tagsAdd).userErrors : body?.errors);
  if (errors.length) {
    return {
      status: "failed" as const,
      error: errors.map((error) => cleanText(error.message || JSON.stringify(error), 200)).filter(Boolean).join("; ") || "Shopify Tag konnte nicht gesetzt werden.",
      orderGid,
    };
  }
  return { status: "synced" as const, error: null, orderGid };
}

async function syncShopifySupplierTag(row: SupplierSaleRow, tagValue: string | null) {
  return syncShopifyOrderTag(row, tagValue, "Supplier-Tag ist nicht konfiguriert.");
}

function trelloCardName(row: SupplierSaleRow, supplier: SupplierSaleSupplier, deliveryDate: string, specialSupplierName?: string | null) {
  const label = supplierLabel(supplier, specialSupplierName);
  const order = row.shopify_order_name || row.offer_number || row.document_reference || row.sale_key;
  return `${label} | ${order} | ${row.customer_name || row.customer_company || "Kunde"} | ${deliveryDate}`.slice(0, 180);
}

function assignmentDescription(row: SupplierSaleRow, supplier: SupplierSaleSupplier, deliveryDate: string, note?: string | null) {
  return [
    `Supplier: ${supplierLabel(supplier, row.special_supplier_name)}`,
    `Lieferdatum Kunde: ${deliveryDate}`,
    `Kunde: ${row.customer_name || "-"}${row.customer_company ? ` / ${row.customer_company}` : ""}`,
    `E-Mail: ${row.customer_email || "-"}`,
    `Shopify: ${row.shopify_order_name || row.shopify_order_id || "-"}`,
    row.shopify_order_url ? `Shopify-Link: ${row.shopify_order_url}` : null,
    row.offer_public_url ? `Angebot: ${row.offer_public_url}` : null,
    row.final_pdf_url ? `Finaler Snapshot: ${row.final_pdf_url}` : null,
    row.supplier_trello_card_url ? `Supplier-Trello-Karte: ${row.supplier_trello_card_url}` : null,
    row.trello_card_id ? `Ursprungs-Trello-ID: ${row.trello_card_id}` : null,
    row.product_summary ? `Produkt: ${row.product_summary}` : null,
    row.recommendation_reasons?.length ? `Regeln: ${row.recommendation_reasons.join(", ")}` : null,
    note ? `Notiz: ${note}` : null,
    `Supplier Sale: ${row.id}`,
  ].filter(Boolean).join("\n");
}

async function projectSupplierTrelloCard(row: SupplierSaleRow, supplier: SupplierSaleSupplier, deliveryDate: string, note?: string | null) {
  const listId = supplierTrelloListId(supplier);
  if (!listId) return { status: "skipped" as const, cardId: null, cardUrl: null, error: "Supplier-Trello-Liste ist nicht konfiguriert." };
  const card = await createTrelloCard({
    listId,
    name: trelloCardName(row, supplier, deliveryDate, row.special_supplier_name),
    desc: assignmentDescription(row, supplier, deliveryDate, note),
  });
  return { status: "synced" as const, cardId: card.id, cardUrl: card.url || card.shortUrl || null, error: null };
}

async function ensureSupplierAssignmentTask(saleId: string, actor?: SupplierSaleActor | null, assigneeLabel?: string | null) {
  if (!supplierAssignmentTasksEnabled()) return { taskId: null, created: false };
  const row = await fetchSaleRowById(saleId);
  if (!row) throw new QuoteValidationError("Sale wurde nicht gefunden.", ["Sale wurde nicht gefunden."], 404);
  if (row.active_task_id) return { taskId: row.active_task_id, created: false };
  const taskSupplier: SupplierSaleSupplier = row.assigned_supplier || (row.recommended_supplier === "quentin" ? "quentin" : "said");

  const sourceRef = `supplier_sale:${row.id}`;
  const existingTasks = await listOpsInternalTasks({ includeDone: false, requestId: row.request_id, limit: 150 });
  const existing = existingTasks.find((task) => task.sourceRef === sourceRef || task.description?.includes(`Supplier Sale: ${row.id}`));
  if (existing) {
    await patchSaleRow(row.id, { active_task_id: existing.id, task_sync_status: "synced", task_sync_error: null });
    return { taskId: existing.id, created: false };
  }

  const dueAt = row.supplier_due_date
    ? new Date(`${row.supplier_due_date}T09:00:00.000Z`).toISOString()
    : new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const task = await createOpsInternalTask(
    {
      title: `Sale ${row.shopify_order_name || row.offer_number || row.document_reference || row.sale_key} vergeben`,
      description: assignmentDescription(row, taskSupplier, row.supplier_due_date || row.customer_due_date || "offen", row.assignment_note),
      category: "admin",
      priority: row.supplier_due_date && row.supplier_due_date <= new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) ? "high" : "normal",
      assigneeLabel: nullableText(assigneeLabel, 120) || nullableText(process.env.SUPPLIER_ASSIGNMENT_TASK_ASSIGNEE, 120) || "Fabienne",
      dueAt,
      requestId: row.request_id,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      trelloCardId: row.supplier_trello_card_id || row.trello_card_id,
      sourceApp: "supplier_sales",
      sourceRef,
      metadata: {
        supplier_sale_id: row.id,
        shopify_order_id: row.shopify_order_id,
        offer_id: row.offer_id,
        supplier: row.assigned_supplier || row.recommended_supplier,
      },
    },
    actor || undefined,
  );
  await patchSaleRow(row.id, { active_task_id: task.id, task_sync_status: "synced", task_sync_error: null });
  return { taskId: task.id, created: true };
}

export async function cleanupSupplierAssignmentTasks(): Promise<SupplierAssignmentTaskCleanupResult> {
  const dedicatedRows = await supabaseRequest<Array<{ id: string }>>("ops_internal_tasks", undefined, {
    select: "id",
    source_app: "eq.supplier_sales",
    source_ref: "like.supplier_sale:%",
    status: "in.(open,in_progress,waiting)",
    limit: 1000,
  }).catch((error) => {
    if (
      error instanceof SupabaseRestError &&
      (String(error.details || "").includes("ops_internal_tasks") || String(error.message || "").includes("ops_internal_tasks"))
    ) {
      return [] as Array<{ id: string }>;
    }
    throw error;
  });

  let archivedDedicatedTasks = 0;
  if (dedicatedRows.length) {
    await supabaseRequest("ops_internal_tasks", {
      method: "PATCH",
      body: JSON.stringify({
        status: "archived",
        completed_at: new Date().toISOString(),
        completed_by: "supplier-sales-cleanup",
        updated_by: "supplier-sales-cleanup",
      }),
      headers: { Prefer: "return=minimal" },
    }, {
      id: inList(dedicatedRows.map((row) => row.id)),
    });
    archivedDedicatedTasks = dedicatedRows.length;
  }

  const fallbackRows = await supabaseRequest<Array<{ id: string }>>("sales_tasks", undefined, {
    select: "id",
    source: "eq.ops_internal",
    source_ref: "like.supplier_sale:%",
    status: "in.(open,waiting,blocked)",
    limit: 1000,
  }).catch((error) => {
    if (
      error instanceof SupabaseRestError &&
      (String(error.details || "").includes("sales_tasks") || String(error.message || "").includes("sales_tasks"))
    ) {
      return [] as Array<{ id: string }>;
    }
    throw error;
  });

  let closedFallbackTasks = 0;
  if (fallbackRows.length) {
    await supabaseRequest("sales_tasks", {
      method: "PATCH",
      body: JSON.stringify({
        status: "closed",
        completed_at: new Date().toISOString(),
      }),
      headers: { Prefer: "return=minimal" },
    }, {
      id: inList(fallbackRows.map((row) => row.id)),
    });
    closedFallbackTasks = fallbackRows.length;
  }

  const saleRows = await supabaseRequest<Array<{ id: string }>>("supplier_sales", undefined, {
    select: "id",
    active_task_id: "not.is.null",
    limit: 1000,
  });

  let clearedSales = 0;
  if (saleRows.length) {
    await supabaseRequest("supplier_sales", {
      method: "PATCH",
      body: JSON.stringify({
        active_task_id: null,
        task_sync_status: "skipped",
        task_sync_error: null,
      }),
      headers: { Prefer: "return=minimal" },
    }, {
      id: inList(saleRows.map((row) => row.id)),
    });
    clearedSales = saleRows.length;
  }

  return { archivedDedicatedTasks, closedFallbackTasks, clearedSales };
}

function pdfText(value: unknown) {
  const text = String(value ?? "")
    .replace(/[–—]/g, "-")
    .replace(/[·•]/g, "-")
    .replace(/[„“”]/g, '"')
    .replace(/[‚‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  let escaped = "";
  for (const char of text) {
    if (char === "\\") escaped += "\\\\";
    else if (char === "(") escaped += "\\(";
    else if (char === ")") escaped += "\\)";
    else {
      const code = char.charCodeAt(0);
      if (code >= 32 && code <= 126) escaped += char;
      else if (code >= 160 && code <= 255) escaped += `\\${code.toString(8).padStart(3, "0")}`;
      else escaped += "?";
    }
  }
  return `(${escaped})`;
}

function money(value: unknown, currency = "EUR") {
  const amount = numericValue(value);
  if (amount === null) return "-";
  return `${amount.toFixed(2)} ${currency}`;
}

function dateLabel(value: unknown) {
  const text = cleanText(value, 80);
  if (!text) return "-";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function wrapPdfText(value: unknown, maxChars: number) {
  const words = String(value ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function addressLines(value: unknown) {
  const address = jsonRecord(value);
  return [
    recordString(address, ["company"], 180),
    recordString(address, ["name"], 180),
    [recordString(address, ["address1", "street"], 180), recordString(address, ["address2"], 180)].filter(Boolean).join(" "),
    [recordString(address, ["zip", "postalCode"], 40), recordString(address, ["city"], 120)].filter(Boolean).join(" "),
    recordString(address, ["country"], 120),
  ].filter(Boolean);
}

function orderConfirmationLineItems(row: SupplierSaleRow, itemRows: SupplierSaleItemRow[]) {
  const snapshot = jsonRecord(row.offer_snapshot);
  const snapshotItems = arrayRecords(snapshot.lineItems);
  if (snapshotItems.length) {
    return snapshotItems.map((item, index) => {
      const quantity = numericValue(item.quantity) || numericValue(item.normalizedQuantity) || 1;
      const unitPrice = numericValue(item.unitPriceNet) ?? numericValue(item.unitPrice) ?? numericValue(item.unit_price);
      const lineNet = numericValue(item.lineNet);
      return {
        title: recordString(item, ["title", "name"], 240) || `Position ${index + 1}`,
        description: recordString(item, ["description"], 600),
        quantity,
        unitPrice,
        total: lineNet ?? (unitPrice === null ? null : unitPrice * quantity),
      };
    });
  }
  return itemRows.map((item, index) => ({
    title: item.title || `Position ${index + 1}`,
    description: recordString(item.raw_line_item, ["description"], 600),
    quantity: Number(item.quantity || 1),
    unitPrice: null,
    total: null,
  }));
}

class SimplePdfDocument {
  private pages: string[][] = [[]];
  private y = 0;

  constructor(private readonly width = 595.28, private readonly height = 841.89) {
    this.y = this.height - 52;
  }

  private current() {
    return this.pages[this.pages.length - 1];
  }

  addPage() {
    this.pages.push([]);
    this.y = this.height - 52;
  }

  ensure(space: number) {
    if (this.y - space < 64) this.addPage();
  }

  move(amount: number) {
    this.y -= amount;
  }

  get cursorY() {
    return this.y;
  }

  set cursorY(value: number) {
    this.y = value;
  }

  get pageCount() {
    return this.pages.length;
  }

  text(value: unknown, x: number, y: number, options?: { size?: number; bold?: boolean; color?: string }) {
    const size = options?.size || 10;
    const font = options?.bold ? "F2" : "F1";
    const color = options?.color || "0 0 0";
    this.current().push(`BT ${color} rg /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfText(value)} Tj ET`);
  }

  multiline(value: unknown, x: number, maxChars: number, options?: { size?: number; leading?: number; bold?: boolean; color?: string }) {
    const leading = options?.leading || 13;
    for (const line of wrapPdfText(value, maxChars)) {
      this.ensure(leading);
      this.text(line, x, this.y, options);
      this.y -= leading;
    }
  }

  line(x1: number, y1: number, x2: number, y2: number, color = "0.75 0.72 0.67", width = 0.7) {
    this.current().push(`${color} RG ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }

  rect(x: number, y: number, w: number, h: number, color = "0.96 0.95 0.92") {
    this.current().push(`${color} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }

  strokeRect(x: number, y: number, w: number, h: number, color = "0.90 0.88 0.91", width = 0.7) {
    this.current().push(`${color} RG ${width} w ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
  }

  render() {
    const objects: string[] = [];
    const addObject = (body: string) => {
      objects.push(body);
      return objects.length;
    };

    const catalogId = addObject("<< /Type /Catalog /Pages 2 0 R >>");
    const pagesId = addObject("");
    const fontRegularId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const fontBoldId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const pageIds: number[] = [];

    for (const commands of this.pages) {
      const stream = commands.join("\n");
      const contentId = addObject(`<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`);
      const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`);
      pageIds.push(pageId);
    }

    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((body, index) => {
      offsets.push(Buffer.byteLength(pdf, "utf8"));
      pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xrefOffset = Buffer.byteLength(pdf, "utf8");
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let index = 1; index < offsets.length; index += 1) {
      pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return new Uint8Array(Buffer.from(pdf, "utf8"));
  }
}

function safePdfFileName(value: unknown) {
  const text = cleanText(value, 120).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return text || "auftrag";
}

function renderSupplierPdfCard(pdf: SimplePdfDocument, x: number, y: number, w: number, h: number, title: string, lines: unknown[], options?: { dark?: boolean }) {
  const dark = options?.dark === true;
  pdf.rect(x, y, w, h, dark ? "0.12 0.10 0.12" : "1 1 1");
  pdf.strokeRect(x, y, w, h, dark ? "0.24 0.20 0.24" : "0.90 0.88 0.91", 0.6);
  pdf.text(title.toUpperCase(), x + 14, y + h - 19, { size: 7.5, bold: true, color: dark ? "0.70 0.64 0.70" : "0.48 0.43 0.51" });
  let currentY = y + h - 35;
  for (const line of lines.filter(Boolean).slice(0, 7)) {
    pdf.text(line, x + 14, currentY, { size: 10, color: dark ? "1 1 1" : "0.07 0.06 0.08", bold: currentY === y + h - 35 });
    currentY -= 13;
  }
}

function renderSupplierPdfFooter(pdf: SimplePdfDocument, reference: string, page: number) {
  pdf.text(reference, 48, 34, { size: 7.5, color: "0.50 0.47 0.53" });
  pdf.text(`NEONTRIP Auftragsbestätigung - ${page}`, 410, 34, { size: 7.5, color: "0.50 0.47 0.53" });
}

function renderSupplierPdfHeader(pdf: SimplePdfDocument, reference: string, page: number) {
  pdf.text("NEONTRIP", 430, 806, { size: 14, bold: true });
  pdf.text(reference, 48, 806, { size: 8.5, color: "0.50 0.47 0.53" });
  renderSupplierPdfFooter(pdf, reference, page);
}

function supplierPdfLineCount(value: unknown, maxChars: number) {
  return wrapPdfText(value, maxChars).length;
}

function renderSupplierPdfItemsHeader(pdf: SimplePdfDocument, y: number, continuation = false) {
  pdf.text(continuation ? "Bestellte Positionen (Fortsetzung)" : "Bestellte Positionen", 48, y, { size: 18, bold: true });
  pdf.rect(48, y - 30, 500, 24, "0.96 0.94 0.97");
  pdf.text("Position", 62, y - 22, { size: 8, bold: true, color: "0.48 0.43 0.51" });
  pdf.text("Menge", 344, y - 22, { size: 8, bold: true, color: "0.48 0.43 0.51" });
  pdf.text("Einzel netto", 392, y - 22, { size: 8, bold: true, color: "0.48 0.43 0.51" });
  pdf.text("Gesamt netto", 478, y - 22, { size: 8, bold: true, color: "0.48 0.43 0.51" });
  pdf.cursorY = y - 46;
}

export async function generateSupplierOrderConfirmationPdf(saleId: string): Promise<SupplierOrderConfirmationPdf> {
  const row = await fetchSaleRowById(saleId);
  if (!row) throw new QuoteValidationError("Sale wurde nicht gefunden.", ["Sale wurde nicht gefunden."], 404);
  const itemRows = await fetchItemsForSale(row.id);
  const snapshot = jsonRecord(row.offer_snapshot);
  const offer = jsonRecord(snapshot.offer);
  const customer = jsonRecord(snapshot.customer);
  const totals = jsonRecord(snapshot.totals);
  const currency = row.currency || recordString(offer, ["currency"], 12) || "EUR";
  const documentReference = row.document_reference || row.offer_number || row.shopify_order_name || row.sale_key;
  const customerLabel = row.customer_company || row.customer_name || recordString(customer, ["company", "signerName"], 180) || "-";
  const lines = orderConfirmationLineItems(row, itemRows);
  const deliveryAddressLines = addressLines(snapshot.deliveryAddress);
  const billingAddressLines = addressLines(snapshot.billingAddress);
  const acceptedAt = recordString(snapshot, ["acceptedAt", "signedAt"], 80) || recordString(offer, ["acceptedAt", "signedAt"], 80) || row.created_at;
  const subtotal = numericValue(totals.subtotalNet) ?? numericValue(row.subtotal_price);
  const tax = numericValue(totals.vatAmount) ?? numericValue(totals.taxAmount);
  const total = numericValue(totals.totalGross) ?? numericValue(row.total_price);
  const delivery = deliveryAddressLines.length ? deliveryAddressLines : billingAddressLines;
  const supplierLines = ["Dara Nova GmbH", "Bilka Allee 29", "40219 Düsseldorf", "Amtsgericht Düsseldorf", "HRB101352", "USt-IdNr.: DE362152329"];
  const customerLines = [customerLabel, row.customer_name && row.customer_name !== customerLabel ? row.customer_name : null, row.customer_email].filter(Boolean);

  const pdf = new SimplePdfDocument();
  pdf.rect(0, 0, 595.28, 841.89, "0.04 0.04 0.04");
  pdf.rect(0, 0, 595.28, 96, "0.10 0.03 0.07");
  pdf.rect(46, 746, 106, 22, "0.98 0.19 0.64");
  pdf.text("AUFTRAG BESTÄTIGT", 58, 753, { size: 7.5, bold: true, color: "1 1 1" });
  pdf.text("NEONTRIP", 48, 792, { size: 20, bold: true, color: "1 1 1" });
  pdf.text("Auftragsbestätigung", 48, 672, { size: 38, bold: true, color: "1 1 1" });
  pdf.text("Dokumentiert die angenommene Auswahl aus dem freigegebenen Angebots-Snapshot.", 50, 640, { size: 12, color: "0.78 0.74 0.80" });
  pdf.rect(48, 514, 226, 96, "1 1 1");
  pdf.text("GESAMT BRUTTO", 64, 580, { size: 7.5, bold: true, color: "0.48 0.43 0.51" });
  pdf.text(money(total, currency), 64, 544, { size: 24, bold: true, color: "0.07 0.06 0.08" });
  pdf.text("keine Rechnung - Auftragsbestätigung", 64, 528, { size: 8.5, color: "0.42 0.38 0.45" });
  renderSupplierPdfCard(pdf, 310, 514, 220, 96, "Dokument", [
    `Angebot: ${row.offer_number || documentReference}`,
    `Referenz: ${documentReference}`,
    `Angenommen: ${dateLabel(acceptedAt)}`,
    `Liefertermin: ${dateLabel(row.customer_due_date || row.supplier_due_date)}`,
  ], { dark: true });
  renderSupplierPdfCard(pdf, 48, 390, 226, 92, "Empfänger", customerLines, { dark: true });
  renderSupplierPdfCard(pdf, 310, 390, 220, 92, "Freigabe", [
    "Auftragsdaten übernommen",
    "aus offer_snapshot",
    "Preisstand final dokumentiert",
    "für B2B-Prüfung und Ablage",
  ], { dark: true });
  const trust = [
    ["PDF Snapshot", "Angebotsstand"],
    ["B2B Auftrag", "Netto & brutto"],
    ["Düsseldorf", "Showroom & Beratung"],
    ["NEONTRIP", "Dara Nova GmbH"],
  ];
  trust.forEach(([title, sub], index) => {
    const x = 48 + index * 122;
    pdf.rect(x, 134, 106, 54, "0.12 0.10 0.12");
    pdf.strokeRect(x, 134, 106, 54, "0.24 0.20 0.24", 0.5);
    pdf.text(title, x + 10, 164, { size: 10, bold: true, color: "1 1 1" });
    pdf.text(sub, x + 10, 149, { size: 7.5, color: "0.66 0.61 0.68" });
  });
  pdf.text("Auftragsbestätigung automatisch aus dem angenommenen Angebot erzeugt", 48, 76, { size: 8.5, color: "0.62 0.58 0.64" });

  pdf.addPage();
  renderSupplierPdfHeader(pdf, documentReference, 2);
  pdf.rect(48, 728, 84, 22, "0.98 0.89 0.95");
  pdf.text("AUFTRAGSDATEN", 60, 735, { size: 7.5, bold: true, color: "0.88 0.08 0.48" });
  pdf.text("Auftragsbestätigung", 48, 690, { size: 25, bold: true });
  pdf.text("Diese Unterlage fasst die angenommene Angebotsauswahl zusammen. Sie ersetzt keine Rechnung.", 48, 668, { size: 10, color: "0.42 0.38 0.45" });

  renderSupplierPdfCard(pdf, 48, 526, 236, 116, "Anbieter", supplierLines);
  renderSupplierPdfCard(pdf, 312, 526, 236, 116, "Kunde", customerLines);
  renderSupplierPdfCard(pdf, 48, 396, 236, 98, "Lieferanschrift", delivery.length ? delivery : ["Keine Lieferanschrift im Snapshot"]);
  renderSupplierPdfCard(pdf, 312, 396, 236, 98, "Rechnungsanschrift", billingAddressLines.length ? billingAddressLines : ["entspricht Lieferanschrift"]);

  const summary = [
    [money(subtotal, currency), "Gesamt netto"],
    [tax === null ? "-" : money(tax, currency), "MwSt."],
    [money(total, currency), "Gesamt brutto"],
  ];
  summary.forEach(([value, label], index) => {
    const x = 48 + index * 168;
    pdf.rect(x, 322, 150, 52, index === 2 ? "0.04 0.04 0.04" : "1 1 1");
    pdf.strokeRect(x, 322, 150, 52, "0.90 0.88 0.91", 0.6);
    pdf.text(value, x + 14, 348, { size: 13, bold: true, color: index === 2 ? "1 1 1" : "0.07 0.06 0.08" });
    pdf.text(label.toUpperCase(), x + 14, 332, { size: 7.5, bold: true, color: index === 2 ? "0.70 0.64 0.70" : "0.48 0.43 0.51" });
  });

  renderSupplierPdfItemsHeader(pdf, 280);

  for (const [index, item] of lines.entries()) {
    const descriptionLines = item.description ? supplierPdfLineCount(item.description, 58) : 0;
    const rowHeight = Math.max(46, 32 + descriptionLines * 10);
    if (pdf.cursorY - rowHeight < 72) {
      pdf.addPage();
      renderSupplierPdfHeader(pdf, documentReference, pdf.pageCount);
      renderSupplierPdfItemsHeader(pdf, 744, true);
    }
    const rowY = pdf.cursorY - rowHeight;
    pdf.rect(48, rowY, 500, rowHeight - 4, index % 2 === 0 ? "1 1 1" : "0.985 0.975 0.99");
    pdf.strokeRect(48, rowY, 500, rowHeight - 4, "0.90 0.88 0.91", 0.45);
    pdf.text(item.title, 62, pdf.cursorY - 18, { size: 10, bold: true });
    if (item.description) {
      const oldY = pdf.cursorY;
      pdf.cursorY = pdf.cursorY - 34;
      pdf.multiline(item.description, 62, 58, { size: 8, color: "0.42 0.38 0.45", leading: 10 });
      pdf.cursorY = oldY;
    }
    pdf.text(String(item.quantity || 1), 356, pdf.cursorY - 18, { size: 9 });
    pdf.text(item.unitPrice === null ? "-" : money(item.unitPrice, currency), 392, pdf.cursorY - 18, { size: 9 });
    pdf.text(item.total === null ? "-" : money(item.total, currency), 478, pdf.cursorY - 18, { size: 9, bold: true });
    pdf.cursorY = rowY - 10;
  }

  pdf.rect(48, Math.max(52, pdf.cursorY - 52), 500, 42, "0.98 0.89 0.95");
  pdf.text("Hinweis", 62, Math.max(77, pdf.cursorY - 28), { size: 9, bold: true, color: "0.88 0.08 0.48" });
  pdf.text("Diese Auftragsbestätigung ist für Prüfung und Ablage gedacht. Die Rechnung kommt separat über den Zahlungs-/Rechnungsprozess.", 62, Math.max(63, pdf.cursorY - 43), { size: 8.5, color: "0.18 0.12 0.18" });

  return {
    fileName: `auftragsbestaetigung-${safePdfFileName(documentReference)}.pdf`,
    bytes: pdf.render(),
  };
}

function orderConfirmationEmailWebhookUrl() {
  return nullableText(
    process.env.SUPPLIER_ORDER_CONFIRMATION_WEBHOOK_URL ||
      process.env.N8N_SUPPLIER_ORDER_CONFIRMATION_WEBHOOK_URL ||
      process.env.ORDER_CONFIRMATION_WEBHOOK_URL,
    1000,
  );
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function orderConfirmationReference(row: SupplierSaleRow) {
  return row.document_reference || row.offer_number || row.shopify_order_name || row.sale_key;
}

function orderConfirmationSubject(row: SupplierSaleRow) {
  return `Auftragsbestätigung ${orderConfirmationReference(row)}`;
}

function customerGreeting(row: SupplierSaleRow) {
  const name = nullableText(row.customer_name, 120);
  return name ? `Guten Tag ${name},` : "Guten Tag,";
}

function orderConfirmationEmailText(row: SupplierSaleRow) {
  const reference = orderConfirmationReference(row);
  return [
    customerGreeting(row),
    "",
    `anbei erhalten Sie die Auftragsbestätigung zu ${reference}.`,
    "Die Unterlage fasst den freigegebenen Angebots-Snapshot zusammen und ist für Ihre Prüfung und Ablage gedacht. Die Rechnung kommt separat über den Zahlungs- beziehungsweise Rechnungsprozess.",
    "",
    "Viele Grüße",
    "Fabienne",
    "NEONTRIP",
  ].join("\n");
}

function orderConfirmationEmailHtml(row: SupplierSaleRow) {
  const reference = escapeHtml(orderConfirmationReference(row));
  return [
    `<p>${escapeHtml(customerGreeting(row))}</p>`,
    `<p>anbei erhalten Sie die Auftragsbestätigung zu <strong>${reference}</strong>.</p>`,
    "<p>Die Unterlage fasst den freigegebenen Angebots-Snapshot zusammen und ist für Ihre Prüfung und Ablage gedacht. Die Rechnung kommt separat über den Zahlungs- beziehungsweise Rechnungsprozess.</p>",
    "<p>Viele Grüße<br>Fabienne<br>NEONTRIP</p>",
  ].join("");
}

async function sendOrderConfirmationEmailWebhook(input: {
  row: SupplierSaleRow;
  pdf: SupplierOrderConfirmationPdf;
  recipientEmail: string;
  idempotencyKey: string;
  requestedBy: string | null;
  pdfHash: string;
}) {
  const url = orderConfirmationEmailWebhookUrl();
  if (!url) {
    return {
      status: "failed" as const,
      providerMessageId: null,
      error: "Auftragsbestaetigung-Webhook ist nicht konfiguriert.",
    };
  }

  const payload = {
    kind: "supplier_order_confirmation",
    saleId: input.row.id,
    saleKey: input.row.sale_key,
    source: input.row.source,
    documentReference: input.row.document_reference,
    offerNumber: input.row.offer_number,
    shopifyOrderName: input.row.shopify_order_name,
    recipientEmail: input.recipientEmail,
    customerName: input.row.customer_name,
    customerCompany: input.row.customer_company,
    subject: orderConfirmationSubject(input.row),
    text: orderConfirmationEmailText(input.row),
    html: orderConfirmationEmailHtml(input.row),
    signature: "fabienne_neontrip",
    requestedBy: input.requestedBy,
    idempotencyKey: input.idempotencyKey,
    attachment: {
      filename: input.pdf.fileName,
      contentType: "application/pdf",
      contentBase64: Buffer.from(input.pdf.bytes).toString("base64"),
      sha256: input.pdfHash,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null) as JsonRecord | null;
  if (!response.ok) {
    return {
      status: "failed" as const,
      providerMessageId: null,
      error: `Auftragsbestaetigung-Webhook HTTP ${response.status}`,
    };
  }
  return {
    status: "sent" as const,
    providerMessageId: recordString(body || {}, ["providerMessageId", "messageId", "id"], 260),
    error: null,
  };
}

export async function sendSupplierOrderConfirmationEmail(
  input: SupplierOrderConfirmationEmailInput,
  actor?: SupplierSaleActor | null,
): Promise<SupplierOrderConfirmationEmailResult> {
  const sale = await getSupplierSale(input.saleId);
  const row = await fetchSaleRowById(sale.id);
  if (!row) throw new QuoteValidationError("Sale wurde nicht gefunden.", ["Sale wurde nicht gefunden."], 404);

  const recipientEmail = lowerNullable(input.recipientEmail || row.customer_email, 260);
  if (!recipientEmail) throw new QuoteValidationError("Empfaenger-E-Mail fehlt.", ["Empfaenger-E-Mail fehlt."], 422);

  const requestedBy = nullableText(input.requestedBy || input.operatorName || actor?.operatorName, 120);
  const now = new Date().toISOString();
  const pdf = await generateSupplierOrderConfirmationPdf(row.id);
  const pdfHash = createHash("sha256").update(Buffer.from(pdf.bytes)).digest("hex");
  const idempotencyKey = nullableText(input.idempotencyKey, 260)
    || `supplier-sale:${row.id}:order-confirmation-email:${hashPayload({
      recipient_email: recipientEmail,
      pdf_sha256: pdfHash,
    })}`;

  const webhookReady = Boolean(orderConfirmationEmailWebhookUrl());
  if (!webhookReady) {
    const updated = await patchSaleRow(row.id, {
      metadata: {
        ...(row.metadata || {}),
        order_confirmation_email: {
          status: "failed",
          recipient_email: recipientEmail,
          requested_at: now,
          sent_at: null,
          requested_by: requestedBy,
          provider_message_id: null,
          error: "Auftragsbestaetigung-Webhook ist nicht konfiguriert.",
          idempotency_key: idempotencyKey,
          pdf_file_name: pdf.fileName,
          pdf_sha256: pdfHash,
        },
      },
    });
    await insertEvent({
      saleId: row.id,
      eventType: "manual_note",
      actor: actor || { operatorName: input.operatorName || null },
      idempotencyKey: `${idempotencyKey}:config-missing`,
      payload: { kind: "order_confirmation_email", status: "failed", recipient_email: recipientEmail, error: "webhook_missing" },
    });
    return {
      sale: mapSale(updated, sale.items, sale.latestEvent),
      status: "failed",
      recipientEmail,
      providerMessageId: null,
      error: "Auftragsbestaetigung-Webhook ist nicht konfiguriert.",
    };
  }

  const reserved = await insertEvent({
    saleId: row.id,
    eventType: "manual_note",
    actor: actor || { operatorName: input.operatorName || null },
    idempotencyKey,
    payload: {
      kind: "order_confirmation_email_reserved",
      recipient_email: recipientEmail,
      requested_by: requestedBy,
      pdf_file_name: pdf.fileName,
      pdf_sha256: pdfHash,
    },
  });
  if (!reserved) {
    return {
      sale,
      status: sale.orderConfirmationEmail?.status || "skipped",
      recipientEmail,
      providerMessageId: sale.orderConfirmationEmail?.providerMessageId || null,
      error: sale.orderConfirmationEmail?.error || "Auftragsbestaetigung wurde fuer diesen PDF-Stand bereits verarbeitet.",
    };
  }

  const webhook = await sendOrderConfirmationEmailWebhook({
    row,
    pdf,
    recipientEmail,
    idempotencyKey,
    requestedBy,
    pdfHash,
  });

  const updated = await patchSaleRow(row.id, {
    metadata: {
      ...(row.metadata || {}),
      order_confirmation_email: {
        status: webhook.status,
        recipient_email: recipientEmail,
        requested_at: now,
        sent_at: webhook.status === "sent" ? new Date().toISOString() : null,
        requested_by: requestedBy,
        provider_message_id: webhook.providerMessageId,
        error: webhook.error,
        idempotency_key: idempotencyKey,
        pdf_file_name: pdf.fileName,
        pdf_sha256: pdfHash,
      },
    },
  });

  await insertEvent({
    saleId: row.id,
    eventType: "manual_note",
    actor: actor || { operatorName: input.operatorName || null },
    idempotencyKey: `${idempotencyKey}:result`,
    payload: {
      kind: "order_confirmation_email",
      status: webhook.status,
      recipient_email: recipientEmail,
      provider_message_id: webhook.providerMessageId,
      error: webhook.error,
    },
  });

  return {
    sale: mapSale(updated, sale.items, sale.latestEvent),
    status: webhook.status,
    recipientEmail,
    providerMessageId: webhook.providerMessageId,
    error: webhook.error,
  };
}

async function ensureSupplierDeadlineTask(row: SupplierSaleRow, actor?: SupplierSaleActor | null, now = new Date()) {
  if (!supplierSaleNeedsDeadlineTask(row, now)) return { taskId: nullableText(row.metadata?.deadline_task_id, 120), created: false };

  const dueDate = row.supplier_due_date || row.customer_due_date;
  const sourceRef = `supplier_deadline:${row.id}`;
  const existingTasks = await listOpsInternalTasks({ includeDone: false, requestId: row.request_id, limit: 150 });
  const existing = existingTasks.find((task) => task.sourceRef === sourceRef || task.description?.includes(`Supplier Deadline Sale: ${row.id}`));
  if (existing) {
    await patchSaleRow(row.id, {
      metadata: {
        ...(row.metadata || {}),
        deadline_task_id: existing.id,
        deadline_task_created_at: row.metadata?.deadline_task_created_at || existing.createdAt,
      },
      task_sync_error: null,
    });
    return { taskId: existing.id, created: false };
  }

  const eventKey = `supplier-sale:${row.id}:deadline-task:${dueDate}`;
  const reserved = await insertEvent({
    saleId: row.id,
    eventType: "manual_note",
    actor,
    idempotencyKey: eventKey,
    payload: {
      kind: "deadline_task_reserved",
      due_date: dueDate,
      assignment_status: row.assignment_status,
    },
  });
  if (!reserved) return { taskId: null, created: false };

  let task;
  try {
    task = await createOpsInternalTask(
      {
        title: `Deadline erreicht: ${row.shopify_order_name || row.offer_number || row.document_reference || row.sale_key}`,
        description: [
          `Supplier Deadline Sale: ${row.id}`,
          `Deadline: ${dueDate || "-"}`,
          `Status: ${row.assignment_status}`,
          `Kunde: ${row.customer_name || "-"}`,
          `E-Mail: ${row.customer_email || "-"}`,
          row.customer_phone ? `Telefon: ${row.customer_phone}` : null,
          row.total_price !== null ? `Wert: ${row.total_price} ${row.currency || "EUR"}` : null,
          row.assigned_supplier ? `Supplier: ${supplierLabel(row.assigned_supplier, row.special_supplier_name)}` : null,
          row.shopify_order_url ? `Shopify: ${row.shopify_order_url}` : null,
          row.offer_public_url ? `Angebot: ${row.offer_public_url}` : null,
          row.supplier_trello_card_url ? `Supplier-Karte: ${row.supplier_trello_card_url}` : null,
        ].filter(Boolean).join("\n"),
        category: "problem",
        priority: "urgent",
        assigneeLabel: nullableText(process.env.SUPPLIER_DEADLINE_TASK_ASSIGNEE, 120) || "Fabienne",
        dueAt: now.toISOString(),
        requestId: row.request_id,
        customerName: row.customer_name,
        customerEmail: row.customer_email,
        trelloCardId: row.supplier_trello_card_id || row.trello_card_id,
        sourceApp: "supplier_sales",
        sourceRef,
        metadata: {
          supplier_sale_id: row.id,
          shopify_order_id: row.shopify_order_id,
          offer_id: row.offer_id,
          deadline: dueDate,
          assignment_status: row.assignment_status,
          kind: "supplier_deadline_reached",
        },
      },
      actor || undefined,
    );
  } catch (error) {
    await supabaseRequest("supplier_sale_events", {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    }, {
      idempotency_key: `eq.${eventKey}`,
    }).catch(() => null);
    throw error;
  }

  await patchSaleRow(row.id, {
    metadata: {
      ...(row.metadata || {}),
      deadline_task_id: task.id,
      deadline_task_created_at: now.toISOString(),
      deadline_task_due_date: dueDate,
    },
    task_sync_error: null,
  });
  return { taskId: task.id, created: true };
}

export async function createSupplierDeadlineTasks(actor?: SupplierSaleActor | null, now = new Date()): Promise<SupplierDeadlineTaskResult> {
  const today = now.toISOString().slice(0, 10);
  const rows = await supabaseRequest<SupplierSaleRow[]>("supplier_sales", undefined, {
    select: "*",
    assignment_status: "not.in.(completed,canceled)",
    or: `(supplier_due_date.lte.${today},and(supplier_due_date.is.null,customer_due_date.lte.${today}))`,
    order: "supplier_due_date.asc.nullslast,updated_at.desc",
    limit: 100,
  });

  const candidates = rows.filter((row) => supplierSaleNeedsDeadlineTask(row, now));
  const result: SupplierDeadlineTaskResult = {
    checked: rows.length,
    created: 0,
    skipped: rows.length - candidates.length,
    failed: 0,
    taskIds: [],
    errors: [],
  };

  for (const row of candidates) {
    try {
      const task = await ensureSupplierDeadlineTask(row, actor, now);
      if (task.created) result.created += 1;
      else result.skipped += 1;
      if (task.taskId) result.taskIds.push(task.taskId);
    } catch (error) {
      result.failed += 1;
      const message = error instanceof Error ? error.message : "Deadline-Aufgabe konnte nicht erstellt werden.";
      result.errors.push({ saleId: row.id, error: message });
      await patchSaleRow(row.id, {
        task_sync_status: "failed",
        task_sync_error: message,
      }).catch(() => null);
    }
  }

  return result;
}

function assertSupplier(value: unknown): SupplierSaleSupplier {
  const supplier = cleanText(value, 40) as SupplierSaleSupplier;
  if (!SUPPLIER_SALE_SUPPLIERS.includes(supplier)) {
    throw new QuoteValidationError("Supplier ist ungueltig.", ["Bitte Quentin, Saeid oder Sonder-Supplier waehlen."], 422);
  }
  return supplier;
}

function assertPaymentDecision(value: unknown): SupplierSalePaymentDecision {
  const decision = cleanText(value, 80) as SupplierSalePaymentDecision;
  if (!SUPPLIER_PAYMENT_DECISIONS.includes(decision)) {
    throw new QuoteValidationError("Zahlungsentscheidung ist ungueltig.", ["Bitte Zahlungsentscheidung pruefen."], 422);
  }
  return decision;
}

export async function updateSupplierSalePaymentDecision(input: {
  saleId: string;
  paymentDecisionStatus: SupplierSalePaymentDecision;
  paymentDueAt?: string | null;
  operatorName?: string | null;
}, actor?: SupplierSaleActor | null) {
  const sale = await getSupplierSale(input.saleId);
  const decision = assertPaymentDecision(input.paymentDecisionStatus);
  const updated = await patchSaleRow(sale.id, {
    payment_decision_status: decision,
    payment_due_at: normalizeIsoTimestamp(input.paymentDueAt, "Zahlungsfrist"),
    assignment_status: deriveAssignmentStatus({
      paymentDecisionStatus: decision,
      assignedSupplier: sale.assignedSupplier,
      currentStatus: sale.assignmentStatus,
    }),
  });
  await insertEvent({
    saleId: sale.id,
    eventType: "payment_status_changed",
    actor: actor || { operatorName: input.operatorName || null },
    idempotencyKey: `supplier-sale:${sale.id}:payment-decision:${decision}:${Date.now()}`,
    payload: { decision },
  });
  return mapSale(updated, sale.items, sale.latestEvent);
}

async function reserveSupplierAssignmentAttempt(input: {
  saleId: string;
  attemptKey: string;
  supplier: SupplierSaleSupplier;
  operatorName: string | null;
  requestedDeliveryDate: string;
  assignmentNote: string | null;
  paymentDecisionStatus: SupplierSalePaymentDecision;
  tagValue: string | null;
  assigneeLabel: string | null;
  specialSupplierName: string | null;
}) {
  try {
    await supabaseRequest("supplier_assignment_attempts", {
      method: "POST",
      body: JSON.stringify({
        sale_id: input.saleId,
        attempt_key: input.attemptKey,
        supplier: input.supplier,
        operator_name: input.operatorName,
        requested_delivery_date: input.requestedDeliveryDate,
        assignment_note: input.assignmentNote,
        payment_decision_status: input.paymentDecisionStatus,
        status: "pending",
        shopify_tag_value: input.tagValue,
        metadata: {
          assignee_label: input.assigneeLabel,
          special_supplier_name: input.specialSupplierName,
        },
      }),
      headers: { Prefer: "return=minimal" },
    });
    return true;
  } catch (error) {
    if (error instanceof SupabaseRestError && error.status === 409) return false;
    throw error;
  }
}

export async function assignSupplierSale(input: SupplierSaleAssignInput, actor?: SupplierSaleActor | null) {
  const supplier = assertSupplier(input.supplier);
  const requestedDeliveryDate = normalizeDateOnly(input.requestedDeliveryDate);
  if (!requestedDeliveryDate) {
    throw new QuoteValidationError("Lieferdatum fehlt.", ["Bitte bestaetigen, wann geliefert werden soll."], 422);
  }
  const sale = await getSupplierSale(input.saleId);
  if (sale.postOrderReview.status === "open") {
    throw new QuoteValidationError("24h-Aenderungsfenster laeuft noch.", [
      "Diese Sale noch nicht vergeben. Der Kunde kann innerhalb von 24 Stunden nach Bestellung noch Abweichungen melden.",
    ], 422);
  }
  if (sale.postOrderReview.status === "change_requested") {
    throw new QuoteValidationError("Kunden-Aenderung muss geprueft werden.", [
      "Der Kunde hat nach der Bestellung eine Abweichung gemeldet. Bitte vor der Vergabe pruefen und dokumentieren.",
    ], 422);
  }
  const decision = input.paymentDecisionStatus
    ? assertPaymentDecision(input.paymentDecisionStatus)
    : sale.paymentDecisionStatus;
  if (decision !== "paid_confirmed" && decision !== "manual_approved_unpaid") {
    throw new QuoteValidationError("Unbezahlte Vergabe braucht Freigabe.", [
      "Bei unbezahlten Sales bitte 'trotz offener Zahlung vergeben' bestaetigen oder auf Zahlung warten.",
    ], 422);
  }
  if (supplier === "special" && !nullableText(input.specialSupplierName, 120)) {
    throw new QuoteValidationError("Sonder-Supplier fehlt.", ["Bitte Namen des Sonder-Suppliers eintragen."], 422);
  }

  const now = new Date().toISOString();
  const tagValue = supplierTagValue(supplier);
  const attemptKey = `supplier-sale:${sale.id}:assign:${supplier}:${requestedDeliveryDate}`;
  const operatorName = nullableText(input.operatorName || actor?.operatorName, 120);
  const assignmentNote = nullableText(input.assignmentNote, 1000);
  const specialSupplierName = supplier === "special" ? nullableText(input.specialSupplierName, 120) : null;
  const reserved = await reserveSupplierAssignmentAttempt({
    saleId: sale.id,
    attemptKey,
    supplier,
    operatorName,
    requestedDeliveryDate,
    assignmentNote,
    paymentDecisionStatus: decision,
    tagValue,
    assigneeLabel: nullableText(input.assigneeLabel, 120),
    specialSupplierName: nullableText(input.specialSupplierName, 120),
  });
  if (!reserved) return getSupplierSale(sale.id);

  const basePatch: Partial<SupplierSaleRow> = {
    assigned_supplier: supplier,
    special_supplier_name: specialSupplierName,
    assignment_status: "assigned",
    assignment_note: assignmentNote,
    assigned_at: now,
    assigned_by: operatorName,
    supplier_due_date: requestedDeliveryDate,
    customer_due_date: sale.customerDueDate || requestedDeliveryDate,
    due_date_source: sale.dueDateSource || "operator_confirmed",
    payment_decision_status: decision,
    shopify_tag_value: tagValue,
    shopify_tag_sync_status: tagValue ? "pending" : "skipped",
    shopify_tag_error: tagValue ? null : "Supplier-Tag ist nicht konfiguriert.",
    trello_projection_status: supplierTrelloListId(supplier) ? "pending" : "skipped",
    trello_projection_error: supplierTrelloListId(supplier) ? null : "Supplier-Trello-Liste ist nicht konfiguriert.",
    task_sync_status: supplierAssignmentTasksEnabled() ? "pending" : "skipped",
    task_sync_error: null,
  };

  let row: SupplierSaleRow;
  try {
    row = await patchSaleRow(sale.id, basePatch);
  } catch (error) {
    await supabaseRequest("supplier_assignment_attempts", {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    }, {
      attempt_key: `eq.${attemptKey}`,
    }).catch(() => null);
    throw error;
  }

  await insertEvent({
    saleId: sale.id,
    eventType: "assignment_confirmed",
    actor: actor || { operatorName: input.operatorName || null },
    idempotencyKey: attemptKey,
    payload: { supplier, requested_delivery_date: requestedDeliveryDate, payment_decision_status: decision },
  });

  try {
    const tagSync = await syncShopifySupplierTag(row, tagValue);
    row = await patchSaleRow(sale.id, {
      shopify_order_id: row.shopify_order_id || tagSync.orderGid || null,
      shopify_tag_sync_status: tagSync.status,
      shopify_tag_synced_at: tagSync.status === "synced" ? new Date().toISOString() : null,
      shopify_tag_error: tagSync.error,
    });
  } catch (error) {
    row = await patchSaleRow(sale.id, {
      shopify_tag_sync_status: "failed",
      shopify_tag_error: error instanceof Error ? error.message : "Shopify Tag-Sync fehlgeschlagen.",
    });
  }

  try {
    const trello = await projectSupplierTrelloCard(row, supplier, requestedDeliveryDate, input.assignmentNote);
    row = await patchSaleRow(sale.id, {
      trello_projection_status: trello.status,
      supplier_trello_card_id: trello.cardId,
      supplier_trello_card_url: trello.cardUrl,
      trello_projection_error: trello.error,
    });
  } catch (error) {
    row = await patchSaleRow(sale.id, {
      trello_projection_status: "failed",
      trello_projection_error: error instanceof Error ? error.message : "Trello-Projektion fehlgeschlagen.",
    });
  }

  if (supplierAssignmentTasksEnabled()) {
    try {
      await ensureSupplierAssignmentTask(sale.id, actor, input.assigneeLabel);
    } catch (error) {
      row = await patchSaleRow(sale.id, {
        task_sync_status: "failed",
        task_sync_error: error instanceof Error ? error.message : "Aufgabe konnte nicht erstellt werden.",
      });
    }
  } else {
    row = await patchSaleRow(sale.id, {
      active_task_id: null,
      task_sync_status: "skipped",
      task_sync_error: null,
    });
  }

  const fresh = await getSupplierSale(sale.id);
  await supabaseRequest("supplier_assignment_attempts", {
    method: "PATCH",
    body: JSON.stringify({
      status: [fresh.shopifyTagSyncStatus, fresh.trelloProjectionStatus, fresh.taskSyncStatus].includes("failed") ? "partial" : "synced",
      trello_card_id: fresh.supplierTrelloCardId,
      trello_card_url: fresh.supplierTrelloCardUrl,
      task_id: fresh.activeTaskId,
      completed_at: new Date().toISOString(),
    }),
    headers: { Prefer: "return=minimal" },
  }, {
    attempt_key: `eq.${attemptKey}`,
  }).catch(() => null);
  return fresh;
}

export async function retrySupplierSaleShopifyTag(input: SupplierShopifyTagRetryInput, actor?: SupplierSaleActor | null) {
  const sale = await getSupplierSale(input.saleId);
  if (!sale.assignedSupplier) {
    throw new QuoteValidationError("Sale ist noch nicht vergeben.", ["Shopify-Tag kann erst nach Supplier-Vergabe gesetzt werden."], 422);
  }

  const row = await fetchSaleRowById(sale.id);
  if (!row) throw new QuoteValidationError("Sale wurde nicht gefunden.", ["Sale wurde nicht gefunden."], 404);

  const configuredTagValue = supplierTagValue(sale.assignedSupplier);
  const rowTagValue = nullableText(row.shopify_tag_value, 80);
  const tagValue = sale.assignedSupplier === "quentin" && supplierTagKey(rowTagValue) === supplierTagKey("Quentin (schon bezahlt)")
    ? configuredTagValue
    : rowTagValue || configuredTagValue;
  let updated: SupplierSaleRow;
  try {
    await patchSaleRow(sale.id, {
      shopify_tag_value: tagValue,
      shopify_tag_sync_status: tagValue ? "pending" : "skipped",
      shopify_tag_error: tagValue ? null : "Supplier-Tag ist nicht konfiguriert.",
    });
    const tagSync = await syncShopifySupplierTag({ ...row, shopify_tag_value: tagValue }, tagValue);
    updated = await patchSaleRow(sale.id, {
      shopify_order_id: row.shopify_order_id || tagSync.orderGid || null,
      shopify_tag_value: tagValue,
      shopify_tag_sync_status: tagSync.status,
      shopify_tag_synced_at: tagSync.status === "synced" ? new Date().toISOString() : null,
      shopify_tag_error: tagSync.error,
    });
  } catch (error) {
    updated = await patchSaleRow(sale.id, {
      shopify_tag_sync_status: "failed",
      shopify_tag_error: error instanceof Error ? error.message : "Shopify Tag-Sync fehlgeschlagen.",
    });
  }

  await insertEvent({
    saleId: sale.id,
    eventType: "shopify_tag_retry",
    actor: actor || { operatorName: input.operatorName || null },
    idempotencyKey: `supplier-sale:${sale.id}:shopify-tag-retry:${Date.now()}`,
    payload: {
      assigned_supplier: sale.assignedSupplier,
      shopify_tag_sync_status: updated.shopify_tag_sync_status,
      shopify_tag_error: updated.shopify_tag_error,
    },
  });

  return getSupplierSale(sale.id);
}

export async function applyNoPaymentReminderShopifyTag(
  input: SupplierNoPaymentReminderTagInput,
  actor?: SupplierSaleActor | null,
): Promise<{ sale: SupplierSale; tag: SupplierShopifyTagActionResult }> {
  const sale = await getSupplierSale(input.saleId);
  const row = await fetchSaleRowById(sale.id);
  if (!row) throw new QuoteValidationError("Sale wurde nicht gefunden.", ["Sale wurde nicht gefunden."], 404);

  const tagValue = noPaymentReminderTagValue();
  const tagSync = await syncShopifyOrderTag(row, tagValue, "Keine-Zahlungserinnerung-Tag ist nicht konfiguriert.");
  const metadata = {
    ...(row.metadata || {}),
    no_payment_reminder_tag_value: tagValue,
    no_payment_reminder_tag_status: tagSync.status,
    no_payment_reminder_tag_error: tagSync.error,
    no_payment_reminder_tag_synced_at: tagSync.status === "synced" ? new Date().toISOString() : null,
  };
  await patchSaleRow(sale.id, {
    shopify_order_id: row.shopify_order_id || tagSync.orderGid || null,
    metadata,
  });
  await insertEvent({
    saleId: sale.id,
    eventType: "manual_note",
    actor: actor || { operatorName: input.operatorName || null },
    idempotencyKey: `supplier-sale:${sale.id}:no-payment-reminder-tag:${Date.now()}`,
    payload: {
      tag_value: tagValue,
      status: tagSync.status,
      error: tagSync.error,
    },
  });

  return {
    sale: await getSupplierSale(sale.id),
    tag: {
      status: tagSync.status,
      tagValue,
      error: tagSync.error,
    },
  };
}

function paymentReminderWebhookUrl() {
  return nullableText(process.env.SUPPLIER_PAYMENT_REMINDER_WEBHOOK_URL || process.env.N8N_SUPPLIER_PAYMENT_REMINDER_WEBHOOK_URL, 1000);
}

function buildPaymentReminderKey(input: {
  saleId: string;
  recipientEmail: string;
  paymentLink: string | null;
  message: string | null;
  idempotencyKey?: string | null;
  now?: Date;
}) {
  const explicit = nullableText(input.idempotencyKey, 260);
  if (explicit) return explicit;
  const date = (input.now || new Date()).toISOString().slice(0, 10);
  return `supplier-sale:${input.saleId}:payment-reminder:${hashPayload({
    date,
    recipient_email: input.recipientEmail,
    payment_link: input.paymentLink || "",
    message: input.message || "",
  })}`;
}

async function reserveSupplierPaymentReminder(input: {
  saleId: string;
  reminderKey: string;
  requestedBy: string | null;
  recipientEmail: string;
  paymentLink: string | null;
  message: string | null;
}) {
  try {
    await supabaseRequest("supplier_payment_reminders", {
      method: "POST",
      body: JSON.stringify({
        sale_id: input.saleId,
        reminder_key: input.reminderKey,
        status: "pending",
        requested_by: input.requestedBy,
        recipient_email: input.recipientEmail,
        payment_link: input.paymentLink,
        metadata: {
          message: input.message,
          webhook_configured: Boolean(paymentReminderWebhookUrl()),
        },
      }),
      headers: { Prefer: "return=minimal" },
    });
    return true;
  } catch (error) {
    if (error instanceof SupabaseRestError && error.status === 409) return false;
    throw error;
  }
}

async function sendPaymentReminderWebhook(input: {
  sale: SupplierSale;
  recipientEmail: string;
  paymentLink: string | null;
  message: string | null;
  reminderKey: string;
}) {
  const url = paymentReminderWebhookUrl();
  if (!url) return { status: "skipped" as const, providerMessageId: null, error: "Payment-Reminder-Webhook ist nicht konfiguriert." };
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.json().catch(() => null) as JsonRecord | null;
  if (!response.ok) return { status: "failed" as const, providerMessageId: null, error: `Reminder-Webhook HTTP ${response.status}` };
  return {
    status: "sent" as const,
    providerMessageId: recordString(body || {}, ["providerMessageId", "messageId", "id"], 260),
    error: null,
  };
}

export async function requestSupplierPaymentReminder(input: SupplierPaymentReminderInput, actor?: SupplierSaleActor | null) {
  const sale = await getSupplierSale(input.saleId);
  const saleRow = await fetchSaleRowById(sale.id);
  const recipientEmail = lowerNullable(input.recipientEmail || sale.customerEmail, 260);
  if (!recipientEmail) throw new QuoteValidationError("Empfaenger-E-Mail fehlt.", ["Empfaenger-E-Mail fehlt."], 422);
  const paymentLink = nullableText(input.paymentLink, 1000)
    || nullableText(sale.latestEvent?.payload?.payment_link, 1000)
    || nullableText(saleRow?.metadata?.payment_link, 1000)
    || sale.shopifyOrderUrl;
  const message = nullableText(input.message, 2000);
  const requestedBy = nullableText(input.requestedBy || input.operatorName || actor?.operatorName, 120);
  const reminderKey = buildPaymentReminderKey({
    saleId: sale.id,
    recipientEmail,
    paymentLink,
    message,
    idempotencyKey: input.idempotencyKey,
  });
  const reserved = await reserveSupplierPaymentReminder({
    saleId: sale.id,
    reminderKey,
    requestedBy,
    recipientEmail,
    paymentLink,
    message,
  });
  if (!reserved) return getSupplierSale(sale.id);

  const webhook = await sendPaymentReminderWebhook({
    sale,
    recipientEmail,
    paymentLink,
    message,
    reminderKey,
  });

  await supabaseRequest("supplier_payment_reminders", {
    method: "PATCH",
    body: JSON.stringify({
      status: webhook.status,
      provider_message_id: webhook.providerMessageId,
      error: webhook.error,
      metadata: {
        message,
        webhook_configured: Boolean(paymentReminderWebhookUrl()),
      },
      sent_at: webhook.status === "sent" ? new Date().toISOString() : null,
    }),
    headers: { Prefer: "return=minimal" },
  }, {
    reminder_key: `eq.${reminderKey}`,
  });

  const updated = await patchSaleRow(sale.id, {
    last_payment_reminder_at: new Date().toISOString(),
    payment_reminder_count: sale.paymentReminderCount + 1,
    payment_decision_status: sale.paymentDecisionStatus === "paid_confirmed" ? "paid_confirmed" : "wait_for_payment",
    assignment_status: sale.assignmentStatus === "assigned" ? "assigned" : "payment_open",
  });

  if (webhook.status === "skipped") {
    await createOpsInternalTask({
      title: `Zahlungserinnerung vorbereiten: ${sale.shopifyOrderName || sale.offerNumber || sale.saleKey}`,
      description: [
        `Kunde: ${sale.customerName || "-"}`,
        `E-Mail: ${recipientEmail}`,
        paymentLink ? `Bezahl-Link: ${paymentLink}` : "Bezahl-Link fehlt.",
        `Sale: ${sale.id}`,
      ].join("\n"),
      category: "admin",
      priority: "normal",
      assigneeLabel: nullableText(process.env.SUPPLIER_PAYMENT_TASK_ASSIGNEE, 120) || "Fabienne",
      requestId: sale.requestId,
      customerName: sale.customerName,
      customerEmail: recipientEmail,
      sourceApp: "supplier_sales",
      sourceRef: `supplier_payment_reminder:${sale.id}`,
      metadata: { supplier_sale_id: sale.id, reminder_key: reminderKey },
    }, actor || undefined).catch(() => null);
  }

  await insertEvent({
    saleId: sale.id,
    eventType: "payment_reminder_requested",
    actor: actor || { operatorName: input.operatorName || null },
    idempotencyKey: reminderKey,
    payload: { recipient_email: recipientEmail, payment_link: paymentLink, status: webhook.status },
  });

  return mapSale(updated, sale.items, sale.latestEvent);
}
