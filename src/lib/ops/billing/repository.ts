import { randomUUID } from "node:crypto";
import { supabaseRequest, supabaseRpc } from "@/lib/quotes/supabase-rest";
import { buildBillingCaseInput, derivePortalToken, portalTokenHash, type BillingIntake } from "./domain";

export type BillingCaseRow = {
  id: string;
  source_system: string;
  source_offer_id: string | null;
  source_acceptance_id: string | null;
  source_snapshot_hash: string;
  shopify_order_id: string;
  shopify_order_name: string;
  customer: Record<string, unknown>;
  customer_email: string | null;
  project_number: string | null;
  billing_address: Record<string, unknown>;
  delivery_address: Record<string, unknown>;
  line_items: unknown[];
  totals: Record<string, unknown>;
  currency: string;
  subtotal_net_cents: number;
  vat_cents: number;
  total_gross_cents: number;
  payment_method: "VORKASSE" | "KAUF_AUF_RECHNUNG";
  payment_terms_days: 7 | 14 | 30 | null;
  tax_treatment: string;
  tax_review_status: string;
  tax_exempt: boolean;
  vat_id: string | null;
  vat_validation: Record<string, unknown> | null;
  status: string;
  current_revision: number;
  portal_token_hash: string;
  portal_token_version: number;
  portal_revoked_at: string | null;
  paid_at: string | null;
  delivered_at: string | null;
  final_invoice_at: string | null;
  created_at: string;
  updated_at: string;
};

type IngestResult = { id: string; created: boolean; conflict: boolean; status: string };

function portalSecret() {
  const secret = String(process.env.BILLING_PORTAL_TOKEN_SECRET || "").trim();
  if (secret.length < 32) throw new Error("BILLING_PORTAL_TOKEN_SECRET ist nicht sicher konfiguriert.");
  return secret;
}

export function billingPortalUrl(token: string) {
  const base = String(process.env.BILLING_PORTAL_BASE_URL || "https://rechnung.neontrip.de").trim().replace(/\/+$/, "");
  return `${base}/${encodeURIComponent(token)}`;
}

export async function ingestBillingCase(input: BillingIntake) {
  const built = buildBillingCaseInput(input);
  const token = derivePortalToken({ secret: portalSecret(), shopifyOrderId: built.caseRecord.shopify_order_id });
  const portalUrl = billingPortalUrl(token);
  const result = await supabaseRpc<IngestResult>("billing_case_ingest_with_portal", {
    p_case: built.caseRecord,
    p_snapshot: built.snapshot,
    p_snapshot_hash: built.snapshotHash,
    p_source_event_id: input.sourceEventId,
    p_portal_token_hash: portalTokenHash(token),
    p_portal_url: portalUrl,
  });
  return { ...result, portalUrl };
}

export async function listBillingCases(input: { status?: string | null; query?: string | null; limit?: number } = {}) {
  const limit = Math.min(Math.max(Number(input.limit || 80), 1), 200);
  const query: Record<string, string | number> = {
    select: "id,shopify_order_id,shopify_order_name,customer_email,project_number,customer,billing_address,delivery_address,currency,total_gross_cents,payment_method,payment_terms_days,tax_treatment,tax_review_status,tax_exempt,vat_id,status,current_revision,paid_at,delivered_at,final_invoice_at,created_at,updated_at",
    order: "created_at.desc",
    limit,
  };
  if (input.status) query.status = `eq.${input.status}`;
  if (input.query) {
    const safe = input.query.trim().replace(/[(),]/g, "").slice(0, 100);
    query.or = `(shopify_order_name.ilike.*${safe}*,customer_email.ilike.*${safe}*,project_number.ilike.*${safe}*)`;
  }
  return supabaseRequest<BillingCaseRow[]>("billing_cases", undefined, query);
}

export async function getBillingCase(id: string) {
  const cases = await supabaseRequest<BillingCaseRow[]>("billing_cases", undefined, { select: "*", id: `eq.${id}`, limit: 1 });
  const billingCase = cases[0] || null;
  if (!billingCase) return null;
  const [documents, changes, events, incidents, payments] = await Promise.all([
    supabaseRequest<Record<string, unknown>[]>("billing_documents", undefined, { select: "*", billing_case_id: `eq.${id}`, order: "created_at.desc" }),
    supabaseRequest<Record<string, unknown>[]>("billing_change_requests", undefined, { select: "*", billing_case_id: `eq.${id}`, order: "created_at.desc" }),
    supabaseRequest<Record<string, unknown>[]>("billing_events", undefined, { select: "*", billing_case_id: `eq.${id}`, order: "created_at.desc", limit: 200 }),
    supabaseRequest<Record<string, unknown>[]>("billing_incidents", undefined, { select: "*", billing_case_id: `eq.${id}`, order: "created_at.desc" }),
    supabaseRequest<Record<string, unknown>[]>("billing_payments", undefined, { select: "*", billing_case_id: `eq.${id}`, order: "booked_at.desc" }),
  ]);
  return { billingCase, documents, changes, events, incidents, payments };
}

