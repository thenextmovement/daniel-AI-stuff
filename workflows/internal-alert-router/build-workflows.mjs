import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const sourceDirectory = path.join(directory, "source");
const generatedDirectory = path.join(directory, "generated");

const ROUTER_ID = "SH5HK6TqLCyaitXu";
const ROUTER_NAME = "NEONTRIP Internal Alert Router v1 — SHADOW";
const SUPABASE_CREDENTIAL = {
  httpHeaderAuth: {
    id: "NTtNxoBGGzJCQi9u",
    name: "Header Auth account 2 | SUPABASE",
  },
};

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(sourceDirectory, name), "utf8"));
}

function workflowBody(source) {
  return {
    name: source.name,
    active: false,
    nodes: structuredClone(source.nodes),
    connections: structuredClone(source.connections),
    settings: structuredClone(source.settings || {}),
  };
}

function addMainConnection(workflow, source, target) {
  workflow.connections[source] ||= { main: [[]] };
  workflow.connections[source].main ||= [[]];
  workflow.connections[source].main[0] ||= [];
  if (!workflow.connections[source].main[0].some((entry) => entry.node === target)) {
    workflow.connections[source].main[0].push({
      node: target,
      type: "main",
      index: 0,
    });
  }
}

function shadowRouterCall(id, name, position) {
  return {
    id,
    name,
    type: "n8n-nodes-base.executeWorkflow",
    typeVersion: 1.1,
    position,
    parameters: {
      source: "database",
      workflowId: {
        __rl: true,
        value: ROUTER_ID,
        mode: "list",
        cachedResultName: ROUTER_NAME,
      },
      mode: "once",
      options: {
        waitForSubWorkflow: true,
      },
    },
    onError: "continueRegularOutput",
  };
}

const normalizeCode = String.raw`
function text(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function redact(value) {
  return text(value, 2000)
    .replace(/bearer\s+[a-z0-9._~+\/-]+=*/gi, "[redacted-token]")
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[redacted-email]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted-url]")
    .replace(/\+?[0-9][0-9() ./-]{7,}[0-9]/g, "[redacted-phone]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[redacted-uuid]")
    .replace(/\b[0-9a-f]{24,}\b/gi, "[redacted-token]")
    .replace(/\b\d{6,}\b/g, "[redacted-number]")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForFingerprint(value) {
  return redact(value)
    .toLowerCase()
    .replace(/\bexecution(?: id)?[: #=-]*\d+\b/gi, "execution [id]")
    .replace(/\b(?:attempt|retry)[: #=-]*\d+\b/gi, "attempt [n]")
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|milliseconds?|seconds?|secs?|s)\b/gi, "[duration]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
}

function fnv1a(value, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ("00000000" + (hash >>> 0).toString(16)).slice(-8);
}

function classifyRootCause(message) {
  if (/invalid_grant|refresh token|expired|revoked|unauthori[sz]ed|oauth|authentication/.test(message)) return "credential_or_auth";
  if (/forbidden|permission[_ ]denied|access denied|insufficient privilege/.test(message)) return "permission";
  if (/429|rate limit|quota exceeded|too many requests/.test(message)) return "rate_limit";
  if (/timeout|timed out|etimedout|econnrefused|enotfound|socket hang up/.test(message)) return "dependency_unavailable";
  if (/cannot read|undefined|null|typeerror|referenceerror|schema|validation/.test(message)) return "data_shape_or_validation";
  if (/5\d\d|bad gateway|service unavailable|upstream/.test(message)) return "external_service";
  return "unclassified_workflow_error";
}

const input = $input.first().json || {};
const metadata = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
const workflowId = text(input.source_workflow_id || input.workflowId || input.workflow?.id, 200);
const workflowName = text(input.source_workflow_name || input.workflowName || input.workflow?.name || "Unknown Workflow", 300);
const executionId = text(metadata.execution_id || input.executionId || input.execution?.id, 200);
const executionUrl = text(metadata.execution_url || input.executionUrl || input.execution?.url, 1000);
const lastNode = text(metadata.last_node || input.lastNode || input.execution?.lastNodeExecuted || "unknown", 300);
const rawError = text(metadata.error_message || input.errorMessage || input.execution?.error?.message || input.subject || "unknown error", 2000);

if (!workflowId || !workflowName) {
  throw new Error("internal_alert_router_invalid_source_identity");
}

const normalizedError = normalizeForFingerprint(rawError) || "unknown error";
const rootCause = classifyRootCause(normalizedError);
const signatureSource = [workflowId.toLowerCase(), lastNode.toLowerCase(), rootCause, normalizedError].join("|");
const signature = fnv1a(signatureSource, 2166136261) + fnv1a(signatureSource, 3339675911);
const fingerprint = ("n8n-alert:" + workflowId.toLowerCase() + ":" + signature).slice(0, 500);
const requestedSeverity = text(input.severity_hint || "warning", 20).toLowerCase();
const severity = ["info", "warning", "critical"].includes(requestedSeverity) ? requestedSeverity : "warning";
const alertType = text(input.alert_type || "error", 80).toLowerCase().replace(/[^a-z0-9_-]+/g, "_") || "error";
const redactedPreview = redact(rawError).slice(0, 500);

return [{
  json: {
    router_mode: "shadow",
    router_version: "internal-alert-router-v1",
    fingerprint,
    signature,
    rpc_payload: {
      p_fingerprint: fingerprint,
      p_incident_type: "n8n_" + alertType,
      p_severity: severity,
      p_title: ("n8n: " + workflowName + " failed").slice(0, 500),
      p_detail: [
        "Workflow: " + workflowName,
        "Node: " + lastNode,
        "Cause: " + rootCause,
        "Redacted error: " + redactedPreview,
        "Signature: " + signature,
      ].join("\n").slice(0, 5000),
      p_root_cause_code: rootCause,
      p_workflow_execution_id: executionId || null,
      p_source_key: "n8n",
      p_source_ref: executionUrl || null,
      p_evidence_refs: executionId ? [{ type: "n8n_execution", id: executionId }] : [],
      p_owner_team: "operations",
      p_metadata: {
        router_mode: "shadow",
        router_version: "internal-alert-router-v1",
        source_workflow_id: workflowId,
        source_workflow_name: workflowName,
        last_node: lastNode,
        error_signature: signature,
        error_preview_redacted: redactedPreview,
      },
      p_actor: "n8n-internal-alert-router",
      p_reopen: true,
    },
  },
}];
`;

