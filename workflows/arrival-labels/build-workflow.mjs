import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const cron = process.env.ARRIVAL_LABEL_CRON || "0 7 * * *";
if (!/^[0-9*/?,\-]+\s+[0-9*/?,\-]+\s+[0-9*/?,\-]+\s+[0-9*/?,\-]+\s+[0-9*/?,\-]+$/.test(cron)) {
  throw new Error("ARRIVAL_LABEL_CRON must be a five-field cron expression.");
}

const workflow = {
  name: "NEONTRIP DHL Arrival Labels Dry Run v0.1 (INACTIVE)",
  active: false,
  nodes: [
    {
      id: "safety-notes",
      name: "Safety Notes",
      type: "n8n-nodes-base.stickyNote",
      typeVersion: 1,
      position: [0, 0],
      parameters: {
        width: 760,
        height: 220,
        content: "## DHL Arrival Labels – Dry Run only\n\nDaily read-only orchestration. The tested Ops service owns all matching and idempotency logic. This workflow cannot call EasyDPD and sends `mode=dry_run`, `persist=false`. It remains inactive until Ops review. Timezone: Europe/Berlin. Rollback: deactivate this workflow.",
      },
    },
    {
      id: "daily-schedule",
      name: "Daily Schedule",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.3,
      position: [0, 300],
      parameters: { rule: { interval: [{ field: "cronExpression", expression: cron }] } },
    },
    {
      id: "preflight",
      name: "Dry Run Preflight",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [260, 300],
      onError: "stopWorkflow",
      parameters: {
        mode: "runOnceForAllItems",
        language: "javaScript",
        jsCode: String.raw`const baseUrl = String($env.NEONTRIP_OPS_BASE_URL || '').replace(/\/$/, '');
const token = String($env.ARRIVAL_LABEL_AGENT_API_TOKEN || '');
if (!/^https:\/\//.test(baseUrl)) throw new Error('NEONTRIP_OPS_BASE_URL must use HTTPS');
if (token.length < 24) throw new Error('ARRIVAL_LABEL_AGENT_API_TOKEN is missing or too short');
return [{ json: { url: baseUrl + '/api/internal/arrival-labels/run', mode: 'dry_run', persist: false, triggerType: 'n8n_schedule' } }];`,
      },
    },
    {
      id: "run-dry-run",
      name: "Run Tested Dry Run Service",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [540, 300],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 5000,
      onError: "stopWorkflow",
      parameters: {
        method: "POST",
        url: "={{ $json.url }}",
        sendHeaders: true,
        headerParameters: { parameters: [
          { name: "Authorization", value: "={{ 'Bearer ' + $env.ARRIVAL_LABEL_AGENT_API_TOKEN }}" },
          { name: "Content-Type", value: "application/json" },
        ] },
        sendBody: true,
        contentType: "raw",
        rawContentType: "application/json",
        body: "={{ JSON.stringify({ mode: $json.mode, persist: $json.persist, triggerType: $json.triggerType }) }}",
        options: { timeout: 60000, response: { response: { responseFormat: "json" } } },
      },
    },
  ],
  connections: {
    "Daily Schedule": { main: [[{ node: "Dry Run Preflight", type: "main", index: 0 }]] },
    "Dry Run Preflight": { main: [[{ node: "Run Tested Dry Run Service", type: "main", index: 0 }]] },
  },
  settings: {
    executionOrder: "v1",
    timezone: "Europe/Berlin",
    saveDataErrorExecution: "all",
    saveDataSuccessExecution: "all",
    executionTimeout: 120,
  },
  versionId: "arrival-labels-dry-run-v0-1",
  meta: { templateCredsSetupCompleted: false },
  tags: [],
};

