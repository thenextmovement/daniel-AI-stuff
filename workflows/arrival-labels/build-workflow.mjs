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
        content: "## DHL Arrival Labels – guarded shadow run\n\nThe tested Ops service owns matching and idempotency. This workflow cannot call EasyDPD or a printer and sends `mode=dry_run`, `persist=true` to store audit decisions and deduplicated internal-review outbox entries. It remains inactive until Ops review. Timezone: Europe/Berlin. Rollback: deactivate this workflow.",
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
return [{ json: { url: baseUrl + '/api/internal/arrival-labels/run', mode: 'dry_run', persist: true, triggerType: 'n8n_schedule' } }];`,
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
        content: "## DHL arrival email trigger – guarded shadow run\n\nPolls the existing support Outlook inbox every minute and forwards only allowlisted DHL-domain messages to the tested Ops dry-run service. It stores audit decisions and deduplicated internal-review outbox entries, but cannot call EasyDPD, Shopify mutations or a printer. The separate daily workflow remains the reconciliation path.",
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
  persist: true,
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

const reviewWorkflow = {
  name: "NEONTRIP Arrival Label Review Mail Outbox v0.1 (INACTIVE)",
  active: false,
  nodes: [
    {
      id: "review-safety-notes",
      name: "Safety Notes",
      type: "n8n-nodes-base.stickyNote",
      typeVersion: 1,
      position: [0, 0],
      parameters: {
        width: 980,
        height: 220,
        content: "## Internal review-mail outbox\n\nSends only deterministic plain-text notifications from the audited Postgres outbox to the fixed recipient info@neontrip.de. The item is marked dispatching before Outlook send. Unknown send outcomes become manual review and are never automatically resent. No carrier purchase, Shopify write or print is possible. Rollback: deactivate this workflow.",
      },
    },
    {
      id: "review-schedule",
      name: "Review Outbox Schedule",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.3,
      position: [0, 300],
      parameters: { rule: { interval: [{ field: "cronExpression", expression: "* * * * *" }] } },
    },
    {
      id: "review-preflight",
      name: "Validate Review Worker Config",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [240, 300],
      onError: "stopWorkflow",
      parameters: {
        mode: "runOnceForAllItems",
        language: "javaScript",
        jsCode: String.raw`const baseUrl = String($env.NEONTRIP_OPS_BASE_URL || '').replace(/\/$/, '');
