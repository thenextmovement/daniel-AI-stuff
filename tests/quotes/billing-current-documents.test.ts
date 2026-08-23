import assert from "node:assert/strict";
import test from "node:test";
import { selectCurrentBillingDocuments } from "../../src/lib/ops/billing/current-documents";

const document = (id: string, documentType: string, revision: number, status = "SENT", createdAt = "2026-08-23T10:00:00.000Z") => ({
  id, document_type: documentType, revision, status, created_at: createdAt,
});

test("customer portal keeps only the newest version of each document type", () => {
  const current = selectCurrentBillingDocuments([
    document("pf-0", "PROFORMA", 0),
    document("pf-1", "PROFORMA", 1),
    document("invoice-0", "INVOICE", 0),
    document("credit-0", "CREDIT", 0),
  ]);
  assert.deepEqual(current.map((entry) => entry.id).sort(), ["credit-0", "invoice-0", "pf-1"]);
});

test("a newer draft makes the older sent version unavailable", () => {
  const current = selectCurrentBillingDocuments([
    document("pf-sent", "PROFORMA", 1, "SENT"),
    document("pf-draft", "PROFORMA", 2, "DRAFT"),
  ]);
  assert.equal(current.length, 1);
  assert.equal(current[0].id, "pf-draft");
  assert.equal(current[0].status, "DRAFT");
});

test("same revision uses the newest created document deterministically", () => {
  const current = selectCurrentBillingDocuments([
    document("older", "CANCELLATION", 0, "FINALIZED", "2026-08-23T10:00:00.000Z"),
    document("newer", "CANCELLATION", 0, "FINALIZED", "2026-08-23T11:00:00.000Z"),
  ]);
  assert.equal(current[0].id, "newer");
});
