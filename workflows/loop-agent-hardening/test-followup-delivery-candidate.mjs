import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const workflow = JSON.parse(
  await readFile(
    resolve(here, "generated", "followup-reply-aware-delivery-loop-v5.json"),
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

assert.equal(workflow.nodes.length, 21);
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
assert.match(serialized, /followup_reply_classifier_v1_20260824/);
assert.match(serialized, /followup-reply/);
assert.match(serialized, /gpt-5\.5-2026-04-23/);
assert.match(serialized, /weiss_logo_NEONTRIP/);
assert.doesNotMatch(serialized, /Math\.random|\$getWorkflowStaticData/);

const schedule = node("Every 30 Min Weekdays 09-16");
assert.equal(
  schedule.parameters.rule.interval[0].expression,
  "0 */30 9-15 * * 1-5",
);
assert.equal(
  workflow.connections.ReplyPreflightSafe.main[1][0].node,
  "ReplyNeedsClassification",
);
assert.equal(
  workflow.connections.ClassifyCustomerReply.main[1][0].node,
  "BlockFollowupDelivery",
);

const offerLookup = node("SearchModernOffer");
assert.match(offerLookup.parameters.url, /api\/internal\/offers\/\{\{/);
assert.doesNotMatch(offerLookup.parameters.url, /\/search/);
assert.equal(offerLookup.parameters.sendQuery, undefined);

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
    document_id: "offer-1",
    customer_name: "Ada Lovelace",
    customer_email: "ADA@CUSTOMER.INVALID",
    offer_public_url: "https://angebote.neontrip.de/offer/public-token",
  },
});
assert.equal(validPrepared[0].json.preflight_route, "modern");
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
    offer_public_url: "https://angebote.neontrip.de/offer/public-token",
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
    offer: {
      status: "SENT",
      offerId: "offer-1",
      offerNumber: "A/N 14100",
      documentReference: "AN-14100",
      publicUrl: "https://angebote.neontrip.de/offer/public-token",
    },
  },
  modernLookup,
);
assert.equal(modernGood[0].json.preflight_ok, true);
assert.equal(modernGood[0].json.offer_id, "offer-1");

const modernWrongIdentity = await validateModern(
  {
    offer: {
      status: "SENT",
      offerId: "offer-2",
      offerNumber: "A/N 14101",
      documentReference: "AN-14101",
      publicUrl: "https://angebote.neontrip.de/offer/other-token",
    },
  },
  modernLookup,
);
assert.equal(modernWrongIdentity[0].json.preflight_ok, false);
assert.equal(
  modernWrongIdentity[0].json.block_reason,
  "modern_offer_identity_mismatch",
);

const modernClosed = await validateModern(
  {
    offer: {
      status: "ACCEPTED",
      offerId: "offer-1",
      publicUrl: "https://angebote.neontrip.de/offer/public-token",
    },
  },
  modernLookup,
);
assert.equal(modernClosed[0].json.preflight_ok, false);
assert.equal(modernClosed[0].json.block_reason, "modern_offer_closed");

const modernMissing = await validateModern(
  {
    ok: true,
  },
  modernLookup,
);
assert.equal(modernMissing[0].json.preflight_ok, false);
assert.equal(modernMissing[0].json.block_reason, "modern_offer_identity_mismatch");

const analyze = new AsyncFunction(
  "$input",
  "$",
  node("AnalyzeReplyEvidence").parameters.jsCode,
);
function analyzeLookup(replyItems, prepared = validPrepared[0].json) {
  return (name) => {
    if (name === "PrepareCandidate") return { item: { json: prepared } };
    if (name === "LookupCustomerReplies") return { all: () => replyItems };
    if (name === "ValidateModernOffer") return { item: { json: modernGood[0].json } };
    throw new Error("unexpected node " + name);
  };
}
const noReply = await analyze(
  { first: () => ({ json: {} }) },
  analyzeLookup([{ json: {} }]),
);
assert.equal(noReply[0].json.reply_preflight_safe, true);
assert.equal(noReply[0].json.offer_link, modernGood[0].json.offer_link);

const hasReply = await analyze(
  { first: () => ({ json: {} }) },
  analyzeLookup([
    {
      json: {
        id: "reply-1",
        from: { emailAddress: { address: "ada@customer.invalid" } },
        subject: "Re: NEONTRIP Angebot A/N 14100",
        bodyPreview: "Der Kunde braucht noch Zeit.",
        receivedDateTime: "2026-08-24T10:00:00.000Z",
      },
    },
  ]),
);
assert.equal(hasReply[0].json.reply_preflight_safe, false);
assert.equal(hasReply[0].json.reply_route, "classify");
assert.equal(hasReply[0].json.reply_message_id, "reply-1");
assert.equal(hasReply[0].json.block_reason, null);

