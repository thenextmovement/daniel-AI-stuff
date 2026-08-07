import assert from "node:assert/strict";
import { operations, patch, removedNodeNames, waitNode } from "./six-minute-delay-patch.mjs";

assert.equal(patch.workflowId, "1hRkUxPXUZoYRSgL");
assert.equal(patch.expectedBaseNodeCount, 29);
assert.equal(patch.expectedFinalNodeCount, 25);
assert.equal(removedNodeNames.length, 5);
assert.equal(new Set(removedNodeNames).size, removedNodeNames.length);

assert.equal(waitNode.type, "n8n-nodes-base.wait");
assert.equal(waitNode.parameters.resume, "timeInterval");
assert.equal(waitNode.parameters.amount, 6);
assert.equal(waitNode.parameters.unit, "minutes");

const removeOperations = operations.filter((operation) => operation.type === "removeNode");
assert.deepEqual(removeOperations.map((operation) => operation.nodeName), removedNodeNames);

const sendUpdate = operations.find(
  (operation) => operation.type === "updateNode" && operation.nodeName === "Send Customer AutoReply",
);
assert.equal(
  sendUpdate.updates["parameters.html"],
  "={{ $('Normalize & Validate Submission').item.json.autoReplyHtml }}",
);

const connectionPairs = operations
  .filter((operation) => operation.type === "addConnection")
  .map((operation) => `${operation.source} -> ${operation.target}`);
assert.deepEqual(connectionPairs, [
  "Send Internal Lead Notification -> Respond Lead Accepted",
  "Respond Lead Accepted -> Wait 6 Minutes Before AutoReply",
  "Wait 6 Minutes Before AutoReply -> Send Customer AutoReply",
]);

assert.ok(operations.some(
  (operation) =>
    operation.type === "removeConnection"
    && operation.source === "Record Notification Result"
    && operation.target === "Respond Lead Accepted",
));

console.log("RIESENOBJEKTE six-minute delay patch checks passed");
