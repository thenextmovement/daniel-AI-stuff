import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const generated = resolve(here, "generated");
const backupPath = resolve(
  here,
  "backups",
  "2026-07-21",
  "9FoJMH6OUdsi36FB.published-active.pre-split.json",
);

const trelloCredential = {
  trelloApi: { id: "96DRckmFxj423JUR", name: "Trello account" },
};
const supabaseCredential = {
  httpHeaderAuth: {
    id: "NTtNxoBGGzJCQi9u",
    name: "Header Auth account 2 | SUPABASE",
  },
};

const normalizeEventCode = String.raw`const action = $json.action || {};
const data = action.data || {};
const card = data.card || {};
const TARGET_LISTS = new Set([
  '6a18389f5e45294188451924',
  '69ea22fe1431c2e7d7e7b3c4',
]);
const SENT_LABELS = new Set([
  '69ea8cb44dafe69b2a31350c',
  '63d13d82858ce1c1b71045c0',
]);
const actionId = String(action.id || '').trim();
const cardId = String(card.id || '').trim();
const actionType = String(action.type || '').trim();
const listAfterId = String(data.listAfter?.id || '').trim();
const listBeforeId = String(data.listBefore?.id || '').trim();
const labelId = String(data.label?.id || '').trim();
const movedToSource = actionType === 'updateCard' && TARGET_LISTS.has(listAfterId) && listBeforeId !== listAfterId;
const sentLabelRemoved = actionType === 'removeLabelFromCard' && SENT_LABELS.has(labelId);
if (!movedToSource && !sentLabelRemoved) return [];
if (!/^[0-9a-f]{24}$/i.test(actionId) || !/^[0-9a-f]{24}$/i.test(cardId)) {
  throw new Error('trello_preview_event_identity_invalid');
}
return [{ json: {
  trello_action_id: actionId,
  trello_card_id: cardId,
  event_kind: movedToSource ? 'moved_to_preview_source' : 'sent_label_removed_for_resend',
  expected_source_list_id: movedToSource ? listAfterId : null,
  removed_label_id: sentLabelRemoved ? labelId : null,
  event_at: action.date || new Date().toISOString(),
} }];`;

const buildJobCode = String.raw`const event = $('Normalize Relevant Preview Event').item.json;
const card = $json || {};
const SOURCE_LISTS = new Set([
  '6a18389f5e45294188451924',
  '69ea22fe1431c2e7d7e7b3c4',
]);
const SENT_LABELS = new Set([
  '69ea8cb44dafe69b2a31350c',
  '63d13d82858ce1c1b71045c0',
]);
const cardId = String(card.id || '').trim();
const sourceListId = String(card.idList || '').trim();
const labels = Array.isArray(card.idLabels) ? card.idLabels.map(String) : [];
if (cardId !== event.trello_card_id) throw new Error('trello_preview_card_identity_mismatch');
if (!SOURCE_LISTS.has(sourceListId)) return [];
if (labels.some((id) => SENT_LABELS.has(id))) return [];
const desc = String(card.desc || '');
const match = desc.match(/(?:request[_ -]?id|nerdyforms?[_ -]?id|anfrage[_ -]?id)\s*[:#-]?\s*([a-zA-Z0-9_-]+)/i);
const requestId = match ? String(match[1]).trim() : '';
const cycleKey = 'trello_event_' + event.trello_action_id;
const job = {
  trello_card_id: cardId,
  trello_card_url: String(card.shortUrl || card.url || ('https://trello.com/c/' + cardId)),
  request_id: requestId || null,
  card_name: String(card.name || '').slice(0, 500),
  source_list_id: sourceListId,
  priority: event.event_kind === 'sent_label_removed_for_resend' ? 120 : 100,
  max_attempts: 3,
  delivery_cycle_key: cycleKey,
  idempotency_key: 'preview-delivery:' + (requestId || 'unknown') + ':' + cardId + ':' + cycleKey + ':v3',
  metadata: {
    source: 'trello_preview_event_intake_v1',
    trello_action_id: event.trello_action_id,
    trello_event_kind: event.event_kind,
    trello_event_at: event.event_at,
    trello_pos: card.pos || null,
    trello_date_last_activity: card.dateLastActivity || null,
    request_id_source: requestId ? 'trello_description' : 'worker_card_detail_fallback',
  },
};
return [{ json: { event, job } }];`;

