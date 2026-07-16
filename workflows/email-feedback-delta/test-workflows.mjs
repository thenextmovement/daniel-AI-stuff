import assert from "node:assert/strict";
import {
  buildFeedbackCode,
  normalizeSentDeltaCode,
  reviewMatcherWorkflow,
  sentDeltaWorkflow,
} from "./build-workflows.mjs";

function workflowTriggers(workflow) {
  return workflow.nodes.filter((node) => node.type.endsWith("Trigger"));
}

function httpNodes(workflow) {
  return workflow.nodes.filter((node) => node.type === "n8n-nodes-base.httpRequest");
}

for (const workflow of [sentDeltaWorkflow, reviewMatcherWorkflow]) {
  assert.equal(workflowTriggers(workflow).length, 1, `${workflow.name} must have one trigger`);
  assert.ok(workflow.nodes.length <= 30, `${workflow.name} exceeds 30 nodes`);
  for (const node of httpNodes(workflow)) {
    assert.ok(node.onError === "stopWorkflow", `${node.name} must stop and log unexpected failures`);
    assert.ok(node.retryOnFail, `${node.name} must retry transient transport failures`);
    assert.ok(node.credentials, `${node.name} must use an n8n credential`);
  }
  assert.doesNotMatch(JSON.stringify(workflow), /Bearer\s+[A-Za-z0-9._-]+/);
}

const graphNodes = httpNodes(sentDeltaWorkflow)
  .filter((node) => String(node.parameters.url).includes("request_url"));
assert.equal(graphNodes.length, 1, "delta indexer must perform exactly one Graph call per execution");
assert.equal(
  graphNodes[0].parameters.options.response.response.neverError,
  true,
  "Graph 429 responses must reach deterministic backoff handling",
);
assert.equal(graphNodes[0].parameters.options.response.response.fullResponse, true);
assert.match(JSON.stringify(sentDeltaWorkflow), /begin_email_agent_sent_sync_v1/);
assert.match(JSON.stringify(sentDeltaWorkflow), /record_email_agent_sent_sync_result_v1/);
assert.doesNotMatch(JSON.stringify(reviewMatcherWorkflow), /graph\.microsoft\.com/i);
assert.match(JSON.stringify(reviewMatcherWorkflow), /get_email_agent_feedback_candidates_v1/);
assert.match(JSON.stringify(reviewMatcherWorkflow), /record_email_agent_feedback_from_index_v1/);
assert.match(buildFeedbackCode, /auto_prompt_update_allowed:\s*false/);
assert.match(buildFeedbackCode, /human_review_required_for_learning:\s*true/);
assert.doesNotMatch(JSON.stringify(sentDeltaWorkflow), /\bnew URL\s*\(/);

const buildDeltaNode = sentDeltaWorkflow.nodes.find((node) => node.name === "Build Delta Request");
const buildDeltaRequest = new Function("$input", "URL", buildDeltaNode.parameters.jsCode);
const builtRequest = buildDeltaRequest(
  {
    first: () => ({
      json: {
        should_request: true,
        mailbox_key: "support@neontrip.de",
        execution_id: "test-build",
        correlation_id: "email-sent-delta:test-build",
        cursor_kind: "initial",
        cursor_url: null,
        initial_since: "2026-07-02T10:00:00.000Z",
      },
    }),
  },
  undefined,
);
assert.match(
  builtRequest[0].json.request_url,
  /^https:\/\/graph[.]microsoft[.]com\/v1[.]0\/me\/mailFolders\/sentitems\/messages\/delta[?]/,
);

const normalizeDelta = new Function("$input", "$", "URL", normalizeSentDeltaCode);
const deltaLink = "https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages/delta?$deltatoken=test";
const normalized = normalizeDelta(
  {
    first: () => ({
      json: {
        statusCode: 200,
        headers: {},
        body: {
          "@odata.deltaLink": deltaLink,
          value: [{
            id: "sent-1",
            internetMessageId: "<sent-1@example.com>",
            conversationId: "conversation-1",
            sentDateTime: "2026-07-16T10:00:00Z",
            receivedDateTime: "2026-07-16T10:00:00Z",
            subject: "Test",
            toRecipients: [{ emailAddress: { address: "anna@example.com" } }],
            body: {
              content: "<p>Hallo Anna,</p><p>vielen Dank.</p><p>Viele Grüße</p><p>Fabienne Trapp</p><p>NEONTRIP</p>",
            },
          }],
        },
      },
    }),
  },
  () => ({
    first: () => ({
      json: {
        mailbox_key: "support@neontrip.de",
        execution_id: "test-1",
        correlation_id: "email-sent-delta:test-1",
      },
    }),
  }),
  undefined,
);
assert.equal(normalized.length, 1);
assert.equal(normalized[0].json.p_http_status, 200);
assert.equal(normalized[0].json.p_cursor_kind, "delta");
assert.equal(normalized[0].json.p_messages.length, 1);
assert.doesNotMatch(normalized[0].json.p_messages[0].response_body_text, /Fabienne Trapp|NEONTRIP/);
assert.match(normalized[0].json.p_messages[0].response_body_text, /Viele Grüße/);

const normalizeThrottle = new Function("$input", "$", "URL", normalizeSentDeltaCode);
const throttled = normalizeThrottle(
  {
    first: () => ({
      json: {
        statusCode: 429,
        headers: { "retry-after": "180" },
        body: { error: { code: "TooManyRequests", message: "Please retry later" } },
      },
    }),
  },
  () => ({
    first: () => ({
      json: {
        mailbox_key: "support@neontrip.de",
        execution_id: "test-2",
        correlation_id: "email-sent-delta:test-2",
      },
    }),
  }),
  undefined,
);
assert.equal(throttled[0].json.p_http_status, 429);
assert.equal(throttled[0].json.p_retry_after_seconds, 180);
assert.deepEqual(throttled[0].json.p_messages, []);

const buildFeedback = new Function("$input", buildFeedbackCode);
const feedback = buildFeedback({
  all: () => [{
    json: {
      sent_index_id: 12,
      sent_graph_message_id: "sent-12",
      sent_internet_message_id: "<sent-12@example.com>",
      sent_conversation_id: "conversation-12",
      sent_at: "2026-07-16T11:00:00Z",
      sent_recipient_emails: ["anna@example.com"],
      sent_body_text: "Hallo Anna,\n\nder korrekte Preis beträgt 1.200,00 €.\n\nViele Grüße",
      source_message_id: "source-12",
      conversation_id: "conversation-12",
      draft_id: "draft-12",
      draft_body_hash: "draft-hash",
      draft_body_text: "Hallo Anna,\n\nder Preis beträgt 1.100,00 €.\n\nViele Grüße",
      draft_created_at: "2026-07-16T10:59:00Z",
      from_email: "anna@example.com",
      message_source: "external_email",
      risk_level: "high",
      reply_length_class: "simple",
    },
  }],
});
assert.equal(feedback.length, 1);
assert.equal(feedback[0].json.p_sent_index_id, 12);
assert.ok(feedback[0].json.p_edit_labels.includes("amount_changed"));
assert.ok(feedback[0].json.p_edit_labels.includes("factual_correction"));
assert.ok(feedback[0].json.p_edit_labels.includes("needs_human_review"));
assert.equal(feedback[0].json.p_review_priority, "high");
assert.equal(feedback[0].json.p_edit_summary.collector_version, "email-feedback-delta-v1");

console.log("Email feedback delta workflow tests passed.");
