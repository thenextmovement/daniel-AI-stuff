import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCaseFlowSummary,
  buildCustomerDownstreamRepairPlan,
  buildSpecialCaseSummary,
  buildSalesRecoverySummary,
  buildCustomerUpdatePlan,
  buildCustomerUpdatePreview,
  deriveCustomerOpsState,
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

test("searchCustomerRecords builds trello filters without double encoding", async () => {
  const url = await captureSupabaseSearch("trello:FYXcIQ9K", "/rest/v1/master_requests");

  assert.equal(
    url.searchParams.get("or"),
    "(trello_card_id.eq.FYXcIQ9K,trello_card_url.ilike.*FYXcIQ9K*)",
  );
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
