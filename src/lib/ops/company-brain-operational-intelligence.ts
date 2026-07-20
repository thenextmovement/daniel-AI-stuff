import { createHash } from "node:crypto";
import type { CompanyBrainActor } from "@/lib/ops/company-brain-access";
import type { CompanyBrainResolveResult, CompanyBrainWatcher } from "@/lib/ops/company-brain";
import { supabaseRequest, supabaseRpc } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export type CompanyBrainIncidentSeverity = "info" | "warning" | "critical";
export type CompanyBrainIncidentStatus = "open" | "acknowledged" | "resolved" | "ignored";

export type CompanyBrainPlaybook = {
  key: string;
  version: number;
  title: string;
  category: string;
  ownerTeam: string;
  purpose: string;
  triggerCodes: string[];
  defaultSeverity: CompanyBrainIncidentSeverity;
  diagnosisSteps: string[];
  safeActions: string[];
  blockedActions: string[];
  escalationSteps: string[];
  verificationSteps: string[];
};

export type CompanyBrainOperationalIncident = {
  id: string;
  fingerprint: string;
  incidentType: string;
  severity: CompanyBrainIncidentSeverity;
  status: CompanyBrainIncidentStatus;
  title: string;
  detail: string;
  rootCauseCode: string;
  playbookKey: string | null;
  playbookVersion: number | null;
  caseKey: string | null;
  requestId: string | null;
  trelloCardId: string | null;
  offerId: string | null;
  workflowExecutionId: string | null;
  sourceKey: string | null;
  sourceRef: string | null;
  evidenceRefs: string[];
  ownerTeam: string;
  assignedTo: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  metadata: Record<string, unknown>;
};

type IncidentRow = {
  id: string;
  fingerprint: string;
  incident_type: string;
  severity: CompanyBrainIncidentSeverity;
  status: CompanyBrainIncidentStatus;
  title: string;
  detail: string;
  root_cause_code: string;
  playbook_key?: string | null;
  playbook_version?: number | null;
  case_key?: string | null;
  request_id?: string | null;
  trello_card_id?: string | null;
  offer_id?: string | null;
  workflow_execution_id?: string | null;
  source_key?: string | null;
  source_ref?: string | null;
  evidence_refs?: unknown;
  owner_team: string;
  assigned_to?: string | null;
  first_seen_at: string;
  last_seen_at: string;
  acknowledged_at?: string | null;
  acknowledged_by?: string | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
  resolution_note?: string | null;
  metadata?: Record<string, unknown> | null;
};

type PlaybookRow = {
  playbook_key: string;
  version: number;
  title: string;
  category: string;
  owner_team: string;
  purpose: string;
  trigger_codes?: unknown;
  default_severity: CompanyBrainIncidentSeverity;
  diagnosis_steps?: unknown;
  safe_actions?: unknown;
  blocked_actions?: unknown;
  escalation_steps?: unknown;
  verification_steps?: unknown;
};

const INCIDENT_SELECT = [
  "id", "fingerprint", "incident_type", "severity", "status", "title", "detail", "root_cause_code",
  "playbook_key", "playbook_version", "case_key", "request_id", "trello_card_id", "offer_id",
  "workflow_execution_id", "source_key", "source_ref", "evidence_refs", "owner_team", "assigned_to",
  "first_seen_at", "last_seen_at", "acknowledged_at", "acknowledged_by", "resolved_at", "resolved_by",
  "resolution_note", "metadata",
].join(",");

