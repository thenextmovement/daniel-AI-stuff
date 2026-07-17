import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(directory, "source", "main-workflow-active-20260717.json");
const outputDirectory = join(directory, "generated");

const source = JSON.parse(await readFile(sourcePath, "utf8"));

const SUPABASE_CREDENTIAL = {
  httpHeaderAuth: {
    id: "NTtNxoBGGzJCQi9u",
    name: "Header Auth account 2 | SUPABASE",
  },
};

const OUTLOOK_CREDENTIAL = {
  microsoftOutlookOAuth2Api: {
    id: "CTEmJD5CjYu9hawu",
    name: "Microsoft Outlook support@neontrip.de",
  },
};

const removedNodeNames = new Set([
  "Outlook Trigger",
  "Loop Over Emails",
  "Should Process Email?",
  "Acquire Idempotency Lock",
  "Was Lock Inserted?",
  "Dispatch Decision Shadow",
]);

function clone(value) {
  return structuredClone(value);
}

function findNode(nodes, name) {
  const node = nodes.find((entry) => entry.name === name);
  if (!node) throw new Error("Missing source node: " + name);
  return node;
}

function replaceOnce(value, find, replacement, label) {
  const occurrences = String(value).split(find).length - 1;
  if (occurrences !== 1) {
    throw new Error("Patch anchor count " + occurrences + " for " + label);
  }
  return String(value).replace(find, replacement);
}

function codeHash(node) {
  return createHash("sha256")
    .update(JSON.stringify({
      name: node.name,
      type: node.type,
      typeVersion: node.typeVersion,
      parameters: node.parameters,
      credentials: node.credentials || null,
      onError: node.onError || null,
      retryOnFail: node.retryOnFail || false,
      maxTries: node.maxTries || null,
      waitBetweenTries: node.waitBetweenTries || null,
    }))
    .digest("hex");
}

const coreNodes = source.nodes
  .filter((node) => !removedNodeNames.has(node.name))
  .map(clone);

