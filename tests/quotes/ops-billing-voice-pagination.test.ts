import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import * as billing from "../../src/lib/ops/billing/repository";
import * as voice from "../../src/lib/ops/voice-platform-data";
import { GET as billingList } from "../../src/app/api/ops/billing/route";
import { GET as billingDetail } from "../../src/app/api/ops/billing/[caseId]/route";
import { GET as voiceList } from "../../src/app/api/ops/voice-platform/route";

type Row = Record<string, unknown>;
const caseId = "10000000-0000-4000-8000-000000000001";
const rows = (count: number) => Array.from({ length: count }, (_, index) => ({
  id: String(count - index).padStart(5, "0"), created_at: "2026-10-29T00:00:00Z", status: "open",
}));
async function fixture(data: Record<string, Row[]>, run: (requests: URL[]) => Promise<void>, failure?: number) {
  const originalFetch = globalThis.fetch;
  const before = { ...process.env };
  const requests: URL[] = [];
  try {
    Object.assign(process.env, {
      NODE_ENV: "development", SUPABASE_URL: "https://pagination.example.invalid",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-test-only", VOICE_CALL_PLATFORM_ENABLED: "true",
    });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push(url);
      assert.equal(url.origin, "https://pagination.example.invalid");
      assert.equal(init?.method || "GET", "GET", "Pagination must never write");
      assert.equal(init?.cache, "no-store");
      if (failure) return new Response("synthetic storage failure", { status: failure });
      let result = data[url.pathname.split("/").at(-1)!] || [];
      for (const [key, value] of url.searchParams) {
        if (value.startsWith("eq.")) result = result.filter(row => String(row[key]) === value.slice(3));
      }
      const offset = Number(url.searchParams.get("offset") || 0);
      const limit = Number(url.searchParams.get("limit") || result.length);
      return new Response(JSON.stringify(result.slice(offset, offset + limit)), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    await run(requests);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
  }
}
const request = (path: string) => new NextRequest("http://localhost/api/ops/" + path, { headers: { host: "localhost" } });

test("billing pages enumerate beyond 200 with stable sorting and filters before the limit", async () => {
  const matching = rows(205);
  await fixture({ billing_cases: [...rows(220).map(row => ({ ...row, status: "closed" })), ...matching] }, async requests => {
    const first = await billing.listBillingCasesPage({ status: "open", limit: 200 });
    const second = await billing.listBillingCasesPage({ status: "open", limit: 200, offset: first.pagination.nextOffset! });
    assert.deepEqual([...first.cases, ...second.cases].map(row => row.id), matching.map(row => row.id));
    assert.deepEqual(first.pagination, { limit: 200, offset: 0, hasMore: true, nextOffset: 200 });
    assert.deepEqual(second.pagination, { limit: 200, offset: 200, hasMore: false, nextOffset: null });
    assert.equal(requests[0].searchParams.get("order"), "created_at.desc,id.desc");
    assert.equal(requests[0].searchParams.get("status"), "eq.open");
    assert.equal(requests[0].searchParams.get("limit"), "201");
    assert.equal(requests[1].searchParams.get("offset"), "200");
  });
});

test("billing default remains 80 cases and its legacy helper returns the same array", async () => {
  await fixture({ billing_cases: rows(85) }, async requests => {
    const result = await billingList(request("billing?query=Test"));
    const body = await result.json();
    assert.equal(body.cases.length, 80);
    assert.equal(body.pagination.nextOffset, 80);
    assert.match(requests[0].searchParams.get("or")!, /shopify_order_name\.ilike/);
    assert.equal((await billing.listBillingCases()).length, 80);
  });
});

test("pagination caps requested page size and reports an exact boundary and exhausted offset", async () => {
  await fixture({ billing_cases: rows(200), voice_call_targets: rows(200) }, async () => {
    const billingPage = await billing.listBillingCasesPage({ limit: 999 });
    const voicePage = await voice.listVoicePlatformCollection({ collection: "targets", limit: 999 });
    for (const page of [billingPage, voicePage]) {
      assert.deepEqual(page.pagination, { limit: 200, offset: 0, hasMore: false, nextOffset: null });
    }
    assert.equal((await billing.listBillingCasesPage({ offset: 200 })).cases.length, 0);
    assert.equal((await voice.listVoicePlatformCollection({ collection: "targets", offset: 200 })).rows!.length, 0);
  });
});

test("billing events enumerate beyond 200 and retain detail fields and case scope", async () => {
  const events = rows(205).map(row => ({ ...row, billing_case_id: caseId }));
  await fixture({ billing_cases: [{ id: caseId }], billing_events: events }, async requests => {
    const first = await billing.getBillingCase(caseId);
    const secondResponse = await billingDetail(request("billing/" + caseId + "?eventLimit=200&eventOffset=200"), { params: Promise.resolve({ caseId }) });
    const second = await secondResponse.json();
    assert.equal(first!.events.length, 200);
    assert.deepEqual(first!.eventsPagination, { limit: 200, offset: 0, hasMore: true, nextOffset: 200 });
    assert.equal(second.events.length, 5);
    assert.equal(second.eventsPagination.nextOffset, null);
    for (const key of ["billingCase", "documents", "changes", "incidents", "payments"]) assert.ok(key in second);
    for (const url of requests.filter(url => url.pathname.endsWith("billing_events"))) {
      assert.equal(url.searchParams.get("billing_case_id"), "eq." + caseId);
      assert.equal(url.searchParams.get("order"), "created_at.desc,id.desc");
    }
  });
});

test("billing rejects invalid pagination without reading and missing case remains 404", async () => {
  await fixture({}, async requests => {
    for (const query of ["limit=0", "offset=-1", "offset=1.2", "limit=NaN"]) {
      assert.equal((await billingList(request("billing?" + query))).status, 422);
    }
    assert.equal((await billingDetail(request("billing/" + caseId + "?eventOffset=-1"), { params: Promise.resolve({ caseId }) })).status, 422);
    assert.equal(requests.length, 0);
    assert.equal((await billingDetail(request("billing/" + caseId), { params: Promise.resolve({ caseId }) })).status, 404);
  });
});

test("all billing detail collections enumerate beyond the server preview cap with case binding", async () => {
  const collections = { documents: "billing_documents", changes: "billing_change_requests", events: "billing_events", incidents: "billing_incidents", payments: "billing_payments" };
  for (const [collection, table] of Object.entries(collections)) {
    const records = rows(1005).map(row => ({ ...row, billing_case_id: caseId }));
    const otherCase = rows(220).map(row => ({ ...row, billing_case_id: "other-case" }));
    await fixture({ billing_cases: [{ id: caseId }], [table]: [...otherCase, ...records] }, async requests => {
      const received: Row[] = [];
      let offset: number | null = 0;
      while (offset !== null) {
        const response = await billingDetail(request("billing/" + caseId + "?collection=" + collection + "&limit=200&offset=" + offset), { params: Promise.resolve({ caseId }) });
        assert.equal(response.status, 200);
        const page = await response.json();
        assert.equal(page.caseId, caseId);
        assert.equal(page.collection, collection);
        assert.deepEqual(Object.keys(page).sort(), ["ok", "caseId", "collection", "records", "pagination"].sort());
        received.push(...page.records);
        offset = page.pagination.nextOffset;
        assert.ok(received.length <= records.length, "Pagination must terminate");
      }
      assert.deepEqual(received.map(row => row.id), records.map(row => row.id), collection);
      assert.equal(requests.length, 12);
      for (const url of requests.filter(url => !url.pathname.endsWith("billing_cases"))) {
        assert.equal(url.pathname, "/rest/v1/" + table);
        assert.equal(url.searchParams.get("billing_case_id"), "eq." + caseId);
        assert.equal(url.searchParams.get("order"), (collection === "payments" ? "booked_at" : "created_at") + ".desc,id.desc");
        assert.equal(url.searchParams.get("limit"), "201");
      }
    });
  }
});

test("billing record collection validates fixed choices and pages before reading", async () => {
  await fixture({}, async requests => {
    for (const query of ["collection=outbox", "collection=documents&offset=-1", "collection=events&limit=0", "collection=documents&select=*", "collection=events&eventOffset=1"]) {
      const response = await billingDetail(request("billing/" + caseId + "?" + query), { params: Promise.resolve({ caseId }) });
      assert.equal(response.status, 422, query);
    }
    assert.equal(requests.length, 0);
    const missing = await billingDetail(request("billing/" + caseId + "?collection=documents"), { params: Promise.resolve({ caseId }) });
    assert.equal(missing.status, 404);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].searchParams.get("select"), "id");
  });
});