function cleanText(value: unknown, maxLength = 1000) {
  return String(value ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function stringArray(value: unknown, maxItems = 20) {
  return Array.isArray(value)
    ? value.map((entry) => cleanText(entry, 1000)).filter(Boolean).slice(0, maxItems)
    : [];
}

function mapIncident(row: IncidentRow): CompanyBrainOperationalIncident {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    incidentType: row.incident_type,
    severity: row.severity,
    status: row.status,
    title: row.title,
    detail: row.detail,
    rootCauseCode: row.root_cause_code,
    playbookKey: row.playbook_key || null,
    playbookVersion: row.playbook_version ?? null,
    caseKey: row.case_key || null,
    requestId: row.request_id || null,
    trelloCardId: row.trello_card_id || null,
    offerId: row.offer_id || null,
    workflowExecutionId: row.workflow_execution_id || null,
    sourceKey: row.source_key || null,
    sourceRef: row.source_ref || null,
    evidenceRefs: stringArray(row.evidence_refs, 50),
    ownerTeam: row.owner_team,
    assignedTo: row.assigned_to || null,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    acknowledgedAt: row.acknowledged_at || null,
    acknowledgedBy: row.acknowledged_by || null,
    resolvedAt: row.resolved_at || null,
    resolvedBy: row.resolved_by || null,
    resolutionNote: row.resolution_note || null,
    metadata: row.metadata || {},
  };
}

function mapPlaybook(row: PlaybookRow): CompanyBrainPlaybook {
  return {
    key: row.playbook_key,
    version: row.version,
    title: row.title,
    category: row.category,
    ownerTeam: row.owner_team,
    purpose: row.purpose,
    triggerCodes: stringArray(row.trigger_codes),
    defaultSeverity: row.default_severity,
    diagnosisSteps: stringArray(row.diagnosis_steps),
    safeActions: stringArray(row.safe_actions),
    blockedActions: stringArray(row.blocked_actions),
    escalationSteps: stringArray(row.escalation_steps),
    verificationSteps: stringArray(row.verification_steps),
  };
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function caseIdentity(result: CompanyBrainResolveResult) {
  const requestId = result.records[0]?.requestId
    || result.offers.find((offer) => offer.requestId)?.requestId
    || result.identifiers.find((entry) => entry.type === "request_id")?.value
    || null;
  const trelloCardId = result.trelloFailureDiagnosis.card?.id
    || result.identifiers.find((entry) => entry.type === "trello_card_id")?.value
    || null;
  const offerId = result.offers[0]?.offerId || null;
  const raw = requestId ? `request:${requestId}` : trelloCardId ? `trello:${trelloCardId}` : offerId ? `offer:${offerId}` : `query:${hash(result.query)}`;
  return { caseKey: raw, requestId, trelloCardId, offerId };
}

function primaryAutomationIssue(result: CompanyBrainResolveResult) {
  return result.automationRuns
    .filter((run) => run.workflowName !== "company_brain_fix_center")
    .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())
    .find((run) => run.issueKey && run.issueKey !== "unknown")?.issueKey || null;
}

function watcherPlaybook(result: CompanyBrainResolveResult, watcher: CompanyBrainWatcher) {
  const issue = primaryAutomationIssue(result);
  if (watcher.key === "missing_design_assets") return { rootCauseCode: "asset_processing_failed", playbookKey: "asset_processing_failed", ownerTeam: "design" };
  if (watcher.key === "order_without_color_confirmation") return { rootCauseCode: watcher.key, playbookKey: "data_quality_issue", ownerTeam: "sales" };
  if (watcher.key === "missing_live_outlook") return { rootCauseCode: "outlook_auth_failed", playbookKey: "delivery_failure", ownerTeam: "engineering" };
  if (watcher.key === "offer_without_send_proof") return { rootCauseCode: "offer_send_unproven", playbookKey: "delivery_failure", ownerTeam: "sales" };
  if (watcher.key === "trello_trigger_failure" && result.trelloFailureDiagnosis.rootCauseKey === "no_source_record") {
    return { rootCauseCode: "source_mapping_conflict", playbookKey: "source_mapping_conflict", ownerTeam: "operations" };
  }
  if (watcher.key === "automation_failed" || watcher.key === "trello_trigger_failure") {
    if (issue === "customer_email_missing" || issue === "customer_email_invalid") return { rootCauseCode: issue, playbookKey: "customer_email_invalid", ownerTeam: "sales" };
    if (issue === "delivery_failure" || issue === "outlook_auth_failed" || issue === "send_guard_unavailable") return { rootCauseCode: issue, playbookKey: "delivery_failure", ownerTeam: "engineering" };
    if (issue === "source_mapping_conflict") return { rootCauseCode: issue, playbookKey: "source_mapping_conflict", ownerTeam: "operations" };
    if (["video_content_qc_failed", "video_content_qc_inconclusive", "video_content_qc_unavailable"].includes(issue || "")) return { rootCauseCode: issue!, playbookKey: "video_content_qc_failed", ownerTeam: "design" };
    if (issue === "asset_processing_failed" || issue === "preview_media_invalid") return { rootCauseCode: issue, playbookKey: "asset_processing_failed", ownerTeam: "design" };
    if (["offer_api_failed", "offer_service_unavailable", "source_changed_after_preflight", "size_ladder_validation_failed"].includes(issue || "")) return { rootCauseCode: issue!, playbookKey: "offer_api_failed", ownerTeam: "engineering" };
    return { rootCauseCode: issue || "workflow_hard_error", playbookKey: "workflow_hard_error", ownerTeam: "engineering" };
  }
  return { rootCauseCode: watcher.key, playbookKey: "workflow_hard_error", ownerTeam: "operations" };
}

function watcherFingerprint(result: CompanyBrainResolveResult, watcher: CompanyBrainWatcher) {
  if (watcher.key === "missing_live_outlook") return "integration:missing_live_outlook";
  return `case_watcher:${hash(`${caseIdentity(result).caseKey}|${watcher.key}`)}`;
}

function watcherEvidence(result: CompanyBrainResolveResult, watcher: CompanyBrainWatcher) {
  const keys = watcher.key === "missing_design_assets"
    ? result.assets.flatMap((asset) => asset.evidenceIds)
    : watcher.key === "automation_failed" || watcher.key === "trello_trigger_failure"
      ? result.caseEvents.filter((event) => event.category === "automation" || event.category === "trello").flatMap((event) => event.evidenceIds)
      : result.checks.flatMap((check) => check.evidenceIds);
  return [...new Set(keys.filter(Boolean))].slice(0, 20);
}

export async function listCompanyBrainOperationalIncidents(input?: {
  status?: unknown;
  severity?: unknown;
  limit?: unknown;
}) {
  const status = cleanText(input?.status, 40) || "active";
  const severity = cleanText(input?.severity, 40);
  if (!["active", "all", "open", "acknowledged", "resolved", "ignored"].includes(status)) {
    throw new QuoteValidationError("Incident-Status ist ungültig.", ["invalid_incident_status"], 422);
  }
  if (severity && !["info", "warning", "critical"].includes(severity)) {
    throw new QuoteValidationError("Incident-Schweregrad ist ungültig.", ["invalid_incident_severity"], 422);
  }
  const limit = Math.max(1, Math.min(Number(input?.limit) || 100, 200));
  const rows = await supabaseRequest<IncidentRow[]>("company_brain_operational_incidents", undefined, {
    select: INCIDENT_SELECT,
    ...(status === "active" ? { status: "in.(open,acknowledged)" } : status === "all" ? {} : { status: `eq.${status}` }),
    ...(severity ? { severity: `eq.${severity}` } : {}),
    order: "severity.desc,last_seen_at.desc",
    limit,
  });
  const severityRank: Record<CompanyBrainIncidentSeverity, number> = { critical: 3, warning: 2, info: 1 };
  return rows.map(mapIncident).sort((left, right) =>
    severityRank[right.severity] - severityRank[left.severity]
      || new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime(),
  );
}

export async function listCompanyBrainPlaybooks() {
  const rows = await supabaseRequest<PlaybookRow[]>("company_brain_playbooks", undefined, {
    select: "playbook_key,version,title,category,owner_team,purpose,trigger_codes,default_severity,diagnosis_steps,safe_actions,blocked_actions,escalation_steps,verification_steps",
    active: "eq.true",
    order: "title.asc",
    limit: 100,
  });
  return rows.map(mapPlaybook);
}

export async function scanCompanyBrainOperationalIncidents() {
  const response = await supabaseRpc<Array<{ detected?: number; resolved?: number }> | { detected?: number; resolved?: number }>(
    "scan_company_brain_operational_incidents",
    {},
  );
  const row = Array.isArray(response) ? response[0] : response;
  return { detected: Number(row?.detected || 0), resolved: Number(row?.resolved || 0) };
}

export async function transitionCompanyBrainOperationalIncident(input: {
  incidentId: unknown;
  status: unknown;
  actor: CompanyBrainActor;
  note?: unknown;
  assignedTo?: unknown;
}) {
  const incidentId = cleanText(input.incidentId, 60);
  const status = cleanText(input.status, 30);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(incidentId)) {
    throw new QuoteValidationError("Incident-ID ist ungültig.", ["invalid_incident_id"], 422);
  }
  if (!["open", "acknowledged", "resolved", "ignored"].includes(status)) {
    throw new QuoteValidationError("Incident-Status ist ungültig.", ["invalid_incident_status"], 422);
  }
  const assignedTo = cleanText(input.assignedTo, 320).toLowerCase();
  if (assignedTo && !/^[^\s@]+@neontrip\.de$/i.test(assignedTo)) {
    throw new QuoteValidationError("Zuweisung braucht eine interne NEONTRIP-E-Mail.", ["invalid_incident_assignee"], 422);
  }
  const response = await supabaseRpc<IncidentRow | IncidentRow[]>("transition_company_brain_incident", {
    p_incident_id: incidentId,
    p_status: status,
    p_actor: input.actor.email,
    p_note: cleanText(input.note, 3000) || null,
    p_assigned_to: assignedTo || null,
  });
  const row = Array.isArray(response) ? response[0] : response;
  if (!row) throw new QuoteValidationError("Incident wurde parallel verändert.", ["incident_transition_conflict"], 409);
  return mapIncident(row);
}

