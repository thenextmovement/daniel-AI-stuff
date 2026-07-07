import { createHash } from "node:crypto";
import { classifyAutomationIssueText, isBlockingAutomationIssueKey, type AutomationIssueKey } from "@/lib/ops/automation-issues";
import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export type WorkflowAuditRetrySafety = "safe" | "safe_after_review" | "blocked" | "unsafe" | "unknown";

export type WorkflowAuditEventInput = {
  workflowName?: string | null;
  workflow_name?: string | null;
  action?: string | null;
  status?: string | null;
  requestId?: string | null;
  request_id?: string | null;
  documentId?: string | null;
  document_id?: string | null;
  trelloCardId?: string | null;
  trello_card_id?: string | null;
  card_id?: string | null;
  card_url?: string | null;
  offerId?: string | null;
  offer_id?: string | null;
  offerNumber?: string | null;
  offer_number?: string | null;
  executionId?: string | number | null;
  execution_id?: string | number | null;
  n8n_execution_id?: string | number | null;
  correlationId?: string | null;
  correlation_id?: string | null;
  sourceEventId?: string | null;
  source_event_id?: string | null;
  action_id?: string | null;
  targetRecordId?: string | null;
  target_record_id?: string | null;
  idempotencyKey?: string | null;
  idempotency_key?: string | null;
  failedNode?: string | null;
  failed_node?: string | null;
  errorMessage?: string | null;
  error_message?: string | null;
  reason?: string | null;
  error_code?: string | null;
  summary?: string | null;
  retrySafety?: WorkflowAuditRetrySafety | null;
  retry_safety?: WorkflowAuditRetrySafety | null;
  customer_communication_sent?: boolean | null;
  metadata?: Record<string, unknown> | null;
};

export type WorkflowAuditEvent = {
  documentId: string;
  workflowName: string;
  action: string;
  status: string;
  errorMessage: string | null;
  auditEventKey: string;
  metadata: Record<string, unknown>;
};

export type WorkflowAuditRecordResult = {
  inserted: boolean;
  duplicate: boolean;
  auditEventKey: string;
  rowId: string | null;
};

type WorkflowAuditLogRow = {
  id?: string | null;
};

const MAX_TEXT = 500;
const MAX_LONG_TEXT = 4000;
const STATUS_PATTERN = /^[a-z0-9_:-]{2,80}$/i;
const RETRY_SAFETY_VALUES = new Set<WorkflowAuditRetrySafety>(["safe", "safe_after_review", "blocked", "unsafe", "unknown"]);

function cleanText(value: unknown, maxLength = MAX_TEXT) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function nullableText(value: unknown, maxLength = MAX_TEXT) {
  const normalized = cleanText(value, maxLength);
  return normalized || null;
}

function normalizeStatus(value: unknown) {
  const status = cleanText(value, 80).toLowerCase();
  if (!status || !STATUS_PATTERN.test(status)) {
    throw new QuoteValidationError("Workflow-Audit-Status ist ungueltig.", ["status ist erforderlich und darf nur technische Statuszeichen enthalten."], 422);
  }
  return status;
}

function normalizeRetrySafety(value: unknown): WorkflowAuditRetrySafety {
  const normalized = cleanText(value, 80) as WorkflowAuditRetrySafety;
  return RETRY_SAFETY_VALUES.has(normalized) ? normalized : "unknown";
}

function compactMetadata(input: Record<string, unknown> | null | undefined) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input).slice(0, 80)) {
    const normalizedKey = cleanText(key, 120).replace(/[^a-zA-Z0-9_:-]/g, "_");
    if (!normalizedKey) continue;
    if (value === null || typeof value === "boolean" || typeof value === "number") {
      output[normalizedKey] = value;
      continue;
    }
    if (typeof value === "string") {
      output[normalizedKey] = value.length > MAX_LONG_TEXT ? value.slice(0, MAX_LONG_TEXT) : value;
      continue;
    }
    if (Array.isArray(value)) {
      output[normalizedKey] = value.slice(0, 20).map((entry) =>
        typeof entry === "string" ? entry.slice(0, MAX_TEXT) : entry,
      );
      continue;
    }
    if (typeof value === "object") {
      output[normalizedKey] = JSON.stringify(value).slice(0, MAX_LONG_TEXT);
    }
  }
  return output;
}

function issueRetrySafety(key: AutomationIssueKey): WorkflowAuditRetrySafety {
  if (isBlockingAutomationIssueKey(key)) return "blocked";
  return "unknown";
}

function metadataText(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return null;
}

function hashKey(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 40);
}

