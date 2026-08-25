import { createHash } from "node:crypto";
import { supabaseRequest } from "@/lib/quotes/supabase-rest";

export type DunningSource = "legacy" | "t099" | "mixed" | "open_order";
export type DunningCaseState =
  | "action_required"
  | "scheduled"
  | "reply_received"
  | "paused"
  | "court_review"
  | "data_issue"
  | "closed";

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
};

type DunningLogRow = {
  id: number;
  created_at: string;
  action: string | null;
  shopify_order_number: string;
  mahnstufe: number | null;
  actor: string | null;
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

type T099Candidate = {
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
  currency?: string;
  preliminary_only?: boolean;
};

export type DunningTimelineEntry = {
  id: string;
  occurredAt: string;
  kind: "order" | "due" | "stage" | "email" | "reply" | "evidence" | "status";
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
  amountCents: number;
  orderTotalCents: number;
  currency: string;
  financialStatus: string;
  fulfillmentStatus: string;
  orderCreatedAt: string | null;
  dueDate: string | null;
  daysOverdue: number | null;
  currentStage: number;
  currentStageLabel: string;
  nextStage: number | null;
  nextStageLabel: string | null;
  scheduledAt: string | null;
  lastSentAt: string | null;
  lastActivityAt: string | null;
  nextDueAt: string | null;
  paused: boolean;
  pauseNote: string | null;
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
  courtReview: boolean;
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
    candidateCount: number;
    legacyUpdatedAt: string | null;
  };
  sendConfigured: boolean;
  stats: {
    total: number;
    open: number;
    actionRequired: number;
    replies: number;
    paused: number;
    courtReview: number;
    dataIssues: number;
    totalOutstandingCents: number;
  };
  cases: DunningCaseSummary[];
};

export type DunningCaseDetail = {
  case: DunningCaseSummary;
  timeline: DunningTimelineEntry[];
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

const T099_PREFIX = "e936881a-fe32-4d94-aa1d-eaffcf4a75be:T099:PAYMENT_COLLECTION:";
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

const STATE_LABELS: Record<DunningCaseState, string> = {
  action_required: "Aktion fällig",
  scheduled: "Termin geplant",
  reply_received: "Antwort prüfen",
  paused: "Pausiert",
  court_review: "Gericht prüfen",
  data_issue: "Daten prüfen",
  closed: "Erledigt",
};

function cleanText(value: unknown, max = 300) {
  const text = String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

function normalizeEmail(value: unknown) {
  const email = cleanText(value, 254)?.toLowerCase() || "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function normalizeDunningOrderNumber(value: unknown) {
  const raw = String(value ?? "").normalize("NFKC").trim().toUpperCase().replace(/^#+/, "");
  if (!/^NEONT\d{1,12}$/.test(raw)) return null;
  return `#${raw}`;
}

export function dunningOrderKey(value: unknown) {
  return normalizeDunningOrderNumber(value)?.slice(1) || null;
}

export function dunningStageLabel(stage: number, source?: DunningSource) {
  if (source === "legacy" && stage === 4) return "Letzte Mahnung vor Inkasso (Altbestand)";
  return CURRENT_STAGE_LABELS[stage] || `Mahnstufe ${stage}`;
}

function numericCents(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number * 100)) : 0;
}

function parseLegacyAmountCents(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const normalized = raw.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.max(0, Math.round(number * 100)) : 0;
}

function validIso(value: unknown) {
  const raw = cleanText(value, 80);
  return raw && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : null;
}

function latestIso(...values: Array<unknown>) {
  const valid = values.flat().map(validIso).filter((value): value is string => Boolean(value));
  return valid.sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;
}

function addressText(address: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = cleanText(address?.[key], 180);
    if (value) return value;
  }
  return null;
}

function addressCompany(order: ShopifyOrderRow | null) {
  return addressText(order?.bill_address || null, ["company", "company_name", "companyName", "contactCompany"])
    || addressText(order?.ship_address || null, ["company", "company_name", "companyName", "contactCompany"]);
}

function addressName(order: ShopifyOrderRow | null) {
  const billing = order?.bill_address || null;
  const shipping = order?.ship_address || null;
  const direct = addressText(billing, ["name", "full_name", "fullName"]) || addressText(shipping, ["name", "full_name", "fullName"]);
  if (direct) return direct;
  const first = addressText(billing, ["first_name", "firstName"]) || addressText(shipping, ["first_name", "firstName"]);
  const last = addressText(billing, ["last_name", "lastName"]) || addressText(shipping, ["last_name", "lastName"]);
  return cleanText([first, last].filter(Boolean).join(" "), 180);
}

