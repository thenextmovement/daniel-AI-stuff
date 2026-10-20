import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDunningCases,
  loadDunningEmailEvidence,
  loadCompleteMirror,
  mirrorSourceHealth,
  createDunningActionPreview,
  dunningCaseMatchesQuery,
  dunningPaymentExceptionTag,
  dunningStageLabel,
  nextDunningSchedule,
  normalizeDunningOrderNumber,
} from "../../src/lib/ops/dunning";
import type { DunningCaseSummary } from "../../src/lib/ops/dunning";
import { sortDunningCases } from "../../src/lib/ops/dunning-sort";
import { createDunningCourtApplicationPreview } from "../../src/lib/ops/dunning-court-application";
import type { DunningCourtProfile } from "../../src/lib/ops/dunning-court";

type BuildInput = Parameters<typeof buildDunningCases>[0];

function order(
  overrides: Partial<BuildInput["orders"][number]> = {},
): BuildInput["orders"][number] {
  return {
    shopify_order_id: "1234567890",
    name: "#NEONT5000",
    financial_status: "pending",
    fulfillment_status: "fulfilled",
    total_price: 119,
    total_outstanding: 119,
    currency: "EUR",
    email: "kunde@example.com",
    kunde: "Max Muster",
    kunde_email: "kunde@example.com",
    tags: "",
    created_at: "2026-08-01T10:00:00.000Z",
    cancelled_at: null,
    ingested_at: "2026-08-01T10:05:00.000Z",
    ship_address: {
      company: "Muster GmbH",
      first_name: "Max",
      last_name: "Muster",
      city: "Viersen",
    },
    bill_address: {
      company: "Muster GmbH",
      first_name: "Max",
      last_name: "Muster",
      city: "Viersen",
    },
    phone: "+49 211 123456",
    ...overrides,
  };
}

function candidate(
  overrides: Partial<BuildInput["candidates"][number]> = {},
): BuildInput["candidates"][number] {
  return {
    shopify_order_id: "1234567890",
    shopify_order_name: "#NEONT5000",
    shopify_order_created_at: "2026-08-01T10:00:00.000Z",
    shopify_email_hint: "kunde@example.com",
    shopify_company_hint: "Muster GmbH",
    easybill_document_id: "88001",
    easybill_invoice_number: "2026-0815",
    easybill_document_created_at: "2026-08-01T11:00:00.000Z",
    easybill_due_date: "2026-08-15",
    amount_due_cents: 11900,
    currency: "EUR",
    preliminary_only: true,
    ...overrides,
  };
}

function input(overrides: Partial<BuildInput> = {}): BuildInput {
  return {
    orders: [order()],
    statuses: [],
    sendlogs: [],
    locks: [],
    audits: [],
    messages: [],
    candidates: [candidate()],
    intakeFresh: true,
    now: new Date("2026-08-25T12:00:00.000Z"),
    ...overrides,
  };
}

test("order numbers and current stage labels are normalized deterministically", () => {
  assert.equal(normalizeDunningOrderNumber(" ##neont2993 "), "#NEONT2993");
  assert.equal(normalizeDunningOrderNumber("2993"), null);
  assert.equal(dunningStageLabel(6), "3. und letzte Mahnung");
  assert.equal(
    dunningStageLabel(4, "legacy"),
    "Letzte Mahnung vor Inkasso (Altbestand)",
  );
});

test("dunning cases sort in both directions with missing dates always last", () => {
  const [base] = buildDunningCases(input());
  assert.ok(base);
  const cases: DunningCaseSummary[] = [
    {
      ...base,
      key: "charlie",
      orderNumber: "#NEONT5003",
      company: "Charlie GmbH",
      customerName: "Clara Beispiel",
      amountCents: 30000,
      currentStage: 2,
      daysOverdue: null,
      nextActionAt: null,
      orderCreatedAt: null,
      lastActivityAt: null,
    },
    {
      ...base,
      key: "alpha",
      orderNumber: "#NEONT5001",
      company: "Alpha GmbH",
      customerName: "Anna Beispiel",
      amountCents: 10000,
      currentStage: 5,
      daysOverdue: 20,
      nextActionAt: "2026-08-28T08:00:00.000Z",
      orderCreatedAt: "2026-01-01T08:00:00.000Z",
      lastActivityAt: "2026-08-25T08:00:00.000Z",
    },
    {
      ...base,
      key: "beta",
      orderNumber: "#NEONT5002",
      company: "Beta GmbH",
      customerName: "Ben Beispiel",
      amountCents: 20000,
      currentStage: 1,
      daysOverdue: 5,
      nextActionAt: "2026-08-27T08:00:00.000Z",
      orderCreatedAt: "2026-06-01T08:00:00.000Z",
      lastActivityAt: "2026-08-20T08:00:00.000Z",
    },
  ];
  const keys = (sort: Parameters<typeof sortDunningCases>[1]) =>
    sortDunningCases(cases, sort).map((entry) => entry.key);

  assert.deepEqual(keys("priority"), ["alpha", "beta", "charlie"]);
  assert.deepEqual(keys("amount_desc"), ["charlie", "beta", "alpha"]);
  assert.deepEqual(keys("amount_asc"), ["alpha", "beta", "charlie"]);
  assert.deepEqual(keys("stage_desc"), ["alpha", "charlie", "beta"]);
  assert.deepEqual(keys("stage_asc"), ["beta", "charlie", "alpha"]);
  assert.deepEqual(keys("next_action_asc"), ["beta", "alpha", "charlie"]);
  assert.deepEqual(keys("next_action_desc"), ["alpha", "beta", "charlie"]);
  assert.deepEqual(keys("overdue_desc"), ["alpha", "beta", "charlie"]);
  assert.deepEqual(keys("overdue_asc"), ["beta", "alpha", "charlie"]);
  assert.deepEqual(keys("order_oldest"), ["alpha", "beta", "charlie"]);
  assert.deepEqual(keys("order_newest"), ["beta", "alpha", "charlie"]);
  assert.deepEqual(keys("activity_desc"), ["alpha", "beta", "charlie"]);
  assert.deepEqual(keys("activity_asc"), ["beta", "alpha", "charlie"]);
  assert.deepEqual(keys("party_asc"), ["alpha", "beta", "charlie"]);
  assert.deepEqual(keys("party_desc"), ["charlie", "beta", "alpha"]);
  assert.deepEqual(
    cases.map((entry) => entry.key),
    ["charlie", "alpha", "beta"],
  );
});

test("business-day schedules match the six-stage T099 cadence", () => {
  assert.equal(
    nextDunningSchedule({
      nextStage: 1,
      orderCreatedAt: "2026-08-21T10:00:00Z",
      easybillCreatedAt: null,
      dueDate: null,
      previousStageSentAt: null,
    }),
    "2026-08-26T10:00:00.000Z",
  );
  assert.equal(
    nextDunningSchedule({
      nextStage: 2,
      orderCreatedAt: null,
      easybillCreatedAt: null,
      dueDate: null,
      previousStageSentAt: "2026-08-21T10:00:00Z",
    }),
    "2026-08-27T10:00:00.000Z",
  );
  assert.equal(
    nextDunningSchedule({
      nextStage: 7,
      orderCreatedAt: null,
      easybillCreatedAt: null,
      dueDate: null,
      previousStageSentAt: null,
    }),
    null,
  );
});

