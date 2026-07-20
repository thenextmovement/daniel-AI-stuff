import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  approveAndClaimCompanyBrainActionRun,
  proposeCompanyBrainActionRun,
  type CompanyBrainActionPolicy,
} from "@/lib/ops/company-brain-action-governance";
import {
  correlateCompanyBrainResult,
  reviewCompanyIdentity,
} from "@/lib/ops/company-brain-identity";
import type { CompanyBrainResolveResult } from "@/lib/ops/company-brain";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function withSupabaseMock<T>(
  handler: (url: URL, init: RequestInit) => Promise<Response>,
  callback: () => Promise<T>,
) {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) =>
    handler(new URL(String(input)), init)) as typeof fetch;
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

const guardedSendPolicy: CompanyBrainActionPolicy = {
  actionKey: "guarded_offer_resend",
  riskLevel: "critical",
  minimumRole: "operator",
  approvalRole: "approver",
  requiresFourEyes: true,
  customerSideEffect: true,
  description: "Guarded send",
};

test("governance migration keeps action and identity control tables private and reversible", () => {
  const migration = readFileSync(
    "supabase/migrations/20260716133401_company_brain_action_governance_identity_review.sql",
    "utf8",
  );
  const rollback = readFileSync(
    "supabase/rollbacks/20260716133401_company_brain_action_governance_identity_review_rollback.sql",
    "utf8",
  );
  assert.match(migration, /company_brain_action_runs enable row level security/i);
  assert.match(migration, /revoke all on table public\.company_brain_action_runs from public, anon, authenticated/i);
  assert.match(migration, /guard_company_brain_action_run_input/i);
  assert.match(migration, /company_brain_four_eyes_required/i);
  assert.match(migration, /approve_company_brain_action_run[\s\S]*for update/i);
  assert.match(migration, /guarded_offer_resend[\s\S]*true, true/i);
  assert.match(rollback, /drop table if exists public\.company_brain_action_runs/i);
  assert.match(rollback, /drop table if exists public\.company_identity_review_queue/i);
});

test("workflow incident reconciliation is event driven, private and reversible", () => {
  const migration = readFileSync(
    "supabase/migrations/20260720162224_company_brain_workflow_incident_reconciliation.sql",
    "utf8",
  );
  const rollback = readFileSync(
    "supabase/rollbacks/20260720162224_company_brain_workflow_incident_reconciliation_rollback.sql",
    "utf8",
  );

  assert.match(migration, /after insert on public\.workflow_audit_log/i);
  assert.match(migration, /preview_media_invalid/i);
  assert.match(migration, /initial_delivery_complete/i);
  assert.match(migration, /preserve_company_brain_specific_workflow_cause/i);
  assert.match(migration, /revoke all on function public\.reconcile_company_brain_workflow_incident_from_audit\(\) from public, anon, authenticated/i);
  assert.match(rollback, /drop trigger if exists trg_reconcile_company_brain_workflow_incident/i);
  assert.match(rollback, /drop function if exists public\.preserve_company_brain_specific_workflow_cause/i);
});

test("closed-loop workflow attempts are event driven, private, serialized and reversible", () => {
  const migration = readFileSync(
    "supabase/migrations/20260720185649_company_brain_closed_loop_control.sql",
    "utf8",
  );
  const rollback = readFileSync(
    "supabase/rollbacks/20260720185649_company_brain_closed_loop_control_rollback.sql",
    "utf8",
  );

  assert.match(migration, /create table if not exists public\.company_brain_workflow_attempts/i);
  assert.match(migration, /after insert on public\.workflow_audit_log/i);
  assert.match(migration, /after insert or update on public\.preview_delivery_jobs/i);
  assert.match(migration, /company_brain_workflow_attempts enable row level security/i);
  assert.match(migration, /revoke all on table public\.company_brain_workflow_attempts from public, anon, authenticated/i);
  assert.match(migration, /retry_media_pipeline[\s\S]*'critical'[\s\S]*true, true/i);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(action_run\.case_key, 0\)\)/i);
  assert.match(migration, /company_brain_case_action_busy/i);
  assert.match(migration, /missing_terminal_event/i);
  assert.match(rollback, /drop table if exists public\.company_brain_workflow_attempts/i);
  assert.match(rollback, /delete from public\.company_brain_action_policies where action_key = 'retry_media_pipeline'/i);
});