const emailWorkflow = {
  name: "NEONTRIP DHL Arrival Email Dry Run v0.1 (INACTIVE)",
  active: false,
  nodes: [
    {
      id: "email-safety-notes",
      name: "Safety Notes",
      type: "n8n-nodes-base.stickyNote",
      typeVersion: 1,
      position: [0, 0],
      parameters: {
        width: 780,
        height: 220,
        content: "## DHL arrival email trigger – Dry Run only\n\nPolls the existing support Outlook inbox every minute and forwards only allowlisted DHL-domain messages to the tested Ops dry-run service. It cannot call EasyDPD, Shopify mutations or a printer. The separate daily workflow remains the reconciliation path.",
      },
    },
    {
      id: "dhl-outlook-trigger",
      name: "DHL Outlook Trigger",
      type: "n8n-nodes-base.microsoftOutlookTrigger",
      typeVersion: 1,
      position: [0, 300],
      parameters: {
        pollTimes: { item: [{ mode: "everyMinute" }] },
        output: "raw",
        filters: { readStatus: "unread", folderId: "inbox" },
        options: {},
      },
      credentials: {
        microsoftOutlookOAuth2Api: {
          id: "CTEmJD5CjYu9hawu",
          name: "Microsoft Outlook support@neontrip.de",
        },
      },
    },
    {
      id: "validate-dhl-email",
      name: "Validate DHL Email + Config",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [280, 300],
      onError: "stopWorkflow",
      parameters: {
        mode: "runOnceForEachItem",
        language: "javaScript",
        jsCode: String.raw`const email = $json || {};
const address = String(email.from?.emailAddress?.address || '').trim().toLowerCase();
const domain = address.split('@').pop() || '';
const allowed = String($env.DHL_EXPRESS_SENDER_DOMAINS || 'dhl.com,dpdhl.com,dhl.de')
  .split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
const senderAllowed = allowed.some(value => domain === value || domain.endsWith('.' + value));
const searchable = [email.subject, email.bodyPreview, email.body?.content].map(value => String(value || '')).join(' ');
if (!senderAllowed || !/dhl\s*express/i.test(searchable)) return [];
const baseUrl = String($env.NEONTRIP_OPS_BASE_URL || '').replace(/\/$/, '');
const token = String($env.ARRIVAL_LABEL_AGENT_API_TOKEN || '');
if (!/^https:\/\//.test(baseUrl)) throw new Error('NEONTRIP_OPS_BASE_URL must use HTTPS');
if (token.length < 24) throw new Error('ARRIVAL_LABEL_AGENT_API_TOKEN is missing or too short');
return { json: {
  url: baseUrl + '/api/internal/arrival-labels/run',
  mode: 'dry_run',
  persist: false,
  triggerType: 'n8n_email',
  sourceMessageId: String(email.id || '').slice(0, 500),
} };`,
      },
    },
    {
      id: "run-email-dry-run",
      name: "Run Tested Dry Run Service",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [600, 300],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 5000,
      onError: "stopWorkflow",
      parameters: {
        method: "POST",
        url: "={{ $json.url }}",
        sendHeaders: true,
        headerParameters: { parameters: [
          { name: "Authorization", value: "={{ 'Bearer ' + $env.ARRIVAL_LABEL_AGENT_API_TOKEN }}" },
          { name: "Content-Type", value: "application/json" },
        ] },
        sendBody: true,
        contentType: "raw",
        rawContentType: "application/json",
        body: "={{ JSON.stringify({ mode: $json.mode, persist: $json.persist, triggerType: $json.triggerType }) }}",
        options: { timeout: 60000, response: { response: { responseFormat: "json" } } },
      },
    },
  ],
  connections: {
    "DHL Outlook Trigger": { main: [[{ node: "Validate DHL Email + Config", type: "main", index: 0 }]] },
    "Validate DHL Email + Config": { main: [[{ node: "Run Tested Dry Run Service", type: "main", index: 0 }]] },
  },
  settings: {
    executionOrder: "v1",
    timezone: "Europe/Berlin",
    saveDataErrorExecution: "all",
    saveDataSuccessExecution: "all",
    executionTimeout: 120,
  },
  versionId: "arrival-email-dry-run-v0-1",
  meta: { templateCredsSetupCompleted: true },
  tags: [],
};

const output = path.resolve("workflows/arrival-labels/generated/dhl-dpd-arrival-dry-run.json");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
const emailOutput = path.resolve("workflows/arrival-labels/generated/dhl-arrival-email-dry-run.json");
await writeFile(emailOutput, `${JSON.stringify(emailWorkflow, null, 2)}\n`, "utf8");
process.stdout.write(`${output}\n${emailOutput}\n`);
