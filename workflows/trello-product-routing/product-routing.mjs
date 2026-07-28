export const WORKFLOW_IDS = Object.freeze({
  landingPage: "FQ7lf36yje4B1eE3",
  unstructured: "AcYSau5MGsAxeAqL",
  quotingAgent: "EtEpzMp10EmaqXIS",
});

export const PRODUCT_1_FIELD_ID = "6a671cb3ffd9bae3b3cb285b";

export const PRODUCT_1_OPTIONS = Object.freeze({
  neon: Object.freeze({ id: "6a6902856fc44afc4d697f03", text: "LED Neon" }),
  frontlit: Object.freeze({ id: "6a671cb3ffd9bae3b3cb285d", text: "3d Frontlit" }),
  backlit: Object.freeze({ id: "6a671cb3ffd9bae3b3cb285e", text: "3d Backlit" }),
  nonlit: Object.freeze({ id: "6a671cb3ffd9bae3b3cb285f", text: "3d Nonlit" }),
  lightbox: Object.freeze({ id: "6a671cb3ffd9bae3b3cb2860", text: "Lightbox" }),
  fullGlow: Object.freeze({ id: "6a6902859b10c7f7a53970c3", text: "Full Glow" }),
  ultraThin: Object.freeze({ id: "6a69028505bf0f9b9057cc39", text: "Ultra Thin Acrylic" }),
});

function normalizedProductSegment(title) {
  return String(title || "")
    .split("|")[0]
    .trim()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[_\s]+/g, " ")
    .toLowerCase();
}

export function product1OptionTextFromTitle(title) {
  const segment = normalizedProductSegment(title);
  if (!segment) return null;
  if (/^ultra\s*-?\s*thin\s+acryl(?:ic)?(?:\s+lightbox)?(?:\b|\s|$)/.test(segment)) return PRODUCT_1_OPTIONS.ultraThin.text;
  if (/^full\s+glow(?:\b|\s|$)/.test(segment)) return PRODUCT_1_OPTIONS.fullGlow.text;
  if (/^(?:led\s+neon(?:\s+flex)?|led\s+flex|neon\s*-?\s*halo)(?:\b|\s|$)/.test(segment)) return PRODUCT_1_OPTIONS.neon.text;
  if (/^3\s*-?\s*d\s+front\s*-?\s*lit(?:\b|\s|$)/.test(segment)) return PRODUCT_1_OPTIONS.frontlit.text;
  if (/^3\s*-?\s*d\s+back\s*-?\s*lit(?:\b|\s|$)/.test(segment)) return PRODUCT_1_OPTIONS.backlit.text;
  if (/^(?:3\s*-?\s*d\s+)?non\s*-?\s*lit(?:\b|\s|$)/.test(segment)) return PRODUCT_1_OPTIONS.nonlit.text;
  if (/^(?:double\s*-?\s*sided\s+)?light\s*-?\s*box(?:\b|\s|$)/.test(segment)) return PRODUCT_1_OPTIONS.lightbox.text;
  return null;
}

export function product1OptionIdFromValidatedProduct(productType) {
  const mapping = {
    "LED Neon Flex": PRODUCT_1_OPTIONS.neon.id,
    "Full Glow": PRODUCT_1_OPTIONS.fullGlow.id,
    "Ultrathin Acrylic Lightbox": PRODUCT_1_OPTIONS.ultraThin.id,
    "3D Frontlit": PRODUCT_1_OPTIONS.frontlit.id,
    "3D Backlit": PRODUCT_1_OPTIONS.backlit.id,
    "3D Nonlit": PRODUCT_1_OPTIONS.nonlit.id,
    "3D Multi-Variant": PRODUCT_1_OPTIONS.backlit.id,
    Lightbox: PRODUCT_1_OPTIONS.lightbox.id,
    "Double-Sided Lightbox": PRODUCT_1_OPTIONS.lightbox.id,
  };
  return mapping[String(productType || "")] || null;
}

const n8nTitleResolver = `function product1OptionFromTitle(cardTitle) {
  const segment = normalizeText(cardTitle).split('|')[0].trim().replace(/[\\u2010-\\u2015]/g, '-').replace(/[_\\s]+/g, ' ').toLowerCase();
  if (/^ultra\\s*-?\\s*thin\\s+acryl(?:ic)?(?:\\s+lightbox)?(?:\\b|\\s|$)/.test(segment)) return 'Ultra Thin Acrylic';
  if (/^full\\s+glow(?:\\b|\\s|$)/.test(segment)) return 'Full Glow';
  if (/^(?:led\\s+neon(?:\\s+flex)?|led\\s+flex|neon\\s*-?\\s*halo)(?:\\b|\\s|$)/.test(segment)) return 'LED Neon';
  if (/^3\\s*-?\\s*d\\s+front\\s*-?\\s*lit(?:\\b|\\s|$)/.test(segment)) return '3d Frontlit';
  if (/^3\\s*-?\\s*d\\s+back\\s*-?\\s*lit(?:\\b|\\s|$)/.test(segment)) return '3d Backlit';
  if (/^(?:3\\s*-?\\s*d\\s+)?non\\s*-?\\s*lit(?:\\b|\\s|$)/.test(segment)) return '3d Nonlit';
  if (/^(?:double\\s*-?\\s*sided\\s+)?light\\s*-?\\s*box(?:\\b|\\s|$)/.test(segment)) return 'Lightbox';
  return null;
}`;