test("billing record helper defaults to 200 and retains truthful empty/error behavior", async () => {
  await fixture({ billing_cases: [{ id: caseId }], billing_payments: [] }, async () => {
    const page = await billing.listBillingCaseRecords(caseId, { collection: "payments" });
    assert.deepEqual(page!.pagination, { limit: 200, offset: 0, hasMore: false, nextOffset: null });
    assert.deepEqual(page!.records, []);
  });
  await fixture({}, async () => {
    await assert.rejects(() => billing.listBillingCaseRecords(caseId, { collection: "payments" }));
  }, 500);
});

const collections = {
  models: "voice_model_releases", evaluations: "voice_model_evaluations", prompts: "voice_prompt_versions",
  campaigns: "voice_call_campaigns", targets: "voice_call_targets", attempts: "voice_call_attempts",
  outcomes: "voice_call_outcomes", allowlist: "voice_test_allowlist", consents: "voice_contact_consents",
};
test("every voice collection enumerates past 100 with an explicit end and stable tie breaker", async () => {
  for (const [collection, table] of Object.entries(collections)) {
    await fixture({ [table]: rows(205) }, async requests => {
      const first = await voice.listVoicePlatformCollection({ collection, limit: 200 });
      const second = await voice.listVoicePlatformCollection({ collection, limit: 200, offset: 200 });
      assert.equal(first.rows!.length, 200, collection);
      assert.deepEqual(first.pagination, { limit: 200, offset: 0, hasMore: true, nextOffset: 200 });
      assert.equal(second.rows!.length, 5);
      assert.equal(second.pagination!.nextOffset, null);
      assert.equal(requests.length, 2);
      assert.equal(requests[0].searchParams.get("order"), (collection === "evaluations" ? "evaluated_at" : "created_at") + ".desc,id.desc");
      assert.equal(requests[0].searchParams.get("limit"), "201");
    });
  }
});

