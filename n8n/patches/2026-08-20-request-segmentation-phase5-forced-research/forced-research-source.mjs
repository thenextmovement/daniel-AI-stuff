import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WORKFLOW_ID = "ELpwCfdWOCRZ22gy";
export const TAXONOMY_VERSION = "nt_taxonomy_v2_20260819_cx8";
export const CLASSIFIER_VERSION_BEFORE = "segment_classifier_v3_20260819_cx8";
export const CLASSIFIER_VERSION_AFTER = "segment_classifier_v4_20260820_cx8";
export const PROMPT_VERSION = "segment_prompt_v4_20260819_cx8";
export const QUALITY_GATE_VERSION_BEFORE = "nt_quality_gate_v2_20260819_cx8";
export const QUALITY_GATE_VERSION_AFTER = "nt_quality_gate_v3_20260820_cx8";
export const POLICY_VERSION_BEFORE = "nt_policy_v2_20260819_cx8_shadow";
export const POLICY_VERSION_AFTER = "nt_policy_v3_20260820_cx8_shadow";
export const ACCEPTED_BY_BEFORE = "n8n-request-segmenter-v3";
export const ACCEPTED_BY_AFTER = "n8n-request-segmenter-v4";
export const VALIDATOR_VERSION = "n8n_cx8_validator_v1";
export const LOCK_OWNER_BEFORE = "n8n-request-segmenter-v3-cx8-shadow";
export const LOCK_OWNER_AFTER = "n8n-request-segmenter-v4-cx8-shadow";

export const CLAIM_NODE_ID = "claim-jobs";
export const BUILD_NODE_ID = "build-prompt";
export const CLASSIFIER_NODE_ID = "openai-classifier";
export const VALIDATOR_NODE_ID = "validate-output";

const PATCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_PATH = path.resolve(
  PATCH_DIR,
  "../../backups/2026-08-20-request-segmentation-phase5-forced-research/ELpwCfdWOCRZ22gy.draft-before.json"
);
const PRESTATE = JSON.parse(fs.readFileSync(BACKUP_PATH, "utf8"));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireNode(nodeId) {
  const node = PRESTATE.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error("Pinned workflow is missing node " + nodeId);
  return node;
}

