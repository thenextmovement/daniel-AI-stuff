import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const generated = resolve(root, "generated");
mkdirSync(generated, { recursive: true });
const schedule = (name, minutes) => ({ parameters: { rule: { interval: [{ field: "minutes", minutesInterval: minutes }] } }, id: `${name}-trigger`, name: "Schedule Trigger", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [0, 0] });
const http = (id, name, parameters, position) => ({ parameters, id, name, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position });

const intake = {
  name: "TICKET-053 Undeliverable Offer Intake v1", active: false, settings: { executionOrder: "v1" },
  nodes: [
    schedule("intake", 2),
    { parameters: { resource: "message", operation: "getAll", returnAll: false, limit: 20, filters: { filter: "isRead eq false and (startswith(subject,'Undeliverable:') or startswith(subject,'Unzustellbar:'))" } }, id: "outlook-read", name: "Read NDR Messages", type: "n8n-nodes-base.microsoftOutlook", typeVersion: 2, position: [220, 0] },
    { parameters: { jsCode: `const out=[]; for (const item of $input.all()) { const j=item.json; const text=String(j.body?.content||j.bodyPreview||'').slice(0,12000); const email=(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/i)||[])[0]; const code=(text.match(/(?:550\\s+)?[45]\\.\\d+\\.\\d+/)||[])[0]||null; if (!j.id||!email) continue; out.push({json:{action:'ingest',sourceMessageId:String(j.id),sourceInternetMessageId:j.internetMessageId||null,mailbox:$env.UNDLVR_MAILBOX,receivedAt:j.receivedDateTime,failedEmail:email,diagnosticCode:code,diagnosticText:text,subject:String(j.subject||''),correlationId:crypto.randomUUID()}}); } return out;` }, id: "normalize", name: "Normalize NDR Safely", type: "n8n-nodes-base.code", typeVersion: 2, position: [440, 0] },
    http("ingest", "Ingest Idempotently", { method: "POST", url: "={{$env.OPS_INTERNAL_BASE_URL}}/api/internal/undeliverable-offers", sendHeaders: true, headerParameters: { parameters: [{ name: "Authorization", value: "=Bearer {{$env.OPS_INTERNAL_API_KEY}}" }] }, sendBody: true, contentType: "raw", rawContentType: "application/json", body: "={{JSON.stringify($json)}}", options: { timeout: 30000 } }, [660, 0]),
  ], connections: { "Schedule Trigger": { main: [[{ node: "Read NDR Messages", type: "main", index: 0 }]] }, "Read NDR Messages": { main: [[{ node: "Normalize NDR Safely", type: "main", index: 0 }]] }, "Normalize NDR Safely": { main: [[{ node: "Ingest Idempotently", type: "main", index: 0 }]] } },
};

const executor = {
  name: "TICKET-053 Undeliverable Offer Executor v1", active: false, settings: { executionOrder: "v1" },
  nodes: [
    schedule("executor", 1),
    { parameters: { jsCode: "return [{json:{action:'execute-one',executionId:crypto.randomUUID()}}];" }, id: "execution", name: "Create Execution Identity", type: "n8n-nodes-base.code", typeVersion: 2, position: [220, 0] },
    http("execute", "Execute Through Guarded API", { method: "POST", url: "={{$env.OPS_INTERNAL_BASE_URL}}/api/internal/undeliverable-offers", sendHeaders: true, headerParameters: { parameters: [{ name: "Authorization", value: "=Bearer {{$env.OPS_INTERNAL_API_KEY}}" }] }, sendBody: true, contentType: "raw", rawContentType: "application/json", body: "={{JSON.stringify($json)}}", options: { timeout: 60000 } }, [440, 0]),
  ], connections: { "Schedule Trigger": { main: [[{ node: "Create Execution Identity", type: "main", index: 0 }]] }, "Create Execution Identity": { main: [[{ node: "Execute Through Guarded API", type: "main", index: 0 }]] } },
};

for (const [filename, workflow] of [["undeliverable-offer-intake-v1.json", intake], ["undeliverable-offer-executor-v1.json", executor]]) writeFileSync(resolve(generated, filename), `${JSON.stringify(workflow, null, 2)}\n`);
