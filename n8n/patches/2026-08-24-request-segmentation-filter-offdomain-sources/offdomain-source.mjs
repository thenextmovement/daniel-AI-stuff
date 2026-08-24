import {
  PREPARE_CODE as PREPARE_CODE_BEFORE,
  PREPARE_NODE as PREPARE_NODE_BEFORE,
  WORKFLOW_ID
} from "../2026-08-21-request-segmentation-treatment-shadow-always-on/treatment-shadow-source.mjs";

export { WORKFLOW_ID };
export const PREPARE_NODE_ID = "treatment-shadow-prepare-classification";

export const DOMAIN_SCOPE_BEFORE = [
  "        if (source.researchPlan.lookup_type === \"domain\") {",
  "          const expectedDomain = normalizeDnsHostname(source.researchPlan.lookup_value);",
  "          if (!expectedDomain",
  "              || (parsedUrl.dbHostname !== expectedDomain",
  "                && !parsedUrl.dbHostname.endsWith(\".\" + expectedDomain))) {",
  "            fail(\"treatment_shadow_research_domain_scope_invalid\",",
  "              \"Domain research returned a source outside the authorized domain.\");",
  "          }",
  "        }"
].join("\n");

export const DOMAIN_SCOPE_AFTER = [
  "        if (source.researchPlan.lookup_type === \"domain\") {",
  "          const expectedDomain = normalizeDnsHostname(source.researchPlan.lookup_value);",
  "          if (!expectedDomain) {",
  "            fail(\"treatment_shadow_research_domain_scope_invalid\",",
  "              \"The authorized research domain is invalid.\");",
  "          }",
  "          if (parsedUrl.dbHostname !== expectedDomain",
  "              && !parsedUrl.dbHostname.endsWith(\".\" + expectedDomain)) {",
  "            return;",
  "          }",
  "        }"
].join("\n");

function replaceExactly(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Expected exactly one ${label}.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export const PREPARE_CODE_AFTER = replaceExactly(
  PREPARE_CODE_BEFORE,
  DOMAIN_SCOPE_BEFORE,
  DOMAIN_SCOPE_AFTER,
  "exact-domain source rejection block"
);

export const PREPARE_NODE_AFTER = {
  ...structuredClone(PREPARE_NODE_BEFORE),
  parameters: {
    ...structuredClone(PREPARE_NODE_BEFORE.parameters),
    jsCode: PREPARE_CODE_AFTER
  }
};

export { PREPARE_CODE_BEFORE, PREPARE_NODE_BEFORE };
