import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const patchFile = JSON.parse(
  await readFile(resolve(here, "workflow-patches.json"), "utf8"),
);
const postDelivery = JSON.parse(
  await readFile(
    resolve(
      here,
      "../loop-agent-hardening/generated/j3GCBHSxfOW3SP1c.post-delivery-draft-loop-v2.json",
    ),
    "utf8",
  ),
);

assert.equal(patchFile.incidentDate, "2026-07-23");
assert.equal(patchFile.workflows.length, 3);
assert.equal(
  new Set(patchFile.workflows.map((workflow) => workflow.workflowId)).size,
  3,
);

function workflow(id) {
  const found = patchFile.workflows.find((entry) => entry.workflowId === id);
  assert.ok(found, `missing workflow patch ${id}`);
  assert.match(found.activeVersionBefore, /^[0-9a-f-]{36}$/);
  assert.match(found.backupWorkflowId, /^[A-Za-z0-9]+$/);
  assert.ok(found.intent.length >= 40);
  return found;
}

const inflatable = workflow("hucy9EMXPblxJsCm");
const cardsUpdate = inflatable.operations.find(
  (operation) =>
    operation.type === "updateNode" &&
    operation.nodeId === "get-inflatable-cards",
);
assert.equal(
  cardsUpdate.updates["parameters.url"],
  "https://api.trello.com/1/lists/693a941e671842fa697552e9/cards",
);
assert.equal(cardsUpdate.updates.retryOnFail, true);
assert.equal(cardsUpdate.updates.maxTries, 3);
assert.equal(cardsUpdate.updates.waitBetweenTries, 20000);
assert.ok(
  inflatable.operations.some(
    (operation) =>
      operation.type === "updateNode" &&
      operation.nodeId === "schedule-trigger" &&
      operation.updates["parameters.rule.interval"][0].minutesInterval === 5,
  ),
);
assert.ok(
  inflatable.operations.some(
    (operation) =>
      operation.type === "removeNode" &&
      operation.nodeId === "get-board-lists",
  ),
);
assert.equal(
  inflatable.operations.some(
    (operation) =>
      operation.updates?.["parameters.method"] === "POST" &&
      operation.updates?.retryOnFail === true,
  ),
  false,
  "side-effecting Trello writes must never receive blind retries",
);

const telegram = workflow("7AvW1d4JBNDFuNsv");
assert.deepEqual(
  telegram.operations.map((operation) => operation.nodeId).sort(),
  ["attsend", "sendphoto"],
);
assert.equal(
  telegram.operations.every(
    (operation) =>
      operation.type === "updateNode" &&
      operation.updates["parameters.operation"] === "sendDocument",
  ),
  true,
);

const post = workflow("j3GCBHSxfOW3SP1c");
assert.equal(post.operations.length, 1);
const postPatch = post.operations[0].patches[0];
assert.match(postPatch.find, /stale_lease_draft_unknown/);
assert.match(postPatch.replace, /manual_review_required/);
assert.match(postPatch.replace, /route: 'safe_stop'/);
assert.match(postPatch.replace, /automaticSendAllowed: false/);
assert.match(postPatch.replace, /automaticRetryAllowed: false/);
assert.match(postPatch.replace, /throw new Error/);
assert.doesNotThrow(
  () => new vm.Script(`(async () => {\n${postPatch.replace}\n})()`),
);

const generatedStop = postDelivery.nodes.find(
  (node) => node.id === "post-delivery-stop",
);
assert.ok(generatedStop);
assert.equal(generatedStop.parameters.jsCode, postPatch.replace);

console.log("n8n incident workflow patches: ok");
