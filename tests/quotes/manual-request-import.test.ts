import test from "node:test";
import assert from "node:assert/strict";
import {
  createManualRequestImport,
  manualRequestSegmentationInsertState,
  resolveExplicitManualRequestSegment,
  resolveManualCustomerRequestId,
} from "@/lib/ops/manual-request-import";

test("manual request insert never promotes mockup context into request segmentation", () => {
  assert.deepEqual(manualRequestSegmentationInsertState(), {
    segment: null,
    s_kategorie: null,
    segment_status: "pending",
    segment_confidence: null,
    segment_source: null,
    segment_classified_at: null,
    segment_policy_version: null,
  });
});

test("explicit operator segment is retained for the canonical manual RPC", () => {
  assert.equal(resolveExplicitManualRequestSegment("NT-3"), "NT-3");
  assert.equal(resolveExplicitManualRequestSegment(""), null);
  assert.throws(() => resolveExplicitManualRequestSegment("Restaurant"), /Unbekanntes Segment/);
});

test("resolveManualCustomerRequestId always promotes the newly imported request", () => {
  assert.equal(resolveManualCustomerRequestId("old-orphan-request", "new-request", false), "new-request");
  assert.equal(resolveManualCustomerRequestId("existing-request", "new-request", true), "new-request");
  assert.equal(resolveManualCustomerRequestId(null, "new-request", false), "new-request");
});

test("manual import retry reuses one request, completes core effects, and preserves newer manual authority", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const internalRequestId = "11111111-1111-4111-8111-111111111111";
  const idempotencyKey = "manual-import-retry-1";
  let publicRequestId = "";
  let insertedRequest: Record<string, unknown> | null = null;
  let segmentState = {
    segment: null as string | null,
    s_kategorie: null as string | null,
    segment_status: "pending",
    segment_confidence: null,
    segment_source: null as string | null,
  };
  let rpcCalls = 0;
  let requestInsertCalls = 0;
  let contactHistoryInserts = 0;
  let salesTaskInserts = 0;
  let importAuditInserts = 0;
  const rpcBodies: Array<Record<string, unknown>> = [];

  process.env.SUPABASE_URL = "https://supabase.example.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const method = String(init.method || "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};

    if (url.pathname.endsWith("/rest/v1/workflow_audit_log") && method === "GET") {
      return json([]);
    }

    if (url.pathname.endsWith("/rest/v1/workflow_audit_log") && method === "POST") {
      if (body.action === "manual_request_imported") importAuditInserts += 1;
      return json({});
    }

    if (url.pathname.endsWith("/rest/v1/master_requests") && method === "GET") {
      const retryLookup = url.searchParams.get("attribution_raw->>idempotency_key");
      if (retryLookup === `eq.${idempotencyKey}` && insertedRequest) {
        return json([{
          id: internalRequestId,
          request_id: publicRequestId,
          customer_id: "customer-1",
          trello_card_id: null,
          trello_card_url: null,
          ...segmentState,
          attribution_raw: insertedRequest.attribution_raw,
        }]);
      }
      return json([]);
    }

    if (url.pathname.endsWith("/rest/v1/master_customers") && method === "GET") {
      return json([]);
    }

    if (url.pathname.endsWith("/rest/v1/master_customers") && method === "POST") {
      return json([{
        id: "customer-1",
        email: "kunde@example.org",
        request_id: body.request_id,
      }]);
    }

    if (url.pathname.endsWith("/rest/v1/master_requests") && method === "POST") {
      requestInsertCalls += 1;
      insertedRequest = body;
      publicRequestId = String(body.request_id || "");
      const attribution = body.attribution_raw as Record<string, unknown>;
      assert.match(String(attribution.manual_import_payload_hash), /^[0-9a-f]{64}$/);
      assert.match(String(attribution.manual_import_due_at), /^\d{4}-\d{2}-\d{2}T/);
      assert.deepEqual(attribution, {
        source: "ops_manual_import",
        idempotency_key: idempotencyKey,
        manual_import_payload_hash: attribution.manual_import_payload_hash,
        manual_segment_candidate: "NT-3",
        manual_import_due_at: attribution.manual_import_due_at,
        manual_import_customer_created: true,
        auto_reply_suppressed: true,
        created_by: "Test Operator",
        product: null,
      });
      return json([{
        id: internalRequestId,
        request_id: publicRequestId,
        customer_id: "customer-1",
      }]);
    }

    if (url.pathname.endsWith("/rest/v1/rpc/neontrip_set_manual_request_segment")) {
      rpcCalls += 1;
      rpcBodies.push(body);
      segmentState = {
        segment: "NT-3",
        s_kategorie: "S1",
        segment_status: "accepted",
        segment_confidence: null,
        segment_source: "manual_ops_import",
      };
      throw new TypeError("simulated lost RPC response");
    }

    if (url.pathname.endsWith("/rest/v1/customer_contact_history") && method === "GET") {
      return json([]);
    }
    if (url.pathname.endsWith("/rest/v1/customer_contact_history") && method === "POST") {
      contactHistoryInserts += 1;
      return json({});
    }

    if (url.pathname.endsWith("/rest/v1/sales_tasks") && method === "GET") {
      return json([]);
    }
    if (url.pathname.endsWith("/rest/v1/sales_tasks") && method === "POST") {
      salesTaskInserts += 1;
      return json([{ id: "task-1", ...body }]);
    }

    throw new Error(`Unexpected request: ${method} ${url.pathname}${url.search}`);
  }) as typeof fetch;

  const input = {
    idempotencyKey,
    operatorName: "Test Operator",
    customer: { email: "kunde@example.org" },
    request: { segment: "NT-3" },
    trello: { createCard: false },
  };

  try {
    await assert.rejects(
      createManualRequestImport(input, { operatorName: "Test Operator", mode: "ops_session" }),
      /simulated lost RPC response/,
    );

    await assert.rejects(
      createManualRequestImport(
        { ...input, request: { ...input.request, segment: "NT-4" } },
        { operatorName: "Test Operator", mode: "ops_session" },
      ),
      /Idempotency-Key gehoert zu einer anderen manuellen Anfrage/,
    );
    await assert.rejects(
      createManualRequestImport(
        { ...input, request: { ...input.request, title: "Geänderter Payload" } },
        { operatorName: "Test Operator", mode: "ops_session" },
      ),
      /Idempotency-Key gehoert zu einer anderen manuellen Anfrage/,
    );

    segmentState = {
      segment: "NT-4",
      s_kategorie: "S2",
      segment_status: "accepted",
      segment_confidence: null,
      segment_source: "manual_ops_portal",
    };
    const retried = await createManualRequestImport(
      input,
      { operatorName: "Test Operator", mode: "ops_session" },
    );

    assert.equal(requestInsertCalls, 1);
    assert.equal(rpcCalls, 1);
    assert.equal(contactHistoryInserts, 1);
    assert.equal(salesTaskInserts, 1);
    assert.equal(importAuditInserts, 1);
    assert.equal(retried.requestId, publicRequestId);
    assert.equal(retried.requestCreated, false);
    assert.equal(retried.salesTaskCreated, true);
    assert.match(retried.warnings.join(" "), /manuelle Segment-Autorität wurde beibehalten/);
    assert.deepEqual(rpcBodies, [{
      p_request_id: internalRequestId,
      p_segment: "NT-3",
      p_source: "manual_ops_import",
      p_actor: { operatorName: "Test Operator", mode: "ops_session" },
      p_reason: "manual_request_import_explicit_segment",
    }]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});

