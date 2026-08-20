import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BUILD_NODE_ID,
  BUILD_NODE_BEFORE,
  BUILD_PARAMETERS_AFTER,
  CLAIM_NODE_ID,
  CLAIM_NODE_BEFORE,
  CLAIM_MAX_TRIES_AFTER,
  CLAIM_PARAMETERS_AFTER,
  CLAIM_RETRY_ON_FAIL_AFTER,
  CLASSIFIER_NODE_ID,
  CLASSIFIER_NODE_BEFORE,
  CLASSIFIER_PARAMETERS_AFTER,
  FAILURE_NODE_ID,
  PAYLOAD_GATE_NODE_ID,
  PAYLOAD_NODE_ID,
  PAYLOAD_NODE_BEFORE,
  PAYLOAD_PARAMETERS_AFTER,
  PREPARE_NODE,
  PREPARE_NODE_ID,
  RESEARCH_GATE_NODE,
  RESEARCH_GATE_NODE_ID,
  RESEARCH_NODE,
  RESEARCH_NODE_ID,
  VALIDATOR_NODE_ID,
  VALIDATOR_NODE_BEFORE,
  VALIDATOR_PARAMETERS_AFTER,
  WORKFLOW_ID
} from "./url-runtime-repair-source.mjs";

const PATCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const PRESTATE_DIR = path.resolve(
  PATCH_DIR,
  "../../backups/2026-08-20-request-segmentation-phase6-url-runtime-repair"
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
  return { nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings };
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
  if (manifest.draft_version_id !== "3d1fb779-adb1-46d3-b199-b342a8800513"
      || manifest.active_version_id !== manifest.draft_version_id
      || draft.versionId !== manifest.draft_version_id
      || draft.activeVersionId !== manifest.active_version_id
      || active.activeVersionId !== manifest.active_version_id
      || draft.versionCounter !== 124
      || manifest.version_counter !== 124) {
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
  const expectedNodeHashes = {
    [CLAIM_NODE_ID]: manifest.hashes.claim_node_sha256,
    [PAYLOAD_NODE_ID]: manifest.hashes.payload_node_sha256,
    [BUILD_NODE_ID]: manifest.hashes.build_node_sha256,
    [CLASSIFIER_NODE_ID]: manifest.hashes.classifier_node_sha256,
    [VALIDATOR_NODE_ID]: manifest.hashes.validator_node_sha256,
    [FAILURE_NODE_ID]: manifest.hashes.failure_node_sha256
  };
  for (const [nodeId, expectedHash] of Object.entries(expectedNodeHashes)) {
    if (nodeHash(draft, nodeId) !== expectedHash) {
      throw new Error("Pinned node hash changed for " + nodeId);
    }
  }
  if (JSON.stringify(requireNode(draft, CLAIM_NODE_ID)) !== JSON.stringify(CLAIM_NODE_BEFORE)
      || JSON.stringify(requireNode(draft, PAYLOAD_NODE_ID)) !== JSON.stringify(PAYLOAD_NODE_BEFORE)
      || JSON.stringify(requireNode(draft, BUILD_NODE_ID)) !== JSON.stringify(BUILD_NODE_BEFORE)
      || JSON.stringify(requireNode(draft, CLASSIFIER_NODE_ID)) !== JSON.stringify(CLASSIFIER_NODE_BEFORE)
      || JSON.stringify(requireNode(draft, VALIDATOR_NODE_ID)) !== JSON.stringify(VALIDATOR_NODE_BEFORE)) {
    throw new Error("Pinned v3 nodes no longer match the Phase-6 source module.");
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

function createCandidateConnections(before) {
  const connections = clone(before);
  const payloadGateName = "Payload Ready Gate";
  const classifierName = "OpenAI Structured Segment Classifier";
  const failureName = "Build Failure Payload";
  const gateConnection = connections[payloadGateName];
  if (!gateConnection
      || !Array.isArray(gateConnection.main)
      || !gateConnection.main[0]
      || gateConnection.main[0].length !== 1
      || gateConnection.main[0][0].node !== classifierName) {
    throw new Error("Pinned Payload Ready Gate connection changed.");
  }
  gateConnection.main[0] = [{
    node: RESEARCH_GATE_NODE.name,
    type: "main",
    index: 0
  }];
  connections[RESEARCH_GATE_NODE.name] = {
    main: [
      [{ node: RESEARCH_NODE.name, type: "main", index: 0 }],
      [{ node: PREPARE_NODE.name, type: "main", index: 0 }],
      [{ node: failureName, type: "main", index: 0 }]
    ]
  };
  connections[RESEARCH_NODE.name] = {
    main: [
      [{ node: PREPARE_NODE.name, type: "main", index: 0 }],
      [{ node: failureName, type: "main", index: 0 }]
    ]
  };
  connections[PREPARE_NODE.name] = {
    main: [
      [{ node: classifierName, type: "main", index: 0 }],
      [{ node: failureName, type: "main", index: 0 }]
    ]
  };
  return connections;
}

export function createPatchBundle() {
  const { draft, manifest, draftPath, activePath } = loadPreparedPrestate();
  const candidateConnections = createCandidateConnections(draft.connections);
  const forwardOperations = [
    {
      type: "updateNode",
      nodeId: CLAIM_NODE_ID,
      updates: {
        "parameters.url": CLAIM_PARAMETERS_AFTER.url,
        "parameters.jsonBody": CLAIM_PARAMETERS_AFTER.jsonBody,
        retryOnFail: CLAIM_RETRY_ON_FAIL_AFTER,
        maxTries: CLAIM_MAX_TRIES_AFTER
      }
    },
    {
      type: "updateNode",
      nodeId: PAYLOAD_NODE_ID,
      updates: { "parameters.url": PAYLOAD_PARAMETERS_AFTER.url }
    },
    {
      type: "updateNode",
      nodeId: BUILD_NODE_ID,
      updates: { parameters: BUILD_PARAMETERS_AFTER }
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
      updates: { parameters: VALIDATOR_PARAMETERS_AFTER }
    },
    { type: "addNode", node: clone(RESEARCH_GATE_NODE) },
    { type: "addNode", node: clone(RESEARCH_NODE) },
    { type: "addNode", node: clone(PREPARE_NODE) },
    { type: "replaceConnections", connections: candidateConnections }
  ];
  const reverseOperations = [
    { type: "replaceConnections", connections: clone(draft.connections) },
    { type: "removeNode", nodeId: PREPARE_NODE_ID },
    { type: "removeNode", nodeId: RESEARCH_NODE_ID },
    { type: "removeNode", nodeId: RESEARCH_GATE_NODE_ID },
    {
      type: "updateNode",
      nodeId: VALIDATOR_NODE_ID,
      updates: { parameters: clone(VALIDATOR_NODE_BEFORE.parameters) }
    },
    {
      type: "updateNode",
      nodeId: CLASSIFIER_NODE_ID,
      updates: {
        type: CLASSIFIER_NODE_BEFORE.type,
        typeVersion: CLASSIFIER_NODE_BEFORE.typeVersion,
        parameters: clone(CLASSIFIER_NODE_BEFORE.parameters)
      }
    },
    {
      type: "updateNode",
      nodeId: BUILD_NODE_ID,
      updates: { parameters: clone(BUILD_NODE_BEFORE.parameters) }
    },
    {
      type: "updateNode",
      nodeId: PAYLOAD_NODE_ID,
      updates: { "parameters.url": PAYLOAD_NODE_BEFORE.parameters.url }
    },
    {
      type: "updateNode",
      nodeId: CLAIM_NODE_ID,
      updates: {
        "parameters.url": CLAIM_NODE_BEFORE.parameters.url,
        "parameters.jsonBody": CLAIM_NODE_BEFORE.parameters.jsonBody,
        retryOnFail: CLAIM_NODE_BEFORE.retryOnFail,
        maxTries: CLAIM_NODE_BEFORE.maxTries
      }
    }
  ];
  const intent =
    "Repair only Phase-6 URL normalization for the n8n Code runtime while preserving the exact v5 evaluation contract.";

  return {
    artifact_version: "neontrip_n8n_phase6_url_runtime_repair_v1",
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
      intent: "Restore the exact current Counter-124 v3 graph and remove only the three Phase-6 nodes.",
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
      intent: "Validate the exact Phase-6 URL-runtime reverse without writing.",
      operations: reverseOperations,
      validateOnly: true,
      continueOnError: false
    },
    validate_only_roundtrip: {
      id: WORKFLOW_ID,
      intent: "Validate the Phase-6 URL-runtime patch and exact reverse without writing.",
      operations: [...forwardOperations, ...reverseOperations],
      validateOnly: true,
      continueOnError: false
    },
    expected: {
      target_node_count: 23,
      target_connection_source_count: 20,
      added_node_ids: [RESEARCH_GATE_NODE_ID, RESEARCH_NODE_ID, PREPARE_NODE_ID],
      updated_node_ids: [
        CLAIM_NODE_ID,
        PAYLOAD_NODE_ID,
        BUILD_NODE_ID,
        CLASSIFIER_NODE_ID,
        VALIDATOR_NODE_ID
      ],
      exact_candidate_connections_sha256:
        sha256(JSON.stringify(deepSort(candidateConnections)))
    },
    safety: {
      prepared_only: true,
      no_live_write_performed: true,
      no_publish_performed: true,
      no_activation_change_performed: true,
      no_manual_execution_performed: true,
      no_job_retry_performed: true,
      no_db_mutation_performed: true,
      no_openai_request_performed: true,
      no_customer_action_performed: true,
      general_ingress_data_unchanged: true,
      general_ingress_processing_paused: true,
      evaluation_claim_limit: 1,
      evaluation_source: "gold_re_evaluation_phase6",
      master_projection_authorized: false
    }
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
    if (operation.type === "updateNode") {
      const node = requireNode(result, operation.nodeId);
      for (const [fieldPath, value] of Object.entries(operation.updates)) {
        setAtPath(node, fieldPath, value);
      }
    } else if (operation.type === "addNode") {
      if (result.nodes.some((node) =>
        node.id === operation.node.id || node.name === operation.node.name
      )) throw new Error("Duplicate added node " + operation.node.id);
      result.nodes.push(clone(operation.node));
    } else if (operation.type === "removeNode") {
      const index = result.nodes.findIndex((node) => node.id === operation.nodeId);
      if (index < 0) throw new Error("Cannot remove missing node " + operation.nodeId);
      result.nodes.splice(index, 1);
    } else if (operation.type === "replaceConnections") {
      result.connections = clone(operation.connections);
    } else {
      throw new Error("Unsupported offline operation " + operation.type);
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
    throw new Error("Generated Phase-6 reverse does not restore the full workflow.");
  }
  const changedNodeFields = [
    {
      node_id: CLAIM_NODE_ID,
      field_paths: ["parameters.url", "parameters.jsonBody", "retryOnFail", "maxTries"],
      before: {
        url: CLAIM_NODE_BEFORE.parameters.url,
        jsonBody: CLAIM_NODE_BEFORE.parameters.jsonBody,
        retryOnFail: CLAIM_NODE_BEFORE.retryOnFail,
        maxTries: CLAIM_NODE_BEFORE.maxTries
      },
      after: {
        url: CLAIM_PARAMETERS_AFTER.url,
        jsonBody: CLAIM_PARAMETERS_AFTER.jsonBody,
        retryOnFail: CLAIM_RETRY_ON_FAIL_AFTER,
        maxTries: CLAIM_MAX_TRIES_AFTER
      }
    },
    {
      node_id: PAYLOAD_NODE_ID,
      field_paths: ["parameters.url"],
      before: { url: PAYLOAD_NODE_BEFORE.parameters.url },
      after: { url: PAYLOAD_PARAMETERS_AFTER.url }
    },
    {
      node_id: BUILD_NODE_ID,
      field_paths: ["parameters"],
      before: clone(BUILD_NODE_BEFORE.parameters),
      after: clone(BUILD_PARAMETERS_AFTER)
    },
    {
      node_id: CLASSIFIER_NODE_ID,
      field_paths: ["type", "typeVersion", "parameters"],
      before: {
        type: CLASSIFIER_NODE_BEFORE.type,
        typeVersion: CLASSIFIER_NODE_BEFORE.typeVersion,
        parameters: clone(CLASSIFIER_NODE_BEFORE.parameters)
      },
      after: {
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.4,
        parameters: clone(CLASSIFIER_PARAMETERS_AFTER)
      }
    },
    {
      node_id: VALIDATOR_NODE_ID,
      field_paths: ["parameters"],
      before: clone(VALIDATOR_NODE_BEFORE.parameters),
      after: clone(VALIDATOR_PARAMETERS_AFTER)
    }
  ];
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
      workflow_id: bundle.workflow_id,
      prepared_against: bundle.prepared_against,
      before: {
        node_count: draft.nodes.length,
        connection_source_count: Object.keys(draft.connections).length,
        graph_sha256: graphHash(draft)
      },
      after: {
        node_count: candidate.nodes.length,
        connection_source_count: Object.keys(candidate.connections).length,
        graph_sha256: graphHash(candidate)
      },
      added_nodes: [clone(RESEARCH_GATE_NODE), clone(RESEARCH_NODE), clone(PREPARE_NODE)],
      changed_nodes: changedNodeFields,
      connections: {
        before: clone(draft.connections),
        after: clone(candidate.connections)
      },
      settings_unchanged: true,
      activation_unchanged: true
    },
    "expected-diff.json": {
      workflow_id: bundle.workflow_id,
      forward_operation_count: bundle.forward.operations.length,
      reverse_operation_count: bundle.reverse.operations.length,
      expected: bundle.expected,
      allowed_existing_node_fields: changedNodeFields.map((item) => ({
        node_id: item.node_id,
        field_paths: item.field_paths,
        before_sha256: sha256(JSON.stringify(deepSort(item.before))),
        after_sha256: sha256(JSON.stringify(deepSort(item.after)))
      })),
      settings_unchanged: true,
      activation_unchanged: true,
      every_other_existing_node_field_unchanged: true
    }
  };
}

if (process.argv.includes("--print-artifacts")) {
  process.stdout.write(JSON.stringify(createArtifactFiles(), null, 2) + "\n");
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(createPatchBundle(), null, 2) + "\n");
}