const normalize = findNode(coreNodes, "Normalize Email");
normalize.position = [880, 0];
normalize.onError = "continueErrorOutput";
normalize.parameters.jsCode = replaceOnce(
  normalize.parameters.jsCode,
  "const output = [];\nconst now = Date.now();",
  String.raw`const output = [];
const now = Date.now();
const claimResponse = $("Claim Due Retry").first().json || {};
const retryClaim = claimResponse.body ?? claimResponse;
const batchResponse = $input.first().json || {};
const batchPayload = batchResponse.body ?? batchResponse;
const responses = Array.isArray(batchPayload.responses) ? batchPayload.responses : [];
const messageResponse = responses.find((entry) => String(entry?.id || '') === 'source-message') || {};
const messageFallbackResponse = responses.find((entry) => String(entry?.id || '') === 'source-by-internet-id') || {};
const draftsResponse = responses.find((entry) => String(entry?.id || '') === 'conversation-drafts') || {};
const messageStatus = Number(messageResponse.status || 0);
const messageFallbackStatus = Number(messageFallbackResponse.status || 0);
const draftsStatus = Number(draftsResponse.status || 0);
const directSourceMessage = messageStatus === 200 && messageResponse.body?.id
  ? messageResponse.body
  : null;
const fallbackMessages = messageFallbackStatus === 200 && Array.isArray(messageFallbackResponse.body?.value)
  ? messageFallbackResponse.body.value
  : [];
const expectedInternetMessageId = String(retryClaim.internet_message_id || '').trim().toLowerCase();
const fallbackSourceMessage = fallbackMessages.find((entry) =>
  String(entry?.internetMessageId || '').trim().toLowerCase() === expectedInternetMessageId
) || fallbackMessages[0] || null;
const resolvedSourceMessage = directSourceMessage || fallbackSourceMessage;

if (!resolvedSourceMessage && ([408, 425, 429].includes(messageStatus) || messageStatus >= 500)) {
  throw new Error('Retryable Graph source-message failure: HTTP ' + messageStatus);
}
if (!resolvedSourceMessage && messageFallbackStatus !== 200) {
  throw new Error('Retryable Graph internet-message-id fallback failure: HTTP ' + messageFallbackStatus);
}
if ([408, 425, 429].includes(draftsStatus) || draftsStatus >= 500) {
  throw new Error('Retryable Graph draft-reconciliation failure: HTTP ' + draftsStatus);
}
if (!resolvedSourceMessage) {
  return [{ json: {
    shouldProcess: false,
    skipReason: 'source_message_unavailable_after_internet_id_lookup',
    messageId: String(retryClaim.message_id || ''),
    conversationId: String(retryClaim.conversation_id || ''),
    internetMessageId: String(retryClaim.internet_message_id || ''),
    idempotencyKey: String(retryClaim.request_id || ''),
    existingReplyDraftId: '',
    retryAttemptCount: Number(retryClaim.attempt_count || 0),
    retryWorkerExecutionId: String(retryClaim.worker_execution_id || $execution.id),
    _startTime: now,
  } }];
}
if (draftsStatus !== 200 || !Array.isArray(draftsResponse.body?.value)) {
  throw new Error('Draft reconciliation unavailable: HTTP ' + draftsStatus);
}

const sourceMessage = { ...resolvedSourceMessage };
const sourceReceivedMs = Date.parse(sourceMessage.receivedDateTime || 0);
const existingDraft = draftsResponse.body.value
  .filter((entry) => entry?.isDraft === true && String(entry?.conversationId || '') === String(sourceMessage.conversationId || ''))
  .filter((entry) => {
    const createdMs = Date.parse(entry.createdDateTime || entry.lastModifiedDateTime || 0);
    return !Number.isFinite(sourceReceivedMs) || !Number.isFinite(createdMs) || createdMs >= sourceReceivedMs - 120000;
  })
  .sort((left, right) =>
    Date.parse(right.lastModifiedDateTime || right.createdDateTime || 0)
    - Date.parse(left.lastModifiedDateTime || left.createdDateTime || 0)
  )[0] || null;

sourceMessage._retryExistingDraftId = String(existingDraft?.id || '');
const retryInputItems = [{ json: sourceMessage }];`,
  "Normalize Email batch prelude",
);
normalize.parameters.jsCode = replaceOnce(
  normalize.parameters.jsCode,
  "for (const item of $input.all()) {",
  "for (const item of retryInputItems) {",
  "Normalize Email retry input",
);
normalize.parameters.jsCode = replaceOnce(
  normalize.parameters.jsCode,
  "if (tooOld) skipReasons.push('older_than_six_hours');",
  "if (tooOld && retryClaim.claimed !== true) skipReasons.push('older_than_six_hours');\n  if (email._retryExistingDraftId) skipReasons.push('existing_reply_draft');",
  "Normalize Email retry age and draft guard",
);
normalize.parameters.jsCode = replaceOnce(
  normalize.parameters.jsCode,
  "        receivedAt,\n        _startTime: now,",
  "        receivedAt,\n        internetMessageId,\n        idempotencyKey: String(retryClaim.request_id || ('ai-email-v2:' + (internetMessageId || messageId))),\n        existingReplyDraftId: String(email._retryExistingDraftId || ''),\n        retryAttemptCount: Number(retryClaim.attempt_count || 0),\n        retryWorkerExecutionId: String(retryClaim.worker_execution_id || $execution.id),\n        _startTime: now,",
  "Normalize Email skip metadata",
);
normalize.parameters.jsCode = replaceOnce(
  normalize.parameters.jsCode,
  "      idempotencyKey: 'ai-email-v2:' + (internetMessageId || messageId),\n      _startTime: now,",
  "      idempotencyKey: String(retryClaim.request_id || ('ai-email-v2:' + (internetMessageId || messageId))),\n      retryAttemptCount: Number(retryClaim.attempt_count || 0),\n      retryWorkerExecutionId: String(retryClaim.worker_execution_id || $execution.id),\n      retryRecoveryVersion: 'email-agent-retry-recovery-v1',\n      _startTime: now,",
  "Normalize Email claim identity",
);