const token = String($env.ARRIVAL_LABEL_AGENT_API_TOKEN || '');
const workerId = 'n8n-review-mail:' + String($workflow.id || '').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 64);
if (!/^https:\/\//.test(baseUrl)) throw new Error('NEONTRIP_OPS_BASE_URL must use HTTPS');
if (token.length < 24) throw new Error('ARRIVAL_LABEL_AGENT_API_TOKEN is missing or too short');
if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$/.test(workerId)) throw new Error('review worker id is invalid');
return [{ json: { baseUrl, workerId } }];`,
      },
    },
    {
      id: "claim-review",
      name: "Claim Review Notification",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [500, 300],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 5000,
      onError: "stopWorkflow",
      parameters: {
        method: "POST",
        url: "={{ $node[\"Validate Review Worker Config\"].json.baseUrl + '/api/internal/arrival-labels/review-notifications/claim' }}",
        sendHeaders: true,
        headerParameters: { parameters: [
          { name: "Authorization", value: "={{ 'Bearer ' + $env.ARRIVAL_LABEL_AGENT_API_TOKEN }}" },
          { name: "X-Neontrip-Review-Worker", value: "={{ $node[\"Validate Review Worker Config\"].json.workerId }}" },
          { name: "Content-Type", value: "application/json" },
        ] },
        sendBody: true,
        contentType: "raw",
        rawContentType: "application/json",
        body: "={{ JSON.stringify({ workerId: $node[\"Validate Review Worker Config\"].json.workerId }) }}",
        options: { timeout: 30000, response: { response: { responseFormat: "json" } } },
      },
    },
    {
      id: "has-review",
      name: "Notification Available?",
      type: "n8n-nodes-base.if",
      typeVersion: 2.3,
      position: [760, 300],
      parameters: {
        options: {},
        conditions: {
          options: { version: 2, leftValue: "", caseSensitive: true, typeValidation: "strict" },
          combinator: "and",
          conditions: [{
            id: "notification-exists",
            operator: { type: "boolean", operation: "true", singleValue: true },
            leftValue: "={{ $json.hasNotification }}",
            rightValue: "",
          }],
        },
      },
    },
    {
      id: "mark-dispatching",
      name: "Mark Review Dispatching",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [1020, 220],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 3000,
      onError: "stopWorkflow",
      parameters: {
        method: "POST",
        url: "={{ $node[\"Validate Review Worker Config\"].json.baseUrl + '/api/internal/arrival-labels/review-notifications/' + $node[\"Claim Review Notification\"].json.notification.id + '/result' }}",
        sendHeaders: true,
        headerParameters: { parameters: [
          { name: "Authorization", value: "={{ 'Bearer ' + $env.ARRIVAL_LABEL_AGENT_API_TOKEN }}" },
          { name: "X-Neontrip-Review-Worker", value: "={{ $node[\"Validate Review Worker Config\"].json.workerId }}" },
          { name: "Content-Type", value: "application/json" },
        ] },
        sendBody: true,
        contentType: "raw",
        rawContentType: "application/json",
        body: "={{ JSON.stringify({ workerId: $node[\"Validate Review Worker Config\"].json.workerId, result: 'dispatching' }) }}",
        options: { timeout: 30000, response: { response: { responseFormat: "json" } } },
      },
    },
    {
      id: "send-review-mail",
      name: "Send Internal Review Mail",
      type: "n8n-nodes-base.microsoftOutlook",
      typeVersion: 2,
      position: [1280, 220],
      onError: "stopWorkflow",
      parameters: {
        resource: "message",
        operation: "send",
        toRecipients: "={{ $node[\"Claim Review Notification\"].json.notification.to }}",
        subject: "={{ $node[\"Claim Review Notification\"].json.notification.subject }}",
        bodyContent: "={{ $node[\"Claim Review Notification\"].json.notification.bodyText }}",
        additionalFields: { bodyContentType: "Text" },
      },
      credentials: {
        microsoftOutlookOAuth2Api: {
          id: "CTEmJD5CjYu9hawu",
          name: "Microsoft Outlook support@neontrip.de",
        },
      },
    },
    {
      id: "validate-provider-id",
      name: "Validate Outlook Dispatch",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1540, 220],
      onError: "stopWorkflow",
      parameters: {
        mode: "runOnceForEachItem",
        language: "javaScript",
        jsCode: String.raw`if ($json.success !== true) {
  throw new Error('Outlook did not confirm send success; notification remains dispatching for manual reconciliation');
}
const notificationId = String($node["Claim Review Notification"].json.notification.id || '');
const dispatchReceiptId = 'n8n:' + String($execution.id || '') + ':' + notificationId;
if (dispatchReceiptId.length > 500 || /[\u0000-\u001f\u007f]/.test(dispatchReceiptId)) throw new Error('invalid dispatch receipt');
return { json: { dispatchReceiptId } };`,
      },
    },
    {
      id: "mark-sent",
      name: "Mark Review Sent",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [1800, 220],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 3000,
      onError: "stopWorkflow",
      parameters: {
        method: "POST",
        url: "={{ $node[\"Validate Review Worker Config\"].json.baseUrl + '/api/internal/arrival-labels/review-notifications/' + $node[\"Claim Review Notification\"].json.notification.id + '/result' }}",
        sendHeaders: true,
        headerParameters: { parameters: [
          { name: "Authorization", value: "={{ 'Bearer ' + $env.ARRIVAL_LABEL_AGENT_API_TOKEN }}" },
          { name: "X-Neontrip-Review-Worker", value: "={{ $node[\"Validate Review Worker Config\"].json.workerId }}" },
          { name: "Content-Type", value: "application/json" },
        ] },
        sendBody: true,
        contentType: "raw",
        rawContentType: "application/json",
        body: "={{ JSON.stringify({ workerId: $node[\"Validate Review Worker Config\"].json.workerId, result: 'sent', dispatchReceiptId: $json.dispatchReceiptId }) }}",
        options: { timeout: 30000, response: { response: { responseFormat: "json" } } },
      },
    },
  ],
  connections: {
    "Review Outbox Schedule": { main: [[{ node: "Validate Review Worker Config", type: "main", index: 0 }]] },
    "Validate Review Worker Config": { main: [[{ node: "Claim Review Notification", type: "main", index: 0 }]] },
    "Claim Review Notification": { main: [[{ node: "Notification Available?", type: "main", index: 0 }]] },
    "Notification Available?": { main: [[{ node: "Mark Review Dispatching", type: "main", index: 0 }], []] },
    "Mark Review Dispatching": { main: [[{ node: "Send Internal Review Mail", type: "main", index: 0 }]] },
    "Send Internal Review Mail": { main: [[{ node: "Validate Outlook Dispatch", type: "main", index: 0 }]] },
    "Validate Outlook Dispatch": { main: [[{ node: "Mark Review Sent", type: "main", index: 0 }]] },
  },
  settings: {
    executionOrder: "v1",
    timezone: "Europe/Berlin",
    saveDataErrorExecution: "all",
    saveDataSuccessExecution: "all",
    executionTimeout: 120,
    errorWorkflow: "ArT3LN25Mb1PAuBE",
  },
  versionId: "arrival-review-mail-outbox-v0-1",
  meta: { templateCredsSetupCompleted: true },
  tags: [],
};

const outlookArchiveWorkflow = {
  name: "NEONTRIP Archive DHL Mail After Label Print v0.3 (INACTIVE)",
  active: false,
  nodes: [
    {
      id: "archive-safety-notes",
      name: "Safety Notes",
      type: "n8n-nodes-base.stickyNote",
      typeVersion: 1,
      position: [0, 0],
      parameters: {
        width: 940,
        height: 220,
        content: "## Exact DHL Outlook archive outbox\n\nRuns only after Postgres has recorded the shipping label as printed. The Ops service claims one exact Outlook message ID, revalidates the allowlisted DHL sender plus full tracking number, marks dispatching, then performs one Graph move to Archive. Cloudflare Access and the Ops bearer token are both required. Pre-dispatch errors may retry; any uncertainty after move dispatch becomes manual review and never auto-retries. No carrier purchase, Shopify write or print is possible. Rollback: deactivate this workflow and disable the database archive setting.",
      },
    },
    {
      id: "archive-schedule",
      name: "Archive Outbox Schedule",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.3,
      position: [0, 300],
      parameters: { rule: { interval: [{ field: "cronExpression", expression: "* * * * *" }] } },
    },
    {
      id: "archive-preflight",
      name: "Validate Archive Worker Config",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [260, 300],
      onError: "stopWorkflow",
      parameters: {
        mode: "runOnceForAllItems",
        language: "javaScript",
        jsCode: String.raw`const baseUrl = 'https://ops.neontrip.de';
