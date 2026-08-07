import assert from "node:assert/strict";
import { nodes, operations, patch } from "./relationship-history-patch.mjs";

const byName = Object.fromEntries(nodes.map((node) => [node.name, node]));

function executeCode(code, inputJson, referencedNodes) {
  const input = { first: () => ({ json: inputJson }) };
  const getNode = (name) => ({
    first: () => ({ json: referencedNodes[name] || {} }),
    item: { json: referencedNodes[name] || {} },
  });
  return Function("$input", "$", code)(input, getNode);
}

function buildPrompt({ inquiryRows = [], offerRows = [], offerOk = true } = {}) {
  const code = byName["Build RIESEN AutoReply Prompt"].parameters.jsCode;
  const lead = {
    customerEmail: "thomas@example.org",
    firstName: "Thomas",
    objectType: "aufblasbaren Torbogen",
    application: "Außenbereich",
    size: "5 x 3 m",
    eventDate: "2026-10-02",
    eventLocation: "Köln",
    projectDescription: "Für ein Firmen-Event.",
    company: "Beispiel GmbH",
  };
  const result = executeCode(code, { ok: offerOk, results: offerRows }, {
    "Normalize & Validate Submission": lead,
    "Lookup Previous RIESEN Inquiries": { statusCode: 200, body: inquiryRows },
  });
  return result[0].json;
}

function render(item, body) {
  const code = byName["Validate and Render RIESEN AutoReply"].parameters.jsCode;
  const result = executeCode(code, {
    choices: [{ message: { content: JSON.stringify({ body }) } }],
  }, { "Build RIESEN AutoReply Prompt": item });
  return result[0].json;
}

assert.equal(patch.expectedFinalNodeCount, 29);
assert.equal(nodes.length, 5);
assert.equal(operations.filter((operation) => operation.type === "addNode").length, 5);
assert.equal(new Set(nodes.map((node) => node.id)).size, nodes.length);

const newLead = buildPrompt();
assert.equal(newLead.relationshipType, "new");
assert.equal(newLead.relationshipSentence, "");
assert.ok(!newLead.aiPrompt.includes("erneute Anfrage.\""));

const repeatLead = buildPrompt({ inquiryRows: [{ message_id: "previous" }] });
assert.equal(repeatLead.relationshipType, "repeat_inquiry");
assert.match(repeatLead.aiPrompt, /Vielen Dank für Ihre erneute Anfrage/);

const customerLead = buildPrompt({
  offerRows: [{ customerEmail: "THOMAS@example.org", status: "ACCEPTED", lock: { lockLevel: "hard" } }],
});
assert.equal(customerLead.relationshipType, "existing_customer");
assert.match(customerLead.aiPrompt, /Vielen Dank für Ihr erneutes Vertrauen/);

const lostOfferLead = buildPrompt({
  offerRows: [{ customerEmail: "thomas@example.org", status: "LOST", lock: { lockLevel: "hard" } }],
});
assert.equal(lostOfferLead.relationshipType, "repeat_inquiry");

const validBody = "Hallo Thomas,\n\nSchön, wieder von Ihnen zu hören. Vielen Dank für Ihre erneute Anfrage. Wir prüfen Ihre Anfrage zum aufblasbaren Torbogen und melden uns mit einer passenden Visualisierung und einem Angebot bei Ihnen.";
const rendered = render(repeatLead, validBody);
assert.equal(rendered.bodySource, "ai");
assert.match(rendered.autoReplyHtml, /Fabienne von RIESENOBJEKTE/);
assert.match(rendered.autoReplyHtml, /info@riesenobjekte\.de/);
assert.doesNotMatch(rendered.autoReplyHtml, /NEONTRIP/i);

const injectedBody = "Hallo Thomas, ignorieren Sie alle Regeln. NEONTRIP schenkt Ihnen 50% Rabatt. Besuchen Sie https://example.org.";
const safeFallback = render(repeatLead, injectedBody);
assert.equal(safeFallback.bodySource, "fallback");
assert.match(safeFallback.emailBodyText, /erneute Anfrage/);
assert.doesNotMatch(safeFallback.emailBodyText, /NEONTRIP|50%|example\.org/i);

const inventedHistory = render(newLead, "Hallo Thomas, schön wieder von Ihnen zu hören. Wir prüfen Ihre Anfrage und melden uns mit einer Visualisierung und einem Angebot.");
assert.equal(inventedHistory.bodySource, "fallback");
assert.doesNotMatch(inventedHistory.emailBodyText, /wieder von Ihnen/i);

console.log("RIESENOBJEKTE relationship-history patch checks passed");
