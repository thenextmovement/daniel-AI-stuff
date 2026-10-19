import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import {
  DUNNING_CASE_STATE_LABELS,
  type DunningCaseState,
} from "@/lib/ops/dunning-status";
import {
  dunningCourtNextAction,
  loadDunningCourtEvents,
  loadDunningCourtProfile,
  loadLatestDunningCourtDraftJob,
  type DunningCourtDraftJob,
  type DunningCourtEvent,
  type DunningCourtProfile,
} from "@/lib/ops/dunning-court";
import {
  buildDunningInsolvencyIdentity,
  dunningInsolvencyIdentityHash,
  loadLatestDunningInsolvencyChecks,
  type DunningInsolvencyCheck,
  type DunningInsolvencyIdentity,
} from "@/lib/ops/dunning-insolvency";

export type DunningSource = "legacy" | "t099" | "mixed" | "open_order";
export { DUNNING_CASE_STATE_LABELS } from "@/lib/ops/dunning-status";
export type { DunningCaseState } from "@/lib/ops/dunning-status";

type ShopifyOrderRow = {
  shopify_order_id: string;
  name: string;
  financial_status: string | null;
  fulfillment_status: string | null;
  total_price: number | string | null;
  total_outstanding: number | string | null;
  currency: string | null;
  email: string | null;
  kunde: string | null;
  kunde_email: string | null;
  tags: string | null;
  created_at: string | null;
  cancelled_at: string | null;
  ingested_at: string | null;
  ship_address: Record<string, unknown> | null;
  bill_address: Record<string, unknown> | null;
  phone: string | null;
  shopify_updated_at?: string | null;
  test?: boolean;
};

type QontoPaymentCreditRow = {
  id?: string;
  reference?: string | null;
  counterparty_name?: string | null;
  transaction_id: string;
  amount: number | string | null;
  currency: string | null;
  reference_digits: string | null;
  settled_at: string | null;
  ingested_at: string | null;
};

type ReviewedPayment = {
  shopifyOrderId: string;
  grossCents: number;
  allocatedCents: number;
  remainingCents: number;
  note: string;
  observedAt: string;
};

type DunningShipmentRow = {
  id: string;
  shopify_order_id: string | null;
  shopify_order_number: string | null;
  shopify_fulfillment_id: string | null;
  carrier: string;
  tracking_number: string | null;
  tracking_url: string | null;
  status: string;
  status_reason: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  last_event_at: string | null;
  last_carrier_sync_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type DunningStatusRow = {
  shopify_order_number: string;
  mahnstufe: number | null;
  last_sent_at: string | null;
  next_due_at: string | null;
  paused: boolean | null;
  note: string | null;
  updated_by: string | null;
  updated_at: string | null;
  pause_mode?: "manual" | "until_date" | null;
  pause_until?: string | null;
  pause_reason?: string | null;
  paused_at?: string | null;
  paused_by?: string | null;
  pause_version?: number | null;
};

type DunningLogRow = {
  id: number;
  created_at: string;
  action: string | null;
  shopify_order_number: string;
  mahnstufe: number | null;
  actor: string | null;
};

type DunningPauseEventRow = {
  id: string;
  shopify_order_number: string;
  action: "pause" | "resume" | "auto_resume";
  actor: string;
  reason: string;
  pause_mode: "manual" | "until_date" | null;
  pause_until: string | null;
  previous_paused: boolean;
  new_paused: boolean;
  previous_pause_version: number;
  new_pause_version: number;
  previous_note: string | null;
  created_at: string;
};

type DunningSendlogRow = {
  id: number;
  sent_at: string;
  shopify_order_number: string;
  mahnstufe: number | null;
  lang: string | null;
  email: string | null;
  kunde: string | null;
  betrag: string | null;
  subject: string | null;
  actor: string | null;
  status: string | null;
};

type T099LockRow = {
  request_id: string;
  locked_at: string | null;
  message_id: string | null;
  internet_message_id: string | null;
  conversation_id: string | null;
  status: string | null;
  attempt_count: number | null;
  lease_until: string | null;
  last_error: string | null;
  updated_at: string | null;
};

type WorkflowAuditRow = {
  id: string;
  document_id: string | null;
  workflow_name: string;
  action: string;
  status: string;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type CustomerEmailRow = {
  id: string;
  message_id: string;
  internet_message_id: string | null;
  conversation_id: string | null;
  direction: string | null;
  from_email: string | null;
  from_name: string | null;
  to_emails: string[] | null;
  cc_emails: string[] | null;
  bcc_emails: string[] | null;
  subject: string | null;
  body_preview: string | null;
  received_at: string | null;
  sent_at: string | null;
  message_created_at: string | null;
  source: string | null;
  created_at: string | null;
};

type HistoricalContinuation = {
  schema: "dunning.historical.candidate.v1";
  stage_model: "current_6" | "legacy_4";
  correspondence_review?: { audit_id: string; reviewed_at: string; outcome: string } | null;
  cycle_prefix: string;
  cycle_id: string;
  anchor: { stage: number; sent_at: string; message_id: string; internet_message_id: string; conversation_id: string } | null;
};
type T099Candidate = {
  continuation?: HistoricalContinuation;
  automation_blocker?: string;
  source_fresh?: boolean;
  shopify_order_id?: string;
  shopify_order_gid?: string;
  shopify_order_name?: string;
  shopify_order_created_at?: string;
  shopify_email_hint?: string;
  shopify_company_hint?: string;
  easybill_company_hint?: string;
  easybill_document_id?: string | number;
  easybill_invoice_number?: string;
  easybill_customer_id?: string | number;
  easybill_document_created_at?: string;
  easybill_due_date?: string;
  amount_due_cents?: number;
  payment_received_cents?: number;
  currency?: string;
  preliminary_only?: boolean;
};

export type DunningShipment = {
  id: string;
  shopifyFulfillmentId: string | null;
  carrier: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: string;
  statusReason: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  lastEventAt: string | null;
  lastCarrierSyncAt: string | null;
  deliveryEvidence:
    "carrier_confirmed" | "tracking_only" | "shipment_record_only";
};

export type DunningNextActionKind =
  "customer_email" | "manual_review" | "court_review" | "none";

export type DunningTimelineEntry = {
  id: string;
  occurredAt: string;
  kind:
    | "order"
    | "due"
    | "stage"
    | "email"
    | "reply"
    | "evidence"
    | "status"
    | "court";
  title: string;
  detail: string | null;
  source: string;
  direction: "inbound" | "outbound" | "internal";
  stage: number | null;
  status: string | null;
};

export type DunningCaseSummary = {
  key: string;
  orderNumber: string;
  shopifyOrderId: string | null;
  customerName: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  hasPhone: boolean;
  amountCents: number;
  orderTotalCents: number;
  currency: string;
  financialStatus: string;
  bankPaymentsCents: number;
  reviewedPaymentCents: number;
  paymentReviewNote: string | null;
  lastBankPaymentAt: string | null;
  fulfillmentStatus: string;
  orderCreatedAt: string | null;
  invoiceDate: string | null;
  orderAgeDays: number | null;
  dueDate: string | null;
  daysOverdue: number | null;
  currentStage: number;
  currentStageLabel: string;
  nextStage: number | null;
  nextStageLabel: string | null;
  scheduledAt: string | null;
  lastSentAt: string | null;
  lastActivityAt: string | null;
  nextActionAt: string | null;
  nextActionKind: DunningNextActionKind;
  paymentException: boolean;
  paymentExceptionTag: string | null;
  lastContactAt: string | null;
  nextDueAt: string | null;
  paused: boolean;
  pauseMode: "manual" | "until_date" | null;
  pauseUntil: string | null;
  pauseNote: string | null;
  pausedAt: string | null;
  pausedBy: string | null;
  pauseVersion: number;
  pauseUpdatedAt: string | null;
  pauseSnapshotHash: string;
  stopTag: boolean;
  customerReplied: boolean;
  lastReplyAt: string | null;
  hasEmail: boolean;
  preliminaryOnly: boolean;
  source: DunningSource;
  sourceLabel: string;
  state: DunningCaseState;
  stateLabel: string;
  sendEligible: boolean;
  blockers: string[];
  primaryBlocker: string | null;
  nextActionLabel: string;
  finalReminderSentAt: string | null;
  legalReviewDueAt: string | null;
  legalReviewReady: boolean;
  finalReminderWaiting: boolean;
  courtReview: boolean;
  shipments: DunningShipment[];
  hasTracking: boolean;
  carrierDeliveryConfirmed: boolean;
  insolvencyIdentity: DunningInsolvencyIdentity;
  insolvencyCheck: DunningInsolvencyCheck | null;
  courtEvents: DunningCourtEvent[];
  courtEvent: DunningCourtEvent | null;
  easybillDocumentId: string | null;
  easybillInvoiceNumber: string | null;
  shopifyUrl: string | null;
  easybillUrl: string | null;
};

export type DunningDashboard = {
  generatedAt: string;
  sourceHealth: {
    intakeObservedAt: string | null;
    intakeFreshUntil: string | null;
    intakeComplete: boolean;
    intakeFresh: boolean;
    historicalFresh?: boolean;
    historicalObservedAt?: string | null;
    candidateCount: number;
    legacyUpdatedAt: string | null;
    shopifyLive: boolean;
    shopifyObservedAt: string | null;
    bankObservedAt: string | null;
    bankFresh: boolean;
    bankComplete: boolean;
    bankCount: number;
    shopifyMirrorFresh: boolean;
    shopifyMirrorCount: number;
  };
  sendConfigured: boolean;
  stats: {
    total: number;
    open: number;
    actionRequired: number;
    replies: number;
    paused: number;
    finalReminderWaiting: number;
    courtReview: number;
    dataIssues: number;
    totalOutstandingCents: number;
  };
  cases: DunningCaseSummary[];
};

export type DunningCaseDetail = {
  case: DunningCaseSummary;
  timeline: DunningTimelineEntry[];
  courtProfile: DunningCourtProfile | null;
  courtDraftJob: DunningCourtDraftJob | null;
  generatedAt: string;
};

export type DunningActionPreview = {
  orderNumber: string;
  shopifyOrderId: string;
  currentStage: number;
  nextStage: number;
  nextStageLabel: string;
  scheduledAt: string | null;
  recipient: string;
  amountCents: number;
  currency: string;
  easybillInvoiceNumber: string | null;
  attachmentRequired: boolean;
  confirmationPhrase: string;
  blockers: string[];
  allowed: boolean;
  snapshotHash: string;
};

const T099_PREFIX =
  "e936881a-fe32-4d94-aa1d-eaffcf4a75be:T099:PAYMENT_COLLECTION:";
const CURRENT_STAGE_LABELS: Record<number, string> = {
  0: "Noch keine Nachricht",
  1: "Kurze Rückfrage",
  2: "Freundliche Erinnerung",
  3: "Letzte freundliche Erinnerung",
  4: "1. Mahnung",
  5: "2. Mahnung",
  6: "3. und letzte Mahnung",
  7: "Gerichtliche Prüfung",
};

function cleanText(value: unknown, max = 300) {
  const text = String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, max) : null;
}

function normalizeEmail(value: unknown) {
  const email = cleanText(value, 254)?.toLowerCase() || "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizedDunningTags(value: unknown) {
  return (Array.isArray(value) ? value : String(value || "").split(","))
    .map((tag) =>
      String(tag || "")
        .normalize("NFKC")
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase("de-DE"),
    )
    .filter(Boolean);
}

export function dunningPaymentExceptionTag(value: unknown) {
  const tags = normalizedDunningTags(value);
  if (tags.includes("warten auf zahlung")) return "WARTEN AUF ZAHLUNG";
  if (tags.includes("warten auf za")) return "WARTEN AUF ZA";
  return null;
}

export function normalizeDunningOrderNumber(value: unknown) {
  const raw = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/^#+/, "");
  const match = raw.match(/^NEONT?(\d{1,12})$/);
  return match ? `#NEONT${match[1]}` : null;
}

export function dunningOrderKey(value: unknown) {
  return normalizeDunningOrderNumber(value)?.slice(1) || null;
}

export function dunningStageLabel(stage: number, source?: DunningSource) {
  if (source === "legacy" && stage === 4)
    return "Letzte Mahnung vor Inkasso (Altbestand)";
  if (source === "legacy" && stage > 4)
    return `Mahnstufe ${stage} (Altbestand)`;
  return CURRENT_STAGE_LABELS[stage] || `Mahnstufe ${stage}`;
}

function numericCents(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number * 100)) : 0;
}

function parseLegacyAmountCents(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const normalized = raw
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.max(0, Math.round(number * 100)) : 0;
}

function validIso(value: unknown) {
  const raw = cleanText(value, 80);
  return raw && Number.isFinite(Date.parse(raw))
    ? new Date(raw).toISOString()
    : null;
}

function latestIso(...values: Array<unknown>) {
  const valid = values
    .flat()
    .map(validIso)
    .filter((value): value is string => Boolean(value));
  return (
    valid.sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null
  );
}