test("workflow audit status contract accepts lifecycle events and has a reversible rollback", () => {
  const migration = readFileSync(
    "supabase/migrations/20260720192300_workflow_audit_status_contract.sql",
    "utf8",
  );
  const rollback = readFileSync(
    "supabase/rollbacks/20260720192300_workflow_audit_status_contract_rollback.sql",
    "utf8",
  );

  for (const status of ["queued", "running", "retry_scheduled", "failed", "blocked", "sent"]) {
    assert.match(migration, new RegExp(`'${status}'`));
  }
  assert.match(rollback, /rollback_original_status/);
  assert.match(rollback, /status in \('success', 'error', 'skipped', 'pending'\)/);
});

test("Coolify deployment inspection redacts credential-shaped fields before logging", () => {
  const workflow = readFileSync(".github/workflows/coolify-secret-sync.yml", "utf8");
  assert.match(workflow, /function redactSensitiveFields\(value\)/);
  assert.match(workflow, /password\|secret\|token\|private\[_-\]\?key\|webhook/i);
  assert.match(workflow, /body: redactSensitiveFields\(await coolify\(path\)\)/);
});

test("action proposals freeze server-owned payloads and deduplicate by input hash", async () => {
  let insertedBody: Record<string, unknown> | null = null;
  await withSupabaseMock(async (url, init) => {
    const table = url.pathname.split("/").pop();
    if (table !== "company_brain_action_runs") return json({ error: "unexpected table" }, 500);
    if (String(init.method || "GET").toUpperCase() === "GET") return json([]);
    insertedBody = JSON.parse(String(init.body));
    return json([{
      id: "run-1",
      action_key: "guarded_offer_resend",
      case_key: "request:REQ-1",
      request_id: "REQ-1",
      risk_level: "critical",
      status: "awaiting_approval",
      proposed_by: "employee@neontrip.de",
      approved_by: null,
      idempotency_key: insertedBody?.idempotency_key,
      input_hash: insertedBody?.input_hash,
      frozen_input: insertedBody?.frozen_input,
      preview: insertedBody?.preview,
      proposed_at: "2026-07-16T12:00:00.000Z",
    }]);
  }, async () => {
    const proposed = await proposeCompanyBrainActionRun({
      policy: guardedSendPolicy,
      actor: {
        email: "employee@neontrip.de",
        roles: ["viewer", "operator"],
        identified: true,
        local: false,
      },
      caseKey: "request:REQ-1",
      requestId: "REQ-1",
      frozenInput: {
        actionKey: "guarded_offer_resend",
        requestId: "REQ-1",
        recipientEmail: "customer@example.com",
        operatorName: "spoofed-admin",
      },
      preview: { offerNumber: "14427" },
    });
    assert.equal(proposed.run.status, "awaiting_approval");
  });
  const storedBody = insertedBody as Record<string, unknown> | null;
  assert.ok(storedBody);
  assert.equal((storedBody.frozen_input as Record<string, unknown>).operatorName, undefined);
  assert.match(String(storedBody.idempotency_key), /^company-brain-action:guarded_offer_resend:/);
});

test("action proposals return the persisted terminal run without creating another side effect", async () => {
  let writes = 0;
  await withSupabaseMock(async (url, init) => {
    const method = String(init.method || "GET").toUpperCase();
    if (method !== "GET") writes += 1;
    if (!url.pathname.endsWith("/company_brain_action_runs")) return json({ error: "unexpected table" }, 500);
    return json([{
      id: "run-resolved",
      action_key: "guarded_offer_resend",
      case_key: "request:REQ-1",
      request_id: "REQ-1",
      risk_level: "critical",
      status: "resolved",
      proposed_by: "employee@neontrip.de",
      approved_by: "approver@neontrip.de",
      idempotency_key: "persisted-idempotency-key",
      input_hash: "persisted-hash",
      frozen_input: { actionKey: "guarded_offer_resend", requestId: "REQ-1" },
      preview: {},
      proposed_at: "2026-07-16T12:00:00.000Z",
      completed_at: "2026-07-16T12:05:00.000Z",
    }]);
  }, async () => {
    const proposed = await proposeCompanyBrainActionRun({
      policy: guardedSendPolicy,
      actor: {
        email: "employee@neontrip.de",
        roles: ["viewer", "operator"],
        identified: true,
        local: false,
      },
      caseKey: "request:REQ-1",
      requestId: "REQ-1",
      frozenInput: { actionKey: "guarded_offer_resend", requestId: "REQ-1" },
    });
    assert.equal(proposed.duplicate, true);
    assert.equal(proposed.run.status, "resolved");
  });
  assert.equal(writes, 0);
});