const assertEnqueueCode = String.raw`const result = $json || {};
const submitted = $('Build Preview Queue Event').item.json;
const accepted = Number(result.touched || 0) === 1 ||
  Number(result.terminal_conflict_count || 0) === 1 ||
  Number(result.skipped_active || 0) === 1;
if (result.ok !== true || Number(result.job_count || 0) !== 1 || !accepted) {
  throw new Error('preview_delivery_event_enqueue_not_durable');
}
return [{ json: {
  ok: true,
  trello_action_id: submitted.event.trello_action_id,
  trello_card_id: submitted.job.trello_card_id,
  idempotency_key: submitted.job.idempotency_key,
  durable_outcome: Number(result.touched || 0) === 1 ? 'queued_or_updated' : 'already_terminal_or_active',
} }];`;

const intake = {
  name: "NEONTRIP Preview Delivery Intake v1 — Trello Event to DB",
  active: false,
  nodes: [
    {
      id: "preview-event-trigger",
      name: "Trello Preview Board Events",
      type: "n8n-nodes-base.trelloTrigger",
      typeVersion: 1,
      position: [0, 300],
      parameters: { id: "63d10c34105771f01ccf4296" },
      credentials: trelloCredential,
    },
    {
      id: "normalize-preview-event",
      name: "Normalize Relevant Preview Event",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [240, 300],
      parameters: { jsCode: normalizeEventCode },
    },
    {
      id: "get-current-preview-card",
      name: "Get Current Preview Card",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [480, 300],
      parameters: {
        url: "=https://api.trello.com/1/cards/{{ $json.trello_card_id }}?fields=id,name,desc,idLabels,shortUrl,url,pos,dateLastActivity,idList",
        authentication: "predefinedCredentialType",
        nodeCredentialType: "trelloApi",
        options: { timeout: 15000 },
      },
      credentials: trelloCredential,
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 2000,
      onError: "stopWorkflow",
    },
    {
      id: "build-preview-queue-event",
      name: "Build Preview Queue Event",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [720, 300],
      parameters: { jsCode: buildJobCode },
    },
    {
      id: "enqueue-preview-event",
      name: "Enqueue Preview Delivery Event",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [960, 300],
      parameters: {
        method: "POST",
        url: "https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/enqueue_preview_delivery_jobs",
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        sendHeaders: true,
        headerParameters: {
          parameters: [{ name: "Content-Type", value: "application/json" }],
        },
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ JSON.stringify({ p_jobs: [$json.job], p_video_sent_card_ids: [] }) }}",
        options: {
          response: { response: { responseFormat: "json" } },
          timeout: 15000,
        },
      },
      credentials: supabaseCredential,
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 2000,
      onError: "stopWorkflow",
    },
    {
      id: "assert-preview-enqueue",
      name: "Assert Durable Preview Enqueue",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1200, 300],
      parameters: { jsCode: assertEnqueueCode },
    },
  ],
  connections: {
    "Trello Preview Board Events": {
      main: [[{ node: "Normalize Relevant Preview Event", type: "main", index: 0 }]],
    },
    "Normalize Relevant Preview Event": {
      main: [[{ node: "Get Current Preview Card", type: "main", index: 0 }]],
    },
    "Get Current Preview Card": {
      main: [[{ node: "Build Preview Queue Event", type: "main", index: 0 }]],
    },
    "Build Preview Queue Event": {
      main: [[{ node: "Enqueue Preview Delivery Event", type: "main", index: 0 }]],
    },
    "Enqueue Preview Delivery Event": {
      main: [[{ node: "Assert Durable Preview Enqueue", type: "main", index: 0 }]],
    },
  },
  settings: {
    executionOrder: "v1",
    timezone: "Europe/Berlin",
    saveDataErrorExecution: "all",
    saveDataSuccessExecution: "all",
    callerPolicy: "workflowsFromSameOwner",
    availableInMCP: false,
    errorWorkflow: "M4uG1HAtN9Zggxww",
  },
};

const source = JSON.parse(await readFile(backupPath, "utf8"));
if (source.activeVersionId !== "bbb0cb8f-aae5-4f45-bab7-dc499b18722c") {
  throw new Error("unexpected preview monolith backup version");
}

