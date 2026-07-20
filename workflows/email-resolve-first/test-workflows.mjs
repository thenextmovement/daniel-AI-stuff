import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  openInboxBackfillWorkflow,
  applyPassiveSafeStyleProfileV5Code,
  patchResolveFirstMainWorkflow,
  selectOpenInboxCandidatesCode,
} from "./build-workflows.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const source = JSON.parse(await readFile(
  join(directory, "..", "email-retry-recovery", "source", "main-workflow-active-20260717.json"),
  "utf8",
));
const main = patchResolveFirstMainWorkflow(source);

function node(workflow, name) {
  const result = workflow.nodes.find((entry) => entry.name === name);
  if (!result) throw new Error("Missing node: " + name);
  return result;
}

function runCode(code, input, nodeData = {}) {
  const execute = new Function("$input", "$", code);
  const dollarInput = {
    first: () => ({ json: input }),
    all: () => [{ json: input }],
  };
  const dollar = (name) => {
    if (!(name in nodeData)) throw new Error("Node not available: " + name);
    return {
      first: () => ({ json: nodeData[name] }),
      all: () => [{ json: nodeData[name] }],
    };
  };
  return execute(dollarInput, dollar);
}

const mainTriggers = main.nodes.filter((entry) => entry.type.toLowerCase().includes("trigger"));
assert.equal(mainTriggers.length, 1);
assert.equal(main.nodes.length, 30);
assert.equal(main.name, "AI Email Agent v7 — Resolve First Quality v5 — Draft Only");
assert.equal(main.nodes.filter((entry) => JSON.stringify(entry).includes("createReply")).length, 1);
assert.doesNotMatch(JSON.stringify(main), /sendMail|replyAll|\/send\b/i);

const promptCode = node(main, "Build Draft Prompt").parameters.jsCode;
assert.match(promptCode, /email-resolve-first-v2/);
assert.match(promptCode, /email-facts-package-v2/);
assert.match(promptCode, /signed_customer_contract/);
assert.match(promptCode, /Resolve first: before drafting, exhaust/);
assert.match(promptCode, /vague_internal_deferral_allowed: false/);
assert.match(promptCode, /customerReferenceMissing/);
assert.doesNotMatch(promptCode, /If facts are missing, say that the matter will be checked internally/);
assert.match(promptCode, /const styleCategory/);

const fetchStyleNode = node(main, "Fetch Approved Style Profile");
assert.match(fetchStyleNode.parameters.url, /get_email_agent_style_profile_v5$/);
assert.match(fetchStyleNode.parameters.jsonBody, /styleCategory/);
assert.equal(node(main, "Apply Approved Style Profile").parameters.jsCode, applyPassiveSafeStyleProfileV5Code);

const appliedStyle = runCode(applyPassiveSafeStyleProfileV5Code, {
  body: {
    version: "email-style-profile-v5-passive-safe",
    analyzer_version: "email-feedback-analyzer-v5",
    learning_mode: "passive_deterministic",
    eligible: true,
    scope: "channel",
    length_specific: true,
    safe_sample_count: 12,
    automatic_sample_count: 12,
    human_sample_count: 0,
    minimum_safe_samples: 10,
    recommended_max_words: 83,
    recommended_max_paragraphs: 1,
    preferred_closing: "Beste Grüße",
    prefer_shorter: true,
    prefer_direct_answer: true,
    avoid_restatement: true,
    facts_or_customer_content_included: false,
    fact_learning_allowed: false,
    automatic_prompt_rewrite_allowed: false,
    manual_review_required_for_safe_style: false,
    customer_send_human_approval_required: true,
    automatic_send_allowed: false,
  },
}, {
  "Build Draft Prompt": {
    expectedLanguage: "de",
    replyLengthClass: "simple",
    replyLengthLimits: { max_paragraphs: 3, max_characters: 1400 },
    systemPrompt: "BASE",
    userContext: "CONTEXT",
  },
})[0].json;
assert.equal(appliedStyle.approvedStyleProfile.eligible, true);
assert.equal(appliedStyle.approvedStyleProfile.automatic_sample_count, 12);
assert.equal(appliedStyle.replyLengthLimits.max_paragraphs, 1);
assert.match(appliedStyle.systemPrompt, /STYLE ONLY/);
assert.match(appliedStyle.systemPrompt, /structurally safe human-sent comparisons/);
assert.match(appliedStyle.systemPrompt, /direct answer/);
assert.doesNotMatch(appliedStyle.systemPrompt, /customer-specific wording from prior replies[\s\S]*(?:copy|reuse)/i);

