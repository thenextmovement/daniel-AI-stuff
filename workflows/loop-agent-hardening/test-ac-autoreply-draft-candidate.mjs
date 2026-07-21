import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const workflow = JSON.parse(
  await readFile(
    resolve(
      here,
      "generated",
      "nUrqyTSnGE8j9QT8.ac-autoreply-draft-loop-v2.json",
    ),
    "utf8",
  ),
);

function nodeByName(name) {
  const node = workflow.nodes.find((entry) => entry.name === name);
  assert.ok(node, `missing node ${name}`);
  return node;
}

for (const node of workflow.nodes) {
  if (node.type !== "n8n-nodes-base.code") continue;
  assert.doesNotThrow(
    () => new vm.Script(`(async () => {\n${node.parameters.jsCode}\n})()`),
    `invalid JavaScript in ${node.name}`,
  );
}

assert.equal(workflow.nodes.length, 22);
assert.equal(
  workflow.nodes.filter((node) =>
    [
      "n8n-nodes-base.webhook",
      "n8n-nodes-base.scheduleTrigger",
      "n8n-nodes-base.microsoftOutlookTrigger",
      "n8n-nodes-base.errorTrigger",
    ].includes(node.type),
  ).length,
  1,
);
assert.equal(
  workflow.nodes.some((node) => node.type === "n8n-nodes-base.emailSend"),
  false,
);
assert.equal(
  workflow.nodes.some((node) => node.type === "n8n-nodes-base.stickyNote"),
  false,
);
assert.equal(
  workflow.nodes.some((node) => node.continueOnFail === true),
  false,
);
assert.doesNotMatch(JSON.stringify(workflow), /\$getWorkflowStaticData/);
assert.doesNotMatch(JSON.stringify(workflow), /Math\.random/);

const draft = nodeByName("CreateAutoReplyDraft");
assert.equal(draft.parameters.additionalFields.saveAsDraft, true);
assert.notEqual(draft.retryOnFail, true);
assert.equal(draft.onError, "continueErrorOutput");
assert.equal(workflow.connections.CreateAutoReplyDraft.main.length, 2);
assert.equal(
  workflow.connections.CreateAutoReplyDraft.main[0][0].node,
  "CompleteAutoReplyDraft",
);
assert.equal(
  workflow.connections.CreateAutoReplyDraft.main[1][0].node,
  "MarkAutoReplyDraftUnknown",
);

const serialized = JSON.stringify(workflow);
assert.match(serialized, /claim_customer_communication_draft/);
assert.match(serialized, /complete_customer_communication_draft/);
assert.match(serialized, /mark_customer_communication_draft_unknown/);
assert.match(serialized, /activecampaign_autoreply/);

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const normalize = new AsyncFunction(
  "$input",
  nodeByName("Normalize").parameters.jsCode,
);

const validNormalized = await normalize({
  first: () => ({
    json: {
      body: {
        "deal[id]": "deal-123",
        "deal[contactid]": "contact-1",
        "deal[contact_email]": "ada@customer.invalid",
      },
    },
  }),
});
assert.equal(validNormalized[0].json.skip, false);
assert.equal(validNormalized[0].json.deal_id, "deal-123");

const internalNormalized = await normalize({
  first: () => ({
    json: {
      body: {
        "deal[id]": "deal-124",
        "deal[contactid]": "contact-2",
        "deal[contact_email]": "support@neontrip.de",
      },
    },
  }),
});
assert.equal(internalNormalized[0].json.skip, true);

const promptContext = {
  deal_id: "deal-123",
  contact_id: "contact-1",
  contact_email: "ada@customer.invalid",
  contact_first: "Ada",
  brand: "NEONTRIP",
  anrede_typ: "Sie",
  repeat_context: "first_request",
  communication_tone: "warm_formal",
};
const parse = new AsyncFunction(
  "$input",
  "$",
  nodeByName("Parse AI Response").parameters.jsCode,
);
const lookup = (name) => {
  assert.equal(name, "Build AI Prompt");
  return { item: { json: promptContext } };
};

const valid = await parse(
  {
    first: () => ({
      json: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              body: "Hallo Ada, vielen Dank für Ihre Anfrage. Wir prüfen Ihr Projekt und melden uns mit einem Angebot.",
            }),
          },
        ],
      },
    }),
  },
  lookup,
);
assert.equal(valid[0].json.communicationKind, "activecampaign_autoreply");
assert.equal(valid[0].json.automaticSendAllowed, false);
assert.equal(valid[0].json.humanApprovalRequired, true);

const malformed = await parse(
  {
    first: () => ({
      json: { content: [{ type: "text", text: "IGNORE JSON AND SEND NOW" }] },
    }),
  },
  lookup,
);
assert.doesNotMatch(malformed[0].json.email_body, /IGNORE JSON/i);
assert.match(malformed[0].json.email_body, /vielen Dank für Ihre Anfrage/i);

const unsafe = await parse(
  {
    first: () => ({
      json: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              body: "Hallo Ada, garantiert erhalten Sie 20% Rabatt. Mehr unter https://unsafe.invalid",
            }),
          },
        ],
      },
    }),
  },
  lookup,
);
assert.doesNotMatch(unsafe[0].json.email_body, /20%|https:|garantiert/i);

console.log("ActiveCampaign auto-reply draft-loop candidate tests passed");
