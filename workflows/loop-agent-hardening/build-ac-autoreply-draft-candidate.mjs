import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const backup = resolve(
  here,
  "backups",
  "2026-07-21",
  "nUrqyTSnGE8j9QT8.published-active.pre-draft-loop.json",
);
const output = resolve(
  here,
  "generated",
  "nUrqyTSnGE8j9QT8.ac-autoreply-draft-loop-v2.json",
);

function nodeByName(workflow, name) {
  const node = workflow.nodes.find((entry) => entry.name === name);
  if (!node) throw new Error(`Missing node ${name}`);
  return node;
}

function removeNodes(workflow, names) {
  const removed = new Set(names);
  workflow.nodes = workflow.nodes.filter((node) => !removed.has(node.name));
  for (const name of removed) delete workflow.connections[name];
  for (const connection of Object.values(workflow.connections)) {
    for (const outputs of Object.values(connection)) {
      for (const branch of outputs) {
        if (!Array.isArray(branch)) continue;
        for (let index = branch.length - 1; index >= 0; index -= 1) {
          if (removed.has(branch[index].node)) branch.splice(index, 1);
        }
      }
    }
  }
}

function configureRpc(node, { name, url, body, position }) {
  node.name = name;
  node.type = "n8n-nodes-base.httpRequest";
  node.typeVersion = 4.2;
  node.position = position;
  node.parameters = {
    method: "POST",
    url,
    authentication: "predefinedCredentialType",
    nodeCredentialType: "httpHeaderAuth",
    sendHeaders: true,
    headerParameters: {
      parameters: [{ name: "Content-Type", value: "application/json" }],
    },
    sendBody: true,
    specifyBody: "json",
    jsonBody: body,
    options: {
      response: { response: { responseFormat: "json" } },
      timeout: 15000,
    },
  };
  node.credentials = {
    httpHeaderAuth: {
      id: "NTtNxoBGGzJCQi9u",
      name: "Header Auth account 2 | SUPABASE",
    },
  };
  node.retryOnFail = true;
  node.maxTries = 3;
  node.waitBetweenTries = 2000;
  node.onError = "stopWorkflow";
  delete node.continueOnFail;
}

function makeRouteSwitch(node) {
  node.name = "RouteAutoReplyDraftClaim";
  node.type = "n8n-nodes-base.switch";
  node.typeVersion = 3.2;
  node.position = [1560, 304];
  node.parameters = {
    mode: "rules",
    rules: {
      values: [
        {
          conditions: {
            options: {
              caseSensitive: true,
              leftValue: "",
              typeValidation: "strict",
              version: 2,
            },
            conditions: [
              {
                id: "route-autoreply-draft",
                leftValue: "={{ $json.route }}",
                rightValue: "draft",
                operator: { type: "string", operation: "equals" },
              },
            ],
            combinator: "and",
          },
          renameOutput: true,
          outputKey: "draft",
        },
        {
          conditions: {
            options: {
              caseSensitive: true,
              leftValue: "",
              typeValidation: "strict",
              version: 2,
            },
            conditions: [
              {
                id: "route-autoreply-continue",
                leftValue: "={{ $json.route }}",
                rightValue: "continue",
                operator: { type: "string", operation: "equals" },
              },
            ],
            combinator: "and",
          },
          renameOutput: true,
          outputKey: "continue",
        },
      ],
    },
    options: {
      fallbackOutput: "extra",
      renameFallbackOutput: "stop",
    },
  };
  delete node.credentials;
  delete node.retryOnFail;
  delete node.maxTries;
  delete node.waitBetweenTries;
  delete node.onError;
  delete node.continueOnFail;
}

const workflow = JSON.parse(await readFile(backup, "utf8"));
workflow.name = "NEONTRIP AC Deal AutoReply v2 — DB Draft Loop";
delete workflow.activeVersionId;
delete workflow.versionCreatedAt;
delete workflow.versionName;
delete workflow.createdAt;
delete workflow.updatedAt;
delete workflow.isArchived;
delete workflow.tags;

