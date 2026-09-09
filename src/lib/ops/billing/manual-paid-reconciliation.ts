import { SupabaseRestError } from "@/lib/quotes/supabase-rest";

export const MANUAL_PAID_SCOPE = "MANUAL_SHOPIFY_PAID";
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => Boolean(value && typeof value === "object" && !Array.isArray(value));
const integer = (value: unknown, min: number, max: number) => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const text = (value: unknown, min: number, max: number) => typeof value === "string" && value.length >= min && value.length <= max;
const timestamp = (value: unknown) => typeof value === "string" && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const orderId = (value: unknown) => typeof value === "string" && /^[0-9]{1,30}$/.test(value);
const fingerprint = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export type ManualPaidCandidate = ObjectValue & {
  origin: "handoff" | "legacy_due";
  shopifyOrderId: string;
  shopifyOrderName: string;
};
export type ManualPaidClaimRequest = ObjectValue & {
  scope: typeof MANUAL_PAID_SCOPE;
  operation: "admit" | "claim";
  worker: string;
  executionId: string;
  jobTypes: ["RECONCILE"];
  candidates: ManualPaidCandidate[];
  leaseSeconds?: number;
};
export type ManualPaidCompletion = ObjectValue & {
  scope: typeof MANUAL_PAID_SCOPE;
  leaseToken: string;
  executionId: string;
  inputGeneration: number;
  inputFingerprint: string;
  bindingFingerprint: string;
  outcome: string;
};

// Missing/invalid raw Shopify revision is a cache miss, never a synthesized paid revision.
export function manualPaidSourceRevision(value: unknown): ObjectValue | null {
  if (!object(value) || !timestamp(value.updatedAt) || !text(value.financialStatus, 1, 50) ||
    !(value.cancelledAt === null || timestamp(value.cancelledAt)) || !integer(value.refundCount, 0, 1_000_000) ||
    typeof value.manualPaidObserved !== "boolean" || !text(value.paymentRoute, 1, 50)) return null;
  return { updatedAt: value.updatedAt, financialStatus: value.financialStatus, cancelledAt: value.cancelledAt,
    refundCount: value.refundCount, manualPaidObserved: value.manualPaidObserved, paymentRoute: value.paymentRoute };
}

