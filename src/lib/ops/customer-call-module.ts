import {
  type CustomerSearchResult,
  type CustomerWorkboardSection,
  listCustomerRecordsByRequestIds,
  parseTrelloCardIdentifier,
  selectReferenceTrelloAttachment,
} from "@/lib/ops/customer-records";
import { attachmentName, isValidMockupAttachment } from "@/lib/quotes/mockups";
import { SupabaseRestError, supabaseRequest, supabaseRpc } from "@/lib/quotes/supabase-rest";
import { getTrelloCardVisuals } from "@/lib/quotes/trello";
import type { TrelloAttachment } from "@/lib/quotes/types";
import { QuoteValidationError } from "@/lib/quotes/validation";
import {
  buildTaskFromInboundEmailSignal,
  classifyInboundEmailSignal,
  closeActiveSalesTasksForRequest,
  closeSupersededSalesTasksForRequest,
  isActiveSalesTaskVisibleNow,
  loadActiveSalesTaskRequestIds,
  loadActiveSalesTasksByRequestId,
  taskTitle,
  upsertSalesTask,
  type InboundEmailSignal,
  type SalesTask,
  type SalesTaskDraft,
  type SalesTaskPriority,
  type SalesTaskType,
} from "@/lib/ops/sales-task-engine";

const SALES_CALL_WORKFLOW_NAME = "customer_records_sales_calls";
const SALES_CALL_LIST_REFRESH_ACTION = "sales_call_list_refreshed";
const SALES_CALL_RESULT_RECORDED_ACTION = "sales_call_result_recorded";
const SALES_CALL_RUNS_TABLE = "sales_call_runs";
const SALES_CALL_LIST_ITEMS_TABLE = "sales_call_list_items";
const SALES_CALL_RESULTS_TABLE = "sales_call_results";
const SALES_CALL_CADENCE_STATE_TABLE = "sales_call_cadence_state";
const MANUAL_GATE_TOP_N = 10;
const LEARNING_SIGNAL_MIN_DISTINCT_NOTES = 5;
const CALLBACK_NEXT_STEP_RE = /^callback_(\d{4}-\d{2}-\d{2})$/;
const NON_REAL_OUTCOME_NOTE_RE = /\b(simulation|simuliert|dry[- ]?run|testlauf|fake)\b/i;
const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 17;
const VIP_VALUE_THRESHOLD = 1000;
const SALES_CALL_PREVIEW_LIMIT = 80;
const SALES_CALL_LIVE_VISUAL_FALLBACK_LIMIT = SALES_CALL_PREVIEW_LIMIT;
const SALES_CALL_TRELLO_VISUAL_LOOKUP_CONCURRENCY = 4;
const SALES_CALL_CANDIDATE_CONTEXT_LIMIT = 160;
const SALES_CALL_RUN_ITEM_LOAD_LIMIT = 500;
const SALES_CALL_REFRESH_COOLDOWN_SECONDS = 60;
const directTrelloVisualCache = new Map<string, SalesCallVisualCandidate[]>();

export type SalesCallPreset =
  | "called-done"
  | "interested"
  | "needs-adjustment"
  | "needs-time"
  | "wants-lower-price"
  | "wants-offer"
  | "wants-update"
  | "callback"
  | "not-reached"
  | "bought"
  | "do-not-call"
  | "not-interested"
  | "wrong-number"
  | "review-useful"
  | "review-not-useful";

export type SalesCallPriorityTier = "standard" | "important" | "vip";
export type SalesCallPostReminderDecision = "manual_followup" | "offer_adjustment" | "finished";
export type SalesCallVisualSource = "followup_mockup" | "crm_quote_image" | "trello_mockup" | "trello_reference";

export type SalesCallVisualCandidate = {
  url: string;
  label: string;
  source: SalesCallVisualSource;
};

export type SalesCallCadenceStage =
  | "inquiry_call"
  | "quote_call"
  | "no_response_call"
  | "callback"
  | "manual_followup"
  | "offer_adjustment"
  | "data_issue"
  | "finished";

export type SalesCallQueueBucket =
  | "due_today"
  | "vip_today"
  | "not_reached"
  | "callbacks"
  | "manual_followup"
  | "offer_adjustment"
  | "data_issue"
  | "finished";

export type SalesCallCadenceState = {
  requestId: string;
  currentStage: SalesCallCadenceStage;
  nextCallDueAt: string | null;
  call1DueAt: string | null;
  call2DueAt: string | null;
  call3DueAt: string | null;
  call1CompletedAt: string | null;
  call2CompletedAt: string | null;
  call3CompletedAt: string | null;
  standardCallCount: number;
  retryCount: number;
  cadenceFinished: boolean;
  blocked: boolean;
  blockingReason: string | null;
  pendingCallbackAt: string | null;
  lastResultPreset: SalesCallPreset | null;
  nextCallAction:
    | "call_stage_1"
    | "call_stage_2"
    | "call_stage_3"
    | "retry_next_day"
    | "retry_in_2_days"
    | "await_callback"
    | "manual_sales_followup"
    | "offer_adjustment"
    | "send_offer"
    | "send_update"
    | "price_review"
    | "blocked_no_interest"
    | "blocked_do_not_call"
    | "closed_won"
    | "blocked_wrong_number"
    | "finished_standard_cadence";
  queueBucket: SalesCallQueueBucket;
  priorityTier: SalesCallPriorityTier;
  priorityReason: string | null;
  vipManual: boolean;
  purchaseSignal: boolean;
  updatedAt: string | null;
};

export type SalesCallRunSummary = {
  id: string | null;
  runKey: string | null;
  date: string;
  timezone: string;
  status: "preview" | "active" | "completed";
  startedAt: string | null;
  finishedAt: string | null;
  candidateCount: number;
  eligibleCount: number;
  blockedCount: number;
};

export type SalesCallGuard = {
  allowed: boolean;
  blockedReason: string | null;
  attentionReasons: string[];
  notBefore: string | null;
  phoneQuality: "missing" | "weak" | "ok";
};

