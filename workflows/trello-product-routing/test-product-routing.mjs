import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCT_1_OPTIONS,
  WORKFLOW_IDS,
  patchWorkflowById,
  product1OptionIdFromValidatedProduct,
  product1OptionTextFromTitle,
} from "./product-routing.mjs";

test("maps the first Trello title segment to Product 1", () => {
  const cases = [
    ["LED Neon Flex | Anna", PRODUCT_1_OPTIONS.neon.text],
    ["LED Neon | Anna", PRODUCT_1_OPTIONS.neon.text],
    ["LED Flex | Anna", PRODUCT_1_OPTIONS.neon.text],
    ["Full Glow | Anna", PRODUCT_1_OPTIONS.fullGlow.text],
    ["Neon-Halo | Anna", PRODUCT_1_OPTIONS.neon.text],
    ["Ultrathin Acrylic Lightbox | Anna", PRODUCT_1_OPTIONS.ultraThin.text],
    ["Ultra Thin Acrylic | Anna", PRODUCT_1_OPTIONS.ultraThin.text],
    ["3D Frontlit | Anna", PRODUCT_1_OPTIONS.frontlit.text],
    ["3D Backlit + 3D NONLIT | Anna", PRODUCT_1_OPTIONS.backlit.text],
    ["3D Nonlit | Anna", PRODUCT_1_OPTIONS.nonlit.text],
    ["Non Lit | Anna", PRODUCT_1_OPTIONS.nonlit.text],
    ["Light Box | Anna", PRODUCT_1_OPTIONS.lightbox.text],
    ["Double-Sided Lightbox | Anna", PRODUCT_1_OPTIONS.lightbox.text],
  ];
  for (const [title, expected] of cases) assert.equal(product1OptionTextFromTitle(title), expected, title);
});

test("does not guess Product 1 from a customer name or unknown product", () => {
  assert.equal(product1OptionTextFromTitle("Neon Digital GmbH | 100cm"), null);
  assert.equal(product1OptionTextFromTitle("Anna Beispiel | 100cm"), null);
  assert.equal(product1OptionTextFromTitle("Marquee | Anna"), null);
});

test("validated products use independent Full Glow and Ultrathin dropdowns", () => {
  assert.equal(product1OptionIdFromValidatedProduct("LED Neon Flex"), PRODUCT_1_OPTIONS.neon.id);
  assert.equal(product1OptionIdFromValidatedProduct("Full Glow"), PRODUCT_1_OPTIONS.fullGlow.id);
  assert.equal(product1OptionIdFromValidatedProduct("Ultrathin Acrylic Lightbox"), PRODUCT_1_OPTIONS.ultraThin.id);
  assert.equal(product1OptionIdFromValidatedProduct("3D Multi-Variant"), PRODUCT_1_OPTIONS.backlit.id);
  assert.equal(product1OptionIdFromValidatedProduct("Unknown"), null);
});

function prepareWorkflow(jsCode) {
  return {
    name: "fixture",
    nodes: [{ name: "Prepare Field Data", parameters: { jsCode } }],
    connections: {},
    settings: {},
  };
}

test("replaces a hard-coded Product 1 writer without adding Product 2", () => {
  const workflow = prepareWorkflow(`const updates = [];
const product1Field = customFields.find(f => true);
if (product1Field) updates.push({ field: 'Product 1', idValue: 'always-neon' });
return updates.map(u => ({ json: u }));`);
  const patched = patchWorkflowById(WORKFLOW_IDS.unstructured, workflow);
  const code = patched.nodes[0].parameters.jsCode;
  assert.match(code, /product1OptionFromTitle/);
  assert.match(code, /function normalizeText/);
  assert.match(code, /ultra\\s\*-/i);
  assert.doesNotMatch(code, /always-neon/);
  assert.doesNotMatch(code, /Product 2|product_2/i);
});