function replaceExactly(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error("Expected exactly one " + label + " in the pinned Phase-4 source.");
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export const CLAIM_PARAMETERS_BEFORE = clone(requireNode(CLAIM_NODE_ID).parameters);
export const BUILD_CODE_BEFORE = requireNode(BUILD_NODE_ID).parameters.jsCode;
export const CLASSIFIER_NODE_BEFORE = clone(requireNode(CLASSIFIER_NODE_ID));
export const VALIDATOR_CODE_BEFORE = requireNode(VALIDATOR_NODE_ID).parameters.jsCode;

export const CLAIM_PARAMETERS_AFTER = {
  ...clone(CLAIM_PARAMETERS_BEFORE),
  jsonBody: replaceExactly(
    replaceExactly(
      CLAIM_PARAMETERS_BEFORE.jsonBody,
      LOCK_OWNER_BEFORE,
      LOCK_OWNER_AFTER,
      "Claim lock owner"
    ),
    CLASSIFIER_VERSION_BEFORE,
    CLASSIFIER_VERSION_AFTER,
    "Claim classifier version"
  )
};

const VERSIONED_BUILD_CODE = [
  [POLICY_VERSION_BEFORE, POLICY_VERSION_AFTER, "Build policy version"],
  [CLASSIFIER_VERSION_BEFORE, CLASSIFIER_VERSION_AFTER, "Build classifier version"],
  [QUALITY_GATE_VERSION_BEFORE, QUALITY_GATE_VERSION_AFTER, "Build quality-gate version"]
].reduce(
  (source, [before, after, label]) => replaceExactly(source, before, after, label),
  BUILD_CODE_BEFORE
);

export const VALIDATOR_CODE_AFTER = [
  [CLASSIFIER_VERSION_BEFORE, CLASSIFIER_VERSION_AFTER, "Validator classifier version"],
  [ACCEPTED_BY_BEFORE, ACCEPTED_BY_AFTER, "Validator accepted_by"]
].reduce(
  (source, [before, after, label]) => replaceExactly(source, before, after, label),
  VALIDATOR_CODE_BEFORE
);

const OLD_TEXT_OPTIONS =
  CLASSIFIER_NODE_BEFORE.parameters.options.textFormat.textOptions;
export const STRICT_OUTPUT_SCHEMA = JSON.parse(OLD_TEXT_OPTIONS.schema);

const schemaLiteral = JSON.stringify(STRICT_OUTPUT_SCHEMA);
const descriptionLiteral = JSON.stringify(OLD_TEXT_OPTIONS.description);
const nameLiteral = JSON.stringify(OLD_TEXT_OPTIONS.name);

export const LEGACY_COMPLEX_RESPONSES_JSON_BODY_EXPRESSION = [
  "={{ JSON.stringify({",
  "  model: 'gpt-4o-mini',",
  "  input: [",
  "    { role: 'system', content: $json.systemPrompt },",
  "    { role: 'user', content: $json.userPrompt }",
  "  ],",
  "  tools: $json.researchPolicy && $json.researchPolicy.external_research_required === true",
  "    ? [{ type: 'web_search', search_context_size: 'medium', user_location: { type: 'approximate', country: 'DE' } }]",
  "    : [],",
  "  tool_choice: $json.researchPolicy && $json.researchPolicy.external_research_required === true ? 'required' : 'none',",
  "  temperature: 0.1,",
  "  max_output_tokens: 1400,",
  "  include: ['web_search_call.action.sources'],",
  "  store: true,",
  "  text: {",
  "    format: {",
  "      type: 'json_schema',",
  "      name: " + nameLiteral + ",",
  "      description: " + descriptionLiteral + ",",
  "      strict: true,",
  "      schema: " + schemaLiteral,
  "    }",
  "  }",
  "}) }}"
].join("\n");

const RESPONSES_REQUEST_BODY_CODE = [
  "  const responsesRequestBody = {",
  "    model: \"gpt-4o-mini\",",
  "    input: [",
  "      { role: \"system\", content: systemPrompt },",
  "      { role: \"user\", content: userPrompt }",
  "    ],",
  "    tools: researchPolicy.external_research_required === true",
  "      ? [{ type: \"web_search\", search_context_size: \"medium\", user_location: { type: \"approximate\", country: \"DE\" } }]",
  "      : [],",
  "    tool_choice: researchPolicy.external_research_required === true ? \"required\" : \"none\",",
  "    temperature: 0.1,",
  "    max_output_tokens: 1400,",
  "    include: [\"web_search_call.action.sources\"],",
  "    store: true,",
  "    text: {",
  "      format: {",
  "        type: \"json_schema\",",
  "        name: " + nameLiteral + ",",
  "        description: " + descriptionLiteral + ",",
  "        strict: true,",
  "        schema: " + schemaLiteral,
  "      }",
  "    }",
  "  };"
].join("\n");

const BUILD_RETURN_MARKER = "\n\n  return [{";
const BUILD_RETURN_WITH_BODY = [
  "",
  "",
  RESPONSES_REQUEST_BODY_CODE,
  "",
  "  return [{"
].join("\n");

const BUILD_WITH_REQUEST_BODY = replaceExactly(
  VERSIONED_BUILD_CODE,
  BUILD_RETURN_MARKER,
  BUILD_RETURN_WITH_BODY,
  "Build request-body insertion point"
);

export const BUILD_CODE_AFTER = replaceExactly(
  BUILD_WITH_REQUEST_BODY,
  "      userPrompt\n",
  "      userPrompt,\n      responsesRequestBody\n",
  "Build request-body output"
);

export const RESPONSES_JSON_BODY_EXPRESSION =
  "={{ JSON.stringify($json.responsesRequestBody) }}";

export const CLASSIFIER_PARAMETERS_AFTER = {
  method: "POST",
  url: "https://api.openai.com/v1/responses",
  authentication: "predefinedCredentialType",
  nodeCredentialType: "openAiApi",
  sendHeaders: true,
  headerParameters: {
    parameters: [
      {
        name: "Content-Type",
        value: "application/json"
      }
    ]
  },
  sendBody: true,
  contentType: "json",
  specifyBody: "json",
  jsonBody: RESPONSES_JSON_BODY_EXPRESSION,
  options: {
    response: {
      response: {
        neverError: false,
        responseFormat: "json"
      }
    }
  }
};

export function evaluateResponsesJsonBody(source) {
  const expression = RESPONSES_JSON_BODY_EXPRESSION.slice(3, -2).trim();
  const evaluate = new Function("$json", "return " + expression + ";");
  return JSON.parse(evaluate(source));
}

export function evaluateLegacyResponsesJsonBody(source) {
  const expression = LEGACY_COMPLEX_RESPONSES_JSON_BODY_EXPRESSION.slice(3, -2).trim();
  const evaluate = new Function("$json", "return " + expression + ";");
  return JSON.parse(evaluate(source));
}

export function promptConstructionSource(code) {
  const start = code.indexOf("  const systemPrompt = [");
  const requestBodyStart = code.indexOf("\n  const responsesRequestBody =", start);
  const returnStart = code.indexOf("\n  return [{", start);
  const end = requestBodyStart >= 0 ? requestBodyStart : returnStart;
  if (start < 0 || end < 0) throw new Error("Build source is missing prompt construction.");
  return code.slice(start, end);
}