function addressText(address: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = cleanText(address?.[key], 180);
    if (value) return value;
  }
  return null;
}

function addressCompany(order: ShopifyOrderRow | null) {
  return (
    addressText(order?.bill_address || null, [
      "company",
      "company_name",
      "companyName",
      "contactCompany",
    ]) ||
    addressText(order?.ship_address || null, [
      "company",
      "company_name",
      "companyName",
      "contactCompany",
    ])
  );
}

function addressName(order: ShopifyOrderRow | null) {
  const billing = order?.bill_address || null;
  const shipping = order?.ship_address || null;
  const direct =
    addressText(billing, ["name", "full_name", "fullName"]) ||
    addressText(shipping, ["name", "full_name", "fullName"]);
  if (direct) return direct;
  const first =
    addressText(billing, ["first_name", "firstName"]) ||
    addressText(shipping, ["first_name", "firstName"]);
  const last =
    addressText(billing, ["last_name", "lastName"]) ||
    addressText(shipping, ["last_name", "lastName"]);
  return cleanText([first, last].filter(Boolean).join(" "), 180);
}

function addressFirstName(order: ShopifyOrderRow | null) {
  return (
    addressText(order?.bill_address || null, ["first_name", "firstName"]) ||
    addressText(order?.ship_address || null, ["first_name", "firstName"])
  );
}

function addressLastName(order: ShopifyOrderRow | null) {
  return (
    addressText(order?.bill_address || null, ["last_name", "lastName"]) ||
    addressText(order?.ship_address || null, ["last_name", "lastName"])
  );
}

function addressLocality(order: ShopifyOrderRow | null) {
  return (
    addressText(order?.bill_address || null, [
      "city",
      "locality",
      "town",
      "municipality",
    ]) ||
    addressText(order?.ship_address || null, [
      "city",
      "locality",
      "town",
      "municipality",
    ])
  );
}

