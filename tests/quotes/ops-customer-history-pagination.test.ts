import test from "node:test";
import assert from "node:assert/strict";
import * as records from "@/lib/ops/customer-records";
import { GET } from "@/app/api/ops/customer-records/route";
import { NextRequest } from "next/server";

const requestId = "public-request-123";
const internalId = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";
const request = { id: internalId, request_id: requestId, customer_id: customerId, ac_deal_id: 42, trello_card_id: "card-1", customer: { id: customerId, email: "person@example.org", billing_email: "billing@example.org", cc_emails: ["cc@example.org"], phone: "+49123456789" } };
async function withDatabase(handler: (url: URL) => unknown, run: () => Promise<void>) {
  const oldFetch = globalThis.fetch;
  const previous = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  globalThis.fetch = (async (input, init) => {
    assert.equal(init?.method || "GET", "GET");
    assert.ok(init?.signal, "history and request reads must have a deadline");
    const result = handler(new URL(String(input)));
    return result instanceof Response ? result : Response.json(result);
  }) as typeof globalThis.fetch;
  try { await run(); } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}

test("request pages filter canonical customers and status in SQL before the limit", async () => {
  await withDatabase((url) => {
    assert.equal(url.pathname.split("/").at(-1), "master_requests");
    assert.match(url.searchParams.get("select") || "", /customer:master_customers!requests_customer_id_fkey!inner/);
    assert.equal(url.searchParams.get("organization.slug"), "eq.neontrip");
    assert.equal(url.searchParams.get("customer_id"), `eq.${customerId}`);
    assert.equal(url.searchParams.get("status"), "eq.pending");
    assert.match(url.searchParams.get("customer.or") || "", /billing_email\.eq/);
    assert.equal(url.searchParams.get("offset"), "10");
    assert.equal(url.searchParams.get("limit"), "3");
    assert.equal(url.searchParams.get("order"), "updated_at.desc.nullslast,id.asc");
    return Array.from({ length: 3 }, (_, i) => ({ ...request, id: `id-${i}`, attribution_raw: { secret: true } }));
  }, async () => {
    const result = await records.listCustomerRecordRequests({ customerId, query: "billing@example.org", status: "pending", limit: 2, offset: 10 });
    assert.equal(result.requests.length, 2);
    assert.equal(result.pagination.nextOffset, 12);
    assert.equal("attribution_raw" in result.requests[0], false);
  });
});

test("request and history validation rejects unknown modes/parameters/sources before reads", async () => {
  await withDatabase(() => { assert.fail("invalid request reached DB"); }, async () => {
    await assert.rejects(() => records.listCustomerRecordRequests({ offset: -1 }), /offset/);
    await assert.rejects(() => records.listCustomerRecordRequests({ query: "other:value" }), /query/);
    await assert.rejects(() => records.listCustomerRecordHistory({ requestId, source: "raw_metadata" as never }), /source/);
    for (const query of ["mode=wat", "mode=history&requestId=x&source=orders&sql=1", "mode=requests&status=pending&limti=2"]) {
      const response = await GET(new NextRequest(`http://localhost/api/ops/customer-records?${query}`, { headers: { host: "localhost" } }));
      assert.equal(response.status, 422);
    }
  });
});

for (const [source, table, binding] of [
  ["orders", "master_orders", internalId], ["sales", "crm_sales", internalId], ["quotes", "crm_quotes", internalId],
  ["communications", "master_communications", internalId], ["voice_calls", "voice_agent_calls", internalId],
  ["calls", "call_logs", requestId], ["followups", "followup_queue", requestId], ["plans", "lead_followup_plans", requestId],
  ["audits", "workflow_audit_log", requestId], ["outlook", "customer_email_messages", internalId],
  ["offers", "v_offer_history", requestId], ["quote_emails", "quote_email_log", requestId],
  ["inbound_emails", "email_agent_log", requestId], ["documents", "document_journey", customerId],
] as const) {
  test(`${source} reaches older history with schema-correct binding and no raw fields`, async () => {
    await withDatabase((url) => {
      if (url.pathname.endsWith("/master_requests")) {
        assert.equal(url.searchParams.get("request_id"), `eq.${requestId}`);
        assert.match(url.searchParams.get("select") || "", /requests_customer_id_fkey/);
        return [request];
      }
      assert.ok(url.pathname.endsWith(`/${table}`));
      assert.ok(decodeURIComponent(url.search).includes(binding));
      assert.equal(url.searchParams.get("offset"), "41");
      assert.equal(url.searchParams.get("limit"), "3");
      assert.match(url.searchParams.get("order") || "", /id\.asc/);
      assert.doesNotMatch(url.searchParams.get("select") || "", /\*|raw_|(?:^|,)metadata(?:,|$)|snapshot|token|error_message/);
      return [{ id: "old-41", subject: "Safe", metadata: { secret: true } }, { id: "old-42" }, { id: "old-43" }];
    }, async () => {
      const result = await records.listCustomerRecordHistory({ requestId, source, limit: 2, offset: 41 });
      assert.equal(result.available, true);
      assert.deepEqual(result.records.map((row) => row.id), ["old-41", "old-42"]);
      assert.equal(result.pagination.nextOffset, 43);
      assert.equal("metadata" in result.records[0], false);
    });
  });
}

