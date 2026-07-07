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

test("workflow audit accepts direct snake-case n8n guard blocked payloads", () => {
  const event = normalizeWorkflowAuditEvent({
    workflow_name: "NEONTRIP Quote Ready SIMPLE v1.1",
    action: "offer_send",
    status: "blocked",
    reason: "send_guard_unavailable: invalid_guard_response",
    retry_safety: "blocked",
    request_id: "REQ-GUARD",
    card_id: "6a4b53ee91f140e2ecd67e2f",
    card_url: "https://trello.com/c/BiP93WuG",
    document_id: "REQ-GUARD",
    failed_node: "Evaluate Guard",
    idempotency_key: "quote-ready-guard-block:REQ-GUARD:doc-1",
    correlation_id: "trello:6a4b53ee91f140e2ecd67e2f:quote-ready",
    action_id: "trello-action-1",
    customer_communication_sent: false,
    metadata: {
      raw_status: "blocked",
    },
  });

  assert.equal(event.documentId, "REQ-GUARD");
  assert.equal(event.workflowName, "NEONTRIP Quote Ready SIMPLE v1.1");
  assert.equal(event.action, "offer_send");
  assert.equal(event.status, "blocked");
  assert.equal(event.errorMessage, "send_guard_unavailable: invalid_guard_response");
  assert.equal(event.metadata.request_id, "REQ-GUARD");
  assert.equal(event.metadata.trello_card_id, "6a4b53ee91f140e2ecd67e2f");
  assert.equal(event.metadata.card_id, "6a4b53ee91f140e2ecd67e2f");
  assert.equal(event.metadata.card_url, "https://trello.com/c/BiP93WuG");
  assert.equal(event.metadata.source_event_id, "trello-action-1");
  assert.equal(event.metadata.idempotency_key, "quote-ready-guard-block:REQ-GUARD:doc-1");
  assert.equal(event.metadata.customer_communication_sent, false);
  assert.equal(event.metadata.retry_safety, "blocked");
  assert.equal(event.metadata.automation_issue_key, "send_guard_unavailable");
});

test("workflow audit marks AI copy hard blocks as non-sendable", () => {
  const event = normalizeWorkflowAuditEvent({
    workflow_name: "NEONTRIP Quote Ready SIMPLE v1.1",
    action: "offer_send",
    status: "blocked",
    reason: "ai_customer_copy_blocked: forbidden words after retry",
    request_id: "REQ-AI-BLOCK",
    card_id: "trello-card-ai-block",
    failed_node: "Parse + Validate Retry",
    customer_communication_sent: false,
  });

  assert.equal(event.status, "blocked");
  assert.equal(event.metadata.retry_safety, "blocked");
  assert.equal(event.metadata.customer_communication_sent, false);
  assert.equal(event.metadata.automation_issue_key, "ai_customer_copy_blocked");
  assert.match(String(event.metadata.automation_issue_root_cause), /Inhaltsprüfung/);
});

test("workflow audit marks n8n workflow hard errors as blocked", () => {
  const event = normalizeWorkflowAuditEvent({
    workflow_name: "NEONTRIP Quote Ready SIMPLE v1.1",
    action: "offer_send",
    status: "failed",
    reason: "workflow_hard_error: Outlook: E-Mail senden failed in execution 2770420",
    execution_id: "2770420",
    failed_node: "Outlook: E-Mail senden",
    idempotency_key: "quote-ready-workflow-error:2770420",
    customer_communication_sent: false,
  });

  assert.equal(event.documentId, "execution:2770420");
  assert.equal(event.metadata.retry_safety, "blocked");
  assert.equal(event.metadata.execution_id, "2770420");
  assert.equal(event.metadata.automation_issue_key, "workflow_hard_error");
  assert.match(String(event.metadata.automation_issue_recommended_fix), /n8n-Execution/);
});

test("workflow audit marks Outlook Graph auth failures as blocked", () => {
  const event = normalizeWorkflowAuditEvent({
    workflow_name: "NEONTRIP Quote Ready SIMPLE v1.1",
    action: "offer_send",
    status: "failed",
    reason: "Outlook Graph send failed: 403 Authorization_RequestDenied Mail.Send permission missing",
    request_id: "REQ-GRAPH-AUTH",
    failed_node: "Outlook: E-Mail senden",
    customer_communication_sent: false,
  });

  assert.equal(event.metadata.retry_safety, "blocked");
  assert.equal(event.metadata.automation_issue_key, "outlook_auth_failed");
  assert.match(String(event.metadata.automation_issue_recommended_fix), /Graph App/);
});

test("workflow audit marks offer API failures as blocked", () => {
  const event = normalizeWorkflowAuditEvent({
    workflow_name: "NEONTRIP Quote Ready SIMPLE v1.1",
    action: "offer_send",
    status: "failed",
    reason: "Offer API create snapshot failed with 500 validation schema error",
    request_id: "REQ-OFFER-API",
    failed_node: "Create Offer",
    customer_communication_sent: false,
  });

  assert.equal(event.metadata.retry_safety, "blocked");
  assert.equal(event.metadata.automation_issue_key, "offer_api_failed");
  assert.match(String(event.metadata.automation_issue_root_cause), /Offer-API|Angebotsanlage/);
});

test("workflow audit marks asset processing failures as blocked", () => {
  const event = normalizeWorkflowAuditEvent({
    workflow_name: "NEONTRIP Quote Ready SIMPLE v1.1",
    action: "offer_send",
    status: "failed",
    reason: "attachment_download_failed: mockup image not found for offer asset",
    request_id: "REQ-ASSET",
    failed_node: "Download Attachments",
    customer_communication_sent: false,
  });

  assert.equal(event.metadata.retry_safety, "blocked");
  assert.equal(event.metadata.automation_issue_key, "asset_processing_failed");
  assert.match(String(event.metadata.automation_issue_recommended_fix), /Assets|Anhänge/);
});

test("workflow audit keeps company brain internal fixes observable without customer send", () => {
  const event = normalizeWorkflowAuditEvent({
    workflowName: "company_brain_fix_center",
    action: "prepare_email_correction",
    status: "prepared",
    requestId: "REQ-CB-1",
    trelloCardId: "BiP93WuG",
    offerNumber: "14427",
    sourceEventId: "task-cb-1",
    idempotencyKey: "company-brain:prepare_email_correction:REQ-CB-1:offer_not_sent:v1",
    retrySafety: "safe_after_review",
    customer_communication_sent: false,
    metadata: {
      internal_only: true,
      task_id: "task-cb-1",
      operator_name: "daniel",
      recipient_email: "kunde@example.de",
    },
  });

  assert.equal(event.documentId, "REQ-CB-1");
  assert.equal(event.workflowName, "company_brain_fix_center");
  assert.equal(event.action, "prepare_email_correction");
  assert.equal(event.status, "prepared");
  assert.equal(event.metadata.request_id, "REQ-CB-1");
  assert.equal(event.metadata.trello_card_id, "BiP93WuG");
  assert.equal(event.metadata.offer_number, "14427");
  assert.equal(event.metadata.source_event_id, "task-cb-1");
  assert.equal(event.metadata.idempotency_key, "company-brain:prepare_email_correction:REQ-CB-1:offer_not_sent:v1");
  assert.equal(event.metadata.retry_safety, "safe_after_review");
  assert.equal(event.metadata.customer_communication_sent, false);
  assert.equal(event.metadata.internal_only, true);
  assert.equal(event.metadata.task_id, "task-cb-1");
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