const shadowWriteSuccessCode = String.raw`
const request = $("Normalize, Redact & Fingerprint").first().json;
return [{
  json: {
    shadow_write: "ok",
    router_mode: request.router_mode,
    router_version: request.router_version,
    fingerprint: request.fingerprint,
    signature: request.signature,
  },
}];
`;

const shadowWriteFailureCode = String.raw`
const request = $("Normalize, Redact & Fingerprint").first().json;
const failure = $input.first().json || {};
return [{
  json: {
    shadow_write: "failed",
    router_mode: request.router_mode,
    router_version: request.router_version,
    fingerprint: request.fingerprint,
    signature: request.signature,
    failure_type: String(failure.error?.name || failure.name || "supabase_write_failed").slice(0, 120),
  },
}];
`;

function buildRouter() {
  return {
    name: ROUTER_NAME,
    active: false,
    nodes: [
      {
        id: "internal-alert-input",
        name: "Internal Alert Input",
        type: "n8n-nodes-base.executeWorkflowTrigger",
        typeVersion: 1.2,
        position: [0, 200],
        parameters: {
          inputSource: "passthrough",
        },
      },
      {
        id: "normalize-redact-fingerprint",
        name: "Normalize, Redact & Fingerprint",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [280, 200],
        parameters: {
          mode: "runOnceForAllItems",
          jsCode: normalizeCode,
        },
      },
      {
        id: "upsert-company-brain-incident",
        name: "Upsert Company Brain Incident",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.4,
        position: [580, 200],
        parameters: {
          authentication: "genericCredentialType",
          genericAuthType: "httpHeaderAuth",
          method: "POST",
          url: "https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/upsert_company_brain_incident",
          sendHeaders: true,
          headerParameters: {
            parameters: [
              {
                name: "Content-Type",
                value: "application/json",
              },
            ],
          },
          sendBody: true,
          specifyBody: "json",
          jsonBody: "={{ JSON.stringify($json.rpc_payload) }}",
          options: {
            timeout: 30000,
            response: {
              response: {
                fullResponse: true,
                responseFormat: "json",
              },
            },
          },
        },
        credentials: SUPABASE_CREDENTIAL,
        retryOnFail: true,
        maxTries: 3,
        waitBetweenTries: 3000,
        onError: "continueErrorOutput",
      },
      {
        id: "shadow-write-ok",
        name: "Shadow Write OK",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [880, 100],
        parameters: {
          mode: "runOnceForAllItems",
          jsCode: shadowWriteSuccessCode,
        },
      },
      {
        id: "shadow-write-failed",
        name: "Shadow Write Failed",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [880, 300],
        parameters: {
          mode: "runOnceForAllItems",
          jsCode: shadowWriteFailureCode,
        },
      },
    ],
    connections: {
      "Internal Alert Input": {
        main: [[{
          node: "Normalize, Redact & Fingerprint",
          type: "main",
          index: 0,
        }]],
      },
      "Normalize, Redact & Fingerprint": {
        main: [[{
          node: "Upsert Company Brain Incident",
          type: "main",
          index: 0,
        }]],
      },
      "Upsert Company Brain Incident": {
        main: [
          [{
            node: "Shadow Write OK",
            type: "main",
            index: 0,
          }],
          [{
            node: "Shadow Write Failed",
            type: "main",
            index: 0,
          }],
        ],
      },
    },
    settings: {
      executionOrder: "v1",
      timezone: "Europe/Berlin",
      saveDataErrorExecution: "all",
      saveDataSuccessExecution: "all",
      callerPolicy: "workflowsFromSameOwner",
      availableInMCP: false,
    },
  };
}

