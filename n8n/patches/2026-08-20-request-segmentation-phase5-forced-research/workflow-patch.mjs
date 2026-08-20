import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  BUILD_CODE_AFTER,
  BUILD_CODE_BEFORE,
  BUILD_NODE_ID,
  CLAIM_NODE_ID,
  CLAIM_PARAMETERS_AFTER,
  CLAIM_PARAMETERS_BEFORE,
  CLASSIFIER_NODE_BEFORE,
  CLASSIFIER_NODE_ID,
  CLASSIFIER_PARAMETERS_AFTER,
  VALIDATOR_CODE_AFTER,
  VALIDATOR_CODE_BEFORE,
  VALIDATOR_NODE_ID,
  WORKFLOW_ID
} from "./forced-research-source.mjs";

export { WORKFLOW_ID };

const PATCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const PRESTATE_DIR = path.resolve(
  PATCH_DIR,
  "../../backups/2026-08-20-request-segmentation-phase5-forced-research"
);
const MANIFEST_PATH = path.join(PRESTATE_DIR, "manifest.json");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function deepSort(value) {
  if (Array.isArray(value)) return value.map(deepSort);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, deepSort(value[key])])
  );
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function graphOf(workflow) {
  return {
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings
  };
}

function graphHash(workflow) {
  return sha256(JSON.stringify(deepSort(graphOf(workflow))));
}

function equalGraph(left, right) {
  return JSON.stringify(deepSort(graphOf(left)))
    === JSON.stringify(deepSort(graphOf(right)));
}

function requireNode(workflow, nodeId) {
  const node = workflow.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error("Workflow is missing node " + nodeId);
  return node;
}

function nodeHash(workflow, nodeId) {
  return sha256(JSON.stringify(deepSort(requireNode(workflow, nodeId))));
}

function assertPreparedPrestate(draft, active, manifest, rawDraft, rawActive) {
  if (manifest.workflow_id !== WORKFLOW_ID
      || draft.id !== WORKFLOW_ID
      || active.id !== WORKFLOW_ID) {
    throw new Error("Workflow id does not match the pinned NEONTRIP segmenter.");
  }
  if (!manifest.active || manifest.is_archived
      || draft.active !== true || active.active !== true
      || draft.isArchived === true || active.isArchived === true) {
    throw new Error("Pinned workflow is not active and non-archived.");
  }
  if (manifest.draft_version_id !== "9880b37e-4c81-4ae9-87b2-fc667d33cf8c"
      || manifest.active_version_id !== manifest.draft_version_id
      || draft.versionId !== manifest.draft_version_id
      || draft.activeVersionId !== manifest.active_version_id
      || active.activeVersionId !== manifest.active_version_id
      || draft.versionCounter !== 116
      || manifest.version_counter !== 116) {
    throw new Error("Pinned workflow version, active version, or counter changed.");
  }
  if (sha256(rawDraft) !== manifest.hashes.draft_file_sha256
      || sha256(rawActive) !== manifest.hashes.active_file_sha256) {
    throw new Error("Pinned full workflow backup file hash changed.");
  }
  if (!manifest.draft_active_graphs_equal || !equalGraph(draft, active)) {
    throw new Error("Pinned draft and active graphs are not equal.");
  }
  if (graphHash(draft) !== manifest.hashes.draft_graph_sha256
      || graphHash(active) !== manifest.hashes.active_graph_sha256) {
    throw new Error("Pinned workflow graph hash changed.");
  }
  const nodeHashes = {
    [CLAIM_NODE_ID]: manifest.hashes.claim_node_sha256,
    [BUILD_NODE_ID]: manifest.hashes.build_node_sha256,
    [CLASSIFIER_NODE_ID]: manifest.hashes.classifier_node_sha256,
    [VALIDATOR_NODE_ID]: manifest.hashes.validator_node_sha256
  };
  for (const [nodeId, expectedHash] of Object.entries(nodeHashes)) {
    if (nodeHash(draft, nodeId) !== expectedHash) {
      throw new Error("Pinned node hash changed for " + nodeId);
    }
  }
  if (JSON.stringify(requireNode(draft, CLAIM_NODE_ID).parameters)
        !== JSON.stringify(CLAIM_PARAMETERS_BEFORE)
      || requireNode(draft, BUILD_NODE_ID).parameters.jsCode !== BUILD_CODE_BEFORE
      || JSON.stringify(requireNode(draft, CLASSIFIER_NODE_ID))
        !== JSON.stringify(CLASSIFIER_NODE_BEFORE)
      || requireNode(draft, VALIDATOR_NODE_ID).parameters.jsCode !== VALIDATOR_CODE_BEFORE) {
    throw new Error("Pinned Phase-4 source no longer matches the prepared patch source.");
  }
}

