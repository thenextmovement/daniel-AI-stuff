import {
  getCustomerRecordByRequestId,
  listCustomerRecordsByOfferBridge,
  searchCustomerRecords,
  type CustomerSearchResult,
  type CustomerSpecialCaseKind,
  type CustomerTimelineEntry,
} from "@/lib/ops/customer-records";
import { classifyAutomationIssueText, isBlockingAutomationIssueKey } from "@/lib/ops/automation-issues";
import {
  getOfferById,
  getOfferByTrelloCardId,
  searchOffers,
  type OpsOfferApiError,
  type OpsOfferSearchResult,
  type OpsOfferSnapshot,
} from "@/lib/ops/offers";
import {
  getTrelloFailureContext,
  type TrelloFailureContext,
  type TrelloFailureContextAction,
} from "@/lib/quotes/trello";
import { SupabaseRestError, supabaseRequest } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export type CompanyBrainIdentifierType =
  | "request_id"
  | "offer_number"
  | "offer_id"
  | "email"
  | "trello_card_id"
  | "shopify_order"
  | "tracking_number"
  | "free_text";

export type CompanyBrainIdentifier = {
  type: CompanyBrainIdentifierType;
  label: string;
  value: string;
  confidence: "high" | "medium" | "low";
  href: string | null;
};

export type CompanyBrainEvidence = {
  id: string;
  source: string;
  title: string;
  detail: string | null;
  occurredAt: string | null;
  direction: "inbound" | "outbound" | "internal" | "system";
  href: string | null;
  confidence: "high" | "medium" | "low";
};

export type CompanyBrainRecordSummary = {
  requestId: string;
  displayName: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  title: string | null;
  requestedSize: string | null;
  requestedColors: string[];
  trelloCardId: string | null;
  trelloCardUrl: string | null;
  latestOfferSentAt: string | null;
  latestOfferViewedAt: string | null;
  latestOfferSignedAt: string | null;
  latestOrderNumber: string | null;
  latestOrderStatus: string | null;
  latestOutboundAt: string | null;
  latestInboundAt: string | null;
  communicationsCount: number;
  timelineCount: number;
};

export type CompanyBrainOfferSummary = {
  offerId: string;
  requestId?: string | null;
  offerNumber: string | null;
  documentReference: string;
  publicUrl: string | null;
  status: string;
  customerName: string | null;
  customerEmail: string | null;
  projectTitle: string | null;
  trelloCardId: string | null;
  updatedAt: string | null;
  viewedAt: string | null;
  acceptedAt: string | null;
  itemCount: number;
  imageCount: number;
  selectedItemCount: number;
  designEvidenceCount: number;
  productHints: string[];
  colorHints: string[];
  selectedItems: Array<{
    title: string;
    section: string | null;
    description: string | null;
    quantity: number;
    unitPriceNet: number;
  }>;
  imageEvidence: Array<{
    title: string | null;
    kind: string;
    enabled: boolean;
    linkedItemTitle: string | null;
  }>;
};

export type CompanyBrainDiagnostic = {
  source: "customer_records" | "offers" | "offer_bridge" | "workflow_audit" | "integration_readiness" | "trello_live" | "outlook_live" | "coolify_live";
  ok: boolean;
  label: string;
  detail: string | null;
  count: number;
};

export type CompanyBrainFinding = {
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  source: string | null;
};

export type CompanyBrainCaseEvent = {
  id: string;
  category: "customer_message" | "offer" | "order" | "automation" | "trello" | "design" | "internal";
  label: string;
  summary: string;
  occurredAt: string | null;
  source: string;
  direction: CompanyBrainEvidence["direction"];
  href: string | null;
  confidence: CompanyBrainEvidence["confidence"];
  evidenceIds: string[];
};

export type CompanyBrainAsset = {
  id: string;
  kind: "reference_image" | "mockup" | "offer_image" | "video" | "followup_mockup" | "pdf" | "other";
  label: string;
  source: "trello" | "offers" | "customer_records" | "outlook_mirror";
  href: string | null;
  linkedTo: string | null;
  status: "available" | "metadata_only" | "missing";
  evidenceIds: string[];
};

export type CompanyBrainCrossCheck = {
  key: "color_match" | "offer_sent" | "design_count" | "product_type" | "customer_confirmation" | "order_link";
  label: string;
  status: "pass" | "review" | "fail" | "unknown";
  severity: "info" | "warning" | "critical";
  expected: string | null;
  actual: string | null;
  summary: string;
  evidenceIds: string[];
};

export type CompanyBrainIntegrationReadiness = {
  key: "live_outlook" | "n8n_live" | "coolify";
  label: string;
  status: "configured" | "partial" | "missing";
  summary: string;
  detail: string | null;
};

export type CompanyBrainWatcher = {
  key:
    | "offer_without_send_proof"
    | "customer_reply_without_task"
    | "order_without_color_confirmation"
    | "automation_failed"
    | "missing_live_outlook"
    | "missing_design_assets"
    | "trello_trigger_failure";
  severity: "info" | "warning" | "critical";
  status: "open" | "ok";
  title: string;
  detail: string;
  actionKey: string | null;
};

export type CompanyBrainProblemType =
  | "color_dispute"
  | "damaged_sign"
  | "offer_not_sent"
  | "customer_waiting"
  | "design_unclear"
  | "delivery_problem"
  | "payment_order_unclear"
  | "automation_failed"
  | "other";

export type CompanyBrainEvidenceScore = {
  status: "strong" | "medium" | "weak" | "conflicting";
  score: number;
  summary: string;
  safeToAnswerCustomer: boolean;
  reasons: string[];
};

export type CompanyBrainProblemResolution = {
  problemType: CompanyBrainProblemType;
  label: string;
  severity: "info" | "warning" | "critical";
  confidence: "high" | "medium" | "low";
  specialCaseKind: CustomerSpecialCaseKind;
  rootCause: string;
  recommendedResolution: string;
  internalTaskTitle: string;
  internalTaskDescription: string;
  customerReplyPolicy: string[];
  escalationPath: string[];
  requiredEvidence: string[];
  missingEvidence: string[];
};

export type CompanyBrainActionProposal = {
  key:
    | "copy_reply_draft"
    | "open_problem_case"
    | "create_internal_task"
    | "save_case_note"
    | "verify_live_outlook"
    | "open_offer_admin"
    | "inspect_n8n_run"
    | "collect_design_assets"
    | "prepare_email_correction"
    | "correct_customer_email"
    | "post_trello_status_comment"
    | "prepare_offer_retry"
    | "guarded_offer_resend";
  label: string;
  type: "copy" | "manual_check" | "prepared_task" | "open_link";
  riskLevel: "low" | "medium" | "high";
  approvalRequired: boolean;
  enabled: boolean;
  summary: string;
  confirmationText: string;
  href: string | null;
  payloadPreview: string[];
};

export type CompanyBrainRetryAssessment = {
  status: "ready" | "needs_fix" | "blocked" | "not_applicable";
  label: string;
  summary: string;
  recipientEmail: string | null;
  offerId: string | null;
  offerNumber: string | null;
  idempotencyKey: string | null;
  canSendWithConfirmation: boolean;
  blockers: string[];
  safeFixes: string[];
};

export type CompanyBrainCheck = {
  key: "offer_sent" | "color" | "design" | "product_type" | "customer_reply" | "order";
  label: string;
  status: "verified" | "warning" | "missing" | "unknown";
  summary: string;
  evidenceIds: string[];
};

export type CompanyBrainSourceHealth = {
  key:
    | "customer_records"
    | "offers"
    | "offer_bridge"
    | "outlook_mirror"
    | "workflow_audit"
    | "shopify"
    | "trello"
    | "evidence";
  label: string;
  status: "ok" | "partial" | "missing" | "error";
  summary: string;
  count: number;
  lastSeenAt: string | null;
  detail: string | null;
};

export type CompanyBrainAutomationRun = {
  id: string;
  workflowName: string | null;
  action: string | null;
  status: string | null;
  error: string | null;
  createdAt: string | null;
  requestId: string | null;
  executionId: string | null;
  executionUrl?: string | null;
  correlationId: string | null;
  sourceEventId: string | null;
  targetRecordId: string | null;
  failedNode: string | null;
  idempotencyKey: string | null;
  retrySafety: string | null;
  summary: string | null;
};

export type CompanyBrainTrelloFailureDiagnosis = {
  requested: boolean;
  status: "not_requested" | "not_configured" | "loaded" | "error";
  severity: "info" | "warning" | "critical";
  expectedAction: "offer_send" | "internal_followup" | "unknown";
  card: {
    id: string;
    shortLink: string | null;
    name: string | null;
    descriptionPreview: string | null;
    url: string | null;
    currentListName: string | null;
    dateLastActivity: string | null;
    attachmentsCount: number;
    customFields: Array<{
      name: string;
      value: string;
    }>;
  } | null;
  triggerMove: {
    id: string;
    occurredAt: string | null;
    fromListName: string | null;
    toListName: string | null;
  } | null;
  rootCauseKey:
    | "not_requested"
    | "trello_not_configured"
    | "trello_error"
    | "no_trigger_move"
    | "no_source_record"
    | "offer_missing"
    | "offer_exists_no_send_proof"
    | "automation_failed"
    | "automation_missing"
    | "sent"
    | "undetermined";
  rootCause: string;
  recommendedFix: string;
  evidenceStrength: "strong" | "medium" | "weak" | "conflicting";
  duplicateRisk: "low" | "medium" | "high";
  safeFixes: string[];
  blockedFixes: string[];
  timeline: Array<{
    id: string;
    label: string;
    occurredAt: string | null;
    detail: string;
  }>;
  diagnostics: string[];
};

export type CompanyBrainDossierSection = {
  title: string;
  lines: string[];
};

export type CompanyBrainDossier = {
  title: string;
  generatedAt: string;
  confidence: "high" | "medium" | "low";
  sections: CompanyBrainDossierSection[];
  copyText: string;
};

export type CompanyBrainReplyDraft = {
  title: string;
  riskLevel: "low" | "medium" | "high";
  approvalRequired: true;
  canSendAutomatically: false;
  subject: string;
  body: string;
  blockers: string[];
  sourceEvidenceIds: string[];
};

export type CompanyBrainResolveInput = {
  query: string;
  question?: string | null;
  problemType?: CompanyBrainProblemType | null;
  limit?: number | null;
};

export type CompanyBrainResolveResult = {
  query: string;
  question: string | null;
  problemType: CompanyBrainProblemType | null;
  generatedAt: string;
  mode: "deterministic_read_only";
  identifiers: CompanyBrainIdentifier[];
  answer: {
    verdict: "found" | "partial" | "not_found";
    confidence: "high" | "medium" | "low";
    headline: string;
    bullets: string[];
  };
  records: CompanyBrainRecordSummary[];
  offers: CompanyBrainOfferSummary[];
  caseEvents: CompanyBrainCaseEvent[];
  assets: CompanyBrainAsset[];
  crossChecks: CompanyBrainCrossCheck[];
  integrationReadiness: CompanyBrainIntegrationReadiness[];
  watchers: CompanyBrainWatcher[];
  actionProposals: CompanyBrainActionProposal[];
  retryAssessment: CompanyBrainRetryAssessment;
  evidenceScore: CompanyBrainEvidenceScore;
  problemResolution: CompanyBrainProblemResolution;
  checks: CompanyBrainCheck[];
  sourceHealth: CompanyBrainSourceHealth[];
  automationRuns: CompanyBrainAutomationRun[];
  trelloFailureDiagnosis: CompanyBrainTrelloFailureDiagnosis;
  dossier: CompanyBrainDossier;
  replyDraft: CompanyBrainReplyDraft;
  evidence: CompanyBrainEvidence[];
  conflicts: CompanyBrainFinding[];
  gaps: CompanyBrainFinding[];
  diagnostics: CompanyBrainDiagnostic[];
  nextActions: string[];
};

const MAX_QUERY_LENGTH = 240;
const DEFAULT_LIMIT = 5;
const COLOR_WORDS = [
  "blau",
  "blue",
  "rot",
  "red",
  "gruen",
  "green",
  "grün",
  "pink",
  "rosa",
  "weiss",
  "weiß",
  "white",
  "warmweiss",
  "warmweiß",
  "kaltweiss",
  "kaltweiß",
  "gelb",
  "yellow",
  "orange",
  "lila",
  "purple",
  "violett",
  "schwarz",
  "black",
  "rgb",
];

const COLOR_GROUPS: Record<string, string[]> = {
  blau: ["blau", "blue"],
  rot: ["rot", "red"],
  gruen: ["gruen", "green", "grün"],
  pink: ["pink", "rosa"],
  weiss: ["weiss", "weiß", "white", "warmweiss", "warmweiß", "kaltweiss", "kaltweiß"],
  gelb: ["gelb", "yellow"],
  orange: ["orange"],
  lila: ["lila", "purple", "violett"],
  schwarz: ["schwarz", "black"],
  rgb: ["rgb"],
};

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))];
}

function clampLimit(value: number | null | undefined) {
  if (!Number.isFinite(value || 0)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(10, Number(value)));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unbekannter Fehler.";
}

function latestIso(values: Array<string | null | undefined>) {
  const times = values
    .map((value) => (value ? new Date(value).getTime() : 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => right - left);
  return times[0] ? new Date(times[0]).toISOString() : null;
}

function metadataText(metadata: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!metadata) return null;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" || typeof value === "number") {
      const normalized = cleanText(value);
      if (normalized) return normalized;
    }
  }
  return null;
}

function pushIdentifier(
  identifiers: CompanyBrainIdentifier[],
  type: CompanyBrainIdentifierType,
  label: string,
  value: string,
  confidence: CompanyBrainIdentifier["confidence"],
  href: string | null = null,
) {
  const normalized = cleanText(value);
  if (!normalized) return;
  const exists = identifiers.some((entry) => entry.type === type && entry.value.toLowerCase() === normalized.toLowerCase());
  if (!exists) identifiers.push({ type, label, value: normalized, confidence, href });
}

export function normalizeCompanyBrainQuery(query: string) {
  return cleanText(query).slice(0, MAX_QUERY_LENGTH);
}

