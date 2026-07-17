import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { GET as GET_INCIDENTS } from "@/app/api/ops/company-brain/incidents/route";
import type { CompanyBrainResolveResult } from "@/lib/ops/company-brain";
import { resolveCompanyBrainActor } from "@/lib/ops/company-brain-access";
import { parseCompanyBrainIntelligenceBrief } from "@/lib/ops/company-brain-ai-brief";
import {
  listCompanyBrainOperationalIncidents,
  persistCompanyBrainCaseIncidents,
  transitionCompanyBrainOperationalIncident,
} from "@/lib/ops/company-brain-operational-intelligence";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
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

function resultFixture(): CompanyBrainResolveResult {
  return {
    query: "https://trello.com/c/TEST123",
    generatedAt: "2026-07-17T08:00:00.000Z",
    evidence: [{
      id: "evidence-1",
      source: "workflow_audit",
      title: "Execution 123 failed",
      detail: "Video QC rejected DESIGN_MORPH",
      occurredAt: "2026-07-17T07:59:00.000Z",
      direction: "system",
      href: null,
      confidence: "high",
    }],
    records: [{ requestId: "REQ-1" }],
    offers: [{ offerId: "offer-1", requestId: "REQ-1" }],
    identifiers: [],
    checks: [{ evidenceIds: ["evidence-1"] }],
    caseEvents: [{ category: "automation", evidenceIds: ["evidence-1"] }],
    assets: [],
    automationRuns: [{
      id: "audit-1",
      workflowName: "ki_video_generator_v1",
      issueKey: "video_content_qc_failed",
      executionId: "123",
      createdAt: "2026-07-17T07:59:00.000Z",
    }],
    watchers: [{
      key: "automation_failed",
      severity: "warning",
      status: "open",
      title: "Automation fehlgeschlagen",
      detail: "Video QC rejected DESIGN_MORPH",
      actionKey: "inspect_n8n_run",
    }],
    actionProposals: [{
      key: "inspect_n8n_run",
      label: "n8n-Run prüfen",
      type: "open_link",
      riskLevel: "medium",
      approvalRequired: false,
      enabled: true,
      summary: "Execution rein lesend prüfen.",
      confirmationText: "",
      href: null,
      payloadPreview: [],
    }],
    employeeGuidance: {
      resolutionLabel: "Datenfix nötig",
      nextBestActionKey: "inspect_n8n_run",
      evidenceBullets: ["Execution 123 ist fehlgeschlagen."],
      blockerBullets: ["Kein Versandbeleg."],
      steps: [{ key: "prove_cause" }],
      customerContactPolicy: "no_customer_contact",
      rootCauseCode: "video_content_qc_failed",
    },
    trelloFailureDiagnosis: {
      requested: true,
      rootCause: "Video QC hat das Video abgelehnt.",
      card: { id: "TEST123" },
    },
    problemResolution: {
      problemType: "automation_failed",
      rootCause: "Video QC hat das Video abgelehnt.",
    },
    answer: { verdict: "found", headline: "Video abgelehnt" },
    evidenceScore: { score: 88, status: "strong" },
    retryAssessment: {
      status: "blocked",
      blockers: ["QC nicht bestanden."],
      safeFixes: ["Mockup prüfen."],
    },
  } as unknown as CompanyBrainResolveResult;
}

function incidentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "incident-1",
    fingerprint: "case_watcher:abc",
    incident_type: "case_watcher",
    severity: "warning",
    status: "open",
    title: "Automation fehlgeschlagen",
    detail: "Video QC rejected DESIGN_MORPH",
    root_cause_code: "video_content_qc_failed",
    playbook_key: "video_content_qc_failed",
    playbook_version: 1,
    case_key: "request:REQ-1",
    request_id: "REQ-1",
    trello_card_id: "TEST123",
    offer_id: "offer-1",
    workflow_execution_id: "123",
    source_key: "n8n",
    source_ref: "workflow_audit:audit-1",
    evidence_refs: ["evidence-1"],
    owner_team: "design",
    assigned_to: null,
    first_seen_at: "2026-07-17T08:00:00.000Z",
    last_seen_at: "2026-07-17T08:00:00.000Z",
    metadata: {},
    ...overrides,
  };
}

