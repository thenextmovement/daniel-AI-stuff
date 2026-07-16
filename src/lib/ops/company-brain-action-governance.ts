import { createHash } from "node:crypto";
import type { CompanyBrainActor, CompanyBrainRole } from "@/lib/ops/company-brain-access";
import { supabaseRequest, supabaseRpc } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export type CompanyBrainActionRisk = "low" | "medium" | "high" | "critical";
export type CompanyBrainActionRunStatus =
  | "proposed"
  | "awaiting_approval"
  | "approved"
  | "executing"
  | "verifying"
  | "resolved"
  | "blocked"
  | "failed"
  | "rejected"
  | "cancelled";

export type CompanyBrainActionPolicy = {
  actionKey: string;
  riskLevel: CompanyBrainActionRisk;
  minimumRole: CompanyBrainRole;
  approvalRole: CompanyBrainRole | null;
  requiresFourEyes: boolean;
  customerSideEffect: boolean;
  description: string;
};

export type CompanyBrainActionRun = {
  id: string;
  actionKey: string;
  caseKey: string;
  requestId: string | null;
  riskLevel: CompanyBrainActionRisk;
  status: CompanyBrainActionRunStatus;
  proposedBy: string;
  approvedBy: string | null;
  idempotencyKey: string;
  inputHash: string;
  frozenInput: Record<string, unknown>;
  preview: Record<string, unknown>;
  failureCode: string | null;
  failureDetail: string | null;
  proposedAt: string;
  approvedAt: string | null;
  executionStartedAt: string | null;
  completedAt: string | null;
};

type PolicyRow = {
  action_key: string;
  risk_level: CompanyBrainActionRisk;
  minimum_role: CompanyBrainRole;
  approval_role?: CompanyBrainRole | null;
  requires_four_eyes: boolean;
  customer_side_effect: boolean;
  description: string;
};

type RunRow = {
  id: string;
  action_key: string;
  case_key: string;
  request_id?: string | null;
  risk_level: CompanyBrainActionRisk;
  status: CompanyBrainActionRunStatus;
  proposed_by: string;
  approved_by?: string | null;
  idempotency_key: string;
  input_hash: string;
  frozen_input: Record<string, unknown>;
  preview?: Record<string, unknown> | null;
  failure_code?: string | null;
  failure_detail?: string | null;
  proposed_at: string;
  approved_at?: string | null;
  execution_started_at?: string | null;
  completed_at?: string | null;
};

const RUN_SELECT = [
  "id", "action_key", "case_key", "request_id", "risk_level", "status", "proposed_by", "approved_by",
  "idempotency_key", "input_hash", "frozen_input", "preview", "failure_code", "failure_detail",
  "proposed_at", "approved_at", "execution_started_at", "completed_at",
].join(",");

function cleanText(value: unknown, maxLength = 1000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function mapPolicy(row: PolicyRow): CompanyBrainActionPolicy {
  return {
    actionKey: row.action_key,
    riskLevel: row.risk_level,
    minimumRole: row.minimum_role,
    approvalRole: row.approval_role || null,
    requiresFourEyes: row.requires_four_eyes,
    customerSideEffect: row.customer_side_effect,
    description: row.description,
  };
}

function mapRun(row: RunRow): CompanyBrainActionRun {
  return {
    id: row.id,
    actionKey: row.action_key,
    caseKey: row.case_key,
    requestId: row.request_id || null,
    riskLevel: row.risk_level,
    status: row.status,
    proposedBy: row.proposed_by,
    approvedBy: row.approved_by || null,
    idempotencyKey: row.idempotency_key,
    inputHash: row.input_hash,
    frozenInput: row.frozen_input || {},
    preview: row.preview || {},
    failureCode: row.failure_code || null,
    failureDetail: row.failure_detail || null,
    proposedAt: row.proposed_at,
    approvedAt: row.approved_at || null,
    executionStartedAt: row.execution_started_at || null,
    completedAt: row.completed_at || null,
  };
}

export async function getCompanyBrainActionPolicy(actionKeyInput: unknown) {
  const actionKey = cleanText(actionKeyInput, 80);
  const rows = await supabaseRequest<PolicyRow[]>("company_brain_action_policies", undefined, {
    select: "action_key,risk_level,minimum_role,approval_role,requires_four_eyes,customer_side_effect,description",
    action_key: `eq.${actionKey}`,
    active: "eq.true",
    limit: 1,
  });
  if (!rows[0]) {
    throw new QuoteValidationError("Aktion hat keine aktive Sicherheitsrichtlinie.", ["action_policy_missing"], 409);
  }
  return mapPolicy(rows[0]);
}

export function actorMeetsPolicy(actor: CompanyBrainActor, policy: CompanyBrainActionPolicy) {
  return actor.roles.includes(policy.minimumRole) || actor.roles.includes("company_admin");
}

export async function proposeCompanyBrainActionRun(input: {
  policy: CompanyBrainActionPolicy;
  actor: CompanyBrainActor;
  caseKey: string;
  requestId?: string | null;
  frozenInput: Record<string, unknown>;
  preview?: Record<string, unknown>;
}) {
  const caseKey = cleanText(input.caseKey, 300);
  if (!caseKey) throw new QuoteValidationError("Fallkennung fehlt.", ["case_key_required"], 422);
  const payload = { ...input.frozenInput };
  delete payload.operatorName;
  delete payload.approvalRunId;
  const inputHash = createHash("sha256").update(stableJson(payload)).digest("hex");
  const idempotencyKey = `company-brain-action:${input.policy.actionKey}:${caseKey}:${inputHash.slice(0, 32)}:v1`;
  const existing = await supabaseRequest<RunRow[]>("company_brain_action_runs", undefined, {
    select: RUN_SELECT,
    idempotency_key: `eq.${idempotencyKey}`,
    limit: 1,
  });
  if (existing[0]) return { run: mapRun(existing[0]), duplicate: true };

  const rows = await supabaseRequest<RunRow[]>("company_brain_action_runs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      action_key: input.policy.actionKey,
      case_key: caseKey,
      request_id: cleanText(input.requestId, 180) || null,
      risk_level: input.policy.riskLevel,
      status: input.policy.requiresFourEyes ? "awaiting_approval" : "proposed",
      proposed_by: input.actor.email,
      idempotency_key: idempotencyKey,
      input_hash: inputHash,
      frozen_input: payload,
      preview: input.preview || {},
      rollback_plan: input.policy.customerSideEffect
        ? "Keine automatische Kompensation. Belege sichern, Kundenkontakt stoppen und manuell eskalieren."
        : "Ausgangszustand anhand des Action-Run-Snapshots manuell wiederherstellen.",
    }),
  });
  if (!rows[0]) throw new QuoteValidationError("Freigabeauftrag konnte nicht gespeichert werden.", ["action_run_create_failed"], 409);
  return { run: mapRun(rows[0]), duplicate: false };
}

