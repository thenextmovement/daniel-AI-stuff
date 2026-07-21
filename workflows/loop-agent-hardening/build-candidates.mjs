import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const backupDirectory = resolve(here, "backups/2026-07-21");
const generatedDirectory = resolve(here, "generated");
const quoteApprovalTelegramCredential = {
  telegramApi: {
    id: "uCowJBoRFCzoxKze",
    name: "Telegram NEONTRIP Quote Approval — migrated 2026-07-21",
  },
};

function nodeByName(workflow, name) {
  const node = workflow.nodes.find((entry) => entry.name === name);
  if (!node) throw new Error(`Missing node ${name} in ${workflow.id}`);
  return node;
}

function replaceExact(source, find, replacement, label) {
  const first = source.indexOf(find);
  if (first < 0) throw new Error(`Patch source not found: ${label}`);
  if (source.indexOf(find, first + find.length) >= 0) {
    throw new Error(`Patch source is ambiguous: ${label}`);
  }
  return source.replace(find, replacement);
}

async function buildResendCandidate() {
  const sourcePath = resolve(
    backupDirectory,
    "MZhNgpQa8XP55jbg.published-active.json",
  );
  const workflow = JSON.parse(await readFile(sourcePath, "utf8"));

  const normalize = nodeByName(workflow, "Normalize Trigger");
  normalize.parameters.jsCode = replaceExact(
    normalize.parameters.jsCode,
    "if (!card.id) throw new Error('Missing Trello card id');",
    "const actionId = String(action.id || $json.id || '').trim();\nconst movedAt = String(action.date || '').trim();\nif (!card.id) throw new Error('Missing Trello card id');\nif (!actionId) throw new Error('Missing stable Trello action id');\nif (!movedAt) throw new Error('Missing Trello action timestamp');",
    "require stable Trello event identity",
  );
  normalize.parameters.jsCode = replaceExact(
    normalize.parameters.jsCode,
    "trelloActionId: action.id || $json.id || '',",
    "trelloActionId: actionId,",
    "store normalized action id",
  );
  normalize.parameters.jsCode = replaceExact(
    normalize.parameters.jsCode,
    "movedAt: action.date || new Date().toISOString(),\n  correlationId: 'trello:' + card.id + ':existing-offer-resend:' + (action.id || Date.now())",
    "movedAt,\n  correlationId: 'trello:' + card.id + ':existing-offer-resend:' + actionId",
    "remove time-based event fallbacks",
  );

  for (const nodeName of ["Extract Offer Context", "Resolve Recipient After Lookup"]) {
    const node = nodeByName(workflow, nodeName);
    node.parameters.jsCode = replaceExact(
      node.parameters.jsCode,
      "/^[^s@]+@[^s@]+.[^s@]+$/",
      "/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/",
      `${nodeName} email validation`,
    );
  }

  const extract = nodeByName(workflow, "Extract Offer Context");
  extract.parameters.jsCode = replaceExact(
    extract.parameters.jsCode,
    "id)s*[:#-]?s*([a-zA-Z0-9_-]+)",
    "id)\\s*[:#-]?\\s*([a-zA-Z0-9_-]+)",
    "request id whitespace handling",
  );

  const payload = nodeByName(workflow, "Build Send Payload");
  payload.parameters.jsCode = replaceExact(
    payload.parameters.jsCode,
    "const offerLabel = data.offerNumber || data.documentReference || data.offerId;",
    "const offerLabel = data.offerNumber || data.documentReference || data.offerId;\nif (!data.trelloActionId) throw new Error('Missing stable Trello action id for resend');",
    "payload stable identity guard",
  );
  payload.parameters.jsCode = replaceExact(
    payload.parameters.jsCode,
    "data.trelloActionId || data.movedAt || Date.now()",
    "data.trelloActionId",
    "payload idempotency key",
  );
  payload.parameters.jsCode = replaceExact(
    payload.parameters.jsCode,
    ".split(/s+/)",
    ".split(/\\s+/)",
    "customer first-name parsing",
  );
  payload.parameters.jsCode = replaceExact(
    payload.parameters.jsCode,
    "].join('\n');",
    "].join('\\n');",
    "message newline escape",
  );

  const failure = nodeByName(workflow, "Prepare Failure");
  failure.parameters.jsCode = replaceExact(
    failure.parameters.jsCode,
    "/^FEHLERs*[-:]s*/i",
    "/^FEHLER\\s*[-:]\\s*/i",
    "failure title cleanup",
  );

  for (const nodeName of [
    "Trello: Get Card Details",
    "Offers: Get Existing Offer by Trello",
    "Supabase: Lookup Customer Email",
  ]) {
    const node = nodeByName(workflow, nodeName);
    node.retryOnFail = true;
    node.maxTries = 3;
    node.waitBetweenTries = 2000;
  }
  nodeByName(workflow, "Trello: Success Comment").onError = "continueRegularOutput";

  workflow.name = "Trello: Bestehendes Angebot erneut versenden v1.1 — Hardened";
  workflow.meta = {
    ...(workflow.meta || {}),
    hardeningSourceVersionId: workflow.activeVersionId,
    hardeningReason: "syntax, validation, and stable idempotency repair",
  };

  await mkdir(generatedDirectory, { recursive: true });
  const outputPath = resolve(
    generatedDirectory,
    "MZhNgpQa8XP55jbg.resend-hardened-v1.1.json",
  );
  await writeFile(outputPath, `${JSON.stringify(workflow, null, 2)}\n`);
  return outputPath;
}