async function findActiveIncidentByFingerprint(fingerprint: string) {
  const rows = await supabaseRequest<IncidentRow[]>("company_brain_operational_incidents", undefined, {
    select: INCIDENT_SELECT,
    fingerprint: `eq.${fingerprint}`,
    status: "in.(open,acknowledged)",
    limit: 1,
  });
  return rows[0] || null;
}

export async function persistCompanyBrainCaseIncidents(input: {
  result: CompanyBrainResolveResult;
  actor: CompanyBrainActor;
  entityId?: string | null;
}) {
  const identity = caseIdentity(input.result);
  const primaryRun = input.result.automationRuns
    .filter((run) => run.workflowName !== "company_brain_fix_center")
    .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())[0] || null;
  const outcomes = await Promise.all(input.result.watchers.map(async (watcher): Promise<CompanyBrainOperationalIncident | null> => {
    const fingerprint = watcherFingerprint(input.result, watcher);
    if (watcher.status === "ok") {
      const active = await findActiveIncidentByFingerprint(fingerprint);
      if (active) {
        const response = await supabaseRpc<IncidentRow | IncidentRow[]>("transition_company_brain_incident", {
          p_incident_id: active.id,
          p_status: "resolved",
          p_actor: input.actor.email,
          p_note: "Die erneute Fallprüfung zeigt den zuvor offenen Wächter jetzt als erledigt.",
          p_assigned_to: null,
        });
        const row = Array.isArray(response) ? response[0] : response;
        return row ? mapIncident(row) : null;
      }
      return null;
    }

    const playbook = watcherPlaybook(input.result, watcher);
    const isGlobalIntegrationIncident = watcher.key === "missing_live_outlook";
    const response = await supabaseRpc<IncidentRow | IncidentRow[]>("upsert_company_brain_incident", {
      p_fingerprint: fingerprint,
      p_incident_type: "case_watcher",
      p_severity: watcher.severity,
      p_title: watcher.title,
      p_detail: watcher.detail,
      p_root_cause_code: playbook.rootCauseCode,
      p_playbook_key: playbook.playbookKey,
      p_playbook_version: 1,
      p_entity_id: isGlobalIntegrationIncident ? null : input.entityId || null,
      p_case_key: isGlobalIntegrationIncident ? null : identity.caseKey,
      p_request_id: isGlobalIntegrationIncident ? null : identity.requestId,
      p_trello_card_id: isGlobalIntegrationIncident ? null : identity.trelloCardId,
      p_offer_id: isGlobalIntegrationIncident ? null : identity.offerId,
      p_workflow_execution_id: isGlobalIntegrationIncident ? null : primaryRun?.executionId || null,
      p_source_key: watcher.key === "missing_live_outlook" ? "outlook_graph" : watcher.key.includes("trello") ? "trello" : watcher.key === "automation_failed" ? "n8n" : "supabase",
      p_source_ref: isGlobalIntegrationIncident ? "integration:outlook_graph" : primaryRun?.id ? `workflow_audit:${primaryRun.id}` : identity.caseKey,
      p_evidence_refs: isGlobalIntegrationIncident ? [] : watcherEvidence(input.result, watcher),
      p_owner_team: playbook.ownerTeam,
      p_metadata: isGlobalIntegrationIncident ? { watcherKey: watcher.key } : {
        watcherKey: watcher.key,
        queryHash: hash(input.result.query),
        evidenceScore: input.result.evidenceScore.score,
        actionKey: watcher.actionKey,
      },
      p_actor: input.actor.email,
      p_reopen: true,
    });
    const row = Array.isArray(response) ? response[0] : response;
    return row ? mapIncident(row) : null;
  }));
  return outcomes.filter((incident): incident is CompanyBrainOperationalIncident => Boolean(incident));
}