export async function getBillingPortal(token: string) {
  const hash = portalTokenHash(token);
  const cases = await supabaseRequest<BillingCaseRow[]>("billing_cases", undefined, {
    select: "id,shopify_order_name,customer_email,project_number,customer,billing_address,delivery_address,line_items,totals,currency,total_gross_cents,payment_method,payment_terms_days,tax_treatment,tax_review_status,tax_exempt,vat_id,status,current_revision,portal_revoked_at,paid_at,delivered_at,final_invoice_at,created_at,updated_at",
    portal_token_hash: `eq.${hash}`,
    portal_revoked_at: "is.null",
    limit: 1,
  });
  const billingCase = cases[0] || null;
  if (!billingCase) return null;
  const [documents, changes] = await Promise.all([
    supabaseRequest<Record<string, unknown>[]>("billing_documents", undefined, {
      select: "id,document_type,revision,document_number,status,finalized_at,sent_at,created_at",
      billing_case_id: `eq.${billingCase.id}`,
      order: "created_at.desc",
    }),
    supabaseRequest<Record<string, unknown>[]>("billing_change_requests", undefined, {
      select: "id,status,created_at,reviewed_at",
      billing_case_id: `eq.${billingCase.id}`,
      source: "eq.CUSTOMER_PORTAL",
      order: "created_at.desc",
    }),
  ]);
  return { billingCase, documents, changes, readOnly: Boolean(billingCase.final_invoice_at) };
}

export async function getBillingPortalDocument(token: string, documentId: string) {
  const cases = await supabaseRequest<Array<{ id: string }>>("billing_cases", undefined, {
    select: "id",
    portal_token_hash: `eq.${portalTokenHash(token)}`,
    portal_revoked_at: "is.null",
    limit: 1,
  });
  const billingCase = cases[0];
  if (!billingCase) return null;
  const documents = await supabaseRequest<Array<{ id: string; document_number: string; easybill_document_id: string | null; status: string }>>("billing_documents", undefined, {
    select: "id,document_number,easybill_document_id,status",
    id: `eq.${documentId}`,
    billing_case_id: `eq.${billingCase.id}`,
    limit: 1,
  });
  const document = documents[0] || null;
  return document?.easybill_document_id && ["FINALIZED", "SENT"].includes(document.status) ? document : null;
}

export async function submitBillingPortalChange(input: { token: string; changes: Record<string, unknown>; requesterEmail?: string | null; idempotencyKey?: string }) {
  return supabaseRpc<{ id: string; status: string; billingCaseId: string }>("billing_portal_submit_change", {
    p_portal_token_hash: portalTokenHash(input.token),
    p_idempotency_key: input.idempotencyKey || `portal:${randomUUID()}`,
    p_changes: input.changes,
    p_requester_email: input.requesterEmail || "",
  });
}

export type BillingOpsAction = "SET_PAYMENT_METHOD" | "CONFIRM_VAT" | "APPLY_CHANGE_REQUEST" | "REJECT_CHANGE_REQUEST" | "CREATE_PROFORMA" | "MARK_PAID" | "MARK_DELIVERED" | "CREATE_INVOICE";

export async function applyBillingOpsAction(input: {
  caseId: string;
  action: BillingOpsAction;
  payload?: Record<string, unknown>;
  actor: string;
  idempotencyKey: string;
}) {
  return supabaseRpc<Record<string, unknown>>("billing_case_apply_action", {
    p_case_id: input.caseId,
    p_action: input.action,
    p_payload: input.payload || {},
    p_actor: input.actor,
    p_idempotency_key: input.idempotencyKey,
  });
}

export async function claimBillingJob(worker: string, jobTypes: string[], leaseSeconds = 120) {
  return supabaseRpc<{ job: Record<string, unknown>; billingCase: BillingCaseRow } | null>("billing_job_claim", {
    p_worker: worker,
    p_job_types: jobTypes,
    p_lease_seconds: leaseSeconds,
  });
}

export async function completeBillingJob(input: {
  jobId: string;
  leaseToken: string;
  success: boolean;
  result?: Record<string, unknown>;
  error?: string | null;
}) {
  return supabaseRpc<Record<string, unknown>>("billing_job_complete", {
    p_job_id: input.jobId,
    p_lease_token: input.leaseToken,
    p_success: input.success,
    p_result: input.result || {},
    p_error: input.error || null,
  });
}

export async function ingestBillingPayment(input: {
  shopifyOrderId: string; provider: string; providerTransactionId: string; amountCents: number;
  currency: string; bookedAt: string; sourceEventId: string; evidence?: Record<string, unknown>;
}) {
  return supabaseRpc<Record<string, unknown>>("billing_payment_ingest", {
    p_shopify_order_id: input.shopifyOrderId, p_provider: input.provider,
    p_provider_transaction_id: input.providerTransactionId, p_amount_cents: input.amountCents,
    p_currency: input.currency, p_booked_at: input.bookedAt, p_source_event_id: input.sourceEventId,
    p_evidence: input.evidence || {},
  });
}

export async function ingestBillingShopifyEvent(input: {
  shopifyOrderId: string; eventId: string; eventType: "ORDER_DELIVERED" | "ORDER_CANCELLED" | "REFUND_CREATED";
  amountCents?: number; netCents?: number; vatCents?: number; currency?: string; occurredAt?: string;
  payload?: Record<string, unknown>;
}) {
  return supabaseRpc<Record<string, unknown>>("billing_shopify_event_ingest", {
    p_shopify_order_id: input.shopifyOrderId, p_event_id: input.eventId, p_event_type: input.eventType,
    p_amount_cents: input.amountCents || 0, p_net_cents: input.netCents || 0, p_vat_cents: input.vatCents || 0,
    p_currency: input.currency || "EUR", p_occurred_at: input.occurredAt || new Date().toISOString(),
    p_payload: input.payload || {},
  });
}
