import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const generatedDirectory = resolve(here, "generated");

async function load(file) {
  return JSON.parse(await readFile(resolve(generatedDirectory, file), "utf8"));
}

function nodeByName(workflow, name) {
  const node = workflow.nodes.find((entry) => entry.name === name);
  assert.ok(node, `missing node ${name}`);
  return node;
}

function compileCodeNodes(workflow) {
  for (const node of workflow.nodes) {
    if (node.type !== "n8n-nodes-base.code") continue;
    assert.doesNotThrow(
      () => new vm.Script(`(async () => {\n${node.parameters.jsCode}\n})()`),
      `invalid JavaScript in ${workflow.id}/${node.name}`,
    );
  }
}

const gemini = await load(
  "T4mdDxLquLMJ6FMl.gemini-cleanup-credential-hotfix-v1.2.1.json",
);
const supplierSync = await load(
  "WlSmT7zlLcR4TlUG.supplier-tag-sync-single-attempt-v0.2.json",
);

compileCodeNodes(gemini);
compileCodeNodes(supplierSync);

const cleanup = nodeByName(gemini, "Remove Processing Label - Review End");
const reference = nodeByName(gemini, "Remove Processing Label - Success");
assert.deepEqual(cleanup.credentials, reference.credentials);
assert.equal(cleanup.typeVersion, reference.typeVersion);
assert.notEqual(cleanup.retryOnFail, true);

const sync = nodeByName(supplierSync, "Ops: Sync Shopify Supplier Tags");
assert.notEqual(sync.retryOnFail, true);
assert.equal(sync.maxTries, undefined);
assert.equal(sync.waitBetweenTries, undefined);
assert.equal(sync.parameters.options.timeout, 60000);
assert.equal(sync.parameters.options.allowUnauthorizedCerts, undefined);
assert.match(supplierSync.name, /single attempt/);

for (const workflow of [gemini, supplierSync]) {
  assert.equal(
    workflow.nodes.filter((node) => node.type.toLowerCase().includes("trigger"))
      .length,
    1,
    `${workflow.id} must have one trigger`,
  );
}

assert.equal(
  supplierSync.nodes.some((node) => node.continueOnFail === true),
  false,
  "supplier sync must not use continueOnFail",
);
assert.notEqual(cleanup.continueOnFail, true);

console.log("production hotfix candidate tests passed (2 workflows)");