test("voice default dashboard keeps its existing shape and per-collection limits", async () => {
  await fixture(Object.fromEntries(Object.values(collections).map(table => [table, rows(105)])), async requests => {
    const body = await (await voiceList(request("voice-platform"))).json();
    assert.deepEqual(Object.keys(body).sort(), ["dashboard", "ok"]);
    assert.deepEqual(Object.keys(body.dashboard).sort(), ["enabled", "storageReady", "settings", ...Object.keys(collections)].sort());
    for (const collection of Object.keys(collections)) assert.equal(body.dashboard[collection].length, ["models", "evaluations", "prompts", "campaigns"].includes(collection) ? 50 : 100);
    assert.equal(requests.length, 10);
  });
});

test("voice collection route applies relation and status filters before pagination", async () => {
  const targets = [...rows(120).map(row => ({ ...row, campaign_id: caseId, status: "blocked" })), ...rows(5).map(row => ({ ...row, campaign_id: caseId, status: "queued" }))];
  await fixture({ voice_call_targets: targets }, async requests => {
    const body = await (await voiceList(request("voice-platform?collection=targets&campaignId=" + caseId + "&status=queued&limit=2&offset=2"))).json();
    assert.equal(body.rows.length, 2);
    assert.equal(body.pagination.nextOffset, 4);
    assert.equal(body.rows[0].id, "00003");
    assert.equal(requests[0].searchParams.get("campaign_id"), "eq." + caseId);
    assert.equal(requests[0].searchParams.get("status"), "eq.queued");
  });
});

