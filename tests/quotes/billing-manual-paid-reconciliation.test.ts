import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as claim } from "@/app/api/internal/billing/jobs/claim/route";
import { POST as complete } from "@/app/api/internal/billing/jobs/[jobId]/complete/route";
import { validManualPaidClaim, validManualPaidCompletion, manualPaidSourceRevision } from "@/lib/ops/billing/manual-paid-reconciliation";

const base = { scope: "MANUAL_SHOPIFY_PAID", operation: "claim", worker: "manual-paid-test", executionId: "42", jobTypes: ["RECONCILE"], candidates: [] };
const candidate = { origin: "handoff", shopifyOrderId: "8000", shopifyOrderName: "#NEONT8000", amountCents: 1000, currency: "EUR" };
const completion = { scope: "MANUAL_SHOPIFY_PAID", leaseToken: "owned-token", executionId: "42", inputGeneration: 1,
  inputFingerprint: "a".repeat(64), bindingFingerprint: "b".repeat(64), outcome: "REVIEW_REQUIRED",
  alert: { status: "SEND_ACCEPTED", key: "8000|tx-1", proof: { accepted: true } } };

test("scoped request validates complete bounded intake without silent truncation", () => {
  assert.equal(validManualPaidClaim({ ...base, candidates: [candidate] }), true);
  assert.equal(validManualPaidClaim({ ...base, operation: "admit" }), true);
  for (const invalid of [{ ...base, operation: undefined }, { ...base, scope: "OTHER" }, { ...base, leaseSeconds: -1 }, { ...base, leaseSeconds: 120.5 }, { ...base, jobTypes: ["RECONCILE", "CREATE_INVOICE"] }, { ...base, candidates: [candidate, candidate] }]) {
    assert.equal(validManualPaidClaim(invalid), false);
  }
  const legacy = Array.from({ length: 200 }, (_, i) => ({ ...candidate, origin: "legacy_due", shopifyOrderId: String(9000+i), nextAttemptAt: "2026-01-01T00:00:00Z", firstSeenAt: "2026-01-01T00:00:00Z", lockedUntil: 0 }));
  assert.equal(validManualPaidClaim({ ...base, candidates: [candidate, ...legacy] }), true);
  assert.equal(validManualPaidClaim({ ...base, candidates: [candidate, ...legacy, { ...candidate, origin: "legacy_due", shopifyOrderId: "99999" }] }), false);
  assert.equal(validManualPaidClaim({ ...base, candidates: [{ ...candidate, legacyAlerts: [{ key: "9999|tx-1", markedAt: "2026-01-01T00:00:00Z" }] }] }), false);
});

test("Outlook acceptance requires the direct true result, not an invented message ID", () => {
  assert.equal(validManualPaidCompletion(completion), true);
  assert.equal(validManualPaidCompletion({ ...completion, alert: { status: "SEND_ACCEPTED", key: "8000|tx-1" } }), false);
  assert.equal(validManualPaidCompletion({ ...completion, alert: null }), false);
  assert.equal(validManualPaidCompletion({ ...completion, alert: { status: "UNKNOWN", key: "8000|tx-1" } }), true);
  const paid = { ...completion, outcome: "EXACT_INVOICE_PAID", alert: null, proof: { easybillDocumentId: "123", easybillNumber: "#NEONT8000", invoiceAmountCents: 1000, expectedAmountCents: 1000, paidCents: 1000, currency: "EUR" } };
  assert.equal(validManualPaidCompletion(paid), true);
  assert.equal(validManualPaidCompletion({ ...paid, proof: { ...paid.proof, paidCents: 999 } }), false);
});

