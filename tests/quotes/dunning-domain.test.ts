import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDunningCases,
  createDunningActionPreview,
  dunningCaseMatchesQuery,
  dunningStageLabel,
  nextDunningSchedule,
  normalizeDunningOrderNumber,
} from "../../src/lib/ops/dunning";

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
    },
    bill_address: {
      company: "Muster GmbH",
      first_name: "Max",
      last_name: "Muster",
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
  assert.equal(entry?.nextStage, 1);
  assert.equal(entry?.state, "action_required");
  assert.equal(entry?.sendEligible, true);
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

test("paid, stopped and conflicting cases fail closed", () => {
  const [paid] = buildDunningCases(
    input({
      orders: [order({ financial_status: "paid", total_outstanding: 0 })],
    }),
  );
  assert.equal(paid?.state, "closed");
  assert.equal(paid?.sendEligible, false);

  const [stopped] = buildDunningCases(
    input({ orders: [order({ tags: "VIP, Keine Zahlungserinnerung n8n" })] }),
  );
  assert.equal(stopped?.state, "paused");
  assert.ok(stopped?.blockers.includes("Shopify-Sperrtag ist gesetzt"));

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