test("operational intelligence migration is private, scheduled, append-only and reversible", () => {
  const migration = readFileSync("supabase/migrations/20260717073542_company_brain_operational_intelligence.sql", "utf8");
  const rollback = readFileSync("supabase/rollbacks/20260717073542_company_brain_operational_intelligence_rollback.sql", "utf8");
  const indexCleanup = readFileSync("supabase/migrations/20260717100630_remove_duplicate_workflow_audit_index.sql", "utf8");
  const indexCleanupRollback = readFileSync("supabase/rollbacks/20260717100630_remove_duplicate_workflow_audit_index_rollback.sql", "utf8");
  const apiBoundary = readFileSync("src/lib/ops/company-brain-api.ts", "utf8");
  assert.match(migration, /company_brain_operational_incidents enable row level security/i);
  assert.match(migration, /company_brain_incident_events_are_append_only/i);
  assert.match(migration, /upsert_company_brain_incident[\s\S]*for update/i);
  assert.match(migration, /transition_company_brain_incident[\s\S]*resolution_note_required/i);
  assert.match(migration, /company-brain-operational-scan[\s\S]*\*\/5 \* \* \* \*/i);
  assert.match(migration, /later successful workflow evidence|späterer erfolgreicher workflow-beleg/i);
  assert.match(migration, /should_reopen := p_reopen and current_row\.status = 'resolved'/i);
  assert.match(migration, /workflow_audit_log_created_at_desc_idx/i);
  assert.match(indexCleanup, /drop index if exists public\.workflow_audit_log_created_at_desc_idx/i);
  assert.match(indexCleanupRollback, /create index if not exists workflow_audit_log_created_at_desc_idx/i);
  assert.match(rollback, /cron\.unschedule/i);
  assert.match(rollback, /drop table if exists public\.company_brain_operational_incidents/i);
  assert.doesNotMatch(apiBoundary, /details:\s*error\.details/);
});

test("incident transitions reject malformed ids and external assignees before a database call", async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("unexpected database call");
  }) as typeof fetch;
  const actor = { email: "employee@neontrip.de", roles: ["viewer", "operator"] as const, identified: true, local: false };
  try {
    await assert.rejects(() => transitionCompanyBrainOperationalIncident({
      incidentId: "not-a-uuid",
      status: "acknowledged",
      actor: { ...actor, roles: [...actor.roles] },
    }), /ungültig/);
    await assert.rejects(() => transitionCompanyBrainOperationalIncident({
      incidentId: "723e4567-e89b-42d3-a456-426614174000",
      status: "acknowledged",
      assignedTo: "external@example.com",
      actor: { ...actor, roles: [...actor.roles] },
    }), /NEONTRIP-E-Mail/);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls, 0);
});

test("expired elevated roles fall back to the configured verified role", async () => {
  const originalDefaultRole = process.env.COMPANY_BRAIN_DEFAULT_VERIFIED_ROLE;
  process.env.COMPANY_BRAIN_DEFAULT_VERIFIED_ROLE = "viewer";
  try {
    await withSupabaseMock(async () => json([{
      actor_email: "employee@neontrip.de",
      role: "company_admin",
      active: true,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    }]), async () => {
      const actor = await resolveCompanyBrainActor({
        ok: true,
        actor: "employee@neontrip.de",
        actorIdentified: true,
      });
      assert.deepEqual(actor.roles, ["viewer"]);
    });
  } finally {
    if (originalDefaultRole === undefined) delete process.env.COMPANY_BRAIN_DEFAULT_VERIFIED_ROLE;
    else process.env.COMPANY_BRAIN_DEFAULT_VERIFIED_ROLE = originalDefaultRole;
  }
});

test("AI brief accepts only known citations and keeps the next action deterministic", () => {
  const result = resultFixture();
  const brief = parseCompanyBrainIntelligenceBrief(JSON.stringify({
    headline: "Video-Inhaltsprüfung fehlgeschlagen",
    diagnosis: "Die Execution wurde wegen DESIGN_MORPH gestoppt. Kontakt: employee@example.com https://evil.test",
    why: ["Der Workflow-Audit enthält den QC-Code."],
    uncertainties: ["Ein späterer Versandbeleg fehlt."],
    evidenceIds: ["evidence-1", "invented-evidence"],
  }), result, "test-model");
  assert.deepEqual(brief.evidenceIds, ["evidence-1"]);
  assert.equal(brief.nextAction?.key, "inspect_n8n_run");
  assert.doesNotMatch(brief.diagnosis, /employee@example\.com|evil\.test/);
  assert.equal(brief.customerContactPolicy, "no_customer_contact");
});

