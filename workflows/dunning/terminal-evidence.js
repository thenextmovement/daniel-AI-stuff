const sha256Hex = function sha256HexPure(input) {
  var bytes = input instanceof Uint8Array ? input : Uint8Array.from(input || []);
  var paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  var data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[bytes.length] = 0x80;
  var bitLength = bytes.length * 8;
  var high = Math.floor(bitLength / 0x100000000);
  var low = bitLength >>> 0;
  for (var lengthByteIndex = 0; lengthByteIndex < 4; lengthByteIndex += 1) {
    data[paddedLength - 8 + lengthByteIndex] = (high >>> (24 - lengthByteIndex * 8)) & 0xff;
    data[paddedLength - 4 + lengthByteIndex] = (low >>> (24 - lengthByteIndex * 8)) & 0xff;
  }
  var constants = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  var state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  var words = new Uint32Array(64);
  var rotateRight = (value, count) => ((value >>> count) | (value << (32 - count))) >>> 0;
  for (var offset = 0; offset < data.length; offset += 64) {
    for (var initialWordIndex = 0; initialWordIndex < 16; initialWordIndex += 1) {
      var cursor = offset + initialWordIndex * 4;
      words[initialWordIndex] = ((data[cursor] << 24) | (data[cursor + 1] << 16) | (data[cursor + 2] << 8) | data[cursor + 3]) >>> 0;
    }
    for (var expandedWordIndex = 16; expandedWordIndex < 64; expandedWordIndex += 1) {
      var x = words[expandedWordIndex - 15];
      var y = words[expandedWordIndex - 2];
      var sigma0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      var sigma1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[expandedWordIndex] = (words[expandedWordIndex - 16] + sigma0 + words[expandedWordIndex - 7] + sigma1) >>> 0;
    }
    var a = state[0]; var b = state[1]; var c = state[2]; var d = state[3];
    var e = state[4]; var f = state[5]; var g = state[6]; var h = state[7];
    for (var roundIndex = 0; roundIndex < 64; roundIndex += 1) {
      var sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      var choose = (e & f) ^ (~e & g);
      var temporary1 = (h + sum1 + choose + constants[roundIndex] + words[roundIndex]) >>> 0;
      var sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      var majority = (a & b) ^ (a & c) ^ (b & c);
      var temporary2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temporary1) >>> 0;
      d = c; c = b; b = a; a = (temporary1 + temporary2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0; state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0; state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0; state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0; state[7] = (state[7] + h) >>> 0;
  }
  return Array.from(state, (value) => value.toString(16).padStart(8, '0')).join('');
};
const gate = $('Build Complete Live Gate + Message').first().json || {};
const input = $input.first().json || {};
let frozen = gate;
if (gate.attachment_required === true) { try { frozen = $('Validate + SHA256 + Freeze PDF').first().json || gate; } catch {} }
const unwrapHttp = (value) => { const current = value ?? {}; const isFullResponse = current && typeof current === 'object' && !Array.isArray(current) && Object.prototype.hasOwnProperty.call(current, 'statusCode') && Object.prototype.hasOwnProperty.call(current, 'body'); return isFullResponse ? current.body : current; };
let messageEnvelope = {};
try { messageEnvelope = $('Graph Verify Immutable Sent Item').first().json || {}; } catch {}
const message = unwrapHttp(messageEnvelope) || {};
let draftRecordEnvelope = {};
try { draftRecordEnvelope = $('DB Record Draft Before Send').first().json || {}; } catch {}
const draftRecordPayload = unwrapHttp(draftRecordEnvelope);
const draftRecordRows = Array.isArray(draftRecordPayload) ? draftRecordPayload : [];
const recordedDraftId = String(draftRecordRows[0]?.draft_id || '');
let createEnvelope = {};
try { createEnvelope = $('Graph Create Immutable Customer Draft').first().json || {}; } catch {}
const createPayload = unwrapHttp(createEnvelope) || {};
const createdDraftId = String(createPayload.id || '');
const verifiedMessageId = String(message.id || '');
const immutableMessageId = recordedDraftId || createdDraftId || verifiedMessageId;
let postedAttachment = {};
try { postedAttachment = $('Graph Attach Frozen Invoice PDF').first(0).json || {}; } catch {}
postedAttachment = postedAttachment.body || postedAttachment;
const attachmentPayload = input.body || input;
const recipients = (message.toRecipients || []).map((entry) => String(entry?.emailAddress?.address || '').trim().toLowerCase()).filter(Boolean);
const internetHeaders = new Map((message.internetMessageHeaders || []).map((header) => [String(header?.name || '').toLowerCase(), String(header?.value || '')]));
const messageVerified = Boolean(immutableMessageId && verifiedMessageId === immutableMessageId && message.isDraft === false && message.sentDateTime && recipients.length === 1 && recipients[0] === String(gate.recipient || '').toLowerCase() && String(message.subject || '') === String(gate.subject || '') && internetHeaders.get('x-neontrip-idempotency-key') === String(gate.lock_key || '') && internetHeaders.get('x-neontrip-payment-stage') === String(gate.stage || ''));
let attachmentVerified = false; let attachmentHash = null; let decodedBytes = null; let sentAttachment = null; let attachmentVerificationChecks = {};
if (gate.attachment_required === true) {
  const expectedName = String(frozen.attachment_name || '');
  const postedId = String(postedAttachment.id || '');
  const singleFileAttachment = Boolean(attachmentPayload && !Array.isArray(attachmentPayload) && String(attachmentPayload['@odata.type'] || '').toLowerCase() === '#microsoft.graph.fileattachment');
  sentAttachment = singleFileAttachment ? attachmentPayload : null;
  let decoded = null;
  try { decoded = sentAttachment?.contentBytes ? Buffer.from(String(sentAttachment.contentBytes), 'base64') : null; } catch {}
  if (decoded) { decodedBytes = decoded.length; attachmentHash = sha256Hex(decoded); }
  attachmentVerificationChecks = {
    frozen_pdf_validated: frozen.pdf_validated === true,
    frozen_hash_present: Boolean(frozen.pdf_sha256),
    frozen_size_valid: Number(frozen.pdf_bytes) >= 1000 && Number(frozen.pdf_bytes) < 3 * 1024 * 1024,
    sent_message_has_attachment: message.hasAttachments === true,
    sent_single_file_attachment: singleFileAttachment,
    posted_id_present: Boolean(postedId),
    attachment_id_matches: String(sentAttachment?.id || '') === postedId,
    posted_name_matches: String(postedAttachment.name || '') === expectedName,
    sent_name_matches: String(sentAttachment?.name || '') === expectedName,
    posted_size_valid: Number.isSafeInteger(Number(postedAttachment.size)) && Number(postedAttachment.size) > 0,
    graph_sizes_match: Number(sentAttachment?.size) === Number(postedAttachment.size),
    posted_pdf_type: String(postedAttachment.contentType || '').toLowerCase() === 'application/pdf',
    sent_pdf_type: String(sentAttachment?.contentType || '').toLowerCase() === 'application/pdf',
    posted_not_inline: postedAttachment.isInline === false,
    sent_not_inline: sentAttachment?.isInline === false,
    decoded_size_matches: decodedBytes === Number(frozen.pdf_bytes),
    decoded_hash_matches: attachmentHash === String(frozen.pdf_sha256)
  };
  attachmentVerified = Object.values(attachmentVerificationChecks).every((value) => value === true);
} else {
  attachmentVerificationChecks = { sent_message_has_no_attachment: message.hasAttachments === false };
  attachmentVerified = attachmentVerificationChecks.sent_message_has_no_attachment;
}
const verified = Boolean(messageVerified && attachmentVerified);
const sentAt = verified ? String(message.sentDateTime) : null;
const error = verified ? null : String(input.message || input.error?.message || message.message || message.error?.message || 'OUTLOOK_OR_ATTACHMENT_DELIVERY_NOT_IMMUTABLY_VERIFIED').slice(0, 1500);
const baseMetadata = { evidence_schema: 't099.sender.evidence.v1', ticket: '099', execution_id: String($execution.id), lock_key: gate.lock_key, stage: gate.stage, stage_model: gate.stage_model || 'current_6', continuation: gate.continuation || null, recipient: gate.recipient, shopify_order_id: gate.shopify_order_id, shopify_order_name: gate.shopify_order_name, customer_name: gate.live_evidence?.customer_name || null, easybill_document_id: gate.easybill_document_id, easybill_invoice_number: gate.easybill_invoice_number, amount_due_cents: gate.amount_due_cents, currency: gate.currency, provider_draft_id: immutableMessageId || null, pdf_sha256: gate.attachment_required === true ? (frozen.pdf_sha256 || null) : null, pdf_bytes: gate.attachment_required === true ? (frozen.pdf_bytes || null) : null, easybill_version_id: gate.easybill_version_id, easybill_version_item_id: gate.easybill_version_item_id, attachment_verified: attachmentVerified, attachment_verification_checks: attachmentVerificationChecks, attachment_id: sentAttachment ? String(sentAttachment.id || '') : null, attachment_name: sentAttachment ? String(sentAttachment.name || '') : null, attachment_graph_size: sentAttachment ? Number(sentAttachment.size) : null, attachment_decoded_bytes: decodedBytes, attachment_content_sha256: attachmentHash, live_evidence: gate.live_evidence, warnings: gate.warnings || [] };
const customerMessageRecord = verified ? { message_id: String(message.id), internet_message_id: message.internetMessageId || null, conversation_id: message.conversationId || null, mailbox: 'support@neontrip.de', direction: 'outbound', from_email: 'support@neontrip.de', to_emails: [gate.recipient], subject: gate.subject, body_preview: String(gate.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500), sent_at: sentAt, message_created_at: sentAt, source: 'outlook', raw_metadata: baseMetadata } : null;
const auditRecord = { document_id: String(gate.shopify_order_id || ''), workflow_name: 'TICKET-099 Existing Ledger Sender', action: verified ? 'customer_stage_sent_verified' : 'customer_delivery_unknown_locked_final', status: verified ? 'sent' : 'blocked', error_message: error, metadata: { ...baseMetadata, provider_message_id: verified ? String(message.id) : null, provider_internet_message_id: verified ? (message.internetMessageId || null) : null, provider_conversation_id: verified ? (message.conversationId || null) : null, sent_at: sentAt } };
const terminalLockRecord = { status: verified ? 'draft_created' : 'failed_final', locked_at: '2100-01-01T00:00:00.000Z', message_id: verified ? String(message.id) : null, internet_message_id: verified ? (message.internetMessageId || null) : null, conversation_id: verified ? (message.conversationId || null) : null, lease_until: sentAt, next_retry_at: null, last_error: error, draft_id: immutableMessageId || null, updated_at: $now.toUTC().toISO() };
return [{ json: { verified, provider_draft_id: immutableMessageId || null, customer_message_record: customerMessageRecord, audit_record: auditRecord, terminal_lock_record: terminalLockRecord } }];