import test from "node:test";
import assert from "node:assert/strict";
import { loadVoiceContextRecord } from "../../src/lib/ops/voice-context-record";
import { SupabaseRestError } from "../../src/lib/quotes/supabase-rest";
import { NextRequest } from "next/server";

const customerId = "11111111-1111-4111-8111-111111111111";
const internalRequestId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";
function fixture(businessId = "654321") {
  return {
    request: { id: internalRequestId, request_id: businessId, customer_id: customerId as string | null, title: "Testauftrag", description: "Nur synthetische Daten", status: "open", segment: null, size: "120 cm", color: ["Testfarbe"], application: "Wand", delivery_time: null, trello_card_id: null, trello_card_url: null },
    customer: { id: customerId, request_id: null as string | null, name: "Testkontakt", first_name: "Test", last_name: "Kontakt", company: null, company_name: "Beispielbetrieb", email: "kontakt@example.test", phone: "+491110000001" },
  };
}
async function withDb(run: (f: ReturnType<typeof fixture>, calls: URL[], setReply: (reply: (url: URL) => Response | undefined) => void) => Promise<void>, businessId = "654321") {
  const original = globalThis.fetch;
  const before = { ...process.env };
  const f = fixture(businessId), calls: URL[] = [];
  let reply: (url: URL) => Response | undefined = () => undefined;
  try {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    process.env.SUPABASE_URL = "https://database.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-test-key";
    delete process.env.OPS_OFFERS_API_KEY;
    for (const k of ["MICROSOFT_GRAPH_TENANT_ID", "AZURE_TENANT_ID", "MICROSOFT_GRAPH_CLIENT_ID", "AZURE_CLIENT_ID"]) delete process.env[k];
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://database.test");
      assert.ok(!init?.method || init.method === "GET");
      assert.equal(init?.cache, "no-store");
      calls.push(url);
      const customized = reply(url);
      if (customized) return customized;
      const table = url.pathname.split("/").pop();
      if (table === "master_requests") return Response.json([f.request]);
      if (table === "master_customers") return Response.json([f.customer]);
      if (["v_offer_history", "ops_offer_events", "customer_email_messages", "trello_card_aliases", "voice_call_sessions"].includes(table || "")) return Response.json([]);
      throw new Error("Unexpected dependency " + table);
    }) as typeof fetch;
    await run(f, calls, (value) => { reply = value; });
  } finally {
    globalThis.fetch = original;
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
  }
}

test("numeric business ID resolves its linked customer and uses internal UUID for mail", async () => {
  await withDb(async (_f, calls) => {
    const result = await loadVoiceContextRecord("654321", customerId);
    assert.equal(result.requestId, "654321");
    assert.equal(result.masterCustomerId, customerId);
    assert.equal(result.displayName, "Testkontakt");
    assert.equal(result.company, "Beispielbetrieb");
    assert.deepEqual(result.request.colors, ["Testfarbe"]);
    assert.equal(calls.length, 5);
    assert.equal(calls[0].searchParams.get("request_id"), "eq.654321");
    assert.equal(calls[1].searchParams.get("id"), "eq." + customerId);
    const filter = calls.find(x => x.pathname.endsWith("customer_email_messages"))!.searchParams.get("or")!;
    assert.match(filter, new RegExp("linked_request_id.eq." + internalRequestId));
    assert.ok(!filter.includes("654321"));
    assert.ok(!filter.includes("phone"));
  });
});

test("UUID business ID remains distinct from internal request UUID", async () => {
  await withDb(async (_f, calls) => {
    const result = await loadVoiceContextRecord(otherId, customerId);
    assert.equal(result.requestId, otherId);
    const filter = calls.find(x => x.pathname.endsWith("customer_email_messages"))!.searchParams.get("or")!;
    assert.ok(filter.includes(internalRequestId));
    assert.ok(!filter.includes(otherId));
  }, otherId);
});

test("selected customer mismatch cannot load offers or communications", async () => {
  await withDb(async (_f, calls) => {
    await assert.rejects(loadVoiceContextRecord("654321", otherId), /ausgewählten Kunden/);
    assert.equal(calls.length, 2);
  });
});

test("missing, duplicate and inconsistent request bindings fail explicitly", async () => {
  await withDb(async (f, _calls, setReply) => {
    setReply(url => url.pathname.endsWith("master_requests") ? Response.json([]) : undefined);
    await assert.rejects(loadVoiceContextRecord("654321"), /nicht gefunden/);
    setReply(url => url.pathname.endsWith("master_requests") ? Response.json([f.request, f.request]) : undefined);
    await assert.rejects(loadVoiceContextRecord("654321"), /nicht eindeutig/);
    setReply(url => url.pathname.endsWith("master_requests") ? Response.json([{ ...f.request, request_id: "654322" }]) : undefined);
    await assert.rejects(loadVoiceContextRecord("654321"), /nicht eindeutig/);
  });
});

test("unlinked legacy request requires one exact direct customer and does not use phone matching", async () => {
  await withDb(async (f, calls, setReply) => {
    f.request.customer_id = null;
    f.customer.request_id = "654321";
    const record = await loadVoiceContextRecord("654321");
    assert.equal(record.masterCustomerId, customerId);
    assert.equal(calls[1].searchParams.get("request_id"), "eq.654321");
    setReply(url => url.pathname.endsWith("master_customers") ? Response.json([f.customer, { ...f.customer, id: otherId }]) : undefined);
    await assert.rejects(loadVoiceContextRecord("654321"), /nicht eindeutig/);
  });
});