removeNodes(workflow, [
  "Sticky Note",
  "Sticky Note Pipeline",
  "Sticky Note1",
  "Sticky Note2",
  "Sticky Note3",
  "Lead Scoring",
  "Max 3 Versuche",
  "Cooldown Active?",
  "Set Cooldown",
  "Send RIESENOBJEKTE Email",
]);

const normalize = nodeByName(workflow, "Normalize");
normalize.parameters.jsCode = normalize.parameters.jsCode
  .replace(
    "if (!contactEmail) {",
    "if (!contactEmail || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(contactEmail) || /@(neontrip\\.de|riesenobjekte\\.de|example\\.|test$)/i.test(contactEmail)) {",
  )
  .replace(
    "const dealId = body['deal[id]'] || 'unknown';",
    "const dealId = String(body['deal[id]'] || '').trim();\nif (!dealId) return [{ json: { skip: true, reason: 'no_deal_id' } }];",
  );

const prompt = nodeByName(workflow, "Build AI Prompt");
prompt.parameters.jsCode = prompt.parameters.jsCode.replace(
  "const randomStyle = styleVariants[Math.floor(Math.random() * styleVariants.length)];",
  "const styleSeed = String(item.deal_id || item.contact_id || '0');\nlet styleHash = 0;\nfor (let index = 0; index < styleSeed.length; index += 1) styleHash = (styleHash * 31 + styleSeed.charCodeAt(index)) >>> 0;\nconst randomStyle = styleVariants[styleHash % styleVariants.length];",
);

const claude = nodeByName(workflow, "Claude API");
claude.parameters.jsonBody = claude.parameters.jsonBody.replace(
  '"temperature": 0.9',
  '"temperature": 0.2',
);

const parse = nodeByName(workflow, "Parse AI Response");
const parseBodyStart = parse.parameters.jsCode.indexOf("function parseBody(raw) {");
const parseBodyEnd = parse.parameters.jsCode.indexOf(
  "\nfunction deterministicIndex",
  parseBodyStart,
);
if (parseBodyStart < 0 || parseBodyEnd < 0) {
  throw new Error("Could not locate legacy parseBody function");
}
parse.parameters.jsCode =
  parse.parameters.jsCode.slice(0, parseBodyStart) +
  String.raw`function parseBody(raw) {
  const cleaned = stripFence(raw);
  if (!cleaned) return '';
  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
    if (Object.keys(parsed).some(key => key !== 'body')) return '';
    return typeof parsed.body === 'string' ? parsed.body.trim().slice(0, 1600) : '';
  } catch (error) {
    return '';
  }
}` +
  parse.parameters.jsCode.slice(parseBodyEnd);
parse.parameters.jsCode = parse.parameters.jsCode
  .replace(
    "if (isRiesenobjekte) {",
    "const unsafeGeneratedContent = /https?:\\/\\/|www\\.|[\\w.+-]+@[\\w.-]+\\.[a-z]{2,}|(?:€|eur|euro|rabatt|nachlass|garantiert|garantie|liefertermin|\\b\\d+\\s*%)/i.test(emailBody);\nif (unsafeGeneratedContent) emailBody = '';\n\nif (isRiesenobjekte) {",
  )
  .replace(
    "  ai_success: !isRiesenobjekte && emailBody.length >= 20",
    "  ai_success: !isRiesenobjekte && emailBody.length >= 20,\n  communicationKind: 'activecampaign_autoreply',\n  policyVersion: 'ac-autoreply-human-review-draft-v2',\n  sourceId: String(item.deal_id),\n  automaticSendAllowed: false,\n  humanApprovalRequired: true",
  );

const claim = nodeByName(workflow, "Check Cooldown");
configureRpc(claim, {
  name: "ClaimAutoReplyDraft",
  url: "https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/claim_customer_communication_draft",
  body: "={{ JSON.stringify({ p_communication_kind: 'activecampaign_autoreply', p_source_id: String($('Normalize').item.json.deal_id), p_policy_version: 'ac-autoreply-human-review-draft-v2', p_workflow_execution_id: String($execution.id), p_lease_seconds: 900 }) }}",
  position: [1320, 304],
});

