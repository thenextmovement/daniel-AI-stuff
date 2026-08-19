import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import {
  createManualRequestImport,
  manualRequestSegmentationInsertState,
  resolveExplicitManualRequestSegment,
  resolveManualCustomerRequestId,
} from "@/lib/ops/manual-request-import";
import { QuoteValidationError } from "@/lib/quotes/validation";

function phase1LegacyImportFingerprint(
  email: string,
  segment: string,
  trello: { createCard?: boolean; listId?: string | null } = {},
) {
  return createHash("sha256").update(JSON.stringify({
    customer: {
      firstName: null,
      lastName: null,
      company: null,
      email,
      phone: null,
      country: "DE",
    },
    request: {
      title: null,
      description: null,
      product: null,
      size: null,
      color: null,
      application: null,
      deliveryTime: null,
      customerType: null,
      segment,
      priority: "standard",
      dueAt: null,
    },
    trello: {
      createCard: Boolean(trello.createCard),
      listId: trello.listId || null,
    },
  })).digest("hex");
}

async function runPartialSegmentRetryFixture(
  segment: string,
  taxonomyMarker: string | null,
  segmentState: {
    segment: string | null;
    s_kategorie: string | null;
    segment_status: string;
    segment_confidence: number | null;
    segment_source: string | null;
    segment_taxonomy_version: string | null;
  } = {
    segment: null,
    s_kategorie: null,
    segment_status: "pending",
    segment_confidence: null,
    segment_source: null,
    segment_taxonomy_version: null,
  },
) {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const idempotencyKey = `partial-${segment}-${taxonomyMarker || "pre-marker"}`;
  const internalRequestId = "44444444-4444-4444-8444-444444444444";
  const publicRequestId = `partial-${segment.toLowerCase()}-request`;
  const email = `${segment.toLowerCase()}-partial@example.org`;
  const rpcBodies: Array<Record<string, unknown>> = [];
  let contactHistoryInserts = 0;
  let salesTaskInserts = 0;
  let importAuditInserts = 0;
  process.env.SUPABASE_URL = "https://supabase.example.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

  const attribution: Record<string, unknown> = {
    idempotency_key: idempotencyKey,
    manual_import_payload_hash: phase1LegacyImportFingerprint(email, segment),
    manual_segment_candidate: segment,
    manual_import_due_at: "2026-08-19T10:00:00.000Z",
    manual_import_customer_created: false,
  };
  if (taxonomyMarker) attribution.manual_segment_taxonomy_version = taxonomyMarker;

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

  globalThis.fetch = (async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};

    if (url.pathname.endsWith("/rest/v1/workflow_audit_log") && method === "GET") return json([]);
    if (url.pathname.endsWith("/rest/v1/workflow_audit_log") && method === "POST") {
      if (body.action === "manual_request_imported") importAuditInserts += 1;
      return json({});
    }
    if (url.pathname.endsWith("/rest/v1/master_requests") && method === "GET") {
      return json([{
        id: internalRequestId,
        request_id: publicRequestId,
        customer_id: "partial-customer",
        trello_card_id: null,
        trello_card_url: null,
        ...segmentState,
        attribution_raw: attribution,
      }]);
    }
    if (url.pathname.endsWith("/rest/v1/rpc/neontrip_set_manual_request_segment")) {
      rpcBodies.push(body);
      return json({
        request_id: internalRequestId,
        public_request_id: publicRequestId,
        segment,
        s_kategorie: "S1",
        segment_status: "accepted",
        segment_confidence: null,
        segment_source: "manual_ops_import",
        segment_classified_at: "2026-08-19T12:00:00.000Z",
        segment_policy_version: "manual_override_v1_20260819",
        segment_taxonomy_version: "nt_taxonomy_v2_20260819_cx8",
        context_tags: [],
        organization_scale: null,
        authoritative: true,
        gold_label_created: false,
        audit_id: "55555555-5555-4555-8555-555555555555",
      });
    }
    if (url.pathname.endsWith("/rest/v1/customer_contact_history") && method === "GET") return json([]);
    if (url.pathname.endsWith("/rest/v1/customer_contact_history") && method === "POST") {
      contactHistoryInserts += 1;
      return json({});
    }
    if (url.pathname.endsWith("/rest/v1/sales_tasks") && method === "GET") return json([]);
    if (url.pathname.endsWith("/rest/v1/sales_tasks") && method === "POST") {
      salesTaskInserts += 1;
      return json([{ id: "partial-task", ...body }]);
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}${url.search}`);
  }) as typeof fetch;

  try {
    const result = await createManualRequestImport({
      idempotencyKey,
      operatorName: "Test Operator",
      customer: { email },
      request: { segment },
      trello: { createCard: false },
    }, { operatorName: "Test Operator", mode: "ops_session" });
    return {
      result,
      rpcBodies,
      contactHistoryInserts,
      salesTaskInserts,
      importAuditInserts,
      segmentState,
    };
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
}

test("manual request insert never promotes mockup context into request segmentation", () => {
  assert.deepEqual(manualRequestSegmentationInsertState(), {
    segment: null,
    s_kategorie: null,
    segment_status: "pending",
    segment_confidence: null,
    segment_source: null,
    segment_classified_at: null,
    segment_policy_version: null,
    segment_taxonomy_version: null,
  });
});

test("explicit operator segment is retained for the canonical manual RPC", () => {
  assert.equal(resolveExplicitManualRequestSegment("NT-3"), "NT-3");
  assert.equal(resolveExplicitManualRequestSegment(""), null);
  assert.throws(() => resolveExplicitManualRequestSegment("NT-2"), /Unbekanntes Segment/);
  assert.throws(() => resolveExplicitManualRequestSegment("NT-15"), /Unbekanntes Segment/);
  assert.throws(() => resolveExplicitManualRequestSegment("Restaurant"), /Unbekanntes Segment/);
});

test("resolveManualCustomerRequestId always promotes the newly imported request", () => {
  assert.equal(resolveManualCustomerRequestId("old-orphan-request", "new-request", false), "new-request");
  assert.equal(resolveManualCustomerRequestId("existing-request", "new-request", true), "new-request");
  assert.equal(resolveManualCustomerRequestId(null, "new-request", false), "new-request");
});

test("pre-marker neutral NT-3 retry completes core without reinterpreting the Phase-1 code", async () => {
  const fixture = await runPartialSegmentRetryFixture("NT-3", null);

  assert.equal(fixture.result.requestCreated, false);
  assert.equal(fixture.result.salesTaskCreated, true);
  assert.match(fixture.result.warnings.join(" "), /Legacy-Kandidat nicht übernommen – separat im Portal neu zuordnen/);
  assert.equal(fixture.rpcBodies.length, 0);
  assert.equal(fixture.contactHistoryInserts, 1);
  assert.equal(fixture.salesTaskInserts, 1);
  assert.equal(fixture.importAuditInserts, 1);
});

test("pre-marker NT-3 retry preserves an accepted AI segment while completing core", async () => {
  const aiState = {
    segment: "NT-3",
    s_kategorie: "S1",
    segment_status: "accepted",
    segment_confidence: 0.91,
    segment_source: "request_segmenter",
    segment_taxonomy_version: "nt_taxonomy_v2_20260819_cx8",
  };
  const fixture = await runPartialSegmentRetryFixture("NT-3", null, aiState);

  assert.equal(fixture.result.requestCreated, false);
  assert.equal(fixture.result.salesTaskCreated, true);
  assert.match(fixture.result.warnings.join(" "), /Legacy-Kandidat nicht übernommen – separat im Portal neu zuordnen/);
  assert.equal(fixture.rpcBodies.length, 0);
  assert.deepEqual(fixture.segmentState, aiState);
  assert.equal(fixture.contactHistoryInserts, 1);
  assert.equal(fixture.salesTaskInserts, 1);
  assert.equal(fixture.importAuditInserts, 1);
});

test("exact CX8-marked neutral NT-3 retry continues the authoritative segment RPC", async () => {
  const fixture = await runPartialSegmentRetryFixture(
    "NT-3",
    "nt_taxonomy_v2_20260819_cx8",
  );

  assert.equal(fixture.result.requestCreated, false);
  assert.equal(fixture.result.salesTaskCreated, true);
  assert.equal(fixture.rpcBodies.length, 1);
  assert.deepEqual(fixture.rpcBodies[0], {
    p_request_id: "44444444-4444-4444-8444-444444444444",
    p_segment: "NT-3",
    p_source: "manual_ops_import",
    p_actor: {
      operatorName: "Test Operator",
      mode: "ops_session",
      segmentTaxonomyVersion: "nt_taxonomy_v2_20260819_cx8",
    },
    p_reason: "manual_request_import_explicit_segment_retry",
  });
  assert.equal(fixture.contactHistoryInserts, 1);
  assert.equal(fixture.salesTaskInserts, 1);
  assert.equal(fixture.importAuditInserts, 1);
});

test("pre-marker neutral retry still blocks an unknown segment candidate", async () => {
  await assert.rejects(
    runPartialSegmentRetryFixture("NT-99", null),
    (error: unknown) => error instanceof QuoteValidationError
      && error.status === 422
      && /ohne gueltigen CX8-Importvertrag/.test(error.message),
  );
});

test("audited Phase-1 legacy import retry completes idempotently without a segment write", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const idempotencyKey = "phase1-legacy-import-retry";
  const requestId = "phase1-legacy-request";
  const email = "legacy@example.org";
  const calls: Array<{ method: string; path: string }> = [];
  process.env.SUPABASE_URL = "https://supabase.example.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

  globalThis.fetch = (async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || "GET").toUpperCase();
    calls.push({ method, path: url.pathname });
    if (url.pathname.endsWith("/rest/v1/workflow_audit_log") && method === "GET") {
      return Response.json([{ metadata: { request_id: requestId, idempotency_key: idempotencyKey } }]);
    }
    if (url.pathname.endsWith("/rest/v1/master_requests") && method === "GET") {
      return Response.json([{
        id: "11111111-1111-4111-8111-111111111111",
        request_id: requestId,
        customer_id: "legacy-customer",
        trello_card_id: null,
        trello_card_url: null,
        segment: "NT-2",
        s_kategorie: "S3",
        segment_status: "accepted",
        segment_confidence: null,
        segment_source: "manual_ops_import",
        segment_taxonomy_version: null,
        attribution_raw: {
          idempotency_key: idempotencyKey,
          manual_import_payload_hash: phase1LegacyImportFingerprint(email, "NT-2"),
          manual_segment_candidate: "NT-2",
          manual_import_due_at: "2026-08-19T10:00:00.000Z",
          manual_import_customer_created: false,
        },
      }]);
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  }) as typeof fetch;

  try {
    const result = await createManualRequestImport({
      idempotencyKey,
      operatorName: "Test Operator",
      customer: { email },
      request: { segment: "NT-2" },
      trello: { createCard: false },
    }, { operatorName: "Test Operator", mode: "ops_session" });

    assert.equal(result.requestId, requestId);
    assert.equal(result.requestCreated, false);
    assert.equal(result.salesTaskCreated, false);
    assert.match(result.warnings.join(" "), /Legacy-Autorität wurde unverändert beibehalten/);
    assert.deepEqual(calls, [
      { method: "GET", path: "/rest/v1/workflow_audit_log" },
      { method: "GET", path: "/rest/v1/master_requests" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});

test("partial payload-bound Phase-1 legacy retry completes core without adopting the frozen candidate", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalTrelloKey = process.env.TRELLO_API_KEY;
  const originalTrelloToken = process.env.TRELLO_TOKEN;
  const idempotencyKey = "phase1-partial-legacy-import-retry";
  const internalRequestId = "22222222-2222-4222-8222-222222222222";
  const publicRequestId = "phase1-partial-legacy-request";
  const customerId = "phase1-partial-legacy-customer";
  const email = "partial-legacy@example.org";
  let auditExists = false;
  let segmentRpcCalls = 0;
  let masterRequestMutations = 0;
  let contactHistoryInserts = 0;
  let salesTaskInserts = 0;
  let importAuditInserts = 0;
  let trelloAuditInserts = 0;
  let trelloCardCreates = 0;
  let trelloFieldUpdates = 0;
  let trelloProjectionPatches = 0;
  process.env.SUPABASE_URL = "https://supabase.example.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.TRELLO_API_KEY = "test-trello-key";
  process.env.TRELLO_TOKEN = "test-trello-token";

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  const partialRequest = {
    id: internalRequestId,
    request_id: publicRequestId,
    customer_id: customerId,
    trello_card_id: null as string | null,
    trello_card_url: null as string | null,
    segment: null,
    s_kategorie: null,
    segment_status: "pending",
    segment_confidence: null,
    segment_source: null,
    segment_taxonomy_version: null,
    attribution_raw: {
      idempotency_key: idempotencyKey,
      manual_import_payload_hash: phase1LegacyImportFingerprint(email, "NT-2", { createCard: true }),
      manual_segment_candidate: "NT-2",
      manual_import_due_at: "2026-08-19T10:00:00.000Z",
      manual_import_customer_created: false,
    },
  };

  globalThis.fetch = (async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};

    if (url.hostname === "api.trello.com" && url.pathname === "/1/cards" && method === "POST") {
      trelloCardCreates += 1;
      return json({
        id: "phase1-partial-card",
        idBoard: "phase1-partial-board",
        url: "https://trello.com/c/phase1-partial-card",
      });
    }
    if (url.hostname === "api.trello.com" && url.pathname === "/1/boards/phase1-partial-board/customFields" && method === "GET") {
      return json([
        { id: "field-request-id", name: "nerdy-forms-id", type: "text" },
        { id: "field-customer-email", name: "customer_email", type: "text" },
      ]);
    }
    if (url.hostname === "api.trello.com" && url.pathname.startsWith("/1/cards/phase1-partial-card/customField/") && method === "PUT") {
      trelloFieldUpdates += 1;
      return json({});
    }
    if (url.pathname.endsWith("/rest/v1/workflow_audit_log") && method === "GET") {
      return json(auditExists
        ? [{ metadata: { request_id: publicRequestId, idempotency_key: idempotencyKey } }]
        : []);
    }
    if (url.pathname.endsWith("/rest/v1/workflow_audit_log") && method === "POST") {
      if (body.action === "manual_request_imported") {
        importAuditInserts += 1;
        auditExists = true;
      }
      if (body.action === "manual_request_trello_projected") trelloAuditInserts += 1;
      return json({});
    }
    if (url.pathname.endsWith("/rest/v1/master_requests") && method === "GET") {
      return json([partialRequest]);
    }
    if (url.pathname.endsWith("/rest/v1/master_requests") && method === "PATCH") {
      masterRequestMutations += Object.keys(body).filter((key) => [
        "segment",
        "s_kategorie",
        "segment_status",
        "segment_confidence",
        "segment_source",
        "segment_taxonomy_version",
      ].includes(key)).length;
      trelloProjectionPatches += 1;
      partialRequest.trello_card_id = String(body.trello_card_id || "") || null;
      partialRequest.trello_card_url = String(body.trello_card_url || "") || null;
      return json({});
    }
    if (url.pathname.endsWith("/rest/v1/rpc/neontrip_set_manual_request_segment")) {
      segmentRpcCalls += 1;
      return json({});
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
      return json([{ id: "phase1-partial-task", ...body }]);
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}${url.search}`);
  }) as typeof fetch;

  const input = {
    idempotencyKey,
    operatorName: "Test Operator",
    customer: { email },
    request: { segment: "NT-2" },
    trello: { createCard: true },
  };

  try {
    const completed = await createManualRequestImport(
      input,
      { operatorName: "Test Operator", mode: "ops_session" },
    );
    const repeated = await createManualRequestImport(
      input,
      { operatorName: "Test Operator", mode: "ops_session" },
    );

    assert.equal(completed.requestId, publicRequestId);
    assert.equal(completed.requestCreated, false);
    assert.equal(completed.salesTaskCreated, true);
    assert.equal(completed.trello.requested, true);
    assert.equal(completed.trello.ok, true);
    assert.equal(completed.trello.cardId, "phase1-partial-card");
    assert.match(completed.warnings.join(" "), /Legacy-Kandidat nicht übernommen – separat im Portal neu zuordnen/);
    assert.equal(repeated.requestId, publicRequestId);
    assert.equal(repeated.salesTaskCreated, false);
    assert.equal(repeated.trello.ok, true);
    assert.match(repeated.warnings.join(" "), /bereits vollständig verarbeitet/);
    assert.equal(segmentRpcCalls, 0);
    assert.equal(masterRequestMutations, 0);
    assert.equal(contactHistoryInserts, 1);
    assert.equal(salesTaskInserts, 1);
    assert.equal(importAuditInserts, 1);
    assert.equal(trelloAuditInserts, 1);
    assert.equal(trelloCardCreates, 1);
    assert.equal(trelloFieldUpdates, 2);
    assert.equal(trelloProjectionPatches, 1);
    assert.deepEqual({
      segment: partialRequest.segment,
      s_kategorie: partialRequest.s_kategorie,
      segment_status: partialRequest.segment_status,
      segment_confidence: partialRequest.segment_confidence,
      segment_source: partialRequest.segment_source,
      segment_taxonomy_version: partialRequest.segment_taxonomy_version,
    }, {
      segment: null,
      s_kategorie: null,
      segment_status: "pending",
      segment_confidence: null,
      segment_source: null,
      segment_taxonomy_version: null,
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    if (originalTrelloKey === undefined) delete process.env.TRELLO_API_KEY;
    else process.env.TRELLO_API_KEY = originalTrelloKey;
    if (originalTrelloToken === undefined) delete process.env.TRELLO_TOKEN;
    else process.env.TRELLO_TOKEN = originalTrelloToken;
  }
});

