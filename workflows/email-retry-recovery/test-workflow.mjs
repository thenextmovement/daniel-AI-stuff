import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { retryWorkflow, sourceCoreManifest } from "./build-workflow.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const source = JSON.parse(
  await readFile(join(directory, "source", "main-workflow-active-20260717.json"), "utf8"),
);

const nodeByName = (name) => {
  const node = retryWorkflow.nodes.find((entry) => entry.name === name);
  assert.ok(node, "missing node: " + name);
  return node;
};

const triggerNodes = retryWorkflow.nodes.filter((node) => node.type.endsWith("Trigger"));
assert.equal(triggerNodes.length, 1);
assert.equal(triggerNodes[0].name, "Retry Schedule");
assert.equal(retryWorkflow.nodes.length, 30);
assert.ok(retryWorkflow.nodes.length <= 30);

for (const removed of [
  "Outlook Trigger",
  "Loop Over Emails",
  "Should Process Email?",
  "Acquire Idempotency Lock",
  "Was Lock Inserted?",
  "Dispatch Decision Shadow",
]) {
  assert.equal(retryWorkflow.nodes.some((node) => node.name === removed), false);
}

assert.match(nodeByName("Claim Due Retry").parameters.url, /claim_due_email_agent_retry_v2$/);
assert.match(
  nodeByName("Fetch Retry Message and Drafts").parameters.url,
  /graph\.microsoft\.com\/v1\.0\/\$batch$/,
);
assert.match(
  nodeByName("Fetch Retry Message and Drafts").parameters.jsonBody,
  /conversation-drafts/,
);
assert.match(
  nodeByName("Fetch Retry Message and Drafts").parameters.jsonBody,
  /source-by-internet-id/,
);
assert.match(
  nodeByName("Fetch Retry Message and Drafts").parameters.jsonBody,
  /internetMessageId eq/,
);
assert.match(
  nodeByName("Fetch Retry Message and Drafts").parameters.jsonBody,
  /mailFolders\/drafts\/messages/,
);
assert.doesNotMatch(
  nodeByName("Fetch Retry Message and Drafts").parameters.jsonBody,
  /conversationId eq/,
);
assert.match(nodeByName("Normalize Email").parameters.jsCode, /existing_reply_draft/);
assert.match(
  nodeByName("Normalize Email").parameters.jsCode,
  /source_message_unavailable_after_internet_id_lookup/,
);
assert.match(
  nodeByName("Normalize Email").parameters.jsCode,
  /retryRecoveryVersion: 'email-agent-retry-recovery-v1'/,
);
assert.match(nodeByName("Build Failure Record").parameters.jsCode, /retry_recovery/);
assert.match(
  nodeByName("Log Success").parameters.url,
  /complete_email_agent_retry_message$/,
);
assert.match(
  nodeByName("Finalize Retry Without New Draft").parameters.url,
  /finalize_email_agent_retry_without_new_draft$/,
);

const serialized = JSON.stringify(retryWorkflow);
assert.doesNotMatch(serialized, /"operation":"send"/);
assert.doesNotMatch(serialized, /sendMail|replyAll/);
assert.match(serialized, /createReply/);
assert.match(serialized, /automatic_send_allowed/);
assert.match(serialized, /human_approval_required/);

for (const node of retryWorkflow.nodes.filter((entry) => entry.type === "n8n-nodes-base.httpRequest")) {
  assert.equal(node.retryOnFail, true, node.name + " must retry transport failures");
  assert.ok(Number(node.maxTries) >= 3, node.name + " must have bounded retries");
}

const retryCoreNames = new Set(sourceCoreManifest.core_nodes.map((entry) => entry.name));
const expectedCoreNames = source.nodes
  .filter((node) => ![
    "Outlook Trigger",
    "Loop Over Emails",
    "Should Process Email?",
    "Acquire Idempotency Lock",
    "Was Lock Inserted?",
    "Dispatch Decision Shadow",
    "Normalize Email",
    "Build Failure Record",
    "Log Success",
  ].includes(node.name))
  .map((node) => node.name);
assert.deepEqual([...retryCoreNames].sort(), expectedCoreNames.sort());

assert.deepEqual(
  retryWorkflow.connections["Fetch Retry Message and Drafts"].main,
  [
    [{ node: "Normalize Email", type: "main", index: 0 }],
    [{ node: "Build Failure Record", type: "main", index: 0 }],
  ],
);
assert.deepEqual(
  retryWorkflow.connections["Should Retry Message?"].main,
  [
    [{ node: "Fetch Current Message", type: "main", index: 0 }],
    [{ node: "Finalize Retry Without New Draft", type: "main", index: 0 }],
  ],
);
assert.deepEqual(retryWorkflow.connections["Log Success"].main[0], []);

console.log("Email retry recovery workflow tests passed.");
