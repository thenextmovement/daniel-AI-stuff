import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = [
  new URL("./generated/dhl-dpd-arrival-dry-run.json", import.meta.url),
  new URL("./generated/dhl-arrival-email-dry-run.json", import.meta.url),
  new URL("./generated/arrival-label-review-mail-outbox.json", import.meta.url),
  new URL("./generated/arrival-label-outlook-archive-after-print.json", import.meta.url),
];
const workflows = await Promise.all(files.map(async (file) => JSON.parse(await readFile(file, "utf8"))));
for (const workflow of workflows.slice(0, 2)) {
  const triggers = workflow.nodes.filter((node) => node.type.endsWith("Trigger"));
  const requests = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.httpRequest");
  assert.equal(workflow.active, false, "workflow must remain inactive");
  assert.equal(workflow.settings.timezone, "Europe/Berlin");
  assert.equal(triggers.length, 1, "exactly one main trigger per workflow required");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].retryOnFail, true);
  assert.ok(requests[0].parameters.options.timeout <= 60000);
  const serialized = JSON.stringify(workflow);
  assert.match(serialized, /mode.*dry_run/);
  assert.match(serialized, /persist.*true/);
  assert.doesNotMatch(serialized, /EASYDPD|createLabel|ARRIVAL_LABEL_WRITES_ENABLED|print-jobs/);
  assert.doesNotMatch(serialized, /continueRegularOutput|continueErrorOutput/);
  assert.equal(workflow.nodes.length, 4, "keep orchestration small and delegate business rules to tested code");
  for (const codeNode of workflow.nodes.filter((node) => node.type === "n8n-nodes-base.code")) {
    assert.doesNotThrow(() => new Function(codeNode.parameters.jsCode), `${codeNode.name} JavaScript must parse`);
  }
}
const emailWorkflow = workflows[1];
assert.equal(emailWorkflow.nodes.filter((node) => node.type === "n8n-nodes-base.microsoftOutlookTrigger").length, 1);
assert.match(JSON.stringify(emailWorkflow), /DHL_EXPRESS_SENDER_DOMAINS/);
assert.match(JSON.stringify(emailWorkflow), /n8n_email/);

const reviewWorkflow = workflows[2];
const reviewSerialized = JSON.stringify(reviewWorkflow);
const reviewTriggers = reviewWorkflow.nodes.filter((node) => node.type.endsWith("Trigger"));
const reviewRequests = reviewWorkflow.nodes.filter((node) => node.type === "n8n-nodes-base.httpRequest");
const sendNodes = reviewWorkflow.nodes.filter((node) => node.type === "n8n-nodes-base.microsoftOutlook");
assert.equal(reviewWorkflow.active, false);
assert.equal(reviewWorkflow.settings.timezone, "Europe/Berlin");
assert.equal(reviewWorkflow.settings.errorWorkflow, "ArT3LN25Mb1PAuBE");
assert.equal(reviewTriggers.length, 1, "review workflow must have exactly one trigger");
assert.equal(reviewRequests.length, 3);
assert.equal(sendNodes.length, 1);
assert.equal(sendNodes[0].retryOnFail, undefined, "mail send must not retry after dispatch begins");
assert.equal(sendNodes[0].parameters.additionalFields.bodyContentType, "Text");
assert.match(reviewSerialized, /info@neontrip[.]de/);
assert.match(reviewSerialized, /Mark Review Dispatching/);
assert.match(reviewSerialized, /dispatchReceiptId/);
assert.match(reviewSerialized, /review-notifications/);
assert.doesNotMatch(reviewSerialized, /EASYDPD|createLabel|ARRIVAL_LABEL_WRITES_ENABLED|print-jobs/);
assert.doesNotMatch(reviewSerialized, /continueRegularOutput|continueErrorOutput/);
assert.ok(reviewWorkflow.nodes.length <= 10, "review orchestration must stay small");
for (const request of reviewRequests) {
  assert.equal(request.retryOnFail, true);
  assert.ok(request.parameters.options.timeout <= 30000);
}
for (const codeNode of reviewWorkflow.nodes.filter((node) => node.type === "n8n-nodes-base.code")) {
  assert.doesNotThrow(() => new Function(codeNode.parameters.jsCode), `${codeNode.name} JavaScript must parse`);
}

const archiveWorkflow = workflows[3];
const archiveSerialized = JSON.stringify(archiveWorkflow);
const archiveTriggers = archiveWorkflow.nodes.filter((node) => node.type.endsWith("Trigger"));
const archiveRequests = archiveWorkflow.nodes.filter((node) => node.type === "n8n-nodes-base.httpRequest");
assert.equal(archiveWorkflow.active, false);
assert.equal(archiveWorkflow.settings.timezone, "Europe/Berlin");
assert.equal(archiveWorkflow.settings.errorWorkflow, "ArT3LN25Mb1PAuBE");
assert.equal(archiveTriggers.length, 1);
assert.equal(archiveRequests.length, 1);
assert.equal(archiveRequests[0].retryOnFail, undefined, "move processor request must not retry automatically");
assert.ok(archiveRequests[0].parameters.options.timeout <= 60000);
assert.match(archiveSerialized, /outlook-archives\/process/);
assert.match(archiveSerialized, /X-Neontrip-Outlook-Archive-Worker/);
assert.match(archiveSerialized, /CF-Access-Client-Id/);
assert.match(archiveSerialized, /CF-Access-Client-Secret/);
assert.match(archiveSerialized, /https:\/\/ops[.]neontrip[.]de/);
assert.match(archiveSerialized, /full tracking number/);
assert.doesNotMatch(
  archiveRequests[0].parameters.body,
  /ARRIVAL_LABEL_CF_ACCESS_CLIENT|ARRIVAL_LABEL_AGENT_API_TOKEN/,
  "secrets must stay in request headers and never enter the request body",
);
assert.doesNotMatch(archiveSerialized, /EASYDPD|createLabel|ARRIVAL_LABEL_WRITES_ENABLED|print-jobs\/claim/);
assert.ok(archiveWorkflow.nodes.length <= 5, "archive orchestration must stay small");
for (const codeNode of archiveWorkflow.nodes.filter((node) => node.type === "n8n-nodes-base.code")) {
  assert.doesNotThrow(() => new Function(codeNode.parameters.jsCode), `${codeNode.name} JavaScript must parse`);
  assert.doesNotMatch(codeNode.parameters.jsCode, /\$env|ARRIVAL_LABEL_/, "Code runner must not receive production secrets");
}
process.stdout.write("arrival-labels n8n workflow checks passed\n");