test("version and image history joins all bound quotes before pagination", async () => {
  for (const source of ["quote_versions", "quote_version_images"] as const) {
    await withDatabase((url) => {
      if (url.pathname.endsWith("/master_requests")) return [request];
      const select = url.searchParams.get("select") || "";
      assert.match(select, /crm_quote_versions_quote_id_fkey!inner/);
      if (source === "quote_version_images") assert.match(select, /crm_quote_version_images_version_id_fkey!inner/);
      const prefix = source === "quote_versions" ? "quote" : "version.quote";
      assert.match(url.searchParams.get(`${prefix}.or`) || "", new RegExp(internalId));
      if (Number(url.searchParams.get("offset")) > 80) return [];
      assert.equal(url.searchParams.get("offset"), "80");
      return [{ id: "old-image", quote: { token: "never-return" } }];
    }, async () => {
      const result = await records.listCustomerRecordHistory({ requestId, source, offset: 80 });
      assert.equal(result.records.length, 1);
      assert.equal(result.pagination.nextOffset, null);
      assert.equal("quote" in result.records[0], false);
    });
  }
});

test("missing optional schema reports unavailable; arbitrary upstream failure is not an empty history", async () => {
  for (const [code, status] of [["42P01", 404], ["42501", 403]] as const) {
    await withDatabase((url) => url.pathname.endsWith("/master_requests") ? [request] : Response.json({ code, message: "private provider detail" }, { status }), async () => {
      if (code === "42P01") {
        const result = await records.listCustomerRecordHistory({ requestId, source: "outlook" });
        assert.equal(result.available, false);
        assert.equal(result.unavailableReason, "schema_unavailable");
        assert.equal(result.pagination.nextOffset, null);
        assert.doesNotMatch(JSON.stringify(result), /private/);
      } else await assert.rejects(() => records.listCustomerRecordHistory({ requestId, source: "outlook" }));
    });
  }
});

test("history never executes an unbound query when the request cannot be resolved", async () => {
  await withDatabase((url) => { assert.ok(url.pathname.endsWith("/master_requests")); return []; }, async () => {
    await assert.rejects(() => records.listCustomerRecordHistory({ requestId, source: "orders" }), /Vorgang/);
  });
});

test("short provider pages do not silently terminate history and repeated rows fail closed", async () => {
  for (const duplicate of [false, true]) {
    await withDatabase((url) => {
      if (url.pathname.endsWith("/master_requests")) return [request];
      const offset = Number(url.searchParams.get("offset"));
      if (offset >= 5) return [];
      return [{ id: duplicate ? "same-row" : `row-${offset}` }];
    }, async () => {
      if (duplicate) await assert.rejects(() => records.listCustomerRecordHistory({ requestId, source: "orders", limit: 3 }), /veraendert/);
      else {
        const page = await records.listCustomerRecordHistory({ requestId, source: "orders", limit: 3 });
        assert.deepEqual(page.records.map((row) => row.id), ["row-0", "row-1", "row-2"]);
        assert.equal(page.pagination.nextOffset, 3);
        const last = await records.listCustomerRecordHistory({ requestId, source: "orders", limit: 3, offset: 3 });
        assert.deepEqual(last.records.map((row) => row.id), ["row-3", "row-4"]);
        assert.equal(last.pagination.nextOffset, null);
      }
    });
  }
});

for (const source of ["email_orders", "email_quotes", "related_customers", "outlook_organization"] as const) {
  test(`${source} has a bounded contact binding and deterministic second page`, async () => {
    await withDatabase((url) => {
      if (url.pathname.endsWith("/master_requests")) return [request];
      assert.equal(url.searchParams.get("offset"), "100");
      assert.match(url.searchParams.get("order") || "", /id\.asc/);
      const filter = url.searchParams.get("customer.email") || url.searchParams.get("or") || "";
      assert.match(filter, /example\.org/);
      if (source === "email_orders") assert.match(url.searchParams.get("select") || "", /orders_customer_id_fkey!inner/);
      return [];
    }, async () => {
      const result = await records.listCustomerRecordHistory({ requestId, source, offset: 100 });
      assert.equal(result.available, true);
      assert.equal(result.pagination.nextOffset, null);
    });
  });
}

test("audit history returns explicit business text without raw metadata or provider errors", async () => {
  await withDatabase((url) => {
    if (url.pathname.endsWith("/master_requests")) return [request];
    assert.match(url.searchParams.get("select") || "", /summary:metadata->>summary/);
    assert.match(url.searchParams.get("select") || "", /note_text:metadata->>note_text/);
    if (Number(url.searchParams.get("offset")) > 0) return [];
    return [{ id: "audit-note", summary: "Customer requested a callback", note_text: "Call tomorrow", metadata: { credential: "never" }, error_message: "provider secret" }];
  }, async () => {
    const result = await records.listCustomerRecordHistory({ requestId, source: "audits" });
    assert.equal(result.records[0].summary, "Customer requested a callback");
    assert.equal(result.records[0].note_text, "Call tomorrow");
    assert.doesNotMatch(JSON.stringify(result), /credential|provider secret/);
  });
});

