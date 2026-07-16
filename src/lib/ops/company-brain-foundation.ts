import { supabaseRequest, supabaseRpc } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export type CompanyDecisionStatus = "draft" | "review" | "approved" | "superseded" | "reversed" | "expired";
export type CompanyDecisionType = "decision" | "policy" | "architecture" | "incident_resolution" | "experiment";
export type CompanyDecisionScopeType = "global" | "team" | "process" | "entity" | "workflow" | "metric";
export type CompanyDecisionReviewAction = "submit" | "approve" | "request_changes";

export type CompanySourceRegistryEntry = {
  sourceKey: string;
  displayName: string;
  sourceKind: string;
  authority: string;
  ownerTeam: string;
  criticality: string;
  expectedFreshness: string | null;
  containsPersonalData: boolean;
  active: boolean;
  description: string;
  updatedAt: string;
};

export type CompanyCorrelationContract = {
  eventType: string;
  ownerTeam: string;
  requiredIdentifiers: string[];
  requiredPayloadFields: string[];
  schemaVersion: string;
  severityWhenIncomplete: string;
  description: string;
  active: boolean;
};

export type CompanyWorkflowRegistryEntry = {
  id: string;
  sourceKey: string;
  externalWorkflowId: string;
  workflowName: string;
  lifecycleStatus: string;
  active: boolean;
  ownerTeam: string | null;
  nodeCount: number | null;
  triggerCount: number | null;
  warningCount: number | null;
  maxAllowedNodes: number;
  lastReviewedAt: string | null;
  lastSyncedAt: string;
};

export type CompanyDataQualityIssue = {
  id: string;
  issueKey: string;
  issueType: string;
  severity: "info" | "warning" | "critical";
  status: "open" | "acknowledged" | "resolved" | "ignored";
  title: string;
  detail: string;
  sourceKey: string | null;
  lastDetectedAt: string;
};