test("voice mapped filters reach their canonical columns and defaults remain 50/100", async () => {
  const cases = [
    ["models", { lifecycle: "production", evalStatus: "passed", enabled: "false" }, { lifecycle: "eq.production", eval_status: "eq.passed", enabled: "eq.false" }],
    ["evaluations", { modelReleaseId: caseId, status: "passed" }, { model_release_id: "eq." + caseId, status: "eq.passed" }],
    ["prompts", { mode: "follow_up", status: "approved" }, { mode: "eq.follow_up", status: "eq.approved" }],
    ["campaigns", { promptVersionId: caseId }, { prompt_version_id: "eq." + caseId }],
    ["attempts", { targetId: caseId, modelReleaseId: caseId }, { target_id: "eq." + caseId, model_release_id: "eq." + caseId }],
    ["outcomes", { attemptId: caseId, outcomeCode: "callback_requested" }, { attempt_id: "eq." + caseId, outcome_code: "eq.callback_requested" }],
    ["allowlist", { enabled: "true", phone: "+49301234567" }, { enabled: "eq.true", phone_e164: "eq.+49301234567" }],
    ["consents", { requestId: "request-one", status: "granted" }, { request_id: "eq.request-one", status: "eq.granted" }],
  ] as const;
  for (const [collection, filters, expected] of cases) {
    await fixture({}, async requests => {
      const result = await voice.listVoicePlatformCollection({ collection, filters });
      assert.equal(result.pagination!.limit, ["models", "evaluations", "prompts", "campaigns"].includes(collection) ? 50 : 100);
      for (const [key, value] of Object.entries(expected)) assert.equal(requests[0].searchParams.get(key), value);
    });
  }
});

test("voice rejects unknown collections, unsupported filters and invalid pages before reading", async () => {
  await fixture({}, async requests => {
    for (const query of ["collection=workers", "collection=targets&offset=-1", "collection=targets&limit=0", "collection=models&campaignId=" + caseId, "collection=allowlist&enabled=maybe", "collection=targets&limti=5", "status=queued", "collection=targets&requestId=" + "x".repeat(161)]) {
      assert.equal((await voiceList(request("voice-platform?" + query))).status, 422, query);
    }
    assert.equal(requests.length, 0);
  });
});

test("voice disabled or missing storage never reports a successful empty page", async () => {
  await fixture({}, async requests => {
    process.env.VOICE_CALL_PLATFORM_ENABLED = "false";
    const result = await voice.listVoicePlatformCollection({ collection: "targets" });
    assert.equal(result.enabled, false);
    assert.equal(result.storageReady, false);
    assert.equal(result.rows, undefined);
    assert.equal(requests.length, 0);
  });
  await fixture({}, async () => {
    const result = await voice.listVoicePlatformCollection({ collection: "targets" });
    assert.equal(result.storageReady, false);
    assert.equal(result.rows, undefined);
  }, 404);
  await fixture({}, async () => {
    assert.equal((await voiceList(request("voice-platform?collection=targets"))).status, 502);
  }, 500);
});

test("new page routes preserve production authorization before any database read", async () => {
  await fixture({}, async requests => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.OPS_PORTAL_TOKEN = "synthetic-test-only";
    process.env.OPS_CLOUDFLARE_ACCESS_ISSUER = "https://synthetic.cloudflareaccess.com";
    process.env.OPS_CLOUDFLARE_ACCESS_AUD = "synthetic-test-only";
    process.env.OPS_REQUIRE_CLOUDFLARE_ACCESS = "true";
    const protectedRequest = (path: string) => new NextRequest("https://ops.example.invalid/api/ops/" + path, { headers: { host: "ops.example.invalid" } });
    assert.equal((await billingList(protectedRequest("billing?offset=200"))).status, 401);
    assert.equal((await billingDetail(protectedRequest("billing/" + caseId + "?eventOffset=200"), { params: Promise.resolve({ caseId }) })).status, 401);
    assert.equal((await billingDetail(protectedRequest("billing/" + caseId + "?collection=documents&offset=200"), { params: Promise.resolve({ caseId }) })).status, 401);
    assert.equal((await voiceList(protectedRequest("voice-platform?collection=targets&offset=100"))).status, 401);
    assert.equal(requests.length, 0);
  });
});