export function extractCompanyBrainIdentifiers(query: string): CompanyBrainIdentifier[] {
  const normalized = normalizeCompanyBrainQuery(query);
  const identifiers: CompanyBrainIdentifier[] = [];
  const lower = normalized.toLowerCase();

  for (const match of normalized.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)) {
    pushIdentifier(identifiers, "email", "E-Mail", match[0].toLowerCase(), "high", null);
  }

  for (const match of normalized.matchAll(/\bAN[-\s]?\d{3,}\b/gi)) {
    pushIdentifier(identifiers, "offer_number", "Angebotsnummer", match[0].replace(/\s+/g, "-").toUpperCase(), "high", null);
  }

  for (const match of normalized.matchAll(/\b(?:REQ|REQUEST)[-_]?[A-Z0-9-]{4,}\b/gi)) {
    pushIdentifier(identifiers, "request_id", "Request-ID", match[0], "high", null);
  }

  for (const match of normalized.matchAll(/\b(?:trello:)?([a-f0-9]{24}|[A-Za-z0-9]{8})\b/g)) {
    const value = match[1] || match[0];
    if (lower.includes("trello") || value.length === 24) {
      pushIdentifier(identifiers, "trello_card_id", "Trello-ID", value, "medium", null);
    }
  }

  for (const match of normalized.matchAll(/\b(?:#|order\s*)?(\d{4,8})\b/gi)) {
    if (lower.includes("shopify") || lower.includes("bestellung") || lower.includes("order")) {
      pushIdentifier(identifiers, "shopify_order", "Bestellung", match[1] || match[0], "medium", null);
    }
  }

  for (const match of normalized.matchAll(/\b([A-Z]{2}\d{9}[A-Z]{2}|1Z[A-Z0-9]{16}|[A-Z0-9]{10,32})\b/gi)) {
    if (lower.includes("tracking") || lower.includes("sendung") || lower.includes("paket")) {
      pushIdentifier(identifiers, "tracking_number", "Tracking", match[1] || match[0], "medium", null);
    }
  }

  if (!identifiers.length && normalized) {
    pushIdentifier(identifiers, "free_text", "Freitext", normalized, "low", null);
  }

  return identifiers;
}

function trelloCardLookupFromValue(value: unknown) {
  const text = cleanText(value);
  if (!text) return null;
  const urlMatch = text.match(/trello\.com\/c\/([A-Za-z0-9]+)/i);
  if (urlMatch?.[1]) return urlMatch[1];
  const explicitMatch = text.match(/\btrello:([A-Za-z0-9]{8}|[a-f0-9]{24})\b/i);
  if (explicitMatch?.[1]) return explicitMatch[1];
  const longId = text.match(/\b[a-f0-9]{24}\b/i);
  if (longId?.[0]) return longId[0];
  return null;
}

function companyBrainTrelloRequested(query: string, question: string | null, problemType: CompanyBrainProblemType | null) {
  const text = `${query} ${question || ""}`.toLowerCase();
  return Boolean(trelloCardLookupFromValue(query)) ||
    text.includes("trello") ||
    problemType === "offer_not_sent" ||
    problemType === "automation_failed";
}

function primaryTrelloLookup(input: {
  query: string;
  identifiers: CompanyBrainIdentifier[];
  records?: CompanyBrainRecordSummary[];
}) {
  const queryLookup = trelloCardLookupFromValue(input.query);
  if (queryLookup) return queryLookup;
  const identifierLookup = input.identifiers.find((entry) => entry.type === "trello_card_id")?.value;
  if (identifierLookup) return identifierLookup;
  for (const record of input.records || []) {
    const lookup = trelloCardLookupFromValue(record.trelloCardId) || trelloCardLookupFromValue(record.trelloCardUrl);
    if (lookup) return lookup;
  }
  return null;
}

function previewText(value: unknown, maxLength = 360) {
  const text = cleanText(value);
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function trelloCustomFieldEntries(context: TrelloFailureContext) {
  return Object.entries(context.card.customFields || {})
    .map(([name, value]) => ({
      name: cleanText(name),
      value: previewText(value, 160),
    }))
    .filter((entry): entry is { name: string; value: string } => Boolean(entry.name && entry.value))
    .slice(0, 10);
}

function extractTrelloAutomationExecutionIds(context: TrelloFailureContext | null) {
  if (!context) return [];
  const texts = [
    context.card.name,
    context.card.desc,
    ...context.actions.flatMap((action) => [action.text, action.id]),
  ];
  const ids: string[] = [];
  for (const text of texts) {
    const normalized = cleanText(text);
    if (!normalized) continue;
    const executionMatches = normalized.matchAll(/(?:execution|ausfuehrung|ausführung|run)\s*[:#-]?\s*([0-9]{4,})/gi);
    for (const match of executionMatches) ids.push(match[1]);
    const n8nMatches = normalized.matchAll(/\/executions?\/([0-9]{4,})/gi);
    for (const match of n8nMatches) ids.push(match[1]);
  }
  return uniqueStrings(ids);
}

function requestIdFromTrelloContext(context: TrelloFailureContext) {
  const candidates = [
    context.card.customFields?.Nerdy_Forms_ID,
    context.card.customFields?.NerdyForms_ID,
    context.card.customFields?.["Nerdy-Forms_ID"],
    context.card.customFields?.Request_ID,
    context.card.customFields?.["Request-ID"],
    context.card.desc,
  ];
  for (const candidate of candidates) {
    const text = cleanText(candidate);
    if (!text) continue;
    const direct = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
    if (direct) return direct;
  }
  return null;
}

function trelloActionLooksFailed(action: TrelloFailureContextAction) {
  return /fehler|fehlgeschlagen|failed|error|nicht rausgeschickt|nicht versendet|nicht gesendet/i.test(`${action.text || ""} ${action.type || ""}`);
}

function trelloActionFailureSummary(action: TrelloFailureContextAction) {
  const text = cleanText(action.text);
  if (!text) return "Trello-Historie meldet einen Automation-Fehler.";
  const reason = text.match(/(?:Grund|Reason)\s*:\s*([^\n]+)/i)?.[1];
  if (reason) return `Trello-Historie meldet Automation-Fehler: ${reason.trim()}`;
  return previewText(text.replace(/\\n/g, " "), 220) || "Trello-Historie meldet einen Automation-Fehler.";
}

function n8nExecutionUrl(executionId: string | null | undefined, explicitUrl?: string | null) {
  const direct = cleanText(explicitUrl).slice(0, 500);
  if (/^https?:\/\//i.test(direct)) return direct;
  const id = cleanText(executionId).slice(0, 120);
  if (!id) return null;
  const rawBaseUrl = cleanText(process.env.N8N_BASE_URL || process.env.N8N_API_URL || "").slice(0, 500)
    .replace(/\/api\/v1$/i, "")
    .replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(rawBaseUrl)) return null;
  return `${rawBaseUrl}/execution/${encodeURIComponent(id)}`;
}

export function buildTrelloAutomationRuns(context: TrelloFailureContext | null): CompanyBrainAutomationRun[] {
  if (!context) return [];
  const executionIds = extractTrelloAutomationExecutionIds(context);
  const requestId = requestIdFromTrelloContext(context);
  return context.actions
    .filter(trelloActionLooksFailed)
    .map((action, index) => ({
      id: `trello-action-${action.id}`,
      workflowName: "Trello Triggerdiagnose",
      action: "offer_send",
      status: "failed",
      error: trelloActionFailureSummary(action),
      createdAt: action.date,
      requestId,
      executionId: executionIds[index] || executionIds[0] || null,
      executionUrl: n8nExecutionUrl(executionIds[index] || executionIds[0] || null),
      correlationId: context.card.id,
      sourceEventId: action.id,
      targetRecordId: null,
      failedNode: null,
      idempotencyKey: null,
      retrySafety: classifyAutomationIssueText(action.text).retrySafety,
      summary: "Aus Trello-Aktionshistorie rekonstruiert; workflow_audit_log hatte keinen passenden Eintrag.",
    }));
}

function dedupeAutomationRuns(runs: CompanyBrainAutomationRun[]) {
  const seen = new Set<string>();
  const deduped: CompanyBrainAutomationRun[] = [];
  for (const run of runs) {
    const key = run.executionId ? `execution:${run.executionId}` : run.sourceEventId ? `event:${run.sourceEventId}` : run.id;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(run);
  }
  return deduped;
}

function emptyTrelloFailureDiagnosis(requested: boolean): CompanyBrainTrelloFailureDiagnosis {
  return {
    requested,
    status: requested ? "not_configured" : "not_requested",
    severity: requested ? "warning" : "info",
    expectedAction: "unknown",
    card: null,
    triggerMove: null,
    rootCauseKey: requested ? "trello_not_configured" : "not_requested",
    rootCause: requested
      ? "Es wurde ein Trello-bezogener Fall erkannt, aber keine Trello-Karte konnte live geladen werden."
      : "Keine Trello-Triggerdiagnose angefordert.",
    recommendedFix: requested
      ? "Trello-Karten-URL oder Card-ID eingeben und Trello API-Konfiguration prüfen."
      : "Für Triggerdiagnose eine Trello-Karten-URL oder Card-ID suchen.",
    evidenceStrength: "weak",
    duplicateRisk: "medium",
    safeFixes: [],
    blockedFixes: requested ? ["Kein Retry ohne geladene Trello-Karte, Source-of-Truth-Abgleich und Duplicate-Mail-Check."] : [],
    timeline: [],
    diagnostics: requested ? ["Trello-Lookup fehlt oder ist nicht konfiguriert."] : [],
  };
}

async function fetchTrelloFailureContextForLookup(lookup: string | null): Promise<{
  context: TrelloFailureContext | null;
  diagnostic: CompanyBrainDiagnostic;
}> {
  if (!lookup) {
    return {
      context: null,
      diagnostic: { source: "trello_live", ok: true, label: "Trello Live", detail: "Kein Trello-Lookup ausgeführt.", count: 0 },
    };
  }

  try {
    const context = await getTrelloFailureContext(lookup);
    return {
      context,
      diagnostic: { source: "trello_live", ok: true, label: "Trello Live", detail: null, count: 1 },
    };
  } catch (error) {
    return {
      context: null,
      diagnostic: {
        source: "trello_live",
        ok: false,
        label: "Trello Live",
        detail: errorMessage(error),
        count: 0,
      },
    };
  }
}

function timelineTime(entry: Pick<CustomerTimelineEntry, "occurredAt">) {
  return entry.occurredAt ? new Date(entry.occurredAt).getTime() : 0;
}

function latestTimelineAt(record: CustomerSearchResult, direction: "inbound" | "outbound") {
  return record.timeline
    .filter((entry) => entry.direction === direction)
    .sort((left, right) => timelineTime(right) - timelineTime(left))[0]?.occurredAt || null;
}

function mapRecordSummary(record: CustomerSearchResult): CompanyBrainRecordSummary {
  return {
    requestId: record.requestId,
    displayName: record.displayName,
    company: record.company,
    email: record.email,
    phone: record.phone,
    status: record.request?.status || record.opsState.label || null,
    title: record.request?.title || null,
    requestedSize: record.request?.size || null,
    requestedColors: record.request?.colors || [],
    trelloCardId: record.request?.trelloCardId || null,
    trelloCardUrl: record.request?.trelloCardUrl || null,
    latestOfferSentAt: record.quote?.sentAt || null,
    latestOfferViewedAt: record.quote?.viewedAt || record.offerTracking?.lastViewedAt || null,
    latestOfferSignedAt: record.quote?.signedAt || record.offerTracking?.acceptedAt || null,
    latestOrderNumber: record.order?.orderNumber || null,
    latestOrderStatus: record.order?.fulfillmentStatus || record.order?.status || null,
    latestOutboundAt: latestTimelineAt(record, "outbound"),
    latestInboundAt: latestTimelineAt(record, "inbound"),
    communicationsCount: record.communications.length,
    timelineCount: record.timeline.length,
  };
}

function extractColorHints(text: string) {
  const normalized = text.toLowerCase();
  return COLOR_WORDS.filter((word) => normalized.includes(word.toLowerCase()));
}

function normalizeColorGroup(color: string) {
  const normalized = color.toLowerCase();
  for (const [group, aliases] of Object.entries(COLOR_GROUPS)) {
    if (aliases.some((alias) => normalized.includes(alias))) return group;
  }
  return normalized;
}

function normalizeColorList(colors: string[]) {
  return uniqueStrings(colors.map(normalizeColorGroup));
}

function quotedCount(text: string, pattern: RegExp) {
  const normalized = text.toLowerCase();
  const matches = normalized.match(pattern);
  if (!matches) return null;
  const numeric = matches.map((match) => Number.parseInt(match.replace(/\D+/g, ""), 10)).find((value) => Number.isFinite(value));
  if (numeric) return numeric;
  if (/\bzwei\b|\b2\b/.test(normalized)) return 2;
  if (/\bdrei\b|\b3\b/.test(normalized)) return 3;
  if (/\bein\b|\b1\b/.test(normalized)) return 1;
  return null;
}

export function extractCompanyBrainSignals(text: string) {
  const normalized = cleanText(text);
  const lower = normalized.toLowerCase();
  return {
    colors: normalizeColorList(extractColorHints(normalized)),
    designCount: quotedCount(lower, /\b\d+\s*(?:designs?|entwuerfe|entwürfe|mockups?|motive|bilder)\b/g) ||
      (/\bzwei\s+(?:designs?|entwuerfe|entwürfe|mockups?|motive|bilder)\b/.test(lower) ? 2 : null),
    mentions3d: /\b3\s*-?\s*d\b|\b3d\b/.test(lower),
    asksOfferSent: /\b(raus|gesendet|verschickt|versendet|mail|e-?mail|angebot.*weg)\b/i.test(normalized),
    asksCustomerConfirmation: /\b(bestätigt|bestaetigt|freigabe|zugesagt|antwort|kunde sagt|kundin sagt)\b/i.test(normalized),
    asksOrder: /\b(bestellung|shopify|bezahlt|gekauft|order)\b/i.test(normalized),
  };
}

function offerText(offer: OpsOfferSnapshot) {
  return [
    offer.offer.projectTitle,
    offer.offer.notes,
    offer.offer.discountText,
    ...offer.items.flatMap((item) => [item.title, item.description, item.section]),
    ...offer.images.map((image) => image.title),
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
}

function mapOfferSummary(offer: OpsOfferSnapshot): CompanyBrainOfferSummary {
  const text = offerText(offer);
  const lower = text.toLowerCase();
  const designEvidenceCount =
    offer.images.length ||
    offer.items.filter((item) => /design|entwurf|mockup|motiv|layout/i.test(`${item.title} ${item.description || ""}`)).length;
  const productHints = uniqueStrings([
    lower.includes("3d") || lower.includes("3-d") ? "3D" : null,
    lower.includes("neon") ? "Neon" : null,
    lower.includes("schild") || lower.includes("sign") ? "Schild" : null,
    lower.includes("acryl") ? "Acryl" : null,
    lower.includes("led") ? "LED" : null,
  ]);

  return {
    offerId: offer.offerId,
    requestId: cleanText(offer.requestId || offer.request_id) || null,
    offerNumber: offer.offerNumber,
    documentReference: offer.documentReference,
    publicUrl: offer.publicUrl || null,
    status: offer.status,
    customerName: uniqueStrings([offer.offer.customerFirstName, offer.offer.customerLastName]).join(" ") || offer.offer.customerCompany,
    customerEmail: offer.offer.customerEmail,
    projectTitle: offer.offer.projectTitle,
    trelloCardId: offer.trelloCardId,
    updatedAt: offer.updatedAt,
    viewedAt: offer.viewedAt,
    acceptedAt: offer.acceptedAt,
    itemCount: offer.items.length,
    imageCount: offer.images.length,
    selectedItemCount: offer.items.filter((item) => item.selectedFinal ?? item.selectedByDefault).length,
    designEvidenceCount,
    productHints,
    colorHints: uniqueStrings(extractColorHints(text)),
    selectedItems: offer.items
      .filter((item) => item.selectedFinal ?? item.selectedByDefault)
      .slice(0, 8)
      .map((item) => ({
        title: item.title,
        section: item.section,
        description: item.description,
        quantity: item.quantity,
        unitPriceNet: item.unitPriceNet,
      })),
    imageEvidence: offer.images
      .filter((image) => image.enabled)
      .slice(0, 8)
      .map((image) => ({
        title: image.title,
        kind: image.kind,
        enabled: image.enabled,
        linkedItemTitle: image.linkedItemTitle,
      })),
  };
}

function mapTimelineEvidence(record: CustomerSearchResult): CompanyBrainEvidence[] {
  return record.timeline.slice(0, 14).map((entry) => ({
    id: `${record.requestId}-${entry.id}`,
    source: entry.source,
    title: entry.title,
    detail: entry.description || entry.body || entry.valueLabel,
    occurredAt: entry.occurredAt,
    direction: entry.direction,
    href: entry.href,
    confidence: "high",
  }));
}

function mapOfferEvidence(offer: CompanyBrainOfferSummary): CompanyBrainEvidence[] {
  const entries: CompanyBrainEvidence[] = [
    {
      id: `offer-${offer.offerId}-updated`,
      source: "offers_api",
      title: `Angebot ${offer.offerNumber || offer.documentReference}`,
      detail: [
        offer.status ? `Status: ${offer.status}` : null,
        offer.requestId ? `Request: ${offer.requestId}` : null,
        offer.itemCount ? `${offer.itemCount} Positionen` : null,
        offer.imageCount ? `${offer.imageCount} Designs/Bilder` : null,
      ].filter(Boolean).join(" · ") || null,
      occurredAt: offer.updatedAt,
      direction: "system",
      href: offer.publicUrl,
      confidence: "high",
    },
  ];
  if (offer.viewedAt) {
    entries.push({
      id: `offer-${offer.offerId}-viewed`,
      source: "offers_api",
      title: "Angebot angesehen",
      detail: offer.offerNumber || offer.documentReference,
      occurredAt: offer.viewedAt,
      direction: "system",
      href: offer.publicUrl,
      confidence: "high",
    });
  }
  if (offer.acceptedAt) {
    entries.push({
      id: `offer-${offer.offerId}-accepted`,
      source: "offers_api",
      title: "Angebot angenommen",
      detail: offer.offerNumber || offer.documentReference,
      occurredAt: offer.acceptedAt,
      direction: "system",
      href: offer.publicUrl,
      confidence: "high",
    });
  }
  for (const item of offer.selectedItems.slice(0, 5)) {
    entries.push({
      id: `offer-${offer.offerId}-item-${item.title}`,
      source: "offers_api.items",
      title: `Ausgewählte Position: ${item.title}`,
      detail: [
        item.section,
        item.quantity ? `Menge ${item.quantity}` : null,
        item.description,
      ].filter(Boolean).join(" · ") || null,
      occurredAt: offer.updatedAt,
      direction: "system",
      href: offer.publicUrl,
      confidence: "high",
    });
  }
  for (const image of offer.imageEvidence.slice(0, 5)) {
    entries.push({
      id: `offer-${offer.offerId}-image-${image.title || image.kind}`,
      source: "offers_api.images",
      title: image.title ? `Design/Bild: ${image.title}` : "Design/Bild im Angebot",
      detail: image.linkedItemTitle ? `Verknüpft mit: ${image.linkedItemTitle}` : image.kind,
      occurredAt: offer.updatedAt,
      direction: "system",
      href: offer.publicUrl,
      confidence: "high",
    });
  }
  return entries;
}

function mapTrelloEvidence(context: TrelloFailureContext | null): CompanyBrainEvidence[] {
  if (!context) return [];
  const entries: CompanyBrainEvidence[] = [
    {
      id: `trello-live-${context.card.id}`,
      source: "trello_live",
      title: `Trello-Karte: ${context.card.name || context.card.id}`,
      detail: [
        context.card.currentListName ? `Aktuelle Liste: ${context.card.currentListName}` : null,
        context.card.attachmentsCount ? `${context.card.attachmentsCount} Anhang/Anhänge` : null,
      ].filter(Boolean).join(" · ") || null,
      occurredAt: context.card.dateLastActivity,
      direction: "system",
      href: context.card.url || context.card.shortUrl,
      confidence: "medium",
    },
  ];

  for (const action of context.actions.slice(0, 10)) {
    const isMove = Boolean(action.fromListName || action.toListName);
    entries.push({
      id: `trello-live-action-${action.id}`,
      source: "trello_live.actions",
      title: isMove
        ? `Kartenbewegung: ${action.fromListName || "unbekannt"} -> ${action.toListName || "unbekannt"}`
        : action.type === "commentCard"
          ? "Trello-Kommentar"
          : `Trello-Aktion: ${action.type || "unbekannt"}`,
      detail: action.text || context.card.name || null,
      occurredAt: action.date,
      direction: action.type === "commentCard" ? "internal" : "system",
      href: context.card.url || context.card.shortUrl,
      confidence: "medium",
    });
  }

  return entries;
}

function dedupeRecords(records: CustomerSearchResult[]) {
  const byRequestId = new Map<string, CustomerSearchResult>();
  for (const record of records) {
    if (!byRequestId.has(record.requestId)) byRequestId.set(record.requestId, record);
  }
  return [...byRequestId.values()];
}

function dedupeOfferSearchResults(results: OpsOfferSearchResult[]) {
  const byId = new Map<string, OpsOfferSearchResult>();
  for (const result of results) {
    if (!byId.has(result.offerId)) byId.set(result.offerId, result);
  }
  return [...byId.values()];
}

function dedupeOfferSnapshots(results: OpsOfferSnapshot[]) {
  const byId = new Map<string, OpsOfferSnapshot>();
  for (const result of results) {
    if (!byId.has(result.offerId)) byId.set(result.offerId, result);
  }
  return [...byId.values()];
}

export function findMissingOfferRequestIds(
  records: Array<{ requestId: string | null | undefined }>,
  offers: Array<{ requestId?: string | null }>,
  limit = 3,
) {
  const existingRecordIds = new Set(records.map((record) => cleanText(record.requestId)).filter(Boolean));
  return uniqueStrings(offers.map((offer) => cleanText(offer.requestId)).filter(Boolean))
    .filter((requestId) => !existingRecordIds.has(requestId))
    .slice(0, limit);
}

function addRecordIdentifiers(identifiers: CompanyBrainIdentifier[], records: CustomerSearchResult[]) {
  for (const record of records) {
    pushIdentifier(identifiers, "request_id", "Request-ID", record.requestId, "high", `/ops/customer-records?query=${encodeURIComponent(record.requestId)}`);
    if (record.email) pushIdentifier(identifiers, "email", "E-Mail", record.email, "high", null);
    if (record.request?.trelloCardId) {
      pushIdentifier(identifiers, "trello_card_id", "Trello-ID", record.request.trelloCardId, "high", record.request.trelloCardUrl);
    }
  }
}

function addOfferIdentifiers(identifiers: CompanyBrainIdentifier[], offers: CompanyBrainOfferSummary[]) {
  for (const offer of offers) {
    pushIdentifier(identifiers, "offer_id", "Offer-ID", offer.offerId, "high", offer.publicUrl);
    if (offer.requestId) pushIdentifier(identifiers, "request_id", "Request-ID", offer.requestId, "high", `/ops/customer-records?query=${encodeURIComponent(offer.requestId)}`);
    if (offer.offerNumber) pushIdentifier(identifiers, "offer_number", "Angebotsnummer", offer.offerNumber, "high", offer.publicUrl);
    if (offer.trelloCardId) pushIdentifier(identifiers, "trello_card_id", "Trello-ID", offer.trelloCardId, "medium", null);
  }
}

function buildGaps(records: CompanyBrainRecordSummary[], offers: CompanyBrainOfferSummary[], diagnostics: CompanyBrainDiagnostic[]) {
  const gaps: CompanyBrainFinding[] = [];
  if (!records.length) {
    gaps.push({
      severity: "warning",
      title: "Keine Kundenakte eindeutig gefunden",
      detail: "Die Suche hat keinen verknüpften Request in der Ops-Kundenakte geliefert.",
      source: "customer_records",
    });
  }
  if (!offers.length) {
    gaps.push({
      severity: "warning",
      title: "Kein Angebotssnapshot geladen",
      detail: "Die Angebotssoftware lieferte keinen passenden Snapshot oder war nicht erreichbar.",
      source: "offers",
    });
  }
  if (records.length && !records.some((record) => record.latestOutboundAt || record.latestOfferSentAt)) {
    gaps.push({
      severity: "warning",
      title: "Kein Versandbeleg sichtbar",
      detail: "In den angebundenen Timeline-Quellen wurde kein ausgehender Angebots- oder Mailzeitpunkt gefunden.",
      source: "timeline",
    });
  }
  for (const diagnostic of diagnostics.filter((entry) => !entry.ok)) {
    gaps.push({
      severity: "info",
      title: `${diagnostic.label} nicht vollständig verfügbar`,
      detail: diagnostic.detail || "Quelle konnte nicht gelesen werden.",
      source: diagnostic.source,
    });
  }
  return gaps;
}

type WorkflowAuditLogRow = {
  id: string;
  document_id?: string | null;
  workflow_name?: string | null;
  action?: string | null;
  status?: string | null;
  error_message?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
};

type QuoteEmailLogEvidenceRow = {
  id?: string | number | null;
  unique_id?: string | null;
  request_id?: string | null;
  offer_id?: string | null;
  card_id?: string | null;
  card_url?: string | null;
  recipient_email?: string | null;
  recipient_name?: string | null;
  angebotsnummer?: string | null;
  subject?: string | null;
  status?: string | null;
  sent_at?: string | null;
  created_at?: string | null;
  source_event_id?: string | null;
  idempotency_key?: string | null;
};

type N8nExecutionResponse = {
  id?: string | number | null;
  workflowId?: string | number | null;
  mode?: string | null;
  status?: string | null;
  finished?: boolean | null;
  startedAt?: string | null;
  stoppedAt?: string | null;
  createdAt?: string | null;
  workflowData?: {
    name?: string | null;
  } | null;
  data?: {
    resultData?: {
      error?: {
        message?: string | null;
        description?: string | null;
        node?: {
          name?: string | null;
        } | null;
        nodeName?: string | null;
      } | null;
      lastNodeExecuted?: string | null;
      runData?: Record<string, unknown> | null;
    } | null;
  } | null;
};

type N8nApiConfig = {
  apiBaseUrl: string;
  apiKey: string;
};

export function resolveN8nApiConfig(env: Record<string, string | undefined> = process.env): N8nApiConfig | null {
  const rawBaseUrl = cleanText(env.N8N_API_URL || env.N8N_BASE_URL || "").replace(/\/+$/, "");
  const apiKey = cleanText(env.N8N_API_KEY || "");
  if (!rawBaseUrl || !apiKey) return null;
  const apiBaseUrl = /\/api\/v1$/i.test(rawBaseUrl) ? rawBaseUrl : `${rawBaseUrl}/api/v1`;
  return { apiBaseUrl, apiKey };
}

function n8nExecutionStatus(execution: N8nExecutionResponse) {
  const explicitStatus = cleanText(execution.status);
  if (explicitStatus) return explicitStatus;
  if (execution.finished === true) return "success";
  if (execution.finished === false) return "running_or_failed";
  return null;
}

function n8nExecutionError(execution: N8nExecutionResponse) {
  const error = execution.data?.resultData?.error;
  return cleanText(error?.message || error?.description) || null;
}

function n8nFailedNode(execution: N8nExecutionResponse) {
  const error = execution.data?.resultData?.error;
  return cleanText(error?.node?.name || error?.nodeName || execution.data?.resultData?.lastNodeExecuted) || null;
}

function n8nWorkflowName(execution: N8nExecutionResponse) {
  return cleanText(execution.workflowData?.name) || (execution.workflowId ? `n8n Workflow ${execution.workflowId}` : "n8n Live Execution");
}

async function fetchN8nExecution(executionId: string): Promise<N8nExecutionResponse | null> {
  const config = resolveN8nApiConfig();
  if (!config) return null;
  const response = await fetch(`${config.apiBaseUrl}/executions/${encodeURIComponent(executionId)}?includeData=true`, {
    method: "GET",
    headers: {
      "X-N8N-API-KEY": config.apiKey,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`n8n API antwortete mit ${response.status}.`);
  }
  return (await response.json()) as N8nExecutionResponse;
}

async function fetchN8nLiveRuns(
  executionIds: string[],
  fallbackRuns: CompanyBrainAutomationRun[],
): Promise<{ runs: CompanyBrainAutomationRun[]; diagnostic: CompanyBrainDiagnostic | null }> {
  const config = resolveN8nApiConfig();
  const ids = uniqueStrings(executionIds).slice(0, 5);
  if (!ids.length || !config) return { runs: [], diagnostic: null };
  const fallbackByExecutionId = new Map(
    fallbackRuns
      .filter((run) => run.executionId)
      .map((run) => [run.executionId as string, run] as const),
  );
  const runs: CompanyBrainAutomationRun[] = [];
  const errors: string[] = [];

  for (const executionId of ids) {
    try {
      const execution = await fetchN8nExecution(executionId);
      if (!execution) {
        errors.push(`${executionId}: nicht mehr in n8n verfügbar`);
        continue;
      }
      const fallback = fallbackByExecutionId.get(executionId) || null;
      const status = n8nExecutionStatus(execution);
      const error = n8nExecutionError(execution);
      const issueHint = classifyAutomationIssueText(`${error || ""} ${fallback?.error || ""} ${fallback?.summary || ""}`);
      runs.push({
        id: `n8n-live-${executionId}`,
        workflowName: n8nWorkflowName(execution),
        action: fallback?.action || "offer_send",
        status: error ? "failed" : status,
        error: error || fallback?.error || null,
        createdAt: execution.stoppedAt || execution.startedAt || execution.createdAt || fallback?.createdAt || null,
        requestId: fallback?.requestId || null,
        executionId,
        executionUrl: fallback?.executionUrl || n8nExecutionUrl(executionId),
        correlationId: fallback?.correlationId || null,
        sourceEventId: fallback?.sourceEventId || null,
        targetRecordId: fallback?.targetRecordId || null,
        failedNode: n8nFailedNode(execution) || fallback?.failedNode || null,
        idempotencyKey: fallback?.idempotencyKey || null,
        retrySafety: issueHint.key !== "unknown" ? issueHint.retrySafety : fallback?.retrySafety || "Nur nach Duplicate-Mail-Check und idempotentem Retry freigeben.",
        summary: issueHint.key !== "unknown" ? issueHint.rootCause : "Read-only aus der n8n Live-API geladen.",
      });
    } catch (error) {
      errors.push(`${executionId}: ${errorMessage(error)}`);
    }
  }

  return {
    runs,
    diagnostic: {
      source: "workflow_audit",
      ok: errors.length === 0,
      label: "Live n8n",
      detail: errors.length ? errors.join(" · ") : "n8n Live-Execution-Daten read-only geladen.",
      count: runs.length,
    },
  };
}

async function fetchAutomationRuns(
  records: CompanyBrainRecordSummary[],
  offers: CompanyBrainOfferSummary[],
  extraTrelloCardIds: string[] = [],
  extraExecutionIds: string[] = [],
): Promise<{
  runs: CompanyBrainAutomationRun[];
  diagnostic: CompanyBrainDiagnostic;
}> {
  const requestIds = uniqueStrings(records.map((record) => record.requestId));
  const offerNumbers = uniqueStrings(offers.map((offer) => offer.offerNumber));
  const trelloCardIds = uniqueStrings([
    ...extraTrelloCardIds,
    ...records.map((record) => record.trelloCardId),
    ...offers.map((offer) => offer.trelloCardId),
  ]);
  const executionIds = uniqueStrings(extraExecutionIds);
  const filters = [
    requestIds.length ? `document_id.in.(${requestIds.map(encodeURIComponent).join(",")})` : null,
    ...requestIds.map((requestId) => `metadata->>request_id.eq.${encodeURIComponent(requestId)}`),
    ...offerNumbers.map((offerNumber) => `metadata->>offer_number.eq.${encodeURIComponent(offerNumber)}`),
    ...trelloCardIds.map((cardId) => `metadata->>trello_card_id.eq.${encodeURIComponent(cardId)}`),
    ...trelloCardIds.map((cardId) => `metadata->>trelloCardId.eq.${encodeURIComponent(cardId)}`),
    ...executionIds.map((executionId) => `metadata->>execution_id.eq.${encodeURIComponent(executionId)}`),
    ...executionIds.map((executionId) => `metadata->>n8n_execution_id.eq.${encodeURIComponent(executionId)}`),
    ...executionIds.map((executionId) => `metadata->>workflow_execution_id.eq.${encodeURIComponent(executionId)}`),
  ].filter((value): value is string => Boolean(value));

  if (!filters.length) {
    return {
      runs: [],
      diagnostic: { source: "workflow_audit", ok: true, label: "Automation Audit", detail: "Kein Request/Angebot für Audit-Lookup.", count: 0 },
    };
  }

  try {
    const rows = await supabaseRequest<WorkflowAuditLogRow[]>("workflow_audit_log", undefined, {
      select: "id,document_id,workflow_name,action,status,error_message,metadata,created_at",
      or: `(${filters.join(",")})`,
      order: "created_at.desc",
      limit: 30,
    });
    const runs = rows.map((row) => ({
      id: row.id,
      workflowName: cleanText(row.workflow_name) || null,
      action: cleanText(row.action) || null,
      status: cleanText(row.status) || null,
      error: cleanText(row.error_message) || metadataText(row.metadata, ["error_message", "error", "message"]),
      createdAt: row.created_at || null,
      requestId: cleanText(row.document_id) || metadataText(row.metadata, ["request_id", "task_request_id"]),
      executionId: metadataText(row.metadata, ["execution_id", "n8n_execution_id", "workflow_execution_id"]),
      executionUrl: n8nExecutionUrl(
        metadataText(row.metadata, ["execution_id", "n8n_execution_id", "workflow_execution_id"]),
        metadataText(row.metadata, ["n8n_execution_url", "execution_url", "workflow_execution_url"]),
      ),
      correlationId: metadataText(row.metadata, ["correlation_id", "request_correlation_id", "idempotency_key"]),
      sourceEventId: metadataText(row.metadata, ["source_event_id", "event_id", "message_id", "offer_event_id"]),
      targetRecordId: metadataText(row.metadata, ["target_record_id", "task_id", "offer_id", "shopify_order_id"]),
      failedNode: metadataText(row.metadata, ["failed_node", "failedNode", "node_name", "nodeName"]),
      idempotencyKey: metadataText(row.metadata, ["idempotency_key", "idempotencyKey"]),
      retrySafety: metadataText(row.metadata, ["automation_issue_retry_safety", "retry_safety", "retrySafety"]),
      summary: metadataText(row.metadata, ["automation_issue_root_cause", "summary", "detail", "description"]),
    }));
    return {
      runs,
      diagnostic: { source: "workflow_audit", ok: true, label: "Automation Audit", detail: null, count: runs.length },
    };
  } catch (error) {
    return {
      runs: [],
      diagnostic: {
        source: "workflow_audit",
        ok: false,
        label: "Automation Audit",
        detail: error instanceof SupabaseRestError ? error.message : errorMessage(error),
        count: 0,
      },
    };
  }
}

function mapQuoteEmailEvidence(row: QuoteEmailLogEvidenceRow): CompanyBrainEvidence {
  const offerNumber = cleanText(row.angebotsnummer);
  const requestId = cleanText(row.request_id);
  const offerId = cleanText(row.offer_id);
  const recipient = cleanText(row.recipient_email);
  const subject = cleanText(row.subject);
  const status = cleanText(row.status);
  const occurredAt = row.sent_at || row.created_at || null;
  return {
    id: `quote-email-log:${row.id || row.unique_id || `${offerNumber}:${recipient}:${occurredAt || ""}`}`,
    source: "quote_email_log",
    title: subject || (offerNumber ? `Angebots-E-Mail ${offerNumber}` : "Angebots-E-Mail versendet"),
    detail: [
      recipient ? `Empfänger: ${recipient}` : null,
      offerNumber ? `Angebot: ${offerNumber}` : null,
      requestId ? `Request: ${requestId}` : null,
      offerId ? `Offer-ID: ${offerId}` : null,
      status ? `Status: ${status}` : null,
    ].filter(Boolean).join(" · ") || null,
    occurredAt,
    direction: "outbound",
    href: cleanText(row.card_url) || null,
    confidence: /sent|delivered|success|ok/i.test(status) || row.sent_at ? "high" : "medium",
  };
}

async function fetchQuoteEmailEvidence(
  records: CompanyBrainRecordSummary[],
  offers: CompanyBrainOfferSummary[],
  extraTrelloCardIds: string[] = [],
): Promise<CompanyBrainEvidence[]> {
  const offerNumbers = uniqueStrings(offers.map((offer) => offer.offerNumber).filter(Boolean)).slice(0, 5);
  const offerIds = uniqueStrings(offers.map((offer) => offer.offerId).filter(Boolean)).slice(0, 5);
  const requestIds = uniqueStrings([
    ...records.map((record) => record.requestId),
    ...offers.map((offer) => offer.requestId),
  ].filter(Boolean)).slice(0, 5);
  const trelloCardIds = uniqueStrings([
    ...extraTrelloCardIds,
    ...records.map((record) => record.trelloCardId),
    ...offers.map((offer) => offer.trelloCardId),
  ]).slice(0, 5);
  const filters = [
    ...requestIds.map((requestId) => `request_id.eq.${encodeURIComponent(requestId)}`),
    ...offerIds.map((offerId) => `offer_id.eq.${encodeURIComponent(offerId)}`),
    ...offerNumbers.map((offerNumber) => `angebotsnummer.eq.${encodeURIComponent(offerNumber)}`),
    ...trelloCardIds.map((cardId) => `card_id.eq.${encodeURIComponent(cardId)}`),
  ];
  if (!filters.length) return [];
  const query = {
    or: `(${filters.join(",")})`,
    order: "created_at.desc",
    limit: 12,
  };
  try {
    const rows = await supabaseRequest<QuoteEmailLogEvidenceRow[]>("quote_email_log", undefined, {
      select: "id,unique_id,request_id,offer_id,card_id,card_url,recipient_email,recipient_name,angebotsnummer,subject,status,sent_at,created_at,source_event_id,idempotency_key",
      ...query,
    });
    return rows.map(mapQuoteEmailEvidence);
  } catch (error) {
    const errorText = `${error instanceof Error ? error.message : String(error)} ${error instanceof SupabaseRestError ? String(error.details || "") : ""}`;
    if (!/(request_id|offer_id|source_event_id|idempotency_key)/i.test(errorText)) {
      console.warn("company brain quote_email_log evidence unavailable", error);
      return [];
    }
    try {
      const legacyFilters = [
        ...offerNumbers.map((offerNumber) => `angebotsnummer.eq.${encodeURIComponent(offerNumber)}`),
        ...trelloCardIds.map((cardId) => `card_id.eq.${encodeURIComponent(cardId)}`),
      ];
      if (!legacyFilters.length) return [];
      const rows = await supabaseRequest<QuoteEmailLogEvidenceRow[]>("quote_email_log", undefined, {
        select: "id,unique_id,card_id,card_url,recipient_email,recipient_name,angebotsnummer,subject,status,sent_at,created_at",
        or: `(${legacyFilters.join(",")})`,
        order: "created_at.desc",
        limit: 12,
      });
      return rows.map(mapQuoteEmailEvidence);
    } catch (legacyError) {
      console.warn("company brain quote_email_log evidence unavailable", legacyError);
      return [];
    }
  }
}

function buildSourceHealth(
  records: CompanyBrainRecordSummary[],
  offers: CompanyBrainOfferSummary[],
  evidence: CompanyBrainEvidence[],
  diagnostics: CompanyBrainDiagnostic[],
  automationRuns: CompanyBrainAutomationRun[],
  trelloFailureDiagnosis?: CompanyBrainTrelloFailureDiagnosis,
): CompanyBrainSourceHealth[] {
  const diagnosticBySource = new Map(diagnostics.map((entry) => [entry.source, entry] as const));
  const customerDiagnostic = diagnosticBySource.get("customer_records");
  const offerDiagnostic = diagnosticBySource.get("offers");
  const bridgeDiagnostics = diagnostics.filter((entry) => entry.source === "offer_bridge");
  const workflowDiagnostic = diagnosticBySource.get("workflow_audit");
  const outlookMirrorEvidence = evidence.filter((entry) => entry.source === "customer_email_messages");
  const outlookLiveEvidence = evidence.filter((entry) => entry.source === "outlook_graph_live");
  const outlookEvidence = [...outlookMirrorEvidence, ...outlookLiveEvidence];
  const shopifyLinked = records.filter((record) => record.latestOrderNumber);
  const trelloLinked = records.filter((record) => record.trelloCardId || record.trelloCardUrl);
  const liveTrelloCard = trelloFailureDiagnosis?.card || null;

  return [
    {
      key: "customer_records",
      label: "Kundenakte",
      status: customerDiagnostic?.ok ? (records.length ? "ok" : "missing") : "error",
      summary: records.length ? `${records.length} Kundenakte(n) gefunden.` : customerDiagnostic?.ok ? "Keine Kundenakte gefunden." : "Kundenakte nicht lesbar.",
      count: records.length,
      lastSeenAt: latestIso(records.map((record) => record.latestInboundAt || record.latestOutboundAt || record.latestOfferViewedAt)),
      detail: customerDiagnostic?.detail || null,
    },
    {
      key: "offers",
      label: "Angebote",
      status: offerDiagnostic?.ok ? (offers.length ? "ok" : "missing") : "error",
      summary: offers.length ? `${offers.length} Angebotssnapshot(s) geladen.` : offerDiagnostic?.ok ? "Kein Angebotssnapshot gefunden." : "Offers API nicht lesbar.",
      count: offers.length,
      lastSeenAt: latestIso(offers.map((offer) => offer.updatedAt || offer.viewedAt || offer.acceptedAt)),
      detail: offerDiagnostic?.detail || null,
    },
    {
      key: "offer_bridge",
      label: "Offer-Bridge",
      status: bridgeDiagnostics.some((entry) => !entry.ok) ? "partial" : bridgeDiagnostics.length ? "ok" : "missing",
      summary: bridgeDiagnostics.length
        ? `${bridgeDiagnostics.reduce((sum, entry) => sum + entry.count, 0)} verknüpfte Bridge-Treffer.`
        : "Keine Bridge-Nachsuche ausgeführt.",
      count: bridgeDiagnostics.reduce((sum, entry) => sum + entry.count, 0),
      lastSeenAt: null,
      detail: bridgeDiagnostics.find((entry) => !entry.ok)?.detail || null,
    },
    {
      key: "outlook_mirror",
      label: "Outlook-Spiegel",
      status: outlookEvidence.length ? "ok" : records.length ? "missing" : "partial",
      summary: outlookEvidence.length
        ? `${outlookMirrorEvidence.length} Spiegel-Mailbeleg(e), ${outlookLiveEvidence.length} Live-Outlook-Beleg(e).`
        : "Kein Outlook-Beleg in diesem Ergebnis.",
      count: outlookEvidence.length,
      lastSeenAt: latestIso(outlookEvidence.map((entry) => entry.occurredAt)),
      detail: outlookLiveEvidence.length
        ? "Quellen: customer_email_messages und Graph Live read-only."
        : "Quelle: customer_email_messages; Live Outlook nur bei vollständiger Graph-Konfiguration.",
    },
    {
      key: "workflow_audit",
      label: "n8n / Automation Audit",
      status: workflowDiagnostic?.ok ? (automationRuns.length ? "ok" : "missing") : "error",
      summary: automationRuns.length ? `${automationRuns.length} Automation-/Workflow-Einträge.` : "Keine Workflow-Audit-Einträge für diesen Fall.",
      count: automationRuns.length,
      lastSeenAt: latestIso(automationRuns.map((run) => run.createdAt)),
      detail: workflowDiagnostic?.detail || "Read-only aus workflow_audit_log.",
    },
    {
      key: "shopify",
      label: "Shopify",
      status: shopifyLinked.length ? "ok" : records.length ? "missing" : "partial",
      summary: shopifyLinked.length ? `${shopifyLinked.length} verknüpfte Bestellung(en).` : "Keine verknüpfte Bestellung im geladenen Fall.",
      count: shopifyLinked.length,
      lastSeenAt: null,
      detail: null,
    },
    {
      key: "trello",
      label: "Trello",
      status: liveTrelloCard || trelloLinked.length ? "ok" : records.length ? "missing" : "partial",
      summary: liveTrelloCard
        ? `Live-Karte gelesen: ${liveTrelloCard.name || liveTrelloCard.id}.`
        : trelloLinked.length
          ? `${trelloLinked.length} Trello-Referenz(en).`
          : "Keine Trello-Referenz im geladenen Fall.",
      count: liveTrelloCard ? 1 : trelloLinked.length,
      lastSeenAt: liveTrelloCard?.dateLastActivity || null,
      detail: liveTrelloCard
        ? "Live-Trello wurde gelesen; Source of Truth bleibt Postgres/Offer/Audit."
        : "Trello bleibt Projektion, nicht Source of Truth.",
    },
    {
      key: "evidence",
      label: "Beleg-Timeline",
      status: evidence.length ? "ok" : "missing",
      summary: evidence.length ? `${evidence.length} Belege geladen.` : "Keine Belege geladen.",
      count: evidence.length,
      lastSeenAt: latestIso(evidence.map((entry) => entry.occurredAt)),
      detail: null,
    },
  ];
}

function hasEnv(...names: string[]) {
  return names.some((name) => Boolean(cleanText(process.env[name])));
}

export type OutlookGraphConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mailbox: string;
};

type OutlookGraphRecipient = {
  emailAddress?: {
    address?: string | null;
    name?: string | null;
  } | null;
};

export type OutlookGraphMessage = {
  id?: string | null;
  subject?: string | null;
  bodyPreview?: string | null;
  receivedDateTime?: string | null;
  sentDateTime?: string | null;
  webLink?: string | null;
  from?: OutlookGraphRecipient | null;
  toRecipients?: OutlookGraphRecipient[] | null;
  ccRecipients?: OutlookGraphRecipient[] | null;
};

function envValue(...names: string[]) {
  for (const name of names) {
    const value = cleanText(process.env[name]);
    if (value) return value;
  }
  return "";
}

function envValueFrom(env: Record<string, string | undefined>, ...names: string[]) {
  for (const name of names) {
    const value = cleanText(env[name]);
    if (value) return value;
  }
  return "";
}

type CoolifyApiConfig = {
  apiBaseUrl: string;
  apiToken: string;
  applicationUuid: string | null;
};

export function resolveCoolifyApiConfig(env: Record<string, string | undefined> = process.env): CoolifyApiConfig | null {
  const rawBaseUrl = cleanText(env.COOLIFY_API_URL || env.COOLIFY_URL || "").replace(/\/+$/, "");
  const apiToken = cleanText(env.COOLIFY_API_TOKEN || "");
  if (!rawBaseUrl || !apiToken) return null;
  const apiBaseUrl = /\/api\/v1$/i.test(rawBaseUrl) ? rawBaseUrl : `${rawBaseUrl}/api/v1`;
  return {
    apiBaseUrl,
    apiToken,
    applicationUuid: cleanText(env.COOLIFY_APPLICATION_UUID || env.COOLIFY_APP_UUID || env.COOLIFY_RESOURCE_UUID || "") || null,
  };
}

async function fetchCoolifyJson(config: CoolifyApiConfig, path: string) {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(`Coolify API antwortete mit ${response.status}.`);
  }
  return response.json() as Promise<unknown>;
}

function arrayCount(value: unknown) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object" && Array.isArray((value as { data?: unknown }).data)) return (value as { data: unknown[] }).data.length;
  return value ? 1 : 0;
}

async function fetchCoolifyLiveDiagnostic(): Promise<CompanyBrainDiagnostic | null> {
  const config = resolveCoolifyApiConfig();
  if (!config) return null;
  try {
    const teams = await fetchCoolifyJson(config, "/teams");
    let appChecked = false;
    if (config.applicationUuid) {
      try {
        await fetchCoolifyJson(config, `/applications/${encodeURIComponent(config.applicationUuid)}`);
        appChecked = true;
      } catch {
        appChecked = false;
      }
    }
    return {
      source: "coolify_live",
      ok: true,
      label: "Coolify Live",
      detail: appChecked
        ? "Coolify API read-only erreichbar; App-UUID wurde gefunden."
        : config.applicationUuid
          ? "Coolify API read-only erreichbar; App-UUID konnte nicht eindeutig gelesen werden."
          : "Coolify API read-only erreichbar; keine App-UUID für Detailcheck gesetzt.",
      count: arrayCount(teams),
    };
  } catch (error) {
    return {
      source: "coolify_live",
      ok: false,
      label: "Coolify Live",
      detail: errorMessage(error),
      count: 0,
    };
  }
}

export function resolveOutlookGraphConfig(env: Record<string, string | undefined> = process.env): OutlookGraphConfig | null {
  const tenantId = envValueFrom(env, "MICROSOFT_GRAPH_TENANT_ID", "AZURE_TENANT_ID");
  const clientId = envValueFrom(env, "MICROSOFT_GRAPH_CLIENT_ID", "AZURE_CLIENT_ID");
  const clientSecret = envValueFrom(env, "MICROSOFT_GRAPH_CLIENT_SECRET", "AZURE_CLIENT_SECRET");
  const mailbox = envValueFrom(env, "MICROSOFT_GRAPH_MAILBOX", "OUTLOOK_SHARED_MAILBOX", "OUTLOOK_MAILBOX");
  if (!tenantId || !clientId || !clientSecret || !mailbox) return null;
  return { tenantId, clientId, clientSecret, mailbox };
}

async function getOutlookGraphAccessToken(config: OutlookGraphConfig) {
  const body = new URLSearchParams();
  body.set("client_id", config.clientId);
  body.set("client_secret", config.clientSecret);
  body.set("scope", "https://graph.microsoft.com/.default");
  body.set("grant_type", "client_credentials");
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as { access_token?: string; error_description?: string; error?: string } | null;
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || payload?.error || `Graph Token fehlgeschlagen: ${response.status}`);
  }
  return payload.access_token;
}

export function buildOutlookGraphSearchTerms(input: {
  query: string;
  identifiers: CompanyBrainIdentifier[];
  records: CompanyBrainRecordSummary[];
  offers: CompanyBrainOfferSummary[];
}) {
  const terms = [
    ...input.identifiers.filter((identifier) => identifier.type === "offer_number" || identifier.type === "email").map((identifier) => identifier.value),
    ...input.records.flatMap((record) => [record.email, record.requestId]),
    ...input.offers.flatMap((offer) => [offer.offerNumber, offer.customerEmail]),
    input.query.includes("@") || /\bA\/?N[-\s]?\d+/i.test(input.query) ? input.query : null,
  ];
  return uniqueStrings(terms.map((term) => cleanText(term).slice(0, 120)).filter(Boolean)).slice(0, 4);
}

function graphRecipients(recipients: OutlookGraphRecipient[] | null | undefined) {
  return (recipients || [])
    .map((recipient) => cleanText(recipient.emailAddress?.address || recipient.emailAddress?.name).slice(0, 120))
    .filter(Boolean);
}

export function mapOutlookGraphMessageToEvidence(message: OutlookGraphMessage, term: string): CompanyBrainEvidence {
  const from = cleanText(message.from?.emailAddress?.address || message.from?.emailAddress?.name).slice(0, 120);
  const to = graphRecipients(message.toRecipients);
  const direction: CompanyBrainEvidence["direction"] =
    from && /@neontrip\.(de|com)$/i.test(from)
      ? "outbound"
      : to.some((entry) => /@neontrip\.(de|com)$/i.test(entry))
        ? "inbound"
        : "internal";
  const occurredAt = direction === "outbound"
    ? message.sentDateTime || message.receivedDateTime || null
    : message.receivedDateTime || message.sentDateTime || null;
  return {
    id: `outlook-graph:${message.id || `${term}:${message.subject || ""}:${occurredAt || ""}`}`,
    source: "outlook_graph_live",
    title: message.subject ? `Live-Outlook: ${message.subject}` : `Live-Outlook Treffer: ${term}`,
    detail: [
      from ? `Von: ${from}` : null,
      to.length ? `An: ${to.slice(0, 3).join(", ")}` : null,
      message.bodyPreview ? previewText(message.bodyPreview, 260) : null,
    ].filter(Boolean).join(" · ") || null,
    occurredAt,
    direction,
    href: message.webLink || null,
    confidence: "medium",
  };
}

async function fetchOutlookGraphEvidence(input: {
  query: string;
  identifiers: CompanyBrainIdentifier[];
  records: CompanyBrainRecordSummary[];
  offers: CompanyBrainOfferSummary[];
}): Promise<{ evidence: CompanyBrainEvidence[]; diagnostic: CompanyBrainDiagnostic | null }> {
  const config = resolveOutlookGraphConfig();
  if (!config) return { evidence: [], diagnostic: null };
  const terms = buildOutlookGraphSearchTerms(input);
  if (!terms.length) {
    return {
      evidence: [],
      diagnostic: { source: "outlook_live", ok: true, label: "Live Outlook", detail: "Keine sinnvollen Suchbegriffe für Live-Outlook.", count: 0 },
    };
  }

  try {
    const token = await getOutlookGraphAccessToken(config);
    const messages: CompanyBrainEvidence[] = [];
    const seen = new Set<string>();
    for (const term of terms) {
      const params = new URLSearchParams({
        $top: "8",
        $select: "id,subject,bodyPreview,receivedDateTime,sentDateTime,webLink,from,toRecipients,ccRecipients",
        $search: `"${term.replaceAll("\"", "")}"`,
      });
      const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.mailbox)}/messages?${params.toString()}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          ConsistencyLevel: "eventual",
          Accept: "application/json",
        },
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as { value?: OutlookGraphMessage[]; error?: { message?: string } } | null;
      if (!response.ok) {
        throw new Error(payload?.error?.message || `Graph Mail Search fehlgeschlagen: ${response.status}`);
      }
      for (const message of payload?.value || []) {
        const key = cleanText(message.id) || `${term}:${message.subject}:${message.receivedDateTime || message.sentDateTime}`;
        if (seen.has(key)) continue;
        seen.add(key);
        messages.push(mapOutlookGraphMessageToEvidence(message, term));
      }
    }
    return {
      evidence: messages
        .sort((left, right) => new Date(right.occurredAt || 0).getTime() - new Date(left.occurredAt || 0).getTime())
        .slice(0, 12),
      diagnostic: {
        source: "outlook_live",
        ok: true,
        label: "Live Outlook",
        detail: "Graph-Livezugriff read-only geladen. Outlook-Spiegel bleibt Fallback und Belegquelle.",
        count: messages.length,
      },
    };
  } catch (error) {
    return {
      evidence: [],
      diagnostic: {
        source: "outlook_live",
        ok: false,
        label: "Live Outlook",
        detail: errorMessage(error),
        count: 0,
      },
    };
  }
}