export const n8nTitleProjectionBlockLanding = `const product1Field = customFields.find(f => String(f.name || '').trim().toLowerCase() === 'product 1');
${n8nTitleResolver}
const productOptionText = product1OptionFromTitle($('Create Trello Card').item.json.name);
if (product1Field && productOptionText) {
  const option = (product1Field.options || []).find(o => normalizeText(o.value?.text).toLowerCase() === productOptionText.toLowerCase());
  const optionId = option?.id || option?._id;
  if (!optionId) throw new Error('Product 1 option not found: ' + productOptionText);
  updates.push({ json: { customFieldId: product1Field.id, cardId, fieldName: 'Product 1', customFieldPayload: { idValue: optionId } } });
}`;

export const n8nTitleProjectionBlockUnstructured = `const product1Field = customFields.find(f => String(f.name || '').trim().toLowerCase() === 'product 1');
function normalizeText(value) { return String(value || '').trim().replace(/\\s+/g, ' '); }
${n8nTitleResolver}
const productOptionText = product1OptionFromTitle($('Create Trello Card').item.json.name);
if (product1Field && productOptionText) {
  const option = (product1Field.options || []).find(o => norm(o.value?.text) === norm(productOptionText));
  const optionId = option?.id || option?._id;
  if (!optionId) throw new Error('Product 1 option not found: ' + productOptionText);
  updates.push({ field: 'Product 1', idValue: optionId });
}`;

function replaceProductProjection(jsCode, replacement) {
  const start = jsCode.indexOf("const product1Field =");
  const end = jsCode.indexOf("\nreturn updates", start);
  if (start < 0 || end < 0) throw new Error("Product-1 projection block not found");
  return jsCode.slice(0, start) + replacement + "\n" + jsCode.slice(end + 1);
}

export function patchPrepareFieldDataNode(workflow, mode) {
  const node = workflow.nodes.find((entry) => entry.name === "Prepare Field Data");
  if (!node?.parameters?.jsCode) throw new Error("Prepare Field Data node missing");
  const replacement = mode === "landing" ? n8nTitleProjectionBlockLanding : n8nTitleProjectionBlockUnstructured;
  node.parameters.jsCode = replaceProductProjection(node.parameters.jsCode, replacement);
  return workflow;
}

const validatedProductIdExpression = `({
  'LED Neon Flex': '${PRODUCT_1_OPTIONS.neon.id}',
  'Full Glow': '${PRODUCT_1_OPTIONS.fullGlow.id}',
  'Ultrathin Acrylic Lightbox': '${PRODUCT_1_OPTIONS.ultraThin.id}',
  '3D Frontlit': '${PRODUCT_1_OPTIONS.frontlit.id}',
  '3D Backlit': '${PRODUCT_1_OPTIONS.backlit.id}',
  '3D Nonlit': '${PRODUCT_1_OPTIONS.nonlit.id}',
  '3D Multi-Variant': '${PRODUCT_1_OPTIONS.backlit.id}',
  'Lightbox': '${PRODUCT_1_OPTIONS.lightbox.id}',
  'Double-Sided Lightbox': '${PRODUCT_1_OPTIONS.lightbox.id}'
})[$('Restore Decision').item.json.product_type] || ''`;

