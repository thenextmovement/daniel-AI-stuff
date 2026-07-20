import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  openInboxBackfillWorkflow,
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
assert.equal(main.name, "AI Email Agent v4 — Resolve First — Draft Only");
assert.equal(main.nodes.filter((entry) => JSON.stringify(entry).includes("createReply")).length, 1);
assert.doesNotMatch(JSON.stringify(main), /sendMail|replyAll|\/send\b/i);

const promptCode = node(main, "Build Draft Prompt").parameters.jsCode;
assert.match(promptCode, /email-resolve-first-v1/);
assert.match(promptCode, /Resolve first: before drafting, exhaust/);
assert.match(promptCode, /vague_internal_deferral_allowed: false/);
assert.match(promptCode, /customerReferenceMissing/);
assert.doesNotMatch(promptCode, /If facts are missing, say that the matter will be checked internally/);

const renderCode = node(main, "Validate and Render").parameters.jsCode;
assert.match(renderCode, /unhelpful_internal_deferral/);
assert.match(renderCode, /const forceFallback = validationReasons\.length > 0 \|\| meta\.possiblePromptInjection/);
assert.doesNotMatch(renderCode, /const highRiskBlocksDraft/);
assert.doesNotMatch(renderCode, /prüfen wir die Angaben noch einmal intern und melden uns anschließend/);
assert.doesNotMatch(renderCode, /review the details internally and get back to you afterwards/);
assert.match(node(main, "Log Success").parameters.jsonBody, /email-context-v4/);
assert.match(node(main, "Log Success").parameters.jsonBody, /resolve_first_policy/);

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
}, { "Build Draft Prompt": baseMeta })[0].json;
assert.equal(directHighRisk.safeFallbackUsed, false);
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
}, { "Build Draft Prompt": { ...baseMeta, customerReferenceMissing: true } })[0].json;
assert.equal(blockedDeferral.safeFallbackUsed, true);
assert.ok(blockedDeferral.validationReasons.includes("unhelpful_internal_deferral"));
assert.match(blockedDeferral.draftReplyText, /Bestellnummer oder Angebotsnummer/);
assert.doesNotMatch(blockedDeferral.draftReplyText, /intern|melden uns/i);

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
