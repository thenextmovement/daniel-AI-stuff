import assert from "node:assert/strict";
import {
  EXPECTED_ACTIVE_VERSION_ID,
  EXPECTED_BOARD_ID,
  WORKFLOW_ID,
  attachmentNodes,
  findExistingAttachment,
  normalizeAttachmentPayload,
  operations,
  patch,
} from "./trello-attachment-worker-patch.mjs";

const attachmentId = "10000000-0000-4000-8000-000000000001";
const submissionId = "20000000-0000-4000-8000-000000000002";
const sha256 = "a".repeat(64);
const validPayload = {
  board_id: EXPECTED_BOARD_ID,
  card_id: "6a7ace80f34439aa08256417",
  attachment_id: attachmentId,
  storage_bucket: "ro-lead-attachments",
  storage_path: `first-party/${submissionId}/01-${sha256}-kunden-logo.png`,
  original_file_name: "Kunden Logo.png",
  mime_type: "image/png",
  size_bytes: 12345,
  sha256,
  source: "first_party_attachment",
};

const normalized = normalizeAttachmentPayload({ id: "job-1" }, validPayload);
assert.equal(normalized.attachmentId, attachmentId);
assert.equal(normalized.storageBucket, "ro-lead-attachments");
assert.equal(normalized.originalFileName, "Kunden Logo.png");
assert.equal(normalized.sizeBytes, 12345);

for (const [field, value, expected] of [
  ["storage_bucket", "public", /storage_bucket/],
  ["storage_path", "../secret", /storage_path/],
  ["original_file_name", "../secret.png", /file_name/],
  ["mime_type", "text/html", /mime_type/],
  ["size_bytes", 15728641, /file_size/],
  ["sha256", "bad", /storage_path|sha256/],
  ["source", "customer_payload", /source/],
]) {
  assert.throws(
    () => normalizeAttachmentPayload(
      { id: "job-1" },
      { ...validPayload, [field]: value },
    ),
    expected,
  );
}

const trelloAttachments = [
  {
    id: "6a7ace80f34439aa08256418",
    name: "Kunden Logo.png",
    bytes: 12345,
    url: "https://trello.com/1/cards/example/attachments/example/download/file.png",
  },
];
assert.equal(
  findExistingAttachment(trelloAttachments, "Kunden Logo.png", 12345)?.id,
  "6a7ace80f34439aa08256418",
);
assert.equal(
  findExistingAttachment(trelloAttachments, "Kunden Logo.png", 12346),
  null,
);
assert.equal(findExistingAttachment([], "Kunden Logo.png", 12345), null);

assert.equal(WORKFLOW_ID, "1sfVyhUafhfUtPoi");
assert.equal(EXPECTED_ACTIVE_VERSION_ID, "d7a38eb0-fd97-4da9-abc3-71e43bc81f17");
assert.equal(patch.expectedBaseNodeCount, 26);
assert.equal(patch.expectedFinalNodeCount, 34);
assert.equal(attachmentNodes.length, 8);
assert.equal(new Set(attachmentNodes.map((node) => node.id)).size, 8);
assert.equal(new Set(attachmentNodes.map((node) => node.name)).size, 8);

const uploadNode = attachmentNodes.find(
  (node) => node.name === "Upload Attachment to Trello",
);
assert.equal(uploadNode.parameters.contentType, "multipart-form-data");
assert.equal(uploadNode.parameters.bodyParameters.parameters[0].name, "file");
assert.equal(
  uploadNode.parameters.bodyParameters.parameters[0].inputDataFieldName,
  "data",
);
assert.equal(uploadNode.retryOnFail, undefined);
assert.equal(uploadNode.onError, "continueErrorOutput");

const downloadNode = attachmentNodes.find(
  (node) => node.name === "Download Stored Attachment",
);
assert.match(downloadNode.parameters.url, /storage\/v1\/object\/authenticated/);
assert.match(downloadNode.parameters.url, /encodeURIComponent/);
assert.equal(
  downloadNode.parameters.options.response.response.outputPropertyName,
  "data",
);

const claimPatch = operations.find(
  (operation) => operation.nodeName === "Claim One Trello Action",
);
assert.match(claimPatch.patches[0].replace, /trello_card_attachment_v1/);

const completePatch = operations.find(
  (operation) => operation.nodeName === "Complete Trello Action",
);
assert.match(completePatch.patches[0].replace, /externalId \|\| \$json\.cardId/);

const connection = (source, target, branch) => operations.some(
  (operation) => operation.type === "addConnection" &&
    operation.source === source &&
    operation.target === target &&
    operation.branch === branch,
);
assert.equal(connection("Attachment Action?", "Get Existing Trello Attachments", "true"), true);
assert.equal(connection("Attachment Action?", "Move Action?", "false"), true);
assert.equal(connection("Attachment Already Exists?", "Use Existing Trello Attachment", "true"), true);
assert.equal(connection("Attachment Already Exists?", "Download Stored Attachment", "false"), true);
assert.equal(operations.some(
  (operation) => operation.type === "addConnection" &&
    operation.source === "Normalize Uploaded Trello Attachment" &&
    operation.target === "Complete Trello Action" &&
    operation.sourceIndex === 0,
), true);

console.log("RIESENOBJEKTE Trello attachment worker patch checks passed");