const workflowPart = String($workflow.id || '').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 32);
const executionPart = String($execution.id || '').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 32);
const workerId = ('n8n-outlook-archive:' + workflowPart + ':' + executionPart).slice(0, 96);
if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$/.test(workerId)) throw new Error('Outlook archive worker id is invalid');
return [{ json: { baseUrl, workerId } }];`,
      },
    },
    {
      id: "process-archive",
      name: "Process One Exact DHL Archive",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [560, 300],
      onError: "stopWorkflow",
      parameters: {
        method: "POST",
        url: "={{ $json.baseUrl + '/api/internal/arrival-labels/outlook-archives/process' }}",
        sendHeaders: true,
        headerParameters: { parameters: [
          { name: "Authorization", value: "={{ 'Bearer ' + $env.ARRIVAL_LABEL_AGENT_API_TOKEN }}" },
          { name: "CF-Access-Client-Id", value: "={{ $env.ARRIVAL_LABEL_CF_ACCESS_CLIENT_ID }}" },
          { name: "CF-Access-Client-Secret", value: "={{ $env.ARRIVAL_LABEL_CF_ACCESS_CLIENT_SECRET }}" },
          { name: "X-Neontrip-Outlook-Archive-Worker", value: "={{ $json.workerId }}" },
          { name: "Content-Type", value: "application/json" },
        ] },
        sendBody: true,
        contentType: "raw",
        rawContentType: "application/json",
        body: "={{ JSON.stringify({ workerId: $json.workerId }) }}",
        options: { timeout: 60000, response: { response: { responseFormat: "json" } } },
      },
    },
  ],
  connections: {
    "Archive Outbox Schedule": { main: [[{ node: "Validate Archive Worker Config", type: "main", index: 0 }]] },
    "Validate Archive Worker Config": { main: [[{ node: "Process One Exact DHL Archive", type: "main", index: 0 }]] },
  },
  settings: {
    executionOrder: "v1",
    timezone: "Europe/Berlin",
    saveDataErrorExecution: "all",
    saveDataSuccessExecution: "all",
    executionTimeout: 90,
    errorWorkflow: "ArT3LN25Mb1PAuBE",
  },
  versionId: "arrival-outlook-archive-after-print-v0-3",
  meta: { templateCredsSetupCompleted: false },
  tags: [],
};

const output = path.resolve("workflows/arrival-labels/generated/dhl-dpd-arrival-dry-run.json");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
const emailOutput = path.resolve("workflows/arrival-labels/generated/dhl-arrival-email-dry-run.json");
await writeFile(emailOutput, `${JSON.stringify(emailWorkflow, null, 2)}\n`, "utf8");
const reviewOutput = path.resolve("workflows/arrival-labels/generated/arrival-label-review-mail-outbox.json");
await writeFile(reviewOutput, `${JSON.stringify(reviewWorkflow, null, 2)}\n`, "utf8");
const outlookArchiveOutput = path.resolve("workflows/arrival-labels/generated/arrival-label-outlook-archive-after-print.json");
await writeFile(outlookArchiveOutput, `${JSON.stringify(outlookArchiveWorkflow, null, 2)}\n`, "utf8");
process.stdout.write(`${output}\n${emailOutput}\n${reviewOutput}\n${outlookArchiveOutput}\n`);