function parseOrderReferences(subject: string | null) {
  const matches = String(subject || "").toUpperCase().match(/#?NEONT\d{1,12}/g) || [];
  return [...new Set(matches.map(normalizeDunningOrderNumber).filter((value): value is string => Boolean(value)))];
}

function t099LockIdentity(requestId: string) {
  const match = requestId.match(new RegExp(`^${T099_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+):S([1-6])$`));
  return match ? { shopifyOrderId: match[1]!, stage: Number(match[2]) } : null;
}

function sentAtForLock(lock: T099LockRow) {
  if (lock.status !== "draft_created") return null;
  return validIso(lock.lease_until) || validIso(lock.updated_at);
}

function addBusinessDays(value: string, days: number) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  let remaining = Math.max(0, days);
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return date.toISOString();
}

function nextBusinessDayOrSame(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

function atNineBerlinDate(value: string | null, addDays = 0) {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T08:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + addDays);
  return date.toISOString();
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
  if (nextStage === 2 || nextStage === 3) return addBusinessDays(input.previousStageSentAt, 4);
  if (nextStage === 4) {
    const orderBoundary = input.orderCreatedAt ? nextBusinessDayOrSame(new Date(Date.parse(input.orderCreatedAt) + 14 * 86_400_000).toISOString()) : null;
    const previousBoundary = nextBusinessDayOrSame(new Date(Date.parse(input.previousStageSentAt) + 7 * 86_400_000).toISOString());
    const dueBoundary = nextBusinessDayOrSame(atNineBerlinDate(input.dueDate, 1) || "");
    return [orderBoundary, previousBoundary, dueBoundary].filter((value): value is string => Boolean(value)).sort().at(-1) || null;
  }
  return nextBusinessDayOrSame(new Date(Date.parse(input.previousStageSentAt) + 7 * 86_400_000).toISOString());
}