const buildFailure = findNode(coreNodes, "Build Failure Record");
buildFailure.parameters.jsCode = replaceOnce(
  buildFailure.parameters.jsCode,
  "const normalized = $('Normalize Email').first().json;\nconst incoming = $input.first().json || {};",
  String.raw`let normalized = null;
try { normalized = $("Normalize Email").first().json; } catch (error) {}
const claimResponse = $("Claim Due Retry").first().json || {};
const retryClaim = claimResponse.body ?? claimResponse;
normalized = normalized || {
  idempotencyKey: String(retryClaim.request_id || ''),
  messageId: String(retryClaim.message_id || ''),
  internetMessageId: String(retryClaim.internet_message_id || ''),
  conversationId: String(retryClaim.conversation_id || ''),
  fromEmail: '',
  fromName: '',
  subject: 'Retry recovery failed before normalization',
  messageSource: 'email_agent_retry',
  triggerBodyPreview: '',
  _startTime: Date.now(),
};
const incoming = $input.first().json || {};`,
  "Build Failure retry fallback",
);
buildFailure.parameters.jsCode = replaceOnce(
  buildFailure.parameters.jsCode,
  "  context_snapshot: rendered ? {\n    customer_context: rendered.customerContext || {},\n    attachment_claims: rendered.claimedAttachmentTypes || [],\n    missing_attachments: rendered.missingClaimedAttachmentRequests || [],\n    channel: rendered.messageSource || normalized.messageSource,\n    evidence_resolver_version: rendered.evidenceResolverVersion || '',\n    financial_reconciliation: rendered.financialReconciliation || null,\n  } : {},",
  "  context_snapshot: {\n    ...(rendered ? {\n      customer_context: rendered.customerContext || {},\n      attachment_claims: rendered.claimedAttachmentTypes || [],\n      missing_attachments: rendered.missingClaimedAttachmentRequests || [],\n      channel: rendered.messageSource || normalized.messageSource,\n      evidence_resolver_version: rendered.evidenceResolverVersion || '',\n      financial_reconciliation: rendered.financialReconciliation || null,\n    } : {}),\n    retry_recovery: {\n      version: 'email-agent-retry-recovery-v1',\n      attempt_count: Number(retryClaim.attempt_count || normalized.retryAttemptCount || 0),\n      worker_execution_id: String(retryClaim.worker_execution_id || normalized.retryWorkerExecutionId || $execution.id),\n      automatic_send_allowed: false,\n      human_approval_required: true,\n    },\n  },",
  "Build Failure retry audit",
);

const logSuccess = findNode(coreNodes, "Log Success");
logSuccess.parameters.url =
  "https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/complete_email_agent_retry_message";
logSuccess.parameters.jsonBody = replaceOnce(
  logSuccess.parameters.jsonBody,
  "      safe_fallback_used: Boolean(r.safeFallbackUsed),\n      evidence_card: evidenceCard,",
  "      safe_fallback_used: Boolean(r.safeFallbackUsed),\n      retry_recovery: {\n        version: 'email-agent-retry-recovery-v1',\n        attempt_count: Number(r.retryAttemptCount || 0),\n        worker_execution_id: String(r.retryWorkerExecutionId || $execution.id),\n        automatic_send_allowed: false,\n        human_approval_required: true,\n      },\n      evidence_card: evidenceCard,",
  "Log Success retry audit",
);

const scheduleNode = {
  id: "retry-schedule",
  name: "Retry Schedule",
  type: "n8n-nodes-base.scheduleTrigger",
  typeVersion: 1.3,
  position: [0, 0],
  parameters: {
    rule: {
      interval: [{ field: "cronExpression", expression: "* * * * *" }],
    },
  },
};

const claimNode = {
  id: "claim-due-retry",
  name: "Claim Due Retry",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.4,
  position: [220, 0],
  parameters: {
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    method: "POST",
    url: "https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/claim_due_email_agent_retry_v2",
    sendHeaders: true,
    headerParameters: {
      parameters: [{ name: "Content-Type", value: "application/json" }],
    },
    sendBody: true,
    specifyBody: "json",
    jsonBody:
      "={{ JSON.stringify({ p_worker_execution_id: String($execution.id), p_lease_seconds: 900 }) }}",
    options: {
      timeout: 30000,
      response: {
        response: { fullResponse: true, responseFormat: "json" },
      },
    },
  },
  credentials: SUPABASE_CREDENTIAL,
  retryOnFail: true,
  maxTries: 3,
  waitBetweenTries: 3000,
  onError: "stopWorkflow",
};