function buildIntegrationReadiness(): CompanyBrainIntegrationReadiness[] {
  const graphTenant = hasEnv("MICROSOFT_GRAPH_TENANT_ID", "AZURE_TENANT_ID");
  const graphClient = hasEnv("MICROSOFT_GRAPH_CLIENT_ID", "AZURE_CLIENT_ID");
  const graphSecret = hasEnv("MICROSOFT_GRAPH_CLIENT_SECRET", "AZURE_CLIENT_SECRET");
  const graphMailbox = hasEnv("MICROSOFT_GRAPH_MAILBOX", "OUTLOOK_SHARED_MAILBOX", "OUTLOOK_MAILBOX");
  const n8nApi = hasEnv("N8N_API_URL", "N8N_BASE_URL") && hasEnv("N8N_API_KEY");
  const n8nWebhooks = hasEnv(
    "OPS_VISUAL_REQUEST_WEBHOOK_URL",
    "SUPPLIER_ORDER_CONFIRMATION_WEBHOOK_URL",
    "N8N_SUPPLIER_ORDER_CONFIRMATION_WEBHOOK_URL",
    "SUPPLIER_PAYMENT_REMINDER_WEBHOOK_URL",
    "N8N_SUPPLIER_PAYMENT_REMINDER_WEBHOOK_URL",
  );
  const coolifyRuntime = hasEnv("COOLIFY_API_URL", "COOLIFY_URL") && hasEnv("COOLIFY_API_TOKEN");
  const coolifyDeploy = hasEnv("COOLIFY_DEPLOY_WEBHOOK");

  return [
    {
      key: "live_outlook",
      label: "Live Outlook / Graph",
      status: graphTenant && graphClient && graphSecret && graphMailbox ? "configured" : graphTenant || graphClient || graphSecret || graphMailbox ? "partial" : "missing",
      summary: graphTenant && graphClient && graphSecret && graphMailbox
        ? "Graph-Livezugriff scheint im Runtime-Env konfiguriert."
        : "Kein vollständiger Graph-Livezugriff im Runtime-Env erkannt; Company Brain nutzt den Outlook-Spiegel.",
      detail: "Erwartete Bausteine: Tenant, Client, Secret und Mailbox. Secrets werden nicht angezeigt.",
    },
    {
      key: "n8n_live",
      label: "Live n8n",
      status: n8nApi ? "configured" : n8nWebhooks ? "partial" : "missing",
      summary: n8nApi
        ? "n8n API-Zugriff scheint konfiguriert."
        : n8nWebhooks
          ? "n8n Webhooks sind teilweise konfiguriert; Live-Workflow-API ist nicht vollständig erkannt."
          : "Kein Live-n8n-API-Zugriff im Runtime-Env erkannt.",
      detail: "Read-only Live-Workflowdiagnose braucht N8N_API_URL/N8N_BASE_URL plus N8N_API_KEY. Aktuell bleiben workflow_audit_log und Webhook-Readiness die sichere Quelle.",
    },
    {
      key: "coolify",
      label: "Coolify",
      status: coolifyRuntime ? "configured" : coolifyDeploy ? "partial" : "missing",
      summary: coolifyRuntime
        ? "Coolify API-Zugriff scheint konfiguriert."
        : coolifyDeploy
          ? "Deploy-Webhook ist konfiguriert; Runtime-API-Health ist nicht vollständig erkannt."
          : "Kein Coolify Runtime-API-Zugriff im App-Env erkannt.",
      detail: "Read-only Diagnose braucht COOLIFY_URL/COOLIFY_API_URL plus COOLIFY_API_TOKEN; optional COOLIFY_APPLICATION_UUID für App-Details. Die App zeigt keine Secret-Werte und führt keine Deploy-Aktion aus.",
    },
  ];
}