test("a fresh, due live candidate becomes an actionable first-stage case", () => {
  const [entry] = buildDunningCases(input());
  assert.equal(entry?.orderNumber, "#NEONT5000");
  assert.equal(entry?.company, "Muster GmbH");
  assert.equal(entry?.amountCents, 11900);
  assert.equal(entry?.currentStage, 0);
  assert.deepEqual(entry?.insolvencyIdentity, {
    kind: "company",
    companyName: "Muster GmbH",
    firstName: "Max",
    lastName: "Muster",
    locality: "Viersen",
    complete: true,
  });
  assert.equal(entry?.insolvencyCheck, null);
  assert.equal(entry?.nextStage, 1);
  assert.equal(entry?.state, "action_required");
  assert.equal(entry?.sendEligible, true);
  assert.equal(entry?.nextActionKind, "customer_email");
  assert.equal(entry?.nextActionAt, entry?.scheduledAt);
  assert.deepEqual(entry?.blockers, []);
  const preview = createDunningActionPreview(entry!);
  assert.equal(preview?.confirmationPhrase, "MAHNSTUFE 1 SENDEN #NEONT5000");
  assert.equal(preview?.allowed, true);
  assert.match(preview?.snapshotHash || "", /^[a-f0-9]{64}$/);
  assert.equal(dunningCaseMatchesQuery(entry!, "+49 211"), true);
  assert.equal(dunningCaseMatchesQuery(entry!, "Muster 5000"), true);
  assert.equal(dunningCaseMatchesQuery(entry!, "unbekannt"), false);
});

test("the verified final reminder waits seven days before legal review", () => {
  const sentAt = "2026-08-10T08:01:00.000Z";
  const lockKey =
    "e936881a-fe32-4d94-aa1d-eaffcf4a75be:T099:PAYMENT_COLLECTION:1234567890:S6";
  const locks: BuildInput["locks"] = [
    {
      request_id: lockKey,
      locked_at: "2026-08-10T08:00:00.000Z",
      message_id: "message-6",
      internet_message_id: "internet-6",
      conversation_id: "conversation-6",
      status: "draft_created",
      attempt_count: 1,
      lease_until: sentAt,
      last_error: null,
      updated_at: sentAt,
    },
  ];
  const messages: BuildInput["messages"] = [
    {
      id: "mail-out-6",
      message_id: "message-6",
      internet_message_id: "internet-6",
      conversation_id: "conversation-6",
      direction: "outbound",
      from_email: "support@neontrip.de",
      from_name: "NEONTRIP",
      to_emails: ["kunde@example.com"],
      cc_emails: [],
      bcc_emails: [],
      subject: "3. und letzte Mahnung #NEONT5000",
      body_preview: "Letzte Mahnung",
      received_at: null,
      sent_at: sentAt,
      message_created_at: sentAt,
      source: "outlook",
      created_at: sentAt,
    },
  ];
  const audits: BuildInput["audits"] = [
    {
      id: "audit-6",
      document_id: "1234567890",
      workflow_name: "TICKET-099 Existing Ledger Sender",
      action: "customer_stage_sent_verified",
      status: "sent",
      error_message: null,
      metadata: {
        lock_key: lockKey,
        stage: 6,
        provider_message_id: "message-6",
        provider_internet_message_id: "internet-6",
        provider_conversation_id: "conversation-6",
        recipient: "kunde@example.com",
        sent_at: sentAt,
        attachment_verified: true,
        pdf_sha256: "abc123",
        attachment_content_sha256: "abc123",
        pdf_bytes: 1200,
      },
      created_at: "2026-08-10T08:02:00.000Z",
    },
  ];

  const [waiting] = buildDunningCases(
    input({
      locks,
      audits,
      messages,
      now: new Date("2026-08-16T12:00:00.000Z"),
    }),
  );
  assert.equal(waiting?.currentStage, 6);
  assert.equal(waiting?.state, "final_wait");
  assert.equal(waiting?.finalReminderWaiting, true);
  assert.equal(waiting?.legalReviewReady, false);
  assert.equal(waiting?.legalReviewDueAt, "2026-08-17T08:01:00.000Z");

  const [ready] = buildDunningCases(
    input({
      locks,
      audits,
      messages,
      now: new Date("2026-08-17T08:01:00.000Z"),
    }),
  );
  assert.equal(ready?.state, "court_review");
  assert.equal(ready?.finalReminderWaiting, false);
  assert.equal(ready?.legalReviewReady, true);
  assert.equal(ready?.nextActionLabel, "Solvenz und Gericht prüfen");
});

test("a customer reply after the last verified stage blocks all automatic continuation", () => {
  const locks: BuildInput["locks"] = [
    {
      request_id:
        "e936881a-fe32-4d94-aa1d-eaffcf4a75be:T099:PAYMENT_COLLECTION:1234567890:S1",
      locked_at: "2026-08-10T08:00:00.000Z",
      message_id: "message-1",
      internet_message_id: "internet-1",
      conversation_id: "conversation-1",
      status: "draft_created",
      attempt_count: 1,
      lease_until: "2026-08-10T08:01:00.000Z",
      last_error: null,
      updated_at: "2026-08-10T08:01:00.000Z",
    },
  ];
  const messages: BuildInput["messages"] = [
    {
      id: "mail-out-1",
      message_id: "message-1",
      internet_message_id: "internet-1",
      conversation_id: "conversation-1",
      direction: "outbound",
      from_email: "info@neontrip.de",
      from_name: "NEONTRIP Kundendienst",
      to_emails: ["kunde@example.com"],
      cc_emails: [],
      bcc_emails: [],
      subject: "Kurze Rückfrage zu Ihrer Rechnung #NEONT5000",
      body_preview: "Zahlungserinnerung",
      received_at: null,
      sent_at: "2026-08-10T08:01:00.000Z",
      message_created_at: "2026-08-10T08:01:00.000Z",
      source: "outlook",
      created_at: "2026-08-10T08:01:00.000Z",
    },
    {
      id: "mail-1",
      message_id: "reply-1",
      internet_message_id: "reply-internet-1",
      conversation_id: "conversation-1",
      direction: "inbound",
      from_email: "kunde@example.com",
      from_name: "Max Muster",
      to_emails: ["info@daranova.de"],
      cc_emails: [],
      bcc_emails: [],
      subject: "Re: Kurze Rückfrage zu Ihrer Rechnung #NEONT5000",
      body_preview: "Wir klären das intern.",
      received_at: "2026-08-11T09:00:00.000Z",
      sent_at: null,
      message_created_at: "2026-08-11T09:00:00.000Z",
      source: "outlook",
      created_at: "2026-08-11T09:01:00.000Z",
    },
  ];
  const audits: BuildInput["audits"] = [
    {
      id: "audit-1",
      document_id: "1234567890",
      workflow_name: "TICKET-099 Existing Ledger Sender",
      action: "customer_stage_sent_verified",
      status: "sent",
      error_message: null,
      metadata: {
        lock_key:
          "e936881a-fe32-4d94-aa1d-eaffcf4a75be:T099:PAYMENT_COLLECTION:1234567890:S1",
        stage: 1,
        provider_message_id: "message-1",
        provider_internet_message_id: "internet-1",
        provider_conversation_id: "conversation-1",
        recipient: "kunde@example.com",
        sent_at: "2026-08-10T08:01:00.000Z",
        attachment_verified: true,
      },
      created_at: "2026-08-10T08:02:00.000Z",
    },
  ];
  const [entry] = buildDunningCases(input({ locks, audits, messages }));
  assert.equal(entry?.currentStage, 1);
  assert.equal(entry?.nextStage, 2);
  assert.equal(entry?.customerReplied, true);
  assert.equal(entry?.state, "reply_received");
  assert.equal(entry?.sendEligible, false);
  assert.ok(
    entry?.blockers.includes("Neue Kundenantwort muss zuerst geprüft werden"),
  );
});