export function loadPreparedPrestate() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const draftPath = path.join(PRESTATE_DIR, manifest.files.draft);
  const activePath = path.join(PRESTATE_DIR, manifest.files.active);
  const rawDraft = fs.readFileSync(draftPath, "utf8");
  const rawActive = fs.readFileSync(activePath, "utf8");
  const draft = JSON.parse(rawDraft);
  const active = JSON.parse(rawActive);
  assertPreparedPrestate(draft, active, manifest, rawDraft, rawActive);
  return { draft, active, manifest, draftPath, activePath };
}

export function createPatchBundle() {
  const { draft, manifest, draftPath, activePath } = loadPreparedPrestate();
  const forwardOperations = [
    {
      type: "updateNode",
      nodeId: CLAIM_NODE_ID,
      updates: {
        "parameters.jsonBody": CLAIM_PARAMETERS_AFTER.jsonBody
      }
    },
    {
      type: "updateNode",
      nodeId: BUILD_NODE_ID,
      updates: {
        "parameters.jsCode": BUILD_CODE_AFTER
      }
    },
    {
      type: "updateNode",
      nodeId: CLASSIFIER_NODE_ID,
      updates: {
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.4,
        parameters: CLASSIFIER_PARAMETERS_AFTER
      }
    },
    {
      type: "updateNode",
      nodeId: VALIDATOR_NODE_ID,
      updates: {
        "parameters.jsCode": VALIDATOR_CODE_AFTER
      }
    }
  ];
  const reverseOperations = [
    {
      type: "updateNode",
      nodeId: CLAIM_NODE_ID,
      updates: {
        "parameters.jsonBody": CLAIM_PARAMETERS_BEFORE.jsonBody
      }
    },
    {
      type: "updateNode",
      nodeId: BUILD_NODE_ID,
      updates: {
        "parameters.jsCode": BUILD_CODE_BEFORE
      }
    },
    {
      type: "updateNode",
      nodeId: CLASSIFIER_NODE_ID,
      updates: {
        type: CLASSIFIER_NODE_BEFORE.type,
        typeVersion: CLASSIFIER_NODE_BEFORE.typeVersion,
        parameters: CLASSIFIER_NODE_BEFORE.parameters
      }
    },
    {
      type: "updateNode",
      nodeId: VALIDATOR_NODE_ID,
      updates: {
        "parameters.jsCode": VALIDATOR_CODE_BEFORE
      }
    }
  ];
  const intent =
    "Prepare the NEONTRIP Phase-5 CX8 classifier to deterministically require web search only when the pinned research policy requires it.";

  return {
    artifact_version: "neontrip_n8n_phase5_forced_research_v2",
    workflow_id: WORKFLOW_ID,
    prepared_against: {
      draft_path: draftPath,
      active_path: activePath,
      captured_at_utc: manifest.captured_at_utc,
      draft_version_id: manifest.draft_version_id,
      active_version_id: manifest.active_version_id,
      version_counter: manifest.version_counter,
      draft_file_sha256: manifest.hashes.draft_file_sha256,
      active_file_sha256: manifest.hashes.active_file_sha256,
      graph_sha256: manifest.hashes.draft_graph_sha256,
      active: manifest.active,
      node_count: manifest.node_count,
      connection_source_count: manifest.connection_source_count
    },
    forward: {
      id: WORKFLOW_ID,
      intent,
      operations: forwardOperations,
      continueOnError: false
    },
    reverse: {
      id: WORKFLOW_ID,
      intent: "Restore exactly the four prior NEONTRIP Phase-4 node fields.",
      operations: reverseOperations,
      continueOnError: false
    },
    validate_only_forward: {
      id: WORKFLOW_ID,
      intent,
      operations: forwardOperations,
      validateOnly: true,
      continueOnError: false
    },
    validate_only_reverse: {
      id: WORKFLOW_ID,
      intent: "Validate the exact Phase-5 reverse without writing.",
      operations: reverseOperations,
      validateOnly: true,
      continueOnError: false
    },
    validate_only_roundtrip: {
      id: WORKFLOW_ID,
      intent: "Validate the Phase-5 patch and exact reverse without writing.",
      operations: [...forwardOperations, ...reverseOperations],
      validateOnly: true,
      continueOnError: false
    },
    expected_diff: [
      {
        node_id: CLAIM_NODE_ID,
        field_path: "parameters.jsonBody",
        existed_before: true,
        before_sha256: sha256(CLAIM_PARAMETERS_BEFORE.jsonBody),
        after_sha256: sha256(CLAIM_PARAMETERS_AFTER.jsonBody)
      },
      {
        node_id: BUILD_NODE_ID,
        field_path: "parameters.jsCode",
        existed_before: true,
        before_sha256: sha256(BUILD_CODE_BEFORE),
        after_sha256: sha256(BUILD_CODE_AFTER)
      },
      {
        node_id: CLASSIFIER_NODE_ID,
        field_path: "type",
        existed_before: true,
        before_sha256: sha256(CLASSIFIER_NODE_BEFORE.type),
        after_sha256: sha256("n8n-nodes-base.httpRequest")
      },
      {
        node_id: CLASSIFIER_NODE_ID,
        field_path: "typeVersion",
        existed_before: true,
        before_sha256: sha256(JSON.stringify(CLASSIFIER_NODE_BEFORE.typeVersion)),
        after_sha256: sha256(JSON.stringify(4.4))
      },
      {
        node_id: CLASSIFIER_NODE_ID,
        field_path: "parameters",
        existed_before: true,
        before_sha256: sha256(JSON.stringify(deepSort(CLASSIFIER_NODE_BEFORE.parameters))),
        after_sha256: sha256(JSON.stringify(deepSort(CLASSIFIER_PARAMETERS_AFTER)))
      },
      {
        node_id: VALIDATOR_NODE_ID,
        field_path: "parameters.jsCode",
        existed_before: true,
        before_sha256: sha256(VALIDATOR_CODE_BEFORE),
        after_sha256: sha256(VALIDATOR_CODE_AFTER)
      }
    ],
    preserved: {
      taxonomy_version: "nt_taxonomy_v2_20260819_cx8",
      prompt_version: "segment_prompt_v4_20260819_cx8",
      validator_version: "n8n_cx8_validator_v1",
      model: "gpt-4o-mini",
      temperature: 0.1,
      max_output_tokens: 1400,
      include: ["web_search_call.action.sources"],
      store: true,
      strict_schema: true,
      topology: true,
      connections: true,
      credentials: true,
      trigger: true,
      settings: true,
      node_count: true,
      activation: true,
      classifier_node_id_name_position: true,
      every_other_node_field: true
    },
    safety: {
      prepared_only: true,
      no_live_write_performed: true,
      no_publish_performed: true,
      no_activation_change_performed: true,
      no_manual_execution_performed: true,
      no_retry_performed: true,
      no_customer_action_performed: true
    },
    draft_node_count: draft.nodes.length
  };
}