function buildAssetInventory(records: CustomerSearchResult[], offers: CompanyBrainOfferSummary[], evidence: CompanyBrainEvidence[]): CompanyBrainAsset[] {
  const assets: CompanyBrainAsset[] = [];
  const addAsset = (asset: CompanyBrainAsset) => {
    if (assets.some((entry) => entry.id === asset.id)) return;
    assets.push(asset);
  };

  for (const record of records) {
    if (record.trello?.referenceImage) {
      addAsset({
        id: `trello-reference:${record.trello.referenceImage.cardId}:${record.trello.referenceImage.attachmentId}`,
        kind: "reference_image",
        label: record.trello.referenceImage.name || "Referenzbild",
        source: "trello",
        href: record.trello.referenceImage.proxyUrl,
        linkedTo: record.trello.referenceImage.cardName || record.requestId,
        status: "available",
        evidenceIds: [],
      });
    }
    for (const mockup of record.trello?.mockups || []) {
      addAsset({
        id: `trello-mockup:${mockup.cardId}:${mockup.attachmentId}`,
        kind: "mockup",
        label: mockup.name || "Mockup",
        source: "trello",
        href: mockup.proxyUrl,
        linkedTo: mockup.cardName || record.requestId,
        status: "available",
        evidenceIds: [],
      });
    }
    for (const video of record.trello?.videoLinks || []) {
      addAsset({
        id: `trello-video:${video.url}`,
        kind: "video",
        label: video.label || "Video",
        source: "trello",
        href: video.url,
        linkedTo: video.boardName || record.requestId,
        status: "available",
        evidenceIds: [],
      });
    }
    for (const mockup of record.followupMockups || []) {
      addAsset({
        id: `followup-mockup:${mockup.followupId}:${mockup.url}`,
        kind: "followup_mockup",
        label: mockup.label || `Follow-up Mockup ${mockup.followupNumber || ""}`.trim(),
        source: "customer_records",
        href: mockup.url,
        linkedTo: mockup.status || record.requestId,
        status: "available",
        evidenceIds: [],
      });
    }
  }

  for (const offer of offers) {
    for (const image of offer.imageEvidence) {
      addAsset({
        id: `offer-image:${offer.offerId}:${image.title || image.kind}:${image.linkedItemTitle || "unlinked"}`,
        kind: "offer_image",
        label: image.title || "Angebotsbild",
        source: "offers",
        href: offer.publicUrl,
        linkedTo: image.linkedItemTitle || offer.offerNumber || offer.documentReference,
        status: image.enabled ? "metadata_only" : "missing",
        evidenceIds: evidence
          .filter((entry) => entry.source === "offers_api.images" && entry.title.includes(image.title || "Design/Bild"))
          .slice(0, 2)
          .map((entry) => entry.id),
      });
    }
  }

  return assets.slice(0, 40);
}

function buildDossier(input: {
  generatedAt: string;
  answer: CompanyBrainResolveResult["answer"];
  records: CompanyBrainRecordSummary[];
  offers: CompanyBrainOfferSummary[];
  caseEvents: CompanyBrainCaseEvent[];
  assets: CompanyBrainAsset[];
  crossChecks: CompanyBrainCrossCheck[];
  integrationReadiness: CompanyBrainIntegrationReadiness[];
  watchers: CompanyBrainWatcher[];
  actionProposals: CompanyBrainActionProposal[];
  evidenceScore: CompanyBrainEvidenceScore;
  problemResolution: CompanyBrainProblemResolution;
  checks: CompanyBrainCheck[];
  sourceHealth: CompanyBrainSourceHealth[];
  automationRuns: CompanyBrainAutomationRun[];
  trelloFailureDiagnosis: CompanyBrainTrelloFailureDiagnosis;
  retryAssessment: CompanyBrainRetryAssessment;
  replyDraft: CompanyBrainReplyDraft;
  conflicts: CompanyBrainFinding[];
  gaps: CompanyBrainFinding[];
  evidence: CompanyBrainEvidence[];
}): CompanyBrainDossier {
  const primaryRecord = input.records[0] || null;
  const title = primaryRecord
    ? `Fall-Dossier ${primaryRecord.displayName || primaryRecord.company || primaryRecord.email || primaryRecord.requestId}`
    : "Fall-Dossier";
  const sections: CompanyBrainDossierSection[] = [
    {
      title: "Kurzfazit",
      lines: [input.answer.headline, ...input.answer.bullets],
    },
    {
      title: "Kunde / Anfrage",
      lines: primaryRecord
        ? [
            `Request: ${primaryRecord.requestId}`,
            `Kontakt: ${primaryRecord.displayName || primaryRecord.company || primaryRecord.email || "unbekannt"}`,
            `E-Mail: ${primaryRecord.email || "unbekannt"}`,
            `Farbe: ${primaryRecord.requestedColors.join(", ") || "keine Angabe"}`,
            `Größe: ${primaryRecord.requestedSize || "keine Angabe"}`,
            `Trello: ${primaryRecord.trelloCardId || primaryRecord.trelloCardUrl || "nicht verknüpft"}`,
          ]
        : ["Keine Kundenakte eindeutig gefunden."],
    },
    {
      title: "Angebote",
      lines: input.offers.length
        ? input.offers.flatMap((offer) => [
            `${offer.offerNumber || offer.documentReference}: ${offer.status}, ${offer.itemCount} Positionen, ${offer.imageCount} Bilder/Designs`,
            `Ausgewählt: ${offer.selectedItems.map((item) => item.title).join(", ") || "keine Angabe"}`,
            `Produkt/Farbe: ${offer.productHints.join(", ") || "unbekannt"} / ${offer.colorHints.join(", ") || "unbekannt"}`,
          ])
        : ["Kein Angebotssnapshot geladen."],
    },
    {
      title: "Prüfmatrix",
      lines: input.checks.map((check) => `${check.label}: ${check.status} - ${check.summary}`),
    },
    {
      title: "Konfliktmatrix",
      lines: input.crossChecks.map((check) => `${check.label}: ${check.status} - Erwartet: ${check.expected || "unbekannt"} / Tatsächlich: ${check.actual || "unbekannt"} - ${check.summary}`),
    },
    {
      title: "Problemfall-Lösung",
      lines: [
        `Typ: ${input.problemResolution.label}`,
        `Schweregrad: ${input.problemResolution.severity}`,
        `Beweis-Score: ${input.evidenceScore.score}/100 (${input.evidenceScore.status})`,
        `Ursache: ${input.problemResolution.rootCause}`,
        `Empfehlung: ${input.problemResolution.recommendedResolution}`,
        `Sicher an Kunden antworten: ${input.evidenceScore.safeToAnswerCustomer ? "ja" : "nein"}`,
        ...input.problemResolution.escalationPath.map((entry) => `Eskalation: ${entry}`),
      ],
    },
    {
      title: "Fix / Retry",
      lines: [
        `${input.retryAssessment.label}: ${input.retryAssessment.summary}`,
        `Empfänger: ${input.retryAssessment.recipientEmail || "unbekannt"}`,
        `Angebot: ${input.retryAssessment.offerNumber || input.retryAssessment.offerId || "unbekannt"}`,
        `Retry mit Freigabe: ${input.retryAssessment.canSendWithConfirmation ? "ja" : "nein"}`,
        ...input.retryAssessment.blockers.slice(0, 5).map((entry) => `Blocker: ${entry}`),
        ...input.retryAssessment.safeFixes.slice(0, 5).map((entry) => `Sicherer Fix: ${entry}`),
      ],
    },
    {
      title: "Fallakte",
      lines: input.caseEvents.length
        ? input.caseEvents.slice(0, 12).map((event) => `${event.occurredAt || "ohne Zeit"} · ${event.label} · ${event.summary}`)
        : ["Keine normalisierten Fallereignisse geladen."],
    },
    {
      title: "Assets / Anhänge",
      lines: input.assets.length
        ? input.assets.slice(0, 12).map((asset) => `${asset.kind} · ${asset.label} · ${asset.source} · ${asset.status}${asset.linkedTo ? ` · ${asset.linkedTo}` : ""}`)
        : ["Keine Design-/Anhang-Assets im geladenen Fall gefunden."],
    },
    {
      title: "Integrations-Readiness",
      lines: input.integrationReadiness.map((entry) => `${entry.label}: ${entry.status} - ${entry.summary}`),
    },
    {
      title: "Proaktive Wächter",
      lines: input.watchers.length
        ? input.watchers.map((watcher) => `${watcher.status}/${watcher.severity}: ${watcher.title} - ${watcher.detail}`)
        : ["Keine Wächter ausgewertet."],
    },
    {
      title: "Action Center",
      lines: input.actionProposals.length
        ? input.actionProposals.map((action) => `${action.label}: ${action.enabled ? "bereit" : "nicht direkt ausführbar"} - ${action.summary}`)
        : ["Keine Aktion vorgeschlagen."],
    },
    {
      title: "Automationen / n8n",
      lines: input.automationRuns.length
        ? input.automationRuns.slice(0, 8).map((run) => [
            run.createdAt || "ohne Zeit",
            run.workflowName || "Workflow",
            run.action || "Aktion",
            run.status || "Status unbekannt",
            run.failedNode ? `Node: ${run.failedNode}` : null,
            run.executionId ? `Execution: ${run.executionId}` : null,
            run.executionUrl ? `Execution-Link: ${run.executionUrl}` : null,
            run.retrySafety ? `Retry: ${run.retrySafety}` : null,
            run.error ? `Fehler: ${run.error}` : null,
          ].filter(Boolean).join(" · "))
        : ["Keine Workflow-Audit-Einträge für diesen Fall."],
    },
    {
      title: "Trello Triggerdiagnose",
      lines: input.trelloFailureDiagnosis.requested
        ? [
            `Status: ${input.trelloFailureDiagnosis.status}`,
            `Karte: ${input.trelloFailureDiagnosis.card?.name || input.trelloFailureDiagnosis.card?.id || "nicht geladen"}`,
            input.trelloFailureDiagnosis.card?.currentListName ? `Aktuelle Liste: ${input.trelloFailureDiagnosis.card.currentListName}` : null,
            input.trelloFailureDiagnosis.card?.descriptionPreview ? `Beschreibung: ${input.trelloFailureDiagnosis.card.descriptionPreview}` : null,
            ...(input.trelloFailureDiagnosis.card?.customFields || []).slice(0, 6).map((field) => `Kartenfeld ${field.name}: ${field.value}`),
            `Erwartete Aktion: ${input.trelloFailureDiagnosis.expectedAction}`,
            `Ursache: ${input.trelloFailureDiagnosis.rootCause}`,
            `Empfohlener Fix: ${input.trelloFailureDiagnosis.recommendedFix}`,
            `Duplicate-Risiko: ${input.trelloFailureDiagnosis.duplicateRisk}`,
            ...input.trelloFailureDiagnosis.blockedFixes.map((entry) => `Blockiert: ${entry}`),
          ].filter((line): line is string => Boolean(line))
        : ["Keine Trello-Triggerdiagnose angefordert."],
    },
    {
      title: "Quellenstatus",
      lines: input.sourceHealth.map((source) => `${source.label}: ${source.status} - ${source.summary}`),
    },
    {
      title: "Lücken / Konflikte",
      lines: [...input.conflicts, ...input.gaps].length
        ? [...input.conflicts, ...input.gaps].map((finding) => `${finding.severity}: ${finding.title} - ${finding.detail}`)
        : ["Keine Konflikte oder kritischen Lücken im geladenen Ergebnis."],
    },
    {
      title: "Antwortentwurf",
      lines: [
        `Freigabe erforderlich: ${input.replyDraft.approvalRequired ? "ja" : "nein"}`,
        `Risiko: ${input.replyDraft.riskLevel}`,
        `Betreff: ${input.replyDraft.subject}`,
        ...input.replyDraft.body.split("\n"),
        ...(input.replyDraft.blockers.length ? ["Blocker:", ...input.replyDraft.blockers] : []),
      ],
    },
    {
      title: "Jüngste Belege",
      lines: input.evidence.slice(0, 10).map((entry) => `${entry.occurredAt || "ohne Zeit"} · ${entry.source} · ${entry.title}${entry.detail ? ` · ${entry.detail}` : ""}`),
    },
  ];
  return {
    title,
    generatedAt: input.generatedAt,
    confidence: input.answer.confidence,
    sections,
    copyText: [`${title}`, `Erstellt: ${input.generatedAt}`, ...sections.flatMap((section) => ["", section.title, ...section.lines])].join("\n"),
  };
}

function eventCategoryFromEvidence(entry: CompanyBrainEvidence): CompanyBrainCaseEvent["category"] {
  const text = `${entry.source} ${entry.title} ${entry.detail || ""}`.toLowerCase();
  if (/design|bild|mockup|entwurf|motiv|layout/.test(text)) return "design";
  if (/bestellung|shopify|order|zahlung|bezahlt/.test(text)) return "order";
  if (/trello/.test(text)) return "trello";
  if (entry.source.startsWith("offers_api") || /angebot|quote|offer/.test(text)) return "offer";
  if (entry.direction === "inbound" || entry.direction === "outbound" || entry.source === "customer_email_messages") return "customer_message";
  return entry.direction === "system" ? "internal" : "internal";
}

function buildCaseEvents(evidence: CompanyBrainEvidence[], automationRuns: CompanyBrainAutomationRun[]): CompanyBrainCaseEvent[] {
  const evidenceEvents = evidence.map((entry) => ({
    id: `evidence:${entry.id}`,
    category: eventCategoryFromEvidence(entry),
    label: entry.title,
    summary: entry.detail || entry.source,
    occurredAt: entry.occurredAt,
    source: entry.source,
    direction: entry.direction,
    href: entry.href,
    confidence: entry.confidence,
    evidenceIds: [entry.id],
  } satisfies CompanyBrainCaseEvent));

  const automationEvents = automationRuns.map((run) => ({
    id: `automation:${run.id}`,
    category: "automation" as const,
    label: run.workflowName || "Automation",
    summary: [
      run.action || "Aktion unbekannt",
      run.status || "Status unbekannt",
      run.error ? `Fehler: ${run.error}` : null,
    ].filter(Boolean).join(" · "),
    occurredAt: run.createdAt,
    source: "workflow_audit_log",
    direction: "system" as const,
    href: run.executionUrl || null,
    confidence: "high" as const,
    evidenceIds: [],
  }));

  return [...evidenceEvents, ...automationEvents]
    .sort((left, right) => new Date(right.occurredAt || 0).getTime() - new Date(left.occurredAt || 0).getTime())
    .slice(0, 40);
}

function statusSeverity(status: CompanyBrainCrossCheck["status"]): CompanyBrainCrossCheck["severity"] {
  if (status === "fail") return "critical";
  if (status === "review") return "warning";
  return "info";
}

function joinOrNull(values: string[]) {
  return values.length ? values.join(", ") : null;
}

function isOfferDeliveryFailureEvidence(entry: CompanyBrainEvidence) {
  const text = `${entry.source} ${entry.title} ${entry.detail || ""}`.toLowerCase();
  if (entry.source !== "customer_email_messages" && !/outlook|mail/.test(text)) return false;
  if (!/angebot|quote|a\/n|nr\.?\s*\d+/.test(text)) return false;
  return /unzustellbar|nicht zugestellt|konnte nicht zugestellt|postfach ist nicht verfuegbar|postfach ist nicht verfügbar|recipient.*unknown|mail delivery|delivery status notification|undeliver/.test(text);
}

function timestampMs(value: string | null | undefined) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function isAutomationFailure(run: CompanyBrainAutomationRun | null | undefined) {
  return Boolean(run && /fail|error|failed/i.test(`${run.status || ""} ${run.error || ""}`));
}

function isAutomationFailureResolvedBySendProof(run: CompanyBrainAutomationRun | null | undefined, offerSentCheck: CompanyBrainCrossCheck | null | undefined) {
  if (!isAutomationFailure(run) || offerSentCheck?.status !== "pass") return false;
  const proofTime = timestampMs(offerSentCheck.actual);
  const failureTime = timestampMs(run?.createdAt);
  if (!proofTime) return true;
  if (!failureTime) return true;
  return proofTime >= failureTime;
}

