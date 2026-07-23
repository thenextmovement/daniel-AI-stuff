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
assert.equal(reviewWorkflow.settings.saveDataErrorExecution, "none");
assert.equal(reviewWorkflow.settings.saveDataSuccessExecution, "none");
assert.equal(reviewTriggers.length, 1, "review workflow must have exactly one trigger");
assert.equal(reviewRequests.length, 3);
assert.equal(sendNodes.length, 1);
assert.equal(sendNodes[0].retryOnFail, undefined, "mail send must not retry after dispatch begins");
assert.equal(sendNodes[0].parameters.additionalFields.bodyContentType, "Text");
assert.match(reviewSerialized, /info@neontrip[.]de/);
assert.match(reviewSerialized, /Mark Review Dispatching/);
assert.match(reviewSerialized, /dispatchReceiptId/);
assert.match(reviewSerialized, /review-notifications/);
assert.match(reviewWorkflow.name, /v0[.]2/);
assert.doesNotMatch(reviewSerialized, /EASYDPD|createLabel|ARRIVAL_LABEL_WRITES_ENABLED|print-jobs/);
assert.doesNotMatch(reviewSerialized, /continueRegularOutput|continueErrorOutput/);
assert.ok(reviewWorkflow.nodes.length <= 10, "review orchestration must stay small");
for (const request of reviewRequests) {
  assert.equal(request.retryOnFail, true);
  assert.ok(request.parameters.options.timeout <= 30000);
  assert.equal(request.parameters.authentication, "genericCredentialType");
  assert.equal(request.parameters.genericAuthType, "httpCustomAuth");
  assert.equal(request.credentials.httpCustomAuth.id, "HJHHkJXK8B7QCtCQ");
  assert.equal(request.credentials.httpCustomAuth.name, "NEONTRIP Ops Archive Worker");
}
assert.doesNotMatch(
  reviewSerialized,
  /\$env|ARRIVAL_LABEL_CF_ACCESS_CLIENT|ARRIVAL_LABEL_AGENT_API_TOKEN|CF-Access-Client-Secret/,
  "review workflow must use the encrypted custom-auth credential instead of environment secrets",
);
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
assert.equal(archiveWorkflow.settings.saveDataErrorExecution, "none");
assert.equal(archiveWorkflow.settings.saveDataSuccessExecution, "none");
assert.equal(archiveTriggers.length, 1);
assert.equal(archiveRequests.length, 3);
assert.equal(archiveWorkflow.settings.executionTimeout, 180);
assert.match(archiveWorkflow.name, /v0[.]7/);
const readinessRequest = archiveRequests.find((node) => node.name === "Check Ops Readiness");
const processorRequest = archiveRequests.find((node) => node.name === "Process One Exact DHL Archive");
const trelloProcessorRequest = archiveRequests.find((node) => node.name === "Process One Sign Arrived Projection");
assert.ok(readinessRequest, "readiness request is required");
assert.ok(processorRequest, "archive processor request is required");
assert.ok(trelloProcessorRequest, "Trello arrival processor request is required");
assert.equal(readinessRequest.parameters.method, "GET");
assert.match(readinessRequest.parameters.url, /api\/health/);
assert.equal(readinessRequest.retryOnFail, true, "only the read-only readiness check may retry");
assert.equal(readinessRequest.maxTries, 4);
assert.equal(readinessRequest.waitBetweenTries, 10000);
assert.ok(readinessRequest.parameters.options.timeout <= 10000);
assert.equal(processorRequest.retryOnFail, undefined, "move processor request must not retry automatically");
assert.equal(processorRequest.parameters.method, "POST");
assert.ok(processorRequest.parameters.options.timeout <= 60000);
assert.equal(trelloProcessorRequest.retryOnFail, undefined, "Trello move processor request must not retry automatically");
assert.equal(trelloProcessorRequest.parameters.method, "POST");
assert.ok(trelloProcessorRequest.parameters.options.timeout <= 60000);
assert.match(archiveSerialized, /outlook-archives\/process/);
assert.match(archiveSerialized, /X-Neontrip-Outlook-Archive-Worker/);
assert.match(archiveSerialized, /trello-arrivals\/process/);
assert.match(archiveSerialized, /X-Neontrip-Trello-Arrival-Worker/);
for (const request of archiveRequests) {
  assert.equal(request.parameters.authentication, "genericCredentialType");
  assert.equal(request.parameters.genericAuthType, "httpCustomAuth");
  assert.equal(request.credentials.httpCustomAuth.id, "HJHHkJXK8B7QCtCQ");
  assert.equal(request.credentials.httpCustomAuth.name, "NEONTRIP Ops Archive Worker");
}
assert.match(archiveSerialized, /https:\/\/ops[.]neontrip[.]de/);
assert.match(archiveSerialized, /full tracking number/);
assert.doesNotMatch(
  processorRequest.parameters.body,
  /ARRIVAL_LABEL_CF_ACCESS_CLIENT|ARRIVAL_LABEL_AGENT_API_TOKEN/,
  "secrets must stay in request headers and never enter the request body",
);
assert.doesNotMatch(
  trelloProcessorRequest.parameters.body,
  /ARRIVAL_LABEL_CF_ACCESS_CLIENT|ARRIVAL_LABEL_AGENT_API_TOKEN/,
  "secrets must stay in request headers and never enter the Trello request body",
);
assert.doesNotMatch(
  archiveSerialized,
  /\$env|ARRIVAL_LABEL_CF_ACCESS_CLIENT|ARRIVAL_LABEL_AGENT_API_TOKEN|CF-Access-Client-Secret/,
  "archive workflow must use the encrypted custom-auth credential instead of environment secrets",
);
assert.doesNotMatch(archiveSerialized, /EASYDPD|createLabel|ARRIVAL_LABEL_WRITES_ENABLED|print-jobs\/claim/);
assert.ok(archiveWorkflow.nodes.length <= 8, "arrival-finalizer orchestration must stay small");
for (const codeNode of archiveWorkflow.nodes.filter((node) => node.type === "n8n-nodes-base.code")) {
  assert.doesNotThrow(() => new Function(codeNode.parameters.jsCode), `${codeNode.name} JavaScript must parse`);
  assert.doesNotMatch(codeNode.parameters.jsCode, /\$env|ARRIVAL_LABEL_/, "Code runner must not receive production secrets");
}
process.stdout.write("arrival-labels n8n workflow checks passed\n");