test("audited import with a missing requested Trello card requires manual review without blind retry", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const internalRequestId = "33333333-3333-4333-8333-333333333333";
  const idempotencyKey = "manual-import-missing-trello";
  let publicRequestId = "";
  let insertedRequest: Record<string, unknown> | null = null;
  let auditExists = false;
  let requestInsertCalls = 0;
  let rpcCalls = 0;

  process.env.SUPABASE_URL = "https://supabase.example.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const method = String(init.method || "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};

    if (url.pathname.endsWith("/rest/v1/workflow_audit_log") && method === "GET") {
      return json(auditExists ? [{ metadata: { request_id: publicRequestId, idempotency_key: idempotencyKey } }] : []);
    }
    if (url.pathname.endsWith("/rest/v1/master_requests") && method === "GET") {
      if (!insertedRequest) return json([]);
      const byAudit = url.searchParams.get("request_id") === `eq.${publicRequestId}`;
      const byAttribution = url.searchParams.get("attribution_raw->>idempotency_key") === `eq.${idempotencyKey}`;
      if (!byAudit && !byAttribution) return json([]);
      return json([{
        id: internalRequestId,
        request_id: publicRequestId,
        customer_id: "customer-2",
        trello_card_id: null,
        trello_card_url: null,
        segment: "NT-3",
        s_kategorie: "S1",
        segment_status: "accepted",
        segment_confidence: null,
        segment_source: "manual_ops_import",
        attribution_raw: insertedRequest.attribution_raw,
      }]);
    }
    if (url.pathname.endsWith("/rest/v1/master_customers") && method === "GET") return json([]);
    if (url.pathname.endsWith("/rest/v1/master_customers") && method === "POST") {
      return json([{ id: "customer-2", email: "trello@example.org", request_id: body.request_id }]);
    }
    if (url.pathname.endsWith("/rest/v1/master_requests") && method === "POST") {
      requestInsertCalls += 1;
      insertedRequest = body;
      publicRequestId = String(body.request_id || "");
      return json([{ id: internalRequestId, request_id: publicRequestId, customer_id: "customer-2" }]);
    }
    if (url.pathname.endsWith("/rest/v1/rpc/neontrip_set_manual_request_segment")) {
      rpcCalls += 1;
      throw new TypeError("simulated lost RPC response after commit");
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  }) as typeof fetch;

  const input = {
    idempotencyKey,
    operatorName: "Test Operator",
    customer: { email: "trello@example.org" },
    request: { segment: "NT-3" },
    trello: { createCard: true },
  };

  try {
    await assert.rejects(
      createManualRequestImport(input, { operatorName: "Test Operator", mode: "ops_session" }),
      /simulated lost RPC response after commit/,
    );
    auditExists = true;

    const retried = await createManualRequestImport(
      input,
      { operatorName: "Test Operator", mode: "ops_session" },
    );

    assert.equal(requestInsertCalls, 1);
    assert.equal(rpcCalls, 1);
    assert.equal(retried.trello.requested, true);
    assert.equal(retried.trello.ok, false);
    assert.match(String(retried.trello.error), /manuell prüfen/);
    assert.match(retried.warnings.join(" "), /Trello-Karte fehlt/);
    assert.doesNotMatch(retried.warnings.join(" "), /vollständig verarbeitet/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});