function setAtPath(target, dottedPath, value) {
  const parts = dottedPath.split(".");
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor = cursor[parts[index]];
  }
  cursor[parts[parts.length - 1]] = clone(value);
}

export function applyOperationsInMemory(workflow, operations) {
  const result = clone(workflow);
  for (const operation of operations) {
    if (operation.type !== "updateNode") {
      throw new Error("Offline patch harness does not support " + operation.type);
    }
    const node = requireNode(result, operation.nodeId);
    for (const [fieldPath, value] of Object.entries(operation.updates)) {
      setAtPath(node, fieldPath, value);
    }
  }
  return result;
}

function operationValue(operations, nodeId, fieldPath) {
  const operation = operations.find((item) => item.nodeId === nodeId);
  if (!operation || !(fieldPath in operation.updates)) {
    throw new Error(`Missing ${nodeId}.${fieldPath} in generated operations.`);
  }
  return operation.updates[fieldPath];
}

export function createArtifactFiles() {
  const bundle = createPatchBundle();
  const fullFields = bundle.expected_diff.map((field) => ({
    node_id: field.node_id,
    field_path: field.field_path,
    before: operationValue(bundle.reverse.operations, field.node_id, field.field_path),
    after: operationValue(bundle.forward.operations, field.node_id, field.field_path)
  }));
  return {
    "forward-patch.json": {
      artifact_version: bundle.artifact_version,
      prepared_against: bundle.prepared_against,
      patch: bundle.forward,
      expected_diff: bundle.expected_diff,
      safety: bundle.safety
    },
    "reverse-patch.json": {
      artifact_version: bundle.artifact_version,
      restores_prepared_version: bundle.prepared_against,
      patch: bundle.reverse,
      safety: bundle.safety
    },
    "full-diff.json": {
      workflow_id: bundle.workflow_id,
      prepared_against: bundle.prepared_against,
      changed_node_count: new Set(fullFields.map((field) => field.node_id)).size,
      changed_field_count: fullFields.length,
      fields: fullFields,
      preserved: bundle.preserved
    },
    "expected-diff.json": {
      workflow_id: bundle.workflow_id,
      operation_count: bundle.forward.operations.length,
      changed_field_count: bundle.expected_diff.length,
      fields: bundle.expected_diff,
      preserved: bundle.preserved
    }
  };
}

function writeArtifactFiles() {
  for (const [filename, artifact] of Object.entries(createArtifactFiles())) {
    fs.writeFileSync(path.join(PATCH_DIR, filename), JSON.stringify(artifact, null, 2) + "\n");
  }
}

if (process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.includes("--write-artifacts")) {
    writeArtifactFiles();
  } else {
    process.stdout.write(JSON.stringify(createPatchBundle(), null, 2) + "\n");
  }
}
