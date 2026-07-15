import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { GET as GET_FOUNDATION, POST as POST_ALIAS } from "@/app/api/ops/company-brain/foundation/route";
import { POST as POST_DECISION } from "@/app/api/ops/company-brain/decisions/route";
import {
  createCompanyDecisionDraft,
  reviewCompanyDecision,
  searchActiveCompanyDecisions,
  syncN8nWorkflowRegistry,
} from "@/lib/ops/company-brain-foundation";

const DECISION_ID = "123e4567-e89b-42d3-a456-426614174000";

test("foundation migrations stay private, append-only and reversible", () => {
  const foundation = readFileSync("supabase/migrations/20260715193000_create_company_brain_foundation.sql", "utf8");
  const decisions = readFileSync("supabase/migrations/20260715194500_create_company_decision_logbook.sql", "utf8");
  const functionHardening = readFileSync("supabase/migrations/20260715195500_harden_company_brain_function_search_path.sql", "utf8");
  const foundationRollback = readFileSync("supabase/rollbacks/20260715193000_create_company_brain_foundation_rollback.sql", "utf8");
  const decisionRollback = readFileSync("supabase/rollbacks/20260715194500_create_company_decision_logbook_rollback.sql", "utf8");
  const functionHardeningRollback = readFileSync("supabase/rollbacks/20260715195500_harden_company_brain_function_search_path_rollback.sql", "utf8");

  assert.match(foundation, /alter table public\.company_events enable row level security/i);
  assert.match(foundation, /grant select, insert on table public\.company_events to service_role/i);
  assert.doesNotMatch(foundation, /grant[^;]*company_events[^;]*(update|delete)/i);
  assert.match(decisions, /guard_company_decision_immutability/i);
  assert.match(decisions, /pg_advisory_xact_lock/i);
  assert.match(decisions, /revoke all on table public\.company_decisions from public, anon, authenticated/i);
  assert.match(foundation, /touch_company_brain_updated_at\(\)[\s\S]*set search_path = public/i);
  assert.match(decisions, /guard_company_decision_immutability\(\)[\s\S]*set search_path = public/i);
  assert.match(functionHardening, /alter function public\.touch_company_brain_updated_at\(\)[\s\S]*set search_path = public/i);
  assert.match(functionHardening, /alter function public\.guard_company_decision_immutability\(\)[\s\S]*set search_path = public/i);
  assert.match(foundationRollback, /drop table if exists public\.company_source_registry/i);
  assert.match(decisionRollback, /drop table if exists public\.company_decisions/i);
  assert.match(functionHardeningRollback, /reset search_path/i);
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function decisionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DECISION_ID,
    decision_key: "offer-send-policy",
    version_number: 3,
    decision_type: "policy",
    status: "draft",
    title: "Angebotsversand absichern",
    scope_type: "process",
    scope_key: "offer_send",
    owner_team: "sales",
    objective: "Doppelte oder unbelegte Angebotsversendungen sicher verhindern.",
    problem_statement: "Versandstatus und Retry-Sicherheit waren nicht immer eindeutig belegt.",
    context: "Angebotsversand nutzt mehrere Systeme und braucht korrelierte Belege.",
    constraints: ["Trello ist Projektion"],
    options: [{ key: "guarded", label: "Guarded Send" }],
    chosen_option: "guarded",
    rationale: "Der Guard prueft Duplikate vor jedem Side Effect.",
    assumptions: [],
    expected_outcomes: [],
    risks: [],
    guardrails: ["Kein Versand ohne Duplicate Check"],
    consequences: [],
    rollback_plan: "Feature deaktivieren.",
    supersedes_decision_id: null,
    decided_at: null,
    review_at: "2027-01-01T00:00:00.000Z",
    valid_from: null,
    valid_until: null,
    created_by: "daniel",
    submitted_by: null,
    submitted_at: null,
    approved_by: null,
    approved_at: null,
    review_note: null,
    created_at: "2026-07-15T18:00:00.000Z",
    updated_at: "2026-07-15T18:00:00.000Z",
    ...overrides,
  };
}

async function withSupabaseMock<T>(handler: (url: URL, init: RequestInit) => Promise<Response>, callback: () => Promise<T>) {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => handler(new URL(String(input)), init)) as typeof fetch;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
}

