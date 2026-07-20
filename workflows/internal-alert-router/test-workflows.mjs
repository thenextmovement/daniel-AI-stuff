import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./build-workflows.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const generatedDirectory = path.join(directory, "generated");
const sourceDirectory = path.join(directory, "source");

function read(directoryPath, name) {
  return JSON.parse(fs.readFileSync(path.join(directoryPath, name), "utf8"));
}

function node(workflow, name) {
  return workflow.nodes.find((candidate) => candidate.name === name);
}

function targets(workflow, source) {
  return (workflow.connections[source]?.main?.[0] || []).map((entry) => entry.node);
}

const router = read(generatedDirectory, "internal-alert-router-v1-shadow.json");
const info = read(generatedDirectory, "error-notification-info-shadow-adapter.json");
const support = read(generatedDirectory, "neontrip-error-alerting-shadow-adapter.json");
const infoBefore = read(sourceDirectory, "error-notification-info-active-before-20260720.json");
const supportBefore = read(sourceDirectory, "neontrip-error-alerting-active-before-20260720.json");

assert.equal(infoBefore.activeVersionId, "c9e8e613-191e-4230-9200-14642f1001d3");
assert.equal(supportBefore.activeVersionId, "b1a6f551-7cb4-4eb8-b10b-ce6dc9ef0c61");

assert.equal(router.active, false);
assert.equal(router.nodes.length, 5);
assert.ok(router.nodes.length <= 30);
assert.equal(
  router.nodes.filter((candidate) => candidate.type === "n8n-nodes-base.executeWorkflowTrigger").length,
  1,
);
assert.equal(
  router.nodes.some((candidate) => candidate.type === "n8n-nodes-base.microsoftOutlook"),
  false,
);
assert.equal(
  router.nodes.some((candidate) => candidate.type.includes("langchain")),
  false,
);

const upsert = node(router, "Upsert Company Brain Incident");
assert.equal(
  upsert.parameters.url,
  "https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/upsert_company_brain_incident",
);
assert.equal(upsert.retryOnFail, true);
assert.equal(upsert.maxTries, 3);
assert.equal(upsert.onError, "continueErrorOutput");
assert.deepEqual(
  router.connections["Upsert Company Brain Incident"].main.map((branch) => branch[0].node),
  ["Shadow Write OK", "Shadow Write Failed"],
);

const normalize = node(router, "Normalize, Redact & Fingerprint").parameters.jsCode;
for (const marker of [
  "[redacted-token]",
  "[redacted-email]",
  "[redacted-url]",
  "[redacted-phone]",
  "p_fingerprint",
  "router_mode: \"shadow\"",
]) {
  assert.ok(normalize.includes(marker), "Missing safety marker: " + marker);
}

const runNormalize = new Function("$input", normalize);
function normalizeAlert(errorMessage) {
  return runNormalize({
    first() {
      return {
        json: {
          alert_type: "error",
          severity_hint: "warning",
          source_workflow_id: "workflow-123",
          source_workflow_name: "Fixture Workflow",
          metadata: {
            execution_id: "999999",
            execution_url: "https://n8n.example/execution/999999",
            last_node: "HTTP Request",
            error_message: errorMessage,
          },
        },
      };
    },
  })[0].json;
}

const firstNormalized = normalizeAlert(
  "Timeout for alice@example.com at https://api.example/a, phone +49 151 23456789, Bearer secret-token-123, execution 123456",
);
const secondNormalized = normalizeAlert(
  "Timeout for bob@example.com at https://api.example/b, phone +49 170 98765432, Bearer another-token-999, execution 654321",
);
assert.equal(firstNormalized.fingerprint, secondNormalized.fingerprint);
assert.match(firstNormalized.rpc_payload.p_detail, /\n/);
assert.equal(firstNormalized.rpc_payload.p_detail.includes("alice@example.com"), false);
assert.equal(firstNormalized.rpc_payload.p_detail.includes("https://api.example"), false);
assert.equal(firstNormalized.rpc_payload.p_detail.includes("+49 151"), false);
assert.equal(firstNormalized.rpc_payload.p_detail.includes("secret-token-123"), false);
assert.notEqual(
  firstNormalized.fingerprint,
  normalizeAlert("Invalid schema: required field price is missing").fingerprint,
);

const routerText = JSON.stringify(router);
assert.equal(/anthropic|openai|claude/i.test(routerText), false);
assert.equal(/authorization.*bearer/i.test(routerText), false);
assert.equal(routerText.includes("microsoftOutlookOAuth2Api"), false);

assert.ok(node(info, "Send Prepared Alert Email"));
assert.notEqual(node(info, "Send Prepared Alert Email").disabled, true);
assert.equal(node(info, "Send Error Email (Fallback)"), undefined);
assert.ok(node(info, "Shadow: Record Company Brain Incident"));
assert.deepEqual(
  new Set(targets(info, "Prepare Alert Data")),
  new Set(["Send Prepared Alert Email", "Shadow: Record Company Brain Incident"]),
);

assert.ok(node(support, "Send Email Alert"));
assert.notEqual(node(support, "Send Email Alert").disabled, true);
assert.ok(node(support, "Prepare Shadow Alert"));
assert.ok(node(support, "Shadow: Record Company Brain Incident"));
assert.deepEqual(
  new Set(targets(support, "Format Error Data")),
  new Set(["Send WhatsApp Alert", "Send Email Alert", "Prepare Shadow Alert"]),
);
assert.deepEqual(
  targets(support, "Prepare Shadow Alert"),
  ["Shadow: Record Company Brain Incident"],
);

const prepareSupportShadow = node(support, "Prepare Shadow Alert").parameters.jsCode;
const runPrepareSupportShadow = new Function("$input", prepareSupportShadow);
const preparedSupportShadow = runPrepareSupportShadow({
  first() {
    return {
      json: {
        workflowName: "Fixture Support Workflow",
        executionId: "3323085",
        executionUrl: "https://fuajob.online/workflow/PllHsez3Tp1Q4MTN/executions/3323085",
        errorMessage: "NEONTRIP_OPS_BASE_URL must use HTTPS [line 6]",
        lastNode: "Validate Archive Worker Config",
      },
    };
  },
})[0].json;
assert.equal(preparedSupportShadow.source_workflow_id, "PllHsez3Tp1Q4MTN");
assert.equal(
  preparedSupportShadow.metadata.execution_url,
  "https://fuajob.online/workflow/PllHsez3Tp1Q4MTN/executions/3323085",
);

console.log("Internal alert router tests passed.");
