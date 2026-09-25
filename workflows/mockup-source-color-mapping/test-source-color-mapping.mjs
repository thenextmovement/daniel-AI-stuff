import assert from "node:assert/strict";
import {
  resolveDesignIndexedValue,
} from "./source-color-mapping.mjs";
import { assertProductionFixture, patchWorkflow } from "./patch-workflow.mjs";

assert.deepEqual(assertProductionFixture(), ["Warmweiß", "Orange"]);

assert.equal(
  resolveDesignIndexedValue({ 1: "Warmweiß", 2: "Orange" }, 1, 2),
  "Orange",
  "legacy one-row-per-design cards keep their direct Color_2 mapping",
);

assert.equal(
  resolveDesignIndexedValue({ 1: "Rot", 2: "Rot", 3: "Blau", 4: "Blau" }, 1, 2),
  "Blau",
);

assert.equal(
  resolveDesignIndexedValue({ 1: "Mehrfarbig", 2: "Mehrfarbig" }, 0, 1),
  "Mehrfarbig",
);

const workflow = {
  nodes: [
    {
      name: "Extract & Validate",
      parameters: {
        jsCode: [
          "function normalizeColorText(value) { return value; }",
          "  let slotPlans = slotsToProcess.map(p => {",
          "    const requestedLightColor = lightColorsByIndex[p.linkedItemIndex + 1] || titleColor;",
          "  });",
        ].join("\n"),
      },
    },
  ],
};
const patched = patchWorkflow(workflow);
const code = patched.nodes[0].parameters.jsCode;
assert.match(code, /function resolveDesignIndexedValue/);
assert.match(
  code,
  /resolveDesignIndexedValue\(lightColorsByIndex, p\.linkedItemIndex, designTargets\.length\)/,
);
assert.doesNotMatch(code, /lightColorsByIndex\[p\.linkedItemIndex \+ 1\]/);

const patchedAgain = patchWorkflow(patched);
assert.equal(
  patchedAgain.nodes[0].parameters.jsCode,
  code,
  "workflow patch is idempotent",
);

console.log("mockup source color mapping tests: ok");