test("brand-new legacy manual import returns 422 before any mutation", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let mutationCalls = 0;
  process.env.SUPABASE_URL = "https://supabase.example.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

  globalThis.fetch = (async (_input, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    if (method !== "GET") mutationCalls += 1;
    return Response.json([]);
  }) as typeof fetch;

  try {
    await assert.rejects(
      createManualRequestImport({
        idempotencyKey: "brand-new-legacy-import",
        operatorName: "Test Operator",
        customer: { email: "new-legacy@example.org" },
        request: { segment: "NT-2" },
      }, { operatorName: "Test Operator", mode: "ops_session" }),
      (error: unknown) => error instanceof QuoteValidationError
        && error.status === 422
        && /Unbekanntes Segment/.test(error.message),
    );
    assert.equal(mutationCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});

test("manual import retry completes core effects and preserves existing manual authority including legacy", async () => {
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
    segment_taxonomy_version: null as string | null,
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
        manual_segment_taxonomy_version: "nt_taxonomy_v2_20260819_cx8",
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
        segment_taxonomy_version: "nt_taxonomy_v2_20260819_cx8",
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
      segment: "NT-2",
      s_kategorie: "S3",
      segment_status: "accepted",
      segment_confidence: null,
      segment_source: "manual_ops_portal",
      segment_taxonomy_version: null,
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
    assert.match(retried.warnings.join(" "), /manuelle Legacy-Autorität wurde unverändert beibehalten/);
    assert.match(retried.warnings.join(" "), /Legacy – neu zuordnen/);
    assert.deepEqual(rpcBodies, [{
      p_request_id: internalRequestId,
      p_segment: "NT-3",
      p_source: "manual_ops_import",
      p_actor: {
        operatorName: "Test Operator",
        mode: "ops_session",
        segmentTaxonomyVersion: "nt_taxonomy_v2_20260819_cx8",
      },
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
        segment_taxonomy_version: "nt_taxonomy_v2_20260819_cx8",
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