test("creates a governed decision draft through the atomic version RPC", async () => {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  await withSupabaseMock(async (url, init) => {
    const method = String(init.method || "GET").toUpperCase();
    calls.push({ method, path: url.pathname, body: init.body ? JSON.parse(String(init.body)) : null });
    assert.equal(url.pathname, "/rest/v1/rpc/create_company_decision_draft");
    return json([decisionRow()]);
  }, async () => {
    const result = await createCompanyDecisionDraft({
      decisionKey: "offer-send-policy",
      decisionType: "policy",
      title: "Angebotsversand absichern",
      scopeType: "process",
      scopeKey: "offer_send",
      ownerTeam: "sales",
      objective: "Doppelte oder unbelegte Angebotsversendungen sicher verhindern.",
      problemStatement: "Versandstatus und Retry-Sicherheit waren nicht immer eindeutig belegt.",
      context: "Angebotsversand nutzt mehrere Systeme und braucht korrelierte Belege.",
      constraints: ["Trello ist Projektion"],
      options: [{ key: "guarded", label: "Guarded Send" }],
      chosenOption: "guarded",
      rationale: "Der Guard prueft Duplikate vor jedem Side Effect.",
      guardrails: ["Kein Versand ohne Duplicate Check"],
      rollbackPlan: "Feature deaktivieren.",
      reviewAt: "2027-01-01T00:00:00.000Z",
      createdBy: "daniel",
    });
    assert.equal(result.versionNumber, 3);
  });
  assert.equal(calls.length, 1);
  const rpc = calls[0]?.body as { p_payload?: Record<string, unknown> };
  assert.equal(rpc.p_payload?.decision_key, "offer-send-policy");
  assert.equal(rpc.p_payload?.scope_key, "offer_send");
});

test("review actions use the atomic decision RPC", async () => {
  const rpcBodies: Array<Record<string, unknown>> = [];
  await withSupabaseMock(async (url, init) => {
    assert.equal(url.pathname, "/rest/v1/rpc/approve_company_decision");
    rpcBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return json(decisionRow({
      status: "approved",
      approved_by: "daniel",
      approved_at: "2026-07-15T18:10:00.000Z",
      decided_at: "2026-07-15T18:10:00.000Z",
      valid_from: "2026-07-15T18:10:00.000Z",
    }));
  }, async () => {
    const result = await reviewCompanyDecision({
      decisionId: DECISION_ID,
      action: "approve",
      actor: "daniel",
      note: "Fachlich freigegeben",
      correlationId: "decision:test:approve",
    });
    assert.equal(result.status, "approved");
    assert.equal(result.approvedBy, "daniel");
  });
  assert.equal(rpcBodies[0]?.p_decision_id, DECISION_ID);
  assert.equal(rpcBodies[0]?.p_correlation_id, "decision:test:approve");
});

test("active decision retrieval preserves guardrails and scope", async () => {
  await withSupabaseMock(async (url, init) => {
    assert.equal(url.pathname, "/rest/v1/rpc/search_active_company_decisions");
    const body = JSON.parse(String(init.body));
    assert.deepEqual(body.p_scopes, [{ scopeType: "process", scopeKey: "offer_send" }]);
    return json([decisionRow({ status: "approved" })]);
  }, async () => {
    const result = await searchActiveCompanyDecisions({
      scopes: [{ scopeType: "process", scopeKey: "offer_send" }],
    });
    assert.equal(result[0]?.scopeKey, "offer_send");
    assert.deepEqual(result[0]?.guardrails, ["Kein Versand ohne Duplicate Check"]);
  });
});

