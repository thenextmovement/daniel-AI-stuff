import assert from "node:assert/strict";
import {
  addShadowDispatch,
  buildDecisionRequestCode,
  shadowWorkflow,
  validateDecisionCode,
} from "./build-workflows.mjs";

const triggers = shadowWorkflow.nodes.filter((node) => node.type.endsWith("Trigger"));
assert.equal(triggers.length, 1);
assert.ok(shadowWorkflow.nodes.length <= 30);
assert.doesNotMatch(JSON.stringify(shadowWorkflow), /graph[.]microsoft[.]com/i);
assert.doesNotMatch(JSON.stringify(shadowWorkflow), /createReply|sendMail|replyAll/i);
assert.match(JSON.stringify(shadowWorkflow), /record_email_agent_decision_shadow_v1/);

for (const node of shadowWorkflow.nodes.filter((entry) => entry.type === "n8n-nodes-base.httpRequest")) {
  assert.ok(node.credentials);
  assert.ok(node.retryOnFail);
  assert.equal(node.onError, "stopWorkflow");
}

const aiNode = shadowWorkflow.nodes.find((node) => node.name === "Classify Decision JSON");
assert.ok(aiNode.credentials);
assert.equal(aiNode.parameters.options.temperature, 0);
assert.ok(aiNode.parameters.options.maxTokens <= 500);
assert.match(aiNode.parameters.options.system, /prompt_system/);
assert.equal(aiNode.onError, "continueErrorOutput");

const buildDecision = new Function("$input", "$execution", buildDecisionRequestCode);

function build(input, executionId = "test-execution") {
  return buildDecision(
    { first: () => ({ json: input }) },
    { id: executionId },
  )[0].json;
}

const automated = build({
  messageId: "auto-1",
  conversationId: "conversation-1",
  subject: "Automatische Antwort",
  sourceFromEmail: "noreply@example.com",
  shouldProcess: false,
  skipReason: "automated_message",
});
assert.equal(automated.needs_ai, false);
assert.equal(automated.deterministic_decision, "no_reply");
assert.deepEqual(automated.deterministic_reason_codes, ["automated_notification"]);

const acknowledgement = build({
  messageId: "ack-1",
  conversationId: "conversation-2",
  subject: "AW: Angebot",
  fromEmail: "anna@example.com",
  latestMessageText: "Vielen Dank!",
  shouldProcess: true,
  skipReason: "",
});
assert.equal(acknowledgement.needs_ai, false);
assert.equal(acknowledgement.deterministic_decision, "no_reply");

const question = build({
  messageId: "question-1",
  conversationId: "conversation-3",
  subject: "Lieferung",
  fromEmail: "anna@example.com",
  latestMessageText: "Wann wird die Bestellung geliefert?",
  shouldProcess: true,
  skipReason: "",
});
assert.equal(question.needs_ai, true);
assert.equal(question.actionable_signal, true);

const highRisk = build({
  messageId: "risk-1",
  conversationId: "conversation-4",
  subject: "Beschwerde",
  fromEmail: "anna@example.com",
  latestMessageText: "Ich verlange eine Rückerstattung.",
  shouldProcess: true,
  skipReason: "",
});
assert.equal(highRisk.needs_ai, false);
assert.equal(highRisk.deterministic_decision, "human_review");
assert.ok(highRisk.deterministic_risk_flags.includes("refund_discount"));

function validate(source, aiResult) {
  const validateDecision = new Function("$input", "$", validateDecisionCode);
  return validateDecision(
    { first: () => ({ json: aiResult }) },
    () => ({ first: () => ({ json: source }) }),
  )[0].json;
}

const validDraft = validate(question, {
  merged_response: JSON.stringify({
    decision: "draft",
    confidence: 0.96,
    summary: "Customer asks a normal delivery question.",
    reason_codes: ["customer_question", "requires_system_lookup"],
    risk_flags: [],
    requires_human_review: false,
  }),
});
assert.equal(validDraft.final_decision, "draft");
assert.equal(validDraft.validation_status, "valid_ai");
assert.equal(validDraft.shadow_only, true);

const unsafeNoReply = validate(question, {
  merged_response: JSON.stringify({
    decision: "no_reply",
    confidence: 0.98,
    summary: "No answer needed.",
    reason_codes: ["conversation_closed"],
    risk_flags: [],
    requires_human_review: false,
  }),
});
assert.equal(unsafeNoReply.final_decision, "human_review");
assert.equal(unsafeNoReply.validation_status, "fallback_unsafe_no_reply");

const lowConfidence = validate({ ...question, actionable_signal: false, question_present: false }, {
  merged_response: JSON.stringify({
    decision: "draft",
    confidence: 0.7,
    summary: "Unclear.",
    reason_codes: ["unclear_intent"],
    risk_flags: [],
    requires_human_review: false,
  }),
});
assert.equal(lowConfidence.final_decision, "human_review");
assert.equal(lowConfidence.validation_status, "fallback_low_confidence");

const risky = validate(question, {
  merged_response: JSON.stringify({
    decision: "draft",
    confidence: 0.99,
    summary: "Refund request.",
    reason_codes: ["complaint_or_risk"],
    risk_flags: ["refund_discount"],
    requires_human_review: true,
  }),
});
assert.equal(risky.final_decision, "human_review");
assert.equal(risky.validation_status, "fallback_risk");

const invalid = validate(question, { merged_response: "not json" });
assert.equal(invalid.final_decision, "human_review");
assert.equal(invalid.validation_status, "fallback_invalid_ai");

const baseWorkflow = {
  name: "AI Email Agent v3 — Draft Only",
  nodes: Array.from({ length: 29 }, (_, index) => ({
    id: `node-${index}`,
    name: index === 0 ? "Normalize Email" : `Node ${index}`,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [index * 20, 0],
    parameters: {},
  })),
  connections: {
    "Normalize Email": {
      main: [[{ node: "Should Process Email?", type: "main", index: 0 }]],
    },
  },
  settings: { executionOrder: "v1" },
};
const patched = addShadowDispatch(baseWorkflow, "shadow-workflow-id");
assert.equal(patched.nodes.length, 30);
assert.ok(patched.connections["Normalize Email"].main[0]
  .some((connection) => connection.node === "Should Process Email?"));
assert.ok(patched.connections["Normalize Email"].main[0]
  .some((connection) => connection.node === "Dispatch Decision Shadow"));
const dispatch = patched.nodes.find((node) => node.name === "Dispatch Decision Shadow");
assert.equal(dispatch.parameters.options.waitForSubWorkflow, false);
assert.equal(dispatch.onError, "continueRegularOutput");
assert.equal(patched.connections["Dispatch Decision Shadow"], undefined);

console.log("Email decision shadow workflow tests passed.");
