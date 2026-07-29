import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const generatedDir = join(here, "generated");
mkdirSync(generatedDir, { recursive: true });

const supabaseCredential = {
  httpHeaderAuth: {
    id: "NTtNxoBGGzJCQi9u",
    name: "Header Auth account 2 | SUPABASE"
  }
};

const trelloCredential = {
  trelloApi: {
    id: "96DRckmFxj423JUR",
    name: "Trello account"
  }
};

function schedule(id, name, position) {
  return {
    id,
    name,
    type: "n8n-nodes-base.scheduleTrigger",
    typeVersion: 1.2,
    position,
    parameters: {
      rule: {
        interval: [{ field: "minutes", minutesInterval: 1 }]
      }
    }
  };
}

function code(id, name, jsCode, position) {
  return {
    id,
    name,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position,
    parameters: { jsCode }
  };
}

function booleanIf(id, name, expression, position) {
  return {
    id,
    name,
    type: "n8n-nodes-base.if",
    typeVersion: 2.3,
    position,
    parameters: {
      conditions: {
        options: {
          version: 2,
          leftValue: "",
          caseSensitive: true,
          typeValidation: "strict"
        },
        conditions: [{
          id: `${id}-condition`,
          leftValue: expression,
          rightValue: true,
          operator: { type: "boolean", operation: "equals" }
        }],
        combinator: "and"
      },
      options: {}
    }
  };
}