test("legacy final-warning cases such as NEONT2993 go to court review, never back to stage one", () => {
  const legacyOrder = order({
    shopify_order_id: "2993000",
    name: "#NEONT2993",
  });
  const statuses: BuildInput["statuses"] = [
    {
      shopify_order_number: "#NEONT2993",
      mahnstufe: 4,
      last_sent_at: "2026-06-24T08:00:00.000Z",
      next_due_at: null,
      paused: false,
      note: null,
      updated_by: "legacy",
      updated_at: "2026-06-24T08:00:00.000Z",
    },
  ];
  const [entry] = buildDunningCases(
    input({ orders: [legacyOrder], candidates: [], statuses }),
  );
  assert.equal(entry?.orderNumber, "#NEONT2993");
  assert.equal(entry?.currentStage, 4);
  assert.equal(entry?.nextStage, null);
  assert.equal(entry?.courtReview, true);
  assert.equal(entry?.state, "court_review");
  assert.equal(entry?.sendEligible, false);
});

test("paid cases are omitted unless an explicit waiting-for-payment tag keeps them for manual review", () => {
  const paid = buildDunningCases(
    input({
      orders: [order({ financial_status: "paid", total_outstanding: 0 })],
    }),
  );
  assert.deepEqual(paid, []);

  const [exception] = buildDunningCases(
    input({
      orders: [
        order({
          financial_status: "paid",
          total_outstanding: 0,
          tags: "VIP,   warten   auf ZAHLUNG ",
        }),
      ],
    }),
  );
  assert.equal(
    dunningPaymentExceptionTag("VIP,   warten   auf ZAHLUNG "),
    "WARTEN AUF ZAHLUNG",
  );
  assert.equal(exception?.state, "data_issue");
  assert.equal(exception?.paymentException, true);
  assert.equal(exception?.paymentExceptionTag, "WARTEN AUF ZAHLUNG");
  assert.equal(exception?.amountCents, 0);
  assert.equal(exception?.nextStage, null);
  assert.equal(exception?.nextActionKind, "manual_review");
  assert.equal(exception?.nextActionAt, null);
  assert.equal(exception?.sendEligible, false);
  assert.match(exception?.nextActionLabel || "", /keine Mahn-E-Mail/);
});

test("shipment records expose tracking and carrier-confirmed delivery without treating both as the same proof", () => {
  const [entry] = buildDunningCases(
    input({
      shipments: [
        {
          id: "shipment-1",
          shopify_order_id: "1234567890",
          shopify_order_number: "NEONT5000",
          shopify_fulfillment_id: "fulfillment-1",
          carrier: "dpd",
          tracking_number: "05228900012345",
          tracking_url: "https://tracking.example/05228900012345",
          status: "delivered",
          status_reason: null,
          shipped_at: "2026-08-05T08:00:00.000Z",
          delivered_at: "2026-08-06T12:10:00.000Z",
          last_event_at: "2026-08-06T12:10:00.000Z",
          last_carrier_sync_at: "2026-08-06T12:20:00.000Z",
          created_at: "2026-08-05T08:00:00.000Z",
          updated_at: "2026-08-06T12:20:00.000Z",
        },
      ],
    }),
  );
  assert.equal(entry?.hasTracking, true);
  assert.equal(entry?.carrierDeliveryConfirmed, true);
  assert.equal(entry?.shipments[0]?.trackingNumber, "05228900012345");
  assert.equal(entry?.shipments[0]?.deliveryEvidence, "carrier_confirmed");
  assert.equal(dunningCaseMatchesQuery(entry!, "05228900012345"), true);
  assert.equal(dunningCaseMatchesQuery(entry!, "DPD"), true);
});

test("stopped and conflicting cases fail closed", () => {
  const [stopped] = buildDunningCases(
    input({ orders: [order({ tags: "VIP, Keine Zahlungserinnerung n8n" })] }),
  );
  assert.equal(stopped?.state, "paused");
  assert.ok(stopped?.blockers.includes("Gesperrt: Shopify-Tag „Keine Zahlungserinnerung n8n“"));

  const statuses: BuildInput["statuses"] = [
    {
      shopify_order_number: "#NEONT5000",
      mahnstufe: 3,
      last_sent_at: "2026-08-20T08:00:00.000Z",
      next_due_at: null,
      paused: false,
      note: null,
      updated_by: "legacy",
      updated_at: "2026-08-20T08:00:00.000Z",
    },
  ];
  const [conflict] = buildDunningCases(input({ statuses }));
  assert.equal(conflict?.nextStage, null);
  assert.equal(conflict?.sendEligible, false);
  assert.ok(
    conflict?.blockers.includes(
      "Alt- und Neuverlauf haben unterschiedliche Mahnstufen",
    ),
  );
});

test("a created court application is auditable without pretending it was submitted", () => {
  const courtEvents: NonNullable<BuildInput["courtEvents"]> = new Map([
    [
      "#NEONT5000",
      [
        {
          id: "court-event-1",
          orderNumber: "#NEONT5000",
          eventKey:
            "ticket-test-neont5000-application-draft-created-2026-08-25",
          eventType: "application_draft_created",
          eventLabel: "Mahnantrag erstellt",
          occurredOn: "2026-08-25",
          sourceReference: "TICKET-157",
          actor: null,
          note: "Barcode-PDF-Entwurf; nicht eingereicht.",
          createdAt: "2026-08-25T14:30:00.000Z",
        },
      ],
    ],
  ]);
  const [entry] = buildDunningCases(input({ courtEvents }));
  assert.equal(entry?.courtEvent?.eventType, "application_draft_created");
  assert.equal(entry?.courtEvent?.occurredOn, "2026-08-25");
  assert.equal(
    entry?.nextActionLabel,
    "Mahnantrag prüfen und beim Gericht einreichen",
  );
  assert.equal(entry?.nextActionKind, "manual_review");
  assert.equal(entry?.nextActionAt, null);
});

test("unposted Qonto credits reduce the displayed claim without closing a partial payment", () => {
  const [entry] = buildDunningCases(
    input({
      orders: [
        order({
          name: "#NEONT4566",
          total_price: 670.56,
          total_outstanding: 670.56,
          created_at: "2026-06-01T10:00:00.000Z",
        }),
      ],
      candidates: [
        candidate({
          shopify_order_name: "#NEONT4566",
          shopify_order_created_at: "2026-06-01T10:00:00.000Z",
          amount_due_cents: 67056,
        }),
      ],
      courtEvents: new Map([
        [
          "#NEONT4566",
          [
            {
              id: "court-event-4566",
              orderNumber: "#NEONT4566",
              eventKey: "court-event-4566-draft",
              eventType: "application_draft_created",
              eventLabel: "Mahnantrag erstellt",
              occurredOn: "2026-09-04",
              sourceReference: "TICKET-256",
              actor: null,
              note: "Amtlicher Barcode-PDF-Entwurf.",
              createdAt: "2026-09-07T10:08:00.000Z",
            },
          ],
        ],
      ]),
      bankPayments: [
        {
          transaction_id: "transaction-payment-4566",
          counterparty_name: "Muster GmbH",
          amount: 335.28,
          currency: "EUR",
          reference_digits: "4566",
          settled_at: "2026-09-07T07:33:00.018Z",
          ingested_at: "2026-09-07T08:42:40.301Z",
        },
      ],
    }),
  );

  assert.equal(entry?.amountCents, 33528);
  assert.equal(entry?.bankPaymentsCents, 33528);
  assert.equal(entry?.financialStatus, "partially_paid");
  assert.equal(entry?.lastBankPaymentAt, "2026-09-07T07:33:00.018Z");
  assert.equal(
    entry?.nextActionLabel,
    "Mahnantrag nach Teilzahlung neu erstellen",
  );
});

