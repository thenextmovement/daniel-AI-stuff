import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const generatedDirectory = resolve(here, "generated");

async function load(file) {
  return JSON.parse(await readFile(resolve(generatedDirectory, file), "utf8"));
}

function nodeByName(workflow, name) {
  const node = workflow.nodes.find((entry) => entry.name === name);
  assert.ok(node, `missing node ${name}`);
  return node;
}

function compileCodeNodes(workflow) {
  for (const node of workflow.nodes) {
    if (node.type !== "n8n-nodes-base.code") continue;
    assert.doesNotThrow(
      () => new vm.Script(`(async () => {\n${node.parameters.jsCode}\n})()`),
      `invalid JavaScript in ${workflow.id}/${node.name}`,
    );
  }
}

const design = await load(
  "btJd34v7PJFVej6G.design-reminder-draft-loop-v2.json",
);
const winback = await load("cqbB8GIwhP2guGIb.winback-draft-loop-v2.json");

for (const workflow of [design, winback]) {
  compileCodeNodes(workflow);
  assert.ok(workflow.nodes.length <= 30, `${workflow.id} exceeds 30 nodes`);
  assert.equal(
    workflow.nodes.filter((node) => node.type.toLowerCase().includes("trigger"))
      .length,
    1,
    `${workflow.id} must have one trigger`,
  );
  assert.equal(
    workflow.nodes.some((node) => node.type.includes("nodes-langchain.agent")),
    false,
    `${workflow.id} must not use an autonomous agent`,
  );
  assert.equal(
    workflow.nodes.some((node) => node.continueOnFail === true),
    false,
    `${workflow.id} must not use continueOnFail`,
  );
  const serialized = JSON.stringify(workflow);
  assert.doesNotMatch(serialized, /\$getWorkflowStaticData/);
  assert.match(serialized, /claim_customer_communication_draft/);
  assert.match(serialized, /complete_customer_communication_draft/);
  assert.match(serialized, /mark_customer_communication_draft_unknown/);

  const draft = nodeByName(workflow, "CreateOutlookDraft");
  assert.equal(draft.parameters.additionalFields.saveAsDraft, true);
  assert.notEqual(draft.retryOnFail, true);
  assert.equal(draft.onError, "continueErrorOutput");
  assert.equal(workflow.connections.CreateOutlookDraft.main.length, 2);

  const safeStop = workflow.nodes.find((node) =>
    /^Stop.*DraftSafely$/.test(node.name),
  );
  assert.ok(safeStop, `${workflow.id} must have a safe stop node`);
  assert.match(safeStop.parameters.jsCode, /status: 'stopped_safely'/);
  assert.doesNotMatch(
    safeStop.parameters.jsCode,
    /throw new Error\('Customer draft loop stopped safely/,
    `${workflow.id} expected claim stops must not trigger error alerts`,
  );
}

assert.equal(design.nodes.length, 12);
assert.doesNotMatch(JSON.stringify(design), /"operation":"move"/);
assert.equal(
  nodeByName(design, "Schedule Trigger").parameters.rule.interval[0]
    .minutesInterval,
  5,
);
assert.match(
  nodeByName(design, "Mind. 10 Min alt?").parameters.jsCode,
  /maximumAgeMs = 48 \* 60 \* 60 \* 1000/,
  "design reminder must not backfill messages older than 48 hours",
);
assert.equal(
  design.connections.CreateOutlookDraft.main[0][0].node,
  "CompleteDesignDraft",
);
assert.equal(
  design.connections.CreateOutlookDraft.main[1][0].node,
  "MarkDesignDraftUnknown",
);

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const safeStopCode = nodeByName(
  design,
  "StopDesignDraftSafely",
).parameters.jsCode;
const runSafeStop = new AsyncFunction("$input", safeStopCode);
const safeStop = await runSafeStop({
  first: () => ({ json: { reason: "manual_review_required" } }),
});
assert.deepEqual(safeStop, [
  {
    json: {
      status: "stopped_safely",
      reason: "manual_review_required",
      automaticRetryAllowed: false,
      automaticSendAllowed: false,
      humanApprovalRequired: true,
      shouldReport: false,
    },
  },
]);

const designCode = nodeByName(design, "BuildValidatedDraft").parameters.jsCode;
const runDesign = new AsyncFunction("$input", designCode);
const reminderInput = {
  id: "message-1",
  body: {
    content:
      "<strong>Name</strong>: Ada Lovelace<br><strong>E-Mail</strong>: ada@customer.invalid<br><strong>Nachricht</strong>: Anbei unser Logo",
  },
  bodyPreview: "",
};
const reminder = await runDesign({ first: () => ({ json: reminderInput }) });
assert.equal(reminder.length, 1);
assert.equal(reminder[0].json.communicationKind, "design_reminder");
assert.equal(reminder[0].json.automaticSendAllowed, false);
assert.equal(reminder[0].json.humanApprovalRequired, true);

const describedDesign = await runDesign({
  first: () => ({
    json: {
      ...reminderInput,
      id: "message-2",
      body: {
        content:
          "<strong>Name</strong>: Ada Lovelace<br><strong>E-Mail</strong>: ada@customer.invalid<br><strong>Nachricht</strong>: Bitte gestaltet den Schriftzug Follow your dreams in Schreibschrift",
      },
    },
  }),
});
assert.deepEqual(describedDesign, []);

await assert.rejects(
  () =>
    runDesign({
      first: () => ({
        json: {
          ...reminderInput,
          id: "message-3",
          body: {
            content:
              "<strong>Name</strong>: Internal<br><strong>E-Mail</strong>: support@neontrip.de<br><strong>Nachricht</strong>: Anbei unser Logo",
          },
        },
      }),
    }),
  /invalid or internal/,
);

assert.equal(winback.nodes.length, 19);
assert.doesNotMatch(JSON.stringify(winback), /Setze WINBACK Tag/);
assert.equal(
  winback.connections.CreateOutlookDraft.main[0][0].node,
  "CompleteWinbackDraft",
);
assert.equal(
  winback.connections.CreateOutlookDraft.main[1][0].node,
  "MarkWinbackDraftUnknown",
);

const renderCode = nodeByName(winback, "ValidateAndRenderDraft").parameters
  .jsCode;
const context = {
  communicationKind: "winback",
  policyVersion: "winback-human-review-draft-v2",
  sourceId: "deal-1",
  recipient: "ada@customer.invalid",
  contact: { firstName: "Ada" },
};
const n8nLookup = (name) => {
  assert.equal(name, "Bereite KI-Kontext vor");
  return { item: { json: context } };
};
const runRender = new AsyncFunction("$input", "$", renderCode);
const rendered = await runRender(
  {
    first: () => ({
      json: {
        output: JSON.stringify({
          greeting: "Hallo Ada,",
          paragraphs: [
            "vor einiger Zeit hatten Sie sich für ein individuelles LED-Neonschild interessiert.",
            "Besteht noch Interesse, oder haben sich Ihre Wünsche geändert? Gern erstellen wir ein neues unverbindliches Angebot.",
          ],
          closing: "Viele Grüße",
        }),
      },
    }),
  },
  n8nLookup,
);
assert.equal(rendered[0].json.automaticSendAllowed, false);
assert.equal(rendered[0].json.humanApprovalRequired, true);
assert.match(rendered[0].json.bodyContent, /Hallo Ada,/);

await assert.rejects(
  () =>
    runRender(
      {
        first: () => ({
          json: {
            output: JSON.stringify({
              greeting: "Hallo Ada,",
              paragraphs: [
                "Sie erhalten garantiert 20% Rabatt.",
                "Mehr unter https://unsafe.example.",
              ],
              closing: "Viele Grüße",
            }),
          },
        }),
      },
      n8nLookup,
    ),
  /content allowlist/,
);

console.log("agent-to-draft candidate tests passed (2 workflows)");
