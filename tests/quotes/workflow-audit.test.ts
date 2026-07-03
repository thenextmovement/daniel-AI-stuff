import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWorkflowAuditEvent } from "@/lib/ops/workflow-audit";
import { QuoteValidationError } from "@/lib/quotes/validation";

test("workflow audit normalizes n8n offer failure events", () => {
  const event = normalizeWorkflowAuditEvent({
    workflowName: "offer_from_trello",
    action: "create_and_send_offer",
    status: "failed",
    trelloCardId: "FYXcIQ9K",
    executionId: 12345,
    correlationId: "trello:FYXcIQ9K:move:abc",
    idempotencyKey: "offer-send:trello:FYXcIQ9K:v1",
    failedNode: "Create Offer",
    errorMessage: "customer_email missing",
    retrySafety: "blocked",
    metadata: {
      raw_node_type: "httpRequest",
    },
  });

  assert.equal(event.documentId, "trello:FYXcIQ9K");
  assert.equal(event.workflowName, "offer_from_trello");
  assert.equal(event.status, "failed");
  assert.equal(event.errorMessage, "customer_email missing");
  assert.match(event.auditEventKey, /^workflow-audit:/);
  assert.equal(event.metadata.trello_card_id, "FYXcIQ9K");
  assert.equal(event.metadata.execution_id, "12345");
  assert.equal(event.metadata.failed_node, "Create Offer");
  assert.equal(event.metadata.retry_safety, "blocked");
  assert.equal(event.metadata.idempotency_key, "offer-send:trello:FYXcIQ9K:v1");
  assert.equal(event.metadata.audit_contract_version, 1);
});

test("workflow audit creates stable event keys for duplicate n8n callbacks", () => {
  const first = normalizeWorkflowAuditEvent({
    workflowName: "offer_from_trello",
    action: "create_and_send_offer",
    status: "failed",
    trelloCardId: "FYXcIQ9K",
    idempotencyKey: "offer-send:trello:FYXcIQ9K:v1",
    failedNode: "Create Offer",
  });
  const second = normalizeWorkflowAuditEvent({
    workflowName: "offer_from_trello",
    action: "create_and_send_offer",
    status: "failed",
    trelloCardId: "FYXcIQ9K",
    idempotencyKey: "offer-send:trello:FYXcIQ9K:v1",
    failedNode: "Create Offer",
  });

  assert.equal(first.auditEventKey, second.auditEventKey);
});

test("workflow audit rejects events without a source reference", () => {
  assert.throws(
    () => normalizeWorkflowAuditEvent({
      workflowName: "offer_from_trello",
      action: "create_and_send_offer",
      status: "failed",
    }),
    QuoteValidationError,
  );
});