function configureTelegramNode(node, parameters, onError = "stopWorkflow") {
  node.type = "n8n-nodes-base.telegram";
  node.typeVersion = 1.2;
  node.parameters = parameters;
  node.credentials = structuredClone(quoteApprovalTelegramCredential);
  node.onError = onError;
  delete node.retryOnFail;
  delete node.maxTries;
  delete node.waitBetweenTries;
  delete node.continueOnFail;
}

function imageConditionNode(id, name, position, expression) {
  return {
    id,
    name,
    type: "n8n-nodes-base.if",
    typeVersion: 2.3,
    position,
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: "",
          typeValidation: "strict",
          version: 2,
        },
        combinator: "and",
        conditions: [
          {
            id: `${id}-condition`,
            leftValue: expression,
            rightValue: true,
            operator: {
              type: "boolean",
              operation: "true",
              singleValue: true,
            },
          },
        ],
      },
      options: {},
    },
  };
}

function telegramBinaryParameters(operation, sourceNode) {
  return {
    resource: "message",
    operation,
    chatId: `={{ $('${sourceNode}').item.json.chat_id }}`,
    binaryData: true,
    binaryPropertyName: "data",
    replyMarkup: "none",
    additionalFields: {
      caption: `={{ $('${sourceNode}').item.json.caption }}`,
      fileName: `={{ $('${sourceNode}').item.json.filename }}`,
    },
  };
}

