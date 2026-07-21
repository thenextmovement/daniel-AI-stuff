import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const generatedDirectory = resolve(here, "generated");

function nodeByName(workflow, name) {
  const node = workflow.nodes.find((entry) => entry.name === name);
  assert.ok(node, `missing node ${name}`);
  return node;
}

function compileCodeNodes(workflow) {
  for (const node of workflow.nodes) {
    if (node.type !== "n8n-nodes-base.code") continue;
    const source = String(node.parameters?.jsCode || "");
    assert.doesNotThrow(
      () => new vm.Script(`(async () => {\n${source}\n})()`),
      `invalid JavaScript in ${workflow.id}/${node.name}`,
    );
  }
}

const files = (await readdir(generatedDirectory)).filter(
  (file) =>
    file.endsWith(".json") &&
    file !== "T4mdDxLquLMJ6FMl.gemini-cleanup-credential-hotfix-v1.2.1.json",
);
assert.ok(files.length > 0, "no generated candidates found");

function isTriggerNode(node) {
  return node.type.toLowerCase().endsWith("trigger") ||
    node.type === "n8n-nodes-base.webhook";
}

for (const file of files) {
  const workflow = JSON.parse(await readFile(resolve(generatedDirectory, file), "utf8"));
  compileCodeNodes(workflow);
  assert.equal(
    workflow.nodes.filter(isTriggerNode).length,
    1,
    `${workflow.id} must have exactly one trigger`,
  );
  assert.ok(workflow.nodes.length <= 30, `${workflow.id} exceeds the 30-node boundary`);
  assert.equal(
    workflow.nodes.some((node) => node.continueOnFail === true),
    false,
    `${workflow.id} contains continueOnFail`,
  );
}

const resend = JSON.parse(
  await readFile(
    resolve(generatedDirectory, "MZhNgpQa8XP55jbg.resend-hardened-v1.1.json"),
    "utf8",
  ),
);
const normalizeCode = nodeByName(resend, "Normalize Trigger").parameters.jsCode;
const extractCode = nodeByName(resend, "Extract Offer Context").parameters.jsCode;
const resolveCode = nodeByName(resend, "Resolve Recipient After Lookup").parameters.jsCode;
const payloadCode = nodeByName(resend, "Build Send Payload").parameters.jsCode;
const failureCode = nodeByName(resend, "Prepare Failure").parameters.jsCode;