export function validManualPaidClaim(value: unknown): value is ManualPaidClaimRequest {
  if (!object(value) || value.scope !== MANUAL_PAID_SCOPE || !["admit", "claim"].includes(String(value.operation)) ||
    !text(value.worker, 3, 120) || !orderId(value.executionId) ||
    !Array.isArray(value.jobTypes) || value.jobTypes.length !== 1 || value.jobTypes[0] !== "RECONCILE" ||
    (value.leaseSeconds !== undefined && !integer(value.leaseSeconds, 30, 600)) ||
    !Array.isArray(value.candidates) || value.candidates.length > 201) return false;
  const seen = new Set<string>();
  let handoffs = 0;
  let legacy = 0;
  for (const candidate of value.candidates) {
    if (!object(candidate) || !["handoff", "legacy_due"].includes(String(candidate.origin)) || !orderId(candidate.shopifyOrderId) ||
      typeof candidate.shopifyOrderName !== "string" || !/^#NEONT[0-9]+$/.test(candidate.shopifyOrderName)) return false;
    const key = `${candidate.origin}:${candidate.shopifyOrderId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (candidate.origin === "handoff") handoffs += 1;
    else {
      legacy += 1;
      if (!timestamp(candidate.firstSeenAt) || !timestamp(candidate.nextAttemptAt) || !integer(candidate.lockedUntil, 0, Number.MAX_SAFE_INTEGER)) return false;
    }
    if (candidate.amountCents != null && !integer(candidate.amountCents, 0, 999_999_999_999_999)) return false;
    if (candidate.currency != null && candidate.currency !== "EUR") return false;
    if (candidate.sourceEventId != null && !text(candidate.sourceEventId, 1, 300)) return false;
    if (candidate.sourceRevision != null && (!object(candidate.sourceRevision) || JSON.stringify(candidate.sourceRevision).length > 2000)) return false;
    if (candidate.legacyAlerts !== undefined) {
      if (!Array.isArray(candidate.legacyAlerts) || candidate.legacyAlerts.length > 200) return false;
      for (const alert of candidate.legacyAlerts) {
        if (!object(alert) || !text(alert.key, 3, 160) || !String(alert.key).startsWith(`${candidate.shopifyOrderId}|`) ||
          !/^[A-Za-z0-9_-]+$/.test(String(alert.key).slice(String(candidate.shopifyOrderId).length + 1)) ||
          !timestamp(alert.markedAt) || Date.parse(String(alert.markedAt)) > Date.now()) return false;
      }
    }
  }
  return handoffs <= 1 && legacy <= 200;
}

export function validManualPaidCompletion(value: unknown): value is ManualPaidCompletion {
  if (!object(value) || value.scope !== MANUAL_PAID_SCOPE || !text(value.leaseToken, 1, 100) || !orderId(value.executionId) ||
    !integer(value.inputGeneration, 1, 2_147_483_647) || !fingerprint(value.inputFingerprint) || !fingerprint(value.bindingFingerprint) ||
    !["EXACT_INVOICE_PAID", "NOT_MANUAL_PAID", "EASYBILL_PROJECTION_VERIFIED", "BILLING_PAYMENTS_REGISTERED", "REVIEW_REQUIRED", "OUTCOME_UNKNOWN", "EXECUTION_FAILED"].includes(String(value.outcome)) ||
    (value.reasonCode != null && !text(value.reasonCode, 1, 200))) return false;
  if (value.outcome === "EXACT_INVOICE_PAID") {
    const proof = value.proof;
    if (!object(proof) || !orderId(proof.easybillDocumentId) || !integer(proof.invoiceAmountCents, 1, 999_999_999_999_999) ||
      proof.invoiceAmountCents !== proof.paidCents || proof.invoiceAmountCents !== proof.expectedAmountCents ||
      proof.currency !== "EUR" || typeof proof.easybillNumber !== "string" || !/^#NEONT[0-9]+$/.test(proof.easybillNumber)) return false;
  }
  if (value.alert != null) {
    const alert = value.alert;
    if (!["REVIEW_REQUIRED", "OUTCOME_UNKNOWN"].includes(String(value.outcome)) || !object(alert) ||
      !text(alert.key, 3, 160) || !/^[0-9]{1,30}\|[A-Za-z0-9_-]+$/.test(String(alert.key)) ||
      !["ALREADY_MARKED", "GATE_SUPPRESSED", "SEND_ACCEPTED", "SENT_CONFIRMED", "UNKNOWN"].includes(String(alert.status))) return false;
    if (alert.status === "SEND_ACCEPTED" && (!object(alert.proof) || alert.proof.accepted !== true)) return false;
    if (alert.status === "SENT_CONFIRMED" && !text(alert.providerMessageId, 1, 1000)) return false;
  } else if (value.outcome === "REVIEW_REQUIRED") return false;
  return true;
}

export function manualPaidError(error: unknown) {
  let message = error instanceof Error ? error.message : "";
  if (error instanceof SupabaseRestError && typeof error.details === "string") {
    try { const details = JSON.parse(error.details); if (typeof details.message === "string") message = details.message; } catch { /* Keep provider detail private. */ }
  }
  const code = message.match(/\b(?:BILLING_JOB_(?:LEASE_INVALID|SCOPE_REQUIRED)|MANUAL_PAID_[A-Z_]+)\b/)?.[0];
  return { status: code?.startsWith("BILLING_JOB_") ? 409 : code ? 422 : 500, error: code || "manual_paid_operation_failed" };
}