const hasDueNode = {
  id: "has-due-retry",
  name: "Has Due Retry?",
  type: "n8n-nodes-base.if",
  typeVersion: 2.3,
  position: [440, 0],
  parameters: {
    options: {},
    conditions: {
      options: {
        version: 2,
        leftValue: "",
        caseSensitive: true,
        typeValidation: "strict",
      },
      combinator: "and",
      conditions: [{
        id: "retry-claimed",
        operator: { type: "boolean", operation: "true", singleValue: true },
        leftValue: "={{ Boolean(($json.body ?? $json).claimed) }}",
        rightValue: "",
      }],
    },
  },
};

const fetchBatchNode = {
  id: "fetch-retry-message-and-drafts",
  name: "Fetch Retry Message and Drafts",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.4,
  position: [660, 0],
  parameters: {
    authentication: "predefinedCredentialType",
    nodeCredentialType: "microsoftOutlookOAuth2Api",
    method: "POST",
    url: "https://graph.microsoft.com/v1.0/$batch",
    sendHeaders: true,
    headerParameters: {
      parameters: [{ name: "Content-Type", value: "application/json" }],
    },
    sendBody: true,
    specifyBody: "json",
    jsonBody: String.raw`={{ JSON.stringify((() => {
  const response = $("Claim Due Retry").first().json || {};
  const claim = response.body ?? response;
  const messageId = encodeURIComponent(String(claim.message_id || ""));
  const internetMessageId = String(claim.internet_message_id || "").trim();
  const internetMessageFilter = "internetMessageId eq '"
    + internetMessageId.replaceAll("'", "''")
    + "'";
  const sourceSelect = [
    "id", "internetMessageId", "conversationId", "subject", "from", "replyTo",
    "toRecipients", "ccRecipients", "receivedDateTime", "sentDateTime",
    "createdDateTime", "lastModifiedDateTime", "body", "bodyPreview",
    "hasAttachments", "internetMessageHeaders",
  ].join(",");
  const draftSelect = [
    "id", "conversationId", "subject", "isDraft", "createdDateTime",
    "lastModifiedDateTime", "bodyPreview",
  ].join(",");
  return {
    requests: [
      {
        id: "source-message",
        method: "GET",
        url: "/me/messages/" + messageId + "?$select=" + encodeURIComponent(sourceSelect),
      },
      {
        id: "source-by-internet-id",
        method: "GET",
        url: "/me/messages?$select="
          + encodeURIComponent(sourceSelect)
          + "&$filter="
          + encodeURIComponent(internetMessageFilter)
          + "&$top=2",
      },
      {
        id: "conversation-drafts",
        method: "GET",
        url: "/me/mailFolders/drafts/messages?$select="
          + encodeURIComponent(draftSelect)
          + "&$top=50&$orderby="
          + encodeURIComponent("lastModifiedDateTime desc"),
      },
    ],
  };
})()) }}`,
    options: {
      timeout: 45000,
      response: {
        response: { fullResponse: true, responseFormat: "json" },
      },
    },
  },
  credentials: OUTLOOK_CREDENTIAL,
  retryOnFail: true,
  maxTries: 3,
  waitBetweenTries: 5000,
  onError: "continueErrorOutput",
};

const shouldRetryNode = {
  id: "should-retry-message",
  name: "Should Retry Message?",
  type: "n8n-nodes-base.if",
  typeVersion: 2.3,
  position: [1100, 0],
  parameters: {
    options: {},
    conditions: {
      options: {
        version: 2,
        leftValue: "",
        caseSensitive: true,
        typeValidation: "strict",
      },
      combinator: "and",
      conditions: [{
        id: "retry-processable",
        operator: { type: "boolean", operation: "true", singleValue: true },
        leftValue: "={{ Boolean($json.shouldProcess) }}",
        rightValue: "",
      }],
    },
  },
};

