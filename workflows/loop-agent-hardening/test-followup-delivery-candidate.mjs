import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const workflow = JSON.parse(
  await readFile(
    resolve(here, "generated", "followup-deterministic-delivery-loop-v4.json"),
    "utf8",
  ),
);

function node(name) {
  const found = workflow.nodes.find((entry) => entry.name === name);
  assert.ok(found, "missing node " + name);
  return found;
}

function isTrigger(entry) {
  return entry.type.toLowerCase().endsWith("trigger") ||
    entry.type === "n8n-nodes-base.webhook";
}

assert.equal(workflow.nodes.length, 19);
assert.equal(workflow.nodes.filter(isTrigger).length, 1);
assert.equal(
  workflow.nodes.some((entry) => /langchain|agent/i.test(entry.type)),
  false,
);
assert.equal(
  workflow.nodes.some((entry) => entry.continueOnFail === true),
  false,
);

for (const entry of workflow.nodes) {
  if (entry.type !== "n8n-nodes-base.code") continue;
  assert.doesNotThrow(
    () => new vm.Script("(async () => {\n" + entry.parameters.jsCode + "\n})()"),
    "invalid JavaScript in " + entry.name,
  );
}

for (const [sourceName, connection] of Object.entries(workflow.connections)) {
  assert.ok(node(sourceName));
  for (const outputs of Object.values(connection)) {
    for (const branch of outputs) {
      for (const target of branch || []) assert.ok(node(target.node));
    }
  }
}

const serialized = JSON.stringify(workflow);
assert.match(serialized, /claim_followup_delivery_candidate/);
assert.match(serialized, /block_followup_delivery/);
assert.match(serialized, /complete_followup_delivery/);
assert.match(serialized, /mark_followup_delivery_unknown/);
assert.doesNotMatch(serialized, /Math\.random|\$getWorkflowStaticData/);

const send = node("SendFollowupOutlook");
assert.equal(send.retryOnFail, false);
assert.equal(send.onError, "continueErrorOutput");
assert.equal(workflow.connections.SendFollowupOutlook.main.length, 2);
assert.equal(
  workflow.connections.SendFollowupOutlook.main[0][0].node,
  "CompleteFollowupDelivery",
);
assert.equal(
  workflow.connections.SendFollowupOutlook.main[1][0].node,
  "MarkFollowupDeliveryUnknown",
);

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const prepare = new AsyncFunction(
  "$json",
  node("PrepareCandidate").parameters.jsCode,
);
const validPrepared = await prepare({
  followup_queue_id: "00000000-0000-4000-8000-000000000001",
  claim_token: "00000000-0000-4000-8000-000000000002",
  candidate: {
    id: "00000000-0000-4000-8000-000000000001",
    request_id: "REQ-1",
    document_id: "DOC-1",
    customer_name: "Ada Lovelace",
    customer_email: "ADA@CUSTOMER.INVALID",
    pandadoc_customer_link: "https://example.pandadoc.com/document/v2?token=test",
  },
});
assert.equal(validPrepared[0].json.preflight_route, "pandadoc");
assert.equal(validPrepared[0].json.customer_email, "ada@customer.invalid");
assert.equal(validPrepared[0].json.ai_copy_allowed, false);

const blockedPrepared = await prepare({
  followup_queue_id: "00000000-0000-4000-8000-000000000003",
  claim_token: "00000000-0000-4000-8000-000000000004",
  candidate: {
    id: "00000000-0000-4000-8000-000000000003",
    request_id: "REQ-2",
    document_id: "DOC-2",
    customer_name: "Internal",
    customer_email: "support@neontrip.de",
    pandadoc_customer_link: "https://example.pandadoc.com/document/v2?token=test",
  },
});
assert.equal(blockedPrepared[0].json.preflight_route, "blocked");

const modernContext = {
  ...validPrepared[0].json,
  candidate_offer_link: "https://angebote.neontrip.de/offer/public-token",
  preflight_route: "modern",
};
const validateModern = new AsyncFunction(
  "$json",
  "$",
  node("ValidateModernOffer").parameters.jsCode,
);
const modernLookup = (name) => {
  assert.equal(name, "PrepareCandidate");
  return { item: { json: modernContext } };
};
const modernGood = await validateModern(
  {
    results: [
      {
        matchType: "exact",
        status: "SENT",
        publicUrl: "https://angebote.neontrip.de/offer/public-token",
      },
    ],
  },
  modernLookup,
);
assert.equal(modernGood[0].json.preflight_ok, true);

