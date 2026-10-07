import { supabaseRequest, supabaseRpc } from "@/lib/quotes/supabase-rest";
import { assessShopifyAutomationGate } from "./domain";
import { fetchShopifyDispatchEvidence } from "./clients";

export class ArrivalDispatchHeldError extends Error {
  constructor() { super("Aktuelle Shopify-Hinweise erfordern manuelle Versandbearbeitung."); this.name = "ArrivalDispatchHeldError"; }
}

// This runs before the existing dispatch RPC. A failed read never grants dispatch.
export async function assertArrivalDispatchAllowed(kind: "browser" | "print", jobId: string, workerId: string) {
  const rows = await supabaseRequest<{ id: string; case_id: string; shopify_order_id?: string; status: string; lease_expires_at: string | null }[]>(
    kind === "browser" ? "arrival_label_browser_purchase_jobs" : "arrival_label_print_jobs", undefined,
    { select: kind === "browser" ? "id,case_id,shopify_order_id,status,lease_expires_at" : "id,case_id,status,lease_expires_at", id: `eq.${jobId}`, lease_owner: `eq.${workerId}`, limit: 1 },
  );
  const job = rows[0];
  if (!job || !(kind === "browser" ? ["validated"] : ["claimed"]).includes(job.status)
    || !job.lease_expires_at || !(Date.parse(job.lease_expires_at) > Date.now())) throw new Error("Kein reservierter Auftrag vor Dispatch.");
  let orderId = job.shopify_order_id;
  if (kind === "print") {
    const cases = await supabaseRequest<{ shopify_order_id: string }[]>("arrival_label_cases", undefined,
      { select: "shopify_order_id", id: `eq.${job.case_id}`, limit: 1 });
    orderId = cases[0]?.shopify_order_id;
  }
  const order = await fetchShopifyDispatchEvidence(orderId || "");
  const gate = assessShopifyAutomationGate(order);
  if (!gate.blocked) return;
  await supabaseRpc("arrival_labels_hold_before_dispatch", {
    p_job_kind: kind, p_job_id: jobId, p_worker_id: workerId,
    p_reason: gate.reason, p_reason_codes: gate.reasonCodes,
  });
  throw new ArrivalDispatchHeldError();
}
