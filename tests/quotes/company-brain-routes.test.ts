import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST as POST_ACTION } from "@/app/api/ops/company-brain/actions/route";
import { POST as POST_RESOLVE } from "@/app/api/ops/company-brain/resolve/route";

function request(path: string, body: unknown) {
  return new NextRequest(`http://127.0.0.1:3100${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "127.0.0.1:3100" },
    body: JSON.stringify(body),
  });
}

function assertNoStore(response: Response) {
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  assert.match(response.headers.get("vary") || "", /Cookie/);
  assert.match(response.headers.get("vary") || "", /Cf-Access-Jwt-Assertion/);
}

async function withFetchTrap<T>(callback: () => Promise<T>) {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("unexpected downstream call");
  }) as typeof fetch;

  try {
    const result = await callback();
    assert.equal(calls, 0);
    return result;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function companyBrainActionRequest(overrides: Record<string, unknown> = {}) {
  return request("/api/ops/company-brain/actions", {
    actionKey: "guarded_offer_resend",
    requestId: "REQ-GUARD-1",
    offerId: "offer-guard-1",
    offerNumber: "A/N 14427",
    recipientEmail: "customer@example.com",
    confirmed: true,
    confirmationText: "Freigabe",
    ...overrides,
  });
}

async function withGuardedRetryFetchMock<T>(
  options: {
    offerOverride?: Record<string, unknown>;
    quoteEmailGuardRows?: unknown[];
    outlookGuardRows?: unknown[];
  },
  callback: (calls: string[]) => Promise<T>,
) {
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalOffersBaseUrl = process.env.NEONTRIP_OFFERS_BASE_URL;
  const originalOffersKey = process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY;
  const calls: string[] = [];

  process.env.SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  process.env.NEONTRIP_OFFERS_BASE_URL = "https://offers.example.test";
  process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = "offers-test-key";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = String(init?.method || "GET").toUpperCase();
    calls.push(`${method} ${url.toString()}`);

    if (url.hostname === "offers.example.test") {
      if (method === "GET" && url.pathname === "/api/internal/offers/offer-guard-1") {
        return json({
          offer: {
            offerId: "offer-guard-1",
            requestId: "REQ-GUARD-1",
            offerNumber: "14427",
            documentReference: "A/N 14427",
            trelloCardId: "trello-card-1",
            publicUrl: "https://offers.example.test/o/14427",
            status: "SENT",
            updatedAt: "2026-07-06T07:39:11.809Z",
            viewedAt: null,
            acceptedAt: null,
            acceptance: null,
            lock: { editable: true, lockLevel: "none", lockReason: null, requiresRevisionReason: false },
            offer: {
              customerCompany: null,
              customerFirstName: "Max",
              customerLastName: "Mustermann",
              customerEmail: "customer@example.com",
              customerPhone: null,
              validUntil: null,
              productionTime: null,
              notes: null,
              discountText: null,
              projectTitle: null,
              currency: "EUR",
              vatRate: 19,
            },
            items: [],
            images: [],
            totals: {},
            ...options.offerOverride,
          },
        });
      }
      if (method === "POST" && url.pathname === "/api/internal/offers/offer-guard-1/send") {
        return json({ sent: true, duplicate: false, eventId: "evt-should-not-send" });
      }
      return json({ error: "unexpected offers call" }, 500);
    }

    if (url.hostname === "supabase.example.test") {
      const table = url.pathname.split("/").pop() || "";
      if (table === "master_customers") {
        return json([{
          id: "customer-1",
          request_id: "REQ-GUARD-1",
          email: "customer@example.com",
          billing_email: null,
          cc_emails: [],
          first_name: "Max",
          last_name: "Mustermann",
          phone: null,
          company: null,
          company_name: null,
          name: "Max Mustermann",
          original_email: null,
          original_phone: null,
          updated_at: "2026-07-06T07:00:00.000Z",
        }]);
      }
      if (table === "master_requests") {
        return json([{
          id: "request-row-1",
          request_id: "REQ-GUARD-1",
          customer_id: "customer-1",
          trello_card_id: "trello-card-1",
          trello_card_url: "https://trello.com/c/test",
          title: "Test Request",
          description: null,
          status: "open",
          updated_at: "2026-07-06T07:00:00.000Z",
        }]);
      }
      if (table === "quote_email_log") {
        const isGuardLookup = url.searchParams.get("recipient_email") === "eq.customer@example.com"
          && url.searchParams.get("angebotsnummer") === "eq.14427";
        return json(isGuardLookup ? options.quoteEmailGuardRows || [] : []);
      }
      if (table === "customer_email_messages") {
        const isGuardLookup = url.searchParams.get("subject") === "ilike.*14427*";
        return json(isGuardLookup ? options.outlookGuardRows || [] : []);
      }
      if (table === "workflow_audit_log") {
        if (method === "POST") return json([{ id: "audit-row-1" }]);
        return json([]);
      }
      return json([]);
    }

    return json({ error: "unexpected fetch" }, 500);
  }) as typeof fetch;

  try {
    return await callback(calls);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalSupabaseKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalSupabaseKey;
    if (originalOffersBaseUrl === undefined) delete process.env.NEONTRIP_OFFERS_BASE_URL;
    else process.env.NEONTRIP_OFFERS_BASE_URL = originalOffersBaseUrl;
    if (originalOffersKey === undefined) delete process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY;
    else process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY = originalOffersKey;
  }
}

test("company brain action route requires explicit Freigabe before any downstream call", async () => {
  await withFetchTrap(async () => {
    const response = await POST_ACTION(request("/api/ops/company-brain/actions", {
      actionKey: "guarded_offer_resend",
      requestId: "REQ-SAFE-1",
      confirmed: false,
    }));
    const payload = await response.json();

    assert.equal(response.status, 422);
    assertNoStore(response);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /Bestätigung erforderlich/);
  });
});

test("company brain action route rejects unknown action keys before any downstream call", async () => {
  await withFetchTrap(async () => {
    const response = await POST_ACTION(request("/api/ops/company-brain/actions", {
      actionKey: "send_anyway",
      requestId: "REQ-SAFE-2",
      confirmed: true,
      confirmationText: "Freigabe",
    }));
    const payload = await response.json();

    assert.equal(response.status, 422);
    assertNoStore(response);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /Unbekannte Company-Brain-Aktion/);
  });
});

test("company brain action route rejects missing request ids before any downstream call", async () => {
  await withFetchTrap(async () => {
    const response = await POST_ACTION(request("/api/ops/company-brain/actions", {
      actionKey: "save_case_note",
      confirmed: true,
      confirmationText: "Freigabe",
    }));
    const payload = await response.json();

    assert.equal(response.status, 422);
    assertNoStore(response);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /Request-ID fehlt/);
  });
});

test("company brain action route creates trello-only internal fix tasks without customer lookup", async () => {
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalTaskTable = process.env.OPS_INTERNAL_TASKS_USE_DEDICATED_TABLE;
  const calls: string[] = [];

  process.env.SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  process.env.OPS_INTERNAL_TASKS_USE_DEDICATED_TABLE = "true";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = String(init?.method || "GET").toUpperCase();
    calls.push(`${method} ${url.toString()}`);

    if (url.hostname !== "supabase.example.test") return json({ error: "unexpected host" }, 500);
    const table = url.pathname.split("/").pop() || "";
    if (table === "ops_internal_tasks" && method === "POST") {
      return json([{
        id: "task-trello-only-1",
        title: "Automation fehlgeschlagen: Trello G6Clgcsz",
        description: "Interne Fix-Aufgabe.",
        status: "open",
        priority: "high",
        category: "problem",
        assignee_label: "Daniel",
        due_at: null,
        request_id: null,
        customer_name: null,
        customer_email: null,
        trello_card_id: "G6Clgcsz",
        source_app: "company_brain",
        source_ref: "company-brain:test",
        created_by: "Daniel",
        updated_by: "Daniel",
        completed_by: null,
        completed_at: null,
        metadata: { source_context: "trello_only" },
        created_at: "2026-07-08T10:00:00.000Z",
        updated_at: "2026-07-08T10:00:00.000Z",
      }]);
    }
    if (table === "workflow_audit_log") {
      if (method === "GET") return json([]);
      if (method === "POST") return json([{ id: "audit-trello-only-1" }]);
    }
    return json({ error: `unexpected ${method} ${table}` }, 500);
  }) as typeof fetch;

  try {
    const response = await POST_ACTION(request("/api/ops/company-brain/actions", {
      actionKey: "create_internal_task",
      trelloCardId: "G6Clgcsz",
      problemType: "automation_failed",
      title: "Automation fehlgeschlagen: Trello G6Clgcsz",
      description: "Interne Fix-Aufgabe.",
      operatorName: "Daniel",
      confirmed: true,
      confirmationText: "Freigabe",
    }));
    const payload = await response.json();

    assert.equal(response.status, 200);
    assertNoStore(response);
    assert.equal(payload.ok, true);
    assert.equal(payload.requestId, null);
    assert.equal(payload.customerCommunicationSent, false);
    assert.equal(payload.task.trelloCardId, "G6Clgcsz");
    assert.equal(calls.some((call) => call.includes("/rest/v1/master_customers")), false);
    assert.equal(calls.some((call) => call.includes("/rest/v1/master_requests")), false);
    assert.equal(calls.some((call) => call.includes("/api/internal/offers/")), false);
    assert.equal(calls.some((call) => call.includes("/rest/v1/ops_internal_tasks") && call.startsWith("POST ")), true);
    assert.equal(calls.some((call) => call.includes("/rest/v1/workflow_audit_log") && call.startsWith("POST ")), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalSupabaseKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalSupabaseKey;
    if (originalTaskTable === undefined) delete process.env.OPS_INTERNAL_TASKS_USE_DEDICATED_TABLE;
    else process.env.OPS_INTERNAL_TASKS_USE_DEDICATED_TABLE = originalTaskTable;
  }
});

test("company brain action route still blocks customer-facing actions without request ids", async () => {
  await withFetchTrap(async () => {
    const response = await POST_ACTION(request("/api/ops/company-brain/actions", {
      actionKey: "guarded_offer_resend",
      trelloCardId: "G6Clgcsz",
      confirmed: true,
      confirmationText: "Freigabe",
    }));
    const payload = await response.json();

    assert.equal(response.status, 422);
    assertNoStore(response);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /Request-ID fehlt/);
  });
});

test("company brain guarded resend blocks duplicate quote email evidence before sending", async () => {
  await withGuardedRetryFetchMock({
    quoteEmailGuardRows: [{
      id: "quote-email-1",
      recipient_email: "customer@example.com",
      angebotsnummer: "14427",
      subject: "Ihr NEONTRIP Angebot A/N 14427",
      status: "sent",
      sent_at: "2026-07-06T07:45:00.000Z",
      created_at: "2026-07-06T07:45:00.000Z",
    }],
  }, async (calls) => {
    const response = await POST_ACTION(companyBrainActionRequest());
    const payload = await response.json();

    assert.equal(response.status, 409);
    assertNoStore(response);
    assert.equal(payload.ok, false);
    assert.equal(payload.code, "company_brain_retry_blocked");
    assert.deepEqual(payload.customerCommunicationSent, false);
    assert.match(payload.blockers.join(" "), /Versandbeleg existiert bereits/);
    assert.equal(calls.some((call) => call.includes("/api/internal/offers/offer-guard-1/send")), false);
    assert.equal(calls.some((call) => call.includes("/rest/v1/workflow_audit_log") && call.startsWith("POST ")), true);
  });
});

test("company brain guarded resend blocks Outlook bounce evidence before sending", async () => {
  await withGuardedRetryFetchMock({
    outlookGuardRows: [{
      id: "message-1",
      direction: "outbound",
      matched_email: "customer@example.com",
      subject: "Unzustellbar: Ihr NEONTRIP Angebot A/N 14427",
      body_preview: "Die Nachricht konnte nicht zugestellt werden: recipient unknown customer@example.com",
      sent_at: "2026-07-06T07:46:00.000Z",
      created_at: "2026-07-06T07:46:00.000Z",
      to_emails: ["customer@example.com"],
    }],
  }, async (calls) => {
    const response = await POST_ACTION(companyBrainActionRequest());
    const payload = await response.json();

    assert.equal(response.status, 409);
    assertNoStore(response);
    assert.equal(payload.ok, false);
    assert.equal(payload.code, "company_brain_retry_blocked");
    assert.deepEqual(payload.customerCommunicationSent, false);
    assert.match(payload.blockers.join(" "), /Outlook-Bounce liegt/);
    assert.equal(calls.some((call) => call.includes("/api/internal/offers/offer-guard-1/send")), false);
    assert.equal(calls.some((call) => call.includes("/rest/v1/workflow_audit_log") && call.startsWith("POST ")), true);
  });
});

test("company brain guarded resend blocks offers from a different request before sending", async () => {
  await withGuardedRetryFetchMock({
    offerOverride: {
      requestId: "REQ-OTHER-CASE",
    },
  }, async (calls) => {
    const response = await POST_ACTION(companyBrainActionRequest());
    const payload = await response.json();

    assert.equal(response.status, 409);
    assertNoStore(response);
    assert.equal(payload.ok, false);
    assert.equal(payload.code, "company_brain_retry_blocked");
    assert.deepEqual(payload.customerCommunicationSent, false);
    assert.match(payload.blockers.join(" "), /Angebot gehört zu Request REQ-OTHER-CASE/);
    assert.equal(calls.some((call) => call.includes("/api/internal/offers/offer-guard-1/send")), false);
    assert.equal(calls.some((call) => call.includes("/rest/v1/workflow_audit_log") && call.startsWith("POST ")), true);
  });
});

test("company brain action route does not expose raw Supabase details to clients", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://supabase.example.com";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
  globalThis.fetch = (async () => new Response("internal secret sql detail", { status: 500 })) as typeof fetch;

  try {
    const response = await POST_ACTION(request("/api/ops/company-brain/actions", {
      actionKey: "save_case_note",
      requestId: "REQ-SUPABASE-FAIL",
      confirmed: true,
      confirmationText: "Freigabe",
      note: "Interne Notiz",
    }));
    const payload = await response.json();

    assert.equal(response.status, 500);
    assertNoStore(response);
    assert.equal(payload.ok, false);
    assert.equal(payload.code, "supabase_error");
    assert.equal("details" in payload, false);
    assert.doesNotMatch(JSON.stringify(payload), /internal secret sql detail/);
    assert.doesNotMatch(JSON.stringify(payload), /service-role-secret/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});

test("company brain resolve route returns no-store validation errors", async () => {
  await withFetchTrap(async () => {
    const response = await POST_RESOLVE(request("/api/ops/company-brain/resolve", {
      query: "",
    }));
    const payload = await response.json();

    assert.equal(response.status, 400);
    assertNoStore(response);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /mindestens 2 Zeichen/);
  });
});
