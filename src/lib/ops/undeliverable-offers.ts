import { supabaseRequest, supabaseRpc } from "@/lib/quotes/supabase-rest";

export type BounceFailureKind = "domain_not_found" | "mailbox_not_found" | "policy_rejected" | "temporary" | "unknown";
export type UndeliverableStatus = "detected" | "needs_research" | "manual_review" | "approved" | "processing" | "sent" | "failed" | "unknown" | "dismissed";

export type CandidateEvidence = {
  type: "customer_supplied" | "verified_company_website" | "existing_verified_contact" | "directory" | "ai_suggestion";
  value: string;
  sourceUrl?: string;
  observedAt: string;
};

export type UndeliverableOfferCase = {
  id: string;
  status: UndeliverableStatus;
  source_message_id: string;
  source_internet_message_id: string | null;
  mailbox: string;
  received_at: string;
  failed_email: string;
  failure_kind: BounceFailureKind;
  diagnostic_code: string | null;
  offer_id: string | null;
  offer_number: string | null;
  request_id: string | null;
  proposed_email: string | null;
  confidence: number | null;
  evidence: CandidateEvidence[];
  automatic_eligible: boolean;
  approved_by: string | null;
  approved_at: string | null;
  attempt_count: number;
  provider_message_id: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OFFER_NUMBER = /(?:A\/?N\s*)?(\d{4,10})/i;

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function classifyBounce(input: { diagnosticCode?: string | null; diagnosticText?: string | null }): BounceFailureKind {
  const value = `${input.diagnosticCode || ""} ${input.diagnosticText || ""}`.toLowerCase();
  if (/5\.4\.310|domain.*does not exist|domain.*not.*found|domainnonexistent|nxdomain/.test(value)) return "domain_not_found";
  if (/5\.1\.1|recipient.*not.*found|mailbox.*not.*found|unknown recipient|user unknown/.test(value)) return "mailbox_not_found";
  if (/4\.\d\.\d|temporar|try again|throttl|timeout/.test(value)) return "temporary";
  if (/5\.7\.\d|policy|blocked|reject/.test(value)) return "policy_rejected";
  return "unknown";
}

export function extractOfferNumber(subject: string) {
  return OFFER_NUMBER.exec(subject)?.[1] || null;
}

export function validateCandidate(input: { failedEmail: string; proposedEmail: string; confidence: number; evidence: CandidateEvidence[] }) {
  const failedEmail = normalizeEmail(input.failedEmail);
  const proposedEmail = normalizeEmail(input.proposedEmail);
  const reasons: string[] = [];
  if (!EMAIL.test(proposedEmail)) reasons.push("invalid_email");
  if (failedEmail === proposedEmail) reasons.push("unchanged_email");
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) reasons.push("invalid_confidence");
  if (!Array.isArray(input.evidence) || input.evidence.length < 1 || input.evidence.length > 10) reasons.push("missing_evidence");
  for (const evidence of input.evidence || []) {
    if (!evidence.value?.trim() || !evidence.observedAt || Number.isNaN(Date.parse(evidence.observedAt))) reasons.push("invalid_evidence");
    if (evidence.sourceUrl && !/^https:\/\//i.test(evidence.sourceUrl)) reasons.push("unsafe_source_url");
  }
  const strongEvidence = input.evidence.some((item) => ["customer_supplied", "existing_verified_contact"].includes(item.type));
  const weakOnly = input.evidence.every((item) => ["directory", "ai_suggestion"].includes(item.type));
  const automaticEligible = reasons.length === 0 && input.confidence === 1 && strongEvidence && !weakOnly;
  return { valid: reasons.length === 0, reasons: [...new Set(reasons)], automaticEligible, failedEmail, proposedEmail };
}

export async function listUndeliverableOfferCases(input: { status?: UndeliverableStatus | "all"; limit?: number } = {}) {
  const query: Record<string, string | number> = {
    select: "id,status,source_message_id,source_internet_message_id,mailbox,received_at,failed_email,failure_kind,diagnostic_code,offer_id,offer_number,request_id,proposed_email,confidence,evidence,automatic_eligible,approved_by,approved_at,attempt_count,provider_message_id,failure_reason,created_at,updated_at",
    order: "received_at.desc",
    limit: Math.max(1, Math.min(250, Math.trunc(input.limit || 100))),
  };
  if (input.status && input.status !== "all") query.status = `eq.${input.status}`;
  return supabaseRequest<UndeliverableOfferCase[]>("undeliverable_offer_cases", undefined, query);
}

export async function ingestUndeliverableOffer(input: {
  sourceMessageId: string; sourceInternetMessageId?: string | null; mailbox: string; receivedAt: string;
  failedEmail: string; diagnosticCode?: string | null; diagnosticText?: string | null; subject: string;
  offerId?: string | null; requestId?: string | null; correlationId: string;
}) {
  if (!input.sourceMessageId.trim() || input.sourceMessageId.length > 500 || !EMAIL.test(normalizeEmail(input.failedEmail))) throw new Error("invalid_bounce_input");
  if (!EMAIL.test(normalizeEmail(input.mailbox)) || Number.isNaN(Date.parse(input.receivedAt)) || !UUID.test(input.correlationId)) throw new Error("invalid_bounce_input");
  return supabaseRpc("ingest_undeliverable_offer_v1", {
    p_source_message_id: input.sourceMessageId, p_source_internet_message_id: input.sourceInternetMessageId || null,
    p_mailbox: normalizeEmail(input.mailbox), p_received_at: input.receivedAt, p_failed_email: normalizeEmail(input.failedEmail),
    p_failure_kind: classifyBounce(input), p_diagnostic_code: input.diagnosticCode || null,
    p_diagnostic_excerpt: String(input.diagnosticText || "").slice(0, 2000), p_subject: input.subject.slice(0, 500),
    p_offer_id: input.offerId || null, p_offer_number: extractOfferNumber(input.subject), p_request_id: input.requestId || null,
    p_correlation_id: input.correlationId,
  });
}

export async function proposeUndeliverableCandidate(input: { caseId: string; proposedEmail: string; confidence: number; evidence: CandidateEvidence[]; actor: string; idempotencyKey: string }) {
  const rows = await supabaseRequest<Array<{ failed_email: string }>>("undeliverable_offer_cases", undefined, { select: "failed_email", id: `eq.${input.caseId}`, limit: 1 });
  if (!rows[0]) throw new Error("case_not_found");
  const checked = validateCandidate({ failedEmail: rows[0].failed_email, proposedEmail: input.proposedEmail, confidence: input.confidence, evidence: input.evidence });
  if (!checked.valid) throw new Error(`invalid_candidate:${checked.reasons.join(",")}`);
  return supabaseRpc("propose_undeliverable_offer_email_v1", {
    p_case_id: input.caseId, p_proposed_email: checked.proposedEmail, p_confidence: input.confidence,
    p_evidence: input.evidence, p_automatic_eligible: checked.automaticEligible, p_actor: input.actor, p_idempotency_key: input.idempotencyKey,
  });
}

export async function reviewUndeliverableCase(input: { caseId: string; decision: "approve" | "dismiss"; note: string; actor: string; idempotencyKey: string }) {
  return supabaseRpc("review_undeliverable_offer_v1", {
    p_case_id: input.caseId, p_decision: input.decision, p_note: input.note,
    p_actor: input.actor, p_idempotency_key: input.idempotencyKey,
  });
}