test("text search quotes PostgREST control characters instead of injecting filters", async () => {
  await withDatabase((url) => {
    assert.match(url.searchParams.get("customer.or") || "", /name\.ilike\."\*Acme\\",id\.neq\.1\)\*"/);
    return [];
  }, async () => { await records.listCustomerRecordRequests({ query: 'Acme",id.neq.1)' }); });
});

test("order history preserves older business addresses while dropping unexpected nested fields", async () => {
  await withDatabase((url) => {
    if (url.pathname.endsWith("/master_requests")) return [request];
    if (Number(url.searchParams.get("offset")) > 41) return [];
    return [{ id: "order-41", shipping_address: { address1: "Example street 1", city: "Berlin", access_token: "never" }, billing_address: { company: "Example", zip: "10115", raw_payload: { secret: true } } }];
  }, async () => {
    const result = await records.listCustomerRecordHistory({ requestId, source: "orders", offset: 41 });
    assert.deepEqual(result.records[0].shipping_address, { address1: "Example street 1", city: "Berlin" });
    assert.deepEqual(result.records[0].billing_address, { company: "Example", zip: "10115" });
  });
});

test("conflicting explicit request and query IDs reject before any database read", async () => {
  await withDatabase(() => { assert.fail("conflicting request IDs must not reach DB"); }, async () => {
    await assert.rejects(() => records.listCustomerRecordRequests({ requestId: "request-A", query: "request:request-B" }), (error: unknown) => Boolean(error && typeof error === "object" && "status" in error && error.status === 422));
  });
});

// The live PostgREST equality filter treats everything after `eq.` as the value.
// Quotes needed inside OR/IN expressions are not wrappers for a direct filter.
function matchesDirectEquality(url: URL, field: string, value: string) {
  const filter = url.searchParams.get(field);
  return filter === null || (filter.startsWith("eq.") && filter.slice(3) === value);
}

test("a request ID returned by the directory resolves all twenty history sources", async () => {
  await withDatabase((url) => {
    if (url.pathname.endsWith("/master_requests")) {
      if (Number(url.searchParams.get("offset") || 0) > 0) return [];
      return matchesDirectEquality(url, "request_id", requestId) ? [request] : [];
    }
    return [];
  }, async () => {
    const directory = await records.listCustomerRecordRequests({ limit: 1 });
    assert.equal((directory.requests[0] as Record<string, unknown>).request_id, requestId);
    for (const source of records.customerRecordHistorySources) {
      const history = await records.listCustomerRecordHistory({ requestId: String((directory.requests[0] as Record<string, unknown>).request_id), source, limit: 1 });
      assert.equal(history.available, true, source);
    }
  });
});

for (const filter of [{ requestId }, { query: `request:${requestId}` }, { status: "pending" }]) {
  test(`request directory direct equality filter matches its unquoted literal: ${Object.keys(filter)[0]}`, async () => {
    await withDatabase((url) => {
      if (Number(url.searchParams.get("offset") || 0) > 0) return [];
      return matchesDirectEquality(url, "request_id", requestId) && matchesDirectEquality(url, "status", "pending") ? [{ ...request, status: "pending" }] : [];
    }, async () => {
      const result = await records.listCustomerRecordRequests({ ...filter, limit: 1 });
      assert.equal(result.requests.length, 1);
      assert.equal((result.requests[0] as Record<string, unknown>).request_id, requestId);
    });
  });
}

for (const source of ["offers", "calls", "followups", "plans", "audits"] as const) {
  test(`${source} direct history binding reaches the matching record`, async () => {
    await withDatabase((url) => {
      if (url.pathname.endsWith("/master_requests")) return matchesDirectEquality(url, "request_id", requestId) ? [request] : [];
      if (Number(url.searchParams.get("offset") || 0) > 0) return [];
      const field = source === "audits" ? "document_id" : "request_id";
      return matchesDirectEquality(url, field, requestId) ? [{ id: "matching-history" }] : [];
    }, async () => {
      const result = await records.listCustomerRecordHistory({ requestId, source, limit: 1 });
      assert.deepEqual(result.records.map((row) => row.id), ["matching-history"]);
    });
  });
}

test("direct request literals retain reserved characters without adding query parameters", async () => {
  const literal = 'form-42,"(x)\\&status=blocked';
  await withDatabase((url) => {
    assert.equal(url.searchParams.get("status"), "eq.pending");
    assert.equal(url.searchParams.getAll("status").length, 1);
    assert.equal(url.searchParams.get("request_id"), `eq.${literal}`);
    if (Number(url.searchParams.get("offset") || 0) > 0) return [];
    return [{ ...request, request_id: literal }];
  }, async () => {
    const result = await records.listCustomerRecordRequests({ requestId: literal, status: "pending", limit: 1 });
    assert.equal((result.requests[0] as Record<string, unknown>).request_id, literal);
  });
});