const alreadyHandledSnoozeReply = await analyze(
  { first: () => ({ json: {} }) },
  analyzeLookup(
    [
      {
        json: {
          id: "reply-1",
          from: { emailAddress: { address: "ada@customer.invalid" } },
          subject: "Re: NEONTRIP Angebot A/N 14100",
          bodyPreview: "Der Kunde braucht noch Zeit.",
          receivedDateTime: "2026-08-24T10:00:00.000Z",
        },
      },
    ],
    {
      ...validPrepared[0].json,
      email_context_snapshot: { reply_message_id: "reply-1" },
    },
  ),
);
assert.equal(alreadyHandledSnoozeReply[0].json.reply_route, "send");
assert.equal(alreadyHandledSnoozeReply[0].json.reply_count, 0);

const uncorrelatedReply = await analyze(
  { first: () => ({ json: {} }) },
  analyzeLookup([
    {
      json: {
        id: "reply-2",
        from: { emailAddress: { address: "ada@customer.invalid" } },
        subject: "Anderes Thema",
        bodyPreview: "Bitte später melden",
        receivedDateTime: "2026-08-24T09:00:00.000Z",
      },
    },
  ]),
);
assert.equal(uncorrelatedReply[0].json.reply_route, "block");
assert.equal(
  uncorrelatedReply[0].json.block_reason,
  "uncorrelated_customer_reply",
);

const lookupError = await analyze(
  { first: () => ({ json: { error: "synthetic" } }) },
  analyzeLookup([{ json: { error: "synthetic" } }]),
);
assert.equal(lookupError[0].json.reply_preflight_safe, false);
assert.equal(lookupError[0].json.reply_route, "block");
assert.equal(lookupError[0].json.block_reason, "outlook_reply_lookup_failed");

const buildClassifier = new AsyncFunction(
  "$json",
  node("BuildReplyClassifierRequest").parameters.jsCode,
);
const validateClassifier = new AsyncFunction(
  "$json",
  "$",
  "$execution",
  node("ValidateReplyDecision").parameters.jsCode,
);
function completedClassifierResponse(payload) {
  return {
    status: "completed",
    incomplete_details: null,
    output: [
      {
        type: "message",
        status: "completed",
        content: [{ type: "output_text", text: JSON.stringify(payload) }],
      },
    ],
  };
}
async function classifyFixture(excerpt, payload) {
  const request = await buildClassifier({
    ...hasReply[0].json,
    reply_excerpt: excerpt,
    reply_message_id: "reply-classifier",
  });
  assert.equal(request[0].json.classifierRequestBody.tools.length, 0);
  assert.equal(
    request[0].json.classifierRequestBody.model,
    "gpt-5.5-2026-04-23",
  );
  const lookup = (name) => {
    assert.equal(name, "BuildReplyClassifierRequest");
    return { item: { json: request[0].json } };
  };
  return validateClassifier(
    completedClassifierResponse(payload),
    lookup,
    { id: "execution-test" },
  );
}

const snoozeDecision = await classifyFixture("Der Kunde braucht noch Zeit.", {
  confidence: 0.94,
  decision: "SNOOZE_7_DAYS",
  evidence_quote: "Der Kunde braucht noch Zeit.",
  reason_code: "needs_time",
});
assert.equal(
  snoozeDecision[0].json.reply_decision_payload.decision,
  "SNOOZE_7_DAYS",
);

const declineDecision = await classifyFixture("Der Kunde hat abgesagt.", {
  confidence: 0.99,
  decision: "DECLINED",
  evidence_quote: "Der Kunde hat abgesagt.",
  reason_code: "explicit_decline",
});
assert.equal(
  declineDecision[0].json.reply_decision_payload.decision,
  "DECLINED",
);

const negatedDecline = await classifyFixture(
  "Der Kunde hat noch nicht abgesagt.",
  {
    confidence: 0.99,
    decision: "DECLINED",
    evidence_quote: "Der Kunde hat noch nicht abgesagt.",
    reason_code: "explicit_decline",
  },
);
assert.equal(
  negatedDecline[0].json.reply_decision_payload.decision,
  "MANUAL_REVIEW",
);

const malformedDecision = await classifyFixture("Ich habe eine Rückfrage.", {
  decision: "DECLINED",
});
assert.equal(
  malformedDecision[0].json.reply_decision_payload.decision,
  "MANUAL_REVIEW",
);

const build = new AsyncFunction(
  "$json",
  node("BuildDeterministicFollowup").parameters.jsCode,
);
const email = await build({
  ...validPrepared[0].json,
  customer_name: "<script>alert(1)</script>",
  customer_email: "ada@customer.invalid",
  followup_number: 6,
  offer_number: "A/N 14100",
  offer_link: "https://angebote.neontrip.de/offer/public-token",
});
assert.equal(email[0].json.copy_mode, "deterministic");
assert.equal(email[0].json.ai_copy_allowed, false);
assert.match(email[0].json.email_body, /angebote\.neontrip\.de/);
assert.match(email[0].json.email_body, /fabienne123\.jpg/);
assert.match(email[0].json.email_body, /weiss_logo_NEONTRIP/);
assert.match(email[0].json.email_subject, /A\/N 14100/);
assert.doesNotMatch(email[0].json.email_body, /<script|onerror=/i);
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