function parseOrderReferences(subject: string | null) {
  const matches =
    String(subject || "")
      .toUpperCase()
      .match(/#?NEONT\d{1,12}/g) || [];
  return [
    ...new Set(
      matches
        .map(normalizeDunningOrderNumber)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

function t099LockIdentity(requestId: string) {
  const match = requestId.match(
    new RegExp(
      `^${T099_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)(?::C-[A-Za-z0-9-]+)?:S([1-6])$`,
    ),
  );
  return match ? { shopifyOrderId: match[1]!, stage: Number(match[2]) } : null;
}

function sentAtForLock(lock: T099LockRow) {
  if (lock.status !== "draft_created") return null;
  return validIso(lock.lease_until) || validIso(lock.updated_at);
}

function berlinDateTime(value: string) {
  try { return Temporal.Instant.from(value).toZonedDateTimeISO("Europe/Berlin"); } catch { return null; }
}
function plusBerlinDays(value: string, days: number) {
  return berlinDateTime(value)?.add({days}).toInstant().toString({smallestUnit:"millisecond"}) || null;
}
function addBusinessDays(value: string, days: number) {
  let date = berlinDateTime(value);
  if (!date) return null;
  let remaining = Math.max(0, days);
  while (remaining > 0) { date = date.add({days:1}); if (date.dayOfWeek <= 5) remaining -= 1; }
  return date.toInstant().toString({smallestUnit:"millisecond"});
}
function nextBusinessDayOrSame(value: string) {
  let date = berlinDateTime(value);
  if (!date) return null;
  while (date.dayOfWeek > 5) date = date.add({days:1});
  return date.toInstant().toString({smallestUnit:"millisecond"});
}
function atNineBerlinDate(value: string | null, addDays = 0) {
  if (!value) return null;
  try { return Temporal.PlainDate.from(value.slice(0,10)).add({days:addDays}).toZonedDateTime({timeZone:"Europe/Berlin",plainTime:"09:00"}).toInstant().toString({smallestUnit:"millisecond"}); } catch { return null; }
}

export function nextDunningSchedule(input: {
  nextStage: number;
  orderCreatedAt: string | null;
  easybillCreatedAt: string | null;
  dueDate: string | null;
  previousStageSentAt: string | null;
}) {
  const { nextStage } = input;
  if (nextStage < 1 || nextStage > 6) return null;
  if (nextStage === 1) {
    const base = latestIso(input.orderCreatedAt, input.easybillCreatedAt);
    return base ? addBusinessDays(base, 3) : null;
  }
  if (!input.previousStageSentAt) return null;
  if (nextStage === 2 || nextStage === 3)
    return addBusinessDays(input.previousStageSentAt, 4);
  if (nextStage === 4) {
    const orderBoundary = input.orderCreatedAt
      ? nextBusinessDayOrSame(
          plusBerlinDays(input.orderCreatedAt, 14) || "",
        )
      : null;
    const previousBoundary = nextBusinessDayOrSame(
      plusBerlinDays(input.previousStageSentAt, 7) || "",
    );
    const dueBoundary = nextBusinessDayOrSame(
      atNineBerlinDate(input.dueDate, 1) || "",
    );
    return (
      [orderBoundary, previousBoundary, dueBoundary]
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) || null
    );
  }
  return nextBusinessDayOrSame(
    plusBerlinDays(input.previousStageSentAt, 7) || "",
  );
}

function sourceForCase(hasLegacy: boolean, hasT099: boolean): DunningSource {
  if (hasLegacy && hasT099) return "mixed";
  if (hasT099) return "t099";
  if (hasLegacy) return "legacy";
  return "open_order";
}

function sourceLabel(source: DunningSource) {
  if (source === "mixed") return "Altbestand + T099";
  if (source === "t099") return "T099 aktuell";
  if (source === "legacy") return "Altbestand";
  return "Offene Shopify-Bestellung";
}

function isFinanciallyClosed(
  status: string,
  outstandingCents: number,
  cancelledAt: string | null,
) {
  const normalized = status.toLowerCase();
  return (
    Boolean(cancelledAt) ||
    outstandingCents <= 0 ||
    ["paid", "refunded", "voided", "cancelled", "partially_refunded"].includes(
      normalized,
    )
  );
}

function verifiedLockSentAt(
  lock: T099LockRow,
  audits: WorkflowAuditRow[],
  messages: CustomerEmailRow[],
) {
  const identity = t099LockIdentity(lock.request_id);
  const sentAt = sentAtForLock(lock);
  if (
    !identity ||
    !sentAt ||
    !lock.message_id ||
    !lock.internet_message_id ||
    !lock.conversation_id
  )
    return null;
  const message = messages.find((row) => row.message_id === lock.message_id);
  const audit = audits.find(
    (row) =>
      row.action === "customer_stage_sent_verified" &&
      row.status === "sent" &&
      cleanText(row.metadata?.lock_key, 240) === lock.request_id,
  );
  if (!message || !audit) return null;
  const metadata = audit.metadata || {};
  const messageSentAt = validIso(
    message.sent_at || message.message_created_at || message.created_at,
  );
  const auditSentAt = validIso(metadata.sent_at);
  const recipients = Array.isArray(message.to_emails)
    ? message.to_emails.map(normalizeEmail).filter(Boolean)
    : [];
  const liveEvidence =
    metadata.live_evidence && typeof metadata.live_evidence === "object"
      ? (metadata.live_evidence as Record<string, unknown>)
      : {};
  const expectedRecipient = normalizeEmail(
    metadata.recipient || liveEvidence.customer_email,
  );
  const attachmentVerified =
    identity.stage < 4 ||
    (metadata.attachment_verified === true &&
      cleanText(metadata.pdf_sha256, 80) !== null &&
      cleanText(metadata.pdf_sha256, 80) ===
        cleanText(metadata.attachment_content_sha256, 80) &&
      Number(metadata.pdf_bytes) >= 1000);
  const valid =
    message.direction === "outbound" &&
    message.source === "outlook" &&
    message.internet_message_id === lock.internet_message_id &&
    message.conversation_id === lock.conversation_id &&
    cleanText(metadata.provider_message_id, 240) === lock.message_id &&
    cleanText(metadata.provider_internet_message_id, 500) ===
      lock.internet_message_id &&
    cleanText(metadata.provider_conversation_id, 240) ===
      lock.conversation_id &&
    Number(metadata.stage) === identity.stage &&
    messageSentAt !== null &&
    Date.parse(messageSentAt) === Date.parse(sentAt) &&
    auditSentAt !== null &&
    Date.parse(auditSentAt) === Date.parse(sentAt) &&
    recipients.length === 1 &&
    expectedRecipient !== null &&
    recipients[0] === expectedRecipient &&
    (!message.cc_emails || message.cc_emails.length === 0) &&
    (!message.bcc_emails || message.bcc_emails.length === 0) &&
    attachmentVerified;
  return valid ? sentAt : null;
}

function stageFromLocks(
  locks: T099LockRow[],
  audits: WorkflowAuditRow[],
  messages: CustomerEmailRow[],
) {
  return locks.reduce((highest, lock) => {
    const identity = t099LockIdentity(lock.request_id);
    return identity && verifiedLockSentAt(lock, audits, messages)
      ? Math.max(highest, identity.stage)
      : highest;
  }, 0);
}

function lastVerifiedLock(
  locks: T099LockRow[],
  stage: number,
  audits: WorkflowAuditRow[],
  messages: CustomerEmailRow[],
) {
  return (
    locks.find(
      (lock) =>
        t099LockIdentity(lock.request_id)?.stage === stage &&
        verifiedLockSentAt(lock, audits, messages),
    ) || null
  );
}

function daysSince(dateValue: string | null, now: Date) {
  if (!dateValue) return null;
  const time = Date.parse(dateValue);
  if (!Number.isFinite(time)) return null;
  return Math.floor((now.getTime() - time) / 86_400_000);
}

function plusCalendarDays(value: string | null, days: number) {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time + days * 86_400_000).toISOString();
}

function normalizeSearchValue(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("de-DE")
    .replace(/\s+/g, " ")
    .trim();
}

export function dunningCaseMatchesQuery(
  summary: DunningCaseSummary,
  query: string,
) {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) return true;
  const corpus = normalizeSearchValue(
    [
      summary.orderNumber,
      summary.shopifyOrderId,
      summary.easybillInvoiceNumber,
      summary.easybillDocumentId,
      summary.customerName,
      summary.company,
      summary.email,
      summary.phone,
      summary.amountCents / 100,
      ...summary.shipments.flatMap((shipment) => [
        shipment.trackingNumber,
        shipment.carrier,
      ]),
      ...summary.courtEvents.flatMap((event) => [
        event.eventLabel,
        event.occurredOn,
        event.sourceReference,
      ]),
    ]
      .filter((value) => value !== null && value !== undefined)
      .join(" "),
  );
  const phoneDigits = String(summary.phone || "").replace(/\D/g, "");
  return normalizedQuery
    .split(" ")
    .filter(Boolean)
    .every((term) => {
      if (corpus.includes(term)) return true;
      const digits = term.replace(/\D/g, "");
      return digits.length >= 3 && phoneDigits.includes(digits);
    });
}

export function buildDunningCases(input: {
  orders: ShopifyOrderRow[];
  statuses: DunningStatusRow[];
  sendlogs: DunningSendlogRow[];
  locks: T099LockRow[];
  audits: WorkflowAuditRow[];
  messages: CustomerEmailRow[];
  candidates: T099Candidate[];
  intakeFresh: boolean;
  historicalFresh?: boolean;
  mirrorsFresh?: boolean;
  automationExclusions?: ReadonlyMap<string,string>;
  insolvencyChecks?: ReadonlyMap<string, DunningInsolvencyCheck>;
  courtEvents?: ReadonlyMap<string, DunningCourtEvent[]>;
  shipments?: DunningShipmentRow[];
  bankPayments?: QontoPaymentCreditRow[];
  reviewedPayments?: ReadonlyMap<string, ReviewedPayment>;
  now?: Date;
}) {
  const now = input.now || new Date();
  const statusByOrder = new Map(
    input.statuses.map((row) => [
      normalizeDunningOrderNumber(row.shopify_order_number),
      row,
    ]),
  );
  const sendlogsByOrder = new Map<string, DunningSendlogRow[]>();
  for (const row of input.sendlogs) {
    const order = normalizeDunningOrderNumber(row.shopify_order_number);
    if (!order) continue;
    sendlogsByOrder.set(order, [...(sendlogsByOrder.get(order) || []), row]);
  }

  const messagesByOrder = new Map<string, CustomerEmailRow[]>();
  for (const message of input.messages) {
    for (const order of parseOrderReferences(message.subject)) {
      messagesByOrder.set(order, [
        ...(messagesByOrder.get(order) || []),
        message,
      ]);
    }
  }

  const locksByOrderId = new Map<string, T099LockRow[]>();
  for (const lock of input.locks) {
    const identity = t099LockIdentity(lock.request_id);
    if (!identity) continue;
    locksByOrderId.set(identity.shopifyOrderId, [
      ...(locksByOrderId.get(identity.shopifyOrderId) || []),
      lock,
    ]);
  }

  const candidateByOrder = new Map<string, T099Candidate>();
  const candidateById = new Map<string, T099Candidate>();
  for (const candidate of input.candidates) {
    const order = normalizeDunningOrderNumber(candidate.shopify_order_name);
    const id = cleanText(candidate.shopify_order_id, 40);
    if (order) candidateByOrder.set(order, candidate);
    if (id) candidateById.set(id, candidate);
  }

  const shipmentsByOrder = new Map<string, DunningShipmentRow[]>();
  const shipmentsByOrderId = new Map<string, DunningShipmentRow[]>();
  for (const shipment of input.shipments || []) {
    const number = normalizeDunningOrderNumber(shipment.shopify_order_number);
    const id = cleanText(shipment.shopify_order_id, 40);
    if (number)
      shipmentsByOrder.set(number, [
        ...(shipmentsByOrder.get(number) || []),
        shipment,
      ]);
    if (id)
      shipmentsByOrderId.set(id, [
        ...(shipmentsByOrderId.get(id) || []),
        shipment,
      ]);
  }

  const bankPaymentsByOrder = new Map<string, QontoPaymentCreditRow[]>();
  const seenBankIds = new Set<string>();
  for (const payment of input.bankPayments || []) {
    const identity = canonicalBankTransactionId(payment.transaction_id);
    if (!identity || seenBankIds.has(identity)) continue;
    seenBankIds.add(identity);
    const references = [...new Set(
      [...String(payment.reference || "").matchAll(/NEON\s*T?\s*(\d+)(?!\d)/gi)].map(match => match[1]!),
    )];
    if (!references.length && payment.reference_digits) references.push(payment.reference_digits);
    for (const digits of references) bankPaymentsByOrder.set(digits, [
      ...(bankPaymentsByOrder.get(digits) || []), payment,
    ]);
  }

  const orderByNumber = new Map<string, ShopifyOrderRow>();
  const orderById = new Map<string, ShopifyOrderRow>();
  for (const order of input.orders) {
    const number = normalizeDunningOrderNumber(order.name);
    const id = cleanText(order.shopify_order_id, 40);
    if (number) orderByNumber.set(number, order);
    if (id) orderById.set(id, order);
  }

  const allOrderNumbers = new Set<string>();
  for (const order of orderByNumber.keys()) allOrderNumbers.add(order);
  for (const order of statusByOrder.keys())
    if (order) allOrderNumbers.add(order);
  for (const order of sendlogsByOrder.keys()) allOrderNumbers.add(order);
  for (const order of candidateByOrder.keys()) allOrderNumbers.add(order);
  for (const order of input.courtEvents?.keys() || []) {
    const normalized = normalizeDunningOrderNumber(order);
    if (normalized) allOrderNumbers.add(normalized);
  }
  for (const [id, candidate] of candidateById) {
    const number =
      normalizeDunningOrderNumber(candidate.shopify_order_name) ||
      normalizeDunningOrderNumber(orderById.get(id)?.name);
    if (number) allOrderNumbers.add(number);
  }

  const cases: DunningCaseSummary[] = [];
  for (const orderNumber of allOrderNumbers) {
    const candidate = candidateByOrder.get(orderNumber) || null;
    const order =
      orderByNumber.get(orderNumber) ||
      (candidate?.shopify_order_id
        ? orderById.get(String(candidate.shopify_order_id))
        : null) ||
      null;
    const orderId = cleanText(
      order?.shopify_order_id || candidate?.shopify_order_id,
      40,
    );
    if (order?.test === true || /\be2e\b|testbestellung/i.test(
      [order?.tags, order?.kunde, addressText(order?.bill_address || null, ["company"]),
        addressText(order?.ship_address || null, ["company"])].filter(Boolean).join(" "),
    )) continue;
    const statusRow = statusByOrder.get(orderNumber) || null;
    const sendlogs = (sendlogsByOrder.get(orderNumber) || []).sort(
      (a, b) => Date.parse(a.sent_at) - Date.parse(b.sent_at),
    );
    const latestSendlog = sendlogs.at(-1) || null;
    const priorContinuation = input.audits.filter(audit => audit.action === "customer_stage_sent_verified" && audit.status === "sent" && String(audit.document_id) === orderId && recordValue(audit.metadata?.continuation).schema === "dunning.historical.candidate.v1").sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0]?.metadata?.continuation as HistoricalContinuation | undefined;
    const continuation = candidate?.continuation?.schema === "dunning.historical.candidate.v1" ? candidate.continuation : priorContinuation || null;
    const allLocks = orderId ? locksByOrderId.get(orderId) || [] : [];
    const locks = continuation ? allLocks.filter(lock => lock.request_id.startsWith(continuation.cycle_prefix + ":S")) : allLocks;
    const anchor = continuation?.anchor || null;
    const anchorMessage = anchor ? input.messages.find(message => message.message_id === anchor.message_id && message.direction === "outbound" && message.source === "outlook" && message.internet_message_id === anchor.internet_message_id && message.conversation_id === anchor.conversation_id && validIso(message.sent_at) === validIso(anchor.sent_at) && message.to_emails?.length === 1 && normalizeEmail(message.to_emails[0]) === normalizeEmail(candidate?.shopify_email_hint || order?.email) && !(message.cc_emails || []).length && !(message.bcc_emails || []).length) : null;
    const anchorValid = !anchor || Boolean(anchorMessage);
    const endpoint = continuation?.stage_model === "legacy_4" ? 4 : 6;
    const messages = messagesByOrder.get(orderNumber) || [];
    const currentT099Stage = stageFromLocks(
      locks,
      input.audits,
      input.messages,
    );
    // dunning_status also mirrors T099. A verified copy is not legacy evidence.
    const matchesVerifiedT099 = (stage: number, sentAt: string | null) =>
      Boolean(
        validIso(sentAt) &&
          locks.some(
            (lock) =>
              t099LockIdentity(lock.request_id)?.stage === stage &&
              verifiedLockSentAt(lock, input.audits, input.messages) ===
                validIso(sentAt),
          ),
      );
    const legacySendlogs = sendlogs.filter(
      (row) => !matchesVerifiedT099(Number(row.mahnstufe || 0), row.sent_at),
    );
    const projectedStage = Number(statusRow?.mahnstufe || 0);
    const legacyStage = Math.max(
      matchesVerifiedT099(projectedStage, statusRow?.last_sent_at || null)
        ? 0
        : projectedStage,
      ...legacySendlogs.map((row) => Number(row.mahnstufe || 0)),
    );
    const hasLegacy = Boolean(legacyStage > 0 || legacySendlogs.length);
    const hasT099 = Boolean(candidate || locks.length);
    const source = sourceForCase(hasLegacy, hasT099);
    const currentStage = Math.max(currentT099Stage, legacyStage, anchorValid ? anchor?.stage || 0 : 0);
    const stageSourcesConflict =
      continuation ? legacyStage > Math.max(currentT099Stage, anchor?.stage || 0) : hasLegacy && hasT099 && (legacyStage !== currentT099Stage || (legacyStage >= 4 && currentT099Stage > 0));
    const currentStageLabel = stageSourcesConflict
      ? `Mahnstufe ${currentStage} (Zuordnung prüfen)`
      : dunningStageLabel(
          currentStage,
          continuation?.stage_model === "legacy_4" ? "legacy" : continuation || currentT099Stage > 0 ? "t099" : hasLegacy ? "legacy" : source,
        );
    const currentLock = lastVerifiedLock(
      locks,
      currentT099Stage,
      input.audits,
      input.messages,
    );
    const lockSentAt = currentLock
      ? verifiedLockSentAt(currentLock, input.audits, input.messages)
      : null;
    const lastSentAt = latestIso(
      lockSentAt,
      statusRow?.last_sent_at,
      latestSendlog?.sent_at,
    );
    const messageTimes = messages.map(
      (row) =>
        row.received_at ||
        row.sent_at ||
        row.message_created_at ||
        row.created_at,
    );
    const inboundMessages = messages.filter(
      (row) => row.direction === "inbound",
    );
    const outboundMessages = messages.filter(
      (row) => row.direction === "outbound",
    );
    const lastReplyAt = latestIso(
      ...inboundMessages.map(
        (row) => row.received_at || row.sent_at || row.created_at,
      ),
    );
    const lastOutboundAt = latestIso(
      lastSentAt,
      ...outboundMessages.map((row) => row.sent_at || row.created_at),
    );
    const lastContactAt = latestIso(lastReplyAt, lastOutboundAt);
    const replyDecision = (continuation || candidate) ? input.audits.filter(audit => audit.action === "customer_reply_decision" && audit.status === "success" && audit.metadata?.schema === "t268.reply-decision.v1" && String(audit.metadata?.lock_key || "").startsWith(T099_PREFIX + orderId + ":") && Number(audit.metadata?.amount_due_cents) === Number(candidate?.amount_due_cents) && Number(audit.metadata?.payment_received_cents) === Number(candidate?.payment_received_cents || 0)).sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] : undefined;
    const continuedReplyAt = replyDecision?.metadata?.decision === "continue_dunning" ? validIso(replyDecision.metadata.reply_received_at) : null;
    const resolvedInvoiceAt = replyDecision?.metadata?.decision === "continue_dunning" && replyDecision.metadata.resolved_document_request_evidence === true && Array.isArray(replyDecision.metadata.reason_codes) && replyDecision.metadata.reason_codes.includes("document_request_fulfilled") ? validIso(recordValue(replyDecision.metadata.invoice_delivery).sent_at) : null;
    const replyDecisionBlocked = ["stop_dunning", "uncertain"].includes(String(replyDecision?.metadata?.decision));
    const reviewedCorrespondenceAt = continuation?.correspondence_review?.audit_id === "8a19fc8c-1dbf-4bb2-bdbd-2325a04c179c" ? validIso(continuation.correspondence_review.reviewed_at) : null;
    const customerReplied = replyDecisionBlocked || Boolean(
      lastReplyAt && (!reviewedCorrespondenceAt || Date.parse(lastReplyAt) > Date.parse(reviewedCorrespondenceAt)) && (!continuedReplyAt || Date.parse(lastReplyAt) > Date.parse(continuedReplyAt)) &&
      (!lastOutboundAt ||
        Date.parse(lastReplyAt) >= Date.parse(lastOutboundAt)),
    );
    const tags = cleanText(order?.tags, 2000) || "";
    const normalizedTags = normalizedDunningTags(tags);
    const stopTag = normalizedTags.some(tag => /mahnstop|mahn.stop|keine.?mahnung|keine.?zahlungserinnerung|nicht.?mahnen|inkasso|insolven|warten.?auf.?zahlung|mit.*anwalt/i.test(tag));
    const waitingPaymentTag = dunningPaymentExceptionTag(tags);
    const paused = Boolean(statusRow?.paused);
    const pauseMode = ["manual", "until_date"].includes(
      String(statusRow?.pause_mode || ""),
    )
      ? (statusRow?.pause_mode as "manual" | "until_date")
      : null;
    const pauseUntil = validIso(statusRow?.pause_until);
    const pausedAt = validIso(statusRow?.paused_at);
    const pausedBy = cleanText(statusRow?.paused_by, 180);
    const pauseVersion = Number.isSafeInteger(Number(statusRow?.pause_version))
      ? Math.max(0, Number(statusRow?.pause_version))
      : 0;
    const pauseNote = cleanText(
      statusRow?.pause_reason || statusRow?.note,
      500,
    );
    const pauseUpdatedAt = validIso(statusRow?.updated_at);
    const pauseSnapshotHash = createHash("sha256").update(JSON.stringify({ orderNumber, paused, pauseMode, pauseUntil, pauseNote, pausedAt, pausedBy, pauseVersion, pauseUpdatedAt })).digest("hex");
    const email = normalizeEmail(
      candidate?.shopify_email_hint ||
        order?.kunde_email ||
        order?.email ||
        latestSendlog?.email ||
        candidate?.shopify_email_hint,
    );
    const company =
      addressCompany(order) ||
      cleanText(
        candidate?.shopify_company_hint || candidate?.easybill_company_hint,
        180,
      );
    const customerName =
      cleanText(order?.kunde, 180) ||
      addressName(order) ||
      cleanText(latestSendlog?.kunde, 180) ||
      company;
    const insolvencyIdentity = buildDunningInsolvencyIdentity({
      companyName: company,
      firstName: addressFirstName(order),
      lastName: addressLastName(order),
      locality: addressLocality(order),
    });
    const storedInsolvencyCheck =
      input.insolvencyChecks?.get(orderNumber) || null;
    const insolvencyCheck =
      storedInsolvencyCheck?.identityHash ===
      dunningInsolvencyIdentityHash(insolvencyIdentity)
        ? storedInsolvencyCheck
        : null;
    const courtEvents = input.courtEvents?.get(orderNumber) || [];
    const courtEvent = courtEvents[0] || null;
    const orderCreatedAt = validIso(
      order?.created_at || candidate?.shopify_order_created_at,
    );
    const currency = (
      cleanText(candidate?.currency || order?.currency, 3) || "EUR"
    ).toUpperCase();
    const candidateAmount = Number(candidate?.amount_due_cents);
    const candidateAmountCents =
      Number.isSafeInteger(candidateAmount) && candidateAmount > 0
        ? candidateAmount
        : null;
    const shopifyOutstandingCents = order?.shopify_updated_at
      ? numericCents(order.total_outstanding)
      : null;
    const sourceAmountCents =
      shopifyOutstandingCents !== null
        ? candidateAmountCents !== null
          ? Math.min(candidateAmountCents, shopifyOutstandingCents)
          : shopifyOutstandingCents
        : candidateAmountCents ??
          (numericCents(order?.total_outstanding) ||
            parseLegacyAmountCents(latestSendlog?.betrag));
    const orderPayments = (
      bankPaymentsByOrder.get(dunningOrderDigits(orderNumber) || "") || []
    ).filter((payment) => {
      const settledAt = validIso(payment.settled_at);
      const paymentCurrency = (
        cleanText(payment.currency, 3) || "EUR"
      ).toUpperCase();
      return Boolean(
        settledAt &&
          paymentCurrency === currency &&
          (!orderCreatedAt ||
            Date.parse(settledAt) >= Date.parse(orderCreatedAt)),
      );
    });
    const orderTotalCents = numericCents(order?.total_price) || sourceAmountCents;
    const verifiedBankPayments = orderPayments.filter(payment =>
      bankPaymentMatchesOrder(payment, order),
    );
    const matchingBankCents = verifiedBankPayments.reduce(
      (sum, payment) => sum + numericCents(payment.amount), 0,
    );
    // Compare total receipts to the order total; never subtract again from an
    // already reduced Shopify/Easybill balance.
    const bankRemainingCents = matchingBankCents > 0 ? Math.min(sourceAmountCents,
      Math.max(0, orderTotalCents - matchingBankCents)) : sourceAmountCents;
    const bankPaymentsCents = sourceAmountCents - bankRemainingCents;
    const review = input.reviewedPayments?.get(orderNumber);
    const validReview = review && review.shopifyOrderId === orderId &&
      review.grossCents === orderTotalCents &&
      review.allocatedCents > 0 && review.remainingCents >= 0 &&
      review.allocatedCents + review.remainingCents === review.grossCents;
    const amountCents = validReview
      ? Math.min(bankRemainingCents, review.remainingCents)
      : bankRemainingCents;
    const reviewedPaymentCents = bankRemainingCents - amountCents;
    const paymentReviewNote = validReview ? review.note : null;
    const possiblePayment = !validReview && orderPayments.some(payment =>
      !verifiedBankPayments.includes(payment));
    const lastBankPaymentAt = bankPaymentsCents > 0
      ? latestIso(...verifiedBankPayments.map(payment => payment.settled_at))
      : null;
    const sourceFinancialStatus =
      cleanText(order?.financial_status, 60) ||
      (sourceAmountCents > 0 ? "unpaid" : "unknown");
    const financialStatus =
      bankPaymentsCents + reviewedPaymentCents > 0
        ? amountCents > 0
          ? "partially_paid"
          : "paid"
        : sourceFinancialStatus;
    const fulfillmentStatus =
      cleanText(order?.fulfillment_status, 60) || "unknown";
    const closed = isFinanciallyClosed(
      financialStatus,
      amountCents,
      validIso(order?.cancelled_at),
    );
    const paymentException = Boolean(closed && (
      waitingPaymentTag || (numericCents(order?.total_outstanding) > 0 &&
        bankPaymentsCents + reviewedPaymentCents > 0)
    ));
    const displayAmountCents =
      closed && order && bankPaymentsCents + reviewedPaymentCents === 0
        ? numericCents(order.total_outstanding)
        : amountCents;
    const preliminaryOnly = candidate?.preliminary_only === true;
    const shipmentRows = [
      ...(shipmentsByOrder.get(orderNumber) || []),
      ...(orderId ? shipmentsByOrderId.get(orderId) || [] : []),
    ];
    const shipments: DunningShipment[] = [
      ...new Map(shipmentRows.map((row) => [row.id, row])).values(),
    ]
      .sort(
        (left, right) =>
          Date.parse(
            right.delivered_at ||
              right.last_event_at ||
              right.shipped_at ||
              right.updated_at ||
              right.created_at ||
              "1970-01-01",
          ) -
          Date.parse(
            left.delivered_at ||
              left.last_event_at ||
              left.shipped_at ||
              left.updated_at ||
              left.created_at ||
              "1970-01-01",
          ),
      )
      .map((row) => ({
        id: row.id,
        shopifyFulfillmentId: cleanText(row.shopify_fulfillment_id, 80),
        carrier: cleanText(row.carrier, 40) || "unknown",
        trackingNumber: cleanText(row.tracking_number, 120),
        trackingUrl: cleanText(row.tracking_url, 1000),
        status: cleanText(row.status, 60) || "unknown",
        statusReason: cleanText(row.status_reason, 300),
        shippedAt: validIso(row.shipped_at),
        deliveredAt: validIso(row.delivered_at),
        lastEventAt: validIso(row.last_event_at),
        lastCarrierSyncAt: validIso(row.last_carrier_sync_at),
        deliveryEvidence: row.delivered_at
          ? "carrier_confirmed"
          : row.tracking_number
            ? "tracking_only"
            : "shipment_record_only",
      }));
    const dueDate = cleanText(candidate?.easybill_due_date, 20);
    const daysOverdue = daysSince(atNineBerlinDate(dueDate), now);
    const orderAgeDays = daysSince(orderCreatedAt, now);
    const nextStage =
      !closed && candidate && (continuation ? currentStage < endpoint && anchorValid : currentT099Stage < 6) && !stageSourcesConflict
        ? (continuation ? currentStage : currentT099Stage) + 1
        : null;
    const previousStageLock =
      currentT099Stage > 0
        ? lastVerifiedLock(
            locks,
            currentT099Stage,
            input.audits,
            input.messages,
          )
        : null;
    const previousStageSentAt = previousStageLock
      ? verifiedLockSentAt(previousStageLock, input.audits, input.messages)
      : anchorValid ? validIso(anchor?.sent_at) : null;
    let scheduledAt = nextStage
      ? nextDunningSchedule({
          nextStage,
          orderCreatedAt,
          easybillCreatedAt: validIso(candidate?.easybill_document_created_at),
          dueDate,
          previousStageSentAt,
        })
      : null;
    const replyWaitFrom = resolvedInvoiceAt || (continuation ? continuedReplyAt : null);
    if (replyWaitFrom && scheduledAt) {
      const replyEarliest = nextDunningSchedule({ nextStage:1, orderCreatedAt:replyWaitFrom, easybillCreatedAt:replyWaitFrom, dueDate, previousStageSentAt:null });
      if (replyEarliest && Date.parse(replyEarliest) > Date.parse(scheduledAt)) scheduledAt = replyEarliest;
    }
    const nextLockKey = nextStage ? (continuation?.cycle_prefix || T099_PREFIX + orderId) + ":S" + nextStage : null;
    const latestSendBlock = nextLockKey ? input.audits.filter(audit => audit.action === "customer_send_blocked_preclaim" && audit.metadata?.lock_key === nextLockKey).sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] : undefined;
    const replyBlockResolved = replyDecision?.metadata?.policy === "t268.reply-classifier.2026-10-19.v2" && replyDecision.metadata.decision === "continue_dunning" && Number(replyDecision.metadata.confidence) >= 0.9 && replyDecision.metadata.validation_error == null && Array.isArray(replyDecision.metadata.risk_flags) && replyDecision.metadata.risk_flags.length === 0 && Date.parse(replyDecision.created_at) > Date.parse(latestSendBlock?.created_at || "");
    const senderBlockReasons = (Array.isArray(latestSendBlock?.metadata?.reasons) ? latestSendBlock.metadata.reasons.map(String) : []).filter(reason => !(replyBlockResolved && (reason === "CUSTOMER_REPLY_AI_REVIEW_REQUIRED" || (reason === "MANUAL_DUNNING_HOLD" && !paused))));
    const senderBlockLabels: Record<string,string> = {
      QONTO_AMBIGUOUS_POSSIBLE_PAYMENT:"Mögliche Zahlung noch nicht eindeutig zugeordnet",
      QONTO_UNREFLECTED_EXACT_PAYMENT:"Bankzahlung noch nicht in der Abrechnung zugeordnet",
      EXISTING_COMPANY_DOMAIN_PRIOR_PAID:"Bestandskundenschutz: bezahlter Vorauftrag derselben Firma",
      CUSTOMER_REPLY_AI_REVIEW_REQUIRED:"Kundenantwort muss zuerst geprüft werden",
      BILLING_ROUTE_SEND_PROOF_MISSING:"Versand an die Rechnungsadresse noch nicht nachgewiesen",
      BILLING_RECIPIENT_OR_ORDER_EMAIL_CHANGED:"Rechnungsadresse wurde geändert und muss erneut geprüft werden",
      LIVE_STAGE_NOT_DUE:"Wartefrist bis zur nächsten Mahnstufe läuft noch",
      CUSTOMER_REPLY_BEFORE_T268_CUTOVER:"Historische Kundenantwort muss zuerst geprüft werden",
    };
    const senderBlocker = senderBlockReasons.length ? "Versand blockiert: " + senderBlockReasons.map(reason => senderBlockLabels[reason] || reason).join(", ") : null;
    const finalStageReached =
      !stageSourcesConflict && (continuation ? currentStage >= endpoint : legacyStage >= 4 || currentT099Stage >= 6);
    const finalReminderSentAt = finalStageReached ? lastSentAt : null;
    const legalReviewDueAt = plusCalendarDays(finalReminderSentAt, 7);
    const finalReminderWaiting = Boolean(
      !closed &&
      !paused &&
      !stopTag &&
      !customerReplied &&
      finalStageReached &&
      legalReviewDueAt &&
      Date.parse(legalReviewDueAt) > now.getTime(),
    );
    const legalReviewReady = Boolean(
      !closed &&
      !paused &&
      !stopTag &&
      !customerReplied &&
      finalStageReached &&
      legalReviewDueAt &&
      Date.parse(legalReviewDueAt) <= now.getTime(),
    );
    const courtReview = legalReviewReady;
    const automationBlocker = input.automationExclusions?.get(orderNumber) || candidate?.automation_blocker;
    const blockers: string[] = [];
    if (input.mirrorsFresh === false) blockers.push("Bank- oder Shopify-Spiegel nicht vollständig aktuell");
    if (possiblePayment) blockers.push("Mögliche Zahlung noch nicht eindeutig zugeordnet");
    if (senderBlocker) blockers.push(senderBlocker);
    if (automationBlocker) blockers.push(automationBlocker);
    if (!anchorValid) blockers.push("Letzter Versandnachweis für die automatische Fortsetzung fehlt");
    if (paymentException)
      blockers.push(
        waitingPaymentTag ? `Shopify-Ausnahmetag ${waitingPaymentTag} trotz ausgeglichener Forderung` : "Zahlung belegt; Buchungszuordnung erforderlich",
      );
    if (closed) blockers.push("Forderung ist nicht mehr offen");
    if (paused) blockers.push("Mahnwesen ist pausiert");
    if (stopTag) blockers.push("Shopify-Sperrtag ist gesetzt");
    if (customerReplied)
      blockers.push("Neue Kundenantwort muss zuerst geprüft werden");
    if (!email) blockers.push("Gültige Kunden-E-Mail fehlt");
    if (!candidate)
      blockers.push(
        "Nicht im aktuellen Shopify-/Easybill-Live-Kandidatenbestand",
      );
    if (!(input.intakeFresh && input.historicalFresh !== false && candidate?.source_fresh !== false))
      blockers.push("Live-Kandidatenbestand ist nicht frisch");
    if (stageSourcesConflict)
      blockers.push("Alt- und Neuverlauf haben unterschiedliche Mahnstufen");
    if (finalStageReached && !finalReminderSentAt)
      blockers.push("Versanddatum der letzten Mahnung fehlt");
    if (!nextStage)
      blockers.push(
        finalStageReached
          ? "Keine weitere E-Mail-Stufe vorgesehen"
          : "Nächste Mahnstufe ist nicht bestimmbar",
      );
    if (nextStage && !scheduledAt)
      blockers.push("Fälligkeit der nächsten Stufe ist nicht belegbar");
    if (scheduledAt && Date.parse(scheduledAt) > now.getTime())
      blockers.push("Nächste Stufe ist noch nicht fällig");
    const uniqueBlockers = [...new Set(blockers)];
    const sendEligible =
      uniqueBlockers.length === 0 && Boolean(orderId && email && nextStage);
    let state: DunningCaseState = "scheduled";
    if (paymentException) state = "data_issue";
    else if (closed) state = "closed";
    else if (paused || stopTag) state = "paused";
    else if (customerReplied) state = "reply_received";
    else if (legalReviewReady) state = "court_review";
    else if (finalReminderWaiting) state = "final_wait";
    else if (sendEligible) state = "action_required";
    else if (
      !candidate ||
      !email ||
      !(input.intakeFresh && input.historicalFresh !== false && candidate?.source_fresh !== false) ||
      Boolean(automationBlocker || senderBlocker || possiblePayment || input.mirrorsFresh === false) || !anchorValid ||
      !scheduledAt ||
      stageSourcesConflict ||
      finalStageReached
    )
      state = "data_issue";

    const easybillDocumentId = cleanText(candidate?.easybill_document_id, 40);
    const lastActivityAt = latestIso(
      statusRow?.updated_at,
      lastSentAt,
      ...messageTimes,
      ...locks.map((lock) => lock.updated_at),
      ...courtEvents.map((event) => event.createdAt),
      lastBankPaymentAt,
    );
    const phone =
      cleanText(order?.phone, 60) ||
      addressText(order?.bill_address || null, ["phone"]) ||
      addressText(order?.ship_address || null, ["phone"]);
    let nextActionKind: DunningNextActionKind = "manual_review";
    let nextActionAt: string | null = null;
    let nextActionLabel = "Fall prüfen";
    if (paymentException) {
      nextActionLabel = waitingPaymentTag ? `${waitingPaymentTag} prüfen – keine Mahn-E-Mail` : "Zahlung in der Abrechnung zuordnen – keine Mahn-E-Mail";
    } else if (closed) {
      nextActionKind = "none";
      nextActionLabel = "Keine Aktion – Forderung erledigt";
    } else if (paused || stopTag) nextActionLabel = "Pause oder Sperre prüfen";
    else if (customerReplied) nextActionLabel = "Kundenantwort bearbeiten";
    else if (legalReviewReady) {
      nextActionKind = "court_review";
      nextActionAt = legalReviewDueAt;
      nextActionLabel = "Solvenz und Gericht prüfen";
    } else if (finalReminderWaiting) {
      nextActionKind = "court_review";
      nextActionAt = legalReviewDueAt;
      nextActionLabel = "Gerichtsprüfung nach letzter Frist";
    } else if (
      (state === "scheduled" || state === "action_required") &&
      nextStage &&
      scheduledAt
    ) {
      nextActionKind = "customer_email";
      nextActionAt = scheduledAt;
      nextActionLabel = "Automatisch: Stufe " + nextStage + " – " + dunningStageLabel(nextStage, continuation?.stage_model === "legacy_4" ? "legacy" : "t099");
    } else if (uniqueBlockers.length) nextActionLabel = uniqueBlockers[0]!;
    const courtNextAction = dunningCourtNextAction(courtEvent);
    if (
      !paymentException &&
      !closed &&
      !paused &&
      !stopTag &&
      courtNextAction
    ) {
      nextActionKind = "manual_review";
      nextActionAt = null;
      nextActionLabel = courtNextAction;
    }
    const courtEventOccurredAt = validIso(
      courtEvent?.occurredOn || courtEvent?.createdAt,
    );
    const paymentAfterCourtEvent = Boolean(
      courtEventOccurredAt &&
        lastBankPaymentAt &&
        Date.parse(lastBankPaymentAt) > Date.parse(courtEventOccurredAt),
    );
    if (paymentAfterCourtEvent) {
      nextActionKind = "manual_review";
      nextActionAt = null;
      nextActionLabel =
        courtEvent?.eventType === "application_draft_created"
          ? "Mahnantrag nach Teilzahlung neu erstellen"
          : "Gericht über Teilzahlung informieren und Restforderung prüfen";
    }
    if (closed && !paymentException) continue;
    cases.push({
      key: orderNumber.slice(1),
      orderNumber,
      shopifyOrderId: orderId,
      customerName,
      company,
      email,
      phone,
      hasPhone: Boolean(phone),
      amountCents: displayAmountCents,
      orderTotalCents,
      currency,
      financialStatus,
      bankPaymentsCents,
      reviewedPaymentCents,
      paymentReviewNote,
      lastBankPaymentAt,
      fulfillmentStatus,
      orderCreatedAt,
      invoiceDate: validIso(candidate?.easybill_document_created_at),
      orderAgeDays,
      dueDate,
      daysOverdue,
      currentStage,
      currentStageLabel,
      nextStage,
      nextStageLabel: nextStage ? dunningStageLabel(nextStage, continuation?.stage_model === "legacy_4" ? "legacy" : "t099") : null,
      scheduledAt,
      lastSentAt,
      lastActivityAt,
      nextActionAt,
      nextActionKind,
      paymentException,
      paymentExceptionTag: paymentException ? waitingPaymentTag : null,
      lastContactAt,
      nextDueAt: validIso(statusRow?.next_due_at),
      paused,
      pauseMode,
      pauseUntil,
      pauseNote,
      pausedAt,
      pausedBy,
      pauseVersion,
      pauseUpdatedAt,
      pauseSnapshotHash,
      stopTag,
      customerReplied,
      lastReplyAt,
      hasEmail: Boolean(email),
      preliminaryOnly,
      source,
      sourceLabel: sourceLabel(source),
      state,
      stateLabel: DUNNING_CASE_STATE_LABELS[state],
      sendEligible,
      blockers: uniqueBlockers,
      primaryBlocker: uniqueBlockers[0] || null,
      nextActionLabel,
      finalReminderSentAt,
      legalReviewDueAt,
      legalReviewReady,
      finalReminderWaiting,
      courtReview,
      shipments,
      hasTracking: shipments.some((shipment) =>
        Boolean(shipment.trackingNumber),
      ),
      carrierDeliveryConfirmed: shipments.some((shipment) =>
        Boolean(shipment.deliveredAt),
      ),
      insolvencyIdentity,
      insolvencyCheck,
      courtEvents,
      courtEvent,
      easybillDocumentId,
      easybillInvoiceNumber: cleanText(candidate?.easybill_invoice_number, 120),
      shopifyUrl: orderId
        ? `https://admin.shopify.com/store/galaxybuzzdk/orders/${encodeURIComponent(orderId)}`
        : null,
      easybillUrl: easybillDocumentId
        ? `https://c496191.easybill.de/docs/all?document=${encodeURIComponent(easybillDocumentId)}&archive=1`
        : null,
    });
  }

  return cases.sort((left, right) => {
    const priority: Record<DunningCaseState, number> = {
      court_review: 0,
      reply_received: 1,
      action_required: 2,
      data_issue: 3,
      final_wait: 4,
      paused: 5,
      scheduled: 6,
      closed: 7,
    };
    return (
      priority[left.state] - priority[right.state] ||
      (right.daysOverdue ?? -9999) - (left.daysOverdue ?? -9999) ||
      right.amountCents - left.amountCents ||
      left.orderNumber.localeCompare(right.orderNumber)
    );
  });
}

