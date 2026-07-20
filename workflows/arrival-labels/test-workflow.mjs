import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = [
  new URL("./generated/dhl-dpd-arrival-dry-run.json", import.meta.url),
  new URL("./generated/dhl-arrival-email-dry-run.json", import.meta.url),
];
const workflows = await Promise.all(files.map(async (file) => JSON.parse(await readFile(file, "utf8"))));
for (const workflow of workflows) {
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
  assert.match(serialized, /persist.*false/);
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
process.stdout.write("arrival-labels n8n workflow checks passed\n");
