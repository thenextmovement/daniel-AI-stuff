import { pathToFileURL } from "node:url";

export const WORKFLOW_ID = "1sfVyhUafhfUtPoi";
export const EXPECTED_ACTIVE_VERSION_ID = "d7a38eb0-fd97-4da9-abc3-71e43bc81f17";
export const EXPECTED_BOARD_ID = "6a672e55823b82cdbebd818c";
export const SUPABASE_CREDENTIAL = {
  httpHeaderAuth: {
    id: "J9gGKMTcivVbyi9J",
    name: "RIESENOBJEKTE | Supabase Ops | 2026-07-27",
  },
};
export const TRELLO_CREDENTIAL = {
  trelloApi: {
    id: "4E5schcGSPvtZM8l",
    name: "RIESENOBJEKTE | Trello | 2026-07-27",
  },
};

export function normalizeAttachmentPayload(job, payload) {
  const attachmentId = String(payload.attachment_id || "").toLowerCase();
  const storageBucket = String(payload.storage_bucket || "");
  const storagePath = String(payload.storage_path || "");
  const originalFileName = String(payload.original_file_name || "");
  const mimeType = String(payload.mime_type || "").toLowerCase();
  const sizeBytes = Number(payload.size_bytes || 0);
  const sha256 = String(payload.sha256 || "").toLowerCase();
  const allowedMimeTypes = new Set([
    "application/illustrator",
    "application/octet-stream",
    "application/pdf",
    "application/postscript",
    "image/jpeg",
    "image/png",
    "image/svg+xml",
    "image/webp",
  ]);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(attachmentId)) {
    throw new Error("attachment_identity_invalid");
  }
  if (storageBucket !== "ro-lead-attachments") {
    throw new Error("attachment_storage_bucket_not_allowlisted");
  }
  if (
    !/^first-party\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9]{2}-[a-f0-9]{64}-[a-z0-9][a-z0-9._-]{0,119}$/.test(storagePath) ||
    !storagePath.includes(`-${sha256}-`)
  ) {
    throw new Error("attachment_storage_path_invalid");
  }
  if (
    originalFileName.length < 1 ||
    originalFileName.length > 255 ||
    /[\\/\u0000-\u001f\u007f]/.test(originalFileName)
  ) {
    throw new Error("attachment_file_name_invalid");
  }
  if (!allowedMimeTypes.has(mimeType)) {
    throw new Error("attachment_mime_type_not_allowlisted");
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 15728640) {
    throw new Error("attachment_file_size_invalid");
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error("attachment_sha256_invalid");
  }
  if (String(payload.source || "") !== "first_party_attachment") {
    throw new Error("attachment_source_invalid");
  }
  return {
    ...job,
    attachmentId,
    storageBucket,
    storagePath,
    originalFileName,
    mimeType,
    sizeBytes,
    sha256,
  };
}

export function findExistingAttachment(attachments, originalFileName, sizeBytes) {
  if (!Array.isArray(attachments)) return null;
  return attachments.find((attachment) =>
    attachment &&
    /^[a-f0-9]{24}$/i.test(String(attachment.id || "")) &&
    String(attachment.name || "") === originalFileName &&
    Number(attachment.bytes) === sizeBytes
  ) || null;
}

const normalizeAttachmentPayloadSource = normalizeAttachmentPayload.toString();
const findExistingAttachmentSource = findExistingAttachment.toString();