assert.match(normalizeCode, /Missing stable Trello action id/);
assert.doesNotMatch(normalizeCode, /Date\.now|new Date/);
assert.match(extractCode, /\[\^\\s@\]/);
assert.match(extractCode, /\\s\*\[:#-\]\?\\s\*/);
assert.match(resolveCode, /\[\^\\s@\]/);
assert.match(payloadCode, /data\.trelloActionId/);
assert.doesNotMatch(payloadCode, /Date\.now/);
assert.match(payloadCode, /split\(\/\\s\+\/\)/);
assert.match(payloadCode, /join\('\\n'\)/);
assert.match(failureCode, /FEHLER\\s\*/);

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const payloadResult = await new AsyncFunction("$json", payloadCode)({
  offerNumber: "NT-TEST-1",
  offerId: "offer-test-1",
  cardId: "card-test-1",
  trelloActionId: "action-test-1",
  customerName: "Ada Lovelace",
  recipientEmail: "ada@example.test",
});
const renderedMessage = payloadResult[0].json.sendPayload.message;
assert.match(renderedMessage, /^Guten Tag Ada,\n\nwie gewünscht/);
assert.doesNotMatch(renderedMessage, /\\\\n/);
assert.equal(
  payloadResult[0].json.idempotencyKey,
  "trello-existing-offer-resend:card-test-1:action-test-1:offer-test-1:v1",
);
for (const nodeName of [
  "Trello: Get Card Details",
  "Offers: Get Existing Offer by Trello",
  "Supabase: Lookup Customer Email",
]) {
  const node = nodeByName(resend, nodeName);
  assert.equal(node.retryOnFail, true, `${nodeName} must retry bounded reads`);
  assert.equal(node.maxTries, 3, `${nodeName} retry count`);
  assert.equal(node.waitBetweenTries, 2000, `${nodeName} retry delay`);
}
assert.equal(
  nodeByName(resend, "Trello: Success Comment").onError,
  "continueRegularOutput",
  "a projection comment failure must not turn a successful send into a failed send",
);

const telegramApproval = JSON.parse(
  await readFile(
    resolve(
      generatedDirectory,
      "7AvW1d4JBNDFuNsv.telegram-approval-credential-safe-v1.1.json",
    ),
    "utf8",
  ),
);
const telegramStageOne = JSON.parse(
  await readFile(
    resolve(
      generatedDirectory,
      "7AvW1d4JBNDFuNsv.telegram-approval-credential-safe-stage1.json",
    ),
    "utf8",
  ),
);
const telegramSerialized = JSON.stringify(telegramApproval);
assert.doesNotMatch(telegramSerialized, /api\.telegram\.org\/bot/i);
assert.doesNotMatch(JSON.stringify(telegramStageOne), /api\.telegram\.org\/bot/i);
assert.match(
  String(nodeByName(telegramStageOne, "Supabase: Claim (Dedupe)").parameters.url),
  /rest\/v1\/quote_approvals$/,
);
assert.match(
  String(nodeByName(telegramApproval, "Supabase: Claim (Dedupe)").parameters.url),
  /rpc\/claim_quote_approval$/,
);
assert.match(
  String(nodeByName(telegramApproval, "Nur neue Fälle").parameters.jsCode),
  /claim\.claimed !== true/,
);
for (const node of telegramApproval.nodes.filter(
  (entry) => entry.type === "n8n-nodes-base.telegram",
)) {
  assert.equal(node.credentials?.telegramApi?.id, "uCowJBoRFCzoxKze");
  assert.notEqual(node.retryOnFail, true, `${node.name} must not retry ambiguous sends`);
  assert.equal(node.onError, "stopWorkflow", `${node.name} failures must remain observable`);
}
assert.equal(
  telegramApproval.nodes.filter((entry) => entry.type === "n8n-nodes-base.telegram").length,
  6,
);
assert.equal(
  nodeByName(telegramApproval, "Telegram: Nachricht + Buttons").parameters.replyMarkup,
  "inlineKeyboard",
);
assert.equal(
  nodeByName(telegramApproval, "Telegram: Nachricht + Buttons")
    .parameters.inlineKeyboard.rows.length,
  2,
);
assert.equal(
  telegramApproval.connections["Nachträglicher Anhang ist Bild?"].main.length,
  2,
);

const supplierDelivery = JSON.parse(
  await readFile(
    resolve(
      generatedDirectory,
      "Hzf3fcJwmcCxExnx.supplier-delivery-loop-v1.1.json",
    ),
    "utf8",
  ),
);
const supplierSerialized = JSON.stringify(supplierDelivery);
assert.equal(supplierDelivery.nodes.length, 30);
assert.doesNotMatch(supplierSerialized, /EU-REQUEST-RECIPIENT/);
assert.doesNotMatch(supplierSerialized, /\$getWorkflowStaticData/);
assert.doesNotMatch(supplierSerialized, /api\.trello\.com\/1\/cards/);
assert.doesNotMatch(supplierSerialized, /CommentSuccessfulSupplierSend/);
assert.equal(
  supplierDelivery.nodes.filter((node) => node.type === "n8n-nodes-base.trello")
    .length,
  8,
  "all card and label projections must use credential-backed native Trello nodes",
);
for (const nodeName of [
  "AddWaitingLabel",
  "RemoveWaitingCancelled",
  "RemoveWaitingAfterSuccess",
  "AddNo3DTitleLabel",
  "RemoveWaitingNo3DTitle",
  "AddEmailsSentLabel",
]) {
  const node = nodeByName(supplierDelivery, nodeName);
  assert.equal(node.type, "n8n-nodes-base.trello");
  assert.equal(node.onError, "continueRegularOutput");
}

const supplierSend = nodeByName(supplierDelivery, "SendOutlookToSuppliers");
assert.notEqual(supplierSend.retryOnFail, true);
assert.equal(supplierSend.onError, "continueErrorOutput");
assert.match(
  String(supplierSend.parameters.jsonBody),
  /LoopSupplierRecipients.*graphBody/,
);
assert.match(
  String(nodeByName(supplierDelivery, "ClaimSupplierDelivery").parameters.url),
  /rpc\/claim_supplier_quote_request_delivery$/,
);
assert.match(
  String(nodeByName(supplierDelivery, "CompleteSupplierDelivery").parameters.url),
  /rpc\/complete_supplier_quote_request_delivery$/,
);
assert.match(
  String(nodeByName(supplierDelivery, "MarkSupplierDeliveryUnknown").parameters.url),
  /rpc\/mark_supplier_quote_request_delivery_unknown$/,
);
assert.equal(
  supplierDelivery.connections.RouteSupplierDeliveryClaim.main.length,
  3,
  "claim routing must distinguish send, already-sent continuation, and fail-closed stop",
);
assert.equal(
  supplierDelivery.connections.SendOutlookToSuppliers.main.length,
  2,
  "Outlook success and ambiguous failure must be handled separately",
);
assert.equal(
  supplierDelivery.connections.SendOutlookToSuppliers.main[0][0].node,
  "CompleteSupplierDelivery",
);
assert.equal(
  supplierDelivery.connections.SendOutlookToSuppliers.main[1][0].node,
  "MarkSupplierDeliveryUnknown",
);
const supplierBuildCode = nodeByName(
  supplierDelivery,
  "BuildRequestFromAI",
).parameters.jsCode;
assert.match(supplierBuildCode, /OpenAI supplier data schema was not exact/);
assert.match(supplierBuildCode, /integer between 1 and 9999/);
assert.doesNotMatch(supplierBuildCode, /card\.actions/);
assert.match(
  nodeByName(supplierDelivery, "BuildCompletionSummary").parameters.jsCode,
  /supplier_quote_request_deliveries/,
);

console.log(`candidate tests passed (${files.length} workflow)`);