const finalizeNode = {
  id: "finalize-retry-without-new-draft",
  name: "Finalize Retry Without New Draft",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.4,
  position: [1320, 260],
  parameters: {
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    method: "POST",
    url:
      "https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/finalize_email_agent_retry_without_new_draft",
    sendHeaders: true,
    headerParameters: {
      parameters: [{ name: "Content-Type", value: "application/json" }],
    },
    sendBody: true,
    specifyBody: "json",
    jsonBody: String.raw`={{ JSON.stringify({
  p_request_id: $json.idempotencyKey,
  p_reason: $json.skipReason || "retry_not_processable",
  p_existing_draft_id: $json.existingReplyDraftId || null,
  p_worker_execution_id: String($execution.id),
}) }}`,
    options: {
      timeout: 30000,
      response: {
        response: { fullResponse: true, responseFormat: "json" },
      },
    },
  },
  credentials: SUPABASE_CREDENTIAL,
  retryOnFail: true,
  maxTries: 3,
  waitBetweenTries: 3000,
  onError: "stopWorkflow",
};

const nodes = [
  scheduleNode,
  claimNode,
  hasDueNode,
  fetchBatchNode,
  ...coreNodes,
  shouldRetryNode,
  finalizeNode,
];

const retainedNames = new Set(coreNodes.map((node) => node.name));
const connections = {};

for (const [sourceName, sourceConnections] of Object.entries(source.connections)) {
  if (!retainedNames.has(sourceName)) continue;
  const outputs = (sourceConnections.main || []).map((output) =>
    output.filter((connection) => retainedNames.has(connection.node))
  );
  connections[sourceName] = { main: outputs };
}

connections["Retry Schedule"] = {
  main: [[{ node: "Claim Due Retry", type: "main", index: 0 }]],
};
connections["Claim Due Retry"] = {
  main: [[{ node: "Has Due Retry?", type: "main", index: 0 }]],
};
connections["Has Due Retry?"] = {
  main: [
    [{ node: "Fetch Retry Message and Drafts", type: "main", index: 0 }],
    [],
  ],
};
connections["Fetch Retry Message and Drafts"] = {
  main: [
    [{ node: "Normalize Email", type: "main", index: 0 }],
    [{ node: "Build Failure Record", type: "main", index: 0 }],
  ],
};
connections["Normalize Email"] = {
  main: [
    [{ node: "Should Retry Message?", type: "main", index: 0 }],
    [{ node: "Build Failure Record", type: "main", index: 0 }],
  ],
};
connections["Should Retry Message?"] = {
  main: [
    [{ node: "Fetch Current Message", type: "main", index: 0 }],
    [{ node: "Finalize Retry Without New Draft", type: "main", index: 0 }],
  ],
};
connections["Finalize Retry Without New Draft"] = { main: [[]] };
connections["Log Success"] = {
  main: [[], [{ node: "Build Failure Record", type: "main", index: 0 }]],
};

export const retryWorkflow = {
  name: "AI Email Agent — Retry Recovery v1",
  nodes,
  connections,
  settings: {
    ...source.settings,
    saveDataErrorExecution: "all",
    saveDataSuccessExecution: "all",
    saveManualExecutions: true,
    saveExecutionProgress: true,
    executionTimeout: 300,
    timezone: "Europe/Berlin",
  },
};

export const sourceCoreManifest = {
  source_workflow_id: source.source_workflow_id,
  source_active_version_id: source.source_active_version_id,
  source_version_created_at: source.source_version_created_at,
  retry_workflow_version: "email-agent-retry-recovery-v1",
  core_nodes: coreNodes
    .filter((node) => !["Normalize Email", "Build Failure Record", "Log Success"].includes(node.name))
    .map((node) => ({ name: node.name, sha256: codeHash(node) }))
    .sort((left, right) => left.name.localeCompare(right.name)),
  intentionally_patched_nodes: [
    "Normalize Email",
    "Build Failure Record",
    "Log Success",
  ],
  automatic_send_allowed: false,
  human_approval_required: true,
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(
  join(outputDirectory, "retry-recovery-v1.json"),
  JSON.stringify(retryWorkflow, null, 2) + "\n",
);
await writeFile(
  join(outputDirectory, "source-core-manifest.json"),
  JSON.stringify(sourceCoreManifest, null, 2) + "\n",
);

console.log(
  "Generated email retry recovery workflow with "
  + retryWorkflow.nodes.length
  + " nodes from active source version "
  + source.source_active_version_id
  + ".",
);