test("a court event keeps a case visible without a normal dunning stage", () => {
  const courtEvents: NonNullable<BuildInput["courtEvents"]> = new Map([
    [
      "#NEONT5000",
      [
        {
          id: "court-event-only",
          orderNumber: "#NEONT5000",
          eventKey:
            "ticket-test-neont5000-application-draft-created-2026-08-25",
          eventType: "application_draft_created",
          eventLabel: "Mahnantrag erstellt",
          occurredOn: "2026-08-25",
          sourceReference: "TICKET-TEST",
          actor: null,
          note: "Amtlicher Barcode-PDF-Entwurf.",
          createdAt: "2026-08-25T14:30:00.000Z",
        },
      ],
    ],
  ]);

  const [entry] = buildDunningCases(
    input({
      statuses: [],
      sendlogs: [],
      locks: [],
      audits: [],
      messages: [],
      candidates: [],
      courtEvents,
    }),
  );
  assert.equal(entry?.orderNumber, "#NEONT5000");
  assert.equal(entry?.currentStage, 0);
  assert.equal(entry?.courtEvent?.eventType, "application_draft_created");
});

test("official court PDF preparation fails closed and treats tracking-only evidence as a warning", () => {
  const previous = {
    iban: process.env.DUNNING_COURT_APPLICANT_IBAN,
    bic: process.env.DUNNING_COURT_APPLICANT_BIC,
    recipient: process.env.DUNNING_COURT_INTERNAL_RECIPIENT,
    tenant: process.env.MICROSOFT_GRAPH_TENANT_ID,
    client: process.env.MICROSOFT_GRAPH_CLIENT_ID,
    secret: process.env.MICROSOFT_GRAPH_CLIENT_SECRET,
    mailbox: process.env.MICROSOFT_GRAPH_MAILBOX,
  };
  process.env.DUNNING_COURT_APPLICANT_IBAN = "DE00000000000000000000";
  process.env.DUNNING_COURT_APPLICANT_BIC = "TESTDEFFXXX";
  process.env.DUNNING_COURT_INTERNAL_RECIPIENT = "gericht@daranova.de";
  process.env.MICROSOFT_GRAPH_TENANT_ID = "tenant-test";
  process.env.MICROSOFT_GRAPH_CLIENT_ID = "client-test";
  process.env.MICROSOFT_GRAPH_CLIENT_SECRET = "secret-test";
  process.env.MICROSOFT_GRAPH_MAILBOX = "sender@daranova.de";
  try {
    const [base] = buildDunningCases(input());
    assert.ok(base);
    const now = new Date().toISOString();
    const summary: DunningCaseSummary = {
      ...base,
      state: "court_review",
      courtReview: true,
      legalReviewReady: true,
      customerReplied: false,
      invoiceDate: "2026-08-01T11:00:00.000Z",
      easybillInvoiceNumber: "2026-0815",
      hasTracking: true,
      carrierDeliveryConfirmed: false,
      shipments: [
        {
          id: "shipment-court",
          shopifyFulfillmentId: "fulfillment-court",
          carrier: "dpd",
          trackingNumber: "05228900012345",
          trackingUrl: null,
          status: "shipped",
          statusReason: null,
          shippedAt: "2026-08-05T08:00:00.000Z",
          deliveredAt: null,
          lastEventAt: null,
          lastCarrierSyncAt: null,
          deliveryEvidence: "tracking_only",
        },
      ],
      insolvencyCheck: {
        id: "insolvency-check",
        orderNumber: "#NEONT5000",
        eventKey: "insolvency-check-neont5000",
        identityHash: "a".repeat(64),
        identity: base.insolvencyIdentity,
        status: "completed",
        resultCode: "no_public_notice_found",
        resultLabel: "Keine öffentliche Bekanntmachung gefunden",
        sourceUrl: "https://neu.insolvenzbekanntmachungen.de/ap/",
        sourceLabel: "Insolvenzbekanntmachungen",
        checkedAt: now,
        matchCount: 0,
        matches: [],
        attemptCount: 1,
        nextAttemptAt: null,
        lastErrorCode: null,
        createdAt: now,
        updatedAt: now,
      },
      courtEvents: [],
      courtEvent: null,
    };
    const profile: DunningCourtProfile = {
      orderNumber: "#NEONT5000",
      debtorType: "company",
      legalName: "Muster",
      legalForm: "GmbH",
      street: "Musterstraße 1",
      postalCode: "40210",
      city: "Düsseldorf",
      countryCode: "DE",
      representatives: [{ function: "Geschäftsführer", name: "Max Muster" }],
      registerCourt: "Amtsgericht Düsseldorf",
      registerType: "HRB",
      registerNumber: "12345",
      sourceUrl: "https://www.unternehmensregister.de/",
      sourceCheckedAt: now,
      communicationCheckedAt: now,
      verifiedAt: now,
      verifiedBy: "operator@example.test",
      createdAt: now,
      updatedAt: now,
    };
    const preview = createDunningCourtApplicationPreview({
      summary,
      profile,
      latestJob: null,
    });
    assert.equal(preview.allowed, true);
    assert.deepEqual(preview.blockers, []);
    assert.match(preview.warnings.join(" "), /Zustellnachweis/);
    assert.equal(preview.internalRecipient, "gericht@daranova.de");
    assert.equal(preview.officialPortal, "https://www.online-mahnantrag.de/");
    assert.match(preview.snapshotHash, /^[a-f0-9]{64}$/);

    const early = createDunningCourtApplicationPreview({
      summary: { ...summary, currentStage: 2, legalReviewReady: false, courtReview: false, state: "scheduled" }, profile, latestJob: null,
    });
    assert.equal(early.allowed, true, "explicit manual preparation may precede the final email stage");
    for (const patch of [{ paused: true }, { stopTag: true }, { paymentException: true },
      { blockers: ["Bank- oder Shopify-Spiegel nicht vollständig aktuell"] },
      { insolvencyCheck: { ...summary.insolvencyCheck!, checkedAt: "2020-01-01T00:00:00Z" } },
    ]) {
      assert.equal(createDunningCourtApplicationPreview({ summary: { ...summary, ...patch }, profile, latestJob: null }).allowed, false);
    }

    delete process.env.DUNNING_COURT_INTERNAL_RECIPIENT;
    const blocked = createDunningCourtApplicationPreview({
      summary,
      profile,
      latestJob: null,
    });
    assert.equal(blocked.allowed, false);
    assert.match(blocked.blockers.join(" "), /nicht vollständig konfiguriert/);
  } finally {
    for (const [name, value] of Object.entries({
      DUNNING_COURT_APPLICANT_IBAN: previous.iban,
      DUNNING_COURT_APPLICANT_BIC: previous.bic,
      DUNNING_COURT_INTERNAL_RECIPIENT: previous.recipient,
      MICROSOFT_GRAPH_TENANT_ID: previous.tenant,
      MICROSOFT_GRAPH_CLIENT_ID: previous.client,
      MICROSOFT_GRAPH_CLIENT_SECRET: previous.secret,
      MICROSOFT_GRAPH_MAILBOX: previous.mailbox,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

function modernEvidence(stage: number, sentAt = "2026-10-14T14:20:27.000Z") {
  const lockKey = "e936881a-fe32-4d94-aa1d-eaffcf4a75be:T099:PAYMENT_COLLECTION:1234567890:S" + stage;
  const evidence: Pick<BuildInput, "locks" | "messages" | "audits" | "statuses"> = {
    locks: [{ request_id: lockKey, locked_at: sentAt, message_id: "modern-message", internet_message_id: "modern-internet", conversation_id: "modern-conversation", status: "draft_created", attempt_count: 1, lease_until: sentAt, last_error: null, updated_at: sentAt }],
    messages: [{ id: "modern-row", message_id: "modern-message", internet_message_id: "modern-internet", conversation_id: "modern-conversation", direction: "outbound", from_email: "support@neontrip.de", from_name: "NEONTRIP", to_emails: ["kunde@example.com"], cc_emails: [], bcc_emails: [], subject: "Mahnung #NEONT5000", body_preview: "", received_at: null, sent_at: sentAt, message_created_at: sentAt, source: "outlook", created_at: sentAt }],
    audits: [{ id: "modern-audit", document_id: "1234567890", workflow_name: "TICKET-099 Existing Ledger Sender", action: "customer_stage_sent_verified", status: "sent", error_message: null, metadata: { lock_key: lockKey, stage, provider_message_id: "modern-message", provider_internet_message_id: "modern-internet", provider_conversation_id: "modern-conversation", recipient: "kunde@example.com", sent_at: sentAt, attachment_verified: true, pdf_sha256: "abc123", attachment_content_sha256: "abc123", pdf_bytes: 1200 }, created_at: sentAt }],
    statuses: [{ shopify_order_number: "#NEONT5000", mahnstufe: stage, last_sent_at: sentAt, next_due_at: "2026-10-21", paused: false, note: "Daily control projection", updated_by: "n8n:35-day-dunning-control", updated_at: "2026-10-15T10:02:13.000Z" }]
  };
  return evidence;
}

for (const [stage, label, next] of [[4, "1. Mahnung", 5], [5, "2. Mahnung", 6]] as const) {
  test(`verified modern S${stage} projected into dunning_status remains scheduled, not a final deadline`, () => {
    const [entry] = buildDunningCases(input({ ...modernEvidence(stage), now: new Date("2026-10-16T10:00:00Z") }));
    assert.equal(entry?.currentStageLabel, label);
    assert.equal(entry?.source, "t099");
    assert.equal(entry?.state, "scheduled");
    assert.equal(entry?.nextStage, next);
    assert.equal(entry?.scheduledAt, "2026-10-21T14:20:27.000Z");
    assert.equal(entry?.nextActionKind, "customer_email");
    assert.equal(entry?.finalReminderWaiting, false);
    assert.equal(entry?.legalReviewReady, false);
    assert.equal(entry?.legalReviewDueAt, null);
    assert.equal(entry?.sendEligible, false);
  });
}

test("a mirrored modern S6 remains a verified final reminder", () => {
  const [entry] = buildDunningCases(input({ ...modernEvidence(6), now: new Date("2026-10-16T10:00:00Z") }));
  assert.equal(entry?.source, "t099");
  assert.equal(entry?.currentStageLabel, "3. und letzte Mahnung");
  assert.equal(entry?.state, "final_wait");
  assert.equal(entry?.nextStage, null);
  assert.equal(entry?.legalReviewDueAt, "2026-10-21T14:20:27.000Z");
});

test("an imported copy of the same modern message is not a second legacy final", () => {
  const evidence = modernEvidence(4);
  const [entry] = buildDunningCases(input({
    ...evidence,
    sendlogs: [{ id: 17, sent_at: "2026-10-14T14:20:27Z", shopify_order_number: "#NEONT5000", mahnstufe: 4, lang: "de", email: "kunde@example.com", kunde: "Muster GmbH", betrag: "119", subject: "1. Mahnung #NEONT5000", actor: "import", status: "import-outlook" }],
    now: new Date("2026-10-16T10:00:00Z")
  }));
  assert.equal(entry?.state, "scheduled");
  assert.equal(entry?.source, "t099");
  assert.equal(entry?.courtReview, false);
});

test("unverified modern evidence cannot reinterpret a legacy projection or enable court action", () => {
  const evidence = modernEvidence(4);
  evidence.audits[0]!.metadata!.attachment_verified = false;
  const [entry] = buildDunningCases(input({ ...evidence, now: new Date("2026-10-22T10:00:00Z") }));
  assert.equal(entry?.state, "data_issue");
  assert.equal(entry?.legalReviewReady, false);
  assert.equal(entry?.sendEligible, false);
});

test("a legacy final and modern S4 with distinct evidence require source review", () => {
  const [entry] = buildDunningCases(input({
    ...modernEvidence(4),
    sendlogs: [{ id: 18, sent_at: "2026-09-01T10:00:00Z", shopify_order_number: "#NEONT5000", mahnstufe: 4, lang: "de", email: "kunde@example.com", kunde: "Muster GmbH", betrag: "119", subject: "Letzte Mahnung vor Inkasso #NEONT5000", actor: "legacy", status: "sent" }],
    now: new Date("2026-10-22T10:00:00Z")
  }));
  assert.equal(entry?.state, "data_issue");
  assert.equal(entry?.legalReviewReady, false);
  assert.equal(entry?.nextStage, null);
  assert.equal(entry?.sendEligible, false);
});

test("modern stage correction retains pause and paid protections", () => {
  const evidence = modernEvidence(4);
  evidence.statuses[0]!.paused = true;
  const [paused] = buildDunningCases(input({ ...evidence, now: new Date("2026-10-16T10:00:00Z") }));
  assert.equal(paused?.state, "paused");
  assert.equal(paused?.sendEligible, false);
  assert.deepEqual(buildDunningCases(input({ ...modernEvidence(4), orders: [order({ financial_status: "paid", total_outstanding: 0 })] })), []);
});

test("legacy S5 is not labelled as a modern second reminder", () => {
  const evidence = modernEvidence(5);
  const [entry] = buildDunningCases(input({statuses:evidence.statuses,candidates:[],now:new Date('2026-10-22T10:00:00Z')}));
  assert.equal(entry?.currentStageLabel, 'Mahnstufe 5 (Altbestand)');
  assert.equal(entry?.state, 'court_review');
});

test("OPS uses the original reviewed cycle and shows automatic S2 after the proven S1", () => {
  const c:any=candidate({easybill_document_created_at:"2026-09-01T10:00:00Z"});
  const anchor={stage:1,sent_at:"2026-10-14T12:00:00Z",message_id:"historical-mail",internet_message_id:"<historical-mail>",conversation_id:"historical-thread"};
  c.continuation={schema:"dunning.historical.candidate.v1",stage_model:"current_6",cycle_prefix:"e936881a-fe32-4d94-aa1d-eaffcf4a75be:T099:PAYMENT_COLLECTION:1234567890:C-R20261014T35",cycle_id:"R20261014T35",anchor};
  const mail:any={...anchor,direction:"outbound",source:"outlook",to_emails:["kunde@example.com"],cc_emails:[],bcc_emails:[],subject:"Zahlungserinnerung #NEONT5000"};
  const [row]=buildDunningCases(input({candidates:[c],messages:[mail],statuses:[{shopify_order_number:"#NEONT5000",mahnstufe:1,last_sent_at:anchor.sent_at,next_due_at:"2026-10-20",paused:false,note:null,updated_by:null,updated_at:anchor.sent_at}],now:new Date("2026-10-19T12:00:00Z")}));
  assert.equal(row?.currentStage,1);assert.equal(row?.nextStage,2);assert.equal(row?.scheduledAt,"2026-10-20T12:00:00.000Z");assert.equal(row?.state,"scheduled");assert.match(row?.nextActionLabel||"",/Automatisch/);
});
test("OPS exposes a payment reconciliation exclusion instead of presenting an automatic send",()=>{
 const c:any=candidate();c.automation_blocker="Zahlungszuordnung erforderlich; kein Versand";
 const [row]=buildDunningCases(input({candidates:[c]}));assert.equal(row?.sendEligible,false);assert.equal(row?.state,"data_issue");assert.match(row?.primaryBlocker||"",/Zahlungszuordnung/);
});

test("OPS and sender preserve Berlin send time across the October clock change",()=>{
 assert.equal(nextDunningSchedule({nextStage:5,orderCreatedAt:"2026-09-01T10:00:00Z",easybillCreatedAt:null,dueDate:"2026-09-15",previousStageSentAt:"2026-10-21T14:00:00Z"}),"2026-10-28T15:00:00.000Z");
});
test("verified cycle-specific legacy final stays final after leaving the candidate snapshot",()=>{
 const e=modernEvidence(4);const key=e.locks[0]!.request_id.replace(":S4",":C-H88001:S4");e.locks[0]!.request_id=key;e.audits[0]!.metadata!.lock_key=key;
 e.audits[0]!.metadata!.continuation={schema:"dunning.historical.candidate.v1",stage_model:"legacy_4",cycle_id:"H88001",cycle_prefix:key.replace(":S4",""),anchor:null};
 const [r]=buildDunningCases(input({...e,candidates:[],now:new Date("2026-10-16T10:00:00Z")}));
 assert.equal(r?.currentStageLabel,"Letzte Mahnung vor Inkasso (Altbestand)");assert.equal(r?.nextStage,null);assert.equal(r?.state,"final_wait");
});
test("OPS displays an exclusion even when the case is absent from both candidate sources",()=>{
 const [r]=buildDunningCases(input({candidates:[],automationExclusions:new Map([["#NEONT5000","Zahlungszuordnung erforderlich; kein Versand"]])}));
 assert.match(r?.primaryBlocker||"",/Zahlungszuordnung/);assert.equal(r?.sendEligible,false);
});
test("stale historical source cannot be shown as send eligible despite fresh ordinary intake",()=>{
 const [r]=buildDunningCases(input({historicalFresh:false}));assert.equal(r?.sendEligible,false);assert.equal(r?.state,"data_issue");
});

test("OPS immediately exposes the sender's payment block without waiting for tomorrow's report",()=>{
 const e=modernEvidence(4);e.audits.push({id:"blocked1",document_id:"1234567890",workflow_name:"TICKET-099 Existing Ledger Sender",action:"customer_send_blocked_preclaim",status:"blocked",error_message:null,created_at:"2026-10-21T14:25:00Z",metadata:{lock_key:"e936881a-fe32-4d94-aa1d-eaffcf4a75be:T099:PAYMENT_COLLECTION:1234567890:S5",reasons:["QONTO_AMBIGUOUS_POSSIBLE_PAYMENT"]}});
 const [r]=buildDunningCases(input({...e,now:new Date("2026-10-21T14:30:00Z")}));assert.equal(r?.sendEligible,false);assert.equal(r?.state,"data_issue");assert.match(r?.primaryBlocker||"",/Zahlung/);assert.doesNotMatch(r?.nextActionLabel||"",/^Automatisch/);
});

test("OPS preserves historical continuation stage and reply waiting period",()=>{
 const e=modernEvidence(1,"2026-10-14T12:00:00Z");const c:any=candidate();const key=e.locks[0]!.request_id.replace(":S1",":C-R20261014T35:S1");e.locks[0]!.request_id=key;e.audits[0]!.metadata!.lock_key=key;
 c.continuation={schema:"dunning.historical.candidate.v1",stage_model:"current_6",cycle_id:"R20261014T35",cycle_prefix:key.replace(":S1",""),anchor:{stage:1,sent_at:"2026-10-14T12:00:00Z",message_id:"modern-message",internet_message_id:"modern-internet",conversation_id:"modern-conversation"}};
 e.audits.push({id:"reply1",document_id:"1234567890",workflow_name:"TICKET-099 Existing Ledger Sender",action:"customer_reply_decision",status:"success",error_message:null,created_at:"2026-10-19T13:00:00Z",metadata:{schema:"t268.reply-decision.v1",lock_key:key.replace(":S1",":S2"),decision:"continue_dunning",reply_received_at:"2026-10-19T12:00:00Z",payment_received_cents:0,amount_due_cents:11900}});
 const [r]=buildDunningCases(input({...e,candidates:[c],now:new Date("2026-10-20T13:00:00Z")}));assert.equal(r?.nextStage,2);assert.equal(r?.scheduledAt,"2026-10-22T12:00:00.000Z");assert.equal(r?.sendEligible,false);
});


test("OPS verifies modern S4 after more than 6000 older mail records", async (t) => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://supabase.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-test-only";
  t.after(() => {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  });
  const evidence = modernEvidence(4);
  const id = (n: number) => "00000000-0000-0000-0000-" + String(n).padStart(12, "0");
  const older = Array.from({length: 6000}, (_, n) => ({
    ...evidence.messages[0], id: id(n + 1), message_id: "unrelated-" + n,
    internet_message_id: "<unrelated-" + n + ">", conversation_id: "unrelated",
    subject: "Andere Rechnung #NEONT9000", sent_at: "2026-08-01T12:00:00Z"
  }));
  const all = [...older, {...evidence.messages[0], id: id(6001)}];
  const requests: URL[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, "https://supabase.invalid");
    requests.push(parsed);
    const after = parsed.searchParams.get("id")?.replace(/^gt\./, "");
    if (requests.length === 2) all.unshift({...evidence.messages[0], id: id(0), created_at:"2100-01-01T00:00:00Z"});
    const cutoff = parsed.searchParams.get("created_at")?.slice(4);
    const selected = all.filter(row => (!after || row.id > after) && (!cutoff || Date.parse(row.created_at || "") <= Date.parse(cutoff)));
    const offset = Number(parsed.searchParams.get("offset") || 0);
    return new Response(JSON.stringify(selected.slice(offset, offset + 1000)), {status: 200});
  });
  const messages = await loadDunningEmailEvidence({select: "*", direction: "eq.outbound"});
  const [entry] = buildDunningCases(input({...evidence, messages, now:new Date("2026-10-19T10:00:00Z")}));
  assert.equal(entry?.currentStageLabel, "1. Mahnung");
  assert.equal(entry?.source, "t099");
  assert.equal(entry?.state, "scheduled");
  assert.equal(entry?.nextStage, 5);
  assert.equal(entry?.scheduledAt, "2026-10-21T14:20:27.000Z");
  assert.equal(messages.length, 6001);
  assert.equal(requests.length, 7);
  const cutoff = requests[0].searchParams.get("created_at");
  assert.ok(cutoff?.startsWith("lte."));
  for (const request of requests) {
    assert.equal(request.searchParams.get("created_at"), cutoff);
    assert.equal(request.searchParams.get("direction"), "eq.outbound");
    assert.equal(request.searchParams.get("order"), "id.asc");
    assert.equal(request.searchParams.has("offset"), false);
  }
  // An import arriving during pagination is outside this snapshot, even if
  // its ID sorts before the cursor; the next dashboard read will include it.
  assert.equal(requests[1].searchParams.get("id"), "gt." + id(1000));
  for (const orders of [[order({financial_status:"paid",total_outstanding:0})],
                        [order({tags:"Nicht mahnen"})]]) {
    const [protectedCase] = buildDunningCases(input({...evidence, messages, orders, now:new Date("2026-10-22T10:00:00Z")}));
    assert.notEqual(protectedCase?.sendEligible, true);
  }
});

test("incomplete or non-progressing mail pages fail instead of returning partial evidence", async (t) => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://supabase.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-test-only";
  t.after(() => {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  });
  let mode = "null";
  let pageCount = 0;
  const page = Array.from({length:1000}, (_, n) => ({id:String(n + 1).padStart(12, "0")}));
  t.mock.method(globalThis, "fetch", async () => {
    pageCount++;
    if (mode === "http" && pageCount === 2) return new Response("failed", {status:400});
    return new Response(JSON.stringify(mode === "null" ? null : page), {status:200});
  });
  await assert.rejects(loadDunningEmailEvidence({select:"id"}), /unvollständig/);
  mode = "repeated";pageCount = 0;
  await assert.rejects(loadDunningEmailEvidence({select:"id"}), /Seitenfolge/);
  mode = "http";pageCount = 0;
  await assert.rejects(loadDunningEmailEvidence({select:"id"}), /Supabase Anfrage fehlgeschlagen/);
});

test("regular proforma with fulfilled invoice request shows the actual delivery deadline without a new cycle",()=>{
 const data=input({now:new Date("2026-10-19T13:00:00Z"),orders:[order({created_at:"2026-09-11T14:00:00Z"})],candidates:[candidate({shopify_order_created_at:"2026-09-11T14:00:00Z",easybill_document_created_at:"2026-09-11T14:35:58Z",easybill_due_date:"2026-09-11",easybill_invoice_number:"PF-NEONT5000",shopify_email_hint:"billing@example.com"})]});
 data.audits.push({id:"resolved",document_id:"1234567890",workflow_name:"TICKET-099 Existing Ledger Sender",action:"customer_reply_decision",status:"success",error_message:null,created_at:"2026-10-19T12:00:00Z",metadata:{schema:"t268.reply-decision.v1",policy:"t268.reply-classifier.2026-10-19.v2",lock_key:"e936881a-fe32-4d94-aa1d-eaffcf4a75be:T099:PAYMENT_COLLECTION:1234567890:S1",decision:"continue_dunning",reply_received_at:"2026-09-16T07:04:31Z",reason_codes:["document_request_fulfilled"],resolved_document_request_evidence:true,invoice_delivery:{sent_at:"2026-09-16T07:34:34Z"},payment_received_cents:0,amount_due_cents:11900}});
 const [entry]=buildDunningCases(data);
 assert.equal(entry.scheduledAt,"2026-09-21T07:34:34.000Z");
 assert.equal(entry.email,"billing@example.com");
 assert.equal(entry.nextStage,1);
});

test("OPS clears only superseded reply and released hold blockers",()=>{
 const data:any=input();
 data.audits=[
 {id:"block",document_id:"1234567890",action:"customer_send_blocked_preclaim",status:"blocked",created_at:"2026-08-23T10:00:00Z",metadata:{lock_key:"e936881a-fe32-4d94-aa1d-eaffcf4a75be:T099:PAYMENT_COLLECTION:1234567890:S1",reasons:["CUSTOMER_REPLY_AI_REVIEW_REQUIRED","MANUAL_DUNNING_HOLD"]}},
 {id:"review",document_id:"1234567890",action:"customer_reply_decision",status:"success",created_at:"2026-08-24T10:00:00Z",metadata:{schema:"t268.reply-decision.v1",policy:"t268.reply-classifier.2026-10-19.v2",lock_key:"e936881a-fe32-4d94-aa1d-eaffcf4a75be:T099:PAYMENT_COLLECTION:1234567890:S1",decision:"continue_dunning",confidence:0.95,validation_error:null,risk_flags:[],payment_received_cents:0,amount_due_cents:11900}}
 ];
 assert.equal(buildDunningCases(data)[0].sendEligible,true);
 data.audits[0].metadata.reasons.push("QONTO_UNREFLECTED_EXACT_PAYMENT");
 const entry=buildDunningCases(data)[0];assert.equal(entry.sendEligible,false);assert.match(entry.blockers.join(" "),/Bankzahlung/);
});

test("legacy NEON identity joins its outstanding amount and collection hold", () => {
  assert.equal(normalizeDunningOrderNumber("#NEON1643"), "#NEONT1643");
  const rows=buildDunningCases(input({orders:[order({name:"#NEON1643",total_outstanding:1444.66,tags:"Inkasso eingeschaltet"})],candidates:[],statuses:[{shopify_order_number:"#NEONT1643",mahnstufe:0,paused:false,note:null,last_sent_at:null,next_due_at:null,updated_at:null,updated_by:null}]}));
  assert.equal(rows.length,1);
  assert.equal(rows[0].amountCents,144466);
  assert.equal(rows[0].stopTag,true);
  assert.equal(rows[0].sendEligible,false);
});
test("test orders do not inflate the real open balance", () => {
  assert.equal(buildDunningCases(input({orders:[order({tags:"testbestellung"})]})).length,0);
});

test("fresh bank references from another customer do not erase an open balance", () => {
 const [entry] = buildDunningCases(input({bankPayments:[{transaction_id:"different-party",reference_digits:"5000",reference:"PF-NEONT5000",counterparty_name:"Other Customer GmbH",amount:119,currency:"EUR",settled_at:"2026-08-20T10:00:00Z",ingested_at:"2026-08-25T10:00:00Z"}]}));
 assert.equal(entry?.amountCents,11900);
 assert.equal(entry?.sendEligible,false);
 assert.match(entry?.blockers.join(" ") || "",/Zahlung.*zugeordnet/);
});

test("bank payments already reflected in Shopify are not deducted twice", () => {
 const [entry] = buildDunningCases(input({orders:[order({total_price:200,total_outstanding:100,shopify_updated_at:"2026-08-25T11:00:00Z"})],candidates:[],bankPayments:[{transaction_id:"reflected",reference_digits:"5000",reference:"NEONT5000",counterparty_name:"Muster GmbH",amount:100,currency:"EUR",settled_at:"2026-08-20T10:00:00Z",ingested_at:"2026-08-25T10:00:00Z"}]}));
 assert.equal(entry?.amountCents,10000);
 assert.equal(entry?.bankPaymentsCents,0);
});

test("duplicate provider transaction spellings are counted only once", () => {
 const payment={reference_digits:"5000",reference:"NEONT5000",counterparty_name:"Muster GmbH",amount:50,currency:"EUR",settled_at:"2026-08-20T10:00:00Z",ingested_at:"2026-08-25T10:00:00Z"};
 const [entry]=buildDunningCases(input({bankPayments:[{...payment,transaction_id:"01a08a53-288d-70df-a27d-93ddae8e2c17"},{...payment,transaction_id:"company-transaction-01a08a53-288d-70df-a27d-93ddae-8e2c17"}]}));
 assert.equal(entry?.amountCents,6900);
});

test("verified payment review covers collective and non-bank payments without double deduction", () => {
 const reviewedPayments=new Map([["#NEONT5000",{shopifyOrderId:"1234567890",grossCents:11900,allocatedCents:11900,remainingCents:0,note:"Zahlung nachgewiesen; Buchung fehlt",observedAt:"2026-08-25T11:00:00Z"}]]);
 const [entry]=buildDunningCases(input({reviewedPayments}));
 assert.equal(entry?.amountCents,0);
 assert.equal(entry?.paymentException,true);
 assert.equal(entry?.sendEligible,false);
 assert.equal(entry?.reviewedPaymentCents,11900);
 const changed=buildDunningCases(input({orders:[order({total_price:200,total_outstanding:200})],candidates:[],reviewedPayments}))[0];
 assert.equal(changed?.amountCents,20000);
});

test("E2E customer and Shopify test flag stay out of real receivables", () => {
 assert.equal(buildDunningCases(input({orders:[order({kunde:"NEONTRIP E2E TEST AT GmbH – NICHT PRODUZIEREN"})]})).length,0);
 assert.equal(buildDunningCases(input({orders:[order({test:true})]})).length,0);
});

test("mirror freshness requires a complete verified write and expires after missed runs", () => {
 const observedAt="2026-08-25T10:00:00.000Z";
 const rows=[{ingested_at:observedAt}];
 const audit={id:"sync",document_id:null,workflow_name:"OPS Source Mirror",action:"ops_source_mirror_verified",status:"success",error_message:null,created_at:observedAt,metadata:{schema:"ops.source-mirror.v1",source:"bank",source_complete:true,source_count:1,written_count:1,observed_at:observedAt,verified_at:"2026-08-25T10:01:00.000Z"}};
 assert.equal(mirrorSourceHealth(audit,"bank",rows,new Date("2026-08-25T10:30:00Z")).fresh,true);
 assert.equal(mirrorSourceHealth(audit,"bank",rows,new Date("2026-08-25T10:46:00Z")).fresh,false);
 assert.equal(mirrorSourceHealth(audit,"bank",[],new Date("2026-08-25T10:30:00Z")).complete,false);
 assert.equal(mirrorSourceHealth(audit,"bank",[{ingested_at:"2026-08-25T10:15:00Z"}]).complete,false);
 assert.equal(mirrorSourceHealth(audit,"shopify",rows).complete,false);
 assert.equal(mirrorSourceHealth(undefined,"bank",rows).fresh,false);
 assert.equal(buildDunningCases(input({mirrorsFresh:false}))[0]?.sendEligible,false);
});

test("mirrors load beyond former caps and reject a repeated page", async (t) => {
 const oldUrl=process.env.SUPABASE_URL, oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL="https://supabase.invalid"; process.env.SUPABASE_SERVICE_ROLE_KEY="synthetic-test-only";
 t.after(()=>{if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;});
 let repeat=false;
 t.mock.method(globalThis,"fetch",async (url: string | URL | Request)=>{
   const query=new URL(String(url)).searchParams;const after=repeat?0:Number(query.get("id")?.slice(3)||0);
   const data=Array.from({length:Math.min(1000,6203-after)},(_,i)=>({id:String(after+i+1).padStart(6,"0")}));
   return new Response(JSON.stringify(data),{status:200});
 });
 assert.equal((await loadCompleteMirror("qonto_transactions","id","id")).length,6203);
 repeat=true;
 await assert.rejects(loadCompleteMirror("qonto_transactions","id","id"),/Seitenfolge/);
});

test("verified mirror snapshot excludes retained old rows and rejects an overlapping partial write", () => {
 const observedAt="2026-08-25T10:00:00.000Z";
 const audit:any={status:"success",metadata:{schema:"ops.source-mirror.v1",source:"bank",source_complete:true,source_count:1,written_count:1,observed_at:observedAt,verified_at:"2026-08-25T10:01:00.000Z"}};
 const old={id:"old",ingested_at:"2026-06-25T10:00:00Z"};
 const current={id:"current",ingested_at:observedAt};
 const health=mirrorSourceHealth(audit,"bank",[old,current],new Date("2026-08-25T10:15:00Z"));
 assert.equal(health.fresh,true);assert.equal(health.count,1);assert.deepEqual(health.rows,[current]);
 const partial=mirrorSourceHealth(audit,"bank",[old,current,{id:"new",ingested_at:"2026-08-25T10:15:00Z"}]);
 assert.equal(partial.complete,false);
});

for (const year of [2024, 2025, 2026]) {
  test(`open ${year} orders survive the full case builder without a live candidate`, () => {
    const cases = buildDunningCases(input({ orders: [order({ created_at: `${year}-01-01T10:00:00Z` })], candidates: [] }));
    assert.equal(cases.length, 1);
    assert.equal(cases[0]?.orderCreatedAt, `${year}-01-01T10:00:00.000Z`);
    assert.equal(cases[0]?.sendEligible, false);
    assert.equal(buildDunningCases(input({ orders: [order({ created_at: `${year}-01-01T10:00:00Z`, financial_status: "paid", total_outstanding: 0 })], candidates: [] })).length, 0);
  });
}

test("historical invoice evidence supplies dates without enrolling a blocked case", () => {
  const [entry] = buildDunningCases(input({
    orders: [order({created_at:"2024-05-18T10:00:00Z",tags:"Mahnstop"})],
    candidates: [],
    invoiceEvidence: new Map([["#NEONT5000", {documentId:"88001",invoiceNumber:"R-2024",invoiceDate:"2024-05-18",dueDate:"2024-06-01"}]]),
  }));
  assert.equal(entry.dueDate,"2024-06-01");
  assert.ok(entry.daysOverdue! > 700);
  assert.equal(entry.sendEligible,false);
  assert.equal(entry.stateLabel,"Gesperrt");
  assert.ok(entry.blockers.some(reason => reason.includes("Mahnstop")));
});

test("invoice display evidence cannot create a sender candidate or reopen paid orders", () => {
  const evidence = new Map([["#NEONT5000", {documentId:"88001",invoiceNumber:"R-2024",invoiceDate:"2024-05-18",dueDate:"2024-06-01"}]]);
  const [entry] = buildDunningCases(input({candidates:[],invoiceEvidence:evidence}));
  assert.equal(entry.sendEligible,false);
  assert.equal(entry.nextStage,null);
  assert.deepEqual(buildDunningCases(input({orders:[order({financial_status:"paid",total_outstanding:0})],candidates:[],invoiceEvidence:evidence})),[]);
});

test("hold tag matching preserves whitespace and unicode normalization", () => {
  for (const tags of ["Keine  Zahlungserinnerung", "Ｍａｈｎｓｔｏｐ"]) {
    const [entry] = buildDunningCases(input({orders:[order({tags})]}));
    assert.equal(entry.sendEligible,false);
    assert.equal(entry.stateLabel,"Gesperrt");
    assert.ok(entry.blockers.some(reason => reason.includes(tags)));
  }
});
