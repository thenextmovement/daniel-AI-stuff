import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  BUILD_PROMPT_CODE,
  CLAIM_BODY_AFTER,
  CLAIM_BODY_BEFORE,
  CLAIM_URL_AFTER,
  CLAIM_URL_BEFORE,
  CLASSIFIER_SCHEMA,
  FAILURE_PAYLOAD_CODE,
  VALIDATOR_CODE,
  WORKFLOW_ID
} from "./cx8-contract-source.mjs";

const PATCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const PRESTATE_DIR = path.resolve(
  PATCH_DIR,
  "../../backups/2026-08-19-request-segmentation-phase2-cx8"
);
const MANIFEST_PATH = path.join(PRESTATE_DIR, "manifest.json");

const NODE_IDS = {
  claim: "claim-jobs",
  build: "build-prompt",
  openai: "openai-classifier",
  validator: "validate-output",
  failure: "build-failure-payload",
  record: "record-classification"
};

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

function graphHash(workflow) {
  const graph = {
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings
  };
  return sha256(`${JSON.stringify(deepSort(graph))}\n`);
}

function requireNode(workflow, nodeId) {
  const node = workflow.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error(`Prepared workflow is missing node ${nodeId}`);
  return node;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertPreparedPrestate(workflow, manifest, rawDraft) {
  if (manifest.workflow_id !== WORKFLOW_ID || workflow.id !== WORKFLOW_ID) {
    throw new Error("Workflow id does not match the pinned NEONTRIP segmenter.");
  }
  if (!manifest.active || manifest.is_archived || !manifest.draft_active_graphs_equal) {
    throw new Error("Pinned prestate is not the active, non-archived equal draft/active graph.");
  }
  if (manifest.draft_version_id !== "9728db44-1dde-4b92-bcc7-defd60b063d3"
      || manifest.active_version_id !== manifest.draft_version_id
      || manifest.version_counter !== 112) {
    throw new Error("Pinned workflow version/counter changed.");
  }
  if (sha256(rawDraft) !== manifest.hashes.draft_file_sha256) {
    throw new Error("Draft prestate file hash changed.");
  }
  if (graphHash(workflow) !== manifest.hashes.graph_sha256) {
    throw new Error("Draft prestate graph hash changed.");
  }

  const claim = requireNode(workflow, NODE_IDS.claim);
  const build = requireNode(workflow, NODE_IDS.build);
  const openai = requireNode(workflow, NODE_IDS.openai);
  const validator = requireNode(workflow, NODE_IDS.validator);
  const failure = requireNode(workflow, NODE_IDS.failure);
  const record = requireNode(workflow, NODE_IDS.record);

  if (claim.parameters.jsonBody !== CLAIM_BODY_BEFORE) {
    throw new Error("Claim node no longer matches the pinned Phase-1 prestate.");
  }
  if (claim.parameters.url !== CLAIM_URL_BEFORE) {
    throw new Error("Claim node URL no longer matches the pinned Phase-1 by-source endpoint.");
  }
  if (!build.parameters.jsCode.includes("segment_prompt_v3_20260819_db_domain_facts")
      || !build.parameters.jsCode.includes("segment_classifier_v2_20260819_db_authority")) {
    throw new Error("Build node no longer matches the pinned Phase-1 contract.");
  }
  if (Object.prototype.hasOwnProperty.call(openai.parameters, "simplify")) {
    throw new Error("OpenAI simplify prestate is expected to be absent (default true).");
  }
  const oldSchema = JSON.parse(openai.parameters.options.textFormat.textOptions.schema);
  if (!oldSchema.properties.segment.enum.includes("NT-18")
      || oldSchema.properties.segment.enum.length !== 18) {
    throw new Error("OpenAI schema no longer matches the pinned 18-code prestate.");
  }
  if (!validator.parameters.jsCode.includes("n8n-request-segmenter-v2")) {
    throw new Error("Validator node no longer matches the pinned Phase-1 contract.");
  }
  if (!failure.parameters.jsCode.includes("const jobId = job.id || item.id || item.job_id || rpcBody.p_job_id")) {
    throw new Error("Failure payload node no longer matches the pinned Phase-1 lineage fallback.");
  }
  if (record.parameters.url
      !== "https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/neontrip_record_request_segment_classification"
      || record.parameters.jsonBody !== "={{ JSON.stringify($json.rpcBody) }}") {
    throw new Error("Record node no longer matches the preserved RPC handoff.");
  }
}

export function loadPreparedPrestate() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const draftPath = path.join(PRESTATE_DIR, manifest.files.draft);
  const rawDraft = fs.readFileSync(draftPath, "utf8");
  const workflow = JSON.parse(rawDraft);
  assertPreparedPrestate(workflow, manifest, rawDraft);
  return { workflow, manifest, draftPath };
}