export type CompanyDecision = {
  id: string;
  decisionKey: string;
  versionNumber: number;
  decisionType: CompanyDecisionType;
  status: CompanyDecisionStatus;
  title: string;
  scopeType: CompanyDecisionScopeType;
  scopeKey: string;
  ownerTeam: string;
  objective: string;
  problemStatement: string;
  context: string;
  constraints: unknown[];
  options: unknown[];
  chosenOption: string | null;
  rationale: string | null;
  assumptions: unknown[];
  expectedOutcomes: unknown[];
  risks: unknown[];
  guardrails: unknown[];
  consequences: unknown[];
  rollbackPlan: string | null;
  supersedesDecisionId: string | null;
  decidedAt: string | null;
  reviewAt: string;
  validFrom: string | null;
  validUntil: string | null;
  createdBy: string;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CompanyDecisionOutcome = {
  id: string;
  decisionId: string;
  outcomeKey: string;
  metricKey: string | null;
  baselineValue: number | null;
  targetValue: number | null;
  actualValue: number | null;
  unit: string | null;
  evaluationStatus: "pending" | "met" | "missed" | "inconclusive" | "cancelled";
  evaluationStart: string | null;
  evaluationEnd: string;
  observedAt: string | null;
  finding: string | null;
  lessonsLearned: string | null;
  evidenceRefs: unknown[];
  recordedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ActiveCompanyDecision = Pick<
  CompanyDecision,
  | "id"
  | "decisionKey"
  | "versionNumber"
  | "decisionType"
  | "title"
  | "scopeType"
  | "scopeKey"
  | "ownerTeam"
  | "objective"
  | "chosenOption"
  | "rationale"
  | "guardrails"
  | "consequences"
  | "rollbackPlan"
  | "decidedAt"
  | "reviewAt"
  | "validFrom"
  | "validUntil"
>;

type SourceRow = {
  source_key: string;
  display_name: string;
  source_kind: string;
  authority: string;
  owner_team: string;
  criticality: string;
  expected_freshness?: string | null;
  contains_personal_data: boolean;
  active: boolean;
  description: string;
  updated_at: string;
};

type ContractRow = {
  event_type: string;
  owner_team: string;
  required_identifiers: string[];
  required_payload_fields: string[];
  schema_version: string;
  severity_when_incomplete: string;
  description: string;
  active: boolean;
};

type WorkflowRow = {
  id: string;
  source_key: string;
  external_workflow_id: string;
  workflow_name: string;
  lifecycle_status: string;
  active: boolean;
  owner_team?: string | null;
  node_count?: number | null;
  trigger_count?: number | null;
  warning_count?: number | null;
  max_allowed_nodes: number;
  last_reviewed_at?: string | null;
  last_synced_at: string;
  business_purpose?: string | null;
  trigger_contract?: string | null;
  output_contract?: string | null;
  runbook_url?: string | null;
  current_version?: string | null;
  metadata?: Record<string, unknown> | null;
};

type QualityIssueRow = {
  id: string;
  issue_key: string;
  issue_type: string;
  severity: CompanyDataQualityIssue["severity"];
  status: CompanyDataQualityIssue["status"];
  title: string;
  detail: string;
  source_key?: string | null;
  last_detected_at: string;
};

type DecisionRow = {
  id: string;
  decision_key: string;
  version_number: number;
  decision_type: CompanyDecisionType;
  status?: CompanyDecisionStatus;
  title: string;
  scope_type: CompanyDecisionScopeType;
  scope_key: string;
  owner_team: string;
  objective: string;
  problem_statement?: string;
  context?: string;
  constraints?: unknown;
  options?: unknown;
  chosen_option?: string | null;
  rationale?: string | null;
  assumptions?: unknown;
  expected_outcomes?: unknown;
  risks?: unknown;
  guardrails?: unknown;
  consequences?: unknown;
  rollback_plan?: string | null;
  supersedes_decision_id?: string | null;
  decided_at?: string | null;
  review_at: string;
  valid_from?: string | null;
  valid_until?: string | null;
  created_by?: string;
  submitted_by?: string | null;
  submitted_at?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  review_note?: string | null;
  created_at?: string;
  updated_at?: string;
};

type DecisionOutcomeRow = {
  id: string;
  decision_id: string;
  outcome_key: string;
  metric_key?: string | null;
  baseline_value?: number | string | null;
  target_value?: number | string | null;
  actual_value?: number | string | null;
  unit?: string | null;
  evaluation_status: CompanyDecisionOutcome["evaluationStatus"];
  evaluation_start?: string | null;
  evaluation_end: string;
  observed_at?: string | null;
  finding?: string | null;
  lessons_learned?: string | null;
  evidence_refs?: unknown;
  recorded_by: string;
  created_at: string;
  updated_at: string;
};

const DECISION_SELECT = [
  "id", "decision_key", "version_number", "decision_type", "status", "title", "scope_type", "scope_key",
  "owner_team", "objective", "problem_statement", "context", "constraints", "options", "chosen_option", "rationale",
  "assumptions", "expected_outcomes", "risks", "guardrails", "consequences", "rollback_plan", "supersedes_decision_id",
  "decided_at", "review_at", "valid_from", "valid_until", "created_by", "submitted_by", "submitted_at", "approved_by",
  "approved_at", "review_note", "created_at", "updated_at",
].join(",");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECISION_TYPES = new Set<CompanyDecisionType>(["decision", "policy", "architecture", "incident_resolution", "experiment"]);
const SCOPE_TYPES = new Set<CompanyDecisionScopeType>(["global", "team", "process", "entity", "workflow", "metric"]);
const DECISION_STATUSES = new Set<CompanyDecisionStatus>(["draft", "review", "approved", "superseded", "reversed", "expired"]);

function cleanText(value: unknown, maxLength = 1000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function requiredText(value: unknown, label: string, maxLength: number, minLength = 1) {
  const normalized = cleanText(value, maxLength);
  if (normalized.length < minLength) {
    throw new QuoteValidationError(`${label} fehlt oder ist zu kurz.`, [`invalid_${label.toLowerCase().replace(/\s+/g, "_")}`], 422);
  }
  return normalized;
}

function requireUuid(value: unknown, label: string) {
  const id = cleanText(value, 60);
  if (!UUID_PATTERN.test(id)) throw new QuoteValidationError(`${label} ist ungueltig.`, [`invalid_${label.toLowerCase()}`], 422);
  return id;
}

function normalizeTimestamp(value: unknown, label: string, required = false) {
  const raw = cleanText(value, 80);
  if (!raw && !required) return null;
  const date = new Date(raw);
  if (!raw || Number.isNaN(date.getTime())) {
    throw new QuoteValidationError(`${label} ist ungueltig.`, [`invalid_${label.toLowerCase().replace(/\s+/g, "_")}`], 422);
  }
  return date.toISOString();
}

function normalizeArray(value: unknown, label: string, maxEntries = 30) {
  if (!Array.isArray(value)) {
    throw new QuoteValidationError(`${label} muss eine Liste sein.`, [`invalid_${label.toLowerCase().replace(/\s+/g, "_")}`], 422);
  }
  return value.slice(0, maxEntries).map((entry) => {
    if (typeof entry === "string") return cleanText(entry, 2000);
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const serialized = JSON.stringify(entry);
      if (serialized.length > 4000) {
        throw new QuoteValidationError(`${label} enthaelt einen zu grossen Eintrag.`, [`invalid_${label.toLowerCase().replace(/\s+/g, "_")}`], 422);
      }
      return JSON.parse(serialized) as Record<string, unknown>;
    }
    throw new QuoteValidationError(`${label} enthaelt einen ungueltigen Eintrag.`, [`invalid_${label.toLowerCase().replace(/\s+/g, "_")}`], 422);
  });
}

function optionalFiniteNumber(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new QuoteValidationError(`${label} ist ungueltig.`, [`invalid_${label.toLowerCase().replace(/\s+/g, "_")}`], 422);
  }
  return number;
}

function parseArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function mapSource(row: SourceRow): CompanySourceRegistryEntry {
  return {
    sourceKey: row.source_key,
    displayName: row.display_name,
    sourceKind: row.source_kind,
    authority: row.authority,
    ownerTeam: row.owner_team,
    criticality: row.criticality,
    expectedFreshness: row.expected_freshness || null,
    containsPersonalData: row.contains_personal_data,
    active: row.active,
    description: row.description,
    updatedAt: row.updated_at,
  };
}

function mapContract(row: ContractRow): CompanyCorrelationContract {
  return {
    eventType: row.event_type,
    ownerTeam: row.owner_team,
    requiredIdentifiers: row.required_identifiers || [],
    requiredPayloadFields: row.required_payload_fields || [],
    schemaVersion: row.schema_version,
    severityWhenIncomplete: row.severity_when_incomplete,
    description: row.description,
    active: row.active,
  };
}

function mapWorkflow(row: WorkflowRow): CompanyWorkflowRegistryEntry {
  return {
    id: row.id,
    sourceKey: row.source_key,
    externalWorkflowId: row.external_workflow_id,
    workflowName: row.workflow_name,
    lifecycleStatus: row.lifecycle_status,
    active: row.active,
    ownerTeam: row.owner_team || null,
    nodeCount: row.node_count == null ? null : Number(row.node_count),
    triggerCount: row.trigger_count == null ? null : Number(row.trigger_count),
    warningCount: row.warning_count == null ? null : Number(row.warning_count),
    maxAllowedNodes: Number(row.max_allowed_nodes),
    lastReviewedAt: row.last_reviewed_at || null,
    lastSyncedAt: row.last_synced_at,
  };
}

function mapQualityIssue(row: QualityIssueRow): CompanyDataQualityIssue {
  return {
    id: row.id,
    issueKey: row.issue_key,
    issueType: row.issue_type,
    severity: row.severity,
    status: row.status,
    title: row.title,
    detail: row.detail,
    sourceKey: row.source_key || null,
    lastDetectedAt: row.last_detected_at,
  };
}

function mapDecision(row: DecisionRow): CompanyDecision {
  return {
    id: row.id,
    decisionKey: row.decision_key,
    versionNumber: Number(row.version_number),
    decisionType: row.decision_type,
    status: row.status || "approved",
    title: row.title,
    scopeType: row.scope_type,
    scopeKey: row.scope_key,
    ownerTeam: row.owner_team,
    objective: row.objective,
    problemStatement: row.problem_statement || "",
    context: row.context || "",
    constraints: parseArray(row.constraints),
    options: parseArray(row.options),
    chosenOption: row.chosen_option || null,
    rationale: row.rationale || null,
    assumptions: parseArray(row.assumptions),
    expectedOutcomes: parseArray(row.expected_outcomes),
    risks: parseArray(row.risks),
    guardrails: parseArray(row.guardrails),
    consequences: parseArray(row.consequences),
    rollbackPlan: row.rollback_plan || null,
    supersedesDecisionId: row.supersedes_decision_id || null,
    decidedAt: row.decided_at || null,
    reviewAt: row.review_at,
    validFrom: row.valid_from || null,
    validUntil: row.valid_until || null,
    createdBy: row.created_by || "unknown",
    submittedBy: row.submitted_by || null,
    submittedAt: row.submitted_at || null,
    approvedBy: row.approved_by || null,
    approvedAt: row.approved_at || null,
    reviewNote: row.review_note || null,
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

function mapDecisionOutcome(row: DecisionOutcomeRow): CompanyDecisionOutcome {
  return {
    id: row.id,
    decisionId: row.decision_id,
    outcomeKey: row.outcome_key,
    metricKey: row.metric_key || null,
    baselineValue: row.baseline_value == null ? null : Number(row.baseline_value),
    targetValue: row.target_value == null ? null : Number(row.target_value),
    actualValue: row.actual_value == null ? null : Number(row.actual_value),
    unit: row.unit || null,
    evaluationStatus: row.evaluation_status,
    evaluationStart: row.evaluation_start || null,
    evaluationEnd: row.evaluation_end,
    observedAt: row.observed_at || null,
    finding: row.finding || null,
    lessonsLearned: row.lessons_learned || null,
    evidenceRefs: parseArray(row.evidence_refs),
    recordedBy: row.recorded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getCompanyBrainFoundationOverview() {
  const [sources, contracts, workflows, qualityIssues] = await Promise.all([
    supabaseRequest<SourceRow[]>("company_source_registry", undefined, {
      select: "source_key,display_name,source_kind,authority,owner_team,criticality,expected_freshness,contains_personal_data,active,description,updated_at",
      order: "criticality.desc,display_name.asc",
    }),
    supabaseRequest<ContractRow[]>("company_correlation_contracts", undefined, {
      select: "event_type,owner_team,required_identifiers,required_payload_fields,schema_version,severity_when_incomplete,description,active",
      active: "eq.true",
      order: "event_type.asc",
    }),
    supabaseRequest<WorkflowRow[]>("company_workflow_registry", undefined, {
      select: "id,source_key,external_workflow_id,workflow_name,lifecycle_status,active,owner_team,node_count,trigger_count,warning_count,max_allowed_nodes,last_reviewed_at,last_synced_at",
      order: "active.desc,workflow_name.asc",
      limit: 500,
    }),
    supabaseRequest<QualityIssueRow[]>("company_data_quality_issues", undefined, {
      select: "id,issue_key,issue_type,severity,status,title,detail,source_key,last_detected_at",
      status: "in.(open,acknowledged)",
      order: "last_detected_at.desc",
      limit: 100,
    }),
  ]);

  const mappedWorkflows = workflows.map(mapWorkflow);
  return {
    generatedAt: new Date().toISOString(),
    sources: sources.map(mapSource),
    correlationContracts: contracts.map(mapContract),
    workflows: mappedWorkflows,
    workflowSummary: {
      total: mappedWorkflows.length,
      active: mappedWorkflows.filter((entry) => entry.active).length,
      unreviewed: mappedWorkflows.filter((entry) => entry.lifecycleStatus === "unreviewed").length,
      aboveNodeLimit: mappedWorkflows.filter((entry) => entry.nodeCount != null && entry.nodeCount > entry.maxAllowedNodes).length,
    },
    dataQualityIssues: qualityIssues.map(mapQualityIssue),
  };
}

function n8nApiConfig() {
  const rawBaseUrl = cleanText(process.env.N8N_API_URL || process.env.N8N_BASE_URL, 500).replace(/\/+$/, "");
  const apiKey = cleanText(process.env.N8N_API_KEY, 1000);
  if (!rawBaseUrl || !apiKey) {
    throw new QuoteValidationError("n8n API ist nicht konfiguriert.", ["n8n_api_not_configured"], 503);
  }
  const apiBaseUrl = rawBaseUrl.endsWith("/api/v1") ? rawBaseUrl : `${rawBaseUrl}/api/v1`;
  return { apiBaseUrl, apiKey };
}

type N8nWorkflow = {
  id?: string;
  name?: string;
  active?: boolean;
  versionId?: string | number | null;
  updatedAt?: string | null;
  nodes?: Array<{ type?: string; disabled?: boolean }>;
  tags?: Array<{ name?: string }>;
};

function n8nTriggerCount(nodes: N8nWorkflow["nodes"]) {
  return (nodes || []).filter((node) => {
    if (node.disabled) return false;
    const type = cleanText(node.type, 200).toLowerCase();
    return type.includes("trigger") || type.includes("webhook");
  }).length;
}

export async function syncN8nWorkflowRegistry(input: { confirmed?: unknown; actor?: unknown }) {
  if (input.confirmed !== true) {
    throw new QuoteValidationError("Workflow-Sync muss explizit bestaetigt werden.", ["confirmation_required"], 409);
  }
  const actor = requiredText(input.actor, "Actor", 160);
  const { apiBaseUrl, apiKey } = n8nApiConfig();
  const workflows: N8nWorkflow[] = [];
  let cursor: string | null = null;

  do {
    const url = new URL(`${apiBaseUrl}/workflows`);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, {
      headers: { "X-N8N-API-KEY": apiKey, Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new QuoteValidationError(`n8n Workflow-Liste konnte nicht geladen werden (${response.status}).`, ["n8n_sync_failed"], 502);
    }
    const body = await response.json() as { data?: N8nWorkflow[]; nextCursor?: string | null };
    workflows.push(...(Array.isArray(body.data) ? body.data : []));
    cursor = cleanText(body.nextCursor, 500) || null;
    if (workflows.length > 2000) throw new QuoteValidationError("n8n Workflow-Limit ueberschritten.", ["n8n_sync_limit"], 409);
  } while (cursor);

  const existingRows = await supabaseRequest<WorkflowRow[]>("company_workflow_registry", undefined, {
    select: "id,source_key,external_workflow_id,workflow_name,lifecycle_status,active,owner_team,business_purpose,trigger_contract,output_contract,runbook_url,current_version,node_count,trigger_count,warning_count,max_allowed_nodes,last_reviewed_at,last_synced_at,metadata",
    source_key: "eq.n8n",
    limit: 2000,
  });
  const existingById = new Map(existingRows.map((row) => [row.external_workflow_id, row]));
  const syncedAt = new Date().toISOString();
  const payload = workflows.flatMap((workflow) => {
    const externalWorkflowId = cleanText(workflow.id, 200);
    const workflowName = cleanText(workflow.name, 500);
    if (!externalWorkflowId || !workflowName) return [];
    const existing = existingById.get(externalWorkflowId);
    const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
    return [{
      source_key: "n8n",
      external_workflow_id: externalWorkflowId,
      workflow_name: workflowName,
      lifecycle_status: existing?.lifecycle_status || "unreviewed",
      active: workflow.active === true,
      owner_team: existing?.owner_team || null,
      business_purpose: existing?.business_purpose || null,
      trigger_contract: existing?.trigger_contract || null,
      output_contract: existing?.output_contract || null,
      runbook_url: existing?.runbook_url || null,
      current_version: cleanText(workflow.versionId, 120) || existing?.current_version || null,
      node_count: nodes.length || existing?.node_count || null,
      trigger_count: nodes.length ? n8nTriggerCount(nodes) : existing?.trigger_count || null,
      warning_count: existing?.warning_count || null,
      max_allowed_nodes: existing?.max_allowed_nodes || 30,
      last_reviewed_at: existing?.last_reviewed_at || null,
      last_synced_at: syncedAt,
      metadata: {
        ...(existing?.metadata || {}),
        tags: (workflow.tags || []).map((tag) => cleanText(tag.name, 120)).filter(Boolean),
        syncedBy: actor,
        n8nUpdatedAt: cleanText(workflow.updatedAt, 80) || null,
      },
    }];
  });

  for (let offset = 0; offset < payload.length; offset += 100) {
    await supabaseRequest("company_workflow_registry", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(payload.slice(offset, offset + 100)),
    }, {
      on_conflict: "source_key,external_workflow_id",
    });
  }

  const active = payload.filter((entry) => entry.active).length;
  const aboveNodeLimit = payload.filter((entry) => entry.node_count != null && entry.node_count > entry.max_allowed_nodes).length;
  return { syncedAt, total: payload.length, active, aboveNodeLimit };
}

export async function resolveCompanyEntityAlias(input: { sourceKey?: unknown; aliasType?: unknown; aliasValue?: unknown }) {
  const sourceKey = requiredText(input.sourceKey, "Source Key", 80).toLowerCase();
  const aliasType = requiredText(input.aliasType, "Alias Type", 80).toLowerCase();
  const aliasValue = requiredText(input.aliasValue, "Alias Value", 500);
  const rows = await supabaseRpc<Array<{
    entity_id: string;
    entity_type: string;
    canonical_key: string;
    display_label?: string | null;
    confidence: number | string;
    resolution_method: string;
  }>>("resolve_company_entity_alias", {
    p_source_key: sourceKey,
    p_alias_type: aliasType,
    p_alias_value: aliasValue,
  });
  const match = rows[0];
  return match ? {
    entityId: match.entity_id,
    entityType: match.entity_type,
    canonicalKey: match.canonical_key,
    displayLabel: match.display_label || null,
    confidence: Number(match.confidence),
    resolutionMethod: match.resolution_method,
  } : null;
}

export async function listCompanyDecisions(statusInput?: unknown) {
  const statusText = cleanText(statusInput, 30);
  const status = statusText ? statusText as CompanyDecisionStatus : null;
  if (status && !DECISION_STATUSES.has(status)) {
    throw new QuoteValidationError("Decision-Status ist ungueltig.", ["invalid_decision_status"], 422);
  }
  const rows = await supabaseRequest<DecisionRow[]>("company_decisions", undefined, {
    select: DECISION_SELECT,
    ...(status ? { status: `eq.${status}` } : {}),
    order: "updated_at.desc",
    limit: 200,
  });
  return rows.map(mapDecision);
}

export async function listCompanyDecisionOutcomes(decisionIdInput: unknown) {
  const decisionId = requireUuid(decisionIdInput, "Decision ID");
  const rows = await supabaseRequest<DecisionOutcomeRow[]>("company_decision_outcomes", undefined, {
    select: [
      "id", "decision_id", "outcome_key", "metric_key", "baseline_value", "target_value", "actual_value", "unit",
      "evaluation_status", "evaluation_start", "evaluation_end", "observed_at", "finding", "lessons_learned",
      "evidence_refs", "recorded_by", "created_at", "updated_at",
    ].join(","),
    decision_id: `eq.${decisionId}`,
    order: "evaluation_end.desc,created_at.desc",
    limit: 100,
  });
  return rows.map(mapDecisionOutcome);
}

export async function createCompanyDecisionDraft(input: Record<string, unknown>) {
  const decisionKey = requiredText(input.decisionKey, "Decision Key", 120, 3).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{2,119}$/.test(decisionKey)) {
    throw new QuoteValidationError("Decision Key ist ungueltig.", ["invalid_decision_key"], 422);
  }
  const decisionType = cleanText(input.decisionType || "decision", 40) as CompanyDecisionType;
  if (!DECISION_TYPES.has(decisionType)) {
    throw new QuoteValidationError("Decision Type ist ungueltig.", ["invalid_decision_type"], 422);
  }
  const scopeType = cleanText(input.scopeType, 40) as CompanyDecisionScopeType;
  if (!SCOPE_TYPES.has(scopeType)) {
    throw new QuoteValidationError("Scope Type ist ungueltig.", ["invalid_scope_type"], 422);
  }
  const options = normalizeArray(input.options, "Optionen", 12);
  if (!options.length) throw new QuoteValidationError("Mindestens eine Option ist erforderlich.", ["missing_options"], 422);

  const reviewAt = normalizeTimestamp(input.reviewAt, "Review Datum", true)!;
  if (new Date(reviewAt).getTime() <= Date.now()) {
    throw new QuoteValidationError("Review Datum muss in der Zukunft liegen.", ["review_date_not_future"], 422);
  }
  const validFrom = normalizeTimestamp(input.validFrom, "Gueltig ab");
  const validUntil = normalizeTimestamp(input.validUntil, "Gueltig bis");
  if (validFrom && validUntil && validUntil <= validFrom) {
    throw new QuoteValidationError("Gueltig bis muss nach Gueltig ab liegen.", ["invalid_validity_window"], 422);
  }

  const result = await supabaseRpc<DecisionRow | DecisionRow[]>("create_company_decision_draft", {
    p_payload: {
      decision_key: decisionKey,
      decision_type: decisionType,
      title: requiredText(input.title, "Titel", 240, 3),
      scope_type: scopeType,
      scope_key: requiredText(input.scopeKey, "Scope Key", 200),
      owner_team: requiredText(input.ownerTeam, "Owner Team", 120),
      objective: requiredText(input.objective, "Ziel", 4000, 10),
      problem_statement: requiredText(input.problemStatement, "Problem", 4000, 10),
      context: requiredText(input.context, "Kontext", 12000, 10),
      constraints: normalizeArray(input.constraints || [], "Constraints"),
      options,
      chosen_option: cleanText(input.chosenOption, 500) || null,
      rationale: cleanText(input.rationale, 8000) || null,
      assumptions: normalizeArray(input.assumptions || [], "Annahmen"),
      expected_outcomes: normalizeArray(input.expectedOutcomes || [], "Erwartete Ergebnisse"),
      risks: normalizeArray(input.risks || [], "Risiken"),
      guardrails: normalizeArray(input.guardrails || [], "Guardrails"),
      consequences: normalizeArray(input.consequences || [], "Konsequenzen"),
      rollback_plan: cleanText(input.rollbackPlan, 8000) || null,
      review_at: reviewAt,
      valid_from: validFrom,
      valid_until: validUntil,
      created_by: requiredText(input.createdBy, "Erstellt von", 160),
    },
  });
  const row = Array.isArray(result) ? result[0] : result;
  if (!row) throw new QuoteValidationError("Decision-Entwurf konnte nicht erstellt werden.", ["decision_create_failed"], 409);
  return mapDecision(row);
}

export async function reviewCompanyDecision(input: Record<string, unknown>) {
  const decisionId = requireUuid(input.decisionId, "Decision ID");
  const action = cleanText(input.action, 40) as CompanyDecisionReviewAction;
  if (!(["submit", "approve", "request_changes"] as string[]).includes(action)) {
    throw new QuoteValidationError("Review-Aktion ist ungueltig.", ["invalid_review_action"], 422);
  }
  const actor = requiredText(input.actor, "Actor", 160);
  const note = cleanText(input.note, 4000);
  if (action === "request_changes" && !note) {
    throw new QuoteValidationError("Aenderungsanforderungen brauchen eine Begruendung.", ["review_note_required"], 422);
  }
  const correlationId = requiredText(
    input.correlationId || `decision:${decisionId}:${action}`,
    "Correlation ID",
    300,
    2,
  );
  const rpcName = action === "submit"
    ? "submit_company_decision"
    : action === "approve"
      ? "approve_company_decision"
      : "request_company_decision_changes";
  const result = await supabaseRpc<DecisionRow | DecisionRow[]>(rpcName, {
    p_decision_id: decisionId,
    p_actor: actor,
    p_note: note,
    p_correlation_id: correlationId,
  });
  const row = Array.isArray(result) ? result[0] : result;
  if (!row) throw new QuoteValidationError("Decision konnte nicht aktualisiert werden.", ["decision_update_failed"], 409);
  return mapDecision(row);
}

export async function searchActiveCompanyDecisions(input: {
  scopes?: Array<{ scopeType?: unknown; scopeKey?: unknown }>;
  at?: unknown;
  limit?: unknown;
}) {
  const scopes = (Array.isArray(input.scopes) ? input.scopes : []).slice(0, 30).map((scope) => {
    const scopeType = cleanText(scope.scopeType, 40) as CompanyDecisionScopeType;
    if (!SCOPE_TYPES.has(scopeType)) throw new QuoteValidationError("Scope Type ist ungueltig.", ["invalid_scope_type"], 422);
    return { scopeType, scopeKey: requiredText(scope.scopeKey, "Scope Key", 200) };
  });
  const limit = Math.min(Math.max(Number(input.limit || 20) || 20, 1), 50);
  const at = normalizeTimestamp(input.at, "Zeitpunkt") || new Date().toISOString();
  const rows = await supabaseRpc<DecisionRow[]>("search_active_company_decisions", {
    p_scopes: scopes,
    p_at: at,
    p_limit: limit,
  });
  return rows.map((row): ActiveCompanyDecision => {
    const decision = mapDecision(row);
    return {
      id: decision.id,
      decisionKey: decision.decisionKey,
      versionNumber: decision.versionNumber,
      decisionType: decision.decisionType,
      title: decision.title,
      scopeType: decision.scopeType,
      scopeKey: decision.scopeKey,
      ownerTeam: decision.ownerTeam,
      objective: decision.objective,
      chosenOption: decision.chosenOption,
      rationale: decision.rationale,
      guardrails: decision.guardrails,
      consequences: decision.consequences,
      rollbackPlan: decision.rollbackPlan,
      decidedAt: decision.decidedAt,
      reviewAt: decision.reviewAt,
      validFrom: decision.validFrom,
      validUntil: decision.validUntil,
    };
  });
}

export async function recordCompanyDecisionOutcome(input: Record<string, unknown>) {
  const decisionId = requireUuid(input.decisionId, "Decision ID");
  const evaluationStatus = cleanText(input.evaluationStatus || "pending", 30);
  if (!["pending", "met", "missed", "inconclusive", "cancelled"].includes(evaluationStatus)) {
    throw new QuoteValidationError("Outcome-Status ist ungueltig.", ["invalid_outcome_status"], 422);
  }
  const observedAt = normalizeTimestamp(input.observedAt, "Beobachtet am");
  const finding = cleanText(input.finding, 8000) || null;
  if (evaluationStatus !== "pending" && (!observedAt || !finding)) {
    throw new QuoteValidationError("Bewertete Outcomes brauchen Zeitpunkt und Ergebnis.", ["outcome_result_required"], 422);
  }
  const rows = await supabaseRequest<DecisionOutcomeRow[]>("company_decision_outcomes", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      decision_id: decisionId,
      outcome_key: requiredText(input.outcomeKey, "Outcome Key", 120),
      metric_key: cleanText(input.metricKey, 120) || null,
      baseline_value: optionalFiniteNumber(input.baselineValue, "Baseline"),
      target_value: optionalFiniteNumber(input.targetValue, "Zielwert"),
      actual_value: optionalFiniteNumber(input.actualValue, "Istwert"),
      unit: cleanText(input.unit, 80) || null,
      evaluation_status: evaluationStatus,
      evaluation_start: normalizeTimestamp(input.evaluationStart, "Evaluation Start"),
      evaluation_end: normalizeTimestamp(input.evaluationEnd, "Evaluation Ende", true),
      observed_at: observedAt,
      finding,
      lessons_learned: cleanText(input.lessonsLearned, 8000) || null,
      evidence_refs: normalizeArray(input.evidenceRefs || [], "Evidence Refs"),
      recorded_by: requiredText(input.recordedBy, "Erfasst von", 160),
    }),
  });
  return rows[0] ? mapDecisionOutcome(rows[0]) : null;
}