test("AI brief rejects an answer without a valid evidence citation", () => {
  assert.throws(() => parseCompanyBrainIntelligenceBrief(JSON.stringify({
    headline: "Unbelegt",
    diagnosis: "Erfundene Ursache",
    why: ["Keine Quelle"],
    uncertainties: [],
    evidenceIds: ["invented-evidence"],
  }), resultFixture(), "test-model"), /missing_valid_citation/);
});

test("incident listing prioritizes critical incidents independent of database text ordering", async () => {
  await withSupabaseMock(async () => json([
    incidentRow({ id: "warning", severity: "warning" }),
    incidentRow({ id: "critical", severity: "critical" }),
  ]), async () => {
    const incidents = await listCompanyBrainOperationalIncidents({ status: "active" });
    assert.deepEqual(incidents.map((entry) => entry.id), ["critical", "warning"]);
  });
});

test("incident API returns bounded private queue and active playbooks with no-store headers", async () => {
  await withSupabaseMock(async (url) => {
    if (url.pathname.endsWith("/company_brain_operational_incidents")) return json([incidentRow()]);
    if (url.pathname.endsWith("/company_brain_playbooks")) return json([{
      playbook_key: "video_content_qc_failed",
      version: 1,
      title: "Video-Inhaltsprüfung abgelehnt",
      category: "video",
      owner_team: "design",
      purpose: "Versand schützen.",
      trigger_codes: ["video_content_qc_failed"],
      default_severity: "warning",
      diagnosis_steps: [],
      safe_actions: [],
      blocked_actions: [],
      escalation_steps: [],
      verification_steps: [],
    }]);
    return json({ error: "unexpected table" }, 500);
  }, async () => {
    const response = await GET_INCIDENTS(new NextRequest("http://127.0.0.1:3100/api/ops/company-brain/incidents?status=active", {
      headers: { host: "127.0.0.1:3100" },
    }));
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") || "", /no-store/);
    assert.equal(payload.incidents[0].rootCauseCode, "video_content_qc_failed");
    assert.equal(payload.playbooks[0].key, "video_content_qc_failed");
  });
});

test("case watcher persistence maps video QC to its playbook without customer side effects", async () => {
  let rpcBody: Record<string, unknown> | null = null;
  await withSupabaseMock(async (url, init) => {
    assert.match(url.pathname, /\/rpc\/upsert_company_brain_incident$/);
    rpcBody = JSON.parse(String(init.body));
    return json(incidentRow());
  }, async () => {
    const incidents = await persistCompanyBrainCaseIncidents({
      result: resultFixture(),
      actor: { email: "employee@neontrip.de", roles: ["viewer", "operator"], identified: true, local: false },
      entityId: "11111111-1111-4111-8111-111111111111",
    });
    assert.equal(incidents.length, 1);
  });
  assert.ok(rpcBody);
  const captured = rpcBody as unknown as Record<string, unknown>;
  assert.equal(captured.p_playbook_key, "video_content_qc_failed");
  assert.equal(captured.p_root_cause_code, "video_content_qc_failed");
  assert.equal(captured.p_reopen, true);
  assert.equal("customerCommunication" in captured, false);
});

test("global integration incidents never inherit an arbitrary customer case", async () => {
  let rpcBody: Record<string, unknown> | null = null;
  const result = resultFixture();
  result.watchers = [{
    key: "missing_live_outlook",
    severity: "warning",
    status: "open",
    title: "Live Outlook fehlt",
    detail: "Graph-Konfiguration ist nicht vollständig.",
    actionKey: "inspect_live_outlook",
  }];
  await withSupabaseMock(async (_url, init) => {
    rpcBody = JSON.parse(String(init.body));
    return json(incidentRow({
      fingerprint: "integration:missing_live_outlook",
      source_key: "outlook_graph",
      source_ref: "integration:outlook_graph",
    }));
  }, async () => {
    await persistCompanyBrainCaseIncidents({
      result,
      actor: { email: "employee@neontrip.de", roles: ["viewer", "operator"], identified: true, local: false },
      entityId: "11111111-1111-4111-8111-111111111111",
    });
  });
  assert.ok(rpcBody);
  const captured = rpcBody as unknown as Record<string, unknown>;
  assert.equal(captured.p_case_key, null);
  assert.equal(captured.p_request_id, null);
  assert.equal(captured.p_trello_card_id, null);
  assert.equal(captured.p_offer_id, null);
  assert.equal(captured.p_source_ref, "integration:outlook_graph");
  assert.deepEqual(captured.p_evidence_refs, []);
});
