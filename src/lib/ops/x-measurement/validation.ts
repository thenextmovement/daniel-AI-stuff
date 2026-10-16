import { createHash } from "node:crypto";

export const X_EVENT = "rhd5x";
export const MAX_AGE_MS = 30 * 86400000;
export const TOKEN = /^[A-Za-z0-9_-]{16,256}$/;
export const CLICK = /^[A-Za-z0-9._~-]{1,512}$/;
export function checkoutHash(value: unknown): string {
  if (typeof value !== "string" || !TOKEN.test(value)) throw new Error("invalid_checkout");
  return createHash("sha256").update("galaxybuzzdk:" + value).digest("hex");
}
export function orderId(value: unknown): string {
  const id = String(value ?? "").replace(/^gid:\/\/shopify\/Order\//, "");
  if (!/^[1-9][0-9]{5,19}$/.test(id)) throw new Error("invalid_order");
  return id;
}
function timestamp(value: unknown, now: number) {
  if (typeof value !== "string") throw new Error("invalid_time");
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time > now + 60000 || time < now - MAX_AGE_MS) throw new Error("invalid_time");
  return new Date(time).toISOString();
}
export function captureInput(value: unknown, now = Date.now()) {
  const input = value as Record<string, unknown>;
  if (!input || typeof input !== "object") throw new Error("invalid_input");
  const hash = checkoutHash(input.checkout_token);
  if (input.marketing_allowed === false) return { p_hash: hash, p_twclid: null, p_click_at: null, p_consent_at: null, p_revoke: true };
  if (input.marketing_allowed !== true || typeof input.twclid !== "string" || !CLICK.test(input.twclid)) throw new Error("missing_consent_or_click");
  return { p_hash: hash, p_twclid: input.twclid, p_click_at: timestamp(input.click_at, now), p_consent_at: timestamp(input.consent_at, now), p_revoke: false };
}

export function cents(value: unknown): number {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,7})(\.[0-9]{1,2})?$/.test(value)) throw new Error("invalid_amount");
  const [whole, fraction = ""] = value.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount)) throw new Error("invalid_amount");
  return amount;
}
type Money = { amount: string; currencyCode: string };
type Transaction = { id: string; status: string; kind: string; manualPaymentGateway: boolean; test: boolean; processedAt: string; amountSet: { shopMoney: Money } };
export type ShopifyProof = {
  rest: { id: string | number; checkout_token: string; financial_status: string; test: boolean; cancelled_at: string | null; total_price: string; currency: string };
  graphql: { errors?: unknown[]; data?: { order?: { id: string; displayFinancialStatus: string; test: boolean; cancelledAt: string | null; totalPriceSet: { shopMoney: Money }; totalReceivedSet: { shopMoney: Money }; transactions: Transaction[] } } };
};
export type BankProof = { paidAt: string; cents: number; currency: string };
export type PaidProof = { order_id: string; checkout_hash: string; amount_cents: number; currency: string; paid_at: string };

// Two authenticated Shopify reads must agree. A browser's checkout_completed is never payment proof.
export function paidProof(input: ShopifyProof, expectedId: string, bank?: BankProof, now = Date.now()): PaidProof | null {
  const r = input?.rest, g = input?.graphql?.data?.order;
  if (!r || !g || input.graphql.errors?.length || orderId(r.id) !== expectedId || orderId(g.id) !== expectedId) return null;
  if (r.test !== false || g.test !== false || r.cancelled_at !== null || g.cancelledAt !== null || r.financial_status !== "paid" || g.displayFinancialStatus !== "PAID") return null;
  // NEONTRIP settles in EUR. Unknown currencies fail closed instead of guessing a minor-unit exponent.
  if (r.currency !== "EUR" || g.totalPriceSet.shopMoney.currencyCode !== "EUR" || g.totalReceivedSet.shopMoney.currencyCode !== "EUR") return null;
  const amount = cents(r.total_price);
  if (amount <= 0 || amount !== cents(g.totalPriceSet.shopMoney.amount) || cents(g.totalReceivedSet.shopMoney.amount) < amount) return null;
  const transactions = g.transactions;
  if (!Array.isArray(transactions) || !transactions.length || transactions.length >= 100 || new Set(transactions.map(t => t.id)).size !== transactions.length) return null;
  if (transactions.some(t => t.test !== false || (t.kind === "REFUND" && t.status === "SUCCESS"))) return null;
  const payments = transactions.filter(t => t.status === "SUCCESS" && ["SALE", "CAPTURE"].includes(t.kind));
  if (!payments.length || payments.some(t => t.amountSet.shopMoney.currencyCode !== "EUR" || typeof t.manualPaymentGateway !== "boolean")) return null;
  const online = payments.filter(t => !t.manualPaymentGateway);
  const onlineTotal = online.reduce((sum, t) => sum + cents(t.amountSet.shopMoney.amount), 0);
  let paidAt: string;
  if (payments.some(t => t.manualPaymentGateway)) {
    if (!bank || bank.currency !== "EUR" || bank.cents + onlineTotal < amount) return null;
    paidAt = new Date(Math.max(Date.parse(bank.paidAt), ...online.map(t => Date.parse(t.processedAt)))).toISOString();
  } else {
    if (onlineTotal < amount) return null;
    paidAt = new Date(Math.max(...online.map(t => Date.parse(t.processedAt)))).toISOString();
  }
  return { order_id: expectedId, checkout_hash: checkoutHash(r.checkout_token), amount_cents: amount, currency: "EUR", paid_at: timestamp(paidAt, now) };
}

export function acceptedReceipt(value: unknown) {
  const v = value as { statusCode?: unknown; body?: { data?: { conversions_processed?: unknown; debug_id?: unknown }; errors?: unknown } };
  const debug = v?.body?.data?.debug_id;
  return v?.statusCode === 200 && !v.body?.errors && v.body?.data?.conversions_processed === 1 && typeof debug === "string" && /^[A-Za-z0-9_-]{8,160}$/.test(debug) ? debug : null;
}
