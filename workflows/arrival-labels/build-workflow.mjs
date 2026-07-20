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
        jsCode: `const baseUrl = String($env.NEONTRIP_OPS_BASE_URL || '').replace(/\/$/, '');
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

const output = path.resolve("workflows/arrival-labels/generated/dhl-dpd-arrival-dry-run.json");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
process.stdout.write(`${output}\n`);