const rejectedLegacyStyle = runCode(applyPassiveSafeStyleProfileV5Code, {
  body: {
    version: "email-style-profile-v2-human-gated",
    eligible: true,
    approved_sample_count: 50,
    recommended_max_words: 60,
  },
}, { "Build Draft Prompt": { systemPrompt: "BASE", userContext: "CONTEXT" } })[0].json;
assert.equal(rejectedLegacyStyle.approvedStyleProfile.eligible, false);

const rejectedUnsafePassiveStyle = runCode(applyPassiveSafeStyleProfileV5Code, {
  body: {
    version: "email-style-profile-v5-passive-safe",
    analyzer_version: "email-feedback-analyzer-v5",
    learning_mode: "passive_deterministic",
    eligible: true,
    scope: "global",
    safe_sample_count: 100,
    minimum_safe_samples: 10,
    recommended_max_words: 50,
    recommended_max_paragraphs: 1,
    facts_or_customer_content_included: false,
    fact_learning_allowed: false,
    automatic_prompt_rewrite_allowed: true,
    manual_review_required_for_safe_style: false,
    customer_send_human_approval_required: true,
    automatic_send_allowed: false,
  },
}, { "Build Draft Prompt": { systemPrompt: "BASE", userContext: "CONTEXT" } })[0].json;
assert.equal(rejectedUnsafePassiveStyle.approvedStyleProfile.eligible, false);

const renderCode = node(main, "Validate and Render").parameters.jsCode;
assert.match(renderCode, /unhelpful_internal_deferral/);
assert.match(renderCode, /email-draft-quality-gate-v4/);
assert.match(renderCode, /deterministic_render_valid/);
assert.match(renderCode, /deterministic_fallback_used/);
assert.match(renderCode, /Apply Approved Style Profile/);
assert.match(renderCode, /const forceFallback = validationReasons\.length > 0 \|\| meta\.possiblePromptInjection/);
assert.doesNotMatch(renderCode, /const highRiskBlocksDraft/);
assert.doesNotMatch(renderCode, /prüfen wir die Angaben noch einmal intern und melden uns anschließend/);
assert.doesNotMatch(renderCode, /review the details internally and get back to you afterwards/);
assert.equal(node(main, "Validate and Render").onError, "continueErrorOutput");
assert.equal(main.connections["Validate and Render"].main[1][0].node, "Build Failure Record");
assert.match(node(main, "Build Failure Record").parameters.jsCode, /nonRetryablePolicyBlock/);
assert.match(node(main, "Log Success").parameters.jsonBody, /email-context-v7/);
assert.match(node(main, "Log Success").parameters.jsonBody, /resolve_first_policy/);
assert.match(node(main, "Log Success").parameters.jsonBody, /manual_review_required_for_safe_style/);

const baseMeta = {
  fromName: "Anna",
  currentText: "Ich habe eine Beschwerde. Können Sie mir den aktuellen Stand direkt erklären?",
  expectedLanguage: "de",
  replyLengthClass: "simple",
  replyLengthLimits: { max_paragraphs: 3, max_characters: 1400 },
  deterministicRiskLevel: "high",
  possiblePromptInjection: false,
  allowedCustomerFactIds: [],
  factsPackage: { facts: [] },
  verifiedFactsText: "",
  actualCustomerAttachments: [],
  missingClaimedAttachmentRequests: [],
  financialReconciliation: { status: "not_applicable" },
  messageSource: "external_email",
  customerReferenceMissing: false,
};
const directHighRisk = runCode(renderCode, {
  text: JSON.stringify({
    category: "complaint",
    confidence: 0.88,
    language: "de",
    risk_level: "high",
    needs_human_approval: true,
    greeting: "Guten Tag Anna,",
    paragraphs: ["Der aktuelle Vorgang ist in Bearbeitung. Die von Ihnen genannte Änderung ist im bisherigen Verlauf berücksichtigt."],
    closing: "Viele Grüße",
    facts_used: [],
    blocked_reasons: [],
    missing_information: [],
  }),
}, { "Apply Approved Style Profile": baseMeta })[0].json;
assert.equal(directHighRisk.safeFallbackUsed, false);
assert.equal(directHighRisk.qualityGate.passed, true);
assert.doesNotMatch(directHighRisk.draftReplyText, /intern|melden uns/i);

