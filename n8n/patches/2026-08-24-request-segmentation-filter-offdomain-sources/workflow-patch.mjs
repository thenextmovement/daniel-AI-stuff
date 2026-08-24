import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DOMAIN_SCOPE_AFTER,
  DOMAIN_SCOPE_BEFORE,
  PREPARE_CODE_AFTER,
  PREPARE_CODE_BEFORE,
  PREPARE_NODE_ID,
  WORKFLOW_ID
} from "./offdomain-source.mjs";

const PATCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.resolve(
  PATCH_DIR,
  "../../backups/2026-08-24-request-segmentation-filter-offdomain-sources"
);
const MANIFEST_PATH = path.join(BACKUP_DIR, "manifest.json");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepSort(value) {
  if (Array.isArray(value)) return value.map(deepSort);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, deepSort(value[key])])
  );
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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
  if (!node) throw new Error(`Workflow is missing node ${nodeId}.`);
  return node;
}

function nodeHash(workflow, nodeId) {
  return sha256(JSON.stringify(deepSort(requireNode(workflow, nodeId))));
}

function replaceExactly(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Expected exactly one ${label}.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function loadPreparedPrestate() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const draftPath = path.join(BACKUP_DIR, manifest.files.draft);
  const activePath = path.join(BACKUP_DIR, manifest.files.active);
  const rawDraft = fs.readFileSync(draftPath, "utf8");
  const rawActive = fs.readFileSync(activePath, "utf8");
  const draft = JSON.parse(rawDraft);
  const active = JSON.parse(rawActive);

  if (manifest.workflow_id !== WORKFLOW_ID
      || draft.id !== WORKFLOW_ID || active.id !== WORKFLOW_ID
      || draft.active !== true || active.active !== true
      || draft.isArchived === true || active.isArchived === true) {
    throw new Error("Pinned workflow identity or activation state changed.");
  }
  if (draft.versionId !== manifest.draft_version_id
      || draft.activeVersionId !== manifest.active_version_id
      || active.activeVersionId !== manifest.active_version_id
      || draft.versionCounter !== manifest.version_counter) {
    throw new Error("Pinned workflow version changed.");
  }
  if (sha256(rawDraft) !== manifest.hashes.draft_file_sha256
      || sha256(rawActive) !== manifest.hashes.active_file_sha256) {
    throw new Error("Pinned full workflow snapshot hash changed.");
  }
  if (!manifest.draft_active_graphs_equal || !equalGraph(draft, active)
      || graphHash(draft) !== manifest.hashes.draft_graph_sha256
      || graphHash(active) !== manifest.hashes.active_graph_sha256) {
    throw new Error("Pinned draft and active graphs changed.");
  }
  if (draft.nodes.length !== manifest.node_count
      || Object.keys(draft.connections).length !== manifest.connection_source_count
      || nodeHash(draft, PREPARE_NODE_ID) !== manifest.hashes.prepare_node_sha256) {
    throw new Error("Pinned workflow topology or Prepare node changed.");
  }
  if (requireNode(draft, PREPARE_NODE_ID).parameters.jsCode !== PREPARE_CODE_BEFORE
      || requireNode(active, PREPARE_NODE_ID).parameters.jsCode !== PREPARE_CODE_BEFORE) {
    throw new Error("Pinned Prepare code does not match the canonical v7 source.");
  }
  return { draft, active, manifest, draftPath, activePath };
}

export function createPatchBundle() {
  const { manifest, draftPath, activePath } = loadPreparedPrestate();
  const forwardOperation = {
    type: "patchNodeField",
    nodeId: PREPARE_NODE_ID,
    fieldPath: "parameters.jsCode",
    patches: [{ find: DOMAIN_SCOPE_BEFORE, replace: DOMAIN_SCOPE_AFTER }]
  };
  const reverseOperation = {
    type: "patchNodeField",
    nodeId: PREPARE_NODE_ID,
    fieldPath: "parameters.jsCode",
    patches: [{ find: DOMAIN_SCOPE_AFTER, replace: DOMAIN_SCOPE_BEFORE }]
  };
  const preparedAgainst = {
    draft_path: draftPath,
    active_path: activePath,
    captured_at_utc: manifest.captured_at_utc,
    draft_version_id: manifest.draft_version_id,
    active_version_id: manifest.active_version_id,
    version_counter: manifest.version_counter,
    draft_file_sha256: manifest.hashes.draft_file_sha256,
    active_file_sha256: manifest.hashes.active_file_sha256,
    graph_sha256: manifest.hashes.draft_graph_sha256,
    prepare_node_sha256: manifest.hashes.prepare_node_sha256,
    active: manifest.active,
    node_count: manifest.node_count,
    connection_source_count: manifest.connection_source_count
  };
  return {
    artifact_version: "neontrip_n8n_filter_offdomain_sources_v1",
    workflow_id: WORKFLOW_ID,
    prepared_against: preparedAgainst,
    forward: {
      id: WORKFLOW_ID,
      intent: "Ignore provider-added off-domain search URLs while accepting only exact customer-domain sources in the treatment shadow lane.",
      operations: [forwardOperation],
      continueOnError: false
    },
    reverse: {
      id: WORKFLOW_ID,
      intent: "Restore the exact Counter-137 Prepare Treatment Classification source-domain rejection block.",
      operations: [reverseOperation],
      continueOnError: false
    },
    validate_only_forward: {
      id: WORKFLOW_ID,
      operations: [forwardOperation],
      validateOnly: true,
      continueOnError: false
    },
    validate_only_roundtrip: {
      id: WORKFLOW_ID,
      operations: [forwardOperation, reverseOperation],
      validateOnly: true,
      continueOnError: false
    },
    expected: {
      changed_node_id: PREPARE_NODE_ID,
      changed_field_path: "parameters.jsCode",
      before_code_sha256: sha256(PREPARE_CODE_BEFORE),
      after_code_sha256: sha256(PREPARE_CODE_AFTER),
      node_count: manifest.node_count,
      connection_source_count: manifest.connection_source_count
    },
    safety: {
      activation_unchanged: true,
      settings_unchanged: true,
      connections_unchanged: true,
      credentials_unchanged: true,
      customer_actions_unchanged_and_disabled: true,
      only_exact_domain_or_subdomain_sources_retained: true,
      malformed_urls_still_rejected: true,
      invalid_authorized_domain_still_rejected: true,
      no_manual_execution: true
    }
  };
}