test("existing authenticated routes dispatch only the explicit scope and never retry POST", async () => {
  const saved = { fetch: globalThis.fetch, token: process.env.BILLING_WORKER_API_TOKEN, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.BILLING_WORKER_API_TOKEN = "isolated-worker-token-123456789";
  process.env.SUPABASE_URL = "https://isolated.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "isolated-service-key";
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  let mode = "success";
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    if (mode === "scope") return new Response(JSON.stringify({ message: "BILLING_JOB_SCOPE_REQUIRED" }), { status: 400 });
    if (mode === "lease") return new Response(JSON.stringify({ message: "BILLING_JOB_LEASE_INVALID", details: "private detail" }), { status: 400 });
    if (mode === "unknown") throw new Error("private transport detail");
    return new Response(JSON.stringify({ ok: true, intake: [], claimed: null, legacySelected: null }));
  };
  const request = (body: unknown, authorized = true) => new NextRequest("https://isolated.invalid/api/internal/billing/jobs/claim", { method: "POST", headers: { "content-type": "application/json", ...(authorized ? { authorization: "Bearer isolated-worker-token-123456789" } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await claim(request(base, false))).status, 401);
    assert.equal(calls.length, 0);
    assert.equal((await claim(request({ ...base, scope: "UNKNOWN" }))).status, 422);
    assert.equal(calls.length, 0);
    assert.equal((await claim(request(base))).status, 200);
    assert.match(calls.at(-1)!.url, /\/rpc\/billing_manual_paid_claim$/);
    assert.deepEqual(calls.at(-1)!.body, { p_request: base });
    assert.equal((await claim(request({ worker: "generic", jobTypes: ["RECONCILE"] }))).status, 200);
    assert.match(calls.at(-1)!.url, /\/rpc\/billing_job_claim$/);
    mode = "lease";
    const response = await complete(request(completion), { params: Promise.resolve({ jobId: "00000000-0000-4000-8000-000000000001" }) });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { ok: false, error: "BILLING_JOB_LEASE_INVALID" });
    assert.match(calls.at(-1)!.url, /\/rpc\/billing_manual_paid_complete$/);
    mode = "scope";
    const genericScope = await complete(request({ leaseToken: "owned-token", success: true }), { params: Promise.resolve({ jobId: "00000000-0000-4000-8000-000000000001" }) });
    assert.equal(genericScope.status, 409);
    assert.deepEqual(await genericScope.json(), { ok: false, error: "BILLING_JOB_SCOPE_REQUIRED" });
    mode = "unknown";
    const before = calls.length;
    const unknown = await complete(request(completion), { params: Promise.resolve({ jobId: "00000000-0000-4000-8000-000000000001" }) });
    assert.equal(unknown.status, 500);
    assert.deepEqual(await unknown.json(), { ok: false, error: "manual_paid_operation_failed" });
    assert.equal(calls.length, before + 1);
  } finally {
    globalThis.fetch = saved.fetch;
    for (const [name, value] of Object.entries({ BILLING_WORKER_API_TOKEN: saved.token, SUPABASE_URL: saved.url, SUPABASE_SERVICE_ROLE_KEY: saved.key })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});


test("2B raw revision keeps only complete source facts and never invents defaults", () => {
  const source = { updatedAt: "2026-09-01T00:00:00Z", financialStatus: "paid", cancelledAt: null, refundCount: 0, manualPaidObserved: true, paymentRoute: "VORKASSE" };
  assert.deepEqual(manualPaidSourceRevision({ ...source, requestedAt: "volatile", executionId: "volatile" }), source);
  for (const key of Object.keys(source)) {
    const partial: Record<string, unknown> = { ...source };
    delete partial[key];
    assert.equal(manualPaidSourceRevision(partial), null);
  }
  assert.equal(manualPaidSourceRevision({ ...source, updatedAt: "not-a-date" }), null);
  assert.equal(manualPaidSourceRevision({ ...source, refundCount: -1 }), null);
  assert.equal(manualPaidSourceRevision({ ...source, refundCount: 0.5 }), null);
  assert.equal(manualPaidSourceRevision({ ...source, manualPaidObserved: "true" }), null);
});