makeRouteSwitch(nodeByName(workflow, "IF Cooldown"));

const stop = nodeByName(workflow, "Exit Cooldown");
stop.name = "StopAutoReplyDraftSafely";
stop.type = "n8n-nodes-base.code";
stop.typeVersion = 2;
stop.position = [1780, 208];
stop.parameters = {
  mode: "runOnceForAllItems",
  jsCode:
    "const reason = String($input.first()?.json?.reason || 'draft_unknown');\nconst allowed = new Set(['active_lease', 'manual_review_required', 'stale_lease_draft_unknown', 'draft_unknown']);\nthrow new Error('Customer draft loop stopped safely: ' + (allowed.has(reason) ? reason : 'draft_unknown') + '. Automatic retry and automatic sending are blocked.');\nreturn [];",
};
delete stop.credentials;
delete stop.retryOnFail;
delete stop.maxTries;
delete stop.waitBetweenTries;
delete stop.onError;
delete stop.continueOnFail;

const draft = nodeByName(workflow, "Send Email");
draft.name = "CreateAutoReplyDraft";
draft.parameters.additionalFields = {
  ...(draft.parameters.additionalFields || {}),
  saveAsDraft: true,
};
draft.retryOnFail = false;
draft.onError = "continueErrorOutput";
delete draft.maxTries;
delete draft.waitBetweenTries;
delete draft.continueOnFail;

configureRpc(nodeByName(workflow, "Log Success"), {
  name: "CompleteAutoReplyDraft",
  url: "https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/complete_customer_communication_draft",
  body: "={{ JSON.stringify({ p_communication_kind: 'activecampaign_autoreply', p_source_id: String($('Normalize').item.json.deal_id), p_claim_token: $('ClaimAutoReplyDraft').item.json.claim_token, p_draft_id: String($json.id || $json.body?.id || $json.messageId || ''), p_workflow_execution_id: String($execution.id) }) }}",
  position: [3860, 340],
});

configureRpc(nodeByName(workflow, "Done"), {
  name: "MarkAutoReplyDraftUnknown",
  url: "https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/mark_customer_communication_draft_unknown",
  body: "={{ JSON.stringify({ p_communication_kind: 'activecampaign_autoreply', p_source_id: String($('Normalize').item.json.deal_id), p_claim_token: $('ClaimAutoReplyDraft').item.json.claim_token, p_workflow_execution_id: String($execution.id), p_error_code: 'outlook_draft_failed' }) }}",
  position: [3860, 500],
});

workflow.connections.Normalize.main[0] = workflow.connections.Normalize.main[0].filter(
  (connection) => connection.node !== "Max 3 Versuche",
);
workflow.connections.Normalize.main[0].unshift({
  node: "Pipeline Check",
  type: "main",
  index: 0,
});
workflow.connections["Not Blacklisted?"].main = [[
  { node: "ClaimAutoReplyDraft", type: "main", index: 0 },
]];
workflow.connections.ClaimAutoReplyDraft = {
  main: [[{ node: "RouteAutoReplyDraftClaim", type: "main", index: 0 }]],
};
workflow.connections.RouteAutoReplyDraftClaim = {
  main: [
    [{ node: "Wait 6 Min", type: "main", index: 0 }],
    [],
    [{ node: "StopAutoReplyDraftSafely", type: "main", index: 0 }],
  ],
};
workflow.connections["RIESENOBJEKTE?"].main = [
  [{ node: "CreateAutoReplyDraft", type: "main", index: 0 }],
  [{ node: "CreateAutoReplyDraft", type: "main", index: 0 }],
];
workflow.connections.CreateAutoReplyDraft = {
  main: [
    [{ node: "CompleteAutoReplyDraft", type: "main", index: 0 }],
    [{ node: "MarkAutoReplyDraftUnknown", type: "main", index: 0 }],
  ],
};
delete workflow.connections["Send Email"];
delete workflow.connections["Check Cooldown"];
delete workflow.connections["IF Cooldown"];
delete workflow.connections["Exit Cooldown"];
delete workflow.connections["Log Success"];
delete workflow.connections.Done;

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(output);
