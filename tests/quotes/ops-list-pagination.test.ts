import test from "node:test";
import assert from "node:assert/strict";
import { listOpsInternalTasks } from "@/lib/ops/internal-tasks";
import { listCompanyDecisions, listCompanyDecisionOutcomes } from "@/lib/ops/company-brain-foundation";
import { listVoiceKnowledge, listVoiceKnowledgeCandidates } from "@/lib/ops/voice-knowledge";
import { listDesignJobs, readDesignJob } from "@/lib/ops/design";
import { listEuSupplierBoard } from "@/lib/ops/eu-supplier-store";

async function withDatabase(handler: (url: URL) => unknown, run: () => Promise<void>) {
  const fetch = globalThis.fetch;
  const previous = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY, OPS_INTERNAL_TASKS_USE_DEDICATED_TABLE: process.env.OPS_INTERNAL_TASKS_USE_DEDICATED_TABLE };
  process.env.SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  process.env.OPS_INTERNAL_TASKS_USE_DEDICATED_TABLE = "true";
  globalThis.fetch = (async (input, init) => {
    assert.equal(init?.method || "GET", "GET");
    return Response.json(handler(new URL(String(input))));
  }) as typeof globalThis.fetch;
  try { await run(); } finally {
    globalThis.fetch = fetch;
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}

for (const [name, table, run, statusColumn, status] of [
  ["tasks", "ops_internal_tasks", () => listOpsInternalTasks({ limit: 2, offset: 200, status: "done" }), "status", "done"],
  ["decisions", "company_decisions", () => listCompanyDecisions("approved", { limit: 2, offset: 200 }), "status", "approved"],
  ["outcomes", "company_decision_outcomes", () => listCompanyDecisionOutcomes("123e4567-e89b-42d3-a456-426614174000", { limit: 2, offset: 200, status: "met" }), "evaluation_status", "met"],
  ["knowledge", "voice_knowledge_review_overview", () => listVoiceKnowledge("retired", { limit: 2, offset: 200 }), "status", "retired"],
  ["candidates", "voice_knowledge_candidates", () => listVoiceKnowledgeCandidates("approved", { limit: 2, offset: 200 }), "status", "approved"],
  ["design jobs", "design_jobs", () => listDesignJobs({ status: "completed", limit: 2, offset: 200 }), "status", "completed"],
] as const) {
  test(`${name} exposes older filtered pages with a deterministic tie-breaker`, async () => {
    await withDatabase((url) => {
      assert.equal(url.pathname.split("/").at(-1), table);
      assert.equal(url.searchParams.get("offset"), "200");
      assert.equal(url.searchParams.get("limit"), "2");
      assert.equal(url.searchParams.get(statusColumn), `eq.${status}`);
      assert.match(url.searchParams.get("order") || "", /(?:^|,)id\.(?:asc|desc)$/);
      return [];
    }, async () => { assert.deepEqual(await run(), []); });
  });
}

test("invalid list pagination rejects before accessing the database", async () => {
  await withDatabase(() => { assert.fail("invalid pagination must not reach the database"); }, async () => {
    await assert.rejects(() => listOpsInternalTasks({ offset: -1 }), /offset/i);
    await assert.rejects(() => listDesignJobs({ limit: Number.NaN }), /limit/i);
    await assert.rejects(() => listVoiceKnowledge(undefined, { offset: 1.5 }), /offset/i);
  });
});

test("candidate all-status history is reachable while the default stays pending", async () => {
  const statuses: Array<string | null> = [];
  await withDatabase((url) => { statuses.push(url.searchParams.get("status")); return []; }, async () => {
    await listVoiceKnowledgeCandidates();
    await listVoiceKnowledgeCandidates("all", { offset: 100 });
  });
  assert.deepEqual(statuses, ["eq.pending", null]);
});