export const attachmentNodes = [
  {
    id: "ro-trello-actions-is-attachment",
    name: "Attachment Action?",
    type: "n8n-nodes-base.if",
    typeVersion: 2.3,
    position: [720, -560],
    parameters: {
      options: {},
      conditions: {
        options: {
          version: 2,
          leftValue: "",
          caseSensitive: true,
          typeValidation: "strict",
        },
        combinator: "and",
        conditions: [
          {
            id: "ro-trello-actions-is-attachment-condition",
            operator: {
              type: "boolean",
              operation: "true",
              singleValue: true,
            },
            leftValue: "={{ Boolean($json.isAttachment) }}",
            rightValue: "",
          },
        ],
      },
    },
  },
  {
    id: "ro-trello-actions-get-attachments",
    name: "Get Existing Trello Attachments",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position: [960, -700],
    parameters: {
      method: "GET",
      url: "={{ 'https://api.trello.com/1/cards/' + $json.cardId + '/attachments' }}",
      authentication: "predefinedCredentialType",
      nodeCredentialType: "trelloApi",
      sendQuery: true,
      queryParameters: {
        parameters: [
          { name: "fields", value: "id,name,bytes,url,mimeType" },
        ],
      },
      options: {
        timeout: 30000,
        response: {
          response: { fullResponse: true, responseFormat: "json" },
        },
      },
    },
    credentials: TRELLO_CREDENTIAL,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 3000,
    onError: "continueErrorOutput",
  },
  {
    id: "ro-trello-actions-find-attachment",
    name: "Find Existing Trello Attachment",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1200, -700],
    parameters: {
      jsCode: `${findExistingAttachmentSource}\nconst job = $('Normalize Claimed Trello Action').first().json;\nconst raw = $input.first().json || {};\nconst attachments = Array.isArray(raw.body) ? raw.body : (Array.isArray(raw) ? raw : []);\nconst existingAttachment = findExistingAttachment(attachments, job.originalFileName, job.sizeBytes);\nreturn [{ json: {\n  ...job,\n  attachmentAlreadyExists: Boolean(existingAttachment),\n  existingAttachment: existingAttachment || null,\n  externalId: existingAttachment ? String(existingAttachment.id) : '',\n  externalUrl: existingAttachment ? String(existingAttachment.url || '') : ''\n} }];`,
    },
    onError: "continueErrorOutput",
  },
  {
    id: "ro-trello-actions-attachment-exists",
    name: "Attachment Already Exists?",
    type: "n8n-nodes-base.if",
    typeVersion: 2.3,
    position: [1440, -700],
    parameters: {
      options: {},
      conditions: {
        options: {
          version: 2,
          leftValue: "",
          caseSensitive: true,
          typeValidation: "strict",
        },
        combinator: "and",
        conditions: [
          {
            id: "ro-trello-actions-attachment-exists-condition",
            operator: {
              type: "boolean",
              operation: "true",
              singleValue: true,
            },
            leftValue: "={{ Boolean($json.attachmentAlreadyExists) }}",
            rightValue: "",
          },
        ],
      },
    },
  },
  {
    id: "ro-trello-actions-use-existing-attachment",
    name: "Use Existing Trello Attachment",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [2160, -800],
    parameters: {
      jsCode: "const item = $input.first().json || {};\nif (!item.attachmentAlreadyExists || !/^[a-f0-9]{24}$/i.test(String(item.externalId || ''))) throw new Error('existing_attachment_identity_invalid');\nreturn [{ json: item }];",
    },
    onError: "continueErrorOutput",
  },
  {
    id: "ro-trello-actions-download-attachment",
    name: "Download Stored Attachment",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position: [1680, -580],
    parameters: {
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      method: "GET",
      url: "={{ 'https://klibiejfisijpagzkxls.supabase.co/storage/v1/object/authenticated/' + $json.storageBucket + '/' + $json.storagePath.split('/').map(encodeURIComponent).join('/') }}",
      options: {
        timeout: 60000,
        response: {
          response: { responseFormat: "file", outputPropertyName: "data" },
        },
      },
    },
    credentials: SUPABASE_CREDENTIAL,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 3000,
    onError: "continueErrorOutput",
  },
  {
    id: "ro-trello-actions-upload-attachment",
    name: "Upload Attachment to Trello",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position: [1920, -580],
    parameters: {
      method: "POST",
      url: "={{ 'https://api.trello.com/1/cards/' + $('Normalize Claimed Trello Action').first().json.cardId + '/attachments' }}",
      authentication: "predefinedCredentialType",
      nodeCredentialType: "trelloApi",
      sendBody: true,
      contentType: "multipart-form-data",
      bodyParameters: {
        parameters: [
          {
            parameterType: "formBinaryData",
            name: "file",
            inputDataFieldName: "data",
          },
          {
            name: "name",
            value: "={{ $('Normalize Claimed Trello Action').first().json.originalFileName }}",
          },
        ],
      },
      options: {
        timeout: 120000,
        response: {
          response: { fullResponse: true, responseFormat: "json" },
        },
      },
    },
    credentials: TRELLO_CREDENTIAL,
    onError: "continueErrorOutput",
  },
  {
    id: "ro-trello-actions-normalize-attachment",
    name: "Normalize Uploaded Trello Attachment",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [2160, -580],
    parameters: {
      jsCode: "const job = $('Normalize Claimed Trello Action').first().json;\nconst raw = $input.first().json || {};\nconst body = raw.body && typeof raw.body === 'object' ? raw.body : raw;\nconst status = Number(raw.statusCode || raw.status || 0);\nif (status && status !== 200 && status !== 201) throw new Error('trello_attachment_upload_failed_' + status);\nif (!body || !/^[a-f0-9]{24}$/i.test(String(body.id || ''))) throw new Error('trello_attachment_response_invalid');\nreturn [{ json: { ...job, externalId: String(body.id), externalUrl: String(body.url || ''), attachmentAlreadyExists: false } }];",
    },
    onError: "continueErrorOutput",
  },
];

