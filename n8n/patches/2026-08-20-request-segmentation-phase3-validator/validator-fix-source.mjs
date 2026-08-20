import { VALIDATOR_CODE as PHASE2_VALIDATOR_CODE } from "../2026-08-19-request-segmentation-phase2-cx8/cx8-contract-source.mjs";

const CONTRACT_ERROR_BEFORE = [
  "  function contractError(name, message) {",
  "    const error = new Error(message);",
  "    error.name = name;",
  "    throw error;",
  "  }"
].join("\n");

const CONTRACT_ERROR_AFTER = [
  "  function contractError(name, message) {",
  "    throw new Error(name + \": \" + message);",
  "  }"
].join("\n");

const OUTPUT_SEARCH_BEFORE = [
  "  function findStructuredOutput(value) {",
  "    if (value == null) return null;",
  "    if (typeof value === \"string\") return value;",
  "    if (typeof value === \"object\") {",
  "      if (Object.prototype.hasOwnProperty.call(value, \"taxonomy_version\")",
  "          && Object.prototype.hasOwnProperty.call(value, \"decision\")",
  "          && Object.prototype.hasOwnProperty.call(value, \"confidence\")) return value;",
  "      if (typeof value.output_text === \"string\") return value.output_text;",
  "      if (typeof value.text === \"string\") return value.text;",
  "      if (value.text && typeof value.text === \"object\") return value.text;",
  "      if (Array.isArray(value.output)) {",
  "        for (const item of value.output) {",
  "          const found = findStructuredOutput(item);",
  "          if (found) return found;",
  "        }",
  "      }",
  "      if (Array.isArray(value.content)) {",
  "        for (const item of value.content) {",
  "          const found = findStructuredOutput(item);",
  "          if (found) return found;",
  "        }",
  "      }",
  "      if (value.message && typeof value.message === \"object\") return findStructuredOutput(value.message);",
  "    }",
  "    return null;",
  "  }"
].join("\n");

const OUTPUT_SEARCH_AFTER = [
  "  function findStructuredOutput(value) {",
  "    if (value == null) return null;",
  "    if (typeof value === \"string\") return value;",
  "    if (typeof value === \"object\") {",
  "      if (Object.prototype.hasOwnProperty.call(value, \"taxonomy_version\")",
  "          && Object.prototype.hasOwnProperty.call(value, \"decision\")",
  "          && Object.prototype.hasOwnProperty.call(value, \"confidence\")) return value;",
  "      if (Array.isArray(value.output)) {",
  "        for (const item of value.output) {",
  "          const found = findStructuredOutput(item);",
  "          if (found) return found;",
  "        }",
  "      }",
  "      if (Array.isArray(value.content)) {",
  "        for (const item of value.content) {",
  "          const found = findStructuredOutput(item);",
  "          if (found) return found;",
  "        }",
  "      }",
  "      if (typeof value.output_text === \"string\") return value.output_text;",
  "      if (typeof value.text === \"string\") return value.text;",
  "      if (hasExactKeys(value.text, EXPECTED_OUTPUT_KEYS)) return value.text;",
  "      if (value.message && typeof value.message === \"object\") return findStructuredOutput(value.message);",
  "    }",
  "    return null;",
  "  }"
].join("\n");

function replaceExactly(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error("Expected exactly one " + label + " block in the deployed Phase-2 Validator.");
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export const VALIDATOR_CODE_BEFORE = PHASE2_VALIDATOR_CODE;
export const VALIDATOR_CODE_AFTER = replaceExactly(
  replaceExactly(
    VALIDATOR_CODE_BEFORE,
    CONTRACT_ERROR_BEFORE,
    CONTRACT_ERROR_AFTER,
    "contractError"
  ),
  OUTPUT_SEARCH_BEFORE,
  OUTPUT_SEARCH_AFTER,
  "findStructuredOutput"
);
