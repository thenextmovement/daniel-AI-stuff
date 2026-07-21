import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const backupDirectory = resolve(here, "backups", "2026-07-21");
const generatedDirectory = resolve(here, "generated");

function nodeByName(workflow, name) {
  const node = workflow.nodes.find((entry) => entry.name === name);
  if (!node) throw new Error(`Missing node ${name} in ${workflow.id}`);
  return node;
}

function prepareForCandidate(workflow) {
  delete workflow.activeVersionId;
  delete workflow.versionCreatedAt;
  delete workflow.versionName;
  delete workflow.createdAt;
  delete workflow.updatedAt;
  delete workflow.isArchived;
  delete workflow.tags;
  return workflow;
}

async function loadBackup(file) {
  return prepareForCandidate(
    JSON.parse(await readFile(resolve(backupDirectory, file), "utf8")),
  );
}

async function buildGeminiCredentialHotfix() {
  const workflow = await loadBackup(
    "T4mdDxLquLMJ6FMl.published-active.json",
  );
  workflow.name = "Gemini Mockup Generator v1.2.1 — cleanup credential hotfix";

  const reference = nodeByName(workflow, "Remove Processing Label - Success");
  const cleanup = nodeByName(workflow, "Remove Processing Label - Review End");
  cleanup.typeVersion = reference.typeVersion;
  cleanup.credentials = structuredClone(reference.credentials);
  cleanup.retryOnFail = false;
  delete cleanup.maxTries;
  delete cleanup.waitBetweenTries;
  delete cleanup.continueOnFail;
  delete cleanup.onError;

  return workflow;
}

async function buildSupplierTagSyncHotfix() {
  const workflow = await loadBackup(
    "WlSmT7zlLcR4TlUG.published-active.json",
  );
  workflow.name = "NEONTRIP Supplier Shopify Tag Sync v0.2 — single attempt";

  const request = nodeByName(workflow, "Ops: Sync Shopify Supplier Tags");
  request.retryOnFail = false;
  delete request.maxTries;
  delete request.waitBetweenTries;
  delete request.continueOnFail;
  delete request.onError;
  request.parameters.options = {
    ...(request.parameters.options || {}),
    timeout: 60000,
  };
  delete request.parameters.options.allowUnauthorizedCerts;

  return workflow;
}

await mkdir(generatedDirectory, { recursive: true });
const candidates = [
  [
    "T4mdDxLquLMJ6FMl.gemini-cleanup-credential-hotfix-v1.2.1.json",
    await buildGeminiCredentialHotfix(),
  ],
  [
    "WlSmT7zlLcR4TlUG.supplier-tag-sync-single-attempt-v0.2.json",
    await buildSupplierTagSyncHotfix(),
  ],
];

for (const [file, workflow] of candidates) {
  const path = resolve(generatedDirectory, file);
  await writeFile(path, `${JSON.stringify(workflow, null, 2)}\n`);
  console.log(path);
}
