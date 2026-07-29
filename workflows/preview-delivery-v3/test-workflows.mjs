import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const generatedDir = join(here, "generated");
const files = readdirSync(generatedDir).filter((file) => file.endsWith(".json"));

assert.ok(files.length >= 1, "at least one v3 worker must be generated");

for (const file of files) {
  const workflow = JSON.parse(readFileSync(join(generatedDir, file), "utf8"));
  const names = new Set(workflow.nodes.map((node) => node.name));
  const triggerNodes = workflow.nodes.filter((node) => /Trigger$/.test(node.type));

  assert.ok(workflow.nodes.length <= 30, `${workflow.name} exceeds the 30-node safety limit`);
  assert.equal(triggerNodes.length, 1, `${workflow.name} must have exactly one trigger`);
  assert.equal(
    workflow.nodes.some((node) => node.type === "n8n-nodes-base.wait"),
    false,
    `${workflow.name} must not keep executions alive with Wait nodes`
  );
  assert.equal(
    JSON.stringify(workflow).includes("$getWorkflowStaticData"),
    false,
    `${workflow.name} must not use local workflow static data for coordination`
  );

  for (const [source, outputs] of Object.entries(workflow.connections)) {
    assert.ok(names.has(source), `${workflow.name} has a missing connection source ${source}`);
    for (const output of outputs.main || []) {
      for (const connection of output || []) {
        assert.ok(names.has(connection.node), `${workflow.name} points to missing node ${connection.node}`);
      }
    }
  }
}

const projection = JSON.parse(readFileSync(
  join(generatedDir, "neontrip-preview-delivery-v3-trello-projection-worker.json"),
  "utf8"
));
const trelloWriters = projection.nodes
  .filter((node) => JSON.stringify(node.parameters || {}).includes("api.trello.com"))
  .filter((node) => ["POST", "PUT", "DELETE"].includes(node.parameters?.method));

assert.deepEqual(
  trelloWriters.map((node) => node.name).sort(),
  ["Create Trello Comment", "Update Trello Comment"],
  "only the projection worker may write marker-based Trello comments"
);

console.log("preview delivery v3 workflow tests passed");