export function normalizeWorkflowAuditEvent(input: WorkflowAuditEventInput): WorkflowAuditEvent {
  const workflowName = nullableText(input.workflowName || input.workflow_name, 180);
  const action = nullableText(input.action, 180);
  if (!workflowName) throw new QuoteValidationError("Workflow-Name fehlt.", ["workflowName ist erforderlich."], 422);
  if (!action) throw new QuoteValidationError("Workflow-Aktion fehlt.", ["action ist erforderlich."], 422);

  const status = normalizeStatus(input.status);
  const requestId = nullableText(input.requestId || input.request_id, 180);
  const trelloCardId = nullableText(input.trelloCardId || input.trello_card_id || input.card_id, 180);
  const offerId = nullableText(input.offerId || input.offer_id, 180);
  const offerNumber = nullableText(input.offerNumber || input.offer_number, 80);
  const executionId = nullableText(input.executionId || input.execution_id || input.n8n_execution_id, 180);
  const correlationId = nullableText(input.correlationId || input.correlation_id, 240);
  const sourceEventId = nullableText(input.sourceEventId || input.source_event_id || input.action_id, 240);
  const targetRecordId = nullableText(input.targetRecordId || input.target_record_id, 240);
  const idempotencyKey = nullableText(input.idempotencyKey || input.idempotency_key, 300);
  const documentId =
    nullableText(input.documentId || input.document_id, 180) ||
    requestId ||
    offerId ||
    (trelloCardId ? `trello:${trelloCardId}` : null) ||
    (correlationId ? `correlation:${correlationId}` : null) ||
    (executionId ? `execution:${executionId}` : null);

  if (!documentId) {
    throw new QuoteValidationError(
      "Workflow-Audit braucht eine Fallreferenz.",
      ["Mindestens requestId, documentId, trelloCardId, offerId, correlationId oder executionId ist erforderlich."],
      422,
    );
  }

  const failedNode = nullableText(input.failedNode || input.failed_node, 240);
  const errorMessage = nullableText(input.errorMessage || input.error_message || input.reason || input.error_code, MAX_LONG_TEXT);
  const explicitRetrySafety = normalizeRetrySafety(input.retrySafety || input.retry_safety);
  const compactedMetadata = compactMetadata(input.metadata);
  const rawSummary = nullableText(input.summary, 1000);
  const issueHint = classifyAutomationIssueText([
    errorMessage,
    rawSummary,
    metadataText(compactedMetadata, ["automation_issue_key", "issue_key", "error_code", "error_type"]),
    metadataText(compactedMetadata, ["error_message", "error", "message", "raw_error", "last_error_message"]),
  ].filter(Boolean).join(" "));
  const retrySafety = explicitRetrySafety !== "unknown" ? explicitRetrySafety : issueRetrySafety(issueHint.key);
  const summary = rawSummary || (issueHint.key !== "unknown" ? issueHint.rootCause : null);
  const metadata = {
    ...compactedMetadata,
    request_id: requestId,
    trello_card_id: trelloCardId,
    card_id: trelloCardId,
    card_url: nullableText(input.card_url, 500),
    offer_id: offerId,
    offer_number: offerNumber,
    execution_id: executionId,
    n8n_execution_id: executionId,
    correlation_id: correlationId,
    source_event_id: sourceEventId,
    target_record_id: targetRecordId,
    idempotency_key: idempotencyKey,
    failed_node: failedNode,
    retry_safety: retrySafety,
    customer_communication_sent: input.customer_communication_sent === true,
    summary,
    automation_issue_key: issueHint.key !== "unknown" ? issueHint.key : null,
    automation_issue_root_cause: issueHint.key !== "unknown" ? issueHint.rootCause : null,
    automation_issue_recommended_fix: issueHint.key !== "unknown" ? issueHint.recommendedFix : null,
    automation_issue_safe_fix: issueHint.key !== "unknown" ? issueHint.safeFix : null,
    automation_issue_retry_safety: issueHint.key !== "unknown" ? issueHint.retrySafety : null,
    automation_issue_contract_version: 1,
    audit_contract_version: 1,
  };
  const explicitKey = nullableText((input.metadata || {}).audit_event_key, 300);
  const auditEventKey = explicitKey || `workflow-audit:${hashKey([
    workflowName,
    action,
    status,
    idempotencyKey || correlationId || executionId || sourceEventId || documentId,
    failedNode || "",
  ].join("|"))}`;

  return {
    documentId,
    workflowName,
    action,
    status,
    errorMessage,
    auditEventKey,
    metadata: {
      ...metadata,
      audit_event_key: auditEventKey,
    },
  };
}

export async function recordWorkflowAuditEvent(input: WorkflowAuditEventInput): Promise<WorkflowAuditRecordResult> {
  const event = normalizeWorkflowAuditEvent(input);
  const existing = await supabaseRequest<WorkflowAuditLogRow[]>("workflow_audit_log", undefined, {
    select: "id",
    "metadata->>audit_event_key": `eq.${event.auditEventKey}`,
    limit: 1,
  });
  if (existing[0]?.id) {
    return { inserted: false, duplicate: true, auditEventKey: event.auditEventKey, rowId: existing[0].id };
  }

  const rows = await supabaseRequest<WorkflowAuditLogRow[]>("workflow_audit_log", {
    method: "POST",
    body: JSON.stringify({
      document_id: event.documentId,
      workflow_name: event.workflowName,
      action: event.action,
      status: event.status,
      error_message: event.errorMessage,
      metadata: event.metadata,
    }),
    headers: { Prefer: "return=representation" },
  });

  return { inserted: true, duplicate: false, auditEventKey: event.auditEventKey, rowId: rows[0]?.id || null };
}