test("EU supplier children are scoped to the requested page and read beyond the old 1000-row cap", async () => {
  const calls: URL[] = [];
  await withDatabase((url) => {
    calls.push(url);
    const table = url.pathname.split("/").at(-1);
    if (table === "eu_supplier_requests") {
      assert.equal(url.searchParams.get("offset"), "100");
      assert.equal(url.searchParams.get("limit"), "2");
      assert.match(url.searchParams.get("order") || "", /,id\./);
      return [{ id: "request-101" }];
    }
    if (table === "eu_supplier_organizations") return [];
    assert.equal(url.searchParams.get("request_id"), "in.(request-101)");
    const offset = Number(url.searchParams.get("offset") || 0);
    const limit = Number(url.searchParams.get("limit"));
    const count = table === "eu_supplier_deliveries" ? 1003 : 1;
    return Array.from({ length: Math.max(0, Math.min(limit, count - offset)) }, (_, i) => ({ id: `${table}-${offset + i}`, request_id: "request-101" }));
  }, async () => {
    const board = await listEuSupplierBoard({ limit: 2, offset: 100 });
    assert.equal(board.items[0].deliveries.length, 1003);
    assert.equal(board.items[0].replies.length, 1);
    assert.equal(board.items[0].offers.length, 1);
  });
  assert.ok(calls.filter((url) => url.pathname.endsWith("/eu_supplier_deliveries")).length > 1);
});

test("task fallback applies canonical status before pagination across legacy rows", async () => {
  const rows = Array.from({ length: 154 }, (_, index) => ({
    id: `task-${index}`, request_id: "internal:test", task_type: "ops_internal_problem", status: "open", title: "Task", detail: null, due_at: null, priority_tier: "standard", assignee_label: null, source: "ops_internal", source_ref: null, payload: { ops_status: index < 151 ? "open" : "in_progress" }, created_at: "2026-10-29T10:00:00Z", updated_at: "2026-10-29T10:00:00Z", completed_at: null,
  }));
  await withDatabase((url) => {
    assert.ok(url.pathname.endsWith("/sales_tasks"));
    const offset = Number(url.searchParams.get("offset") || 0);
    return rows.slice(offset, offset + Number(url.searchParams.get("limit")));
  }, async () => {
    process.env.OPS_INTERNAL_TASKS_USE_DEDICATED_TABLE = "false";
    const tasks = await listOpsInternalTasks({ status: "in_progress", limit: 1, offset: 1 });
    assert.deepEqual(tasks.map((task) => task.id), ["task-152"]);
  });
});

test("EU supplier filters accept the canonical ordered and cancelled states", async () => {
  const statuses: string[] = [];
  await withDatabase((url) => { if (url.pathname.endsWith("/eu_supplier_requests")) statuses.push(url.searchParams.get("status") || ""); return []; }, async () => {
    await listEuSupplierBoard({ status: "ordered" });
    await listEuSupplierBoard({ status: "cancelled" });
    await assert.rejects(() => listEuSupplierBoard({ status: "closed" }), /status/i);
  });
  assert.deepEqual(statuses, ["eq.ordered", "eq.cancelled"]);
});

test("EU child pagination rejects a repeated page instead of returning an incomplete board", async () => {
  await withDatabase((url) => {
    if (url.pathname.endsWith("/eu_supplier_requests")) return [{ id: "request-1" }];
    if (!url.pathname.endsWith("/eu_supplier_deliveries")) return [];
    if (Number(url.searchParams.get("offset") || 0) > 1) throw new Error("unexpected third page");
    return [{ id: "delivery-1", request_id: "request-1" }];
  }, async () => { await assert.rejects(() => listEuSupplierBoard(), (error: any) => error.status === 409 && error.issues.includes("supplier_board_changed")); });
});


test("design job detail pages all assets with a stable cursor beyond the first twenty", async () => {
  await withDatabase((url) => {
    if (url.pathname.endsWith("/design_jobs")) return [{ id: "job-1", job_key: "test", status: "completed", created_at: "2026-10-29T00:00:00Z", updated_at: "2026-10-29T00:00:00Z" }];
    assert.ok(url.pathname.endsWith("/design_assets"));
    assert.equal(url.searchParams.get("job_id"), "eq.job-1");
    assert.match(url.searchParams.get("order") || "", /,id\./);
    const offset = Number(url.searchParams.get("offset") || 0);
    const limit = Number(url.searchParams.get("limit"));
    return Array.from({ length: Math.max(0, Math.min(limit, 23-offset)) }, (_, index) => ({ id: `asset-${offset+index}`, job_id: "job-1", metadata: {} }));
  }, async () => {
    const first = await readDesignJob("job-1");
    assert.equal(first.assets?.length, 20);
    assert.equal(first.assetsPagination?.nextOffset, 20);
    const last = await readDesignJob("job-1", { offset: 20, limit: 20 });
    assert.deepEqual(last.assets?.map((asset) => asset.id), ["asset-20", "asset-21", "asset-22"]);
    assert.equal(last.assetsPagination?.nextOffset, null);
  });
});