test("keeps the landing-page item shape when adding Product 1", () => {
  const workflow = prepareWorkflow(`const updates = [];
const product1Field = customFields.find(f => true);
if (product1Field) updates.push({ json: { fieldName: 'Product 1', customFieldPayload: { idValue: 'old' } } });
return updates.map(item => item.json.customFieldPayload ? item : ({ json: item }));`);
  const patched = patchWorkflowById(WORKFLOW_IDS.landingPage, workflow);
  const code = patched.nodes[0].parameters.jsCode;
  assert.match(code, /updates\.push\(\{ json: \{ customFieldId:/);
  assert.match(code, /return updates\.map\(item => item\.json\.customFieldPayload/);
  assert.doesNotMatch(code, /Product 2|product_2/i);
});

function quotingFixture() {
  const allowedProducts = "'LED Neon Flex','3D Frontlit','3D Backlit','3D Nonlit','3D Multi-Variant','Lightbox','Double-Sided Lightbox','Ultrathin Acrylic Lightbox','Unknown'";
  return {
    name: "quoting",
    nodes: [
      { name: "Restore Decision", parameters: {} },
      { name: "Trello: Project Decision", parameters: {} },
      { name: "Build Multimodal Request", parameters: { jsCode: `const schema={product_type:{enum:[${allowedProducts}]}}; Return only schema-valid JSON.` } },
      { name: "Build Text-Only Request", parameters: { jsCode: `const schema={product_type:{enum:[${allowedProducts}]}}; Return schema-valid JSON only.` } },
      { name: "Validate and Gate", parameters: { jsCode: `const allowedProducts=[${allowedProducts}]; const exactRequestedSizeProduct=['3D Frontlit','3D Backlit','3D Nonlit','3D Multi-Variant'].includes(finalProduct); const titleProductMap={'Ultrathin Acrylic Lightbox':'Ultrathin Acrylic Lightbox','Lightbox':'Lightbox'};` } },
      {
        name: "Trello: Set Mockup Description",
        parameters: {},
        credentials: { trelloApi: { id: "fixture", name: "Trello fixture" } },
      },
    ],
    connections: {
      "Trello: Project Decision": {
        main: [[{ node: "Trello: Set Mockup Description", type: "main", index: 0 }]],
      },
    },
    settings: {},
  };
}

test("adds an idempotent Product 1 projection branch to the quoting workflow", () => {
  const patched = patchWorkflowById(WORKFLOW_IDS.quotingAgent, quotingFixture());
  const setNode = patched.nodes.find((node) => node.name === "Trello: Set Product 1");
  assert.ok(setNode);
  assert.equal(setNode.parameters.method, "PUT");
  assert.equal(setNode.retryOnFail, true);
  assert.deepEqual(setNode.credentials, { trelloApi: { id: "fixture", name: "Trello fixture" } });
  assert.match(setNode.parameters.url, /customField\/6a671cb3ffd9bae3b3cb285b\/item/);
  assert.match(setNode.parameters.jsonBody, new RegExp(PRODUCT_1_OPTIONS.fullGlow.id));
  assert.match(setNode.parameters.jsonBody, new RegExp(PRODUCT_1_OPTIONS.ultraThin.id));
  assert.doesNotMatch(JSON.stringify(patched), /Product 2|product_2|6a671cfbcf537003c2e055a9/i);

  const multimodal = patched.nodes.find((node) => node.name === "Build Multimodal Request").parameters.jsCode;
  const gate = patched.nodes.find((node) => node.name === "Validate and Gate").parameters.jsCode;
  assert.match(multimodal, /FULL GLOW RULE/);
  assert.match(multimodal, /'LED Neon Flex','Full Glow','3D Frontlit'/);
  assert.match(gate, /exactRequestedSizeProduct=\['Full Glow','3D Frontlit'/);
  assert.match(gate, /'Full Glow':'Full Glow'/);

  const twice = patchWorkflowById(WORKFLOW_IDS.quotingAgent, patched);
  assert.equal(twice.nodes.filter((node) => node.name === "Trello: Set Product 1").length, 1);
  assert.equal(
    twice.connections["Trello: Project Decision"].main[0].filter((entry) => entry.node === "Product 1 recognized?").length,
    1,
  );
});
