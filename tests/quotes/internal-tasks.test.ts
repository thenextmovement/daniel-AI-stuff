import test from "node:test";
import assert from "node:assert/strict";
import { createOpsInternalTask, summarizeOpsInternalTasks, type OpsInternalTask } from "@/lib/ops/internal-tasks";

function task(overrides: Partial<OpsInternalTask>): OpsInternalTask {
  return {
    id: "task-1",
    title: "Test task",
    description: null,
    status: "open",
    priority: "normal",
    category: "other",
    assigneeLabel: null,
    dueAt: null,
    requestId: null,
    customerName: null,
    customerEmail: null,
    trelloCardId: null,
    sourceApp: "test",
    sourceRef: null,
    createdBy: null,
    updatedBy: null,
    completedBy: null,
    completedAt: null,
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("summarizeOpsInternalTasks counts active urgent overdue and today tasks", () => {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const todayDate = new Date();
  todayDate.setHours(23, 59, 0, 0);
  const today = todayDate.toISOString();
  const summary = summarizeOpsInternalTasks([
    task({ id: "overdue", dueAt: yesterday, priority: "urgent" }),
    task({ id: "today", dueAt: today, priority: "high" }),
    task({ id: "done", status: "done", dueAt: yesterday, priority: "urgent" }),
  ]);

  assert.equal(summary.open, 2);
  assert.equal(summary.urgent, 2);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.dueToday, 1);
});

function salesTaskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sales-task-1",
    request_id: "internal:test",
    task_type: "ops_internal_problem",
    status: "open",
    title: "Inbound incident",
    detail: "Details",
    due_at: null,
    priority_tier: "important",
    assignee_label: null,
    source: "ops_internal",
    source_ref: "inbound_shipping_incident:incident-1",
    idempotency_key: "ops-internal-source:inbound_shipping_incident:incident-1",
    payload: {
      ops_status: "open",
      ops_priority: "high",
      category: "problem",
    },
    created_at: "2026-06-15T10:00:00.000Z",
    updated_at: "2026-06-15T10:00:00.000Z",
    completed_at: null,
    ...overrides,
  };
}

async function withMockedSupabase<T>(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>, callback: () => Promise<T>) {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    OPS_INTERNAL_TASKS_USE_DEDICATED_TABLE: process.env.OPS_INTERNAL_TASKS_USE_DEDICATED_TABLE,
  };
  process.env.SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  delete process.env.OPS_INTERNAL_TASKS_USE_DEDICATED_TABLE;
  globalThis.fetch = (async (input, init) => handler(new URL(String(input)), init)) as typeof fetch;

  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("createOpsInternalTask uses sourceRef as fallback idempotency key", async () => {
  let postedBody: Record<string, unknown> | null = null;

  await withMockedSupabase(async (_url, init) => {
    postedBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify([salesTaskRow(postedBody)]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }, async () => {
    const task = await createOpsInternalTask({
      title: "Inbound incident",
      category: "problem",
      priority: "high",
      sourceRef: "inbound_shipping_incident:incident-1",
    });

    assert.equal(task.id, "sales-task-1");
    assert.equal(postedBody?.idempotency_key, "ops-internal-source:inbound_shipping_incident:incident-1");
  });
});

test("createOpsInternalTask returns existing sourceRef task after idempotency conflict", async () => {
  const seen: string[] = [];

  await withMockedSupabase(async (url, init) => {
    seen.push(`${init?.method || "GET"} ${url.pathname} ${url.searchParams.get("source_ref") || ""}`);
    if (init?.method === "POST") {
      return new Response(JSON.stringify({ message: "duplicate key" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname.endsWith("/rest/v1/sales_tasks") && url.searchParams.get("source_ref") === "eq.inbound_shipping_incident:incident-1") {
      return new Response(JSON.stringify([salesTaskRow({ id: "existing-task" })]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }, async () => {
    const task = await createOpsInternalTask({
      title: "Inbound incident",
      category: "problem",
      priority: "high",
      sourceRef: "inbound_shipping_incident:incident-1",
    });

    assert.equal(task.id, "existing-task");
    assert.ok(seen.some((entry) => entry.includes("eq.inbound_shipping_incident:incident-1")));
  });
});
