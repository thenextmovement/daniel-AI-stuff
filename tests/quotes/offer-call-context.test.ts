import test from "node:test";
import assert from "node:assert/strict";
import { buildOfferCallTaskOnlyContexts, offerTaskReferenceKeys, selectPendingOfferCallTaskForOffer } from "@/lib/ops/offer-call-context";
import type { CustomerInternalTask } from "@/lib/ops/customer-records";

function task(overrides: Partial<CustomerInternalTask>): CustomerInternalTask {
  return {
    id: "task_1",
    title: "Erstes Angebot jetzt bitte anrufen",
    description: null,
    status: "open",
    category: "call",
    priority: "high",
    assigneeName: "Daniel + Fabienne",
    dueAt: "2026-06-13T09:00:00.000Z",
    requestId: "req_1",
    customerName: "Max Kunde",
    customerEmail: "kunde@example.com",
    createdAt: "2026-06-13T08:00:00.000Z",
    createdBy: "Automation",
    updatedAt: "2026-06-13T08:00:00.000Z",
    updatedBy: "Automation",
    completedAt: null,
    completedBy: null,
    latestNote: null,
    clientActionId: null,
    idempotencyKey: "source:neontrip_offer_call:offer_123:first-offer-sent",
    sourceType: "neontrip_offer_call",
    sourceId: "offer_123:first-offer-sent",
    originLabel: "Intern",
    overdue: false,
    ...overrides,
  };
}

test("offer call context builds stable offer task reference keys", () => {
  assert.deepEqual(offerTaskReferenceKeys({
    offerId: "offer_123",
    documentReference: "A/N 14123",
    offerNumber: "A/N 14123",
  }), ["offer_123", "A/N 14123"]);
});

test("offer call context finds pending call task by offer source id", () => {
  const selected = selectPendingOfferCallTaskForOffer([
    task({
      id: "other",
      sourceId: "offer_999:first-offer-sent",
      idempotencyKey: "source:neontrip_offer_call:offer_999:first-offer-sent",
    }),
    task({ id: "matching", sourceId: "offer_123:first-offer-sent" }),
  ], { offerId: "offer_123" });

  assert.deepEqual(selected, {
    id: "matching",
    title: "Erstes Angebot jetzt bitte anrufen",
    dueAt: "2026-06-13T09:00:00.000Z",
    assigneeName: "Daniel + Fabienne",
    sourceType: "neontrip_offer_call",
    sourceId: "offer_123:first-offer-sent",
  });
});

test("offer call context ignores done and unrelated tasks", () => {
  const selected = selectPendingOfferCallTaskForOffer([
    task({ id: "done", status: "done", sourceId: "offer_123:first-offer-sent" }),
    task({ id: "wrong-category", category: "admin", sourceId: "offer_123:first-offer-sent" }),
    task({ id: "wrong-source", sourceType: "neontrip_inquiry_call", sourceId: "offer_123:first-offer-sent" }),
  ], { offerId: "offer_123" });

  assert.equal(selected, null);
});

test("offer call context uses the earliest matching due task", () => {
  const selected = selectPendingOfferCallTaskForOffer([
    task({ id: "later", dueAt: "2026-06-13T12:00:00.000Z" }),
    task({ id: "earlier", dueAt: "2026-06-13T09:00:00.000Z" }),
  ], { offerId: "offer_123" });

  assert.equal(selected?.id, "earlier");
});

test("offer call task summary resolves a whole offer list without customer-record searches", () => {
  const contexts = buildOfferCallTaskOnlyContexts([
    task({ id: "matching", sourceId: "offer_123:first-offer-sent" }),
  ], [
    { offerId: "offer_123", customerEmail: "kunde@example.com" },
    { offerId: "offer_without_task", customerEmail: "andere@example.com" },
  ]);

  assert.equal(contexts[0]?.matched, true);
  assert.equal(contexts[0]?.pendingOfferCallTask?.id, "matching");
  assert.equal(contexts[0]?.customerRecordUrl, "/ops/customer-records?query=req_1");
  assert.deepEqual(contexts[1], {
    offerId: "offer_without_task",
    matched: false,
    matchedBy: "none",
    pendingOfferCallTask: null,
  });
});