export async function getCompanyBrainActionRun(runIdInput: unknown) {
  const runId = cleanText(runIdInput, 60);
  const rows = await supabaseRequest<RunRow[]>("company_brain_action_runs", undefined, {
    select: RUN_SELECT,
    id: `eq.${runId}`,
    limit: 1,
  });
  if (!rows[0]) throw new QuoteValidationError("Freigabeauftrag nicht gefunden.", ["action_run_not_found"], 404);
  return mapRun(rows[0]);
}

export async function listCompanyBrainActionRuns(statusInput?: unknown, limitInput?: unknown) {
  const status = cleanText(statusInput, 40);
  const limit = Math.max(1, Math.min(Number(limitInput) || 50, 100));
  const rows = await supabaseRequest<RunRow[]>("company_brain_action_runs", undefined, {
    select: RUN_SELECT,
    ...(status ? { status: `eq.${status}` } : {}),
    order: "proposed_at.desc",
    limit,
  });
  return rows.map(mapRun);
}

export async function approveAndClaimCompanyBrainActionRun(input: {
  runId: unknown;
  actor: CompanyBrainActor;
  note?: unknown;
}) {
  const run = await getCompanyBrainActionRun(input.runId);
  const policy = await getCompanyBrainActionPolicy(run.actionKey);
  if (!policy.requiresFourEyes || !policy.approvalRole) {
    throw new QuoteValidationError("Aktion braucht keine Vier-Augen-Freigabe.", ["approval_not_required"], 409);
  }
  if (!input.actor.roles.includes(policy.approvalRole) && !input.actor.roles.includes("company_admin")) {
    throw new QuoteValidationError("Freigaberolle fehlt.", [`role_${policy.approvalRole}_required`], 403);
  }
  if (run.proposedBy === input.actor.email) {
    throw new QuoteValidationError("Vier-Augen-Prinzip verletzt.", ["approver_must_differ_from_proposer"], 409);
  }
  if (run.status !== "awaiting_approval") {
    throw new QuoteValidationError("Freigabeauftrag ist nicht mehr offen.", [`action_run_status_${run.status}`], 409);
  }

  const result = await supabaseRpc<RunRow | RunRow[]>("approve_company_brain_action_run", {
    p_action_run_id: run.id,
    p_actor: input.actor.email,
    p_note: cleanText(input.note, 2000) || null,
  });
  const claimed = Array.isArray(result) ? result[0] : result;
  if (!claimed) throw new QuoteValidationError("Freigabeauftrag wurde parallel verändert.", ["action_run_claim_conflict"], 409);
  return { run: mapRun(claimed), policy };
}

export async function completeCompanyBrainActionRun(input: {
  runId: string;
  status: "resolved" | "blocked" | "failed";
  result?: Record<string, unknown>;
  verification?: Record<string, unknown>;
  failureCode?: string | null;
  failureDetail?: string | null;
}) {
  const rows = await supabaseRequest<RunRow[]>("company_brain_action_runs", {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      status: input.status,
      execution_result: input.result || null,
      verification_result: input.verification || null,
      failure_code: cleanText(input.failureCode, 160) || null,
      failure_detail: cleanText(input.failureDetail, 4000) || null,
      completed_at: new Date().toISOString(),
    }),
  }, {
    id: `eq.${input.runId}`,
    status: "eq.executing",
  });
  return rows[0] ? mapRun(rows[0]) : null;
}