function normalizeRetryEmail(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function isRetryEmailValid(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isInternalRetryEmail(email: string) {
  return /@(neontrip\.de|neontrip\.com)$/i.test(email);
}

function offerNumberLabel(offer: CompanyBrainOfferSummary | null) {
  return offer?.offerNumber || offer?.documentReference || null;
}

export function buildCompanyBrainRetryAssessment(input: {
  records: CompanyBrainRecordSummary[];
  offers: CompanyBrainOfferSummary[];
  evidence: CompanyBrainEvidence[];
  crossChecks: CompanyBrainCrossCheck[];
  trelloFailureDiagnosis: CompanyBrainTrelloFailureDiagnosis;
}): CompanyBrainRetryAssessment {
  const record = input.records[0] || null;
  const offer = input.offers[0] || null;
  const recipientEmail = normalizeRetryEmail(record?.email || offer?.customerEmail || null) || null;
  const offerSentCheck = input.crossChecks.find((check) => check.key === "offer_sent") || null;
  const deliveryFailure = input.evidence.find(isOfferDeliveryFailureEvidence) || null;
  const deliveryFailureText = `${deliveryFailure?.title || ""} ${deliveryFailure?.detail || ""}`.toLowerCase();
  const deliveryFailureForRecipient = Boolean(deliveryFailure && recipientEmail && deliveryFailureText.includes(recipientEmail));
  const automationIssueHint = classifyAutomationIssueText([
    input.trelloFailureDiagnosis.rootCause,
    input.trelloFailureDiagnosis.recommendedFix,
    ...input.trelloFailureDiagnosis.blockedFixes,
    ...input.trelloFailureDiagnosis.diagnostics,
  ].join(" "));
  const blockers: string[] = [];
  const safeFixes: string[] = [];

  if (input.trelloFailureDiagnosis.expectedAction !== "offer_send" && !/angebot|mail|e-mail|versand/i.test(`${offerSentCheck?.summary || ""} ${input.trelloFailureDiagnosis.rootCause}`)) {
    return {
      status: "not_applicable",
      label: "Kein Angebots-Retry",
      summary: "Der geladene Fall wirkt nicht wie ein Angebotsversand-Problem.",
      recipientEmail,
      offerId: offer?.offerId || null,
      offerNumber: offerNumberLabel(offer),
      idempotencyKey: null,
      canSendWithConfirmation: false,
      blockers: ["Kein offer_send-Kontext erkannt."],
      safeFixes: ["Fall erst als Angebotsversand-Problem klassifizieren."],
    };
  }

  if (!record) blockers.push("Keine Kundenakte als Source of Truth gefunden.");
  if (!offer) blockers.push("Kein eindeutiger Angebotssnapshot gefunden.");
  if (!recipientEmail) blockers.push("Keine Empfängeradresse gefunden.");
  if (recipientEmail && !isRetryEmailValid(recipientEmail)) blockers.push("Empfängeradresse ist syntaktisch ungültig.");
  if (recipientEmail && isInternalRetryEmail(recipientEmail)) blockers.push("Empfängeradresse ist eine interne NEONTRIP-Adresse.");
  if (offer?.customerEmail && recipientEmail && normalizeRetryEmail(offer.customerEmail) !== recipientEmail) {
    blockers.push(`Angebot gehört zu ${offer.customerEmail}, Kundenakte zu ${recipientEmail}.`);
  }
  if (deliveryFailureForRecipient) {
    blockers.push("Outlook-Bounce liegt für die aktuelle Empfängeradresse vor.");
    safeFixes.push("Kunden-E-Mail-Adresse/Postfach zuerst korrigieren oder verifizieren.");
  }
  if (offerSentCheck?.status === "pass") {
    blockers.push("Es gibt bereits einen Versand-/Ausgangsbeleg; keinen erneuten Versand auslösen.");
    safeFixes.push("Status-/Trello-Projektion und Fallnotiz prüfen, aber keinen Resend starten.");
  }
  if (automationIssueHint.key === "send_guard_unavailable") {
    blockers.push("Versand-Guard hat keine eindeutige Freigabe geliefert.");
    safeFixes.push("Guard-/Supabase-Erreichbarkeit und Versandbelege prüfen; danach Fall erneut laden.");
  }
  if (automationIssueHint.key === "ai_customer_copy_blocked") {
    blockers.push("Die Kunden-E-Mail wurde durch die Inhaltsprüfung blockiert.");
    safeFixes.push("E-Mail-Text und gesperrte Begriffe intern prüfen; keinen automatischen Resend starten.");
  }
  if (automationIssueHint.key === "outlook_auth_failed") {
    blockers.push("Outlook/Graph-Zugriff ist fehlgeschlagen.");
    safeFixes.push("Graph/Outlook-Konfiguration und Versandbelege prüfen; danach Fall erneut laden.");
  }
  if (automationIssueHint.key === "offer_api_failed") {
    blockers.push("Angebotsanlage oder Offer-API ist fehlgeschlagen.");
    safeFixes.push("Offer-Snapshot/Offer-Bridge reparieren; Versand erst danach neu bewerten.");
  }
  if (automationIssueHint.key === "asset_processing_failed") {
    blockers.push("Design-/Anhang-Assets konnten nicht sicher verarbeitet werden.");
    safeFixes.push("Relevante Assets sichern oder neu verknüpfen; Angebot danach erneut prüfen.");
  }
  if (automationIssueHint.key === "workflow_hard_error") {
    blockers.push("Die n8n-Automation ist hart fehlgeschlagen.");
    safeFixes.push("n8n-Execution, betroffenen Node, Outlook/quote_email_log und Duplicate-Guard prüfen.");
  }
  if (automationIssueHint.key === "duplicate_guard") {
    blockers.push("Duplicate-/Idempotency-Schutz meldet möglichen bestehenden Versand.");
    safeFixes.push("quote_email_log, Outlook und Offer-Status konsolidieren; keinen Resend starten.");
  }

  if (!safeFixes.length) {
    if (!record) safeFixes.push("Karte mit Request-ID/Kundenakte verknüpfen.");
    if (!offer) safeFixes.push("Offer-Bridge oder Angebotsanlage prüfen.");
    if (recipientEmail && !isRetryEmailValid(recipientEmail)) safeFixes.push("Korrekte Kunden-E-Mail in der Kundenakte hinterlegen.");
  }

  const idempotencyKey = offer && recipientEmail
    ? `company-brain-offer-resend:${offer.offerId}:${recipientEmail}`
    : null;
  const hardBlockers = blockers;
  const canSendWithConfirmation = Boolean(record && offer && recipientEmail && !hardBlockers.length);
  const status: CompanyBrainRetryAssessment["status"] =
    canSendWithConfirmation
      ? "ready"
      : blockers.some((blocker) => /Bounce|ungültig|interne|gehört zu/.test(blocker))
        ? "needs_fix"
        : blockers.length
          ? "blocked"
          : "not_applicable";

  return {
    status,
    label: status === "ready" ? "Retry bereit" : status === "needs_fix" ? "Fix vor Retry nötig" : "Retry blockiert",
    summary: status === "ready"
      ? "Der Retry kann nach erneuter serverseitiger Duplicate-Prüfung und Freigabe ausgeführt werden."
      : blockers[0] || "Kein sicherer Retry-Kontext erkannt.",
    recipientEmail,
    offerId: offer?.offerId || null,
    offerNumber: offerNumberLabel(offer),
    idempotencyKey,
    canSendWithConfirmation,
    blockers,
    safeFixes: safeFixes.length ? safeFixes : ["Serverseitigen Duplicate-Check ausführen und erst danach senden."],
  };
}

export function buildCompanyBrainCrossChecks(input: {
  records: CompanyBrainRecordSummary[];
  offers: CompanyBrainOfferSummary[];
  evidence: CompanyBrainEvidence[];
  question: string | null;
}): CompanyBrainCrossCheck[] {
  const { records, offers, evidence, question } = input;
  const signals = extractCompanyBrainSignals(`${question || ""} ${evidence.filter((entry) => entry.direction === "inbound").map((entry) => `${entry.title} ${entry.detail || ""}`).join(" ")}`);
  const requestedColors = normalizeColorList(records.flatMap((record) => record.requestedColors));
  const inboundColors = normalizeColorList(evidence.filter((entry) => entry.direction === "inbound").flatMap((entry) => extractColorHints(`${entry.title} ${entry.detail || ""}`)));
  const expectedColors = uniqueStrings([...requestedColors, ...inboundColors, ...signals.colors]);
  const offerColors = normalizeColorList(offers.flatMap((offer) => offer.colorHints));
  const latestRecord = records[0] || null;
  const latestOffer = offers[0] || null;
  const outboundEvidence = evidence.find((entry) => entry.direction === "outbound" && /angebot|mail|e-mail|follow-up|dokument/i.test(`${entry.title} ${entry.detail || ""}`));
  const deliveryFailureEvidence = evidence.find(isOfferDeliveryFailureEvidence);
  const inboundEvidence = evidence.find((entry) => entry.direction === "inbound");
  const offerEvidence = evidence.find((entry) => entry.source.startsWith("offers_api"));
  const designEvidence = evidence.filter((entry) => /design|bild|position|mockup|entwurf|motiv/i.test(`${entry.title} ${entry.detail || ""}`));
  const maxDesignEvidence = Math.max(...offers.map((offer) => Math.max(offer.designEvidenceCount, offer.imageCount)), 0);
  const checks: CompanyBrainCrossCheck[] = [];

  const missingColors = expectedColors.filter((color) => !offerColors.includes(color));
  const colorStatus: CompanyBrainCrossCheck["status"] =
    expectedColors.length && offerColors.length
      ? missingColors.length ? "fail" : "pass"
      : expectedColors.length || offerColors.length
        ? "review"
        : "unknown";
  checks.push({
    key: "color_match",
    label: "Farbe Request/Kunde vs. Angebot",
    status: colorStatus,
    severity: statusSeverity(colorStatus),
    expected: joinOrNull(expectedColors),
    actual: joinOrNull(offerColors),
    summary: colorStatus === "fail"
      ? `Im Kunden-/Request-Kontext steht ${expectedColors.join(", ")}, im Angebot aber ${offerColors.join(", ")}.`
      : colorStatus === "pass"
        ? "Farbhinweise aus Kunde/Request und Angebot passen zusammen."
        : "Farben sind nicht vollständig belegt.",
    evidenceIds: evidence.filter((entry) => /farbe|color|angebot|position/i.test(`${entry.title} ${entry.detail || ""}`)).slice(0, 6).map((entry) => entry.id),
  });

  const offerSent = Boolean(latestRecord?.latestOfferSentAt || outboundEvidence);
  const offerSentStatus: CompanyBrainCrossCheck["status"] = deliveryFailureEvidence ? "fail" : offerSent ? "pass" : latestOffer ? "review" : "unknown";
  checks.push({
    key: "offer_sent",
    label: "Angebotsversand",
    status: offerSentStatus,
    severity: statusSeverity(offerSentStatus),
    expected: signals.asksOfferSent ? "Versandstatus beantworten" : "Versandbeleg",
    actual: deliveryFailureEvidence?.occurredAt || latestRecord?.latestOfferSentAt || outboundEvidence?.occurredAt || null,
    summary: deliveryFailureEvidence
      ? `Outlook meldet Unzustellbarkeit: ${deliveryFailureEvidence.title}${deliveryFailureEvidence.detail ? ` · ${deliveryFailureEvidence.detail}` : ""}`
      : offerSent
      ? "Ein Versand- oder Ausgangsbeleg ist vorhanden."
      : latestOffer
        ? "Angebot existiert, aber ein eindeutiger Versandbeleg fehlt im geladenen Ergebnis."
        : "Kein Angebot für Versandprüfung geladen.",
    evidenceIds: [deliveryFailureEvidence?.id, outboundEvidence?.id, offerEvidence?.id].filter(Boolean) as string[],
  });

  const designStatus: CompanyBrainCrossCheck["status"] =
    signals.designCount
      ? maxDesignEvidence >= signals.designCount ? "pass" : latestOffer ? "fail" : "unknown"
      : maxDesignEvidence ? "pass" : "review";
  checks.push({
    key: "design_count",
    label: "Design-/Bildanzahl",
    status: designStatus,
    severity: statusSeverity(designStatus),
    expected: signals.designCount ? `${signals.designCount} Design/Bild-Hinweis(e)` : null,
    actual: latestOffer ? `${maxDesignEvidence} Design-/Bildhinweis(e)` : null,
    summary: signals.designCount
      ? (maxDesignEvidence >= signals.designCount ? "Die angefragte Designanzahl ist belegt." : "Die angefragte Designanzahl ist im Angebot nicht belegt.")
      : "Keine konkrete Designanzahl angefragt; vorhandene Design-/Bildhinweise werden angezeigt.",
    evidenceIds: designEvidence.slice(0, 8).map((entry) => entry.id),
  });

  const productStatus: CompanyBrainCrossCheck["status"] =
    signals.mentions3d ? latestOffer?.productHints.includes("3D") ? "pass" : latestOffer ? "fail" : "unknown" : latestOffer?.productHints.length ? "pass" : "unknown";
  checks.push({
    key: "product_type",
    label: "Produktart",
    status: productStatus,
    severity: statusSeverity(productStatus),
    expected: signals.mentions3d ? "3D" : null,
    actual: latestOffer?.productHints.length ? latestOffer.productHints.join(", ") : null,
    summary: signals.mentions3d
      ? (latestOffer?.productHints.includes("3D") ? "3D-Hinweis im Angebot gefunden." : "3D-Hinweis im Angebot nicht gefunden.")
      : "Produkt-Hinweise aus dem Angebot extrahiert.",
    evidenceIds: [offerEvidence?.id].filter(Boolean) as string[],
  });

  const confirmationStatus: CompanyBrainCrossCheck["status"] = inboundEvidence ? "pass" : signals.asksCustomerConfirmation ? "fail" : "unknown";
  checks.push({
    key: "customer_confirmation",
    label: "Kundenbestätigung",
    status: confirmationStatus,
    severity: statusSeverity(confirmationStatus),
    expected: signals.asksCustomerConfirmation ? "Kundenantwort/Freigabe" : null,
    actual: inboundEvidence?.occurredAt || null,
    summary: inboundEvidence ? `Kundeneingang vorhanden: ${inboundEvidence.title}.` : "Keine Kundenantwort im geladenen Ergebnis.",
    evidenceIds: [inboundEvidence?.id].filter(Boolean) as string[],
  });

  const orderStatus: CompanyBrainCrossCheck["status"] = latestRecord?.latestOrderNumber ? "pass" : signals.asksOrder ? "fail" : "unknown";
  checks.push({
    key: "order_link",
    label: "Bestellung verknüpft",
    status: orderStatus,
    severity: statusSeverity(orderStatus),
    expected: signals.asksOrder ? "Shopify-/Bestellbeleg" : null,
    actual: latestRecord?.latestOrderNumber || null,
    summary: latestRecord?.latestOrderNumber ? `Bestellung ${latestRecord.latestOrderNumber} ist verknüpft.` : "Keine Bestellung im geladenen Fall verknüpft.",
    evidenceIds: evidence.filter((entry) => /bestellung|order|shopify/i.test(`${entry.title} ${entry.detail || ""}`)).slice(0, 4).map((entry) => entry.id),
  });

  return checks;
}

function buildConflicts(crossChecks: CompanyBrainCrossCheck[]) {
  const conflicts: CompanyBrainFinding[] = [];
  for (const check of crossChecks.filter((entry) => entry.status === "fail")) {
    conflicts.push({
      severity: check.severity,
      title: check.label,
      detail: check.summary,
      source: check.key,
    });
  }
  for (const check of crossChecks.filter((entry) => entry.status === "review" && entry.severity === "warning")) {
    conflicts.push({
      severity: "warning",
      title: `${check.label} prüfen`,
      detail: check.summary,
      source: check.key,
    });
  }
  return conflicts;
}

function buildReplyDraft(input: {
  answer: CompanyBrainResolveResult["answer"];
  records: CompanyBrainRecordSummary[];
  offers: CompanyBrainOfferSummary[];
  crossChecks: CompanyBrainCrossCheck[];
  conflicts: CompanyBrainFinding[];
  gaps: CompanyBrainFinding[];
  evidence: CompanyBrainEvidence[];
}): CompanyBrainReplyDraft {
  const primaryRecord = input.records[0] || null;
  const primaryOffer = input.offers[0] || null;
  const blockers = [
    ...input.conflicts.filter((finding) => finding.severity !== "info").map((finding) => `${finding.title}: ${finding.detail}`),
    ...input.gaps.filter((finding) => finding.severity === "warning").map((finding) => `${finding.title}: ${finding.detail}`),
  ].slice(0, 8);
  const riskLevel: CompanyBrainReplyDraft["riskLevel"] = input.conflicts.some((finding) => finding.severity === "critical")
    ? "high"
    : blockers.length
      ? "medium"
      : "low";
  const subjectReference = primaryOffer?.offerNumber || primaryOffer?.documentReference || primaryRecord?.requestId || "Ihrem Anliegen";
  const provenLines = input.crossChecks
    .filter((check) => check.status === "pass")
    .slice(0, 4)
    .map((check) => `- ${check.label}: ${check.actual || check.summary}`);
  const uncertainLines = [...input.conflicts, ...input.gaps]
    .filter((finding) => finding.severity !== "info")
    .slice(0, 4)
    .map((finding) => `- ${finding.title}: ${finding.detail}`);

  return {
    title: "Interner Antwortentwurf",
    riskLevel,
    approvalRequired: true,
    canSendAutomatically: false,
    subject: `Prüfung zu ${subjectReference}`,
    body: [
      "Hallo,",
      "",
      "wir haben den Fall anhand der internen Belege geprüft.",
      provenLines.length ? "" : null,
      provenLines.length ? "Belegt ist:" : null,
      ...provenLines,
      uncertainLines.length ? "" : null,
      uncertainLines.length ? "Vor einer verbindlichen Aussage müssen wir noch prüfen:" : null,
      ...uncertainLines,
      "",
      "Bitte diesen Entwurf vor dem Versand fachlich prüfen und erst nach Freigabe anpassen/versenden.",
      "",
      "Viele Grüße",
      "NEONTRIP",
    ].filter((line): line is string => line !== null).join("\n"),
    blockers,
    sourceEvidenceIds: input.evidence.slice(0, 8).map((entry) => entry.id),
  };
}

function buildWatchers(input: {
  records: CustomerSearchResult[];
  recordSummaries: CompanyBrainRecordSummary[];
  offers: CompanyBrainOfferSummary[];
  evidence: CompanyBrainEvidence[];
  crossChecks: CompanyBrainCrossCheck[];
  automationRuns: CompanyBrainAutomationRun[];
  integrationReadiness: CompanyBrainIntegrationReadiness[];
  assets: CompanyBrainAsset[];
  trelloFailureDiagnosis: CompanyBrainTrelloFailureDiagnosis;
}): CompanyBrainWatcher[] {
  const watchers: CompanyBrainWatcher[] = [];
  const latestRecord = input.recordSummaries[0] || null;
  const latestOffer = input.offers[0] || null;
  const deliveryFailureEvidence = input.evidence.find(isOfferDeliveryFailureEvidence) || null;
  const latestInbound = input.evidence.find((entry) => entry.direction === "inbound" && !isOfferDeliveryFailureEvidence(entry)) || null;
  const openTasks = input.records.flatMap((record) => record.internalTasks || []).filter((task) => task.status === "open");
  const offerSentCheck = input.crossChecks.find((check) => check.key === "offer_sent");
  const failedAutomation = input.automationRuns.find((run) => isAutomationFailure(run)) || null;
  const automationResolvedBySendProof = isAutomationFailureResolvedBySendProof(failedAutomation, offerSentCheck);
  const colorCheck = input.crossChecks.find((check) => check.key === "color_match");
  const liveOutlook = input.integrationReadiness.find((entry) => entry.key === "live_outlook");
  const designAssets = input.assets.filter((asset) => asset.kind === "reference_image" || asset.kind === "mockup" || asset.kind === "offer_image");

  watchers.push({
    key: "offer_without_send_proof",
    severity: offerSentCheck?.status === "fail" ? "critical" : offerSentCheck?.status === "review" ? "warning" : "info",
    status: offerSentCheck?.status === "fail" || offerSentCheck?.status === "review" ? "open" : "ok",
    title: offerSentCheck?.status === "fail" ? "Angebotsversand fehlgeschlagen" : "Angebot ohne eindeutigen Versandbeleg",
    detail: offerSentCheck?.summary || deliveryFailureEvidence?.title || "Kein Angebot für Versandprüfung geladen.",
    actionKey: offerSentCheck?.status === "fail" || offerSentCheck?.status === "review" ? "verify_live_outlook" : null,
  });

  watchers.push({
    key: "customer_reply_without_task",
    severity: latestInbound && !openTasks.length ? "warning" : "info",
    status: latestInbound && !openTasks.length ? "open" : "ok",
    title: "Kundenantwort ohne offene Aufgabe",
    detail: latestInbound
      ? openTasks.length
        ? `${openTasks.length} offene Aufgabe(n) im Fall vorhanden.`
        : `Kundeneingang ${latestInbound.occurredAt || "ohne Zeitpunkt"} gefunden, aber keine offene interne Aufgabe im geladenen Fall.`
      : "Kein Kundeneingang im geladenen Zeitstrahl.",
    actionKey: latestInbound && !openTasks.length ? "create_internal_task" : null,
  });

  watchers.push({
    key: "order_without_color_confirmation",
    severity: latestRecord?.latestOrderNumber && colorCheck?.status !== "pass" ? "critical" : "info",
    status: latestRecord?.latestOrderNumber && colorCheck?.status !== "pass" ? "open" : "ok",
    title: "Bestellung ohne saubere Farbbestätigung",
    detail: latestRecord?.latestOrderNumber
      ? colorCheck?.status === "pass"
        ? `Bestellung ${latestRecord.latestOrderNumber} ist verknüpft und Farbe ist belegt.`
        : `Bestellung ${latestRecord.latestOrderNumber} ist verknüpft, aber Farbe ist nicht eindeutig bestätigt.`
      : "Keine verknüpfte Bestellung im geladenen Fall.",
    actionKey: latestRecord?.latestOrderNumber && colorCheck?.status !== "pass" ? "copy_reply_draft" : null,
  });

  watchers.push({
    key: "automation_failed",
    severity: failedAutomation && !automationResolvedBySendProof ? "critical" : "info",
    status: failedAutomation && !automationResolvedBySendProof ? "open" : "ok",
    title: automationResolvedBySendProof ? "n8n-Fehler mit späterem Versandbeleg" : "n8n-/Automation-Fehler",
    detail: automationResolvedBySendProof
      ? `Alter Automation-Fehler vorhanden, aber ein späterer Versand-/Ausgangsbeleg ist geladen: ${offerSentCheck?.summary || offerSentCheck?.actual || "Versand belegt"}.`
      : failedAutomation
        ? `${failedAutomation.workflowName || "Workflow"} · ${failedAutomation.action || "Aktion"}${failedAutomation.failedNode ? ` · Node ${failedAutomation.failedNode}` : ""} · ${failedAutomation.error || failedAutomation.summary || failedAutomation.status || "Fehlerstatus"}`
      : "Keine fehlgeschlagenen Automation-Runs im geladenen Audit gefunden.",
    actionKey: failedAutomation && !automationResolvedBySendProof ? "inspect_n8n_run" : null,
  });

  watchers.push({
    key: "missing_live_outlook",
    severity: liveOutlook?.status === "configured" ? "info" : "warning",
    status: liveOutlook?.status === "configured" ? "ok" : "open",
    title: "Live-Outlook nicht vollständig angebunden",
    detail: liveOutlook?.summary || "Outlook-Readiness konnte nicht bestimmt werden.",
    actionKey: liveOutlook?.status === "configured" ? null : "verify_live_outlook",
  });

  watchers.push({
    key: "missing_design_assets",
    severity: latestOffer && !designAssets.length ? "warning" : "info",
    status: latestOffer && !designAssets.length ? "open" : "ok",
    title: "Design-/Anhang-Assets fehlen",
    detail: designAssets.length
      ? `${designAssets.length} Design-/Anhang-Asset(s) im geladenen Fall gefunden.`
      : latestOffer
        ? "Angebot gefunden, aber kein direktes Design-/Anhang-Asset im Inventar."
        : "Kein Angebot für Asset-Prüfung geladen.",
    actionKey: latestOffer && !designAssets.length ? "collect_design_assets" : null,
  });

  watchers.push({
    key: "trello_trigger_failure",
    severity: input.trelloFailureDiagnosis.severity,
    status:
      input.trelloFailureDiagnosis.requested &&
      !["sent", "not_requested"].includes(input.trelloFailureDiagnosis.rootCauseKey)
        ? "open"
        : "ok",
    title: "Trello-Triggerdiagnose",
    detail: input.trelloFailureDiagnosis.rootCause,
    actionKey:
      input.trelloFailureDiagnosis.requested &&
      ["automation_failed", "automation_missing", "offer_exists_no_send_proof"].includes(input.trelloFailureDiagnosis.rootCauseKey)
        ? "inspect_n8n_run"
        : null,
  });

  return watchers;
}

function expectedTrelloAction(question: string | null, problemType: CompanyBrainProblemType | null): CompanyBrainTrelloFailureDiagnosis["expectedAction"] {
  const text = cleanText(question).toLowerCase();
  if (problemType === "offer_not_sent" || /angebot|mail|e-?mail|raus|gesendet|versendet|verschickt/.test(text)) {
    return "offer_send";
  }
  if (problemType === "customer_waiting" || /aufgabe|nachfassen|follow.?up|antwort/.test(text)) {
    return "internal_followup";
  }
  return "unknown";
}

function latestTrelloMove(actions: TrelloFailureContextAction[]) {
  return actions.find((action) => action.fromListName || action.toListName) || null;
}

function trelloMoveMatchesOfferIntent(move: TrelloFailureContextAction | null) {
  const text = `${move?.fromListName || ""} ${move?.toListName || ""}`.toLowerCase();
  return /angebot|offer|quote|raus|send|sent|fertig|ready|versand|mail/.test(text);
}

export function buildTrelloFailureDiagnosis(input: {
  requested: boolean;
  context: TrelloFailureContext | null;
  diagnostic: CompanyBrainDiagnostic | null;
  records: CompanyBrainRecordSummary[];
  offers: CompanyBrainOfferSummary[];
  crossChecks: CompanyBrainCrossCheck[];
  automationRuns: CompanyBrainAutomationRun[];
  question: string | null;
  problemType: CompanyBrainProblemType | null;
}): CompanyBrainTrelloFailureDiagnosis {
  if (!input.requested && !input.context) return emptyTrelloFailureDiagnosis(false);
  if (!input.context) {
    const base = emptyTrelloFailureDiagnosis(true);
    const expectedAction = expectedTrelloAction(input.question, input.problemType);
    return {
      ...base,
      status: input.diagnostic?.ok === false ? "error" : "not_configured",
      expectedAction,
      rootCauseKey: input.diagnostic?.ok === false ? "trello_error" : "trello_not_configured",
      rootCause: input.diagnostic?.ok === false
        ? `Trello konnte nicht live gelesen werden: ${input.diagnostic.detail || "unbekannter Fehler"}.`
        : base.rootCause,
      recommendedFix: input.diagnostic?.ok === false
        ? "Trello-Zugriff, Card-ID und API-Limits prüfen; danach Diagnose erneut starten."
        : base.recommendedFix,
      diagnostics: [input.diagnostic?.detail || "Trello Live nicht verfügbar."],
    };
  }

  const expectedAction = expectedTrelloAction(input.question, input.problemType);
  const triggerMove = latestTrelloMove(input.context.actions);
  const offerSentCheck = input.crossChecks.find((check) => check.key === "offer_sent");
  const failedAutomation = input.automationRuns.find((run) => isAutomationFailure(run)) || null;
  const failedAutomationHint = failedAutomation
    ? classifyAutomationIssueText([
        failedAutomation.error,
        failedAutomation.summary,
        input.context.card.desc,
        ...input.context.actions.slice(0, 6).map((action) => action.text),
      ].filter(Boolean).join(" "))
    : null;
  const hasAutomation = input.automationRuns.length > 0;
  const hasRecord = input.records.length > 0;
  const hasOffer = input.offers.length > 0;
  const offerSent = offerSentCheck?.status === "pass";
  const automationResolvedBySendProof = isAutomationFailureResolvedBySendProof(failedAutomation, offerSentCheck);
  const offerIntentMove = trelloMoveMatchesOfferIntent(triggerMove);
  let rootCauseKey: CompanyBrainTrelloFailureDiagnosis["rootCauseKey"] = "undetermined";
  let rootCause = "Trello-Karte wurde geladen, aber die Ursache ist noch nicht eindeutig belegbar.";
  let recommendedFix = "Kartenbewegung, Source-of-Truth-Datensatz, Angebot, Versandbeleg und Workflow-Audit gemeinsam prüfen.";
  let severity: CompanyBrainTrelloFailureDiagnosis["severity"] = "warning";

  if (automationResolvedBySendProof) {
    rootCauseKey = "sent";
    rootCause = `${failedAutomation?.workflowName || "Workflow"} hatte einen Fehler, aber ein späterer Versand-/Ausgangsbeleg ist vorhanden. Der ursprüngliche Versandfehler wirkt damit fachlich erledigt; offen ist höchstens Rückschreibung/Projektion.`;
    recommendedFix = "Kein erneuter Versand. Status-Rückschreibung, Trello-Kommentar und interne Fallnotiz prüfen; nur bei fehlendem Beleg erneut in Outlook/quote_email_log gegenprüfen.";
    severity = "info";
  } else if (failedAutomation) {
    rootCauseKey = "automation_failed";
    rootCause = failedAutomationHint && failedAutomationHint.key !== "unknown"
      ? `${failedAutomation.workflowName || "Workflow"} ist${failedAutomation.failedNode ? ` bei Node "${failedAutomation.failedNode}"` : ""} fehlgeschlagen. ${failedAutomationHint.rootCause}`
      : `${failedAutomation.workflowName || "Workflow"} ist${failedAutomation.failedNode ? ` bei Node "${failedAutomation.failedNode}"` : ""} fehlgeschlagen: ${failedAutomation.error || failedAutomation.summary || failedAutomation.status || "Fehlerstatus"}.`;
    recommendedFix = failedAutomationHint && failedAutomationHint.key !== "unknown"
      ? failedAutomationHint.recommendedFix
      : failedAutomation.idempotencyKey
        ? `n8n-Execution ${failedAutomation.executionId || failedAutomation.correlationId || "ohne ID"} prüfen. Retry nur mit Idempotency-Key ${failedAutomation.idempotencyKey} und nach Duplicate-Mail-Check freigeben.`
        : `n8n-Execution ${failedAutomation.executionId || failedAutomation.correlationId || "mit Correlation-ID"} prüfen. Retry nur idempotent und nach Duplicate-Mail-Check freigeben.`;
    severity = "critical";
  } else if (!triggerMove) {
    rootCauseKey = "no_trigger_move";
    rootCause = "In der geladenen Trello-Historie wurde kein Listenwechsel gefunden.";
    recommendedFix = "Prüfen, ob die richtige Karte eingegeben wurde oder ob der relevante Listenwechsel außerhalb des geladenen Action-Fensters liegt.";
  } else if (!hasRecord) {
    rootCauseKey = "no_source_record";
    rootCause = "Die Trello-Karte ist live lesbar, aber es wurde keine verknüpfte Kundenakte als Source of Truth gefunden.";
    recommendedFix = "Karte mit Request-ID/Kundenakte verknüpfen; keinen Versand-Retry aus Trello allein starten.";
  } else if (expectedAction === "offer_send" && !hasOffer) {
    rootCauseKey = "offer_missing";
    rootCause = "Für die Karte/Kundenakte wurde kein Angebotssnapshot gefunden.";
    recommendedFix = "Angebotsanlage und Offer-Bridge prüfen; erst danach Versandlogik oder Retry bewerten.";
  } else if (expectedAction === "offer_send" && offerSent) {
    rootCauseKey = "sent";
    rootCause = "Ein Versandbeleg ist vorhanden; das Problem wirkt eher wie fehlende Rückschreibung oder Wahrnehmung im Prozess.";
    recommendedFix = "Kein erneuter Versand. Status-Rückschreibung und sichtbare Aufgaben-/Trello-Projektion prüfen.";
    severity = "info";
  } else if (expectedAction === "offer_send" && hasOffer && !offerSent && !hasAutomation && offerIntentMove) {
    rootCauseKey = "automation_missing";
    rootCause = "Die Karte wurde in eine angebotsnahe Liste bewegt, aber es gibt keinen passenden Workflow-Audit-Eintrag.";
    recommendedFix = "Trello-Trigger/Webhook und Listen-Mapping prüfen; Retry nur über idempotente Queue mit Duplicate-Mail-Check.";
    severity = "critical";
  } else if (expectedAction === "offer_send" && hasOffer && !offerSent) {
    rootCauseKey = "offer_exists_no_send_proof";
    rootCause = "Angebot existiert, aber ein eindeutiger Versandbeleg fehlt.";
    recommendedFix = "Outlook-Spiegel/Live-Outlook und n8n-Audit prüfen; bei eindeutig fehlendem Versand idempotenten Retry vorbereiten.";
    severity = "warning";
  }

  const evidenceStrength: CompanyBrainTrelloFailureDiagnosis["evidenceStrength"] =
    rootCauseKey === "sent"
      ? "strong"
      : failedAutomation || (hasRecord && hasOffer && triggerMove)
        ? "medium"
        : hasRecord || triggerMove
          ? "weak"
          : "weak";
  const duplicateRisk: CompanyBrainTrelloFailureDiagnosis["duplicateRisk"] =
    expectedAction === "offer_send" && !offerSent ? "high" : expectedAction === "unknown" ? "medium" : "low";
  const safeFixes = [
    !automationResolvedBySendProof && failedAutomationHint && failedAutomationHint.key !== "unknown" ? failedAutomationHint.safeFix : null,
    hasRecord ? "Interne Problemfall-Aufgabe mit Trello-Card-ID und Befund anlegen." : null,
    rootCauseKey === "no_source_record" ? "Karte manuell mit Request-ID/Kundenakte verknüpfen." : null,
    rootCauseKey === "sent" ? "Status-/Trello-Projektion nachziehen, keinen erneuten Versand auslösen." : null,
    ["automation_failed", "automation_missing", "offer_exists_no_send_proof"].includes(rootCauseKey)
      ? "Idempotenten Retry vorbereiten, aber erst nach Versand-Duplicate-Check freigeben."
      : null,
  ].filter(Boolean) as string[];
  const blockedFixes = [
    !automationResolvedBySendProof && failedAutomationHint && isBlockingAutomationIssueKey(failedAutomationHint.key)
      ? failedAutomationHint.retrySafety
      : null,
    expectedAction === "offer_send" && !offerSent ? "Kein automatischer Angebotsversand ohne Outlook-Duplicate-Check." : null,
    "Kein n8n-Workflow-Change ohne Backup, Diff, Test und Rollback.",
    "Trello-Listenwechsel allein reicht nicht als Source of Truth.",
  ].filter(Boolean) as string[];

  return {
    requested: true,
    status: "loaded",
    severity,
    expectedAction,
    card: {
      id: input.context.card.id,
      shortLink: input.context.card.shortLink,
      name: input.context.card.name,
      descriptionPreview: previewText(input.context.card.desc),
      url: input.context.card.url || input.context.card.shortUrl,
      currentListName: input.context.card.currentListName,
      dateLastActivity: input.context.card.dateLastActivity,
      attachmentsCount: input.context.card.attachmentsCount,
      customFields: trelloCustomFieldEntries(input.context),
    },
    triggerMove: triggerMove
      ? {
          id: triggerMove.id,
          occurredAt: triggerMove.date,
          fromListName: triggerMove.fromListName,
          toListName: triggerMove.toListName,
        }
      : null,
    rootCauseKey,
    rootCause,
    recommendedFix,
    evidenceStrength,
    duplicateRisk,
    safeFixes,
    blockedFixes,
    timeline: input.context.actions.slice(0, 12).map((action) => ({
      id: action.id,
      label: action.fromListName || action.toListName
        ? `Move ${action.fromListName || "unbekannt"} -> ${action.toListName || "unbekannt"}`
        : action.type || "Trello-Aktion",
      occurredAt: action.date,
      detail: action.text || input.context?.card.name || "",
    })),
    diagnostics: [
      `Karte: ${input.context.card.id}`,
      triggerMove ? `Letzter Move: ${triggerMove.fromListName || "unbekannt"} -> ${triggerMove.toListName || "unbekannt"}` : "Kein Move im Action-Fenster.",
      `Kundenakte: ${hasRecord ? "gefunden" : "fehlt"}`,
      `Angebot: ${hasOffer ? "gefunden" : "fehlt"}`,
      `Workflow-Audit: ${hasAutomation ? `${input.automationRuns.length} Eintrag/Einträge` : "kein Eintrag"}`,
      failedAutomation?.executionId ? `Fehler-Execution: ${failedAutomation.executionId}` : null,
      failedAutomation?.failedNode ? `Fehler-Node: ${failedAutomation.failedNode}` : null,
      failedAutomation?.idempotencyKey ? `Idempotency: ${failedAutomation.idempotencyKey}` : null,
      failedAutomation?.retrySafety ? `Retry-Sicherheit: ${failedAutomation.retrySafety}` : null,
    ].filter(Boolean) as string[],
  };
}

export function normalizeCompanyBrainProblemType(value: string | null | undefined): CompanyBrainProblemType | null {
  switch (value) {
    case "color_dispute":
    case "damaged_sign":
    case "offer_not_sent":
    case "customer_waiting":
    case "design_unclear":
    case "delivery_problem":
    case "payment_order_unclear":
    case "automation_failed":
    case "other":
      return value;
    default:
      return null;
  }
}

function inferProblemType(input: {
  requested: CompanyBrainProblemType | null;
  question: string | null;
  crossChecks: CompanyBrainCrossCheck[];
  watchers: CompanyBrainWatcher[];
}): CompanyBrainProblemType {
  if (input.requested) return input.requested;
  const text = cleanText(input.question).toLowerCase();
  if (/farbe|blau|rot|gruen|grün|weiss|weiß|falsch.*farbe|andere.*farbe/.test(text)) return "color_dispute";
  if (/kaputt|beschädigt|beschaedigt|defekt|gebrochen|schaden/.test(text)) return "damaged_sign";
  if (/angebot.*(nicht|kein).*raus|nicht.*gesendet|mail.*nicht/.test(text)) return "offer_not_sent";
  if (/wartet|lange|antwort|rückmeldung|rueckmeldung/.test(text)) return "customer_waiting";
  if (/design|mockup|entwurf|motiv|layout/.test(text)) return "design_unclear";
  if (/liefer|tracking|paket|sendung|zugestellt|versand/.test(text)) return "delivery_problem";
  if (/zahlung|bezahlt|bestellung|shopify|auftrag/.test(text)) return "payment_order_unclear";
  if (input.watchers.some((watcher) => watcher.key === "automation_failed" && watcher.status === "open")) return "automation_failed";
  if (input.crossChecks.some((check) => check.key === "color_match" && check.status === "fail")) return "color_dispute";
  return "other";
}

function problemTypeLabel(problemType: CompanyBrainProblemType) {
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
    default:
      return "Sonstiger Problemfall";
  }
}

function specialCaseKindFor(problemType: CompanyBrainProblemType): CustomerSpecialCaseKind {
  switch (problemType) {
    case "damaged_sign":
    case "delivery_problem":
      return "replacement";
    case "customer_waiting":
    case "design_unclear":
    case "offer_not_sent":
    case "payment_order_unclear":
    case "automation_failed":
    case "color_dispute":
      return "open_question";
    default:
      return "other";
  }
}

function buildEvidenceScore(input: {
  records: CompanyBrainRecordSummary[];
  offers: CompanyBrainOfferSummary[];
  evidence: CompanyBrainEvidence[];
  assets: CompanyBrainAsset[];
  crossChecks: CompanyBrainCrossCheck[];
  sourceHealth: CompanyBrainSourceHealth[];
}): CompanyBrainEvidenceScore {
  const reasons: string[] = [];
  let score = 0;
  if (input.records.length) {
    score += 20;
    reasons.push("Kundenakte gefunden.");
  }
  if (input.offers.length) {
    score += 20;
    reasons.push("Angebotssnapshot geladen.");
  }
  if (input.evidence.some((entry) => entry.direction === "inbound")) {
    score += 12;
    reasons.push("Kundeneingang vorhanden.");
  }
  if (input.evidence.some((entry) => entry.direction === "outbound")) {
    score += 12;
    reasons.push("Ausgehender Kommunikationsbeleg vorhanden.");
  }
  if (input.assets.length) {
    score += 12;
    reasons.push("Design-/Anhang-Assets vorhanden.");
  }
  if (input.sourceHealth.filter((source) => source.status === "ok").length >= 4) {
    score += 12;
    reasons.push("Mehrere Quellen sind verfügbar.");
  }
  if (input.crossChecks.some((check) => check.status === "pass")) {
    score += 12;
    reasons.push("Mindestens ein Kerncheck ist belegt.");
  }
  const failedChecks = input.crossChecks.filter((check) => check.status === "fail");
  const reviewChecks = input.crossChecks.filter((check) => check.status === "review");
  if (failedChecks.length) {
    score = Math.max(0, score - 35);
    reasons.push(`${failedChecks.length} Konflikt(e) in der Matrix.`);
  } else if (reviewChecks.length) {
    score = Math.max(0, score - 12);
    reasons.push(`${reviewChecks.length} Punkt(e) müssen geprüft werden.`);
  }

  const bounded = Math.max(0, Math.min(100, score));
  const status: CompanyBrainEvidenceScore["status"] = failedChecks.length
    ? "conflicting"
    : bounded >= 75
      ? "strong"
      : bounded >= 45
        ? "medium"
        : "weak";
  return {
    status,
    score: bounded,
    summary:
      status === "strong"
        ? "Beweislage stark genug für eine vorsichtige, belegbasierte Antwort."
        : status === "medium"
          ? "Beweislage brauchbar, aber vor verbindlicher Aussage prüfen."
          : status === "conflicting"
            ? "Beweislage widersprüchlich; keine verbindliche Kundenaussage ohne Klärung."
            : "Beweislage schwach; erst fehlende Quellen prüfen.",
    safeToAnswerCustomer: status === "strong" && !failedChecks.length,
    reasons,
  };
}

function buildProblemResolution(input: {
  problemType: CompanyBrainProblemType;
  records: CompanyBrainRecordSummary[];
  offers: CompanyBrainOfferSummary[];
  crossChecks: CompanyBrainCrossCheck[];
  watchers: CompanyBrainWatcher[];
  evidenceScore: CompanyBrainEvidenceScore;
  assets: CompanyBrainAsset[];
}): CompanyBrainProblemResolution {
  const primaryRecord = input.records[0] || null;
  const primaryOffer = input.offers[0] || null;
  const openWatchers = input.watchers.filter((watcher) => watcher.status === "open");
  const failedChecks = input.crossChecks.filter((check) => check.status === "fail");
  const reviewChecks = input.crossChecks.filter((check) => check.status === "review");
  const failedOfferSentCheck = input.crossChecks.find((check) => check.key === "offer_sent" && check.status === "fail") || null;
  const missingEvidence = [
    input.assets.length ? null : "Design-/Anhang-Assets prüfen",
    input.evidenceScore.status === "weak" ? "Weitere Belege aus Kundenakte/Outlook/Angebot laden" : null,
    ...reviewChecks.map((check) => `${check.label} klären`),
  ].filter(Boolean) as string[];
  const severity: CompanyBrainProblemResolution["severity"] =
    failedChecks.length || openWatchers.some((watcher) => watcher.severity === "critical")
      ? "critical"
      : openWatchers.length || input.evidenceScore.status !== "strong"
        ? "warning"
        : "info";
  const baseRef = primaryOffer?.offerNumber || primaryOffer?.documentReference || primaryRecord?.requestId || "Fall";
  const label = problemTypeLabel(input.problemType);
  const policy = [
    "Keine Preise, Rabatte, Liefertermine oder Schuldzusagen erfinden.",
    "Nur belegte Fakten nennen und Unsicherheiten offen als Prüfung formulieren.",
    "Bei Konflikten zuerst intern klären, dann Kundenantwort finalisieren.",
  ];

  const playbooks: Record<CompanyBrainProblemType, { rootCause: string; resolution: string; required: string[]; escalation: string[] }> = {
    color_dispute: {
      rootCause: failedChecks.some((check) => check.key === "color_match") ? "Farbhinweise widersprechen sich." : "Farbe ist nicht ausreichend belegt.",
      resolution: "Anfragefarbe, Kundenmails, Mockups und Angebotspositionen vergleichen; erst danach entscheiden, ob Korrektur, Rückfrage oder Kulanzfall nötig ist.",
      required: ["Kundenmail mit Farbangabe", "Angebotsposition/Farbhint", "Mockup/Designbeleg"],
      escalation: ["Design/Sales prüft Belege", "Bei Bestellung/Produktion: Daniel oder Produktion freigeben lassen"],
    },
    damaged_sign: {
      rootCause: "Kunde meldet Schaden oder Defekt; Ursache muss mit Foto/Video und Lieferstatus geprüft werden.",
      resolution: "Fotos/Video anfordern oder prüfen, Bestell-/Lieferbezug sichern und dann Ersatz/Kulanz/Technikprüfung entscheiden.",
      required: ["Kundenfoto/Video", "Bestellnummer", "Lieferstatus", "Produkt-/Komponentendaten"],
      escalation: ["Produktion/Qualität prüfen", "Bei Ersatz: Freigabe vor Kundenzusage"],
    },
    offer_not_sent: {
      rootCause: failedOfferSentCheck
        ? "Outlook meldet einen fehlgeschlagenen Angebotsversand."
        : "Angebot existiert oder wird erwartet, aber Versandbeleg ist unklar.",
      resolution: failedOfferSentCheck
        ? "Empfängeradresse/Postfach mit Sales oder Kunde klären; erneuten Versand erst nach Duplicate-Check und eindeutig korrigierter Adresse freigeben."
        : "Outlook-Spiegel/Live-Outlook, Offer-Status und Automation-Audit prüfen; Angebot erst nach eindeutigem Stand erneut senden.",
      required: failedOfferSentCheck
        ? ["Bounce-/Unzustellbarkeitsbeleg", "korrigierte Empfängeradresse", "Duplicate-Mail-Check", "Versandlog nach Resend"]
        : ["Angebotssnapshot", "Versandbeleg", "n8n/Workflow-Audit"],
      escalation: failedOfferSentCheck
        ? ["Sales klärt korrekte E-Mail-Adresse", "Automation/Offer-Log prüfen, wenn Resend nicht protokolliert wurde"]
        : ["Sales prüft Angebot", "Automation prüfen, wenn Versandworkflow fehlte"],
    },
    customer_waiting: {
      rootCause: "Kunde wartet auf Antwort oder nächsten Schritt.",
      resolution: "Offene Aufgabe anlegen, letzten Kundeneingang beantworten und fehlende interne Klärung mit Owner versehen.",
      required: ["Letzter Kundeneingang", "offene interne Aufgabe", "Owner/Fälligkeit"],
      escalation: ["Owner setzen", "Heute beantworten, wenn Kundeneingang offen ist"],
    },
    design_unclear: {
      rootCause: "Designanzahl, Mockup oder bestätigte Variante ist unklar.",
      resolution: "Design-Assets sammeln, bestätigte Variante markieren und Kundenantwort nur mit belegtem Designstand erstellen.",
      required: ["Mockups/Referenzbilder", "Kundenbestätigung", "Angebotsbilder"],
      escalation: ["Design-Team prüfen", "Sales bestätigt Kundenversion"],
    },
    delivery_problem: {
      rootCause: "Lieferstatus oder Zustellung widerspricht Kundenaussage.",
      resolution: "Tracking, Shopify-Bestellung und Kundenaussage vergleichen; bei offenem Problem interne Versandaufgabe anlegen.",
      required: ["Trackingnummer", "Carrier-Status", "Shopify-Bestellung", "Kundenmeldung"],
      escalation: ["Versand prüfen", "Bei Verlust/Beschädigung Ersatzprozess freigeben"],
    },
    payment_order_unclear: {
      rootCause: "Zahlungs-/Bestellstatus ist nicht eindeutig verknüpft.",
      resolution: "Shopify, Angebot und Customer Records abgleichen; keine Produktions- oder Zahlungszusage ohne Beleg.",
      required: ["Shopify-Bestellung", "Angebotsannahme", "Zahlungsstatus"],
      escalation: ["Sales/Vergabe prüfen", "Produktion erst mit sauberem Status"],
    },
    automation_failed: {
      rootCause: "Ein Automation-Run ist fehlgeschlagen oder nicht nachvollziehbar.",
      resolution: "Workflow-Audit mit Correlation/Execution-ID prüfen; Retry nur ausführen, wenn idempotent und Fehlerursache geklärt ist.",
      required: ["Workflow-Name", "Execution-ID", "Correlation-ID", "Fehlertext"],
      escalation: ["n8n prüfen", "Kein Workflow-Change ohne Backup, Diff und Rollback"],
    },
    other: {
      rootCause: "Problemtyp ist nicht eindeutig klassifiziert.",
      resolution: "Fall als offene Rückfrage sichern, Belege sammeln und Owner setzen.",
      required: ["Kundenmeldung", "betroffene Anfrage/Bestellung", "nächster Owner"],
      escalation: ["Ops Owner setzt konkreten Problemtyp"],
    },
  };
  const playbook = playbooks[input.problemType];
  const taskTitle = `${label}: ${baseRef}`;
  const taskDescription = [
    `Problemfall: ${label}`,
    `Beweis-Score: ${input.evidenceScore.score}/100 (${input.evidenceScore.status})`,
    `Empfohlene Lösung: ${playbook.resolution}`,
    "",
    "Offene Wächter:",
    ...(openWatchers.length ? openWatchers.map((watcher) => `- ${watcher.title}: ${watcher.detail}`) : ["- Keine offenen Wächter"]),
    "",
    "Fehlende Belege:",
    ...(missingEvidence.length ? missingEvidence.map((entry) => `- ${entry}`) : ["- Keine kritischen Lücken aus der Matrix"]),
  ].join("\n");

  return {
    problemType: input.problemType,
    label,
    severity,
    confidence: input.evidenceScore.status === "strong" ? "high" : input.evidenceScore.status === "weak" ? "low" : "medium",
    specialCaseKind: specialCaseKindFor(input.problemType),
    rootCause: playbook.rootCause,
    recommendedResolution: playbook.resolution,
    internalTaskTitle: taskTitle,
    internalTaskDescription: taskDescription,
    customerReplyPolicy: policy,
    escalationPath: playbook.escalation,
    requiredEvidence: playbook.required,
    missingEvidence,
  };
}

export function buildActionProposals(input: {
  records: CompanyBrainRecordSummary[];
  offers: CompanyBrainOfferSummary[];
  evidenceScore: CompanyBrainEvidenceScore;
  problemResolution: CompanyBrainProblemResolution;
  replyDraft: CompanyBrainReplyDraft;
  watchers: CompanyBrainWatcher[];
  automationRuns: CompanyBrainAutomationRun[];
  integrationReadiness: CompanyBrainIntegrationReadiness[];
  assets: CompanyBrainAsset[];
  retryAssessment: CompanyBrainRetryAssessment;
  trelloFailureDiagnosis: CompanyBrainTrelloFailureDiagnosis;
}): CompanyBrainActionProposal[] {
  const primaryRecord = input.records[0] || null;
  const primaryOffer = input.offers[0] || null;
  const liveOutlook = input.integrationReadiness.find((entry) => entry.key === "live_outlook");
  const companyBrainFixRuns = input.automationRuns
    .filter((run) => run.workflowName === "company_brain_fix_center")
    .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());
  const workflowAutomationRuns = input.automationRuns.filter((run) => run.workflowName !== "company_brain_fix_center");
  const failedAutomation = input.trelloFailureDiagnosis.rootCauseKey === "sent"
    ? null
    : workflowAutomationRuns.find((run) => isAutomationFailure(run)) || null;
  const openWatcherTitles = input.watchers.filter((watcher) => watcher.status === "open").map((watcher) => watcher.title);
  const retry = input.retryAssessment;
  const trelloCardId = input.trelloFailureDiagnosis.card?.id || primaryRecord?.trelloCardId || primaryOffer?.trelloCardId || null;
  const latestFixRun = (actionKey: CompanyBrainActionProposal["key"]) =>
    companyBrainFixRuns.find((run) => run.action === actionKey) || null;
  const emailCorrectionPrepared = latestFixRun("prepare_email_correction");
  const customerEmailCorrected = latestFixRun("correct_customer_email");
  const offerRetryPrepared = latestFixRun("prepare_offer_retry");
  const trelloStatusPosted = latestFixRun("post_trello_status_comment");
  const problemCaseOpened = latestFixRun("open_problem_case");
  const internalTaskCreated = latestFixRun("create_internal_task");
  const guardedRetrySent = companyBrainFixRuns.find((run) =>
    run.action === "guarded_offer_resend" && /sent|duplicate|success/i.test(String(run.status || "")),
  ) || null;
  const fixRunSuffix = (run: CompanyBrainAutomationRun | null) =>
    run?.createdAt ? ` Zuletzt: ${run.createdAt}.` : run ? " Bereits protokolliert." : "";

  const actions: CompanyBrainActionProposal[] = [
    {
      key: "open_problem_case",
      label: "Problemfall anlegen",
      type: "prepared_task",
      riskLevel: input.problemResolution.severity === "critical" ? "high" : input.problemResolution.severity === "warning" ? "medium" : "low",
      approvalRequired: true,
      enabled: Boolean(primaryRecord && !problemCaseOpened),
      summary: problemCaseOpened
        ? `Problemfall/Aufgabe wurde für diesen Fall bereits vorbereitet.${fixRunSuffix(problemCaseOpened)}`
        : "Legt nach Bestätigung einen Problemfall-Audit und eine interne Aufgabe an. Kein Kundenkontakt.",
      confirmationText: "Problemfall nur anlegen, wenn die Fallprüfung fachlich plausibel ist.",
      href: primaryRecord ? `/ops/customer-records?query=${encodeURIComponent(primaryRecord.requestId)}` : null,
      payloadPreview: [
        `Typ: ${input.problemResolution.label}`,
        `Request: ${primaryRecord?.requestId || "unbekannt"}`,
        `Aufgabe: ${input.problemResolution.internalTaskTitle}`,
        `Beweis-Score: ${input.evidenceScore.score}/100`,
      ],
    },
    {
      key: "save_case_note",
      label: "Fallnotiz speichern",
      type: "prepared_task",
      riskLevel: "low",
      approvalRequired: true,
      enabled: Boolean(primaryRecord),
      summary: "Speichert die Fallanalyse als interne Notiz in der Kundenakte. Kein Kundenkontakt.",
      confirmationText: "Nur interne, belegbasierte Analyse speichern.",
      href: primaryRecord ? `/ops/customer-records?query=${encodeURIComponent(primaryRecord.requestId)}` : null,
      payloadPreview: [
        `Problemfall: ${input.problemResolution.label}`,
        `Empfehlung: ${input.problemResolution.recommendedResolution}`,
        ...input.problemResolution.missingEvidence.slice(0, 3).map((entry) => `Fehlt: ${entry}`),
      ],
    },
    {
      key: "copy_reply_draft",
      label: "Antwortentwurf kopieren",
      type: "copy",
      riskLevel: input.replyDraft.riskLevel,
      approvalRequired: true,
      enabled: true,
      summary: "Kopiert den internen Entwurf. Versand bleibt manuell und freigabepflichtig.",
      confirmationText: "Entwurf nur nach fachlicher Freigabe an Kunden senden.",
      href: null,
      payloadPreview: [`Betreff: ${input.replyDraft.subject}`, ...input.replyDraft.body.split("\n").slice(0, 6)],
    },
    {
      key: "create_internal_task",
      label: "Interne Aufgabe vorbereiten",
      type: "prepared_task",
      riskLevel: openWatcherTitles.length ? "medium" : "low",
      approvalRequired: true,
      enabled: Boolean(primaryRecord && !internalTaskCreated),
      summary: internalTaskCreated
        ? `Interne Aufgabe wurde bereits vorbereitet.${fixRunSuffix(internalTaskCreated)}`
        : "Legt nach Freigabe eine interne Aufgabe aus offenen Watchern und Fallbelegen an. Kein Kundenkontakt.",
      confirmationText: "Vor dem Anlegen Assignee, Priorität und Fälligkeit prüfen.",
      href: primaryRecord ? `/ops/tasks?requestId=${encodeURIComponent(primaryRecord.requestId)}` : "/ops/tasks",
      payloadPreview: [
        `Request: ${primaryRecord?.requestId || "unbekannt"}`,
        `Titel: Company-Brain-Prüfung ${primaryOffer?.offerNumber || primaryRecord?.requestId || ""}`.trim(),
        ...openWatcherTitles.map((title) => `Offen: ${title}`),
      ],
    },
    {
      key: "verify_live_outlook",
      label: "Live-Outlook prüfen",
      type: "manual_check",
      riskLevel: "low",
      approvalRequired: false,
      enabled: liveOutlook?.status === "configured",
      summary: liveOutlook?.status === "configured"
        ? "Runtime wirkt vorbereitet; Live-Suche kann als nächster Backend-Schritt aktiviert werden."
        : "Graph-Konfiguration fehlt oder ist unvollständig; aktuell nur Outlook-Spiegel nutzen.",
      confirmationText: "Nur lesen, keine Mail senden.",
      href: null,
      payloadPreview: [
        `Status: ${liveOutlook?.status || "unknown"}`,
        primaryRecord?.email ? `Kunde: ${primaryRecord.email}` : "Kunde: unbekannt",
        primaryOffer?.offerNumber ? `Angebot: ${primaryOffer.offerNumber}` : "Angebot: unbekannt",
      ],
    },
    {
      key: "open_offer_admin",
      label: "Angebot prüfen",
      type: "open_link",
      riskLevel: "low",
      approvalRequired: false,
      enabled: Boolean(primaryOffer?.publicUrl),
      summary: "Öffnet den vorhandenen Angebotslink zur manuellen Sichtprüfung.",
      confirmationText: "Nur prüfen; Änderungen im Angebotsadmin separat bestätigen.",
      href: primaryOffer?.publicUrl || null,
      payloadPreview: [
        `Angebot: ${primaryOffer?.offerNumber || primaryOffer?.documentReference || "unbekannt"}`,
        `Assets: ${input.assets.length}`,
      ],
    },
    {
      key: "prepare_email_correction",
      label: "E-Mail-Korrektur vorbereiten",
      type: "prepared_task",
      riskLevel: retry.status === "needs_fix" ? "high" : "medium",
      approvalRequired: true,
      enabled: Boolean(primaryRecord && retry.status === "needs_fix" && !emailCorrectionPrepared && !customerEmailCorrected),
      summary: customerEmailCorrected
        ? `Kunden-E-Mail wurde bereits korrigiert.${fixRunSuffix(customerEmailCorrected)} Fall neu laden, bevor ein Retry bewertet wird.`
        : emailCorrectionPrepared
          ? `E-Mail-Korrektur wurde bereits vorbereitet.${fixRunSuffix(emailCorrectionPrepared)}`
          : "Legt eine interne Aufgabe an, um Empfängeradresse/Postfach sauber zu prüfen. Kein Kundenkontakt.",
      confirmationText: "Nur interne Korrekturaufgabe anlegen; keine Mail senden.",
      href: primaryRecord ? `/ops/customer-records?query=${encodeURIComponent(primaryRecord.requestId)}` : null,
      payloadPreview: [
        `Empfänger: ${retry.recipientEmail || "unbekannt"}`,
        `Angebot: ${retry.offerNumber || retry.offerId || "unbekannt"}`,
        ...retry.blockers.slice(0, 4).map((entry) => `Blocker: ${entry}`),
        ...retry.safeFixes.slice(0, 4).map((entry) => `Fix: ${entry}`),
      ],
    },
    {
      key: "correct_customer_email",
      label: "Kunden-E-Mail korrigieren",
      type: "prepared_task",
      riskLevel: "high",
      approvalRequired: true,
      enabled: Boolean(primaryRecord && retry.status === "needs_fix" && !customerEmailCorrected),
      summary: customerEmailCorrected
        ? `Kunden-E-Mail wurde bereits korrigiert.${fixRunSuffix(customerEmailCorrected)} Fall neu laden und Versandbelege prüfen.`
        : "Ändert nach Eingabe und Freigabe die E-Mail in der Kundenakte und synchronisiert abhängige Ops-Tabellen. Kein Angebotsversand.",
      confirmationText: "Nur ausführen, wenn die neue E-Mail-Adresse fachlich belegt ist. Danach erneut prüfen.",
      href: primaryRecord ? `/ops/customer-records?query=${encodeURIComponent(primaryRecord.requestId)}` : null,
      payloadPreview: [
        `Aktuell: ${retry.recipientEmail || primaryRecord?.email || "unbekannt"}`,
        `Angebot: ${retry.offerNumber || retry.offerId || "unbekannt"}`,
        "Neue E-Mail wird beim Ausführen abgefragt.",
        ...retry.safeFixes.slice(0, 3).map((entry) => `Guardrail: ${entry}`),
      ],
    },
    {
      key: "prepare_offer_retry",
      label: "Retry-Aufgabe vorbereiten",
      type: "prepared_task",
      riskLevel: "medium",
      approvalRequired: true,
      enabled: Boolean(primaryRecord && primaryOffer && retry.status !== "not_applicable" && !offerRetryPrepared && !guardedRetrySent),
      summary: guardedRetrySent
        ? `Guarded Retry wurde bereits protokolliert.${fixRunSuffix(guardedRetrySent)} Keinen zweiten Retry vorbereiten.`
        : offerRetryPrepared
          ? `Retry-Aufgabe wurde bereits vorbereitet.${fixRunSuffix(offerRetryPrepared)}`
          : "Erstellt eine interne Retry-Aufgabe mit Belegen, Blockern und Guardrails. Es wird noch nichts gesendet.",
      confirmationText: "Retry nur vorbereiten; Versand bleibt separat freigabepflichtig.",
      href: primaryRecord ? `/ops/tasks?requestId=${encodeURIComponent(primaryRecord.requestId)}` : "/ops/tasks",
      payloadPreview: [
        retry.label,
        retry.summary,
        `Empfänger: ${retry.recipientEmail || "unbekannt"}`,
        `Idempotency: ${retry.idempotencyKey || "noch nicht möglich"}`,
        ...retry.blockers.slice(0, 3).map((entry) => `Blocker: ${entry}`),
      ],
    },
    {
      key: "post_trello_status_comment",
      label: "Trello-Status kommentieren",
      type: "prepared_task",
      riskLevel: "low",
      approvalRequired: true,
      enabled: Boolean(primaryRecord && trelloCardId && !trelloStatusPosted),
      summary: trelloStatusPosted
        ? `Trello-Status wurde bereits kommentiert.${fixRunSuffix(trelloStatusPosted)}`
        : !primaryRecord
          ? "Trello-Karte ist lesbar, aber ohne verknüpfte Kundenakte wird kein Statuskommentar geschrieben. Erst Request/Kundenakte als Source of Truth verknüpfen."
        : "Schreibt eine kurze interne Diagnose auf die Trello-Karte. Trello bleibt Projektion, kein Versand und keine Datenkorrektur.",
      confirmationText: "Nur Statuskommentar schreiben; keine Karte als Source of Truth verwenden.",
      href: input.trelloFailureDiagnosis.card?.url || primaryRecord?.trelloCardUrl || null,
      payloadPreview: [
        `Karte: ${trelloCardId || "unbekannt"}`,
        `Status: ${retry.label}`,
        `Ursache: ${input.trelloFailureDiagnosis.rootCause || input.problemResolution.rootCause}`,
        `Nächster Schritt: ${retry.safeFixes[0] || input.trelloFailureDiagnosis.recommendedFix}`,
      ],
    },
    {
      key: "guarded_offer_resend",
      label: "Angebot erneut senden",
      type: "prepared_task",
      riskLevel: "high",
      approvalRequired: true,
      enabled: retry.canSendWithConfirmation && !guardedRetrySent,
      summary: guardedRetrySent
        ? `Guarded Retry wurde bereits protokolliert.${fixRunSuffix(guardedRetrySent)} Kein erneuter Versand auslösen.`
        : retry.canSendWithConfirmation
        ? "Sendet erst nach serverseitigem Duplicate-, Bounce- und Empfängercheck. Kundenkontakt nur nach Freigabe."
        : retry.summary,
      confirmationText: "Kundenkontakt: nur ausführen, wenn Empfänger, Duplicate-Check und Bounce-Check sauber sind.",
      href: primaryOffer?.publicUrl || null,
      payloadPreview: [
        `Empfänger: ${retry.recipientEmail || "unbekannt"}`,
        `Angebot: ${retry.offerNumber || retry.offerId || "unbekannt"}`,
        `Idempotency: ${retry.idempotencyKey || "nicht verfügbar"}`,
        ...retry.blockers.slice(0, 4).map((entry) => `Blocker: ${entry}`),
        ...retry.safeFixes.slice(0, 3).map((entry) => `Guardrail: ${entry}`),
      ],
    },
    {
      key: "inspect_n8n_run",
      label: "n8n-Run untersuchen",
      type: "manual_check",
      riskLevel: failedAutomation ? "medium" : "low",
      approvalRequired: false,
      enabled: Boolean(failedAutomation),
      summary: failedAutomation ? "Ein fehlerhafter Automation-Beleg ist vorhanden." : "Kein fehlerhafter Automation-Run im Fall.",
      confirmationText: "Keinen Workflow ohne Backup, Diff und Rollback ändern.",
      href: failedAutomation?.executionUrl || null,
      payloadPreview: failedAutomation
        ? [
            `Workflow: ${failedAutomation.workflowName || "unbekannt"}`,
            `Action: ${failedAutomation.action || "unbekannt"}`,
            `Execution: ${failedAutomation.executionId || "unbekannt"}`,
            failedAutomation.executionUrl ? `Execution-Link: ${failedAutomation.executionUrl}` : null,
            failedAutomation.failedNode ? `Node: ${failedAutomation.failedNode}` : null,
            failedAutomation.idempotencyKey ? `Idempotency: ${failedAutomation.idempotencyKey}` : null,
            failedAutomation.retrySafety ? `Retry-Sicherheit: ${failedAutomation.retrySafety}` : null,
          ]
            .filter(Boolean) as string[]
        : ["Kein Fehler-Run gefunden."],
    },
    {
      key: "collect_design_assets",
      label: "Design-Assets sammeln",
      type: "manual_check",
      riskLevel: input.assets.length ? "low" : "medium",
      approvalRequired: false,
      enabled: true,
      summary: input.assets.length ? `${input.assets.length} Asset(s) im Inventar.` : "Keine Assets im Inventar; Trello/Angebot/Outlook-Anhänge prüfen.",
      confirmationText: "Keine Kundenaussage über Designs treffen, solange relevante Anhänge fehlen.",
      href: primaryRecord ? `/ops/customer-records?query=${encodeURIComponent(primaryRecord.requestId)}` : null,
      payloadPreview: input.assets.length
        ? input.assets.slice(0, 5).map((asset) => `${asset.kind}: ${asset.label}`)
        : ["Trello-Referenzbild, Mockups, Angebotsbilder und Outlook-Anhänge prüfen."],
    },
  ];

  return actions;
}