test("four-eyes approval rejects the original proposer before writing an approval", async () => {
  const calls: string[] = [];
  await withSupabaseMock(async (url, init) => {
    calls.push(`${String(init.method || "GET").toUpperCase()} ${url.pathname}`);
    if (url.pathname.endsWith("/company_brain_action_runs")) {
      return json([{
        id: "run-1",
        action_key: "guarded_offer_resend",
        case_key: "request:REQ-1",
        request_id: "REQ-1",
        risk_level: "critical",
        status: "awaiting_approval",
        proposed_by: "admin@neontrip.de",
        approved_by: null,
        idempotency_key: "idempotency-1",
        input_hash: "hash-1",
        frozen_input: { actionKey: "guarded_offer_resend" },
        preview: {},
        proposed_at: "2026-07-16T12:00:00.000Z",
      }]);
    }
    if (url.pathname.endsWith("/company_brain_action_policies")) {
      return json([{
        action_key: "guarded_offer_resend",
        risk_level: "critical",
        minimum_role: "operator",
        approval_role: "approver",
        requires_four_eyes: true,
        customer_side_effect: true,
        description: "Guarded send",
      }]);
    }
    return json({ error: "unexpected write" }, 500);
  }, async () => {
    await assert.rejects(
      () => approveAndClaimCompanyBrainActionRun({
        runId: "run-1",
        actor: {
          email: "admin@neontrip.de",
          roles: ["viewer", "operator", "approver"],
          identified: true,
          local: false,
        },
      }),
      /Vier-Augen-Prinzip verletzt/,
    );
  });
  assert.equal(calls.some((call) => call.includes("approve_company_brain_action_run")), false);
});

function minimalResolveResult(requestIds: string[]): CompanyBrainResolveResult {
  return {
    query: "Trello card",
    generatedAt: "2026-07-16T12:00:00.000Z",
    records: requestIds.map((requestId) => ({
      requestId,
      displayName: "Test Customer",
      company: null,
      email: "customer@example.com",
      phone: null,
      status: "open",
      title: "Test",
      requestedSize: null,
      requestedColors: [],
      trelloCardId: "TRELLO1",
      trelloCardUrl: "https://trello.com/c/TRELLO1",
      latestOfferSentAt: null,
      latestOfferViewedAt: null,
      latestOfferSignedAt: null,
      latestOrderNumber: null,
      latestOrderStatus: null,
      latestOutboundAt: null,
      latestInboundAt: null,
      communicationsCount: 0,
      timelineCount: 0,
    })),
    offers: [],
    identifiers: [
      ...requestIds.map((value) => ({ type: "request_id" as const, label: "Request-ID", value, confidence: "high" as const, href: null })),
      { type: "trello_card_id", label: "Trello", value: "TRELLO1", confidence: "high", href: "https://trello.com/c/TRELLO1" },
      { type: "email", label: "E-Mail", value: "customer@example.com", confidence: "medium", href: null },
    ],
    automationRuns: [],
    trelloFailureDiagnosis: {
      requested: true,
      status: "loaded",
      severity: "warning",
      expectedAction: "offer_send",
      card: {
        id: "TRELLO1",
        shortLink: "TRELLO1",
        name: "Test",
        descriptionPreview: null,
        url: "https://trello.com/c/TRELLO1",
        currentListName: "Quote Ready",
        dateLastActivity: null,
        attachmentsCount: 0,
        customFields: [],
      },
      triggerMove: null,
    },
  } as unknown as CompanyBrainResolveResult;
}

