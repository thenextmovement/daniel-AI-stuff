import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const intake = JSON.parse(await readFile(resolve(here, "generated", "preview-delivery-event-intake-v1.json"), "utf8"));
const worker = JSON.parse(await readFile(resolve(here, "generated", "preview-delivery-worker-v2-first-split.json"), "utf8"));

function node(workflow, name) {
  const found = workflow.nodes.find((entry) => entry.name === name);
  assert.ok(found, `missing node ${name}`);
  return found;
}
function isTrigger(entry) {
  return entry.type.toLowerCase().endsWith("trigger") || entry.type === "n8n-nodes-base.webhook";
}
function assertGraph(workflow) {
  const names = new Set(workflow.nodes.map((entry) => entry.name));
  assert.equal(names.size, workflow.nodes.length);
  for (const [source, connection] of Object.entries(workflow.connections)) {
    assert.ok(names.has(source), `missing connection source ${source}`);
    for (const outputs of Object.values(connection)) {
      for (const branch of outputs) {
        for (const target of branch || []) assert.ok(names.has(target.node), `missing target ${target.node}`);
      }
    }
  }
  for (const entry of workflow.nodes) {
    assert.notEqual(entry.continueOnFail, true);
    if (entry.type === "n8n-nodes-base.code") {
      assert.doesNotThrow(() => new vm.Script(`(async () => {\n${entry.parameters.jsCode}\n})()`), `invalid code in ${entry.name}`);
    }
  }
}

assertGraph(intake);
assertGraph(worker);
assert.equal(intake.nodes.length, 6);
assert.equal(intake.nodes.filter(isTrigger).length, 1);
assert.equal(worker.nodes.length, 79);
assert.equal(worker.nodes.filter(isTrigger).length, 1);
assert.equal(worker.connections["Schedule Trigger"].main[0][0].node, "Queue Worker Gate");
assert.equal(worker.nodes.some((entry) => entry.name === "Search Cards"), false);
assert.equal(worker.nodes.some((entry) => entry.name === "Prepare Queue Dispatch"), false);
assert.equal(worker.nodes.some((entry) => entry.name === "Supabase: Enqueue Preview Delivery Jobs"), false);
assert.equal(worker.nodes.some((entry) => entry.name === "Send Preview Delivery"), false);
assert.equal(worker.nodes.some((entry) => entry.name === "WhatsApp senden"), false);
assert.equal(worker.nodes.some((entry) => entry.name === "Build Preview Delivery Payload"), false);

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const normalize = new AsyncFunction("$json", node(intake, "Normalize Relevant Preview Event").parameters.jsCode);
const moved = await normalize({
  action: {
    id: "6a0000000000000000000001",
    type: "updateCard",
    date: "2026-07-21T12:00:00.000Z",
    data: {
      card: { id: "6a0000000000000000000002" },
      listBefore: { id: "6a0000000000000000000003" },
      listAfter: { id: "6a18389f5e45294188451924" },
    },
  },
});
assert.equal(moved[0].json.event_kind, "moved_to_preview_source");

const removed = await normalize({
  action: {
    id: "6a0000000000000000000004",
    type: "removeLabelFromCard",
    data: {
      card: { id: "6a0000000000000000000002" },
      label: { id: "69ea8cb44dafe69b2a31350c" },
    },
  },
});
assert.equal(removed[0].json.event_kind, "sent_label_removed_for_resend");
assert.deepEqual(await normalize({ action: { id: "6a0000000000000000000005", type: "commentCard", data: { card: { id: "6a0000000000000000000002" } } } }), []);

const build = new AsyncFunction("$json", "$", node(intake, "Build Preview Queue Event").parameters.jsCode);
const lookup = (name) => {
  assert.equal(name, "Normalize Relevant Preview Event");
  return { item: moved[0] };
};
const built = await build({
  id: "6a0000000000000000000002",
  idList: "6a18389f5e45294188451924",
  idLabels: [],
  name: "Synthetic preview",
  desc: "Request-ID: 11111111-1111-4111-8111-111111111111",
  shortUrl: "https://trello.com/c/synthetic",
  pos: 1234,
  dateLastActivity: "2026-07-21T12:00:00.000Z",
}, lookup);
assert.equal(built[0].json.job.request_id, "11111111-1111-4111-8111-111111111111");
assert.match(built[0].json.job.idempotency_key, /trello_event_6a0000000000000000000001:v3$/);
assert.deepEqual(await build({
  id: "6a0000000000000000000002",
  idList: "6a18389f5e45294188451924",
  idLabels: ["63d13d82858ce1c1b71045c0"],
}, lookup), []);
assert.deepEqual(await build({
  id: "6a0000000000000000000002",
  idList: "6a0000000000000000000099",
  idLabels: [],
}, lookup), []);

const assertEnqueue = new AsyncFunction("$json", "$", node(intake, "Assert Durable Preview Enqueue").parameters.jsCode);
const builtLookup = (name) => {
  assert.equal(name, "Build Preview Queue Event");
  return { item: built[0] };
};
const durable = await assertEnqueue({ ok: true, job_count: 1, touched: 1 }, builtLookup);
assert.equal(durable[0].json.durable_outcome, "queued_or_updated");
await assert.rejects(() => assertEnqueue({ ok: true, job_count: 1, touched: 0 }, builtLookup), /not_durable/);

const serialized = JSON.stringify(intake);
assert.doesNotMatch(serialized, /langchain|agent|microsoftOutlook|whatsAble/i);
assert.match(serialized, /enqueue_preview_delivery_jobs/);

console.log("Preview delivery split candidate tests passed");