function questionMentions(question: string | null, ...needles: string[]) {
  const normalized = (question || "").toLowerCase();
  return needles.some((needle) => normalized.includes(needle));
}

function buildChecks(
  records: CompanyBrainRecordSummary[],
  offers: CompanyBrainOfferSummary[],
  evidence: CompanyBrainEvidence[],
  conflicts: CompanyBrainFinding[],
  question: string | null,
): CompanyBrainCheck[] {
  const latestRecord = records[0] || null;
  const latestOffer = offers[0] || null;
  const outboundEvidence = evidence.find((entry) => entry.direction === "outbound" && /angebot|mail|e-mail|follow-up|dokument/i.test(entry.title));
  const deliveryFailureEvidence = evidence.find(isOfferDeliveryFailureEvidence);
  const inboundEvidence = evidence.find((entry) => entry.direction === "inbound");
  const offerEvidence = evidence.find((entry) => entry.source.startsWith("offers_api"));
  const designEvidence = evidence.filter((entry) => /design|bild|position|mockup|entwurf/i.test(`${entry.title} ${entry.detail || ""}`));
  const colorConflict = conflicts.find((entry) => entry.source === "color_match") || null;
  const requestColors = uniqueStrings(records.flatMap((record) => record.requestedColors));
  const offerColors = uniqueStrings(offers.flatMap((offer) => offer.colorHints));
  const checks: CompanyBrainCheck[] = [];

  checks.push({
    key: "offer_sent",
    label: "Angebot versendet",
    status: deliveryFailureEvidence ? "missing" : latestRecord?.latestOfferSentAt || outboundEvidence ? "verified" : latestOffer ? "warning" : "unknown",
    summary:
      deliveryFailureEvidence
        ? `Outlook-Bounce gefunden: ${deliveryFailureEvidence.title}${deliveryFailureEvidence.detail ? ` · ${deliveryFailureEvidence.detail}` : ""}`
        : latestRecord?.latestOfferSentAt
        ? `Master-Quote meldet Versand am ${latestRecord.latestOfferSentAt}.`
        : outboundEvidence?.occurredAt
          ? `Timeline enthält ausgehenden Beleg am ${outboundEvidence.occurredAt}.`
          : latestOffer
            ? "Angebot existiert, aber kein eindeutiger Versandbeleg in der Timeline."
            : "Kein Angebot gefunden.",
    evidenceIds: [deliveryFailureEvidence?.id, outboundEvidence?.id, offerEvidence?.id].filter(Boolean) as string[],
  });

  checks.push({
    key: "color",
    label: "Farbe belegt",
    status:
      colorConflict
        ? "warning"
        : requestColors.length && offerColors.length
          ? "verified"
          : questionMentions(question, "farbe", "blau", "rot", "grün", "gruen", "weiss", "weiß", "pink")
            ? "missing"
            : "unknown",
    summary:
      colorConflict?.detail ||
      (requestColors.length || offerColors.length
        ? `Request: ${requestColors.join(", ") || "keine Farbe"} · Angebot: ${offerColors.join(", ") || "keine Farbe"}`
        : "Keine belastbare Farbangabe in den angebundenen Quellen."),
    evidenceIds: evidence.filter((entry) => /farbe|color|angebot|position/i.test(`${entry.title} ${entry.detail || ""}`)).slice(0, 4).map((entry) => entry.id),
  });

  checks.push({
    key: "design",
    label: "Designs/Bilder",
    status: latestOffer?.designEvidenceCount ? "verified" : questionMentions(question, "design", "entwurf", "mockup", "motiv") ? "missing" : "unknown",
    summary: latestOffer
      ? `${latestOffer.designEvidenceCount} Design-/Bildhinweise im Angebot, ${latestOffer.imageCount} aktive Bilder.`
      : "Kein Angebotssnapshot für Designprüfung geladen.",
    evidenceIds: designEvidence.slice(0, 6).map((entry) => entry.id),
  });

  checks.push({
    key: "product_type",
    label: "Produktart",
    status:
      questionMentions(question, "3d", "3-d")
        ? latestOffer?.productHints.includes("3D")
          ? "verified"
          : latestOffer
            ? "warning"
            : "unknown"
        : latestOffer?.productHints.length
          ? "verified"
          : "unknown",
    summary: latestOffer?.productHints.length ? `Produkt-Hinweise: ${latestOffer.productHints.join(", ")}.` : "Keine Produktart sicher erkannt.",
    evidenceIds: [offerEvidence?.id].filter(Boolean) as string[],
  });

  checks.push({
    key: "customer_reply",
    label: "Kundenantwort",
    status: inboundEvidence ? "verified" : "unknown",
    summary: inboundEvidence?.occurredAt ? `Letzter Eingang am ${inboundEvidence.occurredAt}: ${inboundEvidence.title}.` : "Kein Eingang in den geladenen Timeline-Belegen.",
    evidenceIds: [inboundEvidence?.id].filter(Boolean) as string[],
  });

  checks.push({
    key: "order",
    label: "Bestellung",
    status: latestRecord?.latestOrderNumber ? "verified" : questionMentions(question, "bestellung", "shopify", "bezahlt", "gekauft") ? "missing" : "unknown",
    summary: latestRecord?.latestOrderNumber
      ? `Bestellung ${latestRecord.latestOrderNumber}${latestRecord.latestOrderStatus ? ` · ${latestRecord.latestOrderStatus}` : ""}.`
      : "Keine verknüpfte Bestellung im geladenen Fall.",
    evidenceIds: evidence.filter((entry) => /bestellung|order|shopify/i.test(`${entry.title} ${entry.detail || ""}`)).slice(0, 3).map((entry) => entry.id),
  });

  return checks;
}