export type SalesCallResultEntry = {
  id: string;
  callListItemId: string | null;
  rankAtTime: number | null;
  requestId: string;
  acDealId: number | null;
  preset: SalesCallPreset | null;
  callDone: "yes" | "no";
  callOutcome: SalesCallOutcome;
  nextStep: string;
  validationUseful: "yes" | "no";
  notes: string;
  operatorId: string | null;
  source: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type SalesCallListItem = {
  id: string | null;
  runId: string | null;
  rank: number;
  requestId: string;
  acDealId: number | null;
  priorityGroup: string;
  priorityScore: number;
  recommendedAction: string;
  dealValueEur: number;
  reasons: string[];
  contextPreview: string;
  phoneRaw: string | null;
  phoneNormalized: string | null;
  phoneQuality: SalesCallGuard["phoneQuality"];
  email: string | null;
  contactName: string | null;
  companyName: string | null;
  daysSinceSent: number | null;
  hoursSinceView: number | null;
  pandadocStatus: string | null;
  acLiveDecision: string | null;
  acLiveStatus: string | null;
  acLiveStage: string | null;
  blockedReason: string | null;
  guard: SalesCallGuard;
  sourceKeys: CustomerWorkboardSection["key"][];
  visualCandidates: SalesCallVisualCandidate[];
  topTen: boolean;
  record: CustomerSearchResult;
  latestResult: SalesCallResultEntry | null;
  cadence: SalesCallCadenceState;
  activeTasks?: SalesTask[];
};

export type SalesCallProcessedTodayItem = {
  requestId: string;
  contactName: string | null;
  companyName: string | null;
  email: string | null;
  latestResult: SalesCallResultEntry;
  cadence: SalesCallCadenceState | null;
  record: CustomerSearchResult | null;
};

export type SalesCallGateSummary = {
  gate: "invalid" | "incomplete" | "red" | "yellow" | "green";
  topN: number;
  reviewed: number;
  remainingToReview: number;
  remainingReviewRanks: number[];
  useful: number;
  notUseful: number;
  usefulRate: number;
  concreteNextSteps: number;
  concreteNextStepValue: number;
  informativeUseful: number;
  distinctInformativeNotes: number;
  clearLearningSignal: boolean;
  usefulNeededForGreen: number;
  concreteNextStepsNeededForGreen: number;
  informativeUsefulNeededForLearningSignal: number;
  distinctInformativeNotesNeededForLearningSignal: number;
  criticalDataErrors: number;
  wrongNumbers: number;
  validationErrors: string[];
};

export type SalesCallCompletionSummary = {
  technicalStatus: "ok" | "pending" | "failed";
  complete: boolean;
  reason: string;
  nextRequiredAction: string;
};

export type SalesCallModuleState = {
  storageReady: boolean;
  run: SalesCallRunSummary;
  items: SalesCallListItem[];
  processedToday: SalesCallProcessedTodayItem[];
  gate: SalesCallGateSummary;
  completion: SalesCallCompletionSummary;
  bucketCounts: Record<SalesCallQueueBucket, number>;
  taskCounts: {
    open: number;
    waiting: number;
    blocked: number;
    overdue: number;
    emailDriven: number;
  };
};

export type SalesCallResultInput = {
  callListItemId?: string | null;
  requestId: string;
  preset: SalesCallPreset;
  notes: string;
  callbackDate?: string | null;
  postReminderDecision?: SalesCallPostReminderDecision | null;
  operatorId?: string | null;
  priorityTier?: SalesCallPriorityTier | null;
  priorityReason?: string | null;
  purchaseSignal?: boolean | null;
  expectedLatestResultId?: string | null;
};

type SalesCallOutcome =
  | ""
  | "reached_interested"
  | "reached_needs_adjustment"
  | "reached_needs_time"
  | "reached_price_objection"
  | "reached_wants_offer"
  | "reached_wants_update"
  | "reached_callback"
  | "reached_bought"
  | "do_not_call_requested"
  | "reached_not_interested"
  | "not_reached"
  | "wrong_number";

type SalesCallActor = {
  host?: string | null;
  mode?: string | null;
  userAgent?: string | null;
  operatorName?: string | null;
};

type DailyCallRunRow = {
  id: string;
  run_key?: string | null;
  date?: string | null;
  timezone?: string | null;
  status?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  candidate_count?: number | null;
  eligible_count?: number | null;
  error_count?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type DailyCallListItemRow = {
  id: string;
  run_id?: string | null;
  rank?: number | null;
  request_id?: string | null;
  ac_deal_id?: number | null;
  priority_group?: string | null;
  priority_score?: number | null;
  recommended_action?: string | null;
  deal_value_eur?: number | null;
  reasons_json?: string[] | null;
  context_preview?: string | null;
  phone_raw?: string | null;
  phone_normalized?: string | null;
  phone_quality?: SalesCallGuard["phoneQuality"] | null;
  email?: string | null;
  contact_name?: string | null;
  company_name?: string | null;
  days_since_sent?: number | null;
  hours_since_view?: number | null;
  pandadoc_status?: string | null;
  ac_live_decision?: string | null;
  ac_live_status?: string | null;
  ac_live_stage?: string | null;
  blocked_reason?: string | null;
  source_keys?: CustomerWorkboardSection["key"][] | null;
  visual_candidates_json?: unknown;
  visual_snapshot_created_at?: string | null;
  created_at?: string | null;
};

type SalesCallResultRow = {
  id: string;
  call_list_item_id?: string | null;
  rank_at_time?: number | null;
  request_id?: string | null;
  ac_deal_id?: number | null;
  preset?: SalesCallPreset | null;
  call_done?: "yes" | "no" | null;
  call_outcome?: SalesCallOutcome | null;
  next_step?: string | null;
  validation_useful?: "yes" | "no" | null;
  notes?: string | null;
  operator_id?: string | null;
  source?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  superseded_at?: string | null;
};

type SalesCallResultRpcResponse = {
  ok?: boolean;
  error?: string;
  latest_result_id?: string | null;
  result?: SalesCallResultRow;
  superseded_count?: number;
};

type WorkflowAuditRow = {
  id: string;
  document_id?: string | null;
  workflow_name?: string | null;
  action?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
};

type CandidateRequestRow = {
  request_id?: string | null;
  created_at?: string | null;
};

type CandidateQuoteRow = {
  request_id?: string | null;
  sent_at?: string | null;
  viewed_at?: string | null;
  signed_at?: string | null;
  created_at?: string | null;
};

type CandidateCrmQuoteRow = {
  request_id?: string | null;
  sent_at?: string | null;
  viewed_at?: string | null;
  accepted_at?: string | null;
  rejected_at?: string | null;
  created_at?: string | null;
};

type SalesMasterCustomerRow = {
  id: string;
  request_id?: string | null;
  email?: string | null;
  billing_email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  company?: string | null;
  company_name?: string | null;
  original_phone?: string | null;
  updated_at?: string | null;
};

type SalesMasterRequestRow = {
  request_id?: string | null;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  ac_deal_id?: number | null;
  ac_deal_stage?: string | null;
  deal_status?: string | null;
  estimated_value?: number | string | null;
  final_value?: number | string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type SalesMasterQuoteRow = {
  request_id?: string | null;
  pandadoc_status?: string | null;
  total_value?: number | string | null;
  currency?: string | null;
  sent_at?: string | null;
  viewed_at?: string | null;
  signed_at?: string | null;
  whatsapp_sent?: string | null;
};

type SalesLeadPlanRow = {
  request_id?: string | null;
  contactability_status?: string | null;
  call_after?: string | null;
  planning_reason?: string | null;
};

type SalesFollowupRow = {
  request_id?: string | null;
  status?: string | null;
  scheduled_for?: string | null;
};

type SalesOrderRow = {
  request_id?: string | null;
  customer_id?: string | null;
  status?: string | null;
};

type SalesCallLogRow = {
  request_id?: string | null;
  called_at?: string | null;
  summary?: string | null;
};

type SalesCallCadenceStateRow = {
  id?: string;
  request_id?: string | null;
  current_stage?: SalesCallCadenceStage | null;
  next_call_due_at?: string | null;
  call_1_due_at?: string | null;
  call_2_due_at?: string | null;
  call_3_due_at?: string | null;
  call_1_completed_at?: string | null;
  call_2_completed_at?: string | null;
  call_3_completed_at?: string | null;
  standard_call_count?: number | null;
  retry_count?: number | null;
  cadence_finished?: boolean | null;
  blocked?: boolean | null;
  blocking_reason?: string | null;
  pending_callback_at?: string | null;
  last_result_preset?: SalesCallPreset | null;
  next_call_action?: SalesCallCadenceState["nextCallAction"] | null;
  queue_bucket?: SalesCallQueueBucket | null;
  priority_tier?: SalesCallPriorityTier | null;
  priority_reason?: string | null;
  vip_manual?: boolean | null;
  purchase_signal?: boolean | null;
  updated_at?: string | null;
};

const SALES_CALL_PRESETS: Record<
  SalesCallPreset,
  {
    callDone: "yes" | "no";
    callOutcome: SalesCallOutcome;
    nextStep:
      | "send_adjusted_offer"
      | "send_offer"
      | "send_update"
      | "price_review"
      | "close_won"
      | "close_lost"
      | "do_not_contact"
      | "wait"
      | "no_action"
      | "callback";
    validationUseful: "yes" | "no";
  }
> = {
  "called-done": {
    callDone: "yes",
    callOutcome: "",
    nextStep: "no_action",
    validationUseful: "yes",
  },
  interested: {
    callDone: "yes",
    callOutcome: "reached_interested",
    nextStep: "send_adjusted_offer",
    validationUseful: "yes",
  },
  "needs-adjustment": {
    callDone: "yes",
    callOutcome: "reached_needs_adjustment",
    nextStep: "send_adjusted_offer",
    validationUseful: "yes",
  },
  "needs-time": {
    callDone: "yes",
    callOutcome: "reached_needs_time",
    nextStep: "callback",
    validationUseful: "yes",
  },
  "wants-lower-price": {
    callDone: "yes",
    callOutcome: "reached_price_objection",
    nextStep: "price_review",
    validationUseful: "yes",
  },
  "wants-offer": {
    callDone: "yes",
    callOutcome: "reached_wants_offer",
    nextStep: "send_offer",
    validationUseful: "yes",
  },
  "wants-update": {
    callDone: "yes",
    callOutcome: "reached_wants_update",
    nextStep: "send_update",
    validationUseful: "yes",
  },
  callback: {
    callDone: "yes",
    callOutcome: "reached_callback",
    nextStep: "callback",
    validationUseful: "yes",
  },
  "not-reached": {
    callDone: "yes",
    callOutcome: "not_reached",
    nextStep: "callback",
    validationUseful: "yes",
  },
  bought: {
    callDone: "yes",
    callOutcome: "reached_bought",
    nextStep: "close_won",
    validationUseful: "yes",
  },
  "do-not-call": {
    callDone: "yes",
    callOutcome: "do_not_call_requested",
    nextStep: "do_not_contact",
    validationUseful: "yes",
  },
  "not-interested": {
    callDone: "yes",
    callOutcome: "reached_not_interested",
    nextStep: "close_lost",
    validationUseful: "yes",
  },
  "wrong-number": {
    callDone: "yes",
    callOutcome: "wrong_number",
    nextStep: "no_action",
    validationUseful: "no",
  },
  "review-useful": {
    callDone: "no",
    callOutcome: "",
    nextStep: "wait",
    validationUseful: "yes",
  },
  "review-not-useful": {
    callDone: "no",
    callOutcome: "",
    nextStep: "no_action",
    validationUseful: "no",
  },
};

const WEAK_NOTE_VALUES = new Set([
  "angerufen",
  "checked",
  "gecheckt",
  "geprueft",
  "geprüft",
  "mailbox",
  "reviewed",
]);

const PLACEHOLDER_NOTES = new Set([
  "-",
  "n/a",
  "na",
  "ok",
  "test",
  "kurze notiz",
  "was anpassen",
  "rueckrufkontext",
  "rückrufkontext",
  "warum verloren",
  "warum sinnvoll",
  "warum nicht sinnvoll",
  "fachliche bewertung",
  "echter kontext",
  "echter kontakt",
  "echten gespraechskontext eintragen",
  "echten gesprächskontext eintragen",
  "echten pruefkontext eintragen",
  "echten prüfkontext eintragen",
  "echten anpassungskontext eintragen",
  "echten rueckrufkontext und termin eintragen",
  "echten rückrufkontext und termin eintragen",
  "echten versuchskontext eintragen",
  "echten ausschlussgrund eintragen",
  "kunde interessiert",
  "angebot relevant",
  "angebot passt",
  "rueckruf vereinbart",
  "rückruf vereinbart",
  "will pruefen",
  "will prüfen",
  "meldet sich",
  "nicht erreicht",
]);

function todayInBerlin() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function berlinDateKey(value: string | null | undefined) {
  const parsed = parseDate(value);
  if (!parsed) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

function isTodayInBerlin(value: string | null | undefined) {
  return berlinDateKey(value) === todayInBerlin();
}

function berlinDayStartIso(dateKey = todayInBerlin()) {
  const noonUtc = new Date(`${dateKey}T12:00:00.000Z`);
  const timeZoneName = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    timeZoneName: "longOffset",
  })
    .formatToParts(noonUtc)
    .find((part) => part.type === "timeZoneName")?.value;
  const offset = timeZoneName?.match(/GMT([+-]\d{2}):?(\d{2})?/) || null;
  return `${dateKey}T00:00:00${offset ? `${offset[1]}:${offset[2] || "00"}` : "+01:00"}`;
}

function normalizeWhitespace(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeNote(value: string | null | undefined) {
  return normalizeWhitespace(value).trim().replace(/[`"'"]/g, "").toLowerCase();
}

function normalizePhone(value: string | null | undefined) {
  const trimmed = normalizeWhitespace(value);
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[^\d+]/g, "");
  return normalized || null;
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
}

function toIso(value: Date | null) {
  return value ? value.toISOString() : null;
}

function isWeekend(value: Date) {
  const day = value.getUTCDay();
  return day === 0 || day === 6;
}

function alignToBusinessTime(value: Date) {
  const next = new Date(value.getTime());
  while (isWeekend(next)) {
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(BUSINESS_START_HOUR, 30, 0, 0);
  }
  if (next.getUTCHours() < BUSINESS_START_HOUR) {
    next.setUTCHours(BUSINESS_START_HOUR, 30, 0, 0);
  } else if (next.getUTCHours() >= BUSINESS_END_HOUR) {
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(BUSINESS_START_HOUR, 30, 0, 0);
    while (isWeekend(next)) {
      next.setUTCDate(next.getUTCDate() + 1);
      next.setUTCHours(BUSINESS_START_HOUR, 30, 0, 0);
    }
  }
  return next;
}

function addBusinessDays(base: Date, days: number, hour = BUSINESS_START_HOUR, minute = 30) {
  const next = new Date(base.getTime());
  next.setUTCHours(hour, minute, 0, 0);
  let remaining = days;
  while (remaining > 0) {
    next.setUTCDate(next.getUTCDate() + 1);
    if (!isWeekend(next)) remaining -= 1;
  }
  while (isWeekend(next)) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

function scheduleInquiryCall(createdAt: string | null | undefined) {
  const created = parseDate(createdAt) || new Date();
  const sameDay = new Date(created.getTime() + 30 * 60 * 1000);
  return toIso(alignToBusinessTime(sameDay));
}

function scheduleQuoteCall(sentAt: string | null | undefined, viewedAt: string | null | undefined) {
  const viewed = parseDate(viewedAt);
  if (viewed) {
    const accelerated = new Date(viewed.getTime() + 2 * 60 * 60 * 1000);
    return toIso(alignToBusinessTime(accelerated));
  }
  const sent = parseDate(sentAt);
  if (!sent) return null;
  const sameDay = new Date(sent.getTime() + 30 * 60 * 1000);
  return toIso(alignToBusinessTime(sameDay));
}

function scheduleNoResponseCall(sentAt: string | null | undefined, viewedAt: string | null | undefined) {
  const base = parseDate(viewedAt) || parseDate(sentAt);
  if (!base) return null;
  return toIso(addBusinessDays(base, 3, 10, 30));
}

function scheduleRetryFromNow(days: 1 | 2) {
  return toIso(addBusinessDays(new Date(), days, 10, 0));
}

function isDueToday(value: string | null | undefined) {
  if (!value) return false;
  const due = parseDate(value);
  if (!due) return false;
  return due.getTime() <= Date.now();
}

function phoneQuality(value: string | null | undefined): SalesCallGuard["phoneQuality"] {
  const normalized = normalizePhone(value);
  if (!normalized) return "missing";
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 7) return "weak";
  return "ok";
}

function parseNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function deriveDealValue(record: CustomerSearchResult) {
  return parseNumber(
    record.crmQuote?.customerLiveTotal ??
      record.crmQuote?.totalGross ??
      record.quote?.totalValue ??
      record.request?.finalValue ??
      record.request?.estimatedValue ??
      record.crmSales[0]?.totalPrice ??
      null,
  );
}

function quoteSentAt(record: CustomerSearchResult) {
  return record.quote?.sentAt || record.crmQuote?.sentAt || null;
}

function quoteViewedAt(record: CustomerSearchResult) {
  return record.quote?.viewedAt || record.crmQuote?.viewedAt || null;
}

function quoteStatus(record: CustomerSearchResult) {
  return record.quote?.status || record.crmQuote?.status || null;
}

function visualSource(value: unknown): SalesCallVisualSource | null {
  if (value === "followup_mockup" || value === "crm_quote_image" || value === "trello_mockup" || value === "trello_reference") return value;
  return null;
}

function visualMockupOrder(name: string) {
  const normalized = name.toLowerCase();
  const match =
    normalized.match(/\bmoc[\s_-]*ab[\s_-]*(0?[123])(?:\D|$)/) ||
    normalized.match(/\bmockup[\s_-]*(0?[123])(?:\D|$)/);
  if (match?.[1]) return Number(match[1]) - 1;
  return 9;
}

function sortSalesCallVisualCandidates(candidates: SalesCallVisualCandidate[]) {
  const sourceRank: Record<SalesCallVisualSource, number> = {
    followup_mockup: 0,
    trello_mockup: 1,
    crm_quote_image: 2,
    trello_reference: 3,
  };
  return [...candidates].sort((left, right) => {
    const sourceDiff = sourceRank[left.source] - sourceRank[right.source];
    if (sourceDiff !== 0) return sourceDiff;
    if ((left.source === "followup_mockup" || left.source === "trello_mockup") && left.source === right.source) {
      const orderDiff = visualMockupOrder(left.label) - visualMockupOrder(right.label);
      if (orderDiff !== 0) return orderDiff;
    }
    return left.label.localeCompare(right.label);
  });
}

function mergeSalesCallVisualCandidates(...groups: SalesCallVisualCandidate[][]) {
  const merged: SalesCallVisualCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of groups.flat()) {
    const url = normalizeWhitespace(candidate.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    merged.push({
      url,
      label: normalizeWhitespace(candidate.label) || "Designbild",
      source: candidate.source,
    });
  }
  return sortSalesCallVisualCandidates(merged).slice(0, 8);
}

function normalizeVisualCandidates(value: unknown): SalesCallVisualCandidate[] {
  if (!Array.isArray(value)) return [];
  const candidates: SalesCallVisualCandidate[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const url = normalizeWhitespace(typeof raw.url === "string" ? raw.url : null);
    const source = visualSource(raw.source);
    if (!url || !source || seen.has(url)) continue;
    seen.add(url);
    candidates.push({
      url,
      label: normalizeWhitespace(typeof raw.label === "string" ? raw.label : null) || "Designbild",
      source,
    });
  }
  return sortSalesCallVisualCandidates(candidates).slice(0, 8);
}

export function buildSalesCallVisualCandidates(record: CustomerSearchResult): SalesCallVisualCandidate[] {
  const candidates: SalesCallVisualCandidate[] = [];
  const seen = new Set<string>();
  const pushCandidate = (candidate: SalesCallVisualCandidate) => {
    const url = normalizeWhitespace(candidate.url);
    if (!url || seen.has(url)) return;
    seen.add(url);
    candidates.push({
      url,
      label: normalizeWhitespace(candidate.label) || "Designbild",
      source: candidate.source,
    });
  };

  const sortedMockups = [...(record.trello?.mockups || [])].sort((left, right) => {
    const leftName = left.name.toLowerCase();
    const rightName = right.name.toLowerCase();
    const leftScore = visualMockupOrder(leftName);
    const rightScore = visualMockupOrder(rightName);
    if (leftScore !== rightScore) return leftScore - rightScore;
    return leftName.localeCompare(rightName);
  });

  for (const image of record.followupMockups || []) {
    pushCandidate({
      url: image.url,
      label: image.label,
      source: "followup_mockup",
    });
  }

  for (const asset of sortedMockups) {
    pushCandidate({
      url: asset.proxyUrl,
      label: asset.name,
      source: "trello_mockup",
    });
  }

  for (const [index, image] of (record.crmQuote?.latestVersionImages || []).entries()) {
    if (!image.url) continue;
    pushCandidate({
      url: image.url,
      label: `Angebotsbild ${index + 1}`,
      source: "crm_quote_image",
    });
  }

  if (record.trello?.referenceImage) {
    pushCandidate({
      url: record.trello.referenceImage.proxyUrl,
      label: record.trello.referenceImage.name,
      source: "trello_reference",
    });
  }

  return sortSalesCallVisualCandidates(candidates).slice(0, 8);
}

function trelloAttachmentProxyUrl(cardId: string, attachmentId: string) {
  const params = new URLSearchParams({ cardId, attachmentId });
  return `/api/ops/customer-records/trello-attachments?${params.toString()}`;
}

function listDirectMockupAttachments(attachments: TrelloAttachment[]) {
  return [...attachments]
    .filter(isValidMockupAttachment)
    .sort((left, right) => {
      const leftName = attachmentName(left);
      const rightName = attachmentName(right);
      const orderDiff = visualMockupOrder(leftName) - visualMockupOrder(rightName);
      if (orderDiff !== 0) return orderDiff;
      return leftName.localeCompare(rightName, "de", { numeric: true });
    })
    .slice(0, 6);
}

export function recordTrelloCardIdentifier(record: CustomerSearchResult) {
  return (
    parseTrelloCardIdentifier(record.request?.trelloCardUrl) ||
    normalizeWhitespace(record.request?.trelloCardId) ||
    normalizeWhitespace(record.offerTracking?.trelloCardId)
  );
}

async function buildDirectTrelloVisualCandidates(record: CustomerSearchResult): Promise<SalesCallVisualCandidate[]> {
  const identifier = recordTrelloCardIdentifier(record);
  if (!identifier) return [];
  if (directTrelloVisualCache.has(identifier)) return directTrelloVisualCache.get(identifier) || [];

  const card = await getTrelloCardVisuals(identifier);
  const candidates: SalesCallVisualCandidate[] = listDirectMockupAttachments(card.attachments || []).map((attachment) => ({
    url: trelloAttachmentProxyUrl(card.id, attachment.id),
    label: attachmentName(attachment) || "Mockup",
    source: "trello_mockup",
  }));

  const referenceAttachment = selectReferenceTrelloAttachment(card.attachments || []);
  if (referenceAttachment) {
    candidates.push({
      url: trelloAttachmentProxyUrl(card.id, referenceAttachment.id),
      label: attachmentName(referenceAttachment) || "Referenzbild",
      source: "trello_reference",
    });
  }

  const normalized = mergeSalesCallVisualCandidates(candidates);
  directTrelloVisualCache.set(identifier, normalized);
  return normalized;
}

async function loadDirectTrelloVisualCandidates(records: CustomerSearchResult[], limit = SALES_CALL_LIVE_VISUAL_FALLBACK_LIMIT) {
  const result = new Map<string, SalesCallVisualCandidate[]>();
  const withTrelloIdentifier = records.filter(recordTrelloCardIdentifier).slice(0, limit);
  for (let index = 0; index < withTrelloIdentifier.length; index += SALES_CALL_TRELLO_VISUAL_LOOKUP_CONCURRENCY) {
    const batch = withTrelloIdentifier.slice(index, index + SALES_CALL_TRELLO_VISUAL_LOOKUP_CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((record) => buildDirectTrelloVisualCandidates(record)));
    settled.forEach((entry, batchIndex) => {
      const record = batch[batchIndex];
      if (!record) return;
      if (entry.status === "fulfilled") {
        if (entry.value.length) result.set(record.requestId, entry.value);
        return;
      }
      console.warn("sales call direct trello visual lookup failed", { requestId: record.requestId, error: entry.reason });
    });
  }
  return result;
}

function maybeNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hoursSince(iso: string | null | undefined) {
  if (!iso) return null;
  const parsed = new Date(iso).getTime();
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / (1000 * 60 * 60)));
}

function daysSince(iso: string | null | undefined) {
  const hours = hoursSince(iso);
  if (hours === null) return null;
  return Math.floor(hours / 24);
}

function isMissingRelationError(error: unknown, relation: string) {
  return (
    error instanceof SupabaseRestError &&
    typeof error.details === "string" &&
    (
      error.details.includes(`relation \"${relation}\" does not exist`) ||
      error.details.includes(`Could not find the table 'public.${relation}' in the schema cache`) ||
      error.details.includes(`Could not find the table '${relation}' in the schema cache`)
    )
  );
}

function isMissingColumnError(error: unknown, table: string, column: string) {
  if (!(error instanceof SupabaseRestError)) return false;
  const message = [error.message, error.details].filter(Boolean).join(" ");
  return message.includes(column) && (message.includes(table) || message.includes("schema cache"));
}

function isMissingRpcError(error: unknown, functionName: string) {
  if (!(error instanceof SupabaseRestError)) return false;
  const message = [error.message, error.details].filter(Boolean).join(" ");
  return message.includes(functionName) && (message.includes("schema cache") || message.includes("function"));
}

function isSupabaseTransportError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const cause = error.cause as { code?: string; message?: string } | undefined;
  return (
    error.message === "fetch failed" ||
    cause?.code === "UND_ERR_HEADERS_OVERFLOW" ||
    cause?.message?.includes("Headers Overflow") ||
    cause?.code === "UND_ERR_CONNECT_TIMEOUT" ||
    cause?.code === "UND_ERR_SOCKET"
  );
}

async function insertRows<T>(table: string, rows: Record<string, unknown>[]): Promise<T[]> {
  if (!rows.length) return [];
  return supabaseRequest<T[]>(
    table,
    {
      method: "POST",
      body: JSON.stringify(rows),
      headers: { Prefer: "return=representation" },
    },
  );
}

async function insertSalesCallResultWithOptimisticGuard(
  row: {
    call_list_item_id: string | null;
    rank_at_time: number | null;
    request_id: string;
    ac_deal_id: number | null;
    preset: SalesCallPreset | null;
    call_done: "yes" | "no";
    call_outcome: SalesCallOutcome;
    next_step: string;
    validation_useful: "yes" | "no";
    notes: string;
    operator_id: string | null;
    source: string | null;
  },
  expectedLatestResultId: string | null | undefined,
) {
  const expected = normalizeWhitespace(expectedLatestResultId);
  try {
    const response = await supabaseRpc<SalesCallResultRpcResponse>("ops_record_sales_call_result", {
      p_expected_latest_result_id: expected || null,
      p_call_list_item_id: row.call_list_item_id || null,
      p_rank_at_time: row.rank_at_time,
      p_request_id: row.request_id,
      p_ac_deal_id: row.ac_deal_id,
      p_preset: row.preset,
      p_call_done: row.call_done,
      p_call_outcome: row.call_outcome,
      p_next_step: row.next_step,
      p_validation_useful: row.validation_useful,
      p_notes: row.notes,
      p_operator_id: row.operator_id,
      p_source: row.source,
    });

    if (response?.ok && response.result?.id) {
      return {
        created: response.result,
        supersededResultIds: [] as string[],
        usedRpc: true,
      };
    }

    if (response?.error === "stale_result") {
      throw new QuoteValidationError(
        "Dieser Fall wurde inzwischen aktualisiert. Bitte kurz neu laden und den letzten Stand prüfen.",
        ["Jemand hat nach dem Öffnen dieses Falls bereits ein Ergebnis gespeichert."],
        409,
      );
    }

    throw new SupabaseRestError("Call-Ergebnis konnte nicht gespeichert werden.", 500, response);
  } catch (error) {
    if (!isMissingRpcError(error, "ops_record_sales_call_result")) throw error;
  }

  const previousRows = await supabaseRequest<SalesCallResultRow[]>(SALES_CALL_RESULTS_TABLE, undefined, {
    select:
      "id,request_id,call_list_item_id,rank_at_time,ac_deal_id,preset,call_done,call_outcome,next_step,validation_useful,notes,operator_id,source,created_at,updated_at,superseded_at",
    request_id: `eq.${row.request_id}`,
    superseded_at: "is.null",
    order: "created_at.desc",
    limit: 10,
  });
  const latest = previousRows[0]?.id || "";
  if (latest !== expected) {
    throw new QuoteValidationError(
      "Dieser Fall wurde inzwischen aktualisiert. Bitte kurz neu laden und den letzten Stand prüfen.",
      ["Jemand hat nach dem Öffnen dieses Falls bereits ein Ergebnis gespeichert."],
      409,
    );
  }

  const [created] = await insertRows<SalesCallResultRow>(SALES_CALL_RESULTS_TABLE, [row]);
  if (!created?.id) {
    throw new SupabaseRestError("Call-Ergebnis konnte nicht gespeichert werden.", 500);
  }

  await supabaseRequest(
    SALES_CALL_RESULTS_TABLE,
    {
      method: "PATCH",
      body: JSON.stringify({ superseded_at: created.created_at || new Date().toISOString() }),
      headers: { Prefer: "return=minimal" },
    },
    {
      request_id: `eq.${row.request_id}`,
      superseded_at: "is.null",
      id: `neq.${created.id}`,
    },
  );

  return {
    created,
    supersededResultIds: previousRows.map((previous) => previous.id),
    usedRpc: false,
  };
}

async function upsertCadenceState(state: SalesCallCadenceState) {
  const payload = {
    request_id: state.requestId,
    current_stage: state.currentStage,
    next_call_due_at: state.nextCallDueAt,
    call_1_due_at: state.call1DueAt,
    call_2_due_at: state.call2DueAt,
    call_3_due_at: state.call3DueAt,
    call_1_completed_at: state.call1CompletedAt,
    call_2_completed_at: state.call2CompletedAt,
    call_3_completed_at: state.call3CompletedAt,
    standard_call_count: state.standardCallCount,
    retry_count: state.retryCount,
    cadence_finished: state.cadenceFinished,
    blocked: state.blocked,
    blocking_reason: state.blockingReason,
    pending_callback_at: state.pendingCallbackAt,
    last_result_preset: state.lastResultPreset,
    next_call_action: state.nextCallAction,
    queue_bucket: state.queueBucket,
    priority_tier: state.priorityTier,
    priority_reason: state.priorityReason,
    vip_manual: state.vipManual,
    purchase_signal: state.purchaseSignal,
    updated_at: new Date().toISOString(),
  };
  try {
    const existingRows = await supabaseRequest<SalesCallCadenceStateRow[]>(SALES_CALL_CADENCE_STATE_TABLE, undefined, {
      select: "request_id",
      request_id: `eq.${state.requestId}`,
      limit: 1,
    });
    if (existingRows[0]?.request_id) {
      await supabaseRequest(SALES_CALL_CADENCE_STATE_TABLE, {
        method: "PATCH",
        body: JSON.stringify(payload),
        headers: { Prefer: "return=minimal" },
      }, { request_id: `eq.${state.requestId}` });
      return;
    }
    await insertRows(SALES_CALL_CADENCE_STATE_TABLE, [payload]);
  } catch (error) {
    if (isMissingRelationError(error, SALES_CALL_CADENCE_STATE_TABLE)) return;
    throw error;
  }
}

async function insertSalesCallAuditLog(input: {
  requestId: string;
  actor?: SalesCallActor;
  action: string;
  status: "success" | "info" | "error";
  summary: string;
  extraMetadata?: Record<string, unknown>;
}) {
  await supabaseRequest("workflow_audit_log", {
    method: "POST",
    body: JSON.stringify({
      document_id: input.requestId,
      workflow_name: SALES_CALL_WORKFLOW_NAME,
      action: input.action,
      status: input.status,
      metadata: {
        request_id: input.requestId,
        summary: input.summary,
        actor_label: input.actor?.operatorName || null,
        actor: input.actor || null,
        ...(input.extraMetadata || {}),
      },
    }),
    headers: { Prefer: "return=minimal" },
  });
}

function latestInboundTouchLabel(record: CustomerSearchResult) {
  return (
    record.timeline.find((entry) => entry.direction === "inbound")?.title ||
    record.communications.find((entry) => entry.direction === "inbound")?.title ||
    null
  );
}

function deriveSalesCallGuard(
  record: CustomerSearchResult,
  sourceKeys: CustomerWorkboardSection["key"][],
): SalesCallGuard {
  const attentionReasons: string[] = [];
  const normalizedPhoneQuality = phoneQuality(record.phone || record.originalPhone);
  const callbackAt = record.callOps.nextCallbackAt;
  const callbackTime = callbackAt ? new Date(callbackAt).getTime() : null;

  if (record.opsState.status === "do_not_contact" || record.callOps.contactabilityStatus === "do_not_contact") {
    return {
      allowed: false,
      blockedReason: "Kontaktstopp aktiv",
      attentionReasons: ["Kontaktstopp oder Löschwunsch ist bereits gesetzt."],
      notBefore: null,
      phoneQuality: normalizedPhoneQuality,
    };
  }

  if (record.opsState.isClosed || Boolean(record.order)) {
    return {
      allowed: false,
      blockedReason: "Fall bereits abgeschlossen",
      attentionReasons: ["Für den Fall liegt bereits ein Auftrag oder ein Abschlussstatus vor."],
      notBefore: null,
      phoneQuality: normalizedPhoneQuality,
    };
  }

  if (sourceKeys.includes("recent_replies")) {
    return {
      allowed: false,
      blockedReason: "Antwort zuerst prüfen",
      attentionReasons: ["Es gibt eine frische Antwort. Erst Antwortlage prüfen, dann anrufen."],
      notBefore: null,
      phoneQuality: normalizedPhoneQuality,
    };
  }

  if (callbackTime && callbackTime > Date.now()) {
    return {
      allowed: false,
      blockedReason: "Noch nicht fällig",
      attentionReasons: ["Ein Rückruf ist schon geplant, aber noch nicht fällig."],
      notBefore: callbackAt,
      phoneQuality: normalizedPhoneQuality,
    };
  }

  if (normalizedPhoneQuality === "missing") {
    return {
      allowed: false,
      blockedReason: "Keine Telefonnummer",
      attentionReasons: ["Telefonnummer fehlt. Vor einem Call erst Kontaktdaten klären."],
      notBefore: null,
      phoneQuality: normalizedPhoneQuality,
    };
  }

  if (normalizedPhoneQuality === "weak") {
    attentionReasons.push("Telefonnummer wirkt unvollständig.");
  }
  if (sourceKeys.includes("sales_recovery")) {
    attentionReasons.push("Angebot angesehen, aber noch kein Auftrag verknüpft.");
  }
  if (sourceKeys.includes("callbacks")) {
    attentionReasons.push("Rückruf ist fällig.");
  }
  if (sourceKeys.includes("due_followups")) {
    attentionReasons.push("Offene Erinnerung oder Follow-up ist fällig.");
  }

  return {
    allowed: true,
    blockedReason: null,
    attentionReasons,
    notBefore: null,
    phoneQuality: normalizedPhoneQuality,
  };
}

function derivePriorityGroup(
  sourceKeys: CustomerWorkboardSection["key"][],
  guard: SalesCallGuard,
): string {
  if (!guard.allowed) return "blocked";
  if (sourceKeys.includes("callbacks")) return "callback_due";
  if (sourceKeys.includes("sales_recovery")) return "offer_viewed";
  if (sourceKeys.includes("due_followups")) return "followup_due";
  return "review";
}

function buildPriorityScore(record: CustomerSearchResult, sourceKeys: CustomerWorkboardSection["key"][], guard: SalesCallGuard) {
  if (!guard.allowed) return 0;
  let score = 0;
  if (sourceKeys.includes("callbacks")) score += 100;
  if (sourceKeys.includes("sales_recovery")) score += 90;
  if (sourceKeys.includes("due_followups")) score += 70;
  if (quoteViewedAt(record)) score += 25;
  if (record.salesRecovery.status === "active") score += 15;
  if (record.affectedRows.pendingFollowups > 0) score += 10;
  score += Math.min(20, Math.floor(deriveDealValue(record) / 500));
  return score;
}

function recommendedActionForGroup(priorityGroup: string, guard: SalesCallGuard) {
  if (!guard.allowed) return "review_blocked_case";
  switch (priorityGroup) {
    case "callback_due":
      return "call_callback";
    case "offer_viewed":
      return "call_offer_followup";
    case "followup_due":
      return "call_followup";
    default:
      return "review_case";
  }
}

function buildContextPreview(record: CustomerSearchResult, sourceKeys: CustomerWorkboardSection["key"][], reasons: string[]) {
  const parts = [...reasons];
  const status = quoteStatus(record);
  if (status) parts.push(`Angebotsstatus: ${status}`);
  if (record.request?.acDealStage) parts.push(`AC-Phase: ${record.request.acDealStage}`);
  if (record.callOps.latestLoggedCallSummary) parts.push(`Letzter Anruf: ${record.callOps.latestLoggedCallSummary}`);
  const inbound = latestInboundTouchLabel(record);
  if (inbound) parts.push(`Letzter Eingang: ${inbound}`);
  const viewedAt = quoteViewedAt(record);
  if (sourceKeys.includes("sales_recovery") && viewedAt) {
    parts.push(`Angebot vor ${hoursSince(viewedAt) ?? "?"}h angesehen`);
  }
  return parts.slice(0, 4).join(" • ");
}

function mergeRuntimeSourceKeys(
  sourceKeys: CustomerWorkboardSection["key"][],
  record: CustomerSearchResult,
  activeTasks: SalesTask[] = [],
) {
  const next = new Set<CustomerWorkboardSection["key"]>(sourceKeys);
  if (record.callOps.nextCallbackAt || record.salesRecovery.nextCallbackAt) next.add("callbacks");
  if (quoteSentAt(record) || record.affectedRows.pendingFollowups > 0 || record.affectedRows.nextPendingFollowupAt) {
    next.add("due_followups");
  }
  if (record.salesRecovery.status === "active" || quoteViewedAt(record)) next.add("sales_recovery");
  for (const task of activeTasks) {
    if (task.taskType === "callback_scheduled") {
      next.add("callbacks");
    } else if (
      task.taskType === "call_quote_sent" ||
      task.taskType === "call_reminder_1" ||
      task.taskType === "call_reminder_2" ||
      task.taskType === "call_reminder_3" ||
      task.taskType === "waiting_customer_response"
    ) {
      next.add("due_followups");
    } else if (
      task.taskType === "offer_adjustment" ||
      task.taskType === "send_offer" ||
      task.taskType === "send_update" ||
      task.taskType === "price_review" ||
      task.taskType === "email_reply_needed"
    ) {
      next.add("sales_recovery");
    }
  }
  return [...next];
}

function taskStageRank(taskType: SalesTaskType) {
  switch (taskType) {
    case "call_new_inquiry":
      return 1;
    case "call_quote_sent":
      return 2;
    case "call_reminder_1":
    case "call_reminder_2":
    case "call_reminder_3":
      return 3;
    default:
      return 0;
  }
}

function filterRuntimeActiveTasks(tasks: SalesTask[], cadence: SalesCallCadenceState) {
  const currentRank = stageRank(cadence.currentStage);
  return tasks.filter((task) => {
    const taskRank = taskStageRank(task.taskType);
    if (!taskRank) return true;
    if (!currentRank) return false;
    return taskRank >= currentRank;
  });
}

export function resolveRuntimeSalesCallState(input: {
  record: CustomerSearchResult;
  sourceKeys: CustomerWorkboardSection["key"][];
  latestResult: SalesCallResultEntry | null;
  existingCadence: SalesCallCadenceState | null;
  activeTasks?: SalesTask[];
}) {
  const cadence = deriveCadenceState(input.record, input.latestResult, input.existingCadence);
  const activeTasks = filterRuntimeActiveTasks(input.activeTasks || [], cadence);
  const sourceKeys = mergeRuntimeSourceKeys(input.sourceKeys, input.record, activeTasks);
  const guard = deriveSalesCallGuard(input.record, sourceKeys);
  const priorityGroup = derivePriorityGroup(sourceKeys, guard);
  const priorityScore =
    buildPriorityScore(input.record, sourceKeys, guard) +
    (cadence.priorityTier === "vip" ? 40 : cadence.priorityTier === "important" ? 15 : 0) +
    (cadence.queueBucket === "callbacks" ? 50 : cadence.queueBucket === "vip_today" ? 30 : cadence.queueBucket === "due_today" ? 20 : 0);
  const reasons = guard.allowed
    ? [
        ...guard.attentionReasons,
        sourceKeys.includes("callbacks") ? "Rückrufzeitpunkt stammt aus dem bestehenden Follow-up-Plan." : null,
        sourceKeys.includes("due_followups") ? "Fall liegt bereits in den fälligen Follow-ups." : null,
        sourceKeys.includes("sales_recovery") ? "Verkaufschance ohne verknüpften Auftrag." : null,
        cadence.priorityReason,
      ].filter((value): value is string => Boolean(value))
    : [...guard.attentionReasons];

  return {
    cadence,
    sourceKeys,
    guard,
    priorityGroup,
    priorityScore,
    recommendedAction: recommendedActionForGroup(priorityGroup, guard),
    reasons,
    contextPreview: buildContextPreview(input.record, sourceKeys, reasons),
    activeTasks,
  };
}

function deriveAdHocSourceKeys(record: CustomerSearchResult): CustomerWorkboardSection["key"][] {
  const sourceKeys: CustomerWorkboardSection["key"][] = [];
  if (record.callOps.nextCallbackAt || record.salesRecovery.nextCallbackAt) sourceKeys.push("callbacks");
  if (record.affectedRows.pendingFollowups > 0 || record.affectedRows.nextPendingFollowupAt) sourceKeys.push("due_followups");
  if (record.salesRecovery.status === "active" || quoteViewedAt(record) || quoteSentAt(record)) sourceKeys.push("sales_recovery");
  return [...new Set(sourceKeys)];
}

type CandidatePreview = Omit<SalesCallListItem, "id" | "runId" | "topTen" | "latestResult">;

async function loadCadenceStatesByRequestId(requestIds: string[]) {
  if (!requestIds.length) return new Map<string, SalesCallCadenceState>();
  try {
    const rows = await supabaseRequest<SalesCallCadenceStateRow[]>(SALES_CALL_CADENCE_STATE_TABLE, undefined, {
      select:
        "request_id,current_stage,next_call_due_at,call_1_due_at,call_2_due_at,call_3_due_at,call_1_completed_at,call_2_completed_at,call_3_completed_at,standard_call_count,retry_count,cadence_finished,blocked,blocking_reason,pending_callback_at,last_result_preset,next_call_action,queue_bucket,priority_tier,priority_reason,vip_manual,purchase_signal,updated_at",
      request_id: `in.(${requestIds.join(",")})`,
    });
    return new Map(
      rows
        .filter((row): row is SalesCallCadenceStateRow & { request_id: string } => Boolean(row.request_id))
        .map((row) => [row.request_id, mapCadenceStateRow(row)] as const),
    );
  } catch (error) {
    if (isMissingRelationError(error, SALES_CALL_CADENCE_STATE_TABLE)) {
      return new Map<string, SalesCallCadenceState>();
    }
    throw error;
  }
}

function cutoffIso(daysBack: number) {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - daysBack);
  return cutoff.toISOString();
}

async function loadCandidateRequestIds() {
  const [requestRows, quoteRows, crmQuoteRows, cadenceRows, activeTaskRefs] = await Promise.all([
    supabaseRequest<CandidateRequestRow[]>("master_requests", undefined, {
      select: "request_id,created_at",
      created_at: `gte.${cutoffIso(30)}`,
      order: "created_at.desc",
      limit: 500,
    }),
    supabaseRequest<CandidateQuoteRow[]>("master_quotes", undefined, {
      select: "request_id,sent_at,viewed_at,signed_at,created_at",
      sent_at: `gte.${cutoffIso(30)}`,
      order: "sent_at.desc",
      limit: 500,
    }),
    supabaseRequest<CandidateCrmQuoteRow[]>("crm_quotes", undefined, {
      select: "request_id,sent_at,viewed_at,accepted_at,rejected_at,created_at",
      sent_at: `gte.${cutoffIso(30)}`,
      order: "sent_at.desc",
      limit: 500,
    }),
    (async () => {
      try {
        return await supabaseRequest<SalesCallCadenceStateRow[]>(SALES_CALL_CADENCE_STATE_TABLE, undefined, {
          select: "request_id,next_call_due_at,queue_bucket,updated_at",
          order: "updated_at.desc",
          limit: 200,
        });
      } catch (error) {
        if (isMissingRelationError(error, SALES_CALL_CADENCE_STATE_TABLE)) return [] as SalesCallCadenceStateRow[];
        throw error;
      }
    })(),
    loadActiveSalesTaskRequestIds(500),
  ]);

  const sourceKeysByRequestId = new Map<string, CustomerWorkboardSection["key"][]>();
  const requestIds = new Set<string>();

  const addSourceKey = (requestId: string, key: CustomerWorkboardSection["key"]) => {
    const current = sourceKeysByRequestId.get(requestId) || [];
    if (!current.includes(key)) current.push(key);
    sourceKeysByRequestId.set(requestId, current);
  };

  for (const row of requestRows) {
    if (row.request_id) requestIds.add(row.request_id);
  }
  for (const row of quoteRows) {
    if (!row.request_id || row.signed_at) continue;
    requestIds.add(row.request_id);
    if (row.viewed_at) addSourceKey(row.request_id, "sales_recovery");
    if (row.sent_at) addSourceKey(row.request_id, "due_followups");
  }
  for (const row of crmQuoteRows) {
    if (!row.request_id || row.accepted_at || row.rejected_at) continue;
    requestIds.add(row.request_id);
    if (row.viewed_at) addSourceKey(row.request_id, "sales_recovery");
    if (row.sent_at) addSourceKey(row.request_id, "due_followups");
  }
  for (const row of cadenceRows) {
    if (!row.request_id) continue;
    requestIds.add(row.request_id);
    if (row.queue_bucket === "callbacks") addSourceKey(row.request_id, "callbacks");
  }
  for (const task of activeTaskRefs) {
    requestIds.add(task.requestId);
    if (task.taskType === "callback_scheduled") {
      addSourceKey(task.requestId, "callbacks");
    } else if (
      task.taskType === "call_quote_sent" ||
      task.taskType === "call_reminder_1" ||
      task.taskType === "call_reminder_2" ||
      task.taskType === "call_reminder_3" ||
      task.taskType === "waiting_customer_response"
    ) {
      addSourceKey(task.requestId, "due_followups");
    } else if (
      task.taskType === "offer_adjustment" ||
      task.taskType === "send_offer" ||
      task.taskType === "send_update" ||
      task.taskType === "price_review" ||
      task.taskType === "email_reply_needed"
    ) {
      addSourceKey(task.requestId, "sales_recovery");
    }
  }

  return {
    requestIds: [...requestIds].slice(0, SALES_CALL_CANDIDATE_CONTEXT_LIMIT),
    sourceKeysByRequestId,
  };
}

async function previewSalesCallCandidates(limit = SALES_CALL_PREVIEW_LIMIT): Promise<CandidatePreview[]> {
  const { requestIds, sourceKeysByRequestId } = await loadCandidateRequestIds();
  const records = await loadLightweightSalesCallRecords(requestIds, { includeTrello: false });
  const recordIds = records.map((record) => record.requestId);
  const [latestResultsByRequestId, cadenceByRequestId, activeTasksByRequestId] = await Promise.all([
    loadLatestActiveResultsByRequestId(recordIds),
    loadCadenceStatesByRequestId(recordIds),
    loadActiveSalesTasksByRequestId(recordIds),
  ]);
  const directVisualCandidatesByRequestId = await loadDirectTrelloVisualCandidates(records);

  const candidates = records.map((record) => {
    const sourceKeys = sourceKeysByRequestId.get(record.requestId) || [];
    const latestResult = latestResultsByRequestId.get(record.requestId) || null;
    const activeTasks = activeTasksByRequestId.get(record.requestId) || [];
    const runtime = resolveRuntimeSalesCallState({
      record,
      sourceKeys,
      latestResult,
      existingCadence: cadenceByRequestId.get(record.requestId) || null,
      activeTasks,
    });

    return {
      rank: 0,
      requestId: record.requestId,
      acDealId: record.request?.acDealId ?? null,
      priorityGroup: runtime.priorityGroup,
      priorityScore: runtime.priorityScore,
      recommendedAction: runtime.recommendedAction,
      dealValueEur: deriveDealValue(record),
      reasons: runtime.reasons,
      contextPreview: runtime.contextPreview,
      phoneRaw: record.phone || record.originalPhone || null,
      phoneNormalized: normalizePhone(record.phone || record.originalPhone),
      phoneQuality: runtime.guard.phoneQuality,
      email: record.email || null,
      contactName: record.displayName || [record.firstName, record.lastName].filter(Boolean).join(" ") || null,
      companyName: record.company || record.request?.title || null,
      daysSinceSent: daysSince(quoteSentAt(record)),
      hoursSinceView: hoursSince(quoteViewedAt(record)),
      pandadocStatus: quoteStatus(record),
      acLiveDecision: record.request?.dealStatus || null,
      acLiveStatus: record.request?.status || null,
      acLiveStage: record.request?.acDealStage || null,
      blockedReason: runtime.guard.blockedReason,
      guard: runtime.guard,
      sourceKeys: runtime.sourceKeys,
      visualCandidates: mergeSalesCallVisualCandidates(
        buildSalesCallVisualCandidates(record),
        directVisualCandidatesByRequestId.get(record.requestId) || [],
      ),
      cadence: runtime.cadence,
      activeTasks,
      record,
    };
  });

  return candidates
    .filter((item) => shouldIncludeInDailyCallList(item.record, item.cadence, item.activeTasks || []))
    .sort((left, right) => {
      if (left.guard.allowed !== right.guard.allowed) return left.guard.allowed ? -1 : 1;
      const leftIsTodayInquiry = left.cadence.currentStage === "inquiry_call" && isTodayInBerlin(left.record.request?.createdAt);
      const rightIsTodayInquiry = right.cadence.currentStage === "inquiry_call" && isTodayInBerlin(right.record.request?.createdAt);
      if (leftIsTodayInquiry !== rightIsTodayInquiry) return leftIsTodayInquiry ? -1 : 1;
      const leftIsTodayQuote = left.cadence.currentStage === "quote_call" && isTodayInBerlin(quoteSentAt(left.record));
      const rightIsTodayQuote = right.cadence.currentStage === "quote_call" && isTodayInBerlin(quoteSentAt(right.record));
      if (leftIsTodayQuote !== rightIsTodayQuote) return leftIsTodayQuote ? -1 : 1;
      const leftHasVisibleTask = visibleActiveSalesTasks(left.activeTasks).length > 0;
      const rightHasVisibleTask = visibleActiveSalesTasks(right.activeTasks).length > 0;
      if (leftHasVisibleTask !== rightHasVisibleTask) return leftHasVisibleTask ? -1 : 1;
      if (leftHasVisibleTask && rightHasVisibleTask) {
        const dueDiff = earliestVisibleSalesTaskDueTime(left.activeTasks) - earliestVisibleSalesTaskDueTime(right.activeTasks);
        if (dueDiff !== 0) return dueDiff;
      }
      if (left.cadence.queueBucket !== right.cadence.queueBucket) {
        const bucketOrder = [
          "callbacks",
          "vip_today",
          "due_today",
          "not_reached",
          "manual_followup",
          "offer_adjustment",
          "data_issue",
          "finished",
        ] satisfies SalesCallQueueBucket[];
        return bucketOrder.indexOf(left.cadence.queueBucket) - bucketOrder.indexOf(right.cadence.queueBucket);
      }
      if (left.priorityScore !== right.priorityScore) return right.priorityScore - left.priorityScore;
      if (left.dealValueEur !== right.dealValueEur) return right.dealValueEur - left.dealValueEur;
      return left.requestId.localeCompare(right.requestId);
    })
    .filter((item, index) => index < limit || visibleActiveSalesTasks(item.activeTasks).length > 0)
    .map((item, index) => ({
      ...item,
      rank: index + 1,
    }));
}

function mapResultRow(row: SalesCallResultRow): SalesCallResultEntry {
  return {
    id: row.id,
    callListItemId: row.call_list_item_id || null,
    rankAtTime: row.rank_at_time ?? null,
    requestId: row.request_id || "",
    acDealId: row.ac_deal_id ?? null,
    preset: row.preset || null,
    callDone: row.call_done || "no",
    callOutcome: row.call_outcome || "",
    nextStep: row.next_step || "",
    validationUseful: row.validation_useful || "no",
    notes: row.notes || "",
    operatorId: row.operator_id || null,
    source: row.source || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function buildEmptyCadenceState(requestId: string): SalesCallCadenceState {
  return {
    requestId,
    currentStage: "inquiry_call",
    nextCallDueAt: null,
    call1DueAt: null,
    call2DueAt: null,
    call3DueAt: null,
    call1CompletedAt: null,
    call2CompletedAt: null,
    call3CompletedAt: null,
    standardCallCount: 0,
    retryCount: 0,
    cadenceFinished: false,
    blocked: false,
    blockingReason: null,
    pendingCallbackAt: null,
    lastResultPreset: null,
    nextCallAction: "call_stage_1",
    queueBucket: "due_today",
    priorityTier: "standard",
    priorityReason: null,
    vipManual: false,
    purchaseSignal: false,
    updatedAt: null,
  };
}

function mapCadenceStateRow(row: SalesCallCadenceStateRow): SalesCallCadenceState {
  const requestId = row.request_id || "";
  return {
    requestId,
    currentStage: row.current_stage || "inquiry_call",
    nextCallDueAt: row.next_call_due_at || null,
    call1DueAt: row.call_1_due_at || null,
    call2DueAt: row.call_2_due_at || null,
    call3DueAt: row.call_3_due_at || null,
    call1CompletedAt: row.call_1_completed_at || null,
    call2CompletedAt: row.call_2_completed_at || null,
    call3CompletedAt: row.call_3_completed_at || null,
    standardCallCount: row.standard_call_count ?? 0,
    retryCount: row.retry_count ?? 0,
    cadenceFinished: Boolean(row.cadence_finished),
    blocked: Boolean(row.blocked),
    blockingReason: row.blocking_reason || null,
    pendingCallbackAt: row.pending_callback_at || null,
    lastResultPreset: row.last_result_preset || null,
    nextCallAction: row.next_call_action || "call_stage_1",
    queueBucket: row.queue_bucket || "due_today",
    priorityTier: row.priority_tier || "standard",
    priorityReason: row.priority_reason || null,
    vipManual: Boolean(row.vip_manual),
    purchaseSignal: Boolean(row.purchase_signal),
    updatedAt: row.updated_at || null,
  };
}

function derivePriorityTier(
  record: CustomerSearchResult,
  latestResult: SalesCallResultEntry | null,
  existing: SalesCallCadenceState | null,
): Pick<SalesCallCadenceState, "priorityTier" | "priorityReason" | "vipManual" | "purchaseSignal"> {
  if (existing?.vipManual && existing.priorityTier === "vip") {
    return {
      priorityTier: "vip",
      priorityReason: existing.priorityReason || "Manuell als VIP markiert.",
      vipManual: true,
      purchaseSignal: existing.purchaseSignal,
    };
  }
  if (existing?.priorityTier === "important" && existing.vipManual) {
    return {
      priorityTier: "important",
      priorityReason: existing.priorityReason || "Manuell als wichtig markiert.",
      vipManual: true,
      purchaseSignal: existing.purchaseSignal,
    };
  }
  if (existing?.purchaseSignal) {
    return {
      priorityTier: existing.priorityTier === "standard" ? "important" : existing.priorityTier,
      priorityReason: existing.priorityReason || "Manuelles Kaufsignal im Gespräch.",
      vipManual: existing.vipManual,
      purchaseSignal: true,
    };
  }

  const dealValue = deriveDealValue(record);
  if (
    latestResult &&
    [
      "interested",
      "needs-adjustment",
      "needs-time",
      "wants-lower-price",
      "wants-offer",
      "wants-update",
      "callback",
    ].includes(latestResult.preset || "")
  ) {
    return {
      priorityTier: "important",
      priorityReason: "Aktives Kaufsignal oder klarer nächster Sales-Schritt.",
      vipManual: false,
      purchaseSignal: true,
    };
  }
  if (dealValue >= VIP_VALUE_THRESHOLD) {
    return {
      priorityTier: "important",
      priorityReason: `Angebotswert ab ${VIP_VALUE_THRESHOLD} EUR.`,
      vipManual: false,
      purchaseSignal: false,
    };
  }
  return {
    priorityTier: "standard",
    priorityReason: null,
    vipManual: false,
    purchaseSignal: false,
  };
}

function deriveQueueBucket(
  nextCallDueAt: string | null,
  cadenceFinished: boolean,
  blocked: boolean,
  currentStage: SalesCallCadenceStage,
  priorityTier: SalesCallPriorityTier,
  lastResultPreset: SalesCallPreset | null,
) {
  if (currentStage === "manual_followup") return "manual_followup" as const;
  if (currentStage === "offer_adjustment") return "offer_adjustment" as const;
  if (blocked && currentStage === "callback") return "callbacks" as const;
  if (blocked && currentStage === "data_issue") return "data_issue" as const;
  if (cadenceFinished) return "finished" as const;
  if (lastResultPreset === "not-reached" && nextCallDueAt) return "not_reached" as const;
  if (priorityTier === "vip" && isDueToday(nextCallDueAt)) return "vip_today" as const;
  if (isDueToday(nextCallDueAt)) return "due_today" as const;
  if (currentStage === "callback") return "callbacks" as const;
  return "due_today" as const;
}

function deriveSourceTruthStage(record: CustomerSearchResult): Pick<SalesCallCadenceState, "currentStage" | "nextCallDueAt" | "nextCallAction"> {
  const sentAt = quoteSentAt(record);
  const viewedAt = quoteViewedAt(record);
  if (sentAt && (daysSince(sentAt) ?? 0) >= 3) {
    return {
      currentStage: "no_response_call",
      nextCallDueAt: scheduleNoResponseCall(sentAt, viewedAt),
      nextCallAction: "call_stage_3",
    };
  }
  if (sentAt) {
    return {
      currentStage: "quote_call",
      nextCallDueAt: scheduleQuoteCall(sentAt, viewedAt),
      nextCallAction: "call_stage_2",
    };
  }
  return {
    currentStage: "inquiry_call",
    nextCallDueAt: scheduleInquiryCall(record.request?.createdAt),
    nextCallAction: "call_stage_1",
  };
}

function stageRank(stage: SalesCallCadenceStage) {
  switch (stage) {
    case "inquiry_call":
      return 1;
    case "quote_call":
      return 2;
    case "no_response_call":
      return 3;
    default:
      return 0;
  }
}

function shouldSourceTruthStageOverrideCurrent(current: SalesCallCadenceState, sourceTruth: Pick<SalesCallCadenceState, "currentStage">) {
  if (current.cadenceFinished) return false;
  if (current.currentStage === "callback") return false;
  if (current.currentStage === "manual_followup") return false;
  if (current.currentStage === "offer_adjustment") return false;
  if (current.currentStage === "data_issue") return false;
  if (current.currentStage === "finished") return false;
  return stageRank(sourceTruth.currentStage) > stageRank(current.currentStage);
}

function shouldIncludeInDailyCallList(record: CustomerSearchResult, cadence: SalesCallCadenceState, activeTasks: SalesTask[] = []) {
  if (cadence.currentStage === "finished") return false;
  if (record.opsState.isClosed || Boolean(record.order)) return false;

  if (activeTasks.some(isActiveSalesTaskVisibleNow)) return true;

  const requestToday = isTodayInBerlin(record.request?.createdAt);
  const quoteToday = isTodayInBerlin(quoteSentAt(record));
  if (cadence.currentStage === "inquiry_call" && requestToday) return true;
  if (cadence.currentStage === "quote_call" && quoteToday) return true;

  if (cadence.currentStage === "manual_followup" || cadence.currentStage === "offer_adjustment" || cadence.currentStage === "data_issue") return false;

  return isDueToday(cadence.nextCallDueAt);
}

function visibleActiveSalesTasks(tasks: SalesTask[] | undefined) {
  return (tasks || []).filter(isActiveSalesTaskVisibleNow);
}

function earliestVisibleSalesTaskDueTime(tasks: SalesTask[] | undefined) {
  const visibleTasks = visibleActiveSalesTasks(tasks);
  if (!visibleTasks.length) return Number.POSITIVE_INFINITY;
  return Math.min(
    ...visibleTasks.map((task) => {
      if (!task.dueAt) return 0;
      const dueTime = new Date(task.dueAt).getTime();
      return Number.isFinite(dueTime) ? dueTime : 0;
    }),
  );
}

export function deriveCadenceState(
  record: CustomerSearchResult,
  latestResult: SalesCallResultEntry | null,
  existing: SalesCallCadenceState | null,
): SalesCallCadenceState {
  const priority = derivePriorityTier(record, latestResult, existing);
  const next = existing ? { ...existing } : buildEmptyCadenceState(record.requestId);
  const sentAt = quoteSentAt(record);
  const viewedAt = quoteViewedAt(record);
  const sourceTruthStage = deriveSourceTruthStage(record);
  next.requestId = record.requestId;
  next.call1DueAt = next.call1DueAt || scheduleInquiryCall(record.request?.createdAt);
  next.call2DueAt = next.call2DueAt || scheduleQuoteCall(sentAt, viewedAt);
  next.call3DueAt = next.call3DueAt || scheduleNoResponseCall(sentAt, viewedAt);
  next.priorityTier = priority.priorityTier;
  next.priorityReason = priority.priorityReason;
  next.vipManual = priority.vipManual;
  next.purchaseSignal = priority.purchaseSignal;

  if (record.opsState.status === "do_not_contact" || record.callOps.contactabilityStatus === "do_not_contact") {
    next.blocked = true;
    next.blockingReason = "Kontaktstopp aktiv";
    next.cadenceFinished = true;
    next.currentStage = "finished";
    next.nextCallAction = "blocked_do_not_call";
  } else if (record.opsState.isClosed || Boolean(record.order)) {
    next.blocked = true;
    next.blockingReason = "Fall bereits abgeschlossen";
    next.cadenceFinished = true;
    next.currentStage = "finished";
    next.nextCallAction = record.order ? "closed_won" : "finished_standard_cadence";
  } else if (phoneQuality(record.phone || record.originalPhone) === "missing") {
    next.blocked = true;
    next.blockingReason = "Keine Telefonnummer";
    next.currentStage = "data_issue";
    next.nextCallAction = "blocked_wrong_number";
  }

  if (latestResult?.preset === "wrong-number") {
    next.blocked = true;
    next.blockingReason = "Falsche Nummer";
    next.cadenceFinished = true;
    next.currentStage = "data_issue";
    next.nextCallAction = "blocked_wrong_number";
  } else if (latestResult?.preset === "not-interested") {
    next.blocked = true;
    next.blockingReason = "Kein Interesse";
    next.cadenceFinished = true;
    next.currentStage = "finished";
    next.nextCallAction = "blocked_no_interest";
  } else if (latestResult?.preset === "do-not-call") {
    next.blocked = true;
    next.blockingReason = "Keine weiteren Anrufe gewünscht";
    next.cadenceFinished = true;
    next.currentStage = "finished";
    next.nextCallAction = "blocked_do_not_call";
    next.nextCallDueAt = null;
  } else if (latestResult?.preset === "bought") {
    next.blocked = true;
    next.blockingReason = "Kauf oder Auftrag im Gespräch bestätigt";
    next.cadenceFinished = true;
    next.currentStage = "finished";
    next.nextCallAction = "closed_won";
    next.nextCallDueAt = null;
  } else if (latestResult?.preset === "callback") {
    const callbackDate = latestResult.nextStep.replace(/^callback_/, "");
    next.blocked = true;
    next.blockingReason = "Rückruf vereinbart";
    next.pendingCallbackAt = callbackDate;
    next.nextCallDueAt = callbackDate;
    next.currentStage = "callback";
    next.nextCallAction = "await_callback";
  } else if (latestResult?.preset === "interested") {
    next.blocked = false;
    next.blockingReason = null;
    next.cadenceFinished = true;
    next.currentStage = "manual_followup";
    next.nextCallAction = "manual_sales_followup";
    next.nextCallDueAt = null;
  } else if (latestResult?.preset === "needs-adjustment") {
    next.blocked = false;
    next.blockingReason = null;
    next.cadenceFinished = true;
    next.currentStage = "offer_adjustment";
    next.nextCallAction = "offer_adjustment";
    next.nextCallDueAt = null;
  } else if (latestResult?.preset === "needs-time") {
    const callbackDate = latestResult.nextStep.replace(/^callback_/, "");
    next.blocked = true;
    next.blockingReason = "Kunde braucht noch Zeit";
    next.pendingCallbackAt = callbackDate;
    next.nextCallDueAt = callbackDate;
    next.currentStage = "callback";
    next.nextCallAction = "await_callback";
    next.cadenceFinished = false;
  } else if (latestResult?.preset === "wants-lower-price") {
    next.blocked = false;
    next.blockingReason = null;
    next.cadenceFinished = true;
    next.currentStage = "offer_adjustment";
    next.nextCallAction = "price_review";
    next.nextCallDueAt = null;
  } else if (latestResult?.preset === "wants-offer") {
    next.blocked = false;
    next.blockingReason = null;
    next.cadenceFinished = true;
    next.currentStage = "offer_adjustment";
    next.nextCallAction = "send_offer";
    next.nextCallDueAt = null;
  } else if (latestResult?.preset === "wants-update") {
    next.blocked = false;
    next.blockingReason = null;
    next.cadenceFinished = true;
    next.currentStage = "offer_adjustment";
    next.nextCallAction = "send_update";
    next.nextCallDueAt = null;
  } else if (!next.blocked) {
    if (!existing) {
      next.currentStage = sourceTruthStage.currentStage;
      next.nextCallDueAt = sourceTruthStage.nextCallDueAt;
      next.nextCallAction = sourceTruthStage.nextCallAction;
    } else if (shouldSourceTruthStageOverrideCurrent(next, sourceTruthStage)) {
      next.currentStage = sourceTruthStage.currentStage;
      next.nextCallDueAt = sourceTruthStage.nextCallDueAt;
      next.nextCallAction = sourceTruthStage.nextCallAction;
      next.blocked = false;
      next.blockingReason = null;
      next.cadenceFinished = false;
    }
  }

  next.lastResultPreset = latestResult?.preset || next.lastResultPreset || null;
  next.queueBucket = deriveQueueBucket(
    next.nextCallDueAt,
    next.cadenceFinished,
    next.blocked,
    next.currentStage,
    next.priorityTier,
    next.lastResultPreset,
  );
  return next;
}

export function advanceCadenceStateFromResult(
  current: SalesCallCadenceState,
  result: SalesCallResultEntry,
  input: Pick<SalesCallResultInput, "priorityTier" | "priorityReason" | "purchaseSignal" | "postReminderDecision">,
) {
  const next: SalesCallCadenceState = {
    ...current,
    lastResultPreset: result.preset,
    updatedAt: new Date().toISOString(),
  };

  if (input.priorityTier) {
    next.priorityTier = input.priorityTier;
    next.vipManual = true;
    next.priorityReason = normalizeWhitespace(input.priorityReason) || `Manuell als ${input.priorityTier} markiert.`;
  } else if (input.purchaseSignal) {
    next.purchaseSignal = true;
    if (next.priorityTier === "standard") next.priorityTier = "important";
    next.priorityReason = normalizeWhitespace(input.priorityReason) || "Manuelles Kaufsignal im Gespräch.";
  }

  if (result.callDone === "yes") {
    next.standardCallCount = Math.min(3, current.standardCallCount + 1);
    const completedAt = next.updatedAt;
    if (next.standardCallCount === 1) next.call1CompletedAt = completedAt;
    if (next.standardCallCount === 2) next.call2CompletedAt = completedAt;
    if (next.standardCallCount >= 3) next.call3CompletedAt = completedAt;
  }

  switch (result.preset) {
    case "called-done":
      next.currentStage = "finished";
      next.nextCallDueAt = null;
      next.nextCallAction = "finished_standard_cadence";
      next.blocked = false;
      next.blockingReason = null;
      next.pendingCallbackAt = null;
      next.cadenceFinished = true;
      break;
    case "callback":
    case "needs-time": {
      const callbackDate = result.nextStep.replace(/^callback_/, "");
      next.currentStage = "callback";
      next.pendingCallbackAt = callbackDate;
      next.nextCallDueAt = callbackDate;
      next.nextCallAction = "await_callback";
      next.blocked = true;
      next.blockingReason = result.preset === "needs-time" ? "Kunde braucht noch Zeit" : "Rückruf vereinbart";
      next.cadenceFinished = false;
      break;
    }
    case "not-reached": {
      next.retryCount = current.retryCount + 1;
      next.blocked = false;
      next.blockingReason = null;
      next.pendingCallbackAt = null;
      if (next.standardCallCount >= 3) {
        if (input.postReminderDecision === "manual_followup") {
          next.currentStage = "manual_followup";
          next.nextCallDueAt = null;
          next.nextCallAction = "manual_sales_followup";
          next.cadenceFinished = true;
        } else if (input.postReminderDecision === "offer_adjustment") {
          next.currentStage = "offer_adjustment";
          next.nextCallDueAt = null;
          next.nextCallAction = "offer_adjustment";
          next.cadenceFinished = true;
        } else {
          next.currentStage = "finished";
          next.nextCallDueAt = null;
          next.nextCallAction = "finished_standard_cadence";
          next.cadenceFinished = true;
        }
      } else {
        next.currentStage = current.currentStage;
        next.nextCallDueAt = next.standardCallCount <= 1 ? scheduleRetryFromNow(1) : scheduleRetryFromNow(2);
        next.nextCallAction = next.standardCallCount <= 1 ? "retry_next_day" : "retry_in_2_days";
        next.cadenceFinished = false;
      }
      break;
    }
    case "interested":
      next.currentStage = "manual_followup";
      next.nextCallDueAt = null;
      next.nextCallAction = "manual_sales_followup";
      next.blocked = false;
      next.blockingReason = null;
      next.cadenceFinished = true;
      if (next.priorityTier === "standard") next.priorityTier = "important";
      if (!next.priorityReason) next.priorityReason = "Gespräch mit klarem Kaufsignal.";
      next.purchaseSignal = true;
      break;
    case "needs-adjustment":
      next.currentStage = "offer_adjustment";
      next.nextCallDueAt = null;
      next.nextCallAction = "offer_adjustment";
      next.blocked = false;
      next.blockingReason = null;
      next.cadenceFinished = true;
      if (next.priorityTier === "standard") next.priorityTier = "important";
      if (!next.priorityReason) next.priorityReason = "Angebotsanpassung im Gespräch angefordert.";
      next.purchaseSignal = true;
      break;
    case "wants-lower-price":
      next.currentStage = "offer_adjustment";
      next.nextCallDueAt = null;
      next.nextCallAction = "price_review";
      next.blocked = false;
      next.blockingReason = null;
      next.cadenceFinished = true;
      if (next.priorityTier === "standard") next.priorityTier = "important";
      next.priorityReason = normalizeWhitespace(input.priorityReason) || "Kunde möchte einen günstigeren Preis.";
      next.purchaseSignal = true;
      break;
    case "wants-offer":
      next.currentStage = "offer_adjustment";
      next.nextCallDueAt = null;
      next.nextCallAction = "send_offer";
      next.blocked = false;
      next.blockingReason = null;
      next.cadenceFinished = true;
      if (next.priorityTier === "standard") next.priorityTier = "important";
      next.priorityReason = normalizeWhitespace(input.priorityReason) || "Kunde möchte ein Angebot erhalten.";
      next.purchaseSignal = true;
      break;
    case "wants-update":
      next.currentStage = "offer_adjustment";
      next.nextCallDueAt = null;
      next.nextCallAction = "send_update";
      next.blocked = false;
      next.blockingReason = null;
      next.cadenceFinished = true;
      if (next.priorityTier === "standard") next.priorityTier = "important";
      next.priorityReason = normalizeWhitespace(input.priorityReason) || "Kunde möchte ein Update zum Angebot.";
      next.purchaseSignal = true;
      break;
    case "bought":
      next.currentStage = "finished";
      next.nextCallDueAt = null;
      next.nextCallAction = "closed_won";
      next.blocked = true;
      next.blockingReason = "Kauf oder Auftrag im Gespräch bestätigt";
      next.cadenceFinished = true;
      next.purchaseSignal = true;
      break;
    case "do-not-call":
      next.currentStage = "finished";
      next.nextCallDueAt = null;
      next.nextCallAction = "blocked_do_not_call";
      next.blocked = true;
      next.blockingReason = "Keine weiteren Anrufe gewünscht";
      next.cadenceFinished = true;
      break;
    case "not-interested":
      next.currentStage = "finished";
      next.nextCallDueAt = null;
      next.nextCallAction = "blocked_no_interest";
      next.blocked = true;
      next.blockingReason = "Kein Interesse";
      next.cadenceFinished = true;
      break;
    case "wrong-number":
      next.currentStage = "data_issue";
      next.nextCallDueAt = null;
      next.nextCallAction = "blocked_wrong_number";
      next.blocked = true;
      next.blockingReason = "Falsche Nummer";
      next.cadenceFinished = true;
      break;
    case "review-useful":
      if (current.currentStage === "no_response_call") {
        if (input.postReminderDecision === "offer_adjustment") {
          next.currentStage = "offer_adjustment";
          next.nextCallDueAt = null;
          next.nextCallAction = "offer_adjustment";
          next.cadenceFinished = true;
        } else if (input.postReminderDecision === "finished") {
          next.currentStage = "finished";
          next.nextCallDueAt = null;
          next.nextCallAction = "finished_standard_cadence";
          next.cadenceFinished = true;
        } else {
          next.currentStage = "manual_followup";
          next.nextCallDueAt = null;
          next.nextCallAction = "manual_sales_followup";
          next.cadenceFinished = true;
        }
      } else {
        next.currentStage = "manual_followup";
        next.nextCallDueAt = null;
        next.nextCallAction = "manual_sales_followup";
        next.cadenceFinished = true;
      }
      break;
    case "review-not-useful":
      next.currentStage = "finished";
      next.nextCallDueAt = null;
      next.nextCallAction = "finished_standard_cadence";
      next.cadenceFinished = true;
      break;
  }

  next.queueBucket = deriveQueueBucket(
    next.nextCallDueAt,
    next.cadenceFinished,
    next.blocked,
    next.currentStage,
    next.priorityTier,
    next.lastResultPreset,
  );
  return next;
}

function countBuckets(items: SalesCallListItem[]): Record<SalesCallQueueBucket, number> {
  const counts: Record<SalesCallQueueBucket, number> = {
    due_today: 0,
    vip_today: 0,
    not_reached: 0,
    callbacks: 0,
    manual_followup: 0,
    offer_adjustment: 0,
    data_issue: 0,
    finished: 0,
  };
  for (const item of items) counts[item.cadence.queueBucket] += 1;
  return counts;
}

function countTasks(items: SalesCallListItem[]): SalesCallModuleState["taskCounts"] {
  const tasks = items.flatMap((item) => item.activeTasks || []);
  return {
    open: tasks.filter((task) => task.status === "open").length,
    waiting: tasks.filter((task) => task.status === "waiting").length,
    blocked: tasks.filter((task) => task.status === "blocked").length,
    overdue: tasks.filter((task) => task.dueAt && new Date(task.dueAt).getTime() < Date.now() && task.status !== "done").length,
    emailDriven: tasks.filter((task) => task.source === "inbound_email_signal").length,
  };
}

export function buildFailedSalesCallModuleState(reason = "sales_call_state_unavailable"): SalesCallModuleState {
  return {
    storageReady: false,
    run: {
      id: null,
      runKey: null,
      date: todayInBerlin(),
      timezone: "Europe/Berlin",
      status: "preview",
      startedAt: null,
      finishedAt: null,
      candidateCount: 0,
      eligibleCount: 0,
      blockedCount: 0,
    },
    items: [],
    processedToday: [],
    gate: {
      gate: "red",
      topN: MANUAL_GATE_TOP_N,
      reviewed: 0,
      remainingToReview: 0,
      remainingReviewRanks: [],
      useful: 0,
      notUseful: 0,
      usefulRate: 0,
      concreteNextSteps: 0,
      concreteNextStepValue: 0,
      informativeUseful: 0,
      distinctInformativeNotes: 0,
      clearLearningSignal: false,
      usefulNeededForGreen: 0,
      concreteNextStepsNeededForGreen: 0,
      informativeUsefulNeededForLearningSignal: 0,
      distinctInformativeNotesNeededForLearningSignal: 0,
      criticalDataErrors: 0,
      wrongNumbers: 0,
      validationErrors: [reason],
    },
    completion: {
      technicalStatus: "failed",
      complete: false,
      reason,
      nextRequiredAction:
        "Die Call-Daten konnten gerade nicht geladen werden. Customer Records funktionieren weiter; bitte neu laden oder die Datenquelle prüfen.",
    },
    bucketCounts: countBuckets([]),
    taskCounts: countTasks([]),
  };
}

function mapTaskPriority(priorityTier: SalesCallPriorityTier): SalesTaskPriority {
  return priorityTier === "vip" ? "vip" : priorityTier === "important" ? "important" : "standard";
}

function callTaskTypeForCadence(cadence: SalesCallCadenceState): SalesTaskType | null {
  switch (cadence.currentStage) {
    case "inquiry_call":
      return "call_new_inquiry";
    case "quote_call":
      return "call_quote_sent";
    case "no_response_call":
      return cadence.standardCallCount <= 1 ? "call_reminder_1" : cadence.standardCallCount === 2 ? "call_reminder_2" : "call_reminder_3";
    case "callback":
      return "callback_scheduled";
    case "manual_followup":
      return "manual_followup";
    case "offer_adjustment":
      if (cadence.nextCallAction === "price_review") return "price_review";
      if (cadence.nextCallAction === "send_offer") return "send_offer";
      if (cadence.nextCallAction === "send_update") return "send_update";
      return "offer_adjustment";
    case "data_issue":
      return "blocked_data_issue";
    case "finished":
      return null;
  }
}

export function buildSalesTaskFromCadence(cadence: SalesCallCadenceState, source: "sales_call_candidate" | "sales_call_result", sourceRef?: string | null): SalesTaskDraft | null {
  const taskType = callTaskTypeForCadence(cadence);
  if (!taskType) return null;
  const isWaiting = Boolean(cadence.nextCallDueAt && new Date(cadence.nextCallDueAt).getTime() > Date.now());
  const status = taskType === "blocked_data_issue" ? "blocked" : isWaiting ? "waiting" : "open";
  return {
    requestId: cadence.requestId,
    taskType,
    status,
    title: taskTitle(taskType),
    detail: cadence.blockingReason || cadence.priorityReason || null,
    dueAt: cadence.nextCallDueAt,
    priorityTier: mapTaskPriority(cadence.priorityTier),
    source,
    sourceRef: sourceRef || null,
    idempotencyKey: `${taskType}:${cadence.requestId}`,
    payload: {
      current_stage: cadence.currentStage,
      next_call_action: cadence.nextCallAction,
      queue_bucket: cadence.queueBucket,
      standard_call_count: cadence.standardCallCount,
      retry_count: cadence.retryCount,
      priority_reason: cadence.priorityReason,
    },
  };
}

type RecordOfferSentRpcResponse =
  | {
      ok: true;
      request_id: string;
      offer_event_id: string;
      sales_task_id: string;
      closed_inquiry_tasks: number;
      next_call_due_at: string;
    }
  | {
      ok: false;
      error: string;
      request_id?: string;
    };

export type RecordOfferSentForSalesCallsInput = {
  requestId?: string | null;
  trelloCardId?: string | null;
  offerId: string;
  offerNumber?: string | null;
  documentReference?: string | null;
  publicUrl?: string | null;
  recipientEmail?: string | null;
  sentAt?: string | null;
  source?: string | null;
  sourceEventId?: string | null;
  idempotencyKey?: string | null;
  actor?: string | null;
  payload?: Record<string, unknown>;
};

export async function recordOfferSentForSalesCalls(input: RecordOfferSentForSalesCallsInput) {
  const response = await supabaseRpc<RecordOfferSentRpcResponse>("ops_record_offer_sent", {
    p_request_id: normalizeWhitespace(input.requestId),
    p_trello_card_id: normalizeWhitespace(input.trelloCardId),
    p_offer_id: normalizeWhitespace(input.offerId),
    p_offer_number: normalizeWhitespace(input.offerNumber),
    p_document_reference: normalizeWhitespace(input.documentReference),
    p_public_url: normalizeWhitespace(input.publicUrl),
    p_recipient_email: normalizeWhitespace(input.recipientEmail),
    p_sent_at: normalizeWhitespace(input.sentAt) || new Date().toISOString(),
    p_source: normalizeWhitespace(input.source) || "neontrip_offers",
    p_source_event_id: normalizeWhitespace(input.sourceEventId),
    p_idempotency_key: normalizeWhitespace(input.idempotencyKey),
    p_actor: normalizeWhitespace(input.actor),
    p_payload: input.payload || {},
  });

  if (!response?.ok) {
    throw new QuoteValidationError(
      "Angebot wurde gesendet, aber die Call-Liste konnte nicht aktualisiert werden.",
      [response?.error || "ops_record_offer_sent_failed"],
      502,
    );
  }

  return response;
}

function latestInboundEmailSignal(record: CustomerSearchResult): { signal: InboundEmailSignal; sourceRef: string; preview: string | null } | null {
  const inbound = [...(record.communications || [])]
    .filter((entry) => String(entry.direction || "").toLowerCase() === "inbound")
    .sort((left, right) => new Date(right.occurredAt || 0).getTime() - new Date(left.occurredAt || 0).getTime())[0] || null;
  if (!inbound) return null;
  const signal = classifyInboundEmailSignal({
    subject: inbound.title,
    body: inbound.body || inbound.preview,
    classification: inbound.classification,
  });
  if (!signal) return null;
  return {
    signal,
    sourceRef: inbound.messageId || inbound.conversationId || inbound.id,
    preview: inbound.preview || inbound.body || inbound.title,
  };
}

async function syncSalesTaskFromCandidate(item: Pick<SalesCallListItem, "cadence" | "record">) {
  const emailSignal = latestInboundEmailSignal(item.record);
  if (emailSignal) {
    const task = buildTaskFromInboundEmailSignal({
      requestId: item.cadence.requestId,
      signal: emailSignal.signal,
      sourceRef: emailSignal.sourceRef,
      priorityTier: mapTaskPriority(item.cadence.priorityTier),
      preview: emailSignal.preview,
    });
    await closeSupersededSalesTasksForRequest({
      requestId: item.cadence.requestId,
      keepIdempotencyKey: task.idempotencyKey,
      reason: "inbound_email_signal_supersedes_call_task",
      sourceRef: emailSignal.sourceRef,
    });
    await upsertSalesTask(task);
    return;
  }

  const task = buildSalesTaskFromCadence(item.cadence, "sales_call_candidate");
  if (task) {
    await closeSupersededSalesTasksForRequest({
      requestId: item.cadence.requestId,
      keepIdempotencyKey: task.idempotencyKey,
      reason: `current_stage:${item.cadence.currentStage}`,
    });
    await upsertSalesTask(task);
  }
}

async function syncSalesTaskFromResult(cadence: SalesCallCadenceState, result: SalesCallResultEntry) {
  await closeActiveSalesTasksForRequest({
    requestId: cadence.requestId,
    reason: `sales_call_result:${result.preset || "unknown"}`,
    sourceRef: result.id,
  });
  const task = buildSalesTaskFromCadence(cadence, "sales_call_result", result.id);
  if (task) await upsertSalesTask(task);
}

async function runRefreshSideEffects<T>(
  label: string,
  items: T[],
  batchSize: number,
  worker: (item: T) => Promise<void>,
) {
  let failureCount = 0;
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    const results = await Promise.allSettled(batch.map((item) => worker(item)));
    failureCount += results.filter((result) => result.status === "rejected").length;
  }
  if (failureCount) {
    console.warn("sales call refresh side effects incomplete", {
      label,
      failureCount,
      totalCount: items.length,
    });
  }
  return failureCount;
}

async function loadLightweightSalesCallRecords(
  requestIds: string[],
  options: { includeTrello?: boolean } = {},
): Promise<CustomerSearchResult[]> {
  if (!requestIds.length) return [];
  return listCustomerRecordsByRequestIds(requestIds, { includeTrello: options.includeTrello ?? false });
}

function isActionableSalesCallNote(value: string) {
  const normalized = normalizeNote(value);
  const markerNormalized = normalized.replace(/_/g, " ");
  if (normalized.length < 5) return false;
  if (normalized.startsWith("<") && normalized.endsWith(">")) return false;
  if (markerNormalized.startsWith("bitte ersetzen")) return false;
  if (NON_REAL_OUTCOME_NOTE_RE.test(normalized)) return false;
  if (WEAK_NOTE_VALUES.has(normalized)) return false;
  return !PLACEHOLDER_NOTES.has(normalized);
}

function buildCallbackNextStep(callbackDate: string) {
  return `callback_${callbackDate}`;
}

function isValidCallbackDate(callbackDate: string | null | undefined) {
  const normalized = normalizeWhitespace(callbackDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
  return normalized >= todayInBerlin();
}

function isConcreteSalesNextStep(result: Pick<SalesCallResultEntry, "validationUseful" | "nextStep" | "callOutcome">) {
  if (result.validationUseful !== "yes") return false;
  if (result.nextStep === "send_adjusted_offer") return true;
  return CALLBACK_NEXT_STEP_RE.test(result.nextStep) && result.callOutcome === "reached_callback";
}

function normalizedNoteForLearning(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\W+/g, " ")
    .trim();
}

export function buildSalesCallResultFromPreset(input: SalesCallResultInput): Omit<SalesCallResultEntry, "id" | "createdAt" | "updatedAt"> {
  const requestId = normalizeWhitespace(input.requestId);
  if (!requestId) throw new QuoteValidationError("Request-ID fehlt.");
  const notes = normalizeWhitespace(input.notes);

  const preset = SALES_CALL_PRESETS[input.preset];
  if (!preset) throw new QuoteValidationError("Ungültiger Call-Preset.", ["Waehle einen bekannten Call-Preset."], 400);
  let nextStep: string = preset.nextStep;
  if (preset.nextStep === "callback") {
    if (!isValidCallbackDate(input.callbackDate)) {
      throw new QuoteValidationError("Für diesen Preset ist ein gültiges zukünftiges Rückrufdatum im Format YYYY-MM-DD nötig.");
    }
    nextStep = buildCallbackNextStep(String(input.callbackDate));
  }

  return {
    callListItemId: input.callListItemId || null,
    rankAtTime: null,
    requestId,
    acDealId: null,
    preset: input.preset,
    callDone: preset.callDone,
    callOutcome: preset.callOutcome,
    nextStep,
    validationUseful: preset.validationUseful,
    notes,
    operatorId: input.operatorId || null,
    source: "customer_records_calls_ui",
  };
}

export function evaluateSalesCallGate(
  items: Array<Pick<SalesCallListItem, "rank" | "dealValueEur" | "latestResult">>,
): SalesCallGateSummary {
  const topItems = [...items].sort((left, right) => left.rank - right.rank).slice(0, MANUAL_GATE_TOP_N);
  const reviewed = topItems.filter((item) => item.latestResult && ["yes", "no"].includes(item.latestResult.validationUseful));
  const useful = reviewed.filter((item) => item.latestResult?.validationUseful === "yes");
  const notUseful = reviewed.filter((item) => item.latestResult?.validationUseful === "no");
  const wrongNumbers = reviewed.filter((item) => item.latestResult?.callOutcome === "wrong_number");
  const validationErrors: string[] = [];

  for (const item of topItems) {
    const result = item.latestResult;
    if (!result) continue;
    if (!["yes", "no"].includes(result.callDone)) {
      validationErrors.push(`Rank ${item.rank}: ungültiges call_done`);
    }
    if (!["yes", "no"].includes(result.validationUseful)) {
      validationErrors.push(`Rank ${item.rank}: ungültiges validation_useful`);
    }
    if (result.callDone === "yes" && !result.callOutcome) {
      validationErrors.push(`Rank ${item.rank}: call_outcome fehlt`);
    }
    if (result.callDone === "yes" && !result.nextStep) {
      validationErrors.push(`Rank ${item.rank}: next_step fehlt`);
    }
    if (result.callDone === "no" && !result.nextStep) {
      validationErrors.push(`Rank ${item.rank}: next_step fehlt`);
    }
    if (CALLBACK_NEXT_STEP_RE.test(result.nextStep) && !isValidCallbackDate(result.nextStep.replace(/^callback_/, ""))) {
      validationErrors.push(`Rank ${item.rank}: Rückrufdatum ist ungültig oder liegt in der Vergangenheit`);
    }
  }

  const concreteNextSteps = useful.filter((item) => item.latestResult && isConcreteSalesNextStep(item.latestResult));
  const informativeUseful = useful.filter((item) => item.latestResult?.callOutcome !== "not_reached");
  const distinctInformativeNotes = new Set(
    informativeUseful
      .map((item) => normalizedNoteForLearning(item.latestResult?.notes || ""))
      .filter(Boolean),
  );
  const clearLearningSignal =
    informativeUseful.length >= 7 &&
    distinctInformativeNotes.size >= LEARNING_SIGNAL_MIN_DISTINCT_NOTES &&
    informativeUseful.every((item) => Boolean(item.latestResult?.notes?.trim()));

  let gate: SalesCallGateSummary["gate"];
  if (validationErrors.length) {
    gate = "invalid";
  } else if (reviewed.length < topItems.length) {
    gate = "incomplete";
  } else if (wrongNumbers.length >= 2) {
    gate = "red";
  } else if (
    wrongNumbers.length === 0 &&
    informativeUseful.length >= 7 &&
    (concreteNextSteps.length >= 2 || clearLearningSignal)
  ) {
    gate = "green";
  } else if (informativeUseful.length >= 5) {
    gate = "yellow";
  } else {
    gate = "red";
  }

  return {
    gate,
    topN: MANUAL_GATE_TOP_N,
    reviewed: reviewed.length,
    remainingToReview: Math.max(0, topItems.length - reviewed.length),
    remainingReviewRanks: topItems.filter((item) => !item.latestResult).map((item) => item.rank),
    useful: useful.length,
    notUseful: notUseful.length,
    usefulRate: topItems.length ? useful.length / topItems.length : 0,
    concreteNextSteps: concreteNextSteps.length,
    concreteNextStepValue: concreteNextSteps.reduce((sum, item) => sum + parseNumber(item.dealValueEur), 0),
    informativeUseful: informativeUseful.length,
    distinctInformativeNotes: distinctInformativeNotes.size,
    clearLearningSignal,
    usefulNeededForGreen: Math.max(0, 7 - informativeUseful.length),
    concreteNextStepsNeededForGreen: clearLearningSignal ? 0 : Math.max(0, 2 - concreteNextSteps.length),
    informativeUsefulNeededForLearningSignal: Math.max(0, 7 - informativeUseful.length),
    distinctInformativeNotesNeededForLearningSignal: Math.max(
      0,
      LEARNING_SIGNAL_MIN_DISTINCT_NOTES - distinctInformativeNotes.size,
    ),
    criticalDataErrors: wrongNumbers.length,
    wrongNumbers: wrongNumbers.length,
    validationErrors,
  };
}

export function decideSalesCallCompletion(technicalStatus: "ok" | "pending" | "failed", gate: SalesCallGateSummary): SalesCallCompletionSummary {
  if (technicalStatus === "pending") {
    return {
      technicalStatus,
      complete: false,
      reason: "technical_verification_pending",
      nextRequiredAction: "Liste aktualisieren oder die technische Speicherung aktivieren, bevor der Status bewertet wird.",
    };
  }
  if (technicalStatus !== "ok") {
    return {
      technicalStatus,
      complete: false,
      reason: "technical_verification_failed",
      nextRequiredAction: "Technische Speicherung oder Guard-Reads reparieren, bevor weitere Sales-Ergebnisse bewertet werden.",
    };
  }
  if (gate.gate !== "green") {
    return {
      technicalStatus,
      complete: false,
      reason: `sales_gate_${gate.gate}`,
      nextRequiredAction:
        gate.gate === "invalid"
          ? "Validierungsfehler in den Top-10-Ergebnissen korrigieren."
          : gate.gate === "yellow"
            ? "Top 10 weiter schärfen oder zusätzliche konkrete Sales-Schritte dokumentieren."
            : gate.gate === "red"
              ? "Datenqualität oder Lead-Auswahl überarbeiten, bevor automatisiert weitergearbeitet wird."
              : "Top 10 vollständig prüfen und Ergebnisse erfassen.",
    };
  }
  if (gate.concreteNextSteps < 1) {
    return {
      technicalStatus,
      complete: false,
      reason: "sales_gate_green_without_sales_next_step",
      nextRequiredAction: "Mindestens einen konkreten Sales-Next-Step aus den Top 10 erfassen.",
    };
  }
  return {
    technicalStatus,
    complete: true,
    reason: "sales_gate_green_with_sales_next_step",
    nextRequiredAction: "Kein weiterer Schritt für das aktuelle Ziel nötig.",
  };
}

async function loadLatestActiveResultsByRequestId(requestIds: string[]) {
  if (!requestIds.length) return new Map<string, SalesCallResultEntry>();
  const rows = await supabaseRequest<SalesCallResultRow[]>(SALES_CALL_RESULTS_TABLE, undefined, {
    select:
      "id,call_list_item_id,rank_at_time,request_id,ac_deal_id,preset,call_done,call_outcome,next_step,validation_useful,notes,operator_id,source,created_at,updated_at,superseded_at",
    request_id: `in.(${requestIds.join(",")})`,
    superseded_at: "is.null",
    order: "created_at.desc",
    limit: Math.max(requestIds.length * 3, 20),
  });
  const resultByRequestId = new Map<string, SalesCallResultEntry>();
  for (const row of rows) {
    if (!row.request_id || resultByRequestId.has(row.request_id)) continue;
    resultByRequestId.set(row.request_id, mapResultRow(row));
  }
  return resultByRequestId;
}

async function loadProcessedTodayItems(limit = 40): Promise<SalesCallProcessedTodayItem[]> {
  try {
    const rows = await supabaseRequest<SalesCallResultRow[]>(SALES_CALL_RESULTS_TABLE, undefined, {
      select:
        "id,call_list_item_id,rank_at_time,request_id,ac_deal_id,preset,call_done,call_outcome,next_step,validation_useful,notes,operator_id,source,created_at,updated_at,superseded_at",
      superseded_at: "is.null",
      created_at: `gte.${berlinDayStartIso()}`,
      order: "created_at.desc",
      limit,
    });
    const requestIds = [...new Set(rows.map((row) => row.request_id).filter((value): value is string => Boolean(value)))];
    const [records, cadenceByRequestId] = await Promise.all([
      requestIds.length ? loadLightweightSalesCallRecords(requestIds, { includeTrello: false }) : [],
      requestIds.length ? loadCadenceStatesByRequestId(requestIds) : new Map<string, SalesCallCadenceState>(),
    ]);
    const recordByRequestId = new Map(records.map((record) => [record.requestId, record] as const));
    return rows
      .map((row) => {
        const result = mapResultRow(row);
        const record = row.request_id ? recordByRequestId.get(row.request_id) || null : null;
        return {
          requestId: result.requestId,
          contactName: record?.displayName || record?.request?.title || null,
          companyName: record?.company || null,
          email: record?.email || null,
          latestResult: result,
          cadence: cadenceByRequestId.get(result.requestId) || null,
          record,
        };
      })
      .filter((entry) => Boolean(entry.requestId));
  } catch (error) {
    if (isMissingRelationError(error, SALES_CALL_RESULTS_TABLE)) return [];
    throw error;
  }
}

async function loadLatestTodayRun() {
  const rows = await supabaseRequest<DailyCallRunRow[]>(SALES_CALL_RUNS_TABLE, undefined, {
    select:
      "id,run_key,date,timezone,status,started_at,finished_at,candidate_count,eligible_count,error_count,created_at,updated_at",
    date: `eq.${todayInBerlin()}`,
    order: "created_at.desc",
    limit: 1,
  });
  return rows[0] || null;
}

function isFreshRun(run: DailyCallRunRow | null, seconds = SALES_CALL_REFRESH_COOLDOWN_SECONDS) {
  if (!run?.id) return false;
  const updatedAt = new Date(run.updated_at || run.started_at || run.created_at || 0).getTime();
  return Number.isFinite(updatedAt) && Date.now() - updatedAt <= seconds * 1000;
}

const SALES_CALL_LIST_ITEM_SELECT =
  "id,run_id,rank,request_id,ac_deal_id,priority_group,priority_score,recommended_action,deal_value_eur,reasons_json,context_preview,phone_raw,phone_normalized,phone_quality,email,contact_name,company_name,days_since_sent,hours_since_view,pandadoc_status,ac_live_decision,ac_live_status,ac_live_stage,blocked_reason,source_keys,visual_candidates_json,visual_snapshot_created_at,created_at";

const SALES_CALL_LIST_ITEM_SELECT_WITHOUT_VISUAL_SNAPSHOT =
  "id,run_id,rank,request_id,ac_deal_id,priority_group,priority_score,recommended_action,deal_value_eur,reasons_json,context_preview,phone_raw,phone_normalized,phone_quality,email,contact_name,company_name,days_since_sent,hours_since_view,pandadoc_status,ac_live_decision,ac_live_status,ac_live_stage,blocked_reason,source_keys,created_at";

async function loadSalesCallListItemRows(runId: string) {
  try {
    return await supabaseRequest<DailyCallListItemRow[]>(SALES_CALL_LIST_ITEMS_TABLE, undefined, {
      select: SALES_CALL_LIST_ITEM_SELECT,
      run_id: `eq.${runId}`,
      order: "rank.asc",
      limit: SALES_CALL_RUN_ITEM_LOAD_LIMIT,
    });
  } catch (error) {
    if (
      isMissingColumnError(error, SALES_CALL_LIST_ITEMS_TABLE, "visual_candidates_json") ||
      isMissingColumnError(error, SALES_CALL_LIST_ITEMS_TABLE, "visual_snapshot_created_at")
    ) {
      return supabaseRequest<DailyCallListItemRow[]>(SALES_CALL_LIST_ITEMS_TABLE, undefined, {
        select: SALES_CALL_LIST_ITEM_SELECT_WITHOUT_VISUAL_SNAPSHOT,
        run_id: `eq.${runId}`,
        order: "rank.asc",
        limit: SALES_CALL_RUN_ITEM_LOAD_LIMIT,
      });
    }
    throw error;
  }
}

function buildSalesCallListItemInsertRow(
  runId: string,
  item: CandidatePreview,
  nowIso: string,
  includeVisualSnapshot: boolean,
) {
  return {
    run_id: runId,
    rank: item.rank,
    request_id: item.requestId,
    ac_deal_id: item.acDealId,
    priority_group: item.priorityGroup,
    priority_score: item.priorityScore,
    recommended_action: item.recommendedAction,
    deal_value_eur: item.dealValueEur,
    reasons_json: item.reasons,
    context_preview: item.contextPreview,
    phone_raw: item.phoneRaw,
    phone_normalized: item.phoneNormalized,
    phone_quality: item.phoneQuality,
    email: item.email,
    contact_name: item.contactName,
    company_name: item.companyName,
    days_since_sent: item.daysSinceSent,
    hours_since_view: item.hoursSinceView,
    pandadoc_status: item.pandadocStatus,
    ac_live_decision: item.acLiveDecision,
    ac_live_status: item.acLiveStatus,
    ac_live_stage: item.acLiveStage,
    blocked_reason: item.blockedReason,
    source_keys: item.sourceKeys,
    ...(includeVisualSnapshot
      ? {
          visual_candidates_json: item.visualCandidates,
          visual_snapshot_created_at: nowIso,
        }
      : {}),
  };
}

async function buildModuleStateFromPreview(storageReady: boolean): Promise<SalesCallModuleState> {
  const preview = await previewSalesCallCandidates(SALES_CALL_PREVIEW_LIMIT);
  const requestIds = preview.map((item) => item.requestId);
  let latestResultsByRequestId = new Map<string, SalesCallResultEntry>();
  let cadenceByRequestId = new Map<string, SalesCallCadenceState>();
  let activeTasksByRequestId = new Map<string, SalesTask[]>();
  if (storageReady && requestIds.length) {
    const [results, cadence, tasks] = await Promise.all([
      loadLatestActiveResultsByRequestId(requestIds),
      loadCadenceStatesByRequestId(requestIds),
      loadActiveSalesTasksByRequestId(requestIds),
    ]);
    latestResultsByRequestId = results;
    cadenceByRequestId = cadence;
    activeTasksByRequestId = tasks;
  }
  const items: SalesCallListItem[] = preview.map((item, index) => ({
    ...item,
    id: null,
    runId: null,
    topTen: index < MANUAL_GATE_TOP_N,
    latestResult: latestResultsByRequestId.get(item.requestId) || null,
    ...(() => {
      const runtime = resolveRuntimeSalesCallState({
        record: item.record,
        sourceKeys: item.sourceKeys,
        latestResult: latestResultsByRequestId.get(item.requestId) || null,
        existingCadence: cadenceByRequestId.get(item.requestId) || item.cadence,
        activeTasks: activeTasksByRequestId.get(item.requestId) || [],
      });
      return {
        cadence: runtime.cadence,
        activeTasks: runtime.activeTasks,
      };
    })(),
  }));
  const gate = evaluateSalesCallGate(items);
  const completion = decideSalesCallCompletion(storageReady ? "pending" : "failed", gate);
  const processedToday = storageReady ? await loadProcessedTodayItems() : [];
  return {
    storageReady,
    run: {
      id: null,
      runKey: null,
      date: todayInBerlin(),
      timezone: "Europe/Berlin",
      status: "preview",
      startedAt: null,
      finishedAt: null,
      candidateCount: items.length,
      eligibleCount: items.filter((item) => item.guard.allowed).length,
      blockedCount: items.filter((item) => !item.guard.allowed).length,
    },
    items,
    processedToday,
    gate,
    completion,
    bucketCounts: countBuckets(items),
    taskCounts: countTasks(items),
  };
}

async function buildModuleStateFromRun(runRow: DailyCallRunRow): Promise<SalesCallModuleState> {
  const itemRows = await loadSalesCallListItemRows(runRow.id);

  const requestIds = itemRows
    .map((row) => row.request_id)
    .filter((value): value is string => Boolean(value));
  const [records, latestResultsByRequestId, cadenceByRequestId, activeTasksByRequestId] = await Promise.all([
    loadLightweightSalesCallRecords(requestIds, { includeTrello: false }),
    loadLatestActiveResultsByRequestId(requestIds),
    loadCadenceStatesByRequestId(requestIds),
    loadActiveSalesTasksByRequestId(requestIds),
  ]);

  const recordByRequestId = new Map(records.map((record) => [record.requestId, record] as const));
  const directVisualCandidatesByRequestId = await loadDirectTrelloVisualCandidates(records);

  const items = itemRows
    .filter((row): row is DailyCallListItemRow & { request_id: string; rank: number } => Boolean(row.request_id) && row.rank !== null && row.rank !== undefined)
    .map<SalesCallListItem | null>((row) => {
      const record = recordByRequestId.get(row.request_id);
      if (!record) return null;
      const sourceKeys = (row.source_keys || []) as CustomerWorkboardSection["key"][];
      const guard = deriveSalesCallGuard(record, sourceKeys);
      const snapshotVisualCandidates = normalizeVisualCandidates(row.visual_candidates_json);
      const liveVisualCandidates = directVisualCandidatesByRequestId.get(row.request_id) || [];
      const latestResult = latestResultsByRequestId.get(row.request_id) || null;
      const activeTasks = activeTasksByRequestId.get(row.request_id) || [];
      const runtime = resolveRuntimeSalesCallState({
        record,
        sourceKeys,
        latestResult,
        existingCadence: cadenceByRequestId.get(row.request_id) || null,
        activeTasks,
      });
      return {
        id: row.id,
        runId: row.run_id || null,
        rank: row.rank,
        requestId: row.request_id,
        acDealId: row.ac_deal_id ?? record.request?.acDealId ?? null,
        priorityGroup: runtime.priorityGroup,
        priorityScore: runtime.priorityScore,
        recommendedAction: runtime.recommendedAction,
        dealValueEur: row.deal_value_eur ?? deriveDealValue(record),
        reasons: runtime.reasons.length ? runtime.reasons : row.reasons_json || [],
        contextPreview: runtime.contextPreview || row.context_preview || "",
        phoneRaw: row.phone_raw || record.phone || record.originalPhone || null,
        phoneNormalized: row.phone_normalized || normalizePhone(record.phone || record.originalPhone),
        phoneQuality: runtime.guard.phoneQuality || row.phone_quality || guard.phoneQuality,
        email: row.email || record.email || null,
        contactName: row.contact_name || record.displayName || null,
        companyName: row.company_name || record.company || null,
        daysSinceSent: row.days_since_sent ?? daysSince(quoteSentAt(record)),
        hoursSinceView: row.hours_since_view ?? hoursSince(quoteViewedAt(record)),
        pandadocStatus: row.pandadoc_status || quoteStatus(record),
        acLiveDecision: row.ac_live_decision || record.request?.dealStatus || null,
        acLiveStatus: row.ac_live_status || record.request?.status || null,
        acLiveStage: row.ac_live_stage || record.request?.acDealStage || null,
        blockedReason: runtime.guard.blockedReason || row.blocked_reason || null,
        guard: runtime.guard,
        sourceKeys: runtime.sourceKeys,
        visualCandidates: mergeSalesCallVisualCandidates(
          snapshotVisualCandidates,
          snapshotVisualCandidates.length ? liveVisualCandidates : buildSalesCallVisualCandidates(record),
          liveVisualCandidates,
        ),
        topTen: row.rank <= MANUAL_GATE_TOP_N,
        record,
        latestResult,
        cadence: runtime.cadence,
        activeTasks: runtime.activeTasks,
      };
    })
    .filter((item): item is SalesCallListItem => Boolean(item))
    .filter((item) => shouldIncludeInDailyCallList(item.record, item.cadence, item.activeTasks || []));

  const gate = evaluateSalesCallGate(items);
  const completion = decideSalesCallCompletion("ok", gate);
  const processedToday = await loadProcessedTodayItems();

  return {
    storageReady: true,
    run: {
      id: runRow.id,
      runKey: runRow.run_key || null,
      date: runRow.date || todayInBerlin(),
      timezone: runRow.timezone || "Europe/Berlin",
      status: runRow.status === "completed" ? "completed" : "active",
      startedAt: runRow.started_at || runRow.created_at || null,
      finishedAt: runRow.finished_at || null,
      candidateCount: runRow.candidate_count ?? items.length,
      eligibleCount: runRow.eligible_count ?? items.filter((item) => item.guard.allowed).length,
      blockedCount: runRow.error_count ?? items.filter((item) => !item.guard.allowed).length,
    },
    items,
    processedToday,
    gate,
    completion,
    bucketCounts: countBuckets(items),
    taskCounts: countTasks(items),
  };
}

export async function getSalesCallModuleState(): Promise<SalesCallModuleState> {
  let runRows: DailyCallRunRow[];
  try {
    runRows = await supabaseRequest<DailyCallRunRow[]>(SALES_CALL_RUNS_TABLE, undefined, {
      select:
        "id,run_key,date,timezone,status,started_at,finished_at,candidate_count,eligible_count,error_count,created_at,updated_at",
      order: "created_at.desc",
      limit: 1,
    });
  } catch (error) {
    if (isMissingRelationError(error, SALES_CALL_RUNS_TABLE)) {
      return buildModuleStateFromPreview(false);
    }
    throw error;
  }

  const latestRun = runRows[0];
  if (!latestRun?.id) {
    return buildModuleStateFromPreview(true);
  }
  if (latestRun.date !== todayInBerlin()) {
    return buildModuleStateFromPreview(true);
  }
  const latestRunTime = new Date(latestRun.updated_at || latestRun.started_at || latestRun.created_at || 0).getTime();
  if (Number.isFinite(latestRunTime) && Date.now() - latestRunTime > 2 * 60 * 1000) {
    return buildModuleStateFromPreview(true);
  }

  try {
    return await buildModuleStateFromRun(latestRun);
  } catch (error) {
    if (
      isMissingRelationError(error, SALES_CALL_LIST_ITEMS_TABLE) ||
      isMissingRelationError(error, SALES_CALL_RESULTS_TABLE)
    ) {
      return buildModuleStateFromPreview(false);
    }
    console.warn("sales call stored run unavailable; falling back to preview", {
      runId: latestRun.id,
      error,
    });
    return buildModuleStateFromPreview(false);
  }
}

export async function refreshSalesCallList(actor?: SalesCallActor): Promise<SalesCallModuleState> {
  let latestRun: DailyCallRunRow | null = null;
  try {
    latestRun = await loadLatestTodayRun();
    if (isFreshRun(latestRun)) return buildModuleStateFromRun(latestRun);

    const claimed = await supabaseRpc<boolean>("ops_claim_refresh_lock", {
      p_lock_key: `sales-call-refresh:${todayInBerlin()}`,
      p_cooldown_seconds: SALES_CALL_REFRESH_COOLDOWN_SECONDS,
    });
    if (!claimed) {
      if (latestRun?.id) return buildModuleStateFromRun(latestRun);
      throw new QuoteValidationError("Die Tagesliste wird gerade aktualisiert. Bitte in ein paar Sekunden erneut laden.", [], 409);
    }
  } catch (error) {
    if (isSupabaseTransportError(error) && latestRun?.id) {
      console.warn("sales call refresh lock unavailable; using latest run", {
        runId: latestRun.id,
      });
      return buildModuleStateFromRun(latestRun);
    }
    if (
      !isMissingRpcError(error, "ops_claim_refresh_lock") &&
      !isMissingRelationError(error, "ops_refresh_locks") &&
      !isMissingRelationError(error, SALES_CALL_RUNS_TABLE)
    ) {
      throw error;
    }
  }

  const preview = await previewSalesCallCandidates(SALES_CALL_PREVIEW_LIMIT);
  const nowIso = new Date().toISOString();
  const runKey = `sales-calls:${todayInBerlin()}:${nowIso}`;
  const [run] = await insertRows<DailyCallRunRow>(SALES_CALL_RUNS_TABLE, [
    {
      run_key: runKey,
      date: todayInBerlin(),
      timezone: "Europe/Berlin",
      status: "active",
      started_at: nowIso,
      candidate_count: preview.length,
      eligible_count: preview.filter((item) => item.guard.allowed).length,
      error_count: preview.filter((item) => !item.guard.allowed).length,
    },
  ]);

  if (!run?.id) {
    throw new SupabaseRestError("Tagesliste konnte nicht angelegt werden.", 500);
  }

  try {
    await insertRows(
      SALES_CALL_LIST_ITEMS_TABLE,
      preview.map((item) => buildSalesCallListItemInsertRow(run.id, item, nowIso, true)),
    );
  } catch (error) {
    if (
      isMissingColumnError(error, SALES_CALL_LIST_ITEMS_TABLE, "visual_candidates_json") ||
      isMissingColumnError(error, SALES_CALL_LIST_ITEMS_TABLE, "visual_snapshot_created_at")
    ) {
      await insertRows(
        SALES_CALL_LIST_ITEMS_TABLE,
        preview.map((item) => buildSalesCallListItemInsertRow(run.id, item, nowIso, false)),
      );
    } else {
      throw error;
    }
  }

  const cadenceFailures = await runRefreshSideEffects(
    "cadence_state",
    preview,
    5,
    (item) => upsertCadenceState(item.cadence),
  );
  const taskFailures = await runRefreshSideEffects(
    "sales_tasks",
    preview,
    3,
    (item) => syncSalesTaskFromCandidate(item),
  );

  try {
    await insertSalesCallAuditLog({
      requestId: runKey,
      actor,
      action: SALES_CALL_LIST_REFRESH_ACTION,
      status: cadenceFailures || taskFailures ? "info" : "success",
      summary: cadenceFailures || taskFailures
        ? "Neue Tagesliste erzeugt; nachgelagerte Syncs teilweise übersprungen"
        : "Neue Tagesliste für Sales-Calls erzeugt",
      extraMetadata: {
        run_id: run.id,
        run_key: runKey,
        candidate_count: preview.length,
        eligible_count: preview.filter((item) => item.guard.allowed).length,
        blocked_count: preview.filter((item) => !item.guard.allowed).length,
        cadence_sync_failures: cadenceFailures,
        task_sync_failures: taskFailures,
      },
    });
  } catch (error) {
    console.warn("sales call refresh audit log unavailable", error);
  }

  return buildModuleStateFromRun(run);
}

export async function recordSalesCallResult(input: SalesCallResultInput, actor?: SalesCallActor) {
  const callListItemId = normalizeWhitespace(input.callListItemId);
  const inputRequestId = normalizeWhitespace(input.requestId);
  if (!callListItemId && !inputRequestId) throw new QuoteValidationError("Listen-Eintrag oder Request-ID fehlt.");

  const item = callListItemId
    ? (
        await supabaseRequest<DailyCallListItemRow[]>(SALES_CALL_LIST_ITEMS_TABLE, undefined, {
          select: "id,run_id,rank,request_id,ac_deal_id,source_keys",
          id: `eq.${callListItemId}`,
          limit: 1,
        })
      )[0]
    : null;
  if (callListItemId && !item?.request_id) {
    throw new QuoteValidationError("Listen-Eintrag konnte nicht geladen werden.");
  }

  const requestId = item?.request_id || inputRequestId;
  const [record] = await loadLightweightSalesCallRecords([requestId]);
  if (!record) {
    throw new QuoteValidationError("Fallkontext konnte nicht geladen werden.");
  }
  const derived = buildSalesCallResultFromPreset({
    ...input,
    callListItemId: callListItemId || null,
    requestId,
    operatorId: input.operatorId || actor?.operatorName || null,
  });
  const sourceKeys = item?.source_keys?.length
    ? (item.source_keys as CustomerWorkboardSection["key"][])
    : deriveAdHocSourceKeys(record);
  const liveGuard = deriveSalesCallGuard(record, sourceKeys);
  if (!liveGuard.allowed && input.preset !== "review-not-useful" && input.preset !== "review-useful") {
    throw new QuoteValidationError(`Call ist aktuell gesperrt: ${liveGuard.blockedReason || "nicht anrufbar"}.`);
  }

  const previousStateRows = await (async () => {
    try {
      return await supabaseRequest<SalesCallCadenceStateRow[]>(SALES_CALL_CADENCE_STATE_TABLE, undefined, {
        select:
          "request_id,current_stage,next_call_due_at,call_1_due_at,call_2_due_at,call_3_due_at,call_1_completed_at,call_2_completed_at,call_3_completed_at,standard_call_count,retry_count,cadence_finished,blocked,blocking_reason,pending_callback_at,last_result_preset,next_call_action,queue_bucket,priority_tier,priority_reason,vip_manual,purchase_signal,updated_at",
        request_id: `eq.${requestId}`,
        limit: 1,
      });
    } catch (error) {
      if (isMissingRelationError(error, SALES_CALL_CADENCE_STATE_TABLE)) return [] as SalesCallCadenceStateRow[];
      throw error;
    }
  })();
  const previousStoredCadenceState = previousStateRows[0] ? mapCadenceStateRow(previousStateRows[0]) : null;
  const previousCadenceState = deriveCadenceState(record, null, previousStoredCadenceState);

  const requiresPostReminderDecision =
    previousCadenceState.currentStage === "no_response_call" &&
    ![
      "callback",
      "interested",
      "needs-adjustment",
      "needs-time",
      "wants-lower-price",
      "wants-offer",
      "wants-update",
      "bought",
      "do-not-call",
      "not-interested",
      "wrong-number",
    ].includes(input.preset);
  if (requiresPostReminderDecision && !input.postReminderDecision) {
    throw new QuoteValidationError("Bitte festlegen, wie der Fall nach Call 3 weiterlaufen soll.", [
      "Waehle nach dem Reminder-Call eine Folgeaktion: manuell weiterfuehren, Angebot anpassen oder beenden.",
    ], 400);
  }

  const { created, supersededResultIds, usedRpc } = await insertSalesCallResultWithOptimisticGuard(
    {
      call_list_item_id: callListItemId,
      rank_at_time: item?.rank ?? null,
      request_id: requestId,
      ac_deal_id: item?.ac_deal_id ?? record.request?.acDealId ?? null,
      preset: derived.preset,
      call_done: derived.callDone,
      call_outcome: derived.callOutcome,
      next_step: derived.nextStep,
      validation_useful: derived.validationUseful,
      notes: derived.notes,
      operator_id: derived.operatorId,
      source: derived.source,
    },
    input.expectedLatestResultId ?? null,
  );

  await insertSalesCallAuditLog({
    requestId,
    actor,
    action: SALES_CALL_RESULT_RECORDED_ACTION,
    status: "success",
    summary: `Sales-Call-Ergebnis gespeichert: ${input.preset}`,
    extraMetadata: {
      call_list_item_id: callListItemId,
      ad_hoc: !callListItemId,
      rank_at_time: item?.rank ?? null,
      preset: input.preset,
      next_step: derived.nextStep,
      validation_useful: derived.validationUseful,
      expected_latest_result_id: input.expectedLatestResultId || null,
      storage_mode: usedRpc ? "rpc" : "rest_fallback",
      superseded_result_ids: supersededResultIds,
    },
  });

  const nextCadenceState = advanceCadenceStateFromResult(
    previousCadenceState,
    mapResultRow(created),
    {
      priorityTier: input.priorityTier || null,
      priorityReason: input.priorityReason || null,
      purchaseSignal: input.purchaseSignal || null,
      postReminderDecision: input.postReminderDecision || null,
    },
  );
  await upsertCadenceState(nextCadenceState);
  await syncSalesTaskFromResult(nextCadenceState, mapResultRow(created));

  const state = await getSalesCallModuleState();
  return {
    itemId: callListItemId || null,
    result: mapResultRow(created),
    gate: state.gate,
    completion: state.completion,
    record,
  };
}