test("canonical correlation creates deterministic request and Trello aliases but never email aliases", async () => {
  const aliasBodies: Array<Record<string, unknown>> = [];
  const trelloProjectionBodies: Array<Record<string, unknown>> = [];
  await withSupabaseMock(async (url, init) => {
    const table = url.pathname.split("/").pop();
    const method = String(init.method || "GET").toUpperCase();
    if (table === "company_entity_registry" && method === "POST") {
      return json([{ id: "entity-1", entity_type: "request", canonical_key: "request:REQ-1" }]);
    }
    if (table === "company_entity_aliases" && method === "GET") return json([]);
    if (table === "company_entity_aliases" && method === "POST") {
      aliasBodies.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 204 });
    }
    if (table === "trello_card_aliases" && method === "GET") return json([]);
    if (table === "trello_card_aliases" && method === "POST") {
      trelloProjectionBodies.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 204 });
    }
    if (table === "company_identity_resolution_log" && method === "POST") return new Response(null, { status: 204 });
    return json({ error: `unexpected ${method} ${table}` }, 500);
  }, async () => {
    const correlated = await correlateCompanyBrainResult(minimalResolveResult(["REQ-1"]), "resolver@test");
    assert.equal(correlated.status, "matched");
    assert.equal(correlated.canonicalKey, "request:REQ-1");
  });
  assert.equal(aliasBodies.some((body) => body.alias_type === "request_id"), true);
  assert.equal(aliasBodies.some((body) => body.alias_type === "trello_card_id"), true);
  assert.equal(aliasBodies.some((body) => body.alias_type === "email"), false);
  assert.equal(trelloProjectionBodies.length, 1);
  assert.equal(trelloProjectionBodies[0]?.request_id, "REQ-1");
  assert.equal(trelloProjectionBodies[0]?.alias_trello_card_id, "TRELLO1");
});

test("canonical correlation never overwrites a copied Trello card alias from another request", async () => {
  let projectionWrites = 0;
  await withSupabaseMock(async (url, init) => {
    const table = url.pathname.split("/").pop();
    const method = String(init.method || "GET").toUpperCase();
    if (table === "company_entity_registry" && method === "POST") {
      return json([{ id: "entity-1", entity_type: "request", canonical_key: "request:REQ-1" }]);
    }
    if (table === "company_entity_aliases" && method === "GET") return json([]);
    if (table === "company_entity_aliases" && method === "POST") return new Response(null, { status: 204 });
    if (table === "trello_card_aliases" && method === "GET") {
      return json([{
        id: "legacy-alias",
        request_id: "REQ-OTHER",
        alias_trello_card_id: "TRELLO1",
        alias_trello_card_url: "https://trello.com/c/TRELLO1",
        canonical_trello_card_id: "TRELLO-OLD",
      }]);
    }
    if (table === "trello_card_aliases" && method !== "GET") {
      projectionWrites += 1;
      return json({ error: "must not write" }, 500);
    }
    if (table === "company_identity_review_queue" && method === "POST") {
      const body = JSON.parse(String(init.body));
      return json([{
        id: "review-trello-conflict",
        status: "open",
        source_key: body.source_key,
        alias_type: body.alias_type,
        candidate_entity_ids: body.candidate_entity_ids,
        proposed_entity_id: body.proposed_entity_id,
        confidence: body.confidence,
        reason_code: body.reason_code,
        summary: body.summary,
        evidence_refs: body.evidence_refs,
        proposed_resolution: body.proposed_resolution,
        correlation_id: body.correlation_id,
        created_at: "2026-07-20T12:00:00.000Z",
      }]);
    }
    if (table === "company_identity_resolution_log" && method === "POST") return new Response(null, { status: 204 });
    return json({ error: `unexpected ${method} ${table}` }, 500);
  }, async () => {
    const correlated = await correlateCompanyBrainResult(minimalResolveResult(["REQ-1"]), "resolver@test");
    assert.equal(correlated.status, "ambiguous");
    assert.equal(correlated.reviewId, "review-trello-conflict");
    assert.match(correlated.summary, /anderen Request-ID/);
  });

  assert.equal(projectionWrites, 0);
});