export function buildCompanyBrainAnswer(
  records: CompanyBrainRecordSummary[],
  offers: CompanyBrainOfferSummary[],
  evidence: CompanyBrainEvidence[],
  gaps: CompanyBrainFinding[],
  conflicts: CompanyBrainFinding[],
  question: string | null,
  trelloFailureDiagnosis?: CompanyBrainTrelloFailureDiagnosis,
) {
  const bullets: string[] = [];
  const latestRecord = records[0] || null;
  const latestOffer = offers[0] || null;
  const lowerQuestion = (question || "").toLowerCase();
  const liveTrelloCard = trelloFailureDiagnosis?.card || null;

  if (liveTrelloCard) {
    if (trelloFailureDiagnosis?.rootCauseKey === "automation_failed") {
      bullets.push(`Automation-Fehler erkannt: ${trelloFailureDiagnosis.rootCause}`);
      bullets.push(`Sicherer nächster Schritt: ${trelloFailureDiagnosis.recommendedFix}`);
    }
    bullets.push(`Trello-Karte gelesen: ${liveTrelloCard.name || liveTrelloCard.id}${liveTrelloCard.currentListName ? ` · Liste: ${liveTrelloCard.currentListName}` : ""}.`);
    if (trelloFailureDiagnosis?.triggerMove) {
      bullets.push(`Letzter Karten-Move: ${trelloFailureDiagnosis.triggerMove.fromListName || "unbekannt"} -> ${trelloFailureDiagnosis.triggerMove.toListName || "unbekannt"}${trelloFailureDiagnosis.triggerMove.occurredAt ? ` am ${trelloFailureDiagnosis.triggerMove.occurredAt}` : ""}.`);
    }
    if (liveTrelloCard.descriptionPreview) bullets.push(`Trello-Beschreibung: ${liveTrelloCard.descriptionPreview}`);
    if (liveTrelloCard.customFields.length) {
      bullets.push(`Kartenfelder: ${liveTrelloCard.customFields.slice(0, 4).map((field) => `${field.name}: ${field.value}`).join(" · ")}.`);
    }
    if (!records.length) bullets.push("Keine verknüpfte Kundenakte als Source of Truth gefunden.");
    if (!offers.length && trelloFailureDiagnosis?.expectedAction === "offer_send") bullets.push("Kein Angebotssnapshot zur Trello-Karte gefunden.");
    if (trelloFailureDiagnosis?.rootCause) bullets.push(`Trello-Diagnose: ${trelloFailureDiagnosis.rootCause}`);
  }

  if (latestRecord) {
    bullets.push(`Kundenakte: ${latestRecord.displayName || latestRecord.company || latestRecord.email || latestRecord.requestId} (${latestRecord.requestId}).`);
    if (latestRecord.requestedColors.length) bullets.push(`Bestell-/Anfragefarbe laut Request: ${latestRecord.requestedColors.join(", ")}.`);
    if (latestRecord.latestOfferSentAt) bullets.push(`Letzter Angebotsversand laut Master-Quote: ${latestRecord.latestOfferSentAt}.`);
    if (latestRecord.latestOutboundAt) bullets.push(`Letzte ausgehende Kommunikation in der Timeline: ${latestRecord.latestOutboundAt}.`);
  }
  if (latestOffer) {
    bullets.push(`Angebot: ${latestOffer.offerNumber || latestOffer.documentReference}, Status ${latestOffer.status}, ${latestOffer.itemCount} Positionen, ${latestOffer.imageCount} Bilder/Designs.`);
    if (latestOffer.requestId) bullets.push(`Request-ID laut Angebot: ${latestOffer.requestId}.`);
    if (latestOffer.productHints.length) bullets.push(`Produkt-Hinweise im Angebot: ${latestOffer.productHints.join(", ")}.`);
    if (latestOffer.colorHints.length) bullets.push(`Farb-Hinweise im Angebot: ${latestOffer.colorHints.join(", ")}.`);
    if (latestOffer.selectedItems.length) bullets.push(`Ausgewählte Positionen: ${latestOffer.selectedItems.map((item) => item.title).slice(0, 3).join(", ")}.`);
  }
  if (lowerQuestion.includes("3d") || lowerQuestion.includes("design")) {
    if (latestOffer) {
      bullets.push(`Design-Prüfung: ${latestOffer.designEvidenceCount} Design-/Bildhinweise; 3D-Hinweis ${latestOffer.productHints.includes("3D") ? "gefunden" : "nicht gefunden"}.`);
    }
  }
  if (lowerQuestion.includes("mail") || lowerQuestion.includes("email") || lowerQuestion.includes("raus") || lowerQuestion.includes("gesendet")) {
    const outbound = evidence.find((entry) => entry.direction === "outbound" && /angebot|mail|e-mail|follow-up/i.test(entry.title));
    bullets.push(outbound ? `Versandbeleg gefunden: ${outbound.title}${outbound.occurredAt ? ` am ${outbound.occurredAt}` : ""}.` : "Kein eindeutiger Versandbeleg gefunden.");
  }
  if (conflicts.length) bullets.push(`Konflikt: ${conflicts[0].detail}`);
  if (!bullets.length) bullets.push("Keine belastbare Aussage möglich, weil keine verknüpften Daten gefunden wurden.");

  const verdict = records.length || offers.length
    ? (gaps.some((gap) => gap.severity !== "info") ? "partial" : "found")
    : liveTrelloCard
      ? "partial"
      : "not_found";
  const confidence = conflicts.length || gaps.some((gap) => gap.severity === "warning")
    ? "medium"
    : verdict === "found"
      ? "high"
      : liveTrelloCard
        ? "medium"
        : "low";

  return {
    verdict,
    confidence,
    headline:
      verdict === "found"
        ? "Fall gefunden, Belege geladen."
        : trelloFailureDiagnosis?.rootCauseKey === "automation_failed"
          ? "Automation-Fehler erkannt; Retry nur nach Duplicate-Check."
        : liveTrelloCard && !records.length
          ? "Trello-Karte gelesen, aber Source-of-Truth-Verknüpfung fehlt."
          : liveTrelloCard && !offers.length && trelloFailureDiagnosis?.expectedAction === "offer_send"
            ? "Trello-Karte gelesen, aber kein Angebot gefunden."
            : verdict === "partial"
              ? "Fall teilweise gefunden, Quellenlücken beachten."
          : "Kein belastbarer Falltreffer.",
    bullets: bullets.slice(0, 8),
  } satisfies CompanyBrainResolveResult["answer"];
}

