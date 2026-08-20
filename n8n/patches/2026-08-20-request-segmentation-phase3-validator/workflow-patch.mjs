import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  applyOperationsInMemory as applyPhase2Operations,
  createPatchBundle as createPhase2PatchBundle,
  loadPreparedPrestate as loadPhase1Prestate
} from "../2026-08-19-request-segmentation-phase2-cx8/workflow-patch.mjs";
import {
  VALIDATOR_CODE_AFTER,
  VALIDATOR_CODE_BEFORE
} from "./validator-fix-source.mjs";

export const WORKFLOW_ID = "ELpwCfdWOCRZ22gy";
export const VALIDATOR_NODE_ID = "validate-output";

const PATCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const PRESTATE_DIR = path.resolve(
  PATCH_DIR,
  "../../backups/2026-08-20-request-segmentation-phase3-validator"
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
  return JSON.stringify(deepSort(graphOf(left))) === JSON.stringify(deepSort(graphOf(right)));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireNode(workflow, nodeId) {
  const node = workflow.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error("Workflow is missing node " + nodeId);
  return node;
}

function expectedPhase2Workflow() {
  const phase1 = loadPhase1Prestate().workflow;
  return applyPhase2Operations(phase1, createPhase2PatchBundle().forward.operations);
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
  if (manifest.draft_version_id !== "f2ae5824-6056-4d10-9e4a-0009c91261cf"
      || manifest.active_version_id !== manifest.draft_version_id
      || draft.versionId !== manifest.draft_version_id
      || draft.activeVersionId !== manifest.active_version_id
      || active.activeVersionId !== manifest.active_version_id
      || draft.versionCounter !== 113
      || manifest.version_counter !== 113) {
    throw new Error("Pinned workflow version, active version, or counter changed.");
  }
  if (sha256(rawDraft) !== manifest.hashes.draft_file_sha256
      || sha256(rawActive) !== manifest.hashes.active_file_sha256) {
    throw new Error("Pinned full workflow backup file hash changed.");
  }
  if (!manifest.draft_active_graphs_equal || !equalGraph(draft, active)) {
    throw new Error("Pinned draft and active graphs are not equal.");
  }

  const expected = expectedPhase2Workflow();
  if (!manifest.draft_expected_phase2_graph_equal
      || !manifest.active_expected_phase2_graph_equal
      || !equalGraph(draft, expected)
      || !equalGraph(active, expected)) {
    throw new Error("Pinned live graph no longer equals the approved Phase-2 graph.");
  }
  if (graphHash(draft) !== manifest.hashes.draft_graph_sha256
      || graphHash(active) !== manifest.hashes.active_graph_sha256
      || graphHash(expected) !== manifest.hashes.expected_phase2_graph_sha256) {
    throw new Error("Pinned Phase-2 graph hash changed.");
  }

  const validator = requireNode(draft, VALIDATOR_NODE_ID);
  if (validator.parameters.jsCode !== VALIDATOR_CODE_BEFORE
      || sha256(validator.parameters.jsCode) !== manifest.hashes.validator_before_sha256) {
    throw new Error("Pinned Validator no longer equals the deployed Phase-2 source.");
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
      nodeId: VALIDATOR_NODE_ID,
      updates: {
        "parameters.jsCode": VALIDATOR_CODE_AFTER
      }
    }
  ];
  const reverseOperations = [
    {
      type: "updateNode",
      nodeId: VALIDATOR_NODE_ID,
      updates: {
        "parameters.jsCode": VALIDATOR_CODE_BEFORE
      }
    }
  ];
  const intent = "Repair only the NEONTRIP CX8 Validator Responses-root traversal and technical error observability.";

  return {
    artifact_version: "neontrip_n8n_phase3_validator_response_root_v1",
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
      intent: "Restore only the exact prior NEONTRIP CX8 Validator source.",
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
    validate_only_roundtrip: {
      id: WORKFLOW_ID,
      intent: "Validate the one-node Validator repair and exact reverse without writing.",
      operations: [...forwardOperations, ...reverseOperations],
      validateOnly: true,
      continueOnError: false
    },
    expected_diff: [
      {
        node_id: VALIDATOR_NODE_ID,
        field_path: "parameters.jsCode",
        existed_before: true,
        before_sha256: sha256(VALIDATOR_CODE_BEFORE),
        after_sha256: sha256(VALIDATOR_CODE_AFTER)
      }
    ],
    preserved: {
      topology: true,
      connections: true,
      credentials: true,
      trigger: true,
      settings: true,
      node_count: true,
      activation: true,
      all_other_node_fields: true,
      record_rpc_shape: true,
      classifier_contract: true
    },
    safety: {
      prepared_only: true,
      no_live_write_performed: true,
      no_publish_performed: true,
      no_activation_change_performed: true,
      no_manual_execution_performed: true,
      no_retry_performed: true
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

if (process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.stdout.write(JSON.stringify(createPatchBundle(), null, 2) + "\n");
}
