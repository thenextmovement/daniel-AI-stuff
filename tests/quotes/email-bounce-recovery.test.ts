import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { handleEmailBouncePost } from "@/lib/ops/email-bounce-recovery-route";
import {
  analyzeOutlookBounce,
  processOutlookBounce,
  suggestKnownProviderEmailCorrection,
  type EmailBounceRecoveryDeps,
  type OutlookBounceIntakeInput,
} from "@/lib/ops/email-bounce-recovery";

const syntheticBounce: OutlookBounceIntakeInput = {
  message_id: "synthetic-ndr-1",
  internet_message_id: "<synthetic-ndr-1@example.test>",
  direction: "inbound",
  matched_email: "kunde@gmail.cim",
  to_emails: ["kunde@gmail.cim"],
  subject: "Unzustellbar: Ihr NEONTRIP Angebot",
  body_preview: "Ihre Nachricht konnte nicht zugestellt werden. Das DNS hat gemeldet, dass die Domäne des Empfängers nicht vorhanden ist.",
  received_at: "2026-08-31T08:00:00.000Z",
  workflow_id: "outlook-sync-test",
  execution_id: "execution-test",
};

function fixtureDeps(options: {
  customerMatches?: number;
  autoOffer?: boolean;
  multipleOffers?: boolean;
  priorSend?: boolean;
  sendFailure?: boolean;
  offerUpdateFailure?: boolean;
  customerUpdateFailure?: boolean;
  currentEmail?: string;
  offerRequestId?: string | null;
} = {}) {
  const calls = {
    taskInputs: [] as Array<Record<string, unknown>>,
    taskUpdateInputs: [] as Array<Record<string, unknown>>,
    actionInputs: [] as Array<Record<string, unknown>>,
    auditInputs: [] as Array<Record<string, unknown>>,
    sendInputs: [] as Array<Record<string, unknown>>,
    offerUpdateInputs: [] as Array<Record<string, unknown>>,
    customerUpdates: [] as Array<Record<string, unknown>>,
    quoteEvidenceInputs: [] as Array<Record<string, unknown>>,
    offerSentInputs: [] as Array<Record<string, unknown>>,
    cancelledRuns: [] as Array<Record<string, unknown>>,
  };
  const customerMatches = options.customerMatches ?? 1;
  const currentEmail = options.currentEmail || "kunde@gmail.cim";
  let taskState: Record<string, unknown> | null = null;
  const deps = {
    async findCustomerMatches(email: string) {
      if (email !== currentEmail) return [];
      return Array.from({ length: customerMatches }, (_, index) => ({
        request_id: customerMatches === 1 ? "REQ-BOUNCE-1" : `REQ-BOUNCE-${index + 1}`,
        email: currentEmail,
        original_email: null,
        name: "Test Kunde",
        company: null,
      }));
    },
    async findRequest(requestId: string) {
      return { request_id: requestId, trello_card_id: "trello-test", title: "Test Anfrage" };
    },
    async createTask(input: Record<string, unknown>) {
      calls.taskInputs.push(input);
      taskState = {
        id: "task-bounce-1",
        title: String(input.title || ""),
        description: String(input.description || ""),
        status: "open",
        priority: "high",
        category: "problem",
        assigneeLabel: null,
        dueAt: null,
        requestId: typeof input.requestId === "string" ? input.requestId : null,
        customerName: typeof input.customerName === "string" ? input.customerName : null,
        customerEmail: typeof input.customerEmail === "string" ? input.customerEmail : null,
        trelloCardId: typeof input.trelloCardId === "string" ? input.trelloCardId : null,
        sourceApp: String(input.sourceApp || ""),
        sourceRef: typeof input.sourceRef === "string" ? input.sourceRef : null,
        createdBy: "outlook-bounce-automation@neontrip.de",
        updatedBy: "outlook-bounce-automation@neontrip.de",
        completedBy: null,
        completedAt: null,
        metadata: input.metadata as Record<string, unknown>,
        createdAt: "2026-08-31T08:00:00.000Z",
        updatedAt: "2026-08-31T08:00:00.000Z",
      };
      return taskState;
    },
    async updateTask(_taskId: string, input: Record<string, unknown>) {
      calls.taskUpdateInputs.push(input);
      taskState = { ...(taskState || {}), ...input };
      return taskState;
    },
    async findOfferSendCandidates() {
      if (!options.autoOffer) return [];
      const offerIds = options.multipleOffers ? ["offer-bounce-1", "offer-bounce-2"] : ["offer-bounce-1"];
      return offerIds.map((offerId) => ({
        id: `event-${offerId}`,
        request_id: "REQ-BOUNCE-1",
        trello_card_id: "trello-test",
        offer_id: offerId,
        offer_number: offerId === "offer-bounce-1" ? "A/N 15268" : "A/N 15269",
        document_reference: "A/N 15268",
        public_url: "https://example.test/offer",
        recipient_email: "kunde@gmail.cim",
        event_at: "2026-08-31T07:34:12.723Z",
        source_event_id: `source-${offerId}`,
        idempotency_key: `sent-${offerId}`,
      }));
    },
    async findSuccessfulOfferSend() {
      return options.priorSend ? {
        eventId: "existing-corrected-send",
        sentAt: "2026-08-31T08:05:00.000Z",
        source: "quote_email_log",
      } : null;
    },
    async getOffer(offerId: string) {
      return {
        offerId,
        requestId: options.offerRequestId === undefined ? "REQ-BOUNCE-1" : options.offerRequestId,
        offerNumber: "A/N 15268",
        documentReference: "A/N 15268",
        trelloCardId: "trello-test",
        publicUrl: "https://example.test/offer",
        status: "sent",
        updatedAt: "2026-08-31T07:34:00.000Z",
        viewedAt: null,
        acceptedAt: null,
        acceptance: null,
        lock: { editable: true, lockLevel: "none", lockReason: null, requiresRevisionReason: false },
        offer: {
          customerCompany: null,
          customerFirstName: "Test",
          customerLastName: "Kunde",
          customerEmail: "kunde@gmail.cim",
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
      };
    },
    async updateOfferEmail(offerId: string, input: Record<string, unknown>) {
      calls.offerUpdateInputs.push({ offerId, ...input });
      if (options.offerUpdateFailure) throw new Error("offer_email_update_failed");
      return {
        offer: {
          ...(await this.getOffer(offerId)),
          updatedAt: "2026-08-31T08:06:00.000Z",
          offer: {
            ...(await this.getOffer(offerId)).offer,
            customerEmail: "kunde@gmail.com",
          },
        },
      };
    },
    async sendOffer(_offerId: string, input: Record<string, unknown>) {
      calls.sendInputs.push(input);
      if (options.sendFailure) throw new Error("provider_send_unconfirmed");
      return { sent: true, duplicate: false, eventId: "recovery-send-event", opsSync: null };
    },
    async recordQuoteEvidence(input: Record<string, unknown>) {
      calls.quoteEvidenceInputs.push(input);
      return [{ id: "quote-evidence-1" }];
    },
    async recordOfferSent(input: Record<string, unknown>) {
      calls.offerSentInputs.push(input);
      return { ok: true, event_id: "ops-event-1" };
    },
    async updateCustomerEmail(requestId: string, email: string) {
      calls.customerUpdates.push({ requestId, email });
      if (options.customerUpdateFailure) throw new Error("customer_update_failed");
      return { record: {}, changedTables: ["master_customers"] };
    },
    async cancelPendingCorrectionRuns(requestId: string, failedEmail: string, correctedEmail: string) {
      calls.cancelledRuns.push({ requestId, failedEmail, correctedEmail });
      return 1;
    },
    async getActionPolicy() {
      return {
        actionKey: "correct_customer_email",
        riskLevel: "high",
        minimumRole: "operator",
        approvalRole: "approver",
        requiresFourEyes: true,
        customerSideEffect: false,
        description: "Changes canonical customer contact data.",
      };
    },
    async proposeActionRun(input: Record<string, unknown>) {
      calls.actionInputs.push(input);
      return {
        duplicate: false,
        run: {
          id: "action-run-bounce-1",
          actionKey: "correct_customer_email",
          caseKey: "request:REQ-BOUNCE-1",
          requestId: "REQ-BOUNCE-1",
          riskLevel: "high",
          status: "awaiting_approval",
          proposedBy: "outlook-bounce-automation@neontrip.de",
          approvedBy: null,
          idempotencyKey: "company-brain-action:test",
          inputHash: "hash",
          frozenInput: {},
          preview: {},
          failureCode: null,
          failureDetail: null,
          proposedAt: "2026-08-31T08:00:00.000Z",
          approvedAt: null,
          executionStartedAt: null,
          completedAt: null,
        },
      };
    },
    async recordAudit(input: Record<string, unknown>) {
      calls.auditInputs.push(input);
      return {
        inserted: true,
        duplicate: false,
        auditEventKey: "workflow-audit:synthetic",
        rowId: "audit-bounce-1",
      };
    },
  } as unknown as EmailBounceRecoveryDeps;
  return { deps, calls };
}

test("known provider typo correction is deterministic and conservative", () => {
  assert.equal(suggestKnownProviderEmailCorrection("kunde@gmail.cim"), "kunde@gmail.com");
  assert.equal(suggestKnownProviderEmailCorrection("kunde@gamil.com"), "kunde@gmail.com");
  assert.equal(suggestKnownProviderEmailCorrection("kunde@gmail.com"), null);
  assert.equal(suggestKnownProviderEmailCorrection("kunde@beispiel-firma.de"), null);
});

test("synthetic DNS NDR is classified before any action", () => {
  const analysis = analyzeOutlookBounce(syntheticBounce);

  assert.deepEqual(analysis, {
    isBounce: true,
    reasonCode: "domain_not_found",
    failedEmail: "kunde@gmail.cim",
    suggestedEmail: "kunde@gmail.com",
    suggestionBasis: "known_provider_domain_single_edit",
    confidence: "high",
  });
});

test("bounce intake creates an internal task and a four-eyes correction proposal only", async () => {
  const { deps, calls } = fixtureDeps();
  const result = await processOutlookBounce(syntheticBounce, deps);

  assert.equal(result.status, "correction_proposed");
  assert.equal(result.customerCommunicationSent, false);
  assert.equal(result.customerDataChanged, false);
  assert.equal(result.requestId, "REQ-BOUNCE-1");
  assert.equal(calls.taskInputs.length, 1);
  assert.equal(calls.actionInputs.length, 1);
  assert.equal(calls.auditInputs.length, 1);
  assert.equal(calls.taskInputs[0].sourceApp, "outlook_email_bounce_recovery");
  assert.match(String(calls.taskInputs[0].sourceRef), /^outlook-email-bounce:[a-f0-9]{32}:v1$/);

  const actionInput = calls.actionInputs[0];
  const frozenInput = actionInput.frozenInput as Record<string, unknown>;
  assert.equal(frozenInput.actionKey, "correct_customer_email");
  assert.equal(frozenInput.recipientEmail, "kunde@gmail.cim");
  assert.equal(frozenInput.newCustomerEmail, "kunde@gmail.com");
  assert.equal((actionInput.actor as { email: string }).email, "outlook-bounce-automation@neontrip.de");
  assert.equal(calls.auditInputs[0].status, "waiting");
  assert.equal((calls.auditInputs[0] as Record<string, unknown>).customer_communication_sent, false);
});

test("eligible provider-domain bounce resends one exact offer before updating customer data", async () => {
  const { deps, calls } = fixtureDeps({ autoOffer: true });
  const result = await processOutlookBounce(syntheticBounce, deps);

  assert.equal(result.status, "offer_recovered");
  assert.equal(result.customerCommunicationSent, true);
  assert.equal(result.customerDataChanged, true);
  assert.equal(calls.sendInputs.length, 1);
  assert.equal(calls.offerUpdateInputs.length, 1);
  assert.equal(calls.customerUpdates.length, 1);
  assert.equal(calls.actionInputs.length, 0);
  assert.equal(calls.quoteEvidenceInputs.length, 1);
  assert.equal(calls.offerSentInputs.length, 1);
  assert.equal(calls.cancelledRuns.length, 1);
  assert.equal(calls.sendInputs[0].recipientEmail, "kunde@gmail.com");
  assert.match(String(calls.sendInputs[0].idempotencyKey), /^email-bounce-offer-recovery:/);
  assert.deepEqual(calls.customerUpdates[0], { requestId: "REQ-BOUNCE-1", email: "kunde@gmail.com" });
  assert.equal(calls.taskUpdateInputs.at(-1)?.status, "done");
  assert.equal(calls.auditInputs.at(-1)?.status, "sent");
});

test("authoritative sent-event binding tolerates an omitted redundant offer request id", async () => {
  const { deps, calls } = fixtureDeps({ autoOffer: true, offerRequestId: null });
  const result = await processOutlookBounce(syntheticBounce, deps);

  assert.equal(result.status, "offer_recovered");
  assert.equal(calls.sendInputs.length, 1);
  assert.equal(calls.customerUpdates.length, 1);
});

test("conflicting offer request id still blocks automatic resend", async () => {
  const { deps, calls } = fixtureDeps({ autoOffer: true, offerRequestId: "REQ-OTHER" });
  const result = await processOutlookBounce(syntheticBounce, deps);

  assert.equal(result.status, "correction_proposed");
  assert.equal(calls.sendInputs.length, 0);
  assert.equal(calls.customerUpdates.length, 0);
});

test("unconfirmed automatic resend never changes the customer email", async () => {
  const { deps, calls } = fixtureDeps({ autoOffer: true, sendFailure: true });
  const result = await processOutlookBounce(syntheticBounce, deps);

  assert.equal(result.status, "offer_recovery_failed");
  assert.equal(result.customerCommunicationSent, false);
  assert.equal(result.customerDataChanged, false);
  assert.equal(calls.sendInputs.length, 1);
  assert.equal(calls.customerUpdates.length, 0);
  assert.equal(calls.taskUpdateInputs.at(-1)?.status, "open");
  assert.equal(calls.auditInputs.at(-1)?.status, "failed");
});

test("multiple sent offers are ambiguous and remain governed manual work", async () => {
  const { deps, calls } = fixtureDeps({ autoOffer: true, multipleOffers: true });
  const result = await processOutlookBounce(syntheticBounce, deps);

  assert.equal(result.status, "correction_proposed");
  assert.equal(calls.sendInputs.length, 0);
  assert.equal(calls.customerUpdates.length, 0);
  assert.equal(calls.actionInputs.length, 1);
});

test("existing corrected send evidence finalizes data without a second send", async () => {
  const { deps, calls } = fixtureDeps({ autoOffer: true, priorSend: true });
  const result = await processOutlookBounce(syntheticBounce, deps);

  assert.equal(result.status, "offer_recovered");
  assert.equal(result.customerCommunicationSent, true);
  assert.equal(calls.sendInputs.length, 0);
  assert.equal(calls.customerUpdates.length, 1);
  assert.equal(result.send?.duplicate, true);
});

test("confirmed send with pending data update is never reported as unsent", async () => {
  const { deps, calls } = fixtureDeps({ autoOffer: true, customerUpdateFailure: true });
  const result = await processOutlookBounce(syntheticBounce, deps);

  assert.equal(result.status, "offer_sent_customer_update_pending");
  assert.equal(result.customerCommunicationSent, true);
  assert.equal(result.customerDataChanged, true);
  assert.equal(calls.sendInputs.length, 1);
  assert.equal(calls.taskUpdateInputs.at(-1)?.status, "waiting");
  assert.equal(calls.auditInputs.at(-1)?.status, "blocked");
});

test("confirmed send keeps the case open when the offer snapshot email update fails", async () => {
  const { deps, calls } = fixtureDeps({ autoOffer: true, offerUpdateFailure: true });
  const result = await processOutlookBounce(syntheticBounce, deps);

  assert.equal(result.status, "offer_sent_customer_update_pending");
  assert.equal(result.customerCommunicationSent, true);
  assert.equal(result.customerDataChanged, true);
  assert.equal(calls.sendInputs.length, 1);
  assert.equal(calls.offerUpdateInputs.length, 1);
  assert.equal(calls.customerUpdates.length, 1);
  assert.equal(calls.taskUpdateInputs.at(-1)?.status, "waiting");
});

test("existing corrected send finishes a stale offer snapshot without another email", async () => {
  const { deps, calls } = fixtureDeps({
    autoOffer: true,
    priorSend: true,
    currentEmail: "kunde@gmail.com",
  });
  const result = await processOutlookBounce(syntheticBounce, deps);

  assert.equal(result.status, "offer_recovered");
  assert.equal(calls.sendInputs.length, 0);
  assert.equal(calls.offerUpdateInputs.length, 1);
  assert.equal(calls.customerUpdates.length, 0);
  assert.equal(result.customerDataChanged, true);
});

test("unknown mailbox at a valid provider creates review work but no invented correction", async () => {
  const { deps, calls } = fixtureDeps();
  const result = await processOutlookBounce({
    ...syntheticBounce,
    message_id: "synthetic-ndr-2",
    matched_email: "kunde@gmx.de",
    to_emails: ["kunde@gmx.de"],
    body_preview: "550 5.1.351 Remote server returned unknown recipient or mailbox unavailable.",
  }, deps);

  assert.equal(result.status, "review_task_created");
  assert.equal(result.analysis.suggestedEmail, null);
  assert.equal(calls.taskInputs.length, 1);
  assert.equal(calls.actionInputs.length, 0);
});

test("non-bounce mail is ignored without writes", async () => {
  const { deps, calls } = fixtureDeps();
  const result = await processOutlookBounce({
    ...syntheticBounce,
    subject: "Vielen Dank für Ihre Nachricht",
    body_preview: "Wir melden uns bald.",
  }, deps);

  assert.equal(result.status, "ignored");
  assert.equal(calls.taskInputs.length, 0);
  assert.equal(calls.actionInputs.length, 0);
  assert.equal(calls.auditInputs.length, 0);
});

test("internal bounce route requires its existing shared service credential", async () => {
  const originalKey = process.env.OPS_INTERNAL_API_KEY;
  const testKey = "x".repeat(32);
  process.env.OPS_INTERNAL_API_KEY = testKey;
  const { deps } = fixtureDeps();
  try {
    const unauthorized = await handleEmailBouncePost(new NextRequest("http://localhost/api/internal/company-brain/email-bounces", {
      method: "POST",
      body: JSON.stringify(syntheticBounce),
      headers: { "content-type": "application/json" },
    }), deps);
    assert.equal(unauthorized.status, 401);

    const authorized = await handleEmailBouncePost(new NextRequest("http://localhost/api/internal/company-brain/email-bounces", {
      method: "POST",
      body: JSON.stringify(syntheticBounce),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${testKey}`,
      },
    }), deps);
    const payload = await authorized.json();
    assert.equal(authorized.status, 200);
    assert.equal(authorized.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(payload.status, "correction_proposed");
    assert.equal(payload.customerCommunicationSent, false);
    assert.equal(payload.customerDataChanged, false);
  } finally {
    if (originalKey === undefined) delete process.env.OPS_INTERNAL_API_KEY;
    else process.env.OPS_INTERNAL_API_KEY = originalKey;
  }
});