export function patchQuotingAgentWorkflow(workflow) {
  const trelloCredential = workflow.nodes.find((node) => node.credentials?.trelloApi)?.credentials?.trelloApi;
  if (!trelloCredential) throw new Error("Existing Trello credential reference missing");

  if (!workflow.nodes.some((node) => node.name === "Product 1 recognized?")) {
    workflow.nodes.push({
      id: "product-1-recognized",
      name: "Product 1 recognized?",
      type: "n8n-nodes-base.if",
      typeVersion: 2.3,
      position: [2860, -220],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
          combinator: "and",
          conditions: [{
            id: "product-1-known",
            leftValue: `={{ ${validatedProductIdExpression} }}`,
            rightValue: "",
            operator: { type: "string", operation: "isNotEmpty", singleValue: true },
          }],
        },
        options: {},
      },
    });
    workflow.nodes.push({
      id: "set-product-1",
      name: "Trello: Set Product 1",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.3,
      position: [3080, -220],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 1500,
      onError: "stopWorkflow",
      credentials: { trelloApi: structuredClone(trelloCredential) },
      parameters: {
        method: "PUT",
        url: `=https://api.trello.com/1/cards/{{ $('Restore Decision').item.json.approval.card_id }}/customField/${PRODUCT_1_FIELD_ID}/item`,
        authentication: "predefinedCredentialType",
        nodeCredentialType: "trelloApi",
        sendBody: true,
        specifyBody: "json",
        jsonBody: `={{ JSON.stringify({ idValue: ${validatedProductIdExpression} }) }}`,
        options: { timeout: 20000 },
      },
    });
  }

  const recognizedNode = workflow.nodes.find((node) => node.name === "Product 1 recognized?");
  const recognizedCondition = recognizedNode?.parameters?.conditions?.conditions?.[0];
  if (!recognizedCondition) throw new Error("Product 1 recognized condition missing");
  recognizedCondition.leftValue = `={{ ${validatedProductIdExpression} }}`;

  const setProductNode = workflow.nodes.find((node) => node.name === "Trello: Set Product 1");
  if (!setProductNode?.parameters) throw new Error("Trello: Set Product 1 node missing");
  setProductNode.parameters.url = `=https://api.trello.com/1/cards/{{ $('Restore Decision').item.json.approval.card_id }}/customField/${PRODUCT_1_FIELD_ID}/item`;
  setProductNode.parameters.jsonBody = `={{ JSON.stringify({ idValue: ${validatedProductIdExpression} }) }}`;

  const enumBefore = "'LED Neon Flex','3D Frontlit','3D Backlit','3D Nonlit','3D Multi-Variant','Lightbox','Double-Sided Lightbox','Ultrathin Acrylic Lightbox','Unknown'";
  const enumAfter = "'LED Neon Flex','Full Glow','3D Frontlit','3D Backlit','3D Nonlit','3D Multi-Variant','Lightbox','Double-Sided Lightbox','Ultrathin Acrylic Lightbox','Unknown'";
  for (const nodeName of ["Build Multimodal Request", "Build Text-Only Request", "Validate and Gate"]) {
    const node = workflow.nodes.find((entry) => entry.name === nodeName);
    if (!node?.parameters?.jsCode) throw new Error(`${nodeName} code missing`);
    node.parameters.jsCode = node.parameters.jsCode.replaceAll(enumBefore, enumAfter);
  }

  for (const nodeName of ["Build Multimodal Request", "Build Text-Only Request"]) {
    const node = workflow.nodes.find((entry) => entry.name === nodeName);
    const rule = "FULL GLOW RULE: When the title or original customer message explicitly names Full Glow or fully illuminated acrylic letters, classify product_type as \"Full Glow\". Full Glow is independent from LED Neon Flex, uses line_style \"not applicable\", and follows exact requested-size handling like 3D Frontlit.";
    if (!node.parameters.jsCode.includes(rule)) {
      const marker = node.parameters.jsCode.includes("Return only schema-valid JSON.")
        ? "Return only schema-valid JSON."
        : "Return schema-valid JSON only.";
      if (!node.parameters.jsCode.includes(marker)) throw new Error(`${nodeName} prompt marker missing`);
      node.parameters.jsCode = node.parameters.jsCode.replace(marker, `${rule}\\n\\n${marker}`);
    }
  }

  const gateNode = workflow.nodes.find((entry) => entry.name === "Validate and Gate");
  gateNode.parameters.jsCode = gateNode.parameters.jsCode
    .replace(
      "const exactRequestedSizeProduct=['3D Frontlit','3D Backlit','3D Nonlit','3D Multi-Variant'].includes(finalProduct);",
      "const exactRequestedSizeProduct=['Full Glow','3D Frontlit','3D Backlit','3D Nonlit','3D Multi-Variant'].includes(finalProduct);",
    )
    .replace(
      "'Ultrathin Acrylic Lightbox':'Ultrathin Acrylic Lightbox','Lightbox'",
      "'Ultrathin Acrylic Lightbox':'Ultrathin Acrylic Lightbox','Full Glow':'Full Glow','Lightbox'",
    );

  const projectOutputs = workflow.connections["Trello: Project Decision"]?.main?.[0];
  if (!Array.isArray(projectOutputs)) throw new Error("Trello: Project Decision connection missing");
  if (!projectOutputs.some((entry) => entry.node === "Product 1 recognized?")) {
    projectOutputs.push({ node: "Product 1 recognized?", type: "main", index: 0 });
  }
  workflow.connections["Product 1 recognized?"] = {
    main: [[{ node: "Trello: Set Product 1", type: "main", index: 0 }], []],
  };
  return workflow;
}

export function patchWorkflowById(workflowId, workflow) {
  const clone = structuredClone(workflow);
  if (workflowId === WORKFLOW_IDS.landingPage) return patchPrepareFieldDataNode(clone, "landing");
  if (workflowId === WORKFLOW_IDS.unstructured) return patchPrepareFieldDataNode(clone, "unstructured");
  if (workflowId === WORKFLOW_IDS.quotingAgent) return patchQuotingAgentWorkflow(clone);
  throw new Error(`Unsupported workflow: ${workflowId}`);
}