export function applyOperationsInMemory(workflow, operations) {
  const result = clone(workflow);
  for (const operation of operations) {
    if (operation.type !== "patchNodeField"
        || operation.nodeId !== PREPARE_NODE_ID
        || operation.fieldPath !== "parameters.jsCode"
        || !Array.isArray(operation.patches)) {
      throw new Error("Unexpected offline patch operation.");
    }
    const node = requireNode(result, PREPARE_NODE_ID);
    for (const patch of operation.patches) {
      node.parameters.jsCode = replaceExactly(
        node.parameters.jsCode,
        patch.find,
        patch.replace,
        "Prepare source patch fragment"
      );
    }
  }
  return result;
}

export function createArtifactFiles() {
  const { draft } = loadPreparedPrestate();
  const bundle = createPatchBundle();
  const candidate = applyOperationsInMemory(draft, bundle.forward.operations);
  const reversed = applyOperationsInMemory(candidate, bundle.reverse.operations);
  if (JSON.stringify(reversed) !== JSON.stringify(draft)) {
    throw new Error("Forward plus reverse does not restore the exact full workflow.");
  }
  const candidateNode = requireNode(candidate, PREPARE_NODE_ID);
  if (candidateNode.parameters.jsCode !== PREPARE_CODE_AFTER) {
    throw new Error("Generated candidate does not match the canonical fixed source.");
  }
  return {
    "forward-patch.json": {
      artifact_version: bundle.artifact_version,
      prepared_against: bundle.prepared_against,
      patch: bundle.forward,
      expected: bundle.expected,
      safety: bundle.safety
    },
    "reverse-patch.json": {
      artifact_version: bundle.artifact_version,
      restores_prepared_version: bundle.prepared_against,
      patch: bundle.reverse,
      safety: bundle.safety
    },
    "full-diff.json": {
      workflow_id: WORKFLOW_ID,
      prepared_against: bundle.prepared_against,
      before: {
        node_count: draft.nodes.length,
        connection_source_count: Object.keys(draft.connections).length,
        graph_sha256: graphHash(draft),
        prepare_code_sha256: sha256(PREPARE_CODE_BEFORE)
      },
      after: {
        node_count: candidate.nodes.length,
        connection_source_count: Object.keys(candidate.connections).length,
        graph_sha256: graphHash(candidate),
        prepare_code_sha256: sha256(PREPARE_CODE_AFTER)
      },
      changed_nodes: [{
        node_id: PREPARE_NODE_ID,
        field_paths: ["parameters.jsCode"],
        before_fragment: DOMAIN_SCOPE_BEFORE,
        after_fragment: DOMAIN_SCOPE_AFTER
      }],
      every_other_node_field_unchanged: true,
      connections_unchanged: true,
      settings_unchanged: true,
      activation_unchanged: true
    },
    "expected-diff.json": {
      workflow_id: WORKFLOW_ID,
      forward_operation_count: 1,
      reverse_operation_count: 1,
      expected: bundle.expected,
      every_other_node_field_unchanged: true,
      connections_unchanged: true,
      settings_unchanged: true,
      activation_unchanged: true
    }
  };
}

if (process.argv.includes("--write-artifacts")) {
  for (const [fileName, value] of Object.entries(createArtifactFiles())) {
    fs.writeFileSync(path.join(PATCH_DIR, fileName), `${JSON.stringify(value, null, 2)}\n`);
  }
} else if (process.argv.includes("--print-artifacts")) {
  process.stdout.write(`${JSON.stringify(createArtifactFiles(), null, 2)}\n`);
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(createPatchBundle(), null, 2)}\n`);
}