const blockedDeferral = runCode(renderCode, {
  text: JSON.stringify({
    category: "invoice",
    confidence: 0.7,
    language: "de",
    risk_level: "high",
    needs_human_approval: true,
    greeting: "Guten Tag Anna,",
    paragraphs: ["Wir prüfen das noch einmal intern und melden uns anschließend bei Ihnen."],
    closing: "Viele Grüße",
    facts_used: [],
    blocked_reasons: [],
    missing_information: [],
  }),
}, { "Apply Approved Style Profile": { ...baseMeta, customerReferenceMissing: true } })[0].json;
assert.equal(blockedDeferral.safeFallbackUsed, true);
assert.ok(blockedDeferral.validationReasons.includes("unhelpful_internal_deferral"));
assert.match(blockedDeferral.draftReplyText, /Bestellnummer oder Angebotsnummer/);
assert.doesNotMatch(blockedDeferral.draftReplyText, /intern|melden uns/i);

const invalidModelFallback = runCode(renderCode, {
  text: "not-json",
}, { "Apply Approved Style Profile": { ...baseMeta, customerReferenceMissing: true } })[0].json;
assert.equal(invalidModelFallback.safeFallbackUsed, true);
assert.equal(invalidModelFallback.qualityGate.passed, true);
assert.equal(invalidModelFallback.qualityGate.model_json_valid, false);
assert.equal(invalidModelFallback.qualityGate.deterministic_fallback_used, true);
assert.match(invalidModelFallback.draftReplyText, /Bestellnummer oder Angebotsnummer/);
assert.doesNotMatch(invalidModelFallback.draftReplyText, /intern|melden uns/i);

assert.throws(() => runCode(renderCode, {
  text: JSON.stringify({
    category: "order_status",
    confidence: 0.7,
    language: "de",
    risk_level: "medium",
    needs_human_approval: true,
    greeting: "Guten Tag Anna,",
    paragraphs: ["Wir müssen den aktuellen Produktionsstatus intern prüfen."],
    closing: "Viele Grüße",
    facts_used: [],
    blocked_reasons: [],
    missing_information: ["Aktueller Produktions- und Versandstatus – muss intern geprüft werden, kann nicht vom Kunden geliefert werden."],
  }),
}, { "Apply Approved Style Profile": baseMeta }), /INTERNAL_EVIDENCE_MISSING/);

for (const paragraph of [
  "Damit wir dir weiterhelfen können, wird sich unser Team die Situation genau ansehen und eine passende Lösung finden.",
  "Ihren Wunsch haben wir intern weitergeleitet. Die Entscheidung muss intern abgestimmt werden, anschließend setzt sich unser Team mit Ihnen in Verbindung.",
]) {
  assert.throws(() => runCode(renderCode, {
    text: JSON.stringify({
      category: "complaint",
      confidence: 0.8,
      language: "de",
      risk_level: "high",
      needs_human_approval: true,
      greeting: "Guten Tag Anna,",
      paragraphs: [paragraph],
      closing: "Viele Grüße",
      facts_used: [],
      blocked_reasons: [],
      missing_information: ["Interne Entscheidung über die konkrete Maßnahme ist erforderlich."],
    }),
  }, { "Apply Approved Style Profile": baseMeta }), /INTERNAL_EVIDENCE_MISSING/);
}

const genericOpening = runCode(renderCode, {
  text: JSON.stringify({
    category: "general",
    confidence: 0.9,
    language: "de",
    risk_level: "low",
    needs_human_approval: true,
    greeting: "Guten Tag Anna,",
    paragraphs: ["Vielen Dank für Ihre Nachricht.", "Die angefragte Information ist im vorhandenen Vorgang eindeutig hinterlegt."],
    closing: "Viele Grüße",
    facts_used: [],
    blocked_reasons: [],
    missing_information: [],
  }),
}, { "Apply Approved Style Profile": { ...baseMeta, deterministicRiskLevel: "low" } })[0].json;
assert.ok(genericOpening.qualityGate.soft_flags.includes("generic_thank_you_before_answer"));
assert.equal(genericOpening.qualityGate.automatic_send_allowed, false);