async function pagedRequest<T>(
  path: string,
  query: Record<string, string | number>,
  maxRows = 5000,
) {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const page = await supabaseRequest<T[]>(path, undefined, {
      ...query,
      limit: pageSize,
      offset,
    });
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

export async function loadDunningEmailEvidence(
  query: Record<string, string | number>,
) {
  // A fixed ingestion cutoff and immutable cursor keep concurrent mail imports
  // from shifting pages. Never classify a case from a silently truncated scan.
  const cutoff = new Date().toISOString();
  const rows: CustomerEmailRow[] = [];
  let afterId: string | null = null;
  while (true) {
    const page: CustomerEmailRow[] = await supabaseRequest<CustomerEmailRow[]>(
      "customer_email_messages",
      undefined,
      {
        ...query,
        created_at: `lte.${cutoff}`,
        order: "id.asc",
        limit: 1000,
        ...(afterId ? { id: `gt.${afterId}` } : {}),
      },
    );
    if (!Array.isArray(page))
      throw new Error("Mahnwesen-Mailnachweise unvollständig: ungültige Antwort.");
    for (const row of page) {
      if (typeof row.id !== "string" || !row.id || (afterId && row.id <= afterId))
        throw new Error("Mahnwesen-Mailnachweise unvollständig: Seitenfolge widersprüchlich.");
      afterId = row.id;
      rows.push(row);
    }
    if (page.length < 1000) return rows;
  }
}

function inFilter(values: string[]) {
  return `in.(${values.join(",")})`;
}

export async function loadCompleteMirror<T>(path: string, key: string, select: string) {
  const rows: T[] = [];
  let cursor: string | null = null;
  while (true) {
    const page: T[] = await supabaseRequest<T[]>(path, undefined, {
      select, order: key + ".asc", limit:1000, ...(cursor ? {[key]:"gt." + cursor} : {}),
    });
    if (!Array.isArray(page)) throw new Error("OPS-Spiegel unvollständig: ungültige Antwort.");
    for (const row of page) {
      const id = String((row as Record<string,unknown>)[key] || "");
      if (!id || (cursor && id <= cursor)) throw new Error("OPS-Spiegel unvollständig: widersprüchliche Seitenfolge.");
      cursor = id; rows.push(row);
    }
    if (page.length < 1000) return rows;
  }
}

async function loadRelevantShopifyOrders(
  orderNames: string[],
  orderIds: string[],
) {
  const select =
    "shopify_order_id,name,financial_status,fulfillment_status,total_price,total_outstanding,currency,email,kunde,kunde_email,tags,created_at,cancelled_at,ingested_at,ship_address,bill_address,phone";
  const [rows, audits] = await Promise.all([
    loadCompleteMirror<ShopifyOrderRow>("shopify_orders", "shopify_order_id", select),
    supabaseRequest<WorkflowAuditRow[]>("workflow_audit_log", undefined, {
      select:"id,status,metadata,created_at", action:"eq.ops_source_mirror_verified",
      "metadata->>source":"eq.shopify", order:"created_at.desc", limit:1,
    }),
  ]);
  const requestedNames = new Set(orderNames.map(normalizeDunningOrderNumber));
  const requestedIds = new Set(orderIds);
  const health = mirrorSourceHealth(audits[0], "shopify", rows);
  return {
    orders: health.rows.filter(row => numericCents(row.total_outstanding) > 0 ||
      dunningPaymentExceptionTag(row.tags) || requestedNames.has(normalizeDunningOrderNumber(row.name)) ||
      requestedIds.has(row.shopify_order_id)),
    ...health,
  };
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function shopifyLiveConfig() {
  const token = cleanText(
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
      process.env.SHOPIFY_ADMIN_TOKEN ||
      process.env.SHOPIFY_ADMIN_API_TOKEN ||
      process.env.SHOPIFY_ACCESS_TOKEN,
    500,
  );
  const domain = cleanText(
    process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_STORE_DOMAIN,
    260,
  )
    ?.replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  const version =
    cleanText(process.env.SHOPIFY_ADMIN_API_VERSION, 40) || "2026-01";
  if (!token || domain !== "galaxybuzzdk.myshopify.com") return null;
  return { token, domain, version };
}

function numericShopifyOrderId(value: unknown) {
  const raw = cleanText(value, 260);
  if (!raw) return null;
  const numeric = raw.replace(/^gid:\/\/shopify\/Order\//, "");
  return /^\d+$/.test(numeric) ? numeric : null;
}

function shopifyMoney(value: unknown) {
  const moneyBag = recordValue(value);
  const shopMoney = recordValue(moneyBag.shopMoney);
  const amount = Number(shopMoney.amount);
  return Number.isFinite(amount) ? amount : null;
}

function shopifyAddress(value: unknown) {
  const address = recordValue(value);
  return Object.keys(address).length ? address : null;
}

async function refreshShopifyOrdersLive(
  orders: ShopifyOrderRow[],
  requestedOrderNames: string[] = [],
) {
  const config = shopifyLiveConfig();
  const orderById = new Map(
    orders.flatMap((order) => {
      const id = numericShopifyOrderId(order.shopify_order_id);
      return id ? [[id, order] as const] : [];
    }),
  );
  if (!config)
    return { orders, live: false, observedAt: null as string | null };

  const refreshed = new Map(orderById);
  const matchedIds = new Set<string>();
  const ids = [...orderById.keys()];
  const knownNames = new Set(
    orders
      .map((order) => normalizeDunningOrderNumber(order.name))
      .filter((value): value is string => Boolean(value)),
  );
  const missingNames = [
    ...new Set(
      requestedOrderNames
        .map(normalizeDunningOrderNumber)
        .filter(
          (value): value is string => Boolean(value && !knownNames.has(value)),
        ),
    ),
  ];
  const additionalOrders = new Map<string, ShopifyOrderRow>();
  try {
    for (let index = 0; index < ids.length; index += 100) {
      const chunk = ids.slice(index, index + 100);
      const response = await fetch(
        `https://${config.domain}/admin/api/${config.version}/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": config.token,
          },
          body: JSON.stringify({
            query: `
              query DunningOrdersLive($ids: [ID!]!) {
                nodes(ids: $ids) {
                  ... on Order {
                    id
                    name
                    test
                    email
                    phone
                    tags
                    createdAt
                    updatedAt
                    cancelledAt
                    displayFinancialStatus
                    displayFulfillmentStatus
                    totalPriceSet { shopMoney { amount currencyCode } }
                    totalOutstandingSet { shopMoney { amount currencyCode } }
                    customer { firstName lastName email phone }
                    billingAddress {
                      name company firstName lastName phone
                      address1 address2 city zip country countryCodeV2
                    }
                    shippingAddress {
                      name company firstName lastName phone
                      address1 address2 city zip country countryCodeV2
                    }
                  }
                }
              }
            `,
            variables: {
              ids: chunk.map((id) => `gid://shopify/Order/${id}`),
            },
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      const payload = (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      const graphErrors = arrayValue(payload?.errors);
      if (!response.ok || graphErrors.length)
        throw new Error(
          `Shopify Live-Abgleich fehlgeschlagen (HTTP ${response.status}).`,
        );
      const nodes = arrayValue(recordValue(payload?.data).nodes);
      for (const rawNode of nodes) {
        const node = recordValue(rawNode);
        const id = numericShopifyOrderId(node.id);
        const current = id ? orderById.get(id) : null;
        if (!id || !current) continue;
        const totalPrice = shopifyMoney(node.totalPriceSet);
        const outstanding = shopifyMoney(node.totalOutstandingSet);
        const price = recordValue(recordValue(node.totalPriceSet).shopMoney);
        const customer = recordValue(node.customer);
        const customerName = cleanText(
          [customer.firstName, customer.lastName].filter(Boolean).join(" "),
          180,
        );
        const customerEmail = cleanText(customer.email, 320);
        const updatedAt = validIso(node.updatedAt);
        if (totalPrice === null || outstanding === null || !updatedAt || typeof node.test !== "boolean")
          throw new Error("Shopify Live-Abgleich: Zahlungsdaten fehlen.");
        matchedIds.add(id);
        refreshed.set(id, {
          ...current,
          test: node.test === true,
          name: cleanText(node.name, 80) || current.name,
          financial_status:
            cleanText(node.displayFinancialStatus, 60)?.toLowerCase() ||
            current.financial_status,
          fulfillment_status:
            cleanText(node.displayFulfillmentStatus, 60)?.toLowerCase() ||
            current.fulfillment_status,
          total_price: totalPrice ?? current.total_price,
          total_outstanding: outstanding ?? current.total_outstanding,
          currency: cleanText(price.currencyCode, 3) || current.currency,
          email: cleanText(node.email, 320) || current.email,
          kunde: customerName || current.kunde,
          kunde_email:
            customerEmail || cleanText(node.email, 320) || current.kunde_email,
          tags: arrayValue(node.tags)
            .map((tag) => cleanText(tag, 200))
            .filter(Boolean)
            .join(", "),
          created_at: validIso(node.createdAt) || current.created_at,
          cancelled_at: validIso(node.cancelledAt),
          ship_address:
            shopifyAddress(node.shippingAddress) || current.ship_address,
          bill_address:
            shopifyAddress(node.billingAddress) || current.bill_address,
          phone:
            cleanText(node.phone, 60) ||
            cleanText(customer.phone, 60) ||
            current.phone,
          shopify_updated_at: updatedAt,
        });
      }
    }
    for (const orderName of missingNames) {
      const response = await fetch(
        `https://${config.domain}/admin/api/${config.version}/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": config.token,
          },
          body: JSON.stringify({
            query: `
              query DunningOrderByName($query: String!) {
                orders(first: 5, query: $query) {
                  nodes {
                    id
                    name
                    test
                    email
                    phone
                    tags
                    createdAt
                    updatedAt
                    cancelledAt
                    displayFinancialStatus
                    displayFulfillmentStatus
                    totalPriceSet { shopMoney { amount currencyCode } }
                    totalOutstandingSet { shopMoney { amount currencyCode } }
                    customer { firstName lastName email phone }
                    billingAddress {
                      name company firstName lastName phone
                      address1 address2 city zip country countryCodeV2
                    }
                    shippingAddress {
                      name company firstName lastName phone
                      address1 address2 city zip country countryCodeV2
                    }
                  }
                }
              }
            `,
            variables: { query: `name:${orderName.replace(/^#/, "")} OR name:${orderName.replace(/^#NEONT/, "NEON")}` },
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      const payload = (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      const graphErrors = arrayValue(payload?.errors);
      if (!response.ok || graphErrors.length)
        throw new Error(
          `Shopify Live-Abgleich fehlgeschlagen (HTTP ${response.status}).`,
        );
      const nodes = arrayValue(
        recordValue(recordValue(payload?.data).orders).nodes,
      );
      const node = recordValue(
        nodes.find(
          (entry) =>
            normalizeDunningOrderNumber(recordValue(entry).name) === orderName,
        ),
      );
      const id = numericShopifyOrderId(node.id);
      if (!id) continue;
      const totalPrice = shopifyMoney(node.totalPriceSet);
      const outstanding = shopifyMoney(node.totalOutstandingSet);
      const price = recordValue(recordValue(node.totalPriceSet).shopMoney);
      const customer = recordValue(node.customer);
      const customerName = cleanText(
        [customer.firstName, customer.lastName].filter(Boolean).join(" "),
        180,
      );
      const customerEmail = cleanText(customer.email, 320);
      const updatedAt = validIso(node.updatedAt);
      if (totalPrice === null || outstanding === null || !updatedAt || typeof node.test !== "boolean")
        throw new Error("Shopify Live-Abgleich: Zahlungsdaten fehlen.");
      additionalOrders.set(id, {
        shopify_order_id: id,
        test: node.test === true,
        name: cleanText(node.name, 80) || orderName,
        financial_status:
          cleanText(node.displayFinancialStatus, 60)?.toLowerCase() || null,
        fulfillment_status:
          cleanText(node.displayFulfillmentStatus, 60)?.toLowerCase() || null,
        total_price: totalPrice,
        total_outstanding: outstanding,
        currency: cleanText(price.currencyCode, 3),
        email: cleanText(node.email, 320),
        kunde: customerName,
        kunde_email: customerEmail || cleanText(node.email, 320),
        tags: arrayValue(node.tags)
          .map((tag) => cleanText(tag, 200))
          .filter(Boolean)
          .join(", "),
        created_at: validIso(node.createdAt),
        cancelled_at: validIso(node.cancelledAt),
        ingested_at: null,
        ship_address: shopifyAddress(node.shippingAddress),
        bill_address: shopifyAddress(node.billingAddress),
        phone:
          cleanText(node.phone, 60) || cleanText(customer.phone, 60) || null,
        shopify_updated_at: updatedAt,
      });
    }
  } catch (error) {
    console.warn("dunning Shopify live refresh unavailable", {
      message:
        error instanceof Error
          ? error.message
          : "Shopify Live-Abgleich fehlgeschlagen.",
    });
    return { orders, live: false, observedAt: null as string | null };
  }

  return {
    orders: [
      ...orders.map((order) => {
        const id = numericShopifyOrderId(order.shopify_order_id);
        return (id && refreshed.get(id)) || order;
      }),
      ...additionalOrders.values(),
    ],
    live:
      matchedIds.size === orderById.size &&
      additionalOrders.size === missingNames.length,
    observedAt: new Date().toISOString(),
  };
}

function dunningOrderDigits(orderNumber: string) {
  return (
    normalizeDunningOrderNumber(orderNumber)?.match(/NEONT(\d+)$/)?.[1] || null
  );
}

export function canonicalBankTransactionId(value: unknown) {
  const raw = cleanText(value, 300)?.toLowerCase() || "";
  const suffix = raw.match(/transaction-([a-z0-9-]+)$/i)?.[1] || raw;
  const hex = suffix.replace(/-/g, "");
  return /^[a-f0-9]{32}$/.test(hex) ? hex : suffix;
}

function bankPaymentMatchesOrder(payment: QontoPaymentCreditRow, order?: ShopifyOrderRow | null) {
  if (!order) return false;
  const references = [...new Set([...String(payment.reference || "").matchAll(
    /NEON\s*T?\s*(\d+)(?!\d)/gi,
  )].map(match => match[1]))];
  // Collective and differently referenced payments require the reviewed
  // allocation from the daily reconciliation, not a guessed split.
  if (references.length > 1) return false;
  const normalize = (value: unknown) => String(value || "").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(gmbh|ggmbh|kg|ag|ug|co|mbh)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
  const payer = normalize(payment.counterparty_name);
  const identities = [order.kunde, ...[order.bill_address, order.ship_address].flatMap(address => {
    const a = address || {};
    return [a.company, a.name, [a.first_name || a.firstName, a.last_name || a.lastName].filter(Boolean).join(" ")];
  })].map(normalize).filter(value => value.length >= 4);
  return payer.length >= 4 && identities.includes(payer);
}

export function mirrorSourceHealth<T extends {ingested_at: string | null}>(audit: WorkflowAuditRow | undefined,
  source: "bank" | "shopify", rows: T[], now = new Date()) {
  const meta = audit?.metadata;
  const observedAt = validIso(meta?.observed_at);
  const verifiedAt = validIso(meta?.verified_at);
  const count = Number(meta?.source_count);
  // Retained historical rows are not part of the provider's verified snapshot.
  // A partial newer write still fails the exact count/timestamp checks.
  const currentRows = observedAt ? rows.filter(row => validIso(row.ingested_at) === observedAt) : [];
  const complete = Boolean(audit?.status === "success" &&
    meta?.schema === "ops.source-mirror.v1" && meta?.source === source &&
    meta?.source_complete === true && Number.isSafeInteger(count) && count > 0 &&
    count === currentRows.length && meta?.written_count === count && observedAt && verifiedAt &&
    Date.parse(verifiedAt) >= Date.parse(observedAt) &&
    rows.every(row => {
      const ingestedAt = validIso(row.ingested_at);
      return ingestedAt && Date.parse(ingestedAt) <= Date.parse(observedAt);
    }));
  const fresh = Boolean(complete && observedAt && verifiedAt &&
    Date.parse(verifiedAt) <= now.getTime() &&
    now.getTime() - Date.parse(observedAt) <= 45 * 60_000);
  return {complete, fresh, observedAt, count: currentRows.length, rows: complete ? currentRows : rows};
}

async function loadBankMirror() {
  const [payments, audits] = await Promise.all([
    loadCompleteMirror<QontoPaymentCreditRow & {side: string; status: string}>(
      "qonto_transactions", "id",
      "id,transaction_id,amount,currency,reference,reference_digits,counterparty_name,settled_at,ingested_at,side,status"),
    supabaseRequest<WorkflowAuditRow[]>("workflow_audit_log", undefined, {
      select:"id,status,metadata,created_at", action:"eq.ops_source_mirror_verified",
      "metadata->>source":"eq.bank", order:"created_at.desc", limit:1,
    }),
  ]);
  const health = mirrorSourceHealth(audits[0], "bank", payments);
  return {
    payments: health.rows.filter(row => row.side === "credit" && row.status === "completed"),
    ...health,
  };
}

async function loadRelevantShippingShipments(
  orderNames: string[],
  orderIds: string[],
) {
  const select =
    "id,shopify_order_id,shopify_order_number,shopify_fulfillment_id,carrier,tracking_number,tracking_url,status,status_reason,shipped_at,delivered_at,last_event_at,last_carrier_sync_at,created_at,updated_at";
  const rows: DunningShipmentRow[] = [];
  const names = [
    ...new Set(
      orderNames.flatMap((name) => {
        const normalized = normalizeDunningOrderNumber(name);
        return normalized ? [normalized, normalized.slice(1)] : [];
      }),
    ),
  ];
  for (let index = 0; index < names.length; index += 80) {
    const chunk = names.slice(index, index + 80);
    rows.push(
      ...(await supabaseRequest<DunningShipmentRow[]>(
        "shipping_shipments",
        undefined,
        { select, shopify_order_number: inFilter(chunk), limit: 1000 },
      )),
    );
  }
  for (let index = 0; index < orderIds.length; index += 80) {
    const chunk = orderIds.slice(index, index + 80);
    rows.push(
      ...(await supabaseRequest<DunningShipmentRow[]>(
        "shipping_shipments",
        undefined,
        { select, shopify_order_id: inFilter(chunk), limit: 1000 },
      )),
    );
  }
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

function dunningSendConfigured() {
  if (
    String(process.env.DUNNING_MANUAL_SEND_ENABLED || "").toLowerCase() !==
    "true"
  )
    return false;
  const url = cleanText(process.env.DUNNING_MANUAL_SEND_WEBHOOK_URL, 1000);
  const secret = cleanText(process.env.DUNNING_MANUAL_SEND_WEBHOOK_SECRET, 500);
  if (!url || !secret) return false;
  try {
    const parsed = new URL(url);
    const allowedHosts = String(
      process.env.DUNNING_MANUAL_SEND_ALLOWED_HOSTS || "fuajob.online",
    )
      .split(/[\s,;]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    return (
      parsed.protocol === "https:" &&
      allowedHosts.includes(parsed.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export async function listDunningDashboard(): Promise<DunningDashboard> {
  const [
    statuses,
    sendlogs,
    locks,
    latestIntakeAudits,
    senderAudits,
    inboundMessages,
    senderMessages,
    insolvencyChecks,
    courtEvents,
    historicalAudits,
  ] = await Promise.all([
    supabaseRequest<DunningStatusRow[]>("dunning_status", undefined, {
      select:
        "shopify_order_number,mahnstufe,last_sent_at,next_due_at,paused,note,updated_by,updated_at,pause_mode,pause_until,pause_reason,paused_at,paused_by,pause_version",
      order: "updated_at.desc",
      limit: 1000,
    }),
    supabaseRequest<DunningSendlogRow[]>("mahn_sendlog", undefined, {
      select:
        "id,sent_at,shopify_order_number,mahnstufe,lang,email,kunde,betrag,subject,actor,status",
      order: "sent_at.asc",
      limit: 1000,
    }),
    pagedRequest<T099LockRow>("email_locks", {
      select:
        "request_id,locked_at,message_id,internet_message_id,conversation_id,status,attempt_count,lease_until,last_error,updated_at",
      request_id: `like.${T099_PREFIX}*`,
      order: "updated_at.asc",
    }),
    supabaseRequest<WorkflowAuditRow[]>("workflow_audit_log", undefined, {
      select:
        "id,document_id,workflow_name,action,status,error_message,metadata,created_at",
      workflow_name: "eq.TICKET-099 Existing Ledger Intake",
      action: "eq.future_candidate_snapshot",
      order: "created_at.desc",
      limit: 1,
    }),
    pagedRequest<WorkflowAuditRow>("workflow_audit_log", {
      select:
        "id,document_id,workflow_name,action,status,error_message,metadata,created_at",
      workflow_name: "eq.TICKET-099 Existing Ledger Sender",
      action: "in.(customer_stage_sent_verified,customer_send_blocked_preclaim,customer_reply_decision)",
      order: "created_at.asc",
    }),
    loadDunningEmailEvidence({
      select:
        "id,message_id,internet_message_id,conversation_id,direction,from_email,from_name,to_emails,cc_emails,bcc_emails,subject,body_preview,received_at,sent_at,message_created_at,source,created_at",
      subject: "ilike.*NEONT*",
    }),
    loadDunningEmailEvidence({
      select:
        "id,message_id,internet_message_id,conversation_id,direction,from_email,from_name,to_emails,cc_emails,bcc_emails,subject,body_preview,received_at,sent_at,message_created_at,source,created_at",
      direction: "eq.outbound",
      source: "eq.outlook",
      sent_at: "gte.2026-08-05T15:30:00.000Z",
    }),
    loadLatestDunningInsolvencyChecks(),
    loadDunningCourtEvents(),
    supabaseRequest<WorkflowAuditRow[]>("workflow_audit_log", undefined, {
      select:"id,action,status,metadata,created_at",
      action:"eq.daily_35_day_dunning_audit", order:"created_at.desc", limit:1,
    }),
  ]);

  const latestAudit = latestIntakeAudits[0] || null;
  const metadata = latestAudit?.metadata || {};
  const normalCandidates = Array.isArray(metadata.candidates)
    ? (metadata.candidates as T099Candidate[])
    : [];
  const historicalAudit = historicalAudits[0];
  const historical = recordValue(historicalAudit?.metadata?.continuation);
  const historicalValid = historicalAudit?.status === "success" && historical.schema === "dunning.historical.snapshot.v1" && Boolean(validIso(historical.observed_at)) && Boolean(validIso(historical.fresh_until)) && Date.parse(String(historical.fresh_until)) - Date.parse(String(historical.observed_at)) === 26 * 3600000 && Date.parse(String(historical.observed_at)) <= Date.now();
  const historicalFresh = historicalValid && Date.parse(String(historical.fresh_until)) >= Date.now();
  const historicalCandidates = historicalValid && Array.isArray(historical.candidates) ? (historical.candidates as T099Candidate[]).map(candidate => ({...candidate, source_fresh:historicalFresh})) : [];
  const historicalIds = new Set(historicalCandidates.map(candidate => candidate.shopify_order_id));
  const exclusionLabels: Record<string,string> = {
    BILLING_ROUTE_REVIEW_REQUIRED:"Rechnungsroute vor Folgemahnung klären; kein Versand",
    CORRESPONDENCE_REVIEW_HOLD:"Kundenkorrespondenz erfordert Klärung; kein Versand",
    PAYMENT_RECORDING_REQUIRED:"Zahlungszuordnung erforderlich; kein Versand",
    payment_recording_required:"Zahlung belegt; Buchungszuordnung erforderlich",
    payment_data_conflict:"Widersprüchliche Zahlungsdaten; kein Versand",
    PAYMENT_OR_AMOUNT_MISMATCH:"Zahlung oder Restbetrag stimmen nicht überein",
    HISTORICAL_SEND_PROOF_MISSING:"Historischer Versandnachweis fehlt; keine automatische Fortsetzung",
    REVIEWED_SEND_PROOF_INCOMPLETE:"Versandnachweis der Erinnerung unvollständig",
    DOCUMENT_NOT_UNIQUE:"Offener Rechnungsbeleg ist nicht eindeutig",
    DOCUMENT_CHANGED_SINCE_REMINDER:"Beleg seit letzter Erinnerung geändert; Zuordnung prüfen",
    sender_blocked:"Automatischer Versand blockiert; letzten Prüfgrund prüfen",
  };
  const exclusions = historicalValid && Array.isArray(historical.excluded) ? historical.excluded as Array<{order:string;reason:string}> : [];
  const candidates: T099Candidate[] = [...normalCandidates.filter(candidate => !historicalIds.has(candidate.shopify_order_id)),...historicalCandidates].map(candidate => {
    const exclusion = exclusions.find(row => row.order === candidate.shopify_order_name && row.reason !== "REGULAR_INTAKE");
    return exclusion ? {...candidate,automation_blocker:exclusionLabels[exclusion.reason] || "Automatik ausgeschlossen: " + exclusion.reason} : candidate;
  });
  const intakeObservedAt = validIso(metadata.observed_at);
  const intakeFreshUntil = validIso(metadata.fresh_until);
  const intakeComplete =
    latestAudit?.status === "success" && metadata.source_complete === true;
  const intakeFresh = Boolean(
    intakeComplete &&
    intakeFreshUntil &&
    Date.parse(intakeFreshUntil) >= Date.now(),
  );
  const orderNames = [
    ...new Set(
      [
        ...statuses.map((row) =>
          normalizeDunningOrderNumber(row.shopify_order_number),
        ),
        ...sendlogs.map((row) =>
          normalizeDunningOrderNumber(row.shopify_order_number),
        ),
        ...candidates.map((row) =>
          normalizeDunningOrderNumber(row.shopify_order_name),
        ),
        ...courtEvents.keys(),
      ].filter((value): value is string => Boolean(value)),
    ),
  ];
  const orderIds = [
    ...new Set(
      [
        ...candidates.map((row) => cleanText(row.shopify_order_id, 40)),
        ...locks.map(
          (row) => t099LockIdentity(row.request_id)?.shopifyOrderId || null,
        ),
      ].filter((value): value is string => Boolean(value)),
    ),
  ];
  const mirroredOrders = await loadRelevantShopifyOrders(
    orderNames,
    orderIds,
  );
  const shopifyRefresh = await refreshShopifyOrdersLive(
    mirroredOrders.orders,
    orderNames,
  );
  const orders = shopifyRefresh.orders;
  const shipmentOrderNames = [
    ...new Set(
      orders
        .map((order) => normalizeDunningOrderNumber(order.name))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const shipmentOrderIds = [
    ...new Set(
      orders
        .map((order) => cleanText(order.shopify_order_id, 40))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const [shipments, bankPaymentRefresh] = await Promise.all([
    loadRelevantShippingShipments(shipmentOrderNames, shipmentOrderIds),
    loadBankMirror(),
  ]);
  const messages = [
    ...new Map(
      [...inboundMessages, ...senderMessages].map((row) => [row.id, row]),
    ).values(),
  ];
  const reviewedPayments = new Map<string, ReviewedPayment>();
  if (historicalFresh && Array.isArray(historicalAudit?.metadata?.cases)) {
    for (const raw of historicalAudit.metadata.cases) {
      const row = recordValue(raw), number = normalizeDunningOrderNumber(row.order);
      const amounts = [row.gross_cents, row.allocated_cents, row.remaining_cents];
      if (!number || !amounts.every(value => Number.isSafeInteger(value) && Number(value) >= 0)) continue;
      reviewedPayments.set(number, {
        shopifyOrderId:String(row.shopify_order_id), grossCents:Number(row.gross_cents),
        allocatedCents:Number(row.allocated_cents), remainingCents:Number(row.remaining_cents),
        note:cleanText(row.note, 2000) || "Zahlung im Gesamtabgleich nachgewiesen",
        observedAt:String(historical.observed_at),
      });
    }
  }
  const cases = buildDunningCases({
    orders,
    statuses,
    sendlogs,
    locks,
    audits: senderAudits,
    messages,
    candidates,
    intakeFresh,
    historicalFresh,
    mirrorsFresh: mirroredOrders.fresh && bankPaymentRefresh.fresh && shopifyRefresh.live,
    automationExclusions: new Map(exclusions.filter(row => !["REGULAR_INTAKE","final_stage_review","held","cancelled","test"].includes(row.reason)).map(row => [row.order, exclusionLabels[row.reason] || "Automatik ausgeschlossen: " + row.reason])),
    insolvencyChecks,
    courtEvents,
    shipments,
    bankPayments: bankPaymentRefresh.payments,
    reviewedPayments,
  });
  const openCases = cases.filter((entry) => !entry.paymentException);
  return {
    generatedAt: new Date().toISOString(),
    sourceHealth: {
      intakeObservedAt,
      intakeFreshUntil,
      intakeComplete,
      intakeFresh,
      historicalFresh,
      historicalObservedAt: validIso(historical.observed_at),
      candidateCount: candidates.length,
      legacyUpdatedAt: latestIso(...statuses.map((row) => row.updated_at)),
      shopifyLive: shopifyRefresh.live,
      shopifyObservedAt: shopifyRefresh.observedAt,
      bankObservedAt: bankPaymentRefresh.observedAt,
      bankFresh: bankPaymentRefresh.fresh,
      bankComplete: bankPaymentRefresh.complete,
      bankCount: bankPaymentRefresh.count,
      shopifyMirrorFresh: mirroredOrders.fresh,
      shopifyMirrorCount: mirroredOrders.count,
    },
    sendConfigured: dunningSendConfigured(),
    stats: {
      total: cases.length,
      open: openCases.length,
      actionRequired: cases.filter((entry) => entry.state === "action_required")
        .length,
      replies: cases.filter((entry) => entry.state === "reply_received").length,
      paused: cases.filter((entry) => entry.state === "paused").length,
      finalReminderWaiting: cases.filter(
        (entry) => entry.state === "final_wait",
      ).length,
      courtReview: cases.filter((entry) => entry.courtReview).length,
      dataIssues: cases.filter((entry) => entry.state === "data_issue").length,
      totalOutstandingCents: openCases.reduce(
        (sum, entry) => sum + entry.amountCents,
        0,
      ),
    },
    cases,
  };
}

function timelineFromCase(summary: DunningCaseSummary) {
  const entries: DunningTimelineEntry[] = [];
  if (summary.orderCreatedAt)
    entries.push({
      id: `order:${summary.key}`,
      occurredAt: summary.orderCreatedAt,
      kind: "order",
      title: "Bestellung angelegt",
      detail: summary.orderNumber,
      source: "Shopify",
      direction: "internal",
      stage: null,
      status: summary.financialStatus,
    });
  if (summary.dueDate) {
    const occurredAt = atNineBerlinDate(summary.dueDate);
    if (occurredAt)
      entries.push({
        id: `due:${summary.key}`,
        occurredAt,
        kind: "due",
        title: "Rechnung fällig",
        detail: summary.easybillInvoiceNumber,
        source: "Easybill",
        direction: "internal",
        stage: null,
        status: "due",
      });
  }
  for (const shipment of summary.shipments) {
    const trackingDetail = [
      shipment.carrier.toUpperCase(),
      shipment.trackingNumber,
    ]
      .filter(Boolean)
      .join(" · ");
    if (shipment.shippedAt)
      entries.push({
        id: `shipment:${shipment.id}:shipped`,
        occurredAt: shipment.shippedAt,
        kind: "status",
        title: "Sendung an Carrier übergeben",
        detail: trackingDetail || null,
        source: "Versandakte",
        direction: "internal",
        stage: null,
        status: shipment.status,
      });
    if (shipment.deliveredAt)
      entries.push({
        id: `shipment:${shipment.id}:delivered`,
        occurredAt: shipment.deliveredAt,
        kind: "evidence",
        title: "Zustellung im Carrier-Tracking bestätigt",
        detail: trackingDetail || null,
        source: "Versandakte",
        direction: "internal",
        stage: null,
        status: "delivered",
      });
  }
  if (summary.lastBankPaymentAt && summary.bankPaymentsCents > 0)
    entries.push({
      id: `bank-payment:${summary.key}:${summary.lastBankPaymentAt}`,
      occurredAt: summary.lastBankPaymentAt,
      kind: "evidence",
      title: "Bankzahlung berücksichtigt",
      detail: `${(summary.bankPaymentsCents / 100).toFixed(2)} ${summary.currency} · noch nicht in Shopify verbucht`,
      source: "Qonto",
      direction: "internal",
      stage: null,
      status: "completed",
    });
  if (summary.legalReviewDueAt)
    entries.push({
      id: `legal-review:${summary.key}`,
      occurredAt: summary.legalReviewDueAt,
      kind: "status",
      title: summary.legalReviewReady
        ? "Solvenz-/Gerichtsprüfung fällig"
        : "Solvenz-/Gerichtsprüfung vorgesehen",
      detail:
        "Sieben Tage nach der nachgewiesenen letzten Mahnung und nur bei weiterhin offener Forderung.",
      source: "Mahnwesen",
      direction: "internal",
      stage: 7,
      status: summary.legalReviewReady ? "due" : "scheduled",
    });
  if (summary.insolvencyCheck?.checkedAt)
    entries.push({
      id: `insolvency-check:${summary.insolvencyCheck.id}`,
      occurredAt: summary.insolvencyCheck.checkedAt,
      kind: "evidence",
      title: summary.insolvencyCheck.resultLabel,
      detail:
        summary.insolvencyCheck.resultCode === "no_public_notice_found"
          ? "Kein Treffer ist kein Nachweis der Zahlungsfähigkeit."
          : summary.insolvencyCheck.matchCount
            ? `${summary.insolvencyCheck.matchCount} amtliche Veröffentlichung(en)`
            : null,
      source: summary.insolvencyCheck.sourceLabel,
      direction: "internal",
      stage: 7,
      status: summary.insolvencyCheck.resultCode,
    });
  for (const event of summary.courtEvents) {
    const occurredAt = atNineBerlinDate(event.occurredOn);
    if (!occurredAt) continue;
    entries.push({
      id: "court:" + event.id,
      occurredAt,
      kind: "court",
      title: event.eventLabel,
      detail:
        [event.note, event.sourceReference]
          .filter(Boolean)
          .join(" · ") || null,
      source: "Gerichtliches Mahnverfahren",
      direction: "internal",
      stage: 7,
      status: event.eventType,
    });
  }
  return entries;
}

export async function getDunningCaseDetail(
  orderKey: string,
): Promise<DunningCaseDetail | null> {
  const normalized = normalizeDunningOrderNumber(orderKey);
  if (!normalized) return null;
  const dashboard = await listDunningDashboard();
  const summary = dashboard.cases.find(
    (entry) => entry.orderNumber === normalized,
  );
  if (!summary) return null;
  const [
    logs,
    pauseEvents,
    sendlogs,
    messages,
    locks,
    audits,
    courtProfile,
    courtDraftJob,
  ] = await Promise.all([
    supabaseRequest<DunningLogRow[]>("dunning_log", undefined, {
      select: "id,created_at,action,shopify_order_number,mahnstufe,actor",
      shopify_order_number: `eq.${normalized}`,
      order: "created_at.asc",
      limit: 1000,
    }),
    supabaseRequest<DunningPauseEventRow[]>("dunning_pause_events", undefined, {
      select:
        "id,shopify_order_number,action,actor,reason,pause_mode,pause_until,previous_paused,new_paused,previous_pause_version,new_pause_version,previous_note,created_at",
      shopify_order_number: `eq.${normalized}`,
      order: "created_at.asc",
      limit: 1000,
    }),
    supabaseRequest<DunningSendlogRow[]>("mahn_sendlog", undefined, {
      select:
        "id,sent_at,shopify_order_number,mahnstufe,lang,email,kunde,betrag,subject,actor,status",
      shopify_order_number: `eq.${normalized}`,
      order: "sent_at.asc",
      limit: 1000,
    }),
    loadDunningEmailEvidence({
      select:
        "id,message_id,internet_message_id,conversation_id,direction,from_email,from_name,to_emails,cc_emails,bcc_emails,subject,body_preview,received_at,sent_at,message_created_at,source,created_at",
      subject: `ilike.*${normalized.slice(1)}*`,
    }),
    summary.shopifyOrderId
      ? supabaseRequest<T099LockRow[]>("email_locks", undefined, {
          select:
            "request_id,locked_at,message_id,internet_message_id,conversation_id,status,attempt_count,lease_until,last_error,updated_at",
          request_id: `like.${T099_PREFIX}${summary.shopifyOrderId}:S*`,
          order: "updated_at.asc",
          limit: 1000,
        })
      : Promise.resolve([]),
    summary.shopifyOrderId
      ? supabaseRequest<WorkflowAuditRow[]>("workflow_audit_log", undefined, {
          select:
            "id,document_id,workflow_name,action,status,error_message,metadata,created_at",
          workflow_name: "eq.TICKET-099 Existing Ledger Sender",
          "metadata->>lock_key": `like.${T099_PREFIX}${summary.shopifyOrderId}:S*`,
          order: "created_at.asc",
          limit: 1000,
        })
      : Promise.resolve([]),
    loadDunningCourtProfile(normalized),
    loadLatestDunningCourtDraftJob(normalized),
  ]);

  const timeline = timelineFromCase(summary);
  for (const row of logs)
    timeline.push({
      id: `legacy-log:${row.id}`,
      occurredAt: row.created_at,
      kind: "status",
      title:
        row.action === "set"
          ? `Mahnstufe ${row.mahnstufe ?? 0} gesetzt`
          : cleanText(row.action, 120) || "Mahnstatus geändert",
      detail: row.actor ? `Durch ${row.actor}` : null,
      source: "Altbestand",
      direction: "internal",
      stage: row.mahnstufe,
      status: row.action,
    });
  for (const event of pauseEvents)
    timeline.push({
      id: `pause:${event.id}`,
      occurredAt: event.created_at,
      kind: "status",
      title:
        event.action === "pause"
          ? "Mahnprozess pausiert"
          : event.action === "auto_resume"
            ? "Mahnprozess zur Wiedervorlage freigegeben"
            : "Mahnprozess fortgesetzt",
      detail: [
        event.reason,
        event.pause_until
          ? `Wiedervorlage ${new Date(event.pause_until).toLocaleString("de-DE")}`
          : null,
        `Durch ${event.actor}`,
      ]
        .filter(Boolean)
        .join(" · "),
      source: "Mahnwesen-Steuerung",
      direction: "internal",
      stage: summary.currentStage,
      status: event.action,
    });
  for (const row of sendlogs)
    timeline.push({
      id: `legacy-send:${row.id}`,
      occurredAt: row.sent_at,
      kind: "stage",
      title:
        cleanText(row.subject, 220) ||
        dunningStageLabel(Number(row.mahnstufe || 0), "legacy"),
      detail: [row.email, row.status].filter(Boolean).join(" - ") || null,
      source: "Mahn-Sendelog",
      direction: "outbound",
      stage: row.mahnstufe,
      status: row.status,
    });
  for (const row of messages) {
    const occurredAt = validIso(
      row.received_at ||
        row.sent_at ||
        row.message_created_at ||
        row.created_at,
    );
    if (!occurredAt) continue;
    const inbound = row.direction === "inbound";
    timeline.push({
      id: `mail:${row.id}`,
      occurredAt,
      kind: inbound ? "reply" : "email",
      title:
        cleanText(row.subject, 220) ||
        (inbound ? "Kundenantwort" : "E-Mail versendet"),
      detail: cleanText(row.body_preview, 500),
      source: row.source || "Outlook",
      direction: inbound ? "inbound" : "outbound",
      stage: null,
      status: row.direction,
    });
  }
  for (const lock of locks) {
    const identity = t099LockIdentity(lock.request_id);
    const occurredAt = sentAtForLock(lock) || validIso(lock.updated_at);
    if (!identity || !occurredAt) continue;
    timeline.push({
      id: `lock:${lock.request_id}`,
      occurredAt,
      kind: "evidence",
      title: `${dunningStageLabel(identity.stage, "t099")} technisch belegt`,
      detail:
        lock.last_error ||
        (lock.message_id
          ? "Outlook-Nachweis und Einmal-Sperre vorhanden"
          : "Einmal-Sperre vorhanden"),
      source: "T099 Versandnachweis",
      direction: "internal",
      stage: identity.stage,
      status: lock.status,
    });
  }
  for (const audit of audits)
    timeline.push({
      id: `audit:${audit.id}`,
      occurredAt: audit.created_at,
      kind: "evidence",
      title:
        audit.action === "customer_stage_sent_verified"
          ? "Versand vollständig verifiziert"
          : "Versandprüfung blockiert",
      detail: audit.error_message,
      source: "T099 Audit",
      direction: "internal",
      stage: Number(audit.metadata?.stage || 0) || null,
      status: audit.status,
    });
  const deduped = [
    ...new Map(timeline.map((entry) => [entry.id, entry])).values(),
  ].sort(
    (left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
  );
  return {
    case: summary,
    timeline: deduped,
    courtProfile,
    courtDraftJob,
    generatedAt: dashboard.generatedAt,
  };
}

export function createDunningActionPreview(
  summary: DunningCaseSummary,
): DunningActionPreview | null {
  if (!summary.shopifyOrderId || !summary.nextStage || !summary.email)
    return null;
  const confirmationPhrase = `MAHNSTUFE ${summary.nextStage} SENDEN ${summary.orderNumber}`;
  const snapshotSource = JSON.stringify({
    order: summary.orderNumber,
    id: summary.shopifyOrderId,
    stage: summary.nextStage,
    amount: summary.amountCents,
    recipient: summary.email,
    scheduledAt: summary.scheduledAt,
  });
  return {
    orderNumber: summary.orderNumber,
    shopifyOrderId: summary.shopifyOrderId,
    currentStage: summary.currentStage,
    nextStage: summary.nextStage,
    nextStageLabel:
      summary.nextStageLabel || dunningStageLabel(summary.nextStage, "t099"),
    scheduledAt: summary.scheduledAt,
    recipient: summary.email,
    amountCents: summary.amountCents,
    currency: summary.currency,
    easybillInvoiceNumber: summary.easybillInvoiceNumber,
    attachmentRequired: summary.nextStage >= 4,
    confirmationPhrase,
    blockers: summary.blockers,
    allowed: summary.sendEligible,
    snapshotHash: createHash("sha256").update(snapshotSource).digest("hex"),
  };
}

export async function requestDunningStageSend(input: {
  preview: DunningActionPreview;
  actor: string;
  idempotencyKey: string;
  note?: string | null;
}) {
  if (!input.preview.allowed) throw new Error("DUNNING_SEND_BLOCKED");
  if (!dunningSendConfigured()) throw new Error("DUNNING_SEND_NOT_ENABLED");
  const url = new URL(String(process.env.DUNNING_MANUAL_SEND_WEBHOOK_URL));
  const allowedHosts = String(
    process.env.DUNNING_MANUAL_SEND_ALLOWED_HOSTS || "fuajob.online",
  )
    .split(/[\s,;]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (
    url.protocol !== "https:" ||
    !allowedHosts.includes(url.hostname.toLowerCase())
  )
    throw new Error("DUNNING_WEBHOOK_NOT_ALLOWED");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${String(process.env.DUNNING_MANUAL_SEND_WEBHOOK_SECRET || "")}`,
        "X-Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        schema: "neontrip.ops.dunning.manual-stage.v1",
        shopifyOrderId: input.preview.shopifyOrderId,
        shopifyOrderName: input.preview.orderNumber,
        expectedStage: input.preview.nextStage,
        expectedSnapshotHash: input.preview.snapshotHash,
        requestedBy: input.actor,
        idempotencyKey: input.idempotencyKey,
        note: cleanText(input.note, 500),
      }),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    const text = (await response.text()).slice(0, 12_000);
    let body: Record<string, unknown> = {};
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      body = {};
    }
    if (!response.ok || body.ok === false)
      throw new Error(
        response.status === 409
          ? "DUNNING_DUPLICATE_OR_STALE"
          : "DUNNING_WEBHOOK_FAILED",
      );
    return {
      accepted: true,
      status: response.status,
      workflowExecutionId: cleanText(
        body.executionId || body.workflowExecutionId,
        120,
      ),
    };
  } finally {
    clearTimeout(timeout);
  }
}