function buildInfoHandler() {
  const workflow = workflowBody(readJson("error-notification-info-active-before-20260720.json"));
  workflow.active = true;
  workflow.nodes = workflow.nodes.filter(
    (candidate) => !(candidate.id === "send-error-email" && candidate.disabled === true),
  );
  workflow.nodes.push(shadowRouterCall(
    "shadow-router-call",
    "Shadow: Record Company Brain Incident",
    [1000, 260],
  ));
  addMainConnection(workflow, "Prepare Alert Data", "Shadow: Record Company Brain Incident");
  return workflow;
}

const prepareAlertingShadowCode = String.raw`
const input = $input.first().json || {};
const executionUrl = String(input.executionUrl || "").slice(0, 1000);
const workflowIdFromUrl = (executionUrl.match(/\/workflow\/([^/]+)(?:\/executions\/|$)/) || [])[1] || "";
return [{
  json: {
    alert_type: "error",
    severity_hint: "warning",
    source_workflow_id: String(input.workflowId || workflowIdFromUrl).slice(0, 200),
    source_workflow_name: String(input.workflowName || "Unknown Workflow").slice(0, 300),
    subject: String(input.emailSubject || ("N8N Fehler: " + (input.workflowName || "Unknown Workflow"))).slice(0, 500),
    metadata: {
      execution_id: String(input.executionId || "").slice(0, 200),
      execution_url: executionUrl,
      error_message: String(input.errorMessage || "Unknown error").slice(0, 2000),
      last_node: String(input.lastNode || "unknown").slice(0, 300),
    },
  },
}];
`;

function buildSupportHandler() {
  const workflow = workflowBody(readJson("neontrip-error-alerting-active-before-20260720.json"));
  workflow.active = true;
  workflow.nodes.push({
    id: "prepare-shadow-alert",
    name: "Prepare Shadow Alert",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [700, 560],
    parameters: {
      mode: "runOnceForAllItems",
      jsCode: prepareAlertingShadowCode,
    },
  });
  workflow.nodes.push(shadowRouterCall(
    "shadow-router-call",
    "Shadow: Record Company Brain Incident",
    [980, 560],
  ));
  addMainConnection(workflow, "Format Error Data", "Prepare Shadow Alert");
  addMainConnection(workflow, "Prepare Shadow Alert", "Shadow: Record Company Brain Incident");
  return workflow;
}

fs.mkdirSync(generatedDirectory, { recursive: true });
const outputs = {
  "internal-alert-router-v1-shadow.json": buildRouter(),
  "error-notification-info-shadow-adapter.json": buildInfoHandler(),
  "neontrip-error-alerting-shadow-adapter.json": buildSupportHandler(),
};
for (const [name, workflow] of Object.entries(outputs)) {
  fs.writeFileSync(path.join(generatedDirectory, name), JSON.stringify(workflow, null, 2) + "\n");
}

console.log("Generated " + Object.keys(outputs).length + " workflow artifacts.");
