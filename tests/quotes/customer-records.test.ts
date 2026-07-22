import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCaseFlowSummary,
  buildCustomerDownstreamRepairPlan,
  buildSpecialCaseSummary,
  buildSalesRecoverySummary,
  buildCustomerUpdatePlan,
  buildCustomerUpdatePreview,
  customerOrganizationEmailDomains,
  deriveCustomerOpsState,
  duplicateCustomerTrelloCard,
  getCustomerRecordByRequestId,
  listMockupTrelloAttachments,
  parseTrelloCardIdentifier,
  resolveCustomerSearchMode,
  searchCustomerRecords,
  selectReferenceTrelloAttachment,
} from "../../src/lib/ops/customer-records";
import { QuoteValidationError } from "../../src/lib/quotes/validation";

const current = {
  email: "samuele@example.com",
  billingEmail: "samuele@example.com",
  ccEmails: [],
  firstName: "Samuele",
  lastName: "Micacchioni",
  phone: "+49 123",
  company: "NEONTRIP",
  displayName: "Samuele Micacchioni",
};

async function captureSupabaseSearch(
  query: string,
  expectedPath: string,
) {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const calls: URL[] = [];

  process.env.SUPABASE_URL = "https://supabase.example.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname.endsWith(expectedPath)) {
      calls.push(url);
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    await searchCustomerRecords(query);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) {
      delete process.env.SUPABASE_URL;
    } else {
      process.env.SUPABASE_URL = originalUrl;
    }
    if (originalKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    }
  }

  assert.equal(calls.length, 1);
  return calls[0];
}