const modernClosed = await validateModern(
  {
    results: [
      {
        matchType: "exact",
        status: "ACCEPTED",
        publicUrl: "https://angebote.neontrip.de/offer/public-token",
      },
    ],
  },
  modernLookup,
);
assert.equal(modernClosed[0].json.preflight_ok, false);
assert.equal(modernClosed[0].json.block_reason, "modern_offer_closed");

const modernAmbiguous = await validateModern(
  {
    results: [
      {
        matchType: "exact",
        status: "SENT",
        publicUrl: "https://angebote.neontrip.de/offer/one",
      },
      {
        matchType: "exact",
        status: "VIEWED",
        publicUrl: "https://angebote.neontrip.de/offer/two",
      },
    ],
  },
  modernLookup,
);
assert.equal(modernAmbiguous[0].json.preflight_ok, false);
assert.equal(modernAmbiguous[0].json.block_reason, "modern_offer_ambiguous");

const validatePanda = new AsyncFunction(
  "$json",
  "$",
  node("ValidatePandaDocStatus").parameters.jsCode,
);
const pandaLookup = (name) => {
  assert.equal(name, "PrepareCandidate");
  return { item: { json: validPrepared[0].json } };
};
const pandaGood = await validatePanda(
  { id: "DOC-1", status: "document.viewed" },
  pandaLookup,
);
assert.equal(pandaGood[0].json.preflight_ok, true);
const pandaClosed = await validatePanda(
  { id: "DOC-1", status: "document.completed" },
  pandaLookup,
);
assert.equal(pandaClosed[0].json.preflight_ok, false);
assert.equal(pandaClosed[0].json.block_reason, "pandadoc_document_closed");

const analyze = new AsyncFunction(
  "$input",
  "$",
  node("AnalyzeReplyEvidence").parameters.jsCode,
);
function analyzeLookup(replyItems) {
  return (name) => {
    if (name === "PrepareCandidate") return { item: { json: validPrepared[0].json } };
    if (name === "LookupCustomerReplies") return { all: () => replyItems };
    if (name === "ValidateModernOffer") throw new Error("not executed");
    if (name === "ValidatePandaDocStatus") {
      return { item: { json: pandaGood[0].json } };
    }
    throw new Error("unexpected node " + name);
  };
}
const noReply = await analyze(
  { first: () => ({ json: {} }) },
  analyzeLookup([{ json: {} }]),
);
assert.equal(noReply[0].json.reply_preflight_safe, true);
assert.equal(noReply[0].json.offer_link, validPrepared[0].json.candidate_offer_link);

const hasReply = await analyze(
  { first: () => ({ json: {} }) },
  analyzeLookup([
    {
      json: {
        from: { emailAddress: { address: "ada@customer.invalid" } },
        subject: "Re: Angebot",
        bodyPreview: "Bitte später melden",
      },
    },
  ]),
);
assert.equal(hasReply[0].json.reply_preflight_safe, false);
assert.equal(hasReply[0].json.block_reason, "customer_reply_detected");

const lookupError = await analyze(
  { first: () => ({ json: { error: "synthetic" } }) },
  analyzeLookup([{ json: { error: "synthetic" } }]),
);
assert.equal(lookupError[0].json.reply_preflight_safe, false);
assert.equal(lookupError[0].json.block_reason, "outlook_reply_lookup_failed");

const build = new AsyncFunction(
  "$json",
  node("BuildDeterministicFollowup").parameters.jsCode,
);
const email = await build({
  ...validPrepared[0].json,
  customer_name: "<img src=x onerror=alert(1)>",
  customer_email: "ada@customer.invalid",
  followup_number: 2,
  offer_link: "https://example.pandadoc.com/document/v2?token=test",
});
assert.equal(email[0].json.copy_mode, "deterministic");
assert.equal(email[0].json.ai_copy_allowed, false);
assert.match(email[0].json.email_body, /example\.pandadoc\.com/);
assert.doesNotMatch(email[0].json.email_body, /<img|onerror=/i);
assert.doesNotMatch(
  email[0].json.email_body,
  /rabatt|garantiert|liefertermin|preisnachlass/i,
);

await assert.rejects(
  () =>
    build({
      ...validPrepared[0].json,
      offer_link: "https://unsafe.invalid/phish",
    }),
  /deterministic_followup_link_invalid/,
);

console.log("Deterministic follow-up delivery candidate tests passed");