const backfillTriggers = openInboxBackfillWorkflow.nodes.filter((entry) => entry.type.toLowerCase().includes("trigger"));
assert.equal(backfillTriggers.length, 1);
assert.ok(openInboxBackfillWorkflow.nodes.length <= 30);
assert.doesNotMatch(JSON.stringify(openInboxBackfillWorkflow), /createReply|sendMail|replyAll|\/send\b/i);
assert.match(JSON.stringify(openInboxBackfillWorkflow), /enqueue_email_agent_open_inbox_candidate/);
for (const httpNode of openInboxBackfillWorkflow.nodes.filter((entry) => entry.type === "n8n-nodes-base.httpRequest")) {
  assert.equal(httpNode.retryOnFail, true);
  assert.equal(httpNode.onError, "stopWorkflow");
  assert.ok(Number(httpNode.maxTries) >= 3);
}
const enqueueNode = openInboxBackfillWorkflow.nodes.find((entry) => entry.name === "Enqueue Open Inbox Candidate");
assert.equal(enqueueNode.parameters.authentication, "genericCredentialType");
assert.equal(enqueueNode.parameters.genericAuthType, "httpHeaderAuth");
assert.equal(enqueueNode.credentials.httpHeaderAuth.id, "NTtNxoBGGzJCQi9u");

const now = Date.now();
const at = (minutesAgo) => new Date(now - minutesAgo * 60000).toISOString();
const inbox = [
  {
    id: "actionable",
    internetMessageId: "<actionable@example.com>",
    conversationId: "c-actionable",
    subject: "Frage zur Bestellung",
    bodyPreview: "Können Sie mir bitte sagen, wann die Lieferung kommt?",
    from: { emailAddress: { address: "anna@example.com" } },
    receivedDateTime: at(300),
    isRead: true,
  },
  {
    id: "already-replied-verb",
    conversationId: "c-verb",
    subject: "Frage",
    bodyPreview: "Können Sie helfen?",
    from: { emailAddress: { address: "kunde@example.com" } },
    receivedDateTime: at(250),
    singleValueExtendedProperties: [{ id: "Integer 0x1081", value: "102" }],
  },
  {
    id: "already-sent",
    conversationId: "c-sent",
    subject: "Rechnung",
    bodyPreview: "Bitte prüfen Sie die Rechnung.",
    from: { emailAddress: { address: "kunde@example.com" } },
    receivedDateTime: at(200),
  },
  {
    id: "already-draft",
    conversationId: "c-draft",
    subject: "Angebot",
    bodyPreview: "Wie hoch ist der Preis?",
    from: { emailAddress: { address: "kunde@example.com" } },
    receivedDateTime: at(150),
  },
  {
    id: "ack-only",
    conversationId: "c-ack",
    subject: "Danke",
    bodyPreview: "Vielen Dank!",
    from: { emailAddress: { address: "kunde@example.com" } },
    receivedDateTime: at(120),
  },
  {
    id: "whatsapp-relay",
    internetMessageId: "<wa@example.com>",
    conversationId: "c-wa",
    subject: "WhatsApp von Anna | +49 123456789",
    bodyPreview: "Neue WhatsApp-Nachricht\nNachricht: Wo ist meine Bestellung?\nTracking-ID: WA-1234",
    from: { emailAddress: { address: "support@neontrip.de" } },
    receivedDateTime: at(60),
  },
  {
    id: "automated",
    conversationId: "c-auto",
    subject: "Delivery Status Notification",
    bodyPreview: "Problem with delivery",
    from: { emailAddress: { address: "mailer-daemon@example.com" } },
    receivedDateTime: at(30),
  },
];
const selected = runCode(selectOpenInboxCandidatesCode, {
  body: {
    responses: [
      { id: "inbox", status: 200, body: { value: inbox } },
      { id: "drafts", status: 200, body: { value: [{ id: "d1", conversationId: "c-draft", isDraft: true, lastModifiedDateTime: at(100) }] } },
      { id: "sent", status: 200, body: { value: [{ id: "s1", conversationId: "c-sent", sentDateTime: at(180) }] } },
    ],
  },
}).map((item) => item.json);
assert.deepEqual(selected.map((item) => item.messageId), ["actionable", "whatsapp-relay"]);
assert.ok(selected.every((item) => item.automaticSendAllowed === false));
assert.ok(selected.every((item) => item.humanApprovalRequired === true));

console.log("Resolve-first and open-inbox backfill workflow tests passed.");