function sourceForCase(hasLegacy: boolean, hasT099: boolean) : DunningSource {
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

function isFinanciallyClosed(status: string, outstandingCents: number, cancelledAt: string | null) {
  const normalized = status.toLowerCase();
  return Boolean(cancelledAt)
    || outstandingCents <= 0
    || ["paid", "refunded", "voided", "cancelled", "partially_refunded"].includes(normalized);
}

function verifiedLockSentAt(lock: T099LockRow, audits: WorkflowAuditRow[], messages: CustomerEmailRow[]) {
  const identity = t099LockIdentity(lock.request_id);
  const sentAt = sentAtForLock(lock);
  if (!identity || !sentAt || !lock.message_id || !lock.internet_message_id || !lock.conversation_id) return null;
  const message = messages.find((row) => row.message_id === lock.message_id);
  const audit = audits.find((row) => row.action === "customer_stage_sent_verified"
    && row.status === "sent"
    && cleanText(row.metadata?.lock_key, 240) === lock.request_id);
  if (!message || !audit) return null;
  const metadata = audit.metadata || {};
  const messageSentAt = validIso(message.sent_at || message.message_created_at || message.created_at);
  const auditSentAt = validIso(metadata.sent_at);
  const recipients = Array.isArray(message.to_emails) ? message.to_emails.map(normalizeEmail).filter(Boolean) : [];
  const liveEvidence = metadata.live_evidence && typeof metadata.live_evidence === "object" ? metadata.live_evidence as Record<string, unknown> : {};
  const expectedRecipient = normalizeEmail(metadata.recipient || liveEvidence.customer_email);
  const attachmentVerified = identity.stage < 4 || (metadata.attachment_verified === true
    && cleanText(metadata.pdf_sha256, 80) !== null
    && cleanText(metadata.pdf_sha256, 80) === cleanText(metadata.attachment_content_sha256, 80)
    && Number(metadata.pdf_bytes) >= 1000);
  const valid = message.direction === "outbound"
    && message.source === "outlook"
    && message.internet_message_id === lock.internet_message_id
    && message.conversation_id === lock.conversation_id
    && cleanText(metadata.provider_message_id, 240) === lock.message_id
    && cleanText(metadata.provider_internet_message_id, 500) === lock.internet_message_id
    && cleanText(metadata.provider_conversation_id, 240) === lock.conversation_id
    && Number(metadata.stage) === identity.stage
    && messageSentAt !== null && Date.parse(messageSentAt) === Date.parse(sentAt)
    && auditSentAt !== null && Date.parse(auditSentAt) === Date.parse(sentAt)
    && recipients.length === 1 && expectedRecipient !== null && recipients[0] === expectedRecipient
    && (!message.cc_emails || message.cc_emails.length === 0)
    && (!message.bcc_emails || message.bcc_emails.length === 0)
    && attachmentVerified;
  return valid ? sentAt : null;
}

function stageFromLocks(locks: T099LockRow[], audits: WorkflowAuditRow[], messages: CustomerEmailRow[]) {
  return locks.reduce((highest, lock) => {
    const identity = t099LockIdentity(lock.request_id);
    return identity && verifiedLockSentAt(lock, audits, messages) ? Math.max(highest, identity.stage) : highest;
  }, 0);
}

function lastVerifiedLock(locks: T099LockRow[], stage: number, audits: WorkflowAuditRow[], messages: CustomerEmailRow[]) {
  return locks.find((lock) => t099LockIdentity(lock.request_id)?.stage === stage && verifiedLockSentAt(lock, audits, messages)) || null;
}

function daysSince(dateValue: string | null, now: Date) {
  if (!dateValue) return null;
  const time = Date.parse(dateValue);
  if (!Number.isFinite(time)) return null;
  return Math.floor((now.getTime() - time) / 86_400_000);
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
  now?: Date;
}) {
  const now = input.now || new Date();
  const statusByOrder = new Map(input.statuses.map((row) => [normalizeDunningOrderNumber(row.shopify_order_number), row]));
  const sendlogsByOrder = new Map<string, DunningSendlogRow[]>();
  for (const row of input.sendlogs) {
    const order = normalizeDunningOrderNumber(row.shopify_order_number);
    if (!order) continue;
    sendlogsByOrder.set(order, [...(sendlogsByOrder.get(order) || []), row]);
  }

  const messagesByOrder = new Map<string, CustomerEmailRow[]>();
  for (const message of input.messages) {
    for (const order of parseOrderReferences(message.subject)) {
      messagesByOrder.set(order, [...(messagesByOrder.get(order) || []), message]);
    }
  }

  const locksByOrderId = new Map<string, T099LockRow[]>();
  for (const lock of input.locks) {
    const identity = t099LockIdentity(lock.request_id);
    if (!identity) continue;
    locksByOrderId.set(identity.shopifyOrderId, [...(locksByOrderId.get(identity.shopifyOrderId) || []), lock]);
  }

  const candidateByOrder = new Map<string, T099Candidate>();
  const candidateById = new Map<string, T099Candidate>();
  for (const candidate of input.candidates) {
    const order = normalizeDunningOrderNumber(candidate.shopify_order_name);
    const id = cleanText(candidate.shopify_order_id, 40);
    if (order) candidateByOrder.set(order, candidate);
    if (id) candidateById.set(id, candidate);
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
  for (const order of statusByOrder.keys()) if (order) allOrderNumbers.add(order);
  for (const order of sendlogsByOrder.keys()) allOrderNumbers.add(order);
  for (const order of candidateByOrder.keys()) allOrderNumbers.add(order);
  for (const [id, candidate] of candidateById) {
    const number = normalizeDunningOrderNumber(candidate.shopify_order_name) || normalizeDunningOrderNumber(orderById.get(id)?.name);
    if (number) allOrderNumbers.add(number);
  }

  const cases: DunningCaseSummary[] = [];
  for (const orderNumber of allOrderNumbers) {
    const candidate = candidateByOrder.get(orderNumber) || null;
    const order = orderByNumber.get(orderNumber) || (candidate?.shopify_order_id ? orderById.get(String(candidate.shopify_order_id)) : null) || null;
    const orderId = cleanText(order?.shopify_order_id || candidate?.shopify_order_id, 40);
    const statusRow = statusByOrder.get(orderNumber) || null;
    const sendlogs = (sendlogsByOrder.get(orderNumber) || []).sort((a, b) => Date.parse(a.sent_at) - Date.parse(b.sent_at));
    const latestSendlog = sendlogs.at(-1) || null;
    const locks = orderId ? locksByOrderId.get(orderId) || [] : [];
    const messages = messagesByOrder.get(orderNumber) || [];
    const currentT099Stage = stageFromLocks(locks, input.audits, input.messages);
    const legacyStage = Math.max(Number(statusRow?.mahnstufe || 0), ...sendlogs.map((row) => Number(row.mahnstufe || 0)));
    const hasLegacy = Boolean(statusRow || sendlogs.length);
    const hasT099 = Boolean(candidate || locks.length);
    const source = sourceForCase(hasLegacy, hasT099);
    const currentStage = Math.max(currentT099Stage, legacyStage, 0);
    const currentStageLabel = dunningStageLabel(currentStage, source);
    const currentLock = lastVerifiedLock(locks, currentT099Stage, input.audits, input.messages);
    const lockSentAt = currentLock ? verifiedLockSentAt(currentLock, input.audits, input.messages) : null;
    const lastSentAt = latestIso(lockSentAt, statusRow?.last_sent_at, latestSendlog?.sent_at);
    const messageTimes = messages.map((row) => row.received_at || row.sent_at || row.message_created_at || row.created_at);
    const inboundMessages = messages.filter((row) => row.direction === "inbound");
    const outboundMessages = messages.filter((row) => row.direction === "outbound");
    const lastReplyAt = latestIso(...inboundMessages.map((row) => row.received_at || row.sent_at || row.created_at));
    const lastOutboundAt = latestIso(lastSentAt, ...outboundMessages.map((row) => row.sent_at || row.created_at));
    const customerReplied = Boolean(lastReplyAt && (!lastOutboundAt || Date.parse(lastReplyAt) >= Date.parse(lastOutboundAt)));
    const tags = cleanText(order?.tags, 2000) || "";
    const stopTag = tags.split(",").map((tag) => tag.trim().toLowerCase()).includes("keine zahlungserinnerung n8n");
    const paused = Boolean(statusRow?.paused);
    const email = normalizeEmail(order?.kunde_email || order?.email || latestSendlog?.email || candidate?.shopify_email_hint);
    const company = addressCompany(order) || cleanText(candidate?.shopify_company_hint || candidate?.easybill_company_hint, 180);
    const customerName = cleanText(order?.kunde, 180) || addressName(order) || cleanText(latestSendlog?.kunde, 180) || company;
    const candidateAmount = Number(candidate?.amount_due_cents);
    const amountCents = Number.isSafeInteger(candidateAmount) && candidateAmount > 0
      ? candidateAmount
      : numericCents(order?.total_outstanding) || parseLegacyAmountCents(latestSendlog?.betrag);
    const orderTotalCents = numericCents(order?.total_price) || amountCents;
    const currency = (cleanText(candidate?.currency || order?.currency, 3) || "EUR").toUpperCase();
    const financialStatus = cleanText(order?.financial_status, 60) || (amountCents > 0 ? "unpaid" : "unknown");
    const fulfillmentStatus = cleanText(order?.fulfillment_status, 60) || "unknown";
    const closed = isFinanciallyClosed(financialStatus, amountCents, validIso(order?.cancelled_at));
    const preliminaryOnly = candidate?.preliminary_only === true;
    const dueDate = cleanText(candidate?.easybill_due_date, 20);
    const daysOverdue = daysSince(atNineBerlinDate(dueDate), now);
    const stageSourcesConflict = hasLegacy && hasT099 && legacyStage !== currentT099Stage;
    const nextStage = candidate && currentT099Stage < 6 && !stageSourcesConflict ? currentT099Stage + 1 : null;
    const previousStageLock = currentT099Stage > 0 ? lastVerifiedLock(locks, currentT099Stage, input.audits, input.messages) : null;
    const previousStageSentAt = previousStageLock ? verifiedLockSentAt(previousStageLock, input.audits, input.messages) : null;
    const scheduledAt = nextStage ? nextDunningSchedule({
      nextStage,
      orderCreatedAt: validIso(candidate?.shopify_order_created_at || order?.created_at),
      easybillCreatedAt: validIso(candidate?.easybill_document_created_at),
      dueDate,
      previousStageSentAt,
    }) : null;
    const courtReview = !closed && !paused && (legacyStage >= 4 || currentT099Stage >= 6);
    const blockers: string[] = [];
    if (closed) blockers.push("Forderung ist nicht mehr offen");
    if (paused) blockers.push("Mahnwesen ist pausiert");
    if (stopTag) blockers.push("Shopify-Sperrtag ist gesetzt");
    if (customerReplied) blockers.push("Neue Kundenantwort muss zuerst geprüft werden");
    if (!email) blockers.push("Gültige Kunden-E-Mail fehlt");
    if (!candidate) blockers.push("Nicht im aktuellen Shopify-/Easybill-Live-Kandidatenbestand");
    if (!input.intakeFresh) blockers.push("Live-Kandidatenbestand ist nicht frisch");
    if (stageSourcesConflict) blockers.push("Alt- und Neuverlauf haben unterschiedliche Mahnstufen");
    if (!nextStage) blockers.push(courtReview ? "Keine weitere E-Mail-Stufe vorgesehen" : "Nächste Mahnstufe ist nicht bestimmbar");
    if (nextStage && !scheduledAt) blockers.push("Fälligkeit der nächsten Stufe ist nicht belegbar");
    if (scheduledAt && Date.parse(scheduledAt) > now.getTime()) blockers.push("Nächste Stufe ist noch nicht fällig");
    const uniqueBlockers = [...new Set(blockers)];
    const sendEligible = uniqueBlockers.length === 0 && Boolean(orderId && email && nextStage);
    let state: DunningCaseState = "scheduled";
    if (closed) state = "closed";
    else if (paused || stopTag) state = "paused";
    else if (customerReplied) state = "reply_received";
    else if (courtReview) state = "court_review";
    else if (sendEligible) state = "action_required";
    else if (!candidate || !email || !input.intakeFresh || !scheduledAt) state = "data_issue";

    const easybillDocumentId = cleanText(candidate?.easybill_document_id, 40);
    const lastActivityAt = latestIso(statusRow?.updated_at, lastSentAt, ...messageTimes, ...locks.map((lock) => lock.updated_at));
    cases.push({
      key: orderNumber.slice(1),
      orderNumber,
      shopifyOrderId: orderId,
      customerName,
      company,
      email,
      phone: cleanText(order?.phone, 60),
      amountCents,
      orderTotalCents,
      currency,
      financialStatus,
      fulfillmentStatus,
      orderCreatedAt: validIso(order?.created_at || candidate?.shopify_order_created_at),
      dueDate,
      daysOverdue,
      currentStage,
      currentStageLabel,
      nextStage,
      nextStageLabel: nextStage ? dunningStageLabel(nextStage, "t099") : null,
      scheduledAt,
      lastSentAt,
      lastActivityAt,
      nextDueAt: validIso(statusRow?.next_due_at),
      paused,
      pauseNote: cleanText(statusRow?.note, 500),
      stopTag,
      customerReplied,
      lastReplyAt,
      hasEmail: Boolean(email),
      preliminaryOnly,
      source,
      sourceLabel: sourceLabel(source),
      state,
      stateLabel: STATE_LABELS[state],
      sendEligible,
      blockers: uniqueBlockers,
      courtReview,
      easybillDocumentId,
      easybillInvoiceNumber: cleanText(candidate?.easybill_invoice_number, 120),
      shopifyUrl: orderId ? `https://admin.shopify.com/store/galaxybuzzdk/orders/${encodeURIComponent(orderId)}` : null,
      easybillUrl: easybillDocumentId ? `https://c496191.easybill.de/docs/all?document=${encodeURIComponent(easybillDocumentId)}&archive=1` : null,
    });
  }

  return cases.sort((left, right) => {
    const priority: Record<DunningCaseState, number> = { action_required: 0, reply_received: 1, court_review: 2, data_issue: 3, paused: 4, scheduled: 5, closed: 6 };
    return priority[left.state] - priority[right.state]
      || (right.daysOverdue ?? -9999) - (left.daysOverdue ?? -9999)
      || right.amountCents - left.amountCents
      || left.orderNumber.localeCompare(right.orderNumber);
  });
}

async function pagedRequest<T>(path: string, query: Record<string, string | number>, maxRows = 5000) {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const page = await supabaseRequest<T[]>(path, undefined, { ...query, limit: pageSize, offset });
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function inFilter(values: string[]) {
  return `in.(${values.join(",")})`;
}

async function loadRelevantShopifyOrders(orderNames: string[], orderIds: string[]) {
  const select = "shopify_order_id,name,financial_status,fulfillment_status,total_price,total_outstanding,currency,email,kunde,kunde_email,tags,created_at,cancelled_at,ingested_at,ship_address,bill_address,phone";
  const positive = await pagedRequest<ShopifyOrderRow>("shopify_orders", {
    select,
    total_outstanding: "gt.0",
    order: "created_at.desc",
  }, 3000);
  const extra: ShopifyOrderRow[] = [];
  for (let index = 0; index < orderNames.length; index += 80) {
    const chunk = orderNames.slice(index, index + 80);
    if (chunk.length) extra.push(...await supabaseRequest<ShopifyOrderRow[]>("shopify_orders", undefined, { select, name: inFilter(chunk), limit: 1000 }));
  }
  for (let index = 0; index < orderIds.length; index += 80) {
    const chunk = orderIds.slice(index, index + 80);
    if (chunk.length) extra.push(...await supabaseRequest<ShopifyOrderRow[]>("shopify_orders", undefined, { select, shopify_order_id: inFilter(chunk), limit: 1000 }));
  }
  return [...new Map([...positive, ...extra].map((row) => [row.shopify_order_id, row])).values()];
}

function dunningSendConfigured() {
  if (String(process.env.DUNNING_MANUAL_SEND_ENABLED || "").toLowerCase() !== "true") return false;
  const url = cleanText(process.env.DUNNING_MANUAL_SEND_WEBHOOK_URL, 1000);
  const secret = cleanText(process.env.DUNNING_MANUAL_SEND_WEBHOOK_SECRET, 500);
  if (!url || !secret) return false;
  try {
    const parsed = new URL(url);
    const allowedHosts = String(process.env.DUNNING_MANUAL_SEND_ALLOWED_HOSTS || "fuajob.online")
      .split(/[\s,;]+/).map((entry) => entry.trim().toLowerCase()).filter(Boolean);
    return parsed.protocol === "https:" && allowedHosts.includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export async function listDunningDashboard(): Promise<DunningDashboard> {
  const [statuses, sendlogs, locks, latestIntakeAudits, senderAudits, inboundMessages, senderMessages] = await Promise.all([
    supabaseRequest<DunningStatusRow[]>("dunning_status", undefined, { select: "shopify_order_number,mahnstufe,last_sent_at,next_due_at,paused,note,updated_by,updated_at", order: "updated_at.desc", limit: 1000 }),
    supabaseRequest<DunningSendlogRow[]>("mahn_sendlog", undefined, { select: "id,sent_at,shopify_order_number,mahnstufe,lang,email,kunde,betrag,subject,actor,status", order: "sent_at.asc", limit: 1000 }),
    pagedRequest<T099LockRow>("email_locks", { select: "request_id,locked_at,message_id,internet_message_id,conversation_id,status,attempt_count,lease_until,last_error,updated_at", request_id: `like.${T099_PREFIX}*`, order: "updated_at.asc" }),
    supabaseRequest<WorkflowAuditRow[]>("workflow_audit_log", undefined, { select: "id,document_id,workflow_name,action,status,error_message,metadata,created_at", workflow_name: "eq.TICKET-099 Existing Ledger Intake", action: "eq.future_candidate_snapshot", order: "created_at.desc", limit: 1 }),
    pagedRequest<WorkflowAuditRow>("workflow_audit_log", { select: "id,document_id,workflow_name,action,status,error_message,metadata,created_at", workflow_name: "eq.TICKET-099 Existing Ledger Sender", action: "eq.customer_stage_sent_verified", status: "eq.sent", order: "created_at.asc" }),
    pagedRequest<CustomerEmailRow>("customer_email_messages", { select: "id,message_id,internet_message_id,conversation_id,direction,from_email,from_name,to_emails,cc_emails,bcc_emails,subject,body_preview,received_at,sent_at,message_created_at,source,created_at", subject: "ilike.*NEONT*", order: "message_created_at.asc" }, 6000),
    pagedRequest<CustomerEmailRow>("customer_email_messages", { select: "id,message_id,internet_message_id,conversation_id,direction,from_email,from_name,to_emails,cc_emails,bcc_emails,subject,body_preview,received_at,sent_at,message_created_at,source,created_at", direction: "eq.outbound", source: "eq.outlook", sent_at: "gte.2026-08-05T15:30:00.000Z", order: "sent_at.asc" }, 6000),
  ]);

  const latestAudit = latestIntakeAudits[0] || null;
  const metadata = latestAudit?.metadata || {};
  const candidates = Array.isArray(metadata.candidates) ? metadata.candidates as T099Candidate[] : [];
  const intakeObservedAt = validIso(metadata.observed_at);
  const intakeFreshUntil = validIso(metadata.fresh_until);
  const intakeComplete = latestAudit?.status === "success" && metadata.source_complete === true;
  const intakeFresh = Boolean(intakeComplete && intakeFreshUntil && Date.parse(intakeFreshUntil) >= Date.now());
  const orderNames = [...new Set([
    ...statuses.map((row) => normalizeDunningOrderNumber(row.shopify_order_number)),
    ...sendlogs.map((row) => normalizeDunningOrderNumber(row.shopify_order_number)),
    ...candidates.map((row) => normalizeDunningOrderNumber(row.shopify_order_name)),
  ].filter((value): value is string => Boolean(value)))];
  const orderIds = [...new Set([
    ...candidates.map((row) => cleanText(row.shopify_order_id, 40)),
    ...locks.map((row) => t099LockIdentity(row.request_id)?.shopifyOrderId || null),
  ].filter((value): value is string => Boolean(value)))];
  const orders = await loadRelevantShopifyOrders(orderNames, orderIds);
  const messages = [...new Map([...inboundMessages, ...senderMessages].map((row) => [row.id, row])).values()];
  const cases = buildDunningCases({ orders, statuses, sendlogs, locks, audits: senderAudits, messages, candidates, intakeFresh });
  const openCases = cases.filter((entry) => entry.state !== "closed");
  return {
    generatedAt: new Date().toISOString(),
    sourceHealth: {
      intakeObservedAt,
      intakeFreshUntil,
      intakeComplete,
      intakeFresh,
      candidateCount: candidates.length,
      legacyUpdatedAt: latestIso(...statuses.map((row) => row.updated_at)),
    },
    sendConfigured: dunningSendConfigured(),
    stats: {
      total: cases.length,
      open: openCases.length,
      actionRequired: cases.filter((entry) => entry.state === "action_required").length,
      replies: cases.filter((entry) => entry.state === "reply_received").length,
      paused: cases.filter((entry) => entry.state === "paused").length,
      courtReview: cases.filter((entry) => entry.courtReview).length,
      dataIssues: cases.filter((entry) => entry.state === "data_issue").length,
      totalOutstandingCents: openCases.reduce((sum, entry) => sum + entry.amountCents, 0),
    },
    cases,
  };
}

function timelineFromCase(summary: DunningCaseSummary) {
  const entries: DunningTimelineEntry[] = [];
  if (summary.orderCreatedAt) entries.push({ id: `order:${summary.key}`, occurredAt: summary.orderCreatedAt, kind: "order", title: "Bestellung angelegt", detail: summary.orderNumber, source: "Shopify", direction: "internal", stage: null, status: summary.financialStatus });
  if (summary.dueDate) {
    const occurredAt = atNineBerlinDate(summary.dueDate);
    if (occurredAt) entries.push({ id: `due:${summary.key}`, occurredAt, kind: "due", title: "Rechnung fällig", detail: summary.easybillInvoiceNumber, source: "Easybill", direction: "internal", stage: null, status: "due" });
  }
  return entries;
}

export async function getDunningCaseDetail(orderKey: string): Promise<DunningCaseDetail | null> {
  const normalized = normalizeDunningOrderNumber(orderKey);
  if (!normalized) return null;
  const dashboard = await listDunningDashboard();
  const summary = dashboard.cases.find((entry) => entry.orderNumber === normalized);
  if (!summary) return null;
  const [logs, sendlogs, messages, locks, audits] = await Promise.all([
    supabaseRequest<DunningLogRow[]>("dunning_log", undefined, { select: "id,created_at,action,shopify_order_number,mahnstufe,actor", shopify_order_number: `eq.${normalized}`, order: "created_at.asc", limit: 1000 }),
    supabaseRequest<DunningSendlogRow[]>("mahn_sendlog", undefined, { select: "id,sent_at,shopify_order_number,mahnstufe,lang,email,kunde,betrag,subject,actor,status", shopify_order_number: `eq.${normalized}`, order: "sent_at.asc", limit: 1000 }),
    pagedRequest<CustomerEmailRow>("customer_email_messages", { select: "id,message_id,internet_message_id,conversation_id,direction,from_email,from_name,to_emails,cc_emails,bcc_emails,subject,body_preview,received_at,sent_at,message_created_at,source,created_at", subject: `ilike.*${normalized.slice(1)}*`, order: "message_created_at.asc" }, 3000),
    summary.shopifyOrderId ? supabaseRequest<T099LockRow[]>("email_locks", undefined, { select: "request_id,locked_at,message_id,internet_message_id,conversation_id,status,attempt_count,lease_until,last_error,updated_at", request_id: `like.${T099_PREFIX}${summary.shopifyOrderId}:S*`, order: "updated_at.asc", limit: 1000 }) : Promise.resolve([]),
    summary.shopifyOrderId ? supabaseRequest<WorkflowAuditRow[]>("workflow_audit_log", undefined, { select: "id,document_id,workflow_name,action,status,error_message,metadata,created_at", workflow_name: "eq.TICKET-099 Existing Ledger Sender", "metadata->>lock_key": `like.${T099_PREFIX}${summary.shopifyOrderId}:S*`, order: "created_at.asc", limit: 1000 }) : Promise.resolve([]),
  ]);

  const timeline = timelineFromCase(summary);
  for (const row of logs) timeline.push({ id: `legacy-log:${row.id}`, occurredAt: row.created_at, kind: "status", title: row.action === "set" ? `Mahnstufe ${row.mahnstufe ?? 0} gesetzt` : cleanText(row.action, 120) || "Mahnstatus geändert", detail: row.actor ? `Durch ${row.actor}` : null, source: "Altbestand", direction: "internal", stage: row.mahnstufe, status: row.action });
  for (const row of sendlogs) timeline.push({ id: `legacy-send:${row.id}`, occurredAt: row.sent_at, kind: "stage", title: cleanText(row.subject, 220) || dunningStageLabel(Number(row.mahnstufe || 0), "legacy"), detail: [row.email, row.status].filter(Boolean).join(" - ") || null, source: "Mahn-Sendelog", direction: "outbound", stage: row.mahnstufe, status: row.status });
  for (const row of messages) {
    const occurredAt = validIso(row.received_at || row.sent_at || row.message_created_at || row.created_at);
    if (!occurredAt) continue;
    const inbound = row.direction === "inbound";
    timeline.push({ id: `mail:${row.id}`, occurredAt, kind: inbound ? "reply" : "email", title: cleanText(row.subject, 220) || (inbound ? "Kundenantwort" : "E-Mail versendet"), detail: cleanText(row.body_preview, 500), source: row.source || "Outlook", direction: inbound ? "inbound" : "outbound", stage: null, status: row.direction });
  }
  for (const lock of locks) {
    const identity = t099LockIdentity(lock.request_id);
    const occurredAt = sentAtForLock(lock) || validIso(lock.updated_at);
    if (!identity || !occurredAt) continue;
    timeline.push({ id: `lock:${lock.request_id}`, occurredAt, kind: "evidence", title: `${dunningStageLabel(identity.stage, "t099")} technisch belegt`, detail: lock.last_error || (lock.message_id ? "Outlook-Nachweis und Einmal-Sperre vorhanden" : "Einmal-Sperre vorhanden"), source: "T099 Versandnachweis", direction: "internal", stage: identity.stage, status: lock.status });
  }
  for (const audit of audits) timeline.push({ id: `audit:${audit.id}`, occurredAt: audit.created_at, kind: "evidence", title: audit.action === "customer_stage_sent_verified" ? "Versand vollständig verifiziert" : "Versandprüfung blockiert", detail: audit.error_message, source: "T099 Audit", direction: "internal", stage: Number(audit.metadata?.stage || 0) || null, status: audit.status });
  const deduped = [...new Map(timeline.map((entry) => [entry.id, entry])).values()].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
  return { case: summary, timeline: deduped, generatedAt: dashboard.generatedAt };
}

export function createDunningActionPreview(summary: DunningCaseSummary): DunningActionPreview | null {
  if (!summary.shopifyOrderId || !summary.nextStage || !summary.email) return null;
  const confirmationPhrase = `MAHNSTUFE ${summary.nextStage} SENDEN ${summary.orderNumber}`;
  const snapshotSource = JSON.stringify({ order: summary.orderNumber, id: summary.shopifyOrderId, stage: summary.nextStage, amount: summary.amountCents, recipient: summary.email, scheduledAt: summary.scheduledAt });
  return {
    orderNumber: summary.orderNumber,
    shopifyOrderId: summary.shopifyOrderId,
    currentStage: summary.currentStage,
    nextStage: summary.nextStage,
    nextStageLabel: summary.nextStageLabel || dunningStageLabel(summary.nextStage, "t099"),
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
  const allowedHosts = String(process.env.DUNNING_MANUAL_SEND_ALLOWED_HOSTS || "fuajob.online")
    .split(/[\s,;]+/).map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  if (url.protocol !== "https:" || !allowedHosts.includes(url.hostname.toLowerCase())) throw new Error("DUNNING_WEBHOOK_NOT_ALLOWED");
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
    try { body = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { body = {}; }
    if (!response.ok || body.ok === false) throw new Error(response.status === 409 ? "DUNNING_DUPLICATE_OR_STALE" : "DUNNING_WEBHOOK_FAILED");
    return { accepted: true, status: response.status, workflowExecutionId: cleanText(body.executionId || body.workflowExecutionId, 120) };
  } finally {
    clearTimeout(timeout);
  }
}
