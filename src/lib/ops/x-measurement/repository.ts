import { supabaseRequest, supabaseRpc } from "@/lib/quotes/supabase-rest";
import { acceptedReceipt, checkoutHash, orderId, paidProof, type BankProof, type ShopifyProof } from "./validation";

async function bankProof(id: string): Promise<BankProof | undefined> {
  const cases = await supabaseRequest<Array<{ id: string; currency: string; paid_at: string; cancelled_at: string | null; refunded_at: string | null }>>("billing_cases", {}, {
    select: "id,currency,paid_at,cancelled_at,refunded_at", or: `(shopify_order_id.eq.${id},shopify_order_id.eq.gid://shopify/Order/${id})`, limit: 2,
  });
  const c = cases[0];
  if (cases.length !== 1 || !c.paid_at || c.currency !== "EUR" || c.cancelled_at || c.refunded_at) return;
  const payments = await supabaseRequest<Array<{ amount_cents: number; currency: string; booked_at: string; provider_transaction_id: string }>>("billing_payments", {}, {
    select: "amount_cents,currency,booked_at,provider_transaction_id", billing_case_id: `eq.${c.id}`, provider: "eq.QONTO", match_status: "in.(MATCHED,PARTIAL,OVERPAID)", limit: 100,
  });
  if (!payments.length || payments.length >= 100 || payments.some(p => !p.provider_transaction_id || p.currency !== "EUR" || !p.booked_at || !Number.isSafeInteger(Number(p.amount_cents)) || Number(p.amount_cents) <= 0)) return;
  if (new Set(payments.map(p => p.provider_transaction_id)).size !== payments.length) return;
  return { cents: payments.reduce((sum, p) => sum + Number(p.amount_cents), 0), currency: "EUR", paidAt: new Date(Math.max(...payments.map(p => Date.parse(p.booked_at)))).toISOString() };
}

function jobArgs(input: Record<string, unknown>) {
  const job = input.job as Record<string, unknown>;
  if (!job || typeof job.checkout_hash !== "string" || !/^[a-f0-9]{64}$/.test(job.checkout_hash) || typeof job.lease_id !== "string" || !/^[a-f0-9-]{36}$/i.test(job.lease_id)) throw new Error("invalid_job");
  return { p_hash: job.checkout_hash, p_lease: job.lease_id };
}

export async function handleXWorker(input: Record<string, unknown>) {
  switch (input.action) {
    case "pending": return { pending: await supabaseRpc<boolean>("x_ads_pending") };
    case "associate": {
      if (!Array.isArray(input.orders) || input.orders.length > 10000) throw new Error("invalid_orders");
      const orders = input.orders.flatMap(value => {
        try { return [{ hash: checkoutHash(value.checkout_token), id: orderId(value.id) }]; } catch { return []; }
      });
      await supabaseRpc("x_ads_associate", { p_orders: orders });
      return { ok: true };
    }
    case "claim": return { job: await supabaseRpc("x_ads_claim") };
    case "prepare": {
      const args = jobArgs(input);
      const job = input.job as Record<string, unknown>;
      const proof = input.proof as ShopifyProof;
      const id = orderId(job.order_id);
      const manual = proof?.graphql?.data?.order?.transactions?.some(t => t.manualPaymentGateway === true);
      const bank = manual ? await bankProof(id) : undefined;
      let payment = null;
      try { payment = paidProof(proof, id, bank); } catch { /* Incomplete/malformed payment proof is not a conversion. */ }
      const payload = payment ? await supabaseRpc("x_ads_prepare", { ...args, p_payment: payment }) : null;
      if (!payload) await supabaseRpc("x_ads_finish", { ...args, p_debug: null, p_reason: "payment_unconfirmed" });
      return { ready: Boolean(payload), payload };
    }
    case "receipt": {
      const args = jobArgs(input);
      const debug = acceptedReceipt(input.response);
      const status = Number((input.response as { statusCode?: unknown })?.statusCode);
      const rejected = status >= 400 && status < 500 && ![408,409,425,429].includes(status);
      await supabaseRpc("x_ads_finish", { ...args, p_debug: debug, p_reason: rejected ? "x_rejected" : "x_unconfirmed" });
      return { accepted_by_x: Boolean(debug) };
    }
    default: throw new Error("invalid_action");
  }
}