test("optional source failures retain the bound customer and report incomplete sources", async () => {
  await withDb(async (_f, _calls, setReply) => {
    setReply(url => /v_offer_history|ops_offer_events|customer_email_messages/.test(url.pathname) ? Response.json({ error: "unavailable" }, { status: 400 }) : undefined);
    const result = await loadVoiceContextRecord("654321");
    assert.equal(result.masterCustomerId, customerId);
    assert.deepEqual(result.optionalSources, { offer: false, outlook: false });
    assert.equal(result.quote, null);
    assert.deepEqual(result.communications, []);
  });
});

test("required source failure is a data error, not a customer-not-found result", async () => {
  await withDb(async (_f, _calls, setReply) => {
    setReply(url => url.pathname.endsWith("master_requests") ? Response.json({ error: "bad schema" }, { status: 400 }) : undefined);
    await assert.rejects(loadVoiceContextRecord("654321"), SupabaseRestError);
  });
});

test("mail with conflicting customer or request binding is excluded even if email matches", async () => {
  await withDb(async (_f, _calls, setReply) => {
    const mail = { id: "mail1", linked_request_id: null, linked_customer_id: null, matched_email: "kontakt@example.test", subject: "Test", body_preview: "Nur Test", direction: "inbound", received_at: "2026-01-01T12:00:00Z", sent_at: null, created_at: null, message_id: null, conversation_id: null };
    setReply(url => url.pathname.endsWith("customer_email_messages") ? Response.json([
      mail,
      { ...mail, id: "mail2", linked_request_id: internalRequestId, matched_email: null },
      { ...mail, id: "mail3", linked_customer_id: customerId, linked_request_id: otherId },
      { ...mail, id: "bad1", linked_customer_id: otherId, linked_request_id: internalRequestId },
      { ...mail, id: "bad2", linked_request_id: otherId },
      { ...mail, id: "bad3", matched_email: "someone@example.test" },
    ]) : undefined);
    const result = await loadVoiceContextRecord("654321");
    assert.deepEqual(result.communications.map(x => x.id), ["mail1", "mail2", "mail3"]);
  });
});

test("request and email filter punctuation stays literal and validation prevents invalid IDs", async () => {
  await withDb(async (f, calls) => {
    f.customer.email = 'test\",linked_customer_id.neq.\"@example.test';
    await loadVoiceContextRecord("654321");
    const filter = calls.find(x => x.pathname.endsWith("customer_email_messages"))!.searchParams.get("or")!;
    assert.ok(filter.includes('matched_email.eq."test\\",linked_customer_id.neq.\\"@example.test"'));
    const count = calls.length;
    await assert.rejects(loadVoiceContextRecord("654321", "wrong"), /Kundenzuordnung/);
    await assert.rejects(loadVoiceContextRecord("bad\nrequest"), /Vorgangsnummer/);
    assert.equal(calls.length, count);
  });
});

test("the real context API returns the selected numeric request without broad legacy lookups", async () => {
  await withDb(async (_f, calls) => {
    const { GET } = await import("../../src/app/api/ops/voice-copilot/context/route");
    const response = await GET(new NextRequest("http://localhost/api/ops/voice-copilot/context?requestId=654321&customerId=" + customerId, { headers: { host: "localhost" } }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(result.context.requestId, "654321");
    assert.equal(result.context.customer.displayName, "Testkontakt");
    assert.equal(result.context.request.title, "Testauftrag");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(calls.every(url => !/crm_sales|crm_quotes|master_orders|voice_agent_calls/.test(url.pathname)));
  });
});

test("context API distinguishes an unavailable database from a wrong or missing customer", async () => {
  await withDb(async (_f, _calls, setReply) => {
    const { GET } = await import("../../src/app/api/ops/voice-copilot/context/route");
    const request = (id = customerId) => new NextRequest(
      "http://localhost/api/ops/voice-copilot/context?requestId=654321&customerId=" + id,
      { headers: { host: "localhost" } },
    );
    const mismatch = await GET(request(otherId));
    assert.equal(mismatch.status, 409);
    assert.deepEqual((await mismatch.json()).issues, ["customer_binding_mismatch"]);
    setReply(url => url.pathname.endsWith("master_requests") ? Response.json([], { status: 200 }) : undefined);
    const missing = await GET(request());
    assert.equal(missing.status, 404);
    setReply(url => url.pathname.endsWith("master_requests") ? Response.json({ error: "bad schema" }, { status: 400 }) : undefined);
    const unavailable = await GET(request());
    assert.equal(unavailable.status, 502);
    assert.deepEqual(await unavailable.json(), { ok: false, error: "voice_data_unavailable" });
  });
});

test("production context API retains authentication before any customer data lookup", async () => {
  await withDb(async (_f, calls) => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.OPS_PORTAL_TOKEN = "synthetic-test-only";
    delete process.env.OPS_CLOUDFLARE_ACCESS_ISSUER;
    delete process.env.OPS_CLOUDFLARE_ACCESS_TEAM_DOMAIN;
    const { middleware } = await import("../../src/middleware");
    const response = await middleware(new NextRequest(
      "https://ops.example.test/api/ops/voice-copilot/context?requestId=654321&customerId=" + customerId,
      { headers: { host: "ops.example.test" } },
    ));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, error: "unauthorized" });
    assert.equal(calls.length, 0);
  });
});
