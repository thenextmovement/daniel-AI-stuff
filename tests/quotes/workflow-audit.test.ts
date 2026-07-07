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
  assert.equal(event.metadata.automation_issue_key, "customer_email_missing");
  assert.match(String(event.metadata.automation_issue_root_cause), /keine belastbare Kunden-E-Mail-Adresse/);
  assert.match(String(event.metadata.automation_issue_recommended_fix), /Kunden-E-Mail/);
  assert.equal(event.metadata.idempotency_key, "offer-send:trello:FYXcIQ9K:v1");
  assert.equal(event.metadata.audit_contract_version, 1);
});

test("workflow audit derives structured issue metadata from raw n8n invalid email errors", () => {
  const event = normalizeWorkflowAuditEvent({
    workflowName: "NEONTRIP Quote Ready SIMPLE v1.1",
    action: "offer_send",
    status: "failed",
    trelloCardId: "BiP93WuG",
    executionId: "2770420",
    failedNode: "Offer Send",
    errorMessage: "Offer send failed: invalid customer_email praxis@kurswechsel",
  });

  assert.equal(event.documentId, "trello:BiP93WuG");
  assert.equal(event.metadata.automation_issue_key, "customer_email_invalid");
  assert.match(String(event.metadata.automation_issue_root_cause), /praxis@kurswechsel/);
  assert.match(String(event.metadata.automation_issue_recommended_fix), /Korrekte Kunden-E-Mail/);
  assert.match(String(event.metadata.automation_issue_retry_safety), /Kein Retry/);
  assert.equal(event.metadata.retry_safety, "blocked");
  assert.equal(event.metadata.summary, event.metadata.automation_issue_root_cause);
});

test("workflow audit marks unavailable send guards as blocked", () => {
  const event = normalizeWorkflowAuditEvent({
    workflowName: "NEONTRIP Quote Ready SIMPLE v1.1",
    action: "offer_send",
    status: "blocked",
    requestId: "REQ-GUARD",
    failedNode: "Evaluate Guard",
    errorMessage: "send_guard_unavailable: invalid_guard_response",
  });

  assert.equal(event.metadata.automation_issue_key, "send_guard_unavailable");
  assert.match(String(event.metadata.automation_issue_root_cause), /Versand-Guard/);
  assert.match(String(event.metadata.automation_issue_recommended_fix), /Keinen Angebotsversand/);
  assert.equal(event.metadata.retry_safety, "blocked");
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