async function buildTelegramApprovalCandidate() {
  const sourcePath = resolve(
    backupDirectory,
    "7AvW1d4JBNDFuNsv.published-active.json",
  );
  const workflow = JSON.parse(await readFile(sourcePath, "utf8"));

  const claim = nodeByName(workflow, "Supabase: Claim (Dedupe)");
  const preMigrationClaim = structuredClone(claim);
  const preMigrationNewCases = structuredClone(nodeByName(workflow, "Nur neue Fälle"));
  claim.parameters.url =
    "https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/claim_quote_approval";
  claim.parameters.jsonBody =
    "={{ JSON.stringify({ p_card_id: $json.card_id, p_card_name: $json.card_name, p_chat_id: $json.chat_id }) }}";
  claim.parameters.headerParameters = {
    parameters: [{ name: "Content-Type", value: "application/json" }],
  };
  claim.parameters.options = {
    response: {
      response: {
        fullResponse: true,
        neverError: false,
        responseFormat: "json",
      },
    },
    timeout: 15000,
  };
  claim.retryOnFail = true;
  claim.maxTries = 3;
  claim.waitBetweenTries = 2000;
  claim.onError = "stopWorkflow";

  nodeByName(workflow, "Nur neue Fälle").parameters.jsCode = String.raw`const response = $input.first().json || {};
const claim = response.body ?? response;
if (claim.claimed !== true) return [];
return [{ json: {
  branch: 'new',
  card_id: String(claim.card_id || ''),
  card_name: String(claim.card_name || ''),
  chat_id: String(claim.chat_id || ''),
  claim_reason: String(claim.reason || 'new'),
  automatic_customer_send_allowed: false,
  human_approval_required: true,
} }];`;

  const initialPhoto = nodeByName(workflow, "Telegram: Anhang senden");
  configureTelegramNode(
    initialPhoto,
    telegramBinaryParameters("sendPhoto", "Anhänge aufteilen"),
  );
  const initialDocument = structuredClone(initialPhoto);
  initialDocument.id = "sendfile-document";
  initialDocument.name = "Telegram: Anhang Dokument senden";
  initialDocument.position = [2640, 160];
  initialDocument.parameters.operation = "sendDocument";

  const initialImageCondition = imageConditionNode(
    "if-attachment-image",
    "Anhang ist Bild?",
    [2400, 0],
    "={{ $('Anhänge aufteilen').item.json.is_image }}",
  );

  const customerText = nodeByName(workflow, "Telegram: Kundentext senden");
  configureTelegramNode(customerText, {
    resource: "message",
    operation: "sendMessage",
    chatId: "={{ $json.chat_id }}",
    text: "={{ $json.text }}",
    replyMarkup: "none",
    additionalFields: {
      appendAttribution: false,
      disable_web_page_preview: true,
    },
  });

  const buttons = nodeByName(workflow, "Telegram: Nachricht + Buttons");
  configureTelegramNode(buttons, {
    resource: "message",
    operation: "sendMessage",
    chatId: "={{ $('Nachricht bauen').item.json.chat_id }}",
    text: "={{ $('Nachricht bauen').item.json.message_text }}",
    replyMarkup: "inlineKeyboard",
    inlineKeyboard: {
      rows: [
        {
          row: {
            buttons: [
              {
                text: "✅ Ja",
                additionalFields: {
                  callback_data: "={{ 'ok:' + $('Nachricht bauen').item.json.card_id }}",
                },
              },
              {
                text: "❌ Nein",
                additionalFields: {
                  callback_data: "={{ 'no:' + $('Nachricht bauen').item.json.card_id }}",
                },
              },
            ],
          },
        },
        {
          row: {
            buttons: [
              {
                text: "✏️ Änderung",
                additionalFields: {
                  callback_data: "={{ 'edit:' + $('Nachricht bauen').item.json.card_id }}",
                },
              },
            ],
          },
        },
      ],
    },
    additionalFields: {
      appendAttribution: false,
      disable_web_page_preview: true,
      parse_mode: "HTML",
    },
  });

  const saveMessageId = nodeByName(workflow, "Supabase: Message-ID speichern");
  saveMessageId.parameters.jsonBody = replaceExact(
    saveMessageId.parameters.jsonBody,
    "message_id: $json.result && $json.result.message_id",
    "message_id: $json.message_id || ($json.result && $json.result.message_id)",
    "native Telegram message id",
  );

  const latePhoto = nodeByName(workflow, "Telegram: Anhang senden (nachträglich)");
  configureTelegramNode(
    latePhoto,
    telegramBinaryParameters("sendPhoto", "Anhang prüfen"),
  );
  const lateDocument = structuredClone(latePhoto);
  lateDocument.id = "sendlate-document";
  lateDocument.name = "Telegram: Anhang Dokument senden (nachträglich)";
  lateDocument.position = [2160, 660];
  lateDocument.parameters.operation = "sendDocument";

  const lateImageCondition = imageConditionNode(
    "if-late-attachment-image",
    "Nachträglicher Anhang ist Bild?",
    [1920, 520],
    "={{ $('Anhang prüfen').item.json.is_image }}",
  );

  workflow.nodes.push(
    initialImageCondition,
    initialDocument,
    lateImageCondition,
    lateDocument,
  );

  workflow.connections["Trello: Anhang laden"] = {
    main: [[{ node: "Anhang ist Bild?", type: "main", index: 0 }]],
  };
  workflow.connections["Anhang ist Bild?"] = {
    main: [
      [{ node: "Telegram: Anhang senden", type: "main", index: 0 }],
      [{ node: "Telegram: Anhang Dokument senden", type: "main", index: 0 }],
    ],
  };
  workflow.connections["Trello: Anhang laden (nachträglich)"] = {
    main: [[{ node: "Nachträglicher Anhang ist Bild?", type: "main", index: 0 }]],
  };
  workflow.connections["Nachträglicher Anhang ist Bild?"] = {
    main: [
      [{ node: "Telegram: Anhang senden (nachträglich)", type: "main", index: 0 }],
      [{ node: "Telegram: Anhang Dokument senden (nachträglich)", type: "main", index: 0 }],
    ],
  };
  workflow.connections["Telegram: Anhang Dokument senden (nachträglich)"] = {
    main: [[{ node: "Supabase: Anhang vermerkt", type: "main", index: 0 }]],
  };

  workflow.name = "NEONTRIP Anfrage → Telegram Approval v1.1 — Credential Safe";
  workflow.meta = {
    ...(workflow.meta || {}),
    hardeningSourceVersionId: workflow.activeVersionId,
    hardeningReason: "database claim RPC and credential-backed Telegram nodes",
  };

  const serialized = JSON.stringify(workflow);
  if (/api\.telegram\.org\/bot/i.test(serialized)) {
    throw new Error("Telegram approval candidate still contains a token-bearing URL");
  }

  await mkdir(generatedDirectory, { recursive: true });
  const outputPath = resolve(
    generatedDirectory,
    "7AvW1d4JBNDFuNsv.telegram-approval-credential-safe-v1.1.json",
  );
  await writeFile(outputPath, `${JSON.stringify(workflow, null, 2)}\n`);

  const stageOneWorkflow = structuredClone(workflow);
  stageOneWorkflow.nodes = stageOneWorkflow.nodes.map((node) => {
    if (node.name === preMigrationClaim.name) return preMigrationClaim;
    if (node.name === preMigrationNewCases.name) return preMigrationNewCases;
    return node;
  });
  stageOneWorkflow.name =
    "NEONTRIP Anfrage → Telegram Approval v1.1 — Credential Safe";
  stageOneWorkflow.meta.hardeningReason =
    "credential-backed Telegram nodes; database claim cutover pending migration";
  const stageOneSerialized = JSON.stringify(stageOneWorkflow);
  if (/api\.telegram\.org\/bot/i.test(stageOneSerialized)) {
    throw new Error("Telegram stage-one candidate still contains a token-bearing URL");
  }
  const stageOnePath = resolve(
    generatedDirectory,
    "7AvW1d4JBNDFuNsv.telegram-approval-credential-safe-stage1.json",
  );
  await writeFile(stageOnePath, `${JSON.stringify(stageOneWorkflow, null, 2)}\n`);

  return [stageOnePath, outputPath];
}