export function createPatchBundle() {
  const { workflow, manifest, draftPath } = loadPreparedPrestate();
  const claim = requireNode(workflow, NODE_IDS.claim);
  const build = requireNode(workflow, NODE_IDS.build);
  const openai = requireNode(workflow, NODE_IDS.openai);
  const validator = requireNode(workflow, NODE_IDS.validator);
  const failure = requireNode(workflow, NODE_IDS.failure);
  const schemaBefore = openai.parameters.options.textFormat.textOptions.schema;
  const schemaAfter = JSON.stringify(CLASSIFIER_SCHEMA);

  const forwardOperations = [
    {
      type: "updateNode",
      nodeId: NODE_IDS.claim,
      updates: {
        "parameters.url": CLAIM_URL_AFTER,
        "parameters.jsonBody": CLAIM_BODY_AFTER
      }
    },
    {
      type: "updateNode",
      nodeId: NODE_IDS.build,
      updates: { "parameters.jsCode": BUILD_PROMPT_CODE }
    },
    {
      type: "updateNode",
      nodeId: NODE_IDS.openai,
      updates: {
        "parameters.simplify": false,
        "parameters.options.textFormat.textOptions.schema": schemaAfter
      }
    },
    {
      type: "updateNode",
      nodeId: NODE_IDS.validator,
      updates: { "parameters.jsCode": VALIDATOR_CODE }
    },
    {
      type: "updateNode",
      nodeId: NODE_IDS.failure,
      updates: { "parameters.jsCode": FAILURE_PAYLOAD_CODE }
    }
  ];

  const reverseOperations = [
    {
      type: "updateNode",
      nodeId: NODE_IDS.failure,
      updates: { "parameters.jsCode": failure.parameters.jsCode }
    },
    {
      type: "updateNode",
      nodeId: NODE_IDS.validator,
      updates: { "parameters.jsCode": validator.parameters.jsCode }
    },
    {
      type: "updateNode",
      nodeId: NODE_IDS.openai,
      updates: {
        "parameters.options.textFormat.textOptions.schema": schemaBefore,
        "parameters.simplify": null
      }
    },
    {
      type: "updateNode",
      nodeId: NODE_IDS.build,
      updates: { "parameters.jsCode": build.parameters.jsCode }
    },
    {
      type: "updateNode",
      nodeId: NODE_IDS.claim,
      updates: {
        "parameters.url": claim.parameters.url,
        "parameters.jsonBody": claim.parameters.jsonBody
      }
    }
  ];

  const expectedDiff = [
    [NODE_IDS.claim, "parameters.url", claim.parameters.url, CLAIM_URL_AFTER, true],
    [NODE_IDS.claim, "parameters.jsonBody", claim.parameters.jsonBody, CLAIM_BODY_AFTER, true],
    [NODE_IDS.build, "parameters.jsCode", build.parameters.jsCode, BUILD_PROMPT_CODE, true],
    [NODE_IDS.openai, "parameters.simplify", undefined, false, false],
    [
      NODE_IDS.openai,
      "parameters.options.textFormat.textOptions.schema",
      schemaBefore,
      schemaAfter,
      true
    ],
    [NODE_IDS.validator, "parameters.jsCode", validator.parameters.jsCode, VALIDATOR_CODE, true],
    [NODE_IDS.failure, "parameters.jsCode", failure.parameters.jsCode, FAILURE_PAYLOAD_CODE, true]
  ].map(([nodeId, fieldPath, before, after, existedBefore]) => ({
    node_id: nodeId,
    field_path: fieldPath,
    existed_before: existedBefore,
    before_sha256: sha256(before === undefined ? "<absent>" : String(before)),
    after_sha256: sha256(String(after))
  }));

  const intent = "Prepare the pinned NEONTRIP CX8/v3 request-segmentation contract without changing topology, credentials, trigger, activation, or Record RPC.";
  return {
    artifact_version: "neontrip_n8n_phase2_cx8_v2",
    workflow_id: WORKFLOW_ID,
    prepared_against: {
      draft_path: draftPath,
      captured_at_utc: manifest.captured_at_utc,
      draft_version_id: manifest.draft_version_id,
      active_version_id: manifest.active_version_id,
      version_counter: manifest.version_counter,
      draft_file_sha256: manifest.hashes.draft_file_sha256,
      graph_sha256: manifest.hashes.graph_sha256,
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
      intent: "Reverse only the prepared NEONTRIP CX8/v3 node-field delta to the pinned Phase-2 prestate.",
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
      intent: "Validate the prepared NEONTRIP CX8/v3 forward and exact reverse operations as one non-writing roundtrip.",
      operations: [...forwardOperations, ...reverseOperations],
      validateOnly: true,
      continueOnError: false
    },
    expected_diff: expectedDiff,
    preserved: {
      record_node_id: NODE_IDS.record,
      record_rpc_url: requireNode(workflow, NODE_IDS.record).parameters.url,
      record_json_body: requireNode(workflow, NODE_IDS.record).parameters.jsonBody,
      topology: true,
      credentials: true,
      trigger: true,
      settings: true,
      activation: true,
      node_count: true
    },
    safety: {
      prepared_only: true,
      no_live_write_performed: true,
      no_publish_performed: true,
      no_activation_change_performed: true,
      no_manual_execution_performed: true
    }
  };
}

function setAtPath(target, dottedPath, value) {
  const parts = dottedPath.split(".");
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor = cursor[parts[index]];
  }
  const finalKey = parts[parts.length - 1];
  if (value === null) delete cursor[finalKey];
  else cursor[finalKey] = clone(value);
}

export function applyOperationsInMemory(workflow, operations) {
  const result = clone(workflow);
  for (const operation of operations) {
    if (operation.type !== "updateNode") {
      throw new Error(`Offline patch harness does not support ${operation.type}`);
    }
    const node = requireNode(result, operation.nodeId);
    for (const [fieldPath, value] of Object.entries(operation.updates)) {
      setAtPath(node, fieldPath, value);
    }
  }
  return result;
}

if (process.argv[1]
    && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.stdout.write(`${JSON.stringify(createPatchBundle(), null, 2)}\n`);
}