const worker = structuredClone(source);
worker.name = "NEONTRIP Preview Delivery Worker v2 — DB Claim Loop";
worker.active = false;
worker.settings = {
  ...worker.settings,
  errorWorkflow: "M4uG1HAtN9Zggxww",
  callerPolicy: "workflowsFromSameOwner",
  availableInMCP: false,
};
delete worker.settings.binaryMode;
delete worker.settings.timeSavedMode;

worker.connections["Schedule Trigger"] = {
  main: [[{ node: "Queue Worker Gate", type: "main", index: 0 }]],
};

const removeBeforeReachability = new Set([
  "Search Cards",
  "Prepare Queue Dispatch",
  "Supabase: Enqueue Preview Delivery Jobs",
]);
for (const name of removeBeforeReachability) delete worker.connections[name];
for (const connection of Object.values(worker.connections)) {
  for (const outputs of connection.main || []) {
    if (!Array.isArray(outputs)) continue;
    for (let index = outputs.length - 1; index >= 0; index -= 1) {
      if (removeBeforeReachability.has(outputs[index]?.node)) outputs.splice(index, 1);
    }
  }
}

const reachable = new Set();
const queue = ["Schedule Trigger"];
while (queue.length > 0) {
  const name = queue.shift();
  if (reachable.has(name)) continue;
  reachable.add(name);
  for (const outputs of worker.connections[name]?.main || []) {
    for (const target of outputs || []) {
      if (target?.node && !reachable.has(target.node)) queue.push(target.node);
    }
  }
}
worker.nodes = worker.nodes.filter((node) => reachable.has(node.name));
for (const name of Object.keys(worker.connections)) {
  if (!reachable.has(name)) delete worker.connections[name];
}
for (const connection of Object.values(worker.connections)) {
  for (const outputs of connection.main || []) {
    if (!Array.isArray(outputs)) continue;
    for (let index = outputs.length - 1; index >= 0; index -= 1) {
      if (!reachable.has(outputs[index]?.node)) outputs.splice(index, 1);
    }
  }
}

const gate = worker.nodes.find((node) => node.name === "Queue Worker Gate");
if (!gate) throw new Error("worker gate missing");
gate.parameters.jsCode = String.raw`const staticData = $getWorkflowStaticData('global');
const now = new Date();
const MAX_GROK_PER_DAY = 80;
const MAX_GROK_PER_HOUR = 20;
const rateLimitedUntil = staticData.grokRateLimitedUntil ? new Date(staticData.grokRateLimitedUntil) : null;
if (rateLimitedUntil && rateLimitedUntil > now) return [];
if (rateLimitedUntil && rateLimitedUntil <= now) staticData.grokRateLimitedUntil = null;
const dayKey = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
const hourKey = dayKey + 'T' + now.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false });
if (staticData.grokDayKey !== dayKey) { staticData.grokDayKey = dayKey; staticData.grokDayCount = 0; }
if (staticData.grokHourKey !== hourKey) { staticData.grokHourKey = hourKey; staticData.grokHourCount = 0; }
if ((staticData.grokDayCount || 0) >= MAX_GROK_PER_DAY) return [];
if ((staticData.grokHourCount || 0) >= MAX_GROK_PER_HOUR) return [];
return $input.all();`;

const validatedErrorOutputNodes = new Set([
  "Submit to Runway",
  "Check Runway Status",
  "Download Video",
  "Lookup Latest Preview Quote",
  "Supabase: Upsert Preview Card Alias",
]);
for (const node of worker.nodes) {
  if (node.continueOnFail !== true) continue;
  delete node.continueOnFail;
  node.onError = validatedErrorOutputNodes.has(node.name)
    ? "continueRegularOutput"
    : "stopWorkflow";
}

for (const key of [
  "id",
  "versionId",
  "activeVersionId",
  "versionCounter",
  "createdAt",
  "updatedAt",
  "staticData",
  "shared",
  "tags",
  "meta",
  "pinData",
  "triggerCount",
  "sourceWorkflowId",
]) delete worker[key];

await mkdir(generated, { recursive: true });
await writeFile(
  resolve(generated, "preview-delivery-event-intake-v1.json"),
  `${JSON.stringify(intake, null, 2)}\n`,
);
await writeFile(
  resolve(generated, "preview-delivery-worker-v2-first-split.json"),
  `${JSON.stringify(worker, null, 2)}\n`,
);

console.log(JSON.stringify({ intakeNodes: intake.nodes.length, workerNodes: worker.nodes.length }));
