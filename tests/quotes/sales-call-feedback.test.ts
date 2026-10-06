import assert from "node:assert/strict";
import test from "node:test";
import { getSalesCallFeedbackContext, recordSalesCallResult } from "../../src/lib/ops/customer-call-module";
import { feedbackRetryDate } from "../../src/lib/ops/sales-call-feedback-contract";

test("mail feedback is read-only until confirmation, rejects concurrent/stale writes and reports partial sync", async () => {
  const previousFetch = globalThis.fetch;
  const env = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_URL = "https://fixture.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-only";
  const requestId = "11111111-1111-4111-8111-111111111111";
  let result: Record<string, unknown> | null = null;
  let cadence: Record<string, unknown> | null = null;
  let rpcCount = 0;
  let failAudit = false;
  let unknownRpcOutcome = false;
  const writes: string[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  globalThis.fetch = (async (input, init = {}) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "fixture.example.test");
    const path = url.pathname.split("/").at(-1)!;
    const method = init.method || "GET";
    if (method !== "GET") writes.push(path);
    if (path === "ops_record_sales_call_result") {
      rpcCount++;
      const body = JSON.parse(String(init.body));
      if (body.p_expected_latest_result_id !== (result?.id || null)) return json({ ok: false, error: "stale_result" });
      result = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "p_expected_latest_result_id").map(([key, value]) => [key.slice(2), value]));
      Object.assign(result, { id: "22222222-2222-4222-8222-222222222222", created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      if (unknownRpcOutcome) throw new Error("fixture response lost after commit");
      return json({ ok: true, result });
    }
    if (method !== "GET") {
      if (path === "workflow_audit_log" && failAudit) return json({ error: "fixture audit unavailable" }, 400);
      const body = JSON.parse(String(init.body));
      if (path === "sales_call_cadence_state") cadence = { ...(Array.isArray(body) ? body[0] : body), updated_at: new Date().toISOString() };
      return json(Array.isArray(body) ? body.map((row) => ({ id: "fixture-row", ...row })) : [{ id: "fixture-row", ...body }]);
    }
    if (path === "master_customers") return json([{ id: "customer-a", request_id: requestId, email: "fixture@example.test", phone: "+4930123456", name: "Fixture", updated_at: "2026-09-01T10:00:00Z" }]);
    if (path === "master_requests") return json([{ id: "master-a", request_id: requestId, customer_id: "customer-a", status: "new", deal_status: "open", created_at: "2026-09-01T10:00:00Z", updated_at: "2026-09-01T10:00:00Z" }]);
    if (path === "sales_call_results") return json(result ? [result] : []);
    if (path === "sales_call_cadence_state") return json(cadence ? [cadence] : []);
    return json([]);
  }) as typeof fetch;
  try {
    const context = await getSalesCallFeedbackContext(requestId);
    assert.deepEqual(writes, []);
    const input = { requestId, preset: "not-reached" as const, notes: "Telefon klingelt, niemand erreicht.",
      callbackDate: feedbackRetryDate(0), expectedLatestResultId: null, postReminderDecision: "manual_followup" as const };
    const outcomes = await Promise.allSettled([
      recordSalesCallResult(input, { operatorName: "Fixture" }, { feedbackVersion: context.version }),
      recordSalesCallResult(input, { operatorName: "Fixture" }, { feedbackVersion: context.version }),
    ]);
    assert.equal(outcomes.filter((row) => row.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((row) => row.status === "rejected").length, 1);
    assert.equal((cadence as Record<string, unknown> | null)?.next_call_due_at, input.callbackDate);
    const callsAfterSave = rpcCount;
    await assert.rejects(recordSalesCallResult(input, {}, { feedbackVersion: context.version }));
    assert.equal(rpcCount, callsAfterSave);

    result = null; cadence = null; failAudit = true;
    const fresh = await getSalesCallFeedbackContext(requestId);
    const saved = await recordSalesCallResult(input, {}, { feedbackVersion: fresh.version });
    assert.ok("syncPending" in saved && saved.syncPending.includes("Protokoll"));
    assert.ok(saved.result.id);

    result = null; cadence = null; failAudit = false; unknownRpcOutcome = true;
    const beforeUnknown = await getSalesCallFeedbackContext(requestId);
    const beforeCount = rpcCount;
    await assert.rejects(recordSalesCallResult(input, {}, { feedbackVersion: beforeUnknown.version }));
    assert.equal(rpcCount, beforeCount + 1); // No POST retry.
    assert.ok((await getSalesCallFeedbackContext(requestId)).latestResult);
    await assert.rejects(recordSalesCallResult(input, {}, { feedbackVersion: beforeUnknown.version }));
    assert.equal(rpcCount, beforeCount + 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (env.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = env.url;
    if (env.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = env.key;
  }
});