test("workflow registry sync paginates n8n and preserves explicit confirmation", async () => {
  const originalN8nUrl = process.env.N8N_API_URL;
  const originalN8nKey = process.env.N8N_API_KEY;
  process.env.N8N_API_URL = "https://n8n.example.test/api/v1";
  process.env.N8N_API_KEY = "n8n-test-key";
  let registryPayload: unknown[] = [];
  try {
    await withSupabaseMock(async (url, init) => {
      if (url.hostname === "n8n.example.test") {
        assert.equal(init.headers && (init.headers as Record<string, string>)["X-N8N-API-KEY"], "n8n-test-key");
        return json({
          data: [{
            id: "workflow-1",
            name: "Offer Send",
            active: true,
            versionId: "12",
            nodes: [{ type: "n8n-nodes-base.webhook" }, { type: "n8n-nodes-base.httpRequest" }],
          }],
          nextCursor: null,
        });
      }
      if (String(init.method || "GET").toUpperCase() === "GET") return json([]);
      registryPayload = JSON.parse(String(init.body));
      return new Response(null, { status: 204 });
    }, async () => {
      await assert.rejects(() => syncN8nWorkflowRegistry({ actor: "daniel" }), /bestaetigt/);
      const result = await syncN8nWorkflowRegistry({ confirmed: true, actor: "daniel" });
      assert.deepEqual(result, {
        syncedAt: result.syncedAt,
        total: 1,
        active: 1,
        aboveNodeLimit: 0,
      });
    });
  } finally {
    if (originalN8nUrl === undefined) delete process.env.N8N_API_URL;
    else process.env.N8N_API_URL = originalN8nUrl;
    if (originalN8nKey === undefined) delete process.env.N8N_API_KEY;
    else process.env.N8N_API_KEY = originalN8nKey;
  }
  const workflow = registryPayload[0] as Record<string, unknown>;
  assert.equal(workflow.external_workflow_id, "workflow-1");
  assert.equal(workflow.node_count, 2);
  assert.equal(workflow.trigger_count, 1);
});

test("foundation routes are private no-store and reject invalid alias input before fetch", async () => {
  const getRequest = new NextRequest("http://127.0.0.1:3100/api/ops/company-brain/foundation", {
    headers: { host: "127.0.0.1:3100" },
  });
  await withSupabaseMock(async (url) => {
    if (url.pathname.endsWith("company_source_registry")) return json([]);
    if (url.pathname.endsWith("company_correlation_contracts")) return json([]);
    if (url.pathname.endsWith("company_workflow_registry")) return json([]);
    if (url.pathname.endsWith("company_data_quality_issues")) return json([]);
    return json([], 404);
  }, async () => {
    const response = await GET_FOUNDATION(getRequest);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") || "", /no-store/);
    assert.match(response.headers.get("vary") || "", /Cookie/);
  });

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return json([]);
  }) as typeof fetch;
  try {
    const response = await POST_ALIAS(new NextRequest("http://127.0.0.1:3100/api/ops/company-brain/foundation", {
      method: "POST",
      headers: { host: "127.0.0.1:3100", "content-type": "application/json" },
      body: JSON.stringify({ sourceKey: "", aliasType: "request_id", aliasValue: "REQ-1" }),
    }));
    assert.equal(response.status, 422);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("decision routes ignore spoofed actors and use the authenticated Ops actor", async () => {
  let payload: { p_payload?: Record<string, unknown> } = {};
  await withSupabaseMock(async (url, init) => {
    assert.equal(url.pathname, "/rest/v1/rpc/create_company_decision_draft");
    payload = JSON.parse(String(init.body)) as { p_payload?: Record<string, unknown> };
    return json(decisionRow({ created_by: "local_ops" }));
  }, async () => {
    const response = await POST_DECISION(new NextRequest("http://127.0.0.1:3100/api/ops/company-brain/decisions", {
      method: "POST",
      headers: { host: "127.0.0.1:3100", "content-type": "application/json" },
      body: JSON.stringify({
        decisionKey: "offer-send-policy",
        decisionType: "policy",
        title: "Angebotsversand absichern",
        scopeType: "process",
        scopeKey: "offer_send",
        ownerTeam: "sales",
        objective: "Doppelte oder unbelegte Angebotsversendungen sicher verhindern.",
        problemStatement: "Versandstatus und Retry-Sicherheit waren nicht immer eindeutig belegt.",
        context: "Angebotsversand nutzt mehrere Systeme und braucht korrelierte Belege.",
        options: [{ key: "guarded", label: "Guarded Send" }],
        reviewAt: "2027-01-01T00:00:00.000Z",
        createdBy: "spoofed-user",
      }),
    }));
    assert.equal(response.status, 201);
  });
  assert.equal(payload.p_payload?.created_by, "local_ops");
});