const normalizeAttachmentBranch = `} else if (normalized.isAttachment) {
  Object.assign(normalized, normalizeAttachmentPayload(job, payload));
} else if (normalized.isSupplierLabel) {`;

export const operations = [
  {
    type: "patchNodeField",
    nodeName: "Claim One Trello Action",
    fieldPath: "parameters.jsonBody",
    patches: [
      {
        find: '["trello_card_move_v1", "trello_card_comment_v1", "trello_card_label_v1"]',
        replace: '["trello_card_move_v1", "trello_card_comment_v1", "trello_card_label_v1", "trello_card_attachment_v1"]',
      },
    ],
  },
  {
    type: "patchNodeField",
    nodeName: "Normalize Claimed Trello Action",
    fieldPath: "parameters.jsCode",
    patches: [
      {
        find: "const allowedTypes = new Set(['trello_card_move_v1', 'trello_card_comment_v1', 'trello_card_label_v1']);",
        replace: `const allowedTypes = new Set(['trello_card_move_v1', 'trello_card_comment_v1', 'trello_card_label_v1', 'trello_card_attachment_v1']);\n${normalizeAttachmentPayloadSource}`,
      },
      {
        find: "  isMove: job.projection_type === 'trello_card_move_v1',\n  isSupplierLabel: job.projection_type === 'trello_card_label_v1'",
        replace: "  isMove: job.projection_type === 'trello_card_move_v1',\n  isAttachment: job.projection_type === 'trello_card_attachment_v1',\n  isSupplierLabel: job.projection_type === 'trello_card_label_v1'",
      },
      {
        find: "} else if (normalized.isSupplierLabel) {",
        replace: normalizeAttachmentBranch,
      },
    ],
  },
  {
    type: "patchNodeField",
    nodeName: "Complete Trello Action",
    fieldPath: "parameters.jsonBody",
    patches: [
      {
        find: "p_external_id: $json.cardId, p_external_url: $json.cardUrl || \"\"",
        replace: "p_external_id: $json.externalId || $json.cardId, p_external_url: $json.externalUrl || $json.cardUrl || \"\"",
      },
    ],
  },
  {
    type: "patchNodeField",
    nodeName: "Build Trello Action Failure",
    fieldPath: "parameters.jsCode",
    patches: [
      {
        find: "/scope_mismatch|source_list_conflict|not_allowlisted|transition_is_noop|payload|unsupported|invalid_projection/i",
        replace: "/scope_mismatch|source_list_conflict|not_allowlisted|transition_is_noop|payload|unsupported|invalid_projection|attachment_(?:identity|source|storage|file|mime|sha256)/i",
      },
    ],
  },
  ...attachmentNodes.map((node) => ({ type: "addNode", node })),
  {
    type: "removeConnection",
    source: "Normalize Claimed Trello Action",
    target: "Move Action?",
    sourceOutput: "main",
    sourceIndex: 0,
  },
  {
    type: "addConnection",
    source: "Normalize Claimed Trello Action",
    target: "Attachment Action?",
    sourceOutput: "main",
    sourceIndex: 0,
  },
  {
    type: "addConnection",
    source: "Attachment Action?",
    target: "Get Existing Trello Attachments",
    branch: "true",
  },
  {
    type: "addConnection",
    source: "Attachment Action?",
    target: "Move Action?",
    branch: "false",
  },
  {
    type: "addConnection",
    source: "Get Existing Trello Attachments",
    target: "Find Existing Trello Attachment",
    sourceOutput: "main",
    sourceIndex: 0,
  },
  {
    type: "addConnection",
    source: "Get Existing Trello Attachments",
    target: "Build Trello Action Failure",
    sourceOutput: "main",
    sourceIndex: 1,
  },
  {
    type: "addConnection",
    source: "Find Existing Trello Attachment",
    target: "Attachment Already Exists?",
    sourceOutput: "main",
    sourceIndex: 0,
  },
  {
    type: "addConnection",
    source: "Find Existing Trello Attachment",
    target: "Build Trello Action Failure",
    sourceOutput: "main",
    sourceIndex: 1,
  },
  {
    type: "addConnection",
    source: "Attachment Already Exists?",
    target: "Use Existing Trello Attachment",
    branch: "true",
  },
  {
    type: "addConnection",
    source: "Attachment Already Exists?",
    target: "Download Stored Attachment",
    branch: "false",
  },
  {
    type: "addConnection",
    source: "Use Existing Trello Attachment",
    target: "Complete Trello Action",
    sourceOutput: "main",
    sourceIndex: 0,
  },
  {
    type: "addConnection",
    source: "Use Existing Trello Attachment",
    target: "Build Trello Action Failure",
    sourceOutput: "main",
    sourceIndex: 1,
  },
  {
    type: "addConnection",
    source: "Download Stored Attachment",
    target: "Upload Attachment to Trello",
    sourceOutput: "main",
    sourceIndex: 0,
  },
  {
    type: "addConnection",
    source: "Download Stored Attachment",
    target: "Build Trello Action Failure",
    sourceOutput: "main",
    sourceIndex: 1,
  },
  {
    type: "addConnection",
    source: "Upload Attachment to Trello",
    target: "Normalize Uploaded Trello Attachment",
    sourceOutput: "main",
    sourceIndex: 0,
  },
  {
    type: "addConnection",
    source: "Upload Attachment to Trello",
    target: "Build Trello Action Failure",
    sourceOutput: "main",
    sourceIndex: 1,
  },
  {
    type: "addConnection",
    source: "Normalize Uploaded Trello Attachment",
    target: "Complete Trello Action",
    sourceOutput: "main",
    sourceIndex: 0,
  },
  {
    type: "addConnection",
    source: "Normalize Uploaded Trello Attachment",
    target: "Build Trello Action Failure",
    sourceOutput: "main",
    sourceIndex: 1,
  },
];

export const patch = {
  workflowId: WORKFLOW_ID,
  expectedActiveVersionId: EXPECTED_ACTIVE_VERSION_ID,
  expectedBaseNodeCount: 26,
  expectedFinalNodeCount: 34,
  operations,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(patch));
}