test("ambiguous request ids create a review instead of merging entities", async () => {
  const calls: string[] = [];
  await withSupabaseMock(async (url, init) => {
    const table = url.pathname.split("/").pop();
    const method = String(init.method || "GET").toUpperCase();
    calls.push(`${method} ${table}`);
    if (table === "company_identity_review_queue" && method === "POST") {
      const body = JSON.parse(String(init.body));
      return json([{
        id: "review-1",
        status: "open",
        source_key: body.source_key,
        alias_type: body.alias_type,
        candidate_entity_ids: [],
        proposed_entity_id: null,
        confidence: body.confidence,
        reason_code: body.reason_code,
        summary: body.summary,
        evidence_refs: body.evidence_refs,
        proposed_resolution: body.proposed_resolution,
        correlation_id: body.correlation_id,
        created_at: "2026-07-16T12:00:00.000Z",
      }]);
    }
    if (table === "company_identity_resolution_log" && method === "POST") return new Response(null, { status: 204 });
    return json({ error: `unexpected ${method} ${table}` }, 500);
  }, async () => {
    const correlated = await correlateCompanyBrainResult(minimalResolveResult(["REQ-1", "REQ-2"]));
    assert.equal(correlated.status, "ambiguous");
    assert.equal(correlated.reviewId, "review-1");
  });
  assert.equal(calls.some((call) => call.includes("company_entity_registry")), false);
});

test("confirmed identity review reassigns the exact frozen alias before closing", async () => {
  const patches: Array<{ table: string; body: Record<string, unknown> }> = [];
  await withSupabaseMock(async (url, init) => {
    const table = url.pathname.split("/").pop() || "";
    const method = String(init.method || "GET").toUpperCase();
    if (table === "company_identity_review_queue" && method === "GET") {
      return json([{
        id: "review-1",
        status: "open",
        source_key: "trello",
        alias_type: "trello_card_id",
        candidate_entity_ids: ["entity-old", "entity-new"],
        proposed_entity_id: "entity-new",
        confidence: 0.5,
        reason_code: "alias_points_to_different_entity",
        summary: "Conflict",
        evidence_refs: [],
        proposed_resolution: {
          operation: "reassign_alias",
          sourceKey: "trello",
          aliasType: "trello_card_id",
          aliasValue: "TRELLO1",
          fromEntityId: "entity-old",
          toEntityId: "entity-new",
        },
        correlation_id: "correlation-1",
        created_at: "2026-07-16T12:00:00.000Z",
      }]);
    }
    if (table === "company_entity_aliases" && method === "GET") {
      return json([{
        id: "alias-1",
        entity_id: "entity-old",
        source_key: "trello",
        alias_type: "trello_card_id",
        alias_value: "TRELLO1",
        confidence: 1,
      }]);
    }
    if (method === "PATCH") {
      const body = JSON.parse(String(init.body));
      patches.push({ table, body });
      if (table === "company_identity_review_queue") {
        return json([{
          id: "review-1",
          status: "confirmed",
          source_key: "trello",
          alias_type: "trello_card_id",
          candidate_entity_ids: ["entity-old", "entity-new"],
          proposed_entity_id: "entity-new",
          confidence: 1,
          reason_code: "alias_points_to_different_entity",
          summary: "Conflict",
          evidence_refs: [],
          proposed_resolution: {},
          correlation_id: "correlation-1",
          reviewed_by: "approver@neontrip.de",
          reviewed_at: "2026-07-16T12:05:00.000Z",
          created_at: "2026-07-16T12:00:00.000Z",
        }]);
      }
      return new Response(null, { status: 204 });
    }
    if (table === "company_identity_resolution_log" && method === "POST") return new Response(null, { status: 204 });
    return json({ error: `unexpected ${method} ${table}` }, 500);
  }, async () => {
    const review = await reviewCompanyIdentity({
      reviewId: "review-1",
      decision: "confirmed",
      actor: "approver@neontrip.de",
    });
    assert.equal(review.status, "confirmed");
  });
  const aliasPatch = patches.find((entry) => entry.table === "company_entity_aliases");
  assert.equal(aliasPatch?.body.entity_id, "entity-new");
  assert.equal(aliasPatch?.body.resolution_method, "manual");
  assert.equal(patches.at(-1)?.table, "company_identity_review_queue");
});