function trelloLocator(value) {
  return { __rl: true, value, mode: "id", cachedResultName: "Runtime card" };
}

function configureTrelloLabelNode(node, operation, cardExpression, labelId) {
  node.type = "n8n-nodes-base.trello";
  node.typeVersion = 1;
  node.parameters = {
    authentication: "apiKey",
    resource: "label",
    operation,
    cardId: trelloLocator(cardExpression),
    id: labelId,
  };
  node.onError = "continueRegularOutput";
  node.retryOnFail = true;
  node.maxTries = 3;
  node.waitBetweenTries = 2000;
  delete node.continueOnFail;
}

function supabaseRpcNode({ id, name, position, rpc, body }) {
  return {
    id,
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position,
    parameters: {
      method: "POST",
      url: `https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/${rpc}`,
      authentication: "predefinedCredentialType",
      nodeCredentialType: "httpHeaderAuth",
      sendHeaders: true,
      headerParameters: {
        parameters: [{ name: "Content-Type", value: "application/json" }],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: body,
      options: {
        response: { response: { responseFormat: "json" } },
        timeout: 15000,
      },
    },
    credentials: {
      httpHeaderAuth: {
        id: "NTtNxoBGGzJCQi9u",
        name: "Header Auth account 2 | SUPABASE",
      },
    },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    onError: "stopWorkflow",
  };
}

async function buildSupplierDeliveryCandidate() {
  const sourcePath = resolve(
    backupDirectory,
    "Hzf3fcJwmcCxExnx.published-active.json",
  );
  const workflow = JSON.parse(await readFile(sourcePath, "utf8"));

  const removeNode = (name) => {
    const index = workflow.nodes.findIndex((node) => node.name === name);
    if (index < 0) throw new Error(`Missing removable node ${name}`);
    workflow.nodes.splice(index, 1);
    delete workflow.connections[name];
    for (const connection of Object.values(workflow.connections)) {
      for (const outputs of Object.values(connection)) {
        if (!Array.isArray(outputs)) continue;
        for (let index = 0; index < outputs.length; index += 1) {
          outputs[index] = (outputs[index] || []).filter(
            (target) => target.node !== name,
          );
        }
      }
    }
  };

  removeNode("PreserveMoveContext");
  removeNode("CommentSuccessfulSupplierSend");

  const recheck = nodeByName(workflow, "RecheckCardWithAttachments");
  recheck.type = "n8n-nodes-base.trello";
  recheck.typeVersion = 1;
  recheck.parameters = {
    authentication: "apiKey",
    resource: "card",
    operation: "get",
    id: trelloLocator(
      "={{ $('TrelloMoveTrigger').first().json.action.data.card.id }}",
    ),
    additionalFields: {
      fields: "id,name,desc,idList,url,dateLastActivity",
    },
  };
  recheck.retryOnFail = true;
  recheck.maxTries = 3;
  recheck.waitBetweenTries = 3000;
  recheck.onError = "stopWorkflow";
  delete recheck.continueOnFail;

  const trelloCredential = structuredClone(recheck.credentials);
  const getAttachments = {
    id: "get-trello-attachments-native",
    name: "GetTrelloAttachments",
    type: "n8n-nodes-base.trello",
    typeVersion: 1,
    position: [1440, -80],
    parameters: {
      authentication: "apiKey",
      resource: "attachment",
      operation: "getAll",
      cardId: trelloLocator(
        "={{ $('RecheckCardWithAttachments').first().json.id }}",
      ),
      additionalFields: { fields: "id,name,url,mimeType" },
    },
    credentials: trelloCredential,
    alwaysOutputData: true,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 3000,
    onError: "stopWorkflow",
  };

  for (const [nodeName, operation, cardExpression, labelId] of [
    [
      "AddWaitingLabel",
      "addLabel",
      "={{ $('TrelloMoveTrigger').first().json.action.data.card.id }}",
      "6a50f83f8820051b5a5d9de2",
    ],
    [
      "RemoveWaitingCancelled",
      "removeLabel",
      "={{ $('RecheckCardWithAttachments').first().json.id }}",
      "6a50f83f8820051b5a5d9de2",
    ],
    [
      "RemoveWaitingAfterSuccess",
      "removeLabel",
      "={{ $('BuildCompletionSummary').first().json.cardId }}",
      "6a50f83f8820051b5a5d9de2",
    ],
    [
      "AddNo3DTitleLabel",
      "addLabel",
      "={{ $('RecheckCardWithAttachments').first().json.id }}",
      "6a59fbe656019f9dc203fea0",
    ],
    [
      "RemoveWaitingNo3DTitle",
      "removeLabel",
      "={{ $('RecheckCardWithAttachments').first().json.id }}",
      "6a50f83f8820051b5a5d9de2",
    ],
    [
      "AddEmailsSentLabel",
      "addLabel",
      "={{ $('BuildCompletionSummary').first().json.cardId }}",
      "6a50f13ae470e59a185454b4",
    ],
  ]) {
    configureTrelloLabelNode(
      nodeByName(workflow, nodeName),
      operation,
      cardExpression,
      labelId,
    );
  }

  const prepare = nodeByName(workflow, "PrepareAIExtraction");
  prepare.parameters.jsCode = replaceExact(
    prepare.parameters.jsCode,
    "return [ { json: { cardId: card.id, prompt: prompt } } ];",
    "if (!card.id || !String(card.desc || '').trim()) throw new Error('Supplier request card is missing required source data.');\nreturn [ { json: { cardId: card.id, prompt: prompt.slice(0, 30000) } } ];",
    "supplier prompt source guard",
  );

  const buildRequest = nodeByName(workflow, "BuildRequestFromAI");
  buildRequest.parameters.jsCode = replaceExact(
    buildRequest.parameters.jsCode,
    "if (!extracted) throw new Error('Gemini did not return the required supplier data JSON.');",
    "if (!extracted) throw new Error('OpenAI did not return the required supplier data JSON.');\nconst requiredKeys = ['dimensions','illumination_colour','paint_colour','mounting','quantity','application','deadline'];\nconst outputKeys = Object.keys(extracted).sort();\nif (outputKeys.length !== requiredKeys.length || requiredKeys.some(key => !outputKeys.includes(key))) throw new Error('OpenAI supplier data schema was not exact.');\nfor (const key of requiredKeys) {\n  if (typeof extracted[key] !== 'string' || extracted[key].length > 500 || /[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]/.test(extracted[key])) throw new Error('OpenAI supplier data contained an invalid field.');\n}",
    "supplier AI output schema gate",
  );
  buildRequest.parameters.jsCode = replaceExact(
    buildRequest.parameters.jsCode,
    "const quantity = text(extracted.quantity, '1');",
    "const quantity = text(extracted.quantity, '');\nif (!/^[1-9]\\d{0,3}$/.test(quantity)) throw new Error('Supplier quantity must be an integer between 1 and 9999.');",
    "supplier quantity gate",
  );
  buildRequest.parameters.jsCode = replaceExact(
    buildRequest.parameters.jsCode,
    "const recipientMarkerPrefix = '[Auto][EU-REQUEST-RECIPIENT] ';\nconst alreadySentRecipients = [...new Set((Array.isArray(card.actions) ? card.actions : []).map(action => String(action?.data?.text || '')).filter(text => text.startsWith(recipientMarkerPrefix)).map(text => text.slice(recipientMarkerPrefix.length).split(/\\s+/)[0].trim().toLowerCase()).filter(Boolean))];\n",
    "",
    "remove Trello recipient ledger",
  );
  buildRequest.parameters.jsCode = replaceExact(
    buildRequest.parameters.jsCode,
    ", alreadySentRecipients } } ];",
    " } } ];",
    "remove Trello ledger output",
  );

  const buildAttachmentQueue = nodeByName(workflow, "BuildAttachmentQueue");
  buildAttachmentQueue.parameters.jsCode = String.raw`const base = $('BuildRequestFromAI').first().json || {};
const attachments = $input.all()
  .map(item => item.json || {})
  .filter(item => item.id && item.url)
  .map(item => ({
    id: String(item.id),
    name: String(item.name || ('attachment-' + item.id)),
    url: String(item.url),
    mimeType: String(item.mimeType || 'application/octet-stream'),
  }));
if (attachments.length === 0) {
  return [{ json: { ...base, hasAttachment: false } }];
}
return attachments.map((attachment, index) => ({ json: {
  ...base,
  hasAttachment: true,
  attachmentIndex: index,
  attachmentName: attachment.name,
  attachmentUrl: attachment.url,
  attachmentMimeType: attachment.mimeType,
} }));`;

  const combine = nodeByName(workflow, "CombineAttachments");
  combine.parameters.jsCode = replaceExact(
    combine.parameters.jsCode,
    ", alreadySentRecipients:Array.isArray(first.json.alreadySentRecipients) ? first.json.alreadySentRecipients : []",
    "",
    "remove Trello recipient state from attachment aggregation",
  );

  const payload = nodeByName(workflow, "BuildGraphMailPayload");
  payload.parameters.jsCode = replaceExact(
    payload.parameters.jsCode,
    "const alreadySent = new Set((Array.isArray(item.json.alreadySentRecipients) ? item.json.alreadySentRecipients : []).map(value => String(value).toLowerCase()));\nconst recipients = allRecipients.filter(recipient => !alreadySent.has(recipient.toLowerCase()));",
    "const recipients = allRecipients;",
    "database owns supplier recipient dedupe",
  );

  const claim = supabaseRpcNode({
    id: "claim-supplier-delivery",
    name: "ClaimSupplierDelivery",
    position: [2280, 120],
    rpc: "claim_supplier_quote_request_delivery",
    body: "={{ JSON.stringify({ p_card_id: $('LoopSupplierRecipients').item.json.cardId, p_recipient: $('LoopSupplierRecipients').item.json.recipient, p_workflow_execution_id: String($execution.id), p_lease_seconds: 900 }) }}",
  });
  const route = {
    id: "route-supplier-delivery-claim",
    name: "RouteSupplierDeliveryClaim",
    type: "n8n-nodes-base.switch",
    typeVersion: 3.4,
    position: [2480, 120],
    parameters: {
      mode: "rules",
      rules: {
        values: [
          {
            conditions: {
              options: {
                caseSensitive: true,
                leftValue: "",
                typeValidation: "strict",
                version: 2,
              },
              conditions: [
                {
                  id: "route-send",
                  leftValue: "={{ $json.route }}",
                  rightValue: "send",
                  operator: { type: "string", operation: "equals" },
                },
              ],
              combinator: "and",
            },
            renameOutput: true,
            outputKey: "send",
          },
          {
            conditions: {
              options: {
                caseSensitive: true,
                leftValue: "",
                typeValidation: "strict",
                version: 2,
              },
              conditions: [
                {
                  id: "route-continue",
                  leftValue: "={{ $json.route }}",
                  rightValue: "continue",
                  operator: { type: "string", operation: "equals" },
                },
              ],
              combinator: "and",
            },
            renameOutput: true,
            outputKey: "continue",
          },
        ],
      },
      options: { fallbackOutput: "extra", renameFallbackOutput: "stop" },
    },
  };
  const markUnknown = supabaseRpcNode({
    id: "mark-supplier-delivery-unknown",
    name: "MarkSupplierDeliveryUnknown",
    position: [2880, 300],
    rpc: "mark_supplier_quote_request_delivery_unknown",
    body: "={{ JSON.stringify({ p_card_id: $('LoopSupplierRecipients').item.json.cardId, p_recipient: $('LoopSupplierRecipients').item.json.recipient, p_claim_token: $('ClaimSupplierDelivery').item.json.claim_token, p_workflow_execution_id: String($execution.id), p_error_code: 'outlook_send_failed' }) }}",
  });
  const stopUnknown = {
    id: "stop-supplier-delivery-safe",
    name: "StopSupplierDeliverySafely",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [3080, 300],
    parameters: {
      mode: "runOnceForAllItems",
      jsCode: String.raw`const reason = String($input.first()?.json?.reason || 'delivery_unknown');
const allowed = new Set(['active_lease', 'manual_review_required', 'stale_lease_delivery_unknown', 'delivery_unknown']);
throw new Error('Supplier delivery loop stopped safely: ' + (allowed.has(reason) ? reason : 'delivery_unknown') + '. Automatic retry is blocked; manual review is required.');
return [];`,
    },
  };

  const send = nodeByName(workflow, "SendOutlookToSuppliers");
  send.parameters.jsonBody =
    "={{ JSON.stringify($('LoopSupplierRecipients').item.json.graphBody) }}";
  send.retryOnFail = false;
  delete send.maxTries;
  delete send.waitBetweenTries;
  send.onError = "continueErrorOutput";
  delete send.continueOnFail;

  const complete = nodeByName(workflow, "RecordRecipientSent");
  complete.name = "CompleteSupplierDelivery";
  complete.type = "n8n-nodes-base.httpRequest";
  complete.typeVersion = 4.2;
  complete.position = [2880, 40];
  complete.parameters = supabaseRpcNode({
    id: complete.id,
    name: complete.name,
    position: complete.position,
    rpc: "complete_supplier_quote_request_delivery",
    body: "={{ JSON.stringify({ p_card_id: $('LoopSupplierRecipients').item.json.cardId, p_recipient: $('LoopSupplierRecipients').item.json.recipient, p_claim_token: $('ClaimSupplierDelivery').item.json.claim_token, p_workflow_execution_id: String($execution.id) }) }}",
  }).parameters;
  complete.credentials = structuredClone(claim.credentials);
  complete.retryOnFail = true;
  complete.maxTries = 3;
  complete.waitBetweenTries = 2000;
  complete.onError = "stopWorkflow";
  delete complete.continueOnFail;

  const summary = nodeByName(workflow, "MarkSentInState");
  summary.name = "BuildCompletionSummary";
  summary.parameters.jsCode = String.raw`const source = $('CombineAttachments').first().json || {};
if (!source.cardId) throw new Error('Supplier delivery summary is missing the card ID.');
return [{ json: {
  cardId: source.cardId,
  cardName: source.cardName || '',
  attachmentCount: Number(source.attachmentCount || 0),
  recipientCount: 6,
  canonicalSource: 'supplier_quote_request_deliveries',
} }];`;

  workflow.nodes.push(getAttachments, claim, route, markUnknown, stopUnknown);

  workflow.connections["AddWaitingLabel"] = {
    main: [[{ node: "Wait30Seconds", type: "main", index: 0 }]],
  };
  workflow.connections["BuildRequestFromAI"] = {
    main: [[{ node: "GetTrelloAttachments", type: "main", index: 0 }]],
  };
  workflow.connections.GetTrelloAttachments = {
    main: [[{ node: "BuildAttachmentQueue", type: "main", index: 0 }]],
  };
  workflow.connections.LoopSupplierRecipients = {
    main: [
      [{ node: "BuildCompletionSummary", type: "main", index: 0 }],
      [{ node: "ClaimSupplierDelivery", type: "main", index: 0 }],
    ],
  };
  workflow.connections.ClaimSupplierDelivery = {
    main: [[{ node: "RouteSupplierDeliveryClaim", type: "main", index: 0 }]],
  };
  workflow.connections.RouteSupplierDeliveryClaim = {
    main: [
      [{ node: "SendOutlookToSuppliers", type: "main", index: 0 }],
      [{ node: "WaitBetweenSupplierMails", type: "main", index: 0 }],
      [{ node: "StopSupplierDeliverySafely", type: "main", index: 0 }],
    ],
  };
  workflow.connections.SendOutlookToSuppliers = {
    main: [
      [{ node: "CompleteSupplierDelivery", type: "main", index: 0 }],
      [{ node: "MarkSupplierDeliveryUnknown", type: "main", index: 0 }],
    ],
  };
  delete workflow.connections.RecordRecipientSent;
  workflow.connections.CompleteSupplierDelivery = {
    main: [[{ node: "WaitBetweenSupplierMails", type: "main", index: 0 }]],
  };
  workflow.connections.MarkSupplierDeliveryUnknown = {
    main: [[{ node: "StopSupplierDeliverySafely", type: "main", index: 0 }]],
  };
  workflow.connections.BuildCompletionSummary = {
    main: [[{ node: "AddEmailsSentLabel", type: "main", index: 0 }]],
  };
  delete workflow.connections.MarkSentInState;
  workflow.connections.RemoveWaitingAfterSuccess = { main: [[]] };

  workflow.name = "EU Supplier Request v1.1 — DB Delivery Loop";
  workflow.meta = {
    ...(workflow.meta || {}),
    hardeningSourceVersionId: workflow.activeVersionId,
    hardeningReason:
      "database delivery claims, fail-closed Outlook send, native Trello projection",
  };

  const serialized = JSON.stringify(workflow);
  if (/EU-REQUEST-RECIPIENT|\$getWorkflowStaticData/.test(serialized)) {
    throw new Error("Supplier candidate still uses Trello or static data as delivery state");
  }
  if (/api\.trello\.com\/1\/cards/.test(serialized)) {
    throw new Error("Supplier candidate still exposes Trello credentials through raw API URLs");
  }
  if (workflow.nodes.length !== 30) {
    throw new Error(`Supplier candidate must contain exactly 30 nodes, got ${workflow.nodes.length}`);
  }

  await mkdir(generatedDirectory, { recursive: true });
  const outputPath = resolve(
    generatedDirectory,
    "Hzf3fcJwmcCxExnx.supplier-delivery-loop-v1.1.json",
  );
  await writeFile(outputPath, `${JSON.stringify(workflow, null, 2)}\n`);
  return outputPath;
}

const nestedOutputs = await Promise.all([
  buildResendCandidate(),
  buildTelegramApprovalCandidate(),
  buildSupplierDeliveryCandidate(),
]);
const outputs = nestedOutputs.flat();
for (const output of outputs) console.log(output);