function supabaseRpc(id, name, rpc, jsonBody, position) {
  return {
    id,
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 3000,
    parameters: {
      method: "POST",
      url: `https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/${rpc}`,
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendHeaders: true,
      headerParameters: {
        parameters: [{ name: "Content-Type", value: "application/json" }]
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody,
      options: { timeout: 15000 }
    },
    credentials: supabaseCredential
  };
}

function connect(node, index = 0) {
  return { node, type: "main", index };
}

const projectionWorkflow = {
  name: "NEONTRIP Preview Delivery v3 — Trello Projection Worker",
  nodes: [
    schedule("projection-schedule", "Every Minute", [0, 300]),
    supabaseRpc(
      "projection-claim",
      "Claim Projection",
      "claim_preview_delivery_projection_v3",
      "={{ JSON.stringify({ p_worker_id: 'preview-v3-projection:' + String($execution.id || 'scheduled'), p_workflow_execution_id: String($execution.id || ''), p_lease_seconds: 120 }) }}",
      [240, 300]
    ),
    code(
      "projection-normalize",
      "Normalize Claim",
      `const claim = $input.first().json || {};
const projection = claim.projection || null;
if (!projection) return [{ json: { hasWork: false, reason: claim.reason || 'queue_empty' } }];
const payload = projection.payload || {};
return [{ json: {
  hasWork: true,
  projectionId: projection.id,
  claimToken: claim.claim_token,
  operation: projection.operation,
  cardId: projection.trello_card_id,
  marker: String(payload.marker || '').trim(),
  text: String(payload.text || '').trim()
} }];`,
      [480, 300]
    ),
    booleanIf("projection-has-work", "Has Work?", "={{ $json.hasWork === true }}", [720, 300]),
    {
      id: "projection-read-comments",
      name: "Read Existing Comments",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [960, 220],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 2000,
      onError: "continueRegularOutput",
      parameters: {
        method: "GET",
        url: "=https://api.trello.com/1/cards/{{ $('Normalize Claim').first().json.cardId }}/actions",
        authentication: "predefinedCredentialType",
        nodeCredentialType: "trelloApi",
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: "filter", value: "commentCard" },
            { name: "limit", value: "100" }
          ]
        },
        options: { timeout: 15000 }
      },
      credentials: trelloCredential
    },
    code(
      "projection-plan-comment",
      "Plan Comment Upsert",
      `const context = $('Normalize Claim').first().json;
const values = $input.all().flatMap((item) => Array.isArray(item.json) ? item.json : [item.json]);
const readError = values.find((value) => value?.error || Number(value?.statusCode || 0) >= 400);
if (context.operation !== 'COMMENT_UPSERT') {
  return [{ json: { ...context, commentsReadOk: false, error: 'unsupported_projection_operation:' + context.operation } }];
}
if (!context.marker || !context.text) {
  return [{ json: { ...context, commentsReadOk: false, error: 'comment_marker_and_text_required' } }];
}
if (readError) {
  return [{ json: { ...context, commentsReadOk: false, error: String(readError.error?.message || readError.message || JSON.stringify(readError)).slice(0, 1000) } }];
}
const existing = values.find((value) => String(value?.data?.text || '').includes(context.marker));
return [{ json: {
  ...context,
  commentsReadOk: true,
  hasExistingComment: Boolean(existing?.id),
  existingActionId: existing?.id || null
} }];`,
      [1200, 220]
    ),
    booleanIf(
      "projection-comments-ok",
      "Comments Read OK?",
      "={{ $json.commentsReadOk === true }}",
      [1440, 220]
    ),
    booleanIf(
      "projection-existing-comment",
      "Existing Comment?",
      "={{ $json.hasExistingComment === true }}",
      [1680, 140]
    ),
    {
      id: "projection-update-comment",
      name: "Update Trello Comment",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [1920, 40],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 2000,
      onError: "continueRegularOutput",
      parameters: {
        method: "PUT",
        url: "=https://api.trello.com/1/actions/{{ $('Plan Comment Upsert').first().json.existingActionId }}/text",
        authentication: "predefinedCredentialType",
        nodeCredentialType: "trelloApi",
        sendQuery: true,
        queryParameters: {
          parameters: [{ name: "value", value: "={{ $('Plan Comment Upsert').first().json.text }}" }]
        },
        options: { timeout: 15000 }
      },
      credentials: trelloCredential
    },
    {
      id: "projection-create-comment",
      name: "Create Trello Comment",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [1920, 220],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 2000,
      onError: "continueRegularOutput",
      parameters: {
        method: "POST",
        url: "=https://api.trello.com/1/cards/{{ $('Plan Comment Upsert').first().json.cardId }}/actions/comments",
        authentication: "predefinedCredentialType",
        nodeCredentialType: "trelloApi",
        sendQuery: true,
        queryParameters: {
          parameters: [{ name: "text", value: "={{ $('Plan Comment Upsert').first().json.text }}" }]
        },
        options: { timeout: 15000 }
      },
      credentials: trelloCredential
    },
    code(
      "projection-finish-input",
      "Prepare Finish",
      `const context = $('Normalize Claim').first().json;
let plan = {};
try { plan = $('Plan Comment Upsert').first().json || {}; } catch {}
const response = $input.first().json || {};
const rawError = plan.error || response.error?.message || response.message || (Number(response.statusCode || 0) >= 400 ? JSON.stringify(response) : '');
const succeeded = !rawError && plan.commentsReadOk === true;
return [{ json: {
  projectionId: context.projectionId,
  claimToken: context.claimToken,
  finishStatus: succeeded ? 'SUCCEEDED' : 'RETRY',
  externalActionId: succeeded ? String(response.id || plan.existingActionId || '') || null : null,
  error: succeeded ? null : String(rawError || 'trello_projection_failed').slice(0, 2000)
} }];`,
      [2160, 300]
    ),
    supabaseRpc(
      "projection-finish",
      "Finish Projection",
      "finish_preview_delivery_projection_v3",
      "={{ JSON.stringify({ p_projection_id: $json.projectionId, p_claim_token: $json.claimToken, p_workflow_execution_id: String($execution.id || ''), p_status: $json.finishStatus, p_external_action_id: $json.externalActionId || null, p_error: $json.error || null }) }}",
      [2400, 300]
    ),
    code(
      "projection-assert-finished",
      "Assert Finished",
      `const result = $input.first().json || {};
if (result.ok !== true) throw new Error('Projection finish was rejected: ' + JSON.stringify(result));
return [{ json: { ok: true, projectionId: result.projection?.id || null, status: result.projection?.status || null } }];`,
      [2640, 300]
    )
  ],
  connections: {
    "Every Minute": { main: [[connect("Claim Projection")]] },
    "Claim Projection": { main: [[connect("Normalize Claim")]] },
    "Normalize Claim": { main: [[connect("Has Work?")]] },
    "Has Work?": { main: [[connect("Read Existing Comments")], []] },
    "Read Existing Comments": { main: [[connect("Plan Comment Upsert")]] },
    "Plan Comment Upsert": { main: [[connect("Comments Read OK?")]] },
    "Comments Read OK?": {
      main: [[connect("Existing Comment?")], [connect("Prepare Finish")]]
    },
    "Existing Comment?": {
      main: [[connect("Update Trello Comment")], [connect("Create Trello Comment")]]
    },
    "Update Trello Comment": { main: [[connect("Prepare Finish")]] },
    "Create Trello Comment": { main: [[connect("Prepare Finish")]] },
    "Prepare Finish": { main: [[connect("Finish Projection")]] },
    "Finish Projection": { main: [[connect("Assert Finished")]] }
  },
  settings: {
    executionOrder: "v1",
    timezone: "Europe/Berlin",
    saveDataErrorExecution: "all",
    saveDataSuccessExecution: "all",
    saveExecutionProgress: true,
    saveManualExecutions: true,
    executionTimeout: 90
  }
};

const workflows = [projectionWorkflow];
for (const workflow of workflows) {
  const fileName = workflow.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") + ".json";
  writeFileSync(join(generatedDir, fileName), `${JSON.stringify(workflow, null, 2)}\n`);
}

console.log(JSON.stringify({
  ok: true,
  generated: workflows.map((workflow) => ({
    name: workflow.name,
    nodes: workflow.nodes.length
  }))
}, null, 2));