async function captureCustomerRecordUrls(query: string) {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const calls: URL[] = [];

  process.env.SUPABASE_URL = "https://supabase.example.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    calls.push(url);

    if (url.pathname.endsWith("/rest/v1/master_customers") && url.searchParams.get("limit") === "10") {
      return new Response(
        JSON.stringify([
          {
            id: "customer_1",
            request_id: "request_public_1",
            email: "samuele@example.com",
            billing_email: "samuele@example.com",
            original_email: null,
            cc_emails: ["kollegin@example.com"],
            first_name: "Samuele",
            last_name: "Micacchioni",
            name: "Samuele Micacchioni",
            phone: "+49 123",
            company: "NEONTRIP",
            company_name: "NEONTRIP",
            updated_at: "2026-06-05T09:00:00.000Z",
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.pathname.endsWith("/rest/v1/master_requests") && url.searchParams.get("request_id") === "eq.request_public_1") {
      return new Response(
        JSON.stringify([
          {
            id: "request_row_1",
            request_id: "request_public_1",
            customer_id: "customer_1",
            title: "Samuele Micacchioni",
            status: "new",
            updated_at: "2026-06-05T09:00:00.000Z",
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    await searchCustomerRecords(query);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) {
      delete process.env.SUPABASE_URL;
    } else {
      process.env.SUPABASE_URL = originalUrl;
    }
    if (originalKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    }
  }

  return calls;
}

test("buildCustomerUpdatePlan normalizes email and keeps billing email in sync when both matched before", () => {
  const plan = buildCustomerUpdatePlan(current, {
    email: "  leonlaegender@gmail.com ",
  });

  assert.equal(plan.next.email, "leonlaegender@gmail.com");
  assert.equal(plan.next.billingEmail, "leonlaegender@gmail.com");
  assert.deepEqual(plan.masterPatch, {
    email: "leonlaegender@gmail.com",
    billing_email: "leonlaegender@gmail.com",
  });
  assert.deepEqual(plan.leadFollowupPatch, { customer_email: "leonlaegender@gmail.com" });
  assert.deepEqual(plan.documentJourneyPatch, { customer_email: "leonlaegender@gmail.com" });
});

test("buildCustomerUpdatePlan propagates name and company changes into followups", () => {
  const plan = buildCustomerUpdatePlan(current, {
    firstName: "Oliver",
    lastName: "Brehmer",
    company: "Golden Yellow",
  });

  assert.equal(plan.next.displayName, "Oliver Brehmer");
  assert.deepEqual(plan.masterPatch, {
    first_name: "Oliver",
    last_name: "Brehmer",
    company: "Golden Yellow",
    company_name: "Golden Yellow",
    name: "Oliver Brehmer",
  });
  assert.deepEqual(plan.followupPatch, {
    customer_name: "Oliver Brehmer",
    customer_company: "Golden Yellow",
  });
});

test("buildCustomerUpdatePlan stores normalized CC emails only on master customer", () => {
  const plan = buildCustomerUpdatePlan(current, {
    ccEmails: [" Kollegin@Example.com ", "kollegin@example.com", "begleitung@example.com"],
  });

  assert.deepEqual(plan.next.ccEmails, ["kollegin@example.com", "begleitung@example.com"]);
  assert.deepEqual(plan.masterPatch, {
    cc_emails: ["kollegin@example.com", "begleitung@example.com"],
  });
  assert.equal(plan.followupPatch, null);
  assert.equal(plan.leadFollowupPatch, null);
  assert.equal(plan.documentJourneyPatch, null);
});

test("buildCustomerUpdatePlan rejects invalid CC emails", () => {
  assert.throws(
    () =>
      buildCustomerUpdatePlan(current, {
        ccEmails: ["keine-mail"],
      }),
    QuoteValidationError,
  );
});

test("buildCustomerUpdatePlan rejects internal emails as customer contact", () => {
  assert.throws(
    () =>
      buildCustomerUpdatePlan(current, {
        email: "support@neontrip.de",
      }),
    QuoteValidationError,
  );
  assert.throws(
    () =>
      buildCustomerUpdatePlan(current, {
        billingEmail: "angebote@neontrip.de",
      }),
    QuoteValidationError,
  );
});

test("buildCustomerUpdatePlan rejects empty updates", () => {
  assert.throws(() => buildCustomerUpdatePlan(current, {}), QuoteValidationError);
});

test("buildCustomerUpdatePreview returns field diffs, impacted tables, and warnings", () => {
  const preview = buildCustomerUpdatePreview(
    {
      master: {
        id: "cust_1",
        request_id: "req_1",
        email: "samuele@example.com",
        billing_email: "samuele@example.com",
        first_name: "Samuele",
        last_name: "Micacchioni",
        phone: "+49 123",
        company: "NEONTRIP",
        company_name: "NEONTRIP",
        name: "Samuele Micacchioni",
      },
      followups: [
        {
          id: "fq_1",
          customer_email: "samuele@example.com",
          customer_name: "Samuele Micacchioni",
          customer_company: "NEONTRIP",
          status: "pending",
          scheduled_for: "2026-05-20T10:00:00.000Z",
        },
      ],
      plans: [{ id: "plan_1", customer_email: "samuele@example.com" }],
      documents: [{ id: "doc_1", customer_email: "samuele@example.com", customer_id: "cust_1" }],
    },
    {
      email: "leonlaegender@gmail.com",
      firstName: "Oliver",
      lastName: "Brehmer",
      company: "Golden Yellow",
    },
  );

  assert.equal(preview.requestId, "req_1");
  assert.deepEqual(
    preview.changes.map((entry) => entry.field),
    ["email", "billingEmail", "firstName", "lastName", "company", "displayName"],
  );
  assert.deepEqual(
    preview.impactedTables.map((entry) => ({ table: entry.table, rows: entry.rows })),
    [
      { table: "master_customers", rows: 1 },
      { table: "followup_queue", rows: 1 },
      { table: "lead_followup_plans", rows: 1 },
      { table: "document_journey", rows: 1 },
    ],
  );
  assert.equal(preview.warnings.length, 2);
});

test("buildCustomerDownstreamRepairPlan targets only drifting downstream rows", () => {
  const plan = buildCustomerDownstreamRepairPlan({
    master: {
      id: "cust_1",
      request_id: "req_1",
      email: "samuele@example.com",
      billing_email: "billing@example.com",
      first_name: "Samuele",
      last_name: "Micacchioni",
      phone: "+49 123",
      company: "NEONTRIP",
      company_name: "NEONTRIP",
      name: "Samuele Micacchioni",
    },
    followups: [
      {
        id: "fq_1",
        customer_email: "old@example.com",
        customer_name: "Old Name",
        customer_company: "Old Co",
      },
    ],
    plans: [{ id: "plan_1", customer_email: "old@example.com" }],
    documents: [{ id: "doc_1", customer_email: "old@example.com", customer_id: "cust_1" }],
  });

  assert.deepEqual(plan.masterPatch, {});
  assert.deepEqual(plan.followupPatch, {
    customer_email: "samuele@example.com",
    customer_name: "Samuele Micacchioni",
    customer_company: "NEONTRIP",
  });
  assert.deepEqual(plan.leadFollowupPatch, { customer_email: "samuele@example.com" });
  assert.deepEqual(plan.documentJourneyPatch, { customer_email: "samuele@example.com" });
});

test("buildCustomerDownstreamRepairPlan rejects already synced downstream state", () => {
  assert.throws(
    () =>
      buildCustomerDownstreamRepairPlan({
        master: {
          id: "cust_1",
          request_id: "req_1",
          email: "samuele@example.com",
          billing_email: "billing@example.com",
          first_name: "Samuele",
          last_name: "Micacchioni",
          phone: "+49 123",
          company: "NEONTRIP",
          company_name: "NEONTRIP",
          name: "Samuele Micacchioni",
        },
        followups: [
          {
            id: "fq_1",
            customer_email: "samuele@example.com",
            customer_name: "Samuele Micacchioni",
            customer_company: "NEONTRIP",
          },
        ],
        plans: [{ id: "plan_1", customer_email: "samuele@example.com" }],
        documents: [{ id: "doc_1", customer_email: "samuele@example.com", customer_id: "cust_1" }],
      }),
    QuoteValidationError,
  );
});

test("resolveCustomerSearchMode keeps ids and emails exact, names fuzzy", () => {
  assert.equal(resolveCustomerSearchMode("76b609a9-0190-44b1-bb76-6fa7c758f39a"), "request_id");
  assert.equal(resolveCustomerSearchMode("leonlaegender@gmail.com"), "email");
  assert.equal(resolveCustomerSearchMode("Samuele Micacchioni"), "name");
  assert.equal(resolveCustomerSearchMode("Golden Yellow"), "name");
  assert.equal(resolveCustomerSearchMode("+49 177 7390126"), "phone");
  assert.equal(resolveCustomerSearchMode("deal:11245"), "deal");
  assert.equal(resolveCustomerSearchMode("trello:FYXcIQ9K"), "trello");
});

test("searchCustomerRecords builds fuzzy name filters without double encoding", async () => {
  const url = await captureSupabaseSearch("Samuele Micacchioni", "/rest/v1/master_customers");

  assert.equal(
    url.searchParams.get("or"),
    "(name.ilike.*Samuele Micacchioni*,first_name.ilike.*Samuele Micacchioni*,last_name.ilike.*Samuele Micacchioni*,company.ilike.*Samuele Micacchioni*,company_name.ilike.*Samuele Micacchioni*)",
  );
});

test("searchCustomerRecords builds phone filters without encoded wildcards", async () => {
  const url = await captureSupabaseSearch("+49 177 7390126", "/rest/v1/master_customers");

  assert.equal(
    url.searchParams.get("or"),
    "(phone.ilike.*+49 177 7390126*,original_phone.ilike.*+49 177 7390126*,phone.ilike.*+491777390126*,original_phone.ilike.*+491777390126*)",
  );
});

test("searchCustomerRecords builds email filters without double encoding", async () => {
  const url = await captureSupabaseSearch("samuele@example.com", "/rest/v1/master_customers");

  assert.equal(
    url.searchParams.get("or"),
    "(email.eq.samuele@example.com,billing_email.eq.samuele@example.com,original_email.eq.samuele@example.com,cc_emails.cs.{samuele@example.com})",
  );
  assert.equal(url.searchParams.get("or")?.includes("%40"), false);
});

test("searchCustomerRecords builds trello filters without double encoding", async () => {
  const url = await captureSupabaseSearch("trello:FYXcIQ9K", "/rest/v1/master_requests");

  assert.equal(
    url.searchParams.get("or"),
    "(trello_card_id.eq.FYXcIQ9K,trello_card_url.ilike.*FYXcIQ9K*)",
  );
});

test("searchCustomerRecords builds Outlook mail filters with raw email values", async () => {
  const urls = await captureCustomerRecordUrls("samuele@example.com");
  const outlookUrls = urls.filter((entry) => entry.pathname.endsWith("/rest/v1/customer_email_messages"));
  const url = outlookUrls[0];

  assert.ok(url);
  assert.equal(
    url.searchParams.get("or"),
    "(linked_request_id.eq.request_row_1,linked_request_id.eq.request_public_1,linked_customer_id.eq.customer_1,matched_email.eq.samuele@example.com,matched_email.eq.kollegin@example.com,from_email.eq.samuele@example.com,from_email.eq.kollegin@example.com,to_emails.cs.{samuele@example.com},to_emails.cs.{kollegin@example.com},cc_emails.cs.{samuele@example.com},cc_emails.cs.{kollegin@example.com})",
  );
  assert.equal(url.searchParams.get("or")?.includes("%40"), false);
  assert.equal(url.searchParams.get("limit"), "30");
  assert.equal(outlookUrls.length, 2);
  assert.equal(
    outlookUrls[1]?.searchParams.get("or"),
    "(matched_email.ilike.*@example.com,from_email.ilike.*@example.com)",
  );
});

test("organization email domains exclude personal and internal providers", () => {
  assert.deepEqual(
    customerOrganizationEmailDomains([
      "kontakt@beispiel-gmbh.de",
      "andere@beispiel-gmbh.de",
      "privat@gmail.com",
      "intern@neontrip.de",
      null,
    ]),
    ["beispiel-gmbh.de"],
  );
});

test("getCustomerRecordByRequestId resolves legacy customer links through master_requests.customer_id", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://supabase.example.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname.endsWith("/rest/v1/master_customers") && url.searchParams.has("request_id")) {
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname.endsWith("/rest/v1/master_requests") && url.searchParams.get("request_id") === "in.(557413)") {
      return Response.json([{ request_id: "557413", customer_id: "customer_linked_1" }]);
    }
    if (url.pathname.endsWith("/rest/v1/master_customers") && url.searchParams.get("id") === "in.(customer_linked_1)") {
      return Response.json([{
        id: "customer_linked_1",
        request_id: null,
        email: "kontakt@beispiel-gmbh.de",
        cc_emails: [],
        name: "Legacy Kontakt",
        company: "Beispiel GmbH",
      }]);
    }
    if (url.pathname.endsWith("/rest/v1/master_requests") && url.searchParams.get("request_id") === "eq.557413") {
      return Response.json([{
        id: "request_row_557413",
        request_id: "557413",
        customer_id: "customer_linked_1",
        title: "Unternehmensschild",
        status: "new",
      }]);
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const result = await getCustomerRecordByRequestId("557413", { includeTrello: false });
    assert.equal(result.requestId, "557413");
    assert.equal(result.masterCustomerId, "customer_linked_1");
    assert.equal(result.request?.title, "Unternehmensschild");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});

test("searchCustomerRecords handles master customers without request id", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const calls: URL[] = [];

  process.env.SUPABASE_URL = "https://supabase.example.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    calls.push(url);

    if (url.pathname.endsWith("/rest/v1/master_customers") && url.searchParams.get("limit") === "10") {
      return new Response(
        JSON.stringify([
          {
            id: "customer_without_request",
            request_id: null,
            email: "anastasia.kaszuba@flatpay.de",
            billing_email: null,
            original_email: "anastasia.kaszuba@flatpay.de",
            cc_emails: [],
            first_name: "Anastasia",
            last_name: "Kaszuba",
            name: "Anastasia Kaszuba",
            phone: null,
            company: "Flatpay",
            company_name: "Flatpay",
            updated_at: "2026-03-29T20:00:31.312Z",
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const results = await searchCustomerRecords("anastasia.kaszuba@flatpay.de");

    assert.equal(results.length, 1);
    assert.equal(results[0]?.masterCustomerId, "customer_without_request");
    assert.equal(results[0]?.requestId, null);
    assert.equal(results[0]?.email, "anastasia.kaszuba@flatpay.de");
    assert.equal(results[0]?.request, null);
    assert.equal(calls.some((url) => [...url.searchParams.values()].some((value) => value.includes("eq.null"))), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) {
      delete process.env.SUPABASE_URL;
    } else {
      process.env.SUPABASE_URL = originalUrl;
    }
    if (originalKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    }
  }
});

test("parseTrelloCardIdentifier extracts short links from Trello URLs", () => {
  assert.equal(
    parseTrelloCardIdentifier("https://trello.com/c/FYXcIQ9K/12910-led-flex-samuele-micacchioni"),
    "FYXcIQ9K",
  );
  assert.equal(parseTrelloCardIdentifier(""), null);
});

test("selectReferenceTrelloAttachment prefers image.png and mockups keep full sorted list", () => {
  const attachments = [
    { id: "3", name: "Mockup10.jpg", url: "https://example.com/mockup10.jpg" },
    { id: "4", name: "Mockup02.jpg", url: "https://example.com/mockup02.jpg" },
    { id: "1", name: "image.webp", url: "https://example.com/image.webp" },
    { id: "2", name: "image.png", url: "https://example.com/image.png" },
  ];

  assert.equal(selectReferenceTrelloAttachment(attachments)?.id, "2");
  assert.deepEqual(
    listMockupTrelloAttachments(attachments).map((entry) => entry.id),
    ["4", "3"],
  );
});

test("deriveCustomerOpsState reflects latest vacation outcome with resume date", () => {
  const state = deriveCustomerOpsState(
    [
      {
        action: "customer_case_outcome_applied",
        created_at: "2026-05-20T08:00:00.000Z",
        metadata: {
          outcome: "vacation",
          reason: "Kunde zwei Wochen im Urlaub.",
          resume_at: "2026-06-03T10:00:00.000Z",
        },
      },
    ],
    {
      nextCallbackAt: null,
      planningReason: null,
      contactabilityStatus: null,
    },
  );

  assert.equal(state.status, "vacation");
  assert.equal(state.label, "Urlaub");
  assert.equal(state.detail, "Kunde zwei Wochen im Urlaub.");
  assert.equal(state.nextResumeAt, "2026-06-03T10:00:00.000Z");
  assert.equal(state.isClosed, false);
});

test("deriveCustomerOpsState falls back to callback or contact stop without explicit outcome audit", () => {
  const callbackState = deriveCustomerOpsState([], {
    nextCallbackAt: "2026-05-21T10:00:00.000Z",
    planningReason: "Rückruf angefragt.",
    contactabilityStatus: "callback",
  });

  assert.equal(callbackState.status, "callback");
  assert.equal(callbackState.label, "Rückruf");
  assert.equal(callbackState.nextResumeAt, "2026-05-21T10:00:00.000Z");

  const blockedState = deriveCustomerOpsState([], {
    nextCallbackAt: null,
    planningReason: null,
    contactabilityStatus: "blocked",
  });

  assert.equal(blockedState.status, "do_not_contact");
  assert.equal(blockedState.label, "Kontaktstopp");
  assert.equal(blockedState.isClosed, true);
});

test("buildSalesRecoverySummary marks active recovery with callback and actor", () => {
  const summary = buildSalesRecoverySummary(
    {
      audits: [
        {
          action: "customer_sales_recovery_started",
          created_at: "2026-05-20T08:00:00.000Z",
          metadata: {
            reason: "Angebot wurde gesehen, Kaufstatus telefonisch klären.",
            actor_label: "Daniel",
          },
        },
      ],
      quote: {
        viewed_at: "2026-05-19T13:34:00.000Z",
      },
      order: null,
      orderDiagnostic: {
        status: "unlinked",
        summary: "Noch kein Auftrag sichtbar",
      },
      master: {
        phone: "+49 123",
      },
    } as any,
    {
      nextCallbackAt: "2026-05-21T10:00:00.000Z",
    },
  );

  assert.equal(summary.status, "active");
  assert.equal(summary.startedAt, "2026-05-20T08:00:00.000Z");
  assert.equal(summary.reason, "Angebot wurde gesehen, Kaufstatus telefonisch klären.");
  assert.equal(summary.actorLabel, "Daniel");
  assert.equal(summary.nextCallbackAt, "2026-05-21T10:00:00.000Z");
  assert.equal(summary.phoneAvailable, true);
  assert.equal(summary.orderLinked, false);
});

test("buildSalesRecoverySummary marks unresolved viewed quote as ready and linked order as resolved", () => {
  const ready = buildSalesRecoverySummary(
    {
      audits: [],
      quote: {
        viewed_at: "2026-05-19T13:34:00.000Z",
      },
      order: null,
      orderDiagnostic: {
        status: "unlinked",
        summary: "Noch kein Auftrag sichtbar",
      },
      master: {
        phone: null,
      },
    } as any,
    {
      nextCallbackAt: null,
    },
  );

  assert.equal(ready.status, "ready");
  assert.equal(ready.phoneAvailable, false);

  const resolved = buildSalesRecoverySummary(
    {
      audits: [
        {
          action: "customer_sales_recovery_started",
          created_at: "2026-05-20T08:00:00.000Z",
          metadata: {
            reason: "Recovery gestartet.",
          },
        },
      ],
      quote: {
        viewed_at: "2026-05-19T13:34:00.000Z",
      },
      order: {
        shopify_order_number: "#1234",
      },
      orderDiagnostic: {
        status: "linked",
        summary: "Auftrag verknüpft",
      },
      master: {
        phone: "+49 123",
      },
    } as any,
    {
      nextCallbackAt: null,
    },
  );

  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.orderLinked, true);
});

test("buildCaseFlowSummary derives active shared flow state from audit log", () => {
  const summary = buildCaseFlowSummary({
    audits: [
      {
        action: "customer_case_flow_state",
        created_at: "2026-05-20T08:30:00.000Z",
        metadata: {
          flow_state: "active",
          flow_key: "repair",
          flow_label: "Repair Flow",
          step_key: "repair-email-drift",
          step_label: "Downstream auf Stammdaten angleichen",
          completed_keys: ["repair-email-drift"],
          total_steps: 3,
          actor_label: "Daniel",
        },
      },
    ],
  } as any);

  assert.equal(summary.status, "active");
  assert.equal(summary.flowKey, "repair");
  assert.equal(summary.flowLabel, "Repair Flow");
  assert.equal(summary.currentStepKey, "repair-email-drift");
  assert.equal(summary.currentStepLabel, "Downstream auf Stammdaten angleichen");
  assert.deepEqual(summary.completedKeys, ["repair-email-drift"]);
  assert.equal(summary.completedCount, 1);
  assert.equal(summary.totalSteps, 3);
  assert.equal(summary.updatedBy, "Daniel");
});

test("buildCaseFlowSummary falls back to idle when no shared flow audit exists", () => {
  const summary = buildCaseFlowSummary({ audits: [] } as any);

  assert.equal(summary.status, "idle");
  assert.equal(summary.flowKey, null);
  assert.equal(summary.completedCount, 0);
  assert.deepEqual(summary.completedKeys, []);
});

test("buildSpecialCaseSummary returns open special case from latest report", () => {
  const summary = buildSpecialCaseSummary({
    audits: [
      {
        action: "customer_special_case_reported",
        created_at: "2026-05-20T10:00:00.000Z",
        metadata: {
          special_case_kind: "dimmer_defect",
          special_case_note: "Dimmer kaputt, Kunde wartet auf Rückmeldung.",
          special_case_owner_name: "Daniel",
          special_case_due_at: "2026-05-22T10:00:00.000Z",
          special_case_urgent: true,
          actor_label: "Daniel",
        },
      },
    ],
  } as any);

  assert.equal(summary.status, "open");
  assert.equal(summary.kind, "dimmer_defect");
  assert.equal(summary.label, "Dimmer defekt");
  assert.equal(summary.detail, "Dimmer kaputt, Kunde wartet auf Rückmeldung.");
  assert.equal(summary.ownerName, "Daniel");
  assert.equal(summary.dueAt, "2026-05-22T10:00:00.000Z");
  assert.equal(summary.urgent, true);
  assert.equal(summary.reportedBy, "Daniel");
});

test("buildSpecialCaseSummary returns resolved when resolution is newer than report", () => {
  const summary = buildSpecialCaseSummary({
    audits: [
      {
        action: "customer_special_case_reported",
        created_at: "2026-05-20T10:00:00.000Z",
        metadata: {
          special_case_kind: "gift",
          special_case_note: "Schild als Geschenk freigegeben.",
          special_case_due_at: "2026-05-23T10:00:00.000Z",
          actor_label: "Fabienne",
        },
      },
      {
        action: "customer_special_case_resolved",
        created_at: "2026-05-20T12:00:00.000Z",
        metadata: {
          special_case_kind: "gift",
          actor_label: "Daniel",
        },
      },
    ],
  } as any);

  assert.equal(summary.status, "resolved");
  assert.equal(summary.kind, "gift");
  assert.equal(summary.label, "Geschenk / Kulanz");
  assert.equal(summary.dueAt, "2026-05-23T10:00:00.000Z");
  assert.equal(summary.resolvedBy, "Daniel");
  assert.equal(summary.resolvedAt, "2026-05-20T12:00:00.000Z");
});

test("duplicateCustomerTrelloCard reimports a copied Trello card with a new request id", async () => {
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalTrelloKey = process.env.TRELLO_API_KEY;
  const originalTrelloToken = process.env.TRELLO_TOKEN;
  const calls: Array<{ url: URL; method: string; body: any }> = [];
  const boardId = "63d10c34105771f01ccf4296";
  const listId = "64ca588f8bd547afc087a6ea";
  const sourceCardId = "64ca588f8bd547afc087a6eb";
  const copiedCardId = "650000000000000000000001";
  const sourceName = "LED Flex | Ada Lovelace | 100 cm";
  const copiedName = "LED Flex | Grace Hopper | 100 cm";
  const sourceDesc = "Beschreibung fuer kunde@example.com\nmit zweiter Zeile";
  const copiedDesc = "Beschreibung fuer grace@example.com\nmit zweiter Zeile";
  let createdRequest: any = null;
  let createdCustomer: any = null;
  const copiedFieldValues = new Map<string, string | null>([
    ["field-request-id", "source-request"],
    ["field-usage", "Ladenfront"],
    ["field-email", "kunde@example.com"],
    ["field-first-name", "Ada"],
    ["field-last-name", "Lovelace"],
  ]);

  process.env.SUPABASE_URL = "https://supabase.example.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.TRELLO_API_KEY = "trello-key";
  process.env.TRELLO_TOKEN = "trello-token";

  const customerRow = (requestId: string) => ({
    id: "customer-1",
    request_id: requestId,
    email: "kunde@example.com",
    billing_email: "kunde@example.com",
    cc_emails: [],
    first_name: "Ada",
    last_name: "Lovelace",
    name: "Ada Lovelace",
    phone: "+491234",
    company: "Example GmbH",
    company_name: "Example GmbH",
    updated_at: "2026-07-20T10:00:00.000Z",
  });
  const sourceRequest = {
    id: "request-row-source",
    request_id: "source-request",
    customer_id: "customer-1",
    title: "Musterkarte",
    description: sourceDesc,
    status: "offer_sent",
    deal_status: "quote_sent",
    segment: "NT-3",
    segment_status: "accepted",
    segment_confidence: 0.82,
    segment_source: "request_segmenter",
    s_kategorie: "Schildkroeten und Preise",
    size: "100 cm",
    color: ["Rot"],
    application: "Ladenfront",
    delivery_time: "2 Wochen",
    customer_type: "B2B",
    country: "DE",
    form_id: "source_form",
    trello_card_id: sourceCardId,
    trello_card_url: `https://trello.com/c/${sourceCardId}`,
    updated_at: "2026-07-20T10:00:00.000Z",
  };
  const customFields = [
    { id: "field-request-id", name: "nerdy-forms-id", type: "text" },
    { id: "field-usage", name: "Usage", type: "text" },
    { id: "field-email", name: "customer_email", type: "text" },
    { id: "field-first-name", name: "customer_first_name", type: "text" },
    { id: "field-last-name", name: "customer_last_name", type: "text" },
  ];
  const attachments = [
    { id: "attachment-1", name: "image.png", mimeType: "image/png", url: "https://trello.example/image.png" },
    { id: "attachment-2", name: "mockup-1.jpg", mimeType: "image/jpeg", url: "https://trello.example/mockup.jpg" },
  ];

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const method = String(init.method || "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });

    if (url.hostname === "api.trello.com") {
      if (url.pathname === "/1/search") {
        const query = url.searchParams.get("query");
        const cardId = query === createdRequest?.request_id ? copiedCardId : sourceCardId;
        return json({ cards: [{ id: cardId, name: copiedName, idBoard: boardId, url: `https://trello.com/c/${cardId}` }] });
      }
      if (url.pathname === `/1/boards/${boardId}/customFields`) return json(customFields);
      if (url.pathname === `/1/boards/${boardId}/lists`) {
        return json([{ id: listId, name: "Neue Anfrage", closed: false, pos: 1 }]);
      }
      if (url.pathname === `/1/cards/${sourceCardId}`) {
        return json({
          id: sourceCardId,
          name: sourceName,
          desc: sourceDesc,
          idBoard: boardId,
          idList: listId,
          customFieldItems: [
            { idCustomField: "field-request-id", value: { text: "source-request" } },
            { idCustomField: "field-usage", value: { text: "Ladenfront" } },
            { idCustomField: "field-email", value: { text: "kunde@example.com" } },
            { idCustomField: "field-first-name", value: { text: "Ada" } },
            { idCustomField: "field-last-name", value: { text: "Lovelace" } },
          ],
          attachments,
          actions: [],
        });
      }
      if (url.pathname === "/1/cards" && method === "POST") {
        return json({
          id: copiedCardId,
          idBoard: boardId,
          name: url.searchParams.get("name"),
          url: `https://trello.com/c/${copiedCardId}`,
          shortUrl: `https://trello.com/c/${copiedCardId}`,
        });
      }
      const copiedCustomFieldMatch = url.pathname.match(
        new RegExp(`^/1/cards/${copiedCardId}/customField/([^/]+)/item$`),
      );
      if (copiedCustomFieldMatch && method === "PUT") {
        copiedFieldValues.set(copiedCustomFieldMatch[1], body?.value?.text ?? null);
        return new Response("", { status: 200 });
      }
      if (url.pathname === `/1/cards/${copiedCardId}` && method === "PUT") {
        return new Response("", { status: 200 });
      }
      if (url.pathname === `/1/cards/${copiedCardId}`) {
        return json({
          id: copiedCardId,
          name: copiedName,
          desc: copiedDesc,
          idBoard: boardId,
          idList: listId,
          customFieldItems: [
            ...[...copiedFieldValues.entries()].map(([idCustomField, value]) => ({
              idCustomField,
              value: { text: value },
            })),
          ],
          attachments,
          actions: [],
        });
      }
      throw new Error(`Unexpected Trello call: ${method} ${url.pathname}`);
    }

    if (url.hostname === "supabase.example.co") {
      if (url.pathname.endsWith("/rest/v1/master_customers")) {
        if (method === "POST") {
          createdCustomer = { id: "customer-2", ...body };
          return json([createdCustomer]);
        }
        if (method === "PATCH") return new Response(null, { status: 204 });
        if (url.searchParams.get("request_id") === "eq.source-request") return json([customerRow("source-request")]);
        if (createdRequest && url.searchParams.get("request_id") === `eq.${createdRequest.request_id}`) {
          return json([createdCustomer]);
        }
        if (url.searchParams.get("id") === "eq.customer-1") return json([customerRow(createdRequest?.request_id || "source-request")]);
        if (url.searchParams.get("id") === "eq.customer-2") return json([createdCustomer]);
        return json([]);
      }
      if (url.pathname.endsWith("/rest/v1/master_requests")) {
        if (method === "POST") {
          createdRequest = { id: "request-row-created", ...body };
          return json([createdRequest]);
        }
        if (url.searchParams.has("attribution_raw->>idempotency_key")) return json([]);
        if (url.searchParams.get("trello_card_id") === `eq.${sourceCardId}`) return json([sourceRequest]);
        if (url.searchParams.get("request_id") === "eq.source-request") return json([sourceRequest]);
        if (createdRequest && url.searchParams.get("request_id") === `eq.${createdRequest.request_id}`) {
          return json([createdRequest]);
        }
        return json([]);
      }
      if (url.pathname.endsWith("/rest/v1/workflow_audit_log")) {
        if (method === "POST") return new Response(null, { status: 204 });
        return json([]);
      }
      if (url.pathname.endsWith("/rest/v1/sales_tasks")) {
        if (method === "POST") return json([{ id: "task-1", ...body, created_at: "2026-07-21T10:00:00.000Z" }]);
        return json([]);
      }
      if (method === "PATCH" || method === "DELETE") return new Response(null, { status: 204 });
      return json([]);
    }

    throw new Error(`Unexpected fetch: ${method} ${url.toString()}`);
  }) as typeof fetch;

  try {
    const result = await duplicateCustomerTrelloCard(
      "",
      {
        cardUrl: `https://trello.com/c/${sourceCardId}/musterkarte`,
        customer: { firstName: "Grace", lastName: "Hopper", email: "grace@example.com" },
        idempotencyKey: "duplicate-test-key",
      },
      { operatorName: "Daniel", mode: "local_bypass" },
    );

    assert.notEqual(result.requestId, "source-request");
    assert.equal(result.sourceRequestId, "source-request");
    assert.equal(result.customerId, "customer-2");
    assert.equal(result.cardId, copiedCardId);
    assert.equal(result.record.requestId, result.requestId);
    assert.equal(copiedFieldValues.get("field-request-id"), result.requestId);
    assert.equal(copiedFieldValues.get("field-email"), "grace@example.com");
    assert.equal(copiedFieldValues.get("field-first-name"), "Grace");
    assert.equal(copiedFieldValues.get("field-last-name"), "Hopper");

    const copyCall = calls.find((call) => call.url.hostname === "api.trello.com" && call.url.pathname === "/1/cards" && call.method === "POST");
    assert.equal(copyCall?.url.searchParams.get("idCardSource"), sourceCardId);
    assert.equal(copyCall?.url.searchParams.get("keepFromSource"), "all");
    assert.equal(copyCall?.url.searchParams.get("idList"), listId);

    assert.equal(createdRequest?.request_id, result.requestId);
    assert.equal(createdRequest?.customer_id, "customer-2");
    assert.equal(createdRequest?.status, "new");
    assert.equal(createdRequest?.deal_status, "open");
    assert.equal(createdRequest?.trello_card_id, copiedCardId);
    assert.equal(createdRequest?.attribution_raw?.auto_reply_suppressed, true);
    assert.equal(createdRequest?.attribution_raw?.idempotency_key, "duplicate-test-key");
    assert.equal(createdRequest?.attribution_raw?.source_request_id, "source-request");

    assert.equal(createdCustomer?.request_id, result.requestId);
    assert.equal(createdCustomer?.email, "grace@example.com");
    assert.equal(createdCustomer?.name, "Grace Hopper");
    assert.equal(
      calls.some(
        (call) =>
          call.url.pathname.endsWith("/rest/v1/master_customers") &&
          call.method === "PATCH" &&
          call.url.searchParams.get("id") === "eq.customer-1",
      ),
      false,
    );
    assert.equal(
      calls.some((call) => call.url.pathname.endsWith("/rest/v1/sales_tasks") && call.method === "POST" && call.body?.task_type === "call_new_inquiry"),
      true,
    );
    assert.equal(
      calls.some((call) => call.url.pathname.endsWith("/rest/v1/workflow_audit_log") && call.method === "POST" && call.body?.action === "customer_trello_card_duplicated"),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalSupabaseKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalSupabaseKey;
    if (originalTrelloKey === undefined) delete process.env.TRELLO_API_KEY;
    else process.env.TRELLO_API_KEY = originalTrelloKey;
    if (originalTrelloToken === undefined) delete process.env.TRELLO_TOKEN;
    else process.env.TRELLO_TOKEN = originalTrelloToken;
  }
});