function nextActionsFor(
  gaps: CompanyBrainFinding[],
  conflicts: CompanyBrainFinding[],
  trelloFailureDiagnosis?: CompanyBrainTrelloFailureDiagnosis,
) {
  const actions = [
    conflicts.length ? "Konflikt mit Kunde/Angebot manuell prüfen, bevor eine Antwort rausgeht." : null,
    gaps.some((gap) => gap.source === "customer_records") ? "Mit E-Mail, Angebotsnummer oder Trello-ID erneut suchen." : null,
    gaps.some((gap) => gap.source === "offers") ? "Angebotssoftware-Verbindung prüfen oder direkt im Angebotsadmin öffnen." : null,
    gaps.some((gap) => gap.title.includes("Versandbeleg")) ? "Outlook-/customer_email_messages-Sync prüfen, bevor Versandstatus bestätigt wird." : null,
    trelloFailureDiagnosis?.requested && trelloFailureDiagnosis.rootCauseKey !== "sent"
      ? `Trello-Triggerdiagnose: ${trelloFailureDiagnosis.recommendedFix}`
      : null,
  ].filter(Boolean) as string[];
  return actions.length ? actions : ["Belege im Zeitstrahl prüfen und erst danach Kundenaussage formulieren."];
}

export async function resolveCompanyBrain(input: CompanyBrainResolveInput): Promise<CompanyBrainResolveResult> {
  const query = normalizeCompanyBrainQuery(input.query);
  const question = cleanText(input.question) || null;
  const requestedProblemType = normalizeCompanyBrainProblemType(input.problemType);
  const limit = clampLimit(input.limit);
  if (query.length < 2) throw new QuoteValidationError("Bitte mindestens 2 Zeichen suchen.");

  const diagnostics: CompanyBrainDiagnostic[] = [];
  const identifiers = extractCompanyBrainIdentifiers(query);
  const customerRecords: CustomerSearchResult[] = [];
  let offerSearchResults: OpsOfferSearchResult[] = [];
  const trelloRequested = companyBrainTrelloRequested(query, question, requestedProblemType);
  let trelloLookup = primaryTrelloLookup({ query, identifiers });
  let trelloContext: TrelloFailureContext | null = null;
  let trelloDiagnostic: CompanyBrainDiagnostic | null = null;

  if (trelloLookup) {
    const trelloLive = await fetchTrelloFailureContextForLookup(trelloLookup);
    trelloContext = trelloLive.context;
    trelloDiagnostic = trelloLive.diagnostic;
    diagnostics.push(trelloLive.diagnostic);
    if (trelloContext) {
      trelloLookup = trelloContext.card.id;
      pushIdentifier(identifiers, "trello_card_id", "Trello-ID", trelloContext.card.id, "high", trelloContext.card.url || trelloContext.card.shortUrl);
      if (trelloContext.card.shortLink) {
        pushIdentifier(identifiers, "trello_card_id", "Trello Shortlink", trelloContext.card.shortLink, "medium", trelloContext.card.url || trelloContext.card.shortUrl);
      }
    }
  } else if (trelloRequested) {
    trelloDiagnostic = { source: "trello_live", ok: true, label: "Trello Live", detail: "Kein Trello-Karten-Identifier in der Suche.", count: 0 };
    diagnostics.push(trelloDiagnostic);
  }

  try {
    customerRecords.push(...await searchCustomerRecords(query));
    diagnostics.push({ source: "customer_records", ok: true, label: "Kundenakte", detail: null, count: customerRecords.length });
  } catch (error) {
    diagnostics.push({ source: "customer_records", ok: false, label: "Kundenakte", detail: errorMessage(error), count: 0 });
  }

  for (const identifier of identifiers.filter((entry) => entry.type === "request_id").slice(0, 2)) {
    try {
      customerRecords.push(await getCustomerRecordByRequestId(identifier.value));
    } catch {
      // searchCustomerRecords already records the customer-record diagnostic.
    }
  }

  for (const identifier of identifiers.filter((entry) => entry.type === "trello_card_id").slice(0, 2)) {
    try {
      customerRecords.push(...await searchCustomerRecords(`trello:${identifier.value}`));
    } catch {
      // the main customer-record diagnostic above is enough for the operator.
    }
  }

  if (trelloContext) {
    const trelloRequestId = requestIdFromTrelloContext(trelloContext);
    if (trelloRequestId) {
      pushIdentifier(identifiers, "request_id", "Request-ID", trelloRequestId, "high", `/ops/customer-records?query=${encodeURIComponent(trelloRequestId)}`);
      try {
        customerRecords.push(await getCustomerRecordByRequestId(trelloRequestId, { includeTrello: false }));
      } catch {
        // The Trello card remains useful evidence even when the request projection is missing.
      }
    }
    for (const lookup of uniqueStrings([trelloContext.card.id, trelloContext.card.shortLink])) {
      try {
        customerRecords.push(...await searchCustomerRecords(`trello:${lookup}`));
      } catch {
        // Trello live evidence remains visible even when the projection lookup misses.
      }
    }
  }

  try {
    const offerSearch = await searchOffers(query, limit);
    offerSearchResults = dedupeOfferSearchResults(offerSearch.results).slice(0, limit);
    diagnostics.push({ source: "offers", ok: true, label: "Angebote", detail: null, count: offerSearchResults.length });
  } catch (error) {
    diagnostics.push({ source: "offers", ok: false, label: "Angebote", detail: errorMessage(error as OpsOfferApiError), count: 0 });
  }

  for (const offer of offerSearchResults.slice(0, 3)) {
    try {
      customerRecords.push(...await listCustomerRecordsByOfferBridge(
        { offerId: offer.offerId, offerNumber: offer.offerNumber || undefined, documentReference: offer.documentReference },
        { includeActivity: true, includeOfferTracking: true, includeRelated: true, includeTrello: false },
      ));
    } catch (error) {
      diagnostics.push({ source: "offer_bridge", ok: false, label: "Offer-Bridge", detail: errorMessage(error), count: 0 });
    }
  }

  for (const identifier of identifiers.filter((entry) => entry.type === "offer_number").slice(0, 3)) {
    try {
      const bridgeRecords = await listCustomerRecordsByOfferBridge(
        { offerNumber: identifier.value },
        { includeActivity: true, includeOfferTracking: true, includeRelated: true, includeTrello: false },
      );
      customerRecords.push(...bridgeRecords);
      diagnostics.push({ source: "offer_bridge", ok: true, label: `Offer-Bridge ${identifier.value}`, detail: null, count: bridgeRecords.length });
    } catch (error) {
      diagnostics.push({ source: "offer_bridge", ok: false, label: `Offer-Bridge ${identifier.value}`, detail: errorMessage(error), count: 0 });
    }
  }

  let records = dedupeRecords(customerRecords).slice(0, limit);
  const offerSnapshots: OpsOfferSnapshot[] = [];
  for (const offer of offerSearchResults.slice(0, Math.min(3, limit))) {
    try {
      offerSnapshots.push(await getOfferById(offer.offerId));
    } catch (error) {
      diagnostics.push({ source: "offers", ok: false, label: `Angebot ${offer.offerNumber || offer.offerId}`, detail: errorMessage(error), count: 0 });
    }
  }

  let recordSummaries = records.map(mapRecordSummary);
  if (!trelloContext && !trelloLookup) {
    const fallbackLookup = primaryTrelloLookup({ query, identifiers, records: recordSummaries });
    if (fallbackLookup) {
      const trelloLive = await fetchTrelloFailureContextForLookup(fallbackLookup);
      trelloContext = trelloLive.context;
      trelloDiagnostic = trelloLive.diagnostic;
      diagnostics.push(trelloLive.diagnostic);
      if (trelloContext) {
        pushIdentifier(identifiers, "trello_card_id", "Trello-ID", trelloContext.card.id, "high", trelloContext.card.url || trelloContext.card.shortUrl);
      }
    }
  }
  if (trelloContext && !offerSnapshots.some((offer) => offer.trelloCardId === trelloContext?.card.id)) {
    try {
      offerSnapshots.push(await getOfferByTrelloCardId(trelloContext.card.id));
      diagnostics.push({ source: "offer_bridge", ok: true, label: `Angebot per Trello ${trelloContext.card.id}`, detail: null, count: 1 });
    } catch (error) {
      diagnostics.push({ source: "offer_bridge", ok: false, label: `Angebot per Trello ${trelloContext.card.id}`, detail: errorMessage(error), count: 0 });
    }
  }

  const offerSummaries = dedupeOfferSnapshots(offerSnapshots).map(mapOfferSummary);
  const offerRequestIds = findMissingOfferRequestIds(records, offerSummaries);
  let offerAnchoredRecordCount = 0;
  for (const requestId of offerRequestIds) {
    try {
      customerRecords.push(await getCustomerRecordByRequestId(requestId, { includeTrello: false }));
      offerAnchoredRecordCount += 1;
    } catch {
      // Offer remains useful evidence even when the customer record cannot be hydrated.
    }
  }
  if (offerRequestIds.length) {
    records = dedupeRecords(customerRecords).slice(0, limit);
    recordSummaries = records.map(mapRecordSummary);
    diagnostics.push({
      source: "customer_records",
      ok: true,
      label: "Kundenakte per Offer-Request",
      detail: offerAnchoredRecordCount
        ? `${offerAnchoredRecordCount} Kundenakte(n) über Request-ID aus Angebot nachgeladen.`
        : "Request-ID im Angebot gefunden, aber keine Kundenakte nachgeladen.",
      count: offerAnchoredRecordCount,
    });
  }
  addRecordIdentifiers(identifiers, records);
  addOfferIdentifiers(identifiers, offerSummaries);

  const quoteEmailEvidence = await fetchQuoteEmailEvidence(
    recordSummaries,
    offerSummaries,
    trelloContext ? [trelloContext.card.id, trelloContext.card.shortLink].filter(Boolean) as string[] : [],
  );
  const liveOutlook = await fetchOutlookGraphEvidence({
    query,
    identifiers,
    records: recordSummaries,
    offers: offerSummaries,
  });
  if (liveOutlook.diagnostic) diagnostics.push(liveOutlook.diagnostic);

  const evidence = [
    ...records.flatMap(mapTimelineEvidence),
    ...offerSummaries.flatMap(mapOfferEvidence),
    ...mapTrelloEvidence(trelloContext),
    ...quoteEmailEvidence,
    ...liveOutlook.evidence,
  ]
    .sort((left, right) => new Date(right.occurredAt || 0).getTime() - new Date(left.occurredAt || 0).getTime())
    .slice(0, 30);
  const assets = buildAssetInventory(records, offerSummaries, evidence);
  const integrationReadiness = buildIntegrationReadiness();
  diagnostics.push({
    source: "integration_readiness",
    ok: true,
    label: "Integrations-Readiness",
    detail: integrationReadiness.map((entry) => `${entry.label}: ${entry.status}`).join(" · "),
    count: integrationReadiness.filter((entry) => entry.status === "configured").length,
  });
  const coolifyLive = await fetchCoolifyLiveDiagnostic();
  if (coolifyLive) diagnostics.push(coolifyLive);
  const crossChecks = buildCompanyBrainCrossChecks({ records: recordSummaries, offers: offerSummaries, evidence, question });
  const conflicts = buildConflicts(crossChecks);
  const gaps = buildGaps(recordSummaries, offerSummaries, diagnostics);
  const checks = buildChecks(recordSummaries, offerSummaries, evidence, conflicts, question);
  const trelloAutomationRuns = buildTrelloAutomationRuns(trelloContext);
  const automation = await fetchAutomationRuns(
    recordSummaries,
    offerSummaries,
    trelloContext ? [trelloContext.card.id, trelloContext.card.shortLink || ""] : [],
    extractTrelloAutomationExecutionIds(trelloContext),
  );
  const n8nLive = await fetchN8nLiveRuns(
    uniqueStrings([
      ...extractTrelloAutomationExecutionIds(trelloContext),
      ...automation.runs.map((run) => run.executionId),
      ...trelloAutomationRuns.map((run) => run.executionId),
    ].filter((value): value is string => Boolean(value))),
    [...automation.runs, ...trelloAutomationRuns],
  );
  const automationRuns = dedupeAutomationRuns([...n8nLive.runs, ...automation.runs, ...trelloAutomationRuns]);
  diagnostics.push(
    trelloAutomationRuns.length && !automation.runs.length
      ? {
          ...automation.diagnostic,
          ok: true,
          detail: "Kein passender workflow_audit_log-Eintrag; Automation-Fehler wurde aus der Trello-Historie rekonstruiert.",
          count: automationRuns.length,
        }
      : { ...automation.diagnostic, count: automationRuns.length },
  );
  if (n8nLive.diagnostic) diagnostics.push(n8nLive.diagnostic);
  const trelloFailureDiagnosis = buildTrelloFailureDiagnosis({
    requested: trelloRequested || Boolean(trelloContext),
    context: trelloContext,
    diagnostic: trelloDiagnostic,
    records: recordSummaries,
    offers: offerSummaries,
    crossChecks,
    automationRuns,
    question,
    problemType: requestedProblemType,
  });
  const answer = buildCompanyBrainAnswer(recordSummaries, offerSummaries, evidence, gaps, conflicts, question, trelloFailureDiagnosis);
  const caseEvents = buildCaseEvents(evidence, automationRuns);
  const sourceHealth = buildSourceHealth(recordSummaries, offerSummaries, evidence, diagnostics, automationRuns, trelloFailureDiagnosis);
  const generatedAt = new Date().toISOString();
  const replyDraft = buildReplyDraft({
    answer,
    records: recordSummaries,
    offers: offerSummaries,
    crossChecks,
    conflicts,
    gaps,
    evidence,
  });
  const watchers = buildWatchers({
    records,
    recordSummaries,
    offers: offerSummaries,
    evidence,
    crossChecks,
    automationRuns,
    integrationReadiness,
    assets,
    trelloFailureDiagnosis,
  });
  const inferredProblemType = inferProblemType({
    requested: requestedProblemType,
    question,
    crossChecks,
    watchers,
  });
  const evidenceScore = buildEvidenceScore({
    records: recordSummaries,
    offers: offerSummaries,
    evidence,
    assets,
    crossChecks,
    sourceHealth,
  });
  const problemResolution = buildProblemResolution({
    problemType: inferredProblemType,
    records: recordSummaries,
    offers: offerSummaries,
    crossChecks,
    watchers,
    evidenceScore,
    assets,
  });
  const retryAssessment = buildCompanyBrainRetryAssessment({
    records: recordSummaries,
    offers: offerSummaries,
    evidence,
    crossChecks,
    trelloFailureDiagnosis,
  });
  const actionProposals = buildActionProposals({
    records: recordSummaries,
    offers: offerSummaries,
    evidenceScore,
    problemResolution,
    replyDraft,
    watchers,
    automationRuns,
    integrationReadiness,
    assets,
    retryAssessment,
    trelloFailureDiagnosis,
  });
  const dossier = buildDossier({
    generatedAt,
    answer,
    records: recordSummaries,
    offers: offerSummaries,
    caseEvents,
    assets,
    crossChecks,
    integrationReadiness,
    watchers,
    actionProposals,
    evidenceScore,
    problemResolution,
    checks,
    sourceHealth,
    automationRuns,
    trelloFailureDiagnosis,
    retryAssessment,
    replyDraft,
    conflicts,
    gaps,
    evidence,
  });

  return {
    query,
    question,
    problemType: inferredProblemType,
    generatedAt,
    mode: "deterministic_read_only",
    identifiers,
    answer,
    records: recordSummaries,
    offers: offerSummaries,
    caseEvents,
    assets,
    crossChecks,
    integrationReadiness,
    watchers,
    actionProposals,
    retryAssessment,
    evidenceScore,
    problemResolution,
    checks,
    sourceHealth,
    automationRuns,
    trelloFailureDiagnosis,
    dossier,
    replyDraft,
    evidence,
    conflicts,
    gaps,
    diagnostics,
    nextActions: nextActionsFor(gaps, conflicts, trelloFailureDiagnosis),
  };
}
