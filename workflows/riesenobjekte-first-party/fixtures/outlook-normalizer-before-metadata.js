
const emailItems = $('Get Unstructured Outlook Emails').all();
const attachmentItems = $input.all();
if (!emailItems.length) return [];
if (attachmentItems.length !== emailItems.length) {
  throw new Error('IMAP-Anhangzuordnung unvollstaendig; E-Mail bleibt im Quellordner.');
}

const items = emailItems.map((emailItem, index) => ({
  json: emailItem.json || {},
  binary: attachmentItems[index]?.binary || {}
}));
const source = items.slice().sort((left, right) => {
  const a = Date.parse(left.json.envelope?.date || 0) || 0;
  const b = Date.parse(right.json.envelope?.date || 0) || 0;
  return a - b;
})[0];
const email = source.json || {};
const envelope = email.envelope || {};
const rawHtml = String(email.htmlContent || '');
const clean = (value, max = 1000) => String(value == null ? '' : value)
  .replace(/[\u0000-\u001F\u007F]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);
const decodeText = (value) => String(value || '')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/p>/gi, '\n\n')
  .replace(/<\/div>/gi, '\n')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/\r\n/g, '\n')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();
const normalizeBody = (value) => String(value || '')
  .replace(/\r\n/g, '\n')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]+/g, ' ')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const asArray = (value) => Array.isArray(value) ? value : (value ? [value] : []);
let senderEmail = '';
let senderName = '';
const candidates = [
  ...asArray(envelope.from),
  ...asArray(envelope.sender),
  ...asArray(envelope.replyTo)
];
for (const candidate of candidates) {
  if (typeof candidate === 'string') {
    const match = candidate.match(/<?([^\s<>]+@[^\s<>]+)>?/);
    if (match) senderEmail = match[1];
  } else {
    senderEmail = candidate.address || senderEmail;
    senderName = candidate.name || senderName;
  }
  if (senderEmail) break;
}
senderEmail = clean(senderEmail, 254).toLowerCase();
senderName = clean(senderName, 180);
if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(senderEmail)) {
  throw new Error('Outlook-Anfrage ohne gueltige Absenderadresse; E-Mail bleibt im Quellordner.');
}

const bodyText = (normalizeBody(email.textContent || email.markdownContent) || decodeText(rawHtml)).slice(0, 60000);
const subject = clean(envelope.subject || 'Anfrage per E-Mail', 500);
const imapUid = clean(email.uid, 100);
const imapMailboxPath = clean(email.mailboxPath || 'Unstrukturierte Anfrage', 1000);
if (!imapUid) {
  throw new Error('Outlook-Anfrage ohne IMAP-UID; E-Mail bleibt im Quellordner.');
}
const graphMessageId = clean('imap:' + imapMailboxPath + ':' + imapUid, 4000);
const internetMessageId = clean(envelope.messageId, 1000);
const conversationId = clean(envelope.inReplyTo, 1000);
const receivedMs = Date.parse(envelope.date || '');
const receivedDateTime = Number.isFinite(receivedMs) ? new Date(receivedMs).toISOString() : '';

function stableHashHex(input, length) {
  const sourceValue = String(input || 'outlook-email');
  let output = '';
  let round = 0;
  while (output.length < length) {
    let hash = 0x811c9dc5;
    const material = sourceValue + '|' + round;
    for (let index = 0; index < material.length; index += 1) {
      hash ^= material.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    output += hash.toString(16).padStart(8, '0');
    round += 1;
  }
  return output.slice(0, length);
}
const stableSource = internetMessageId || graphMessageId ||
  [subject, receivedDateTime, senderEmail].filter(Boolean).join('|');
const hash = stableHashHex(stableSource, 22);
const submissionId = '000ff1ce-' + hash.slice(0, 4) + '-4' + hash.slice(4, 7) +
  '-8' + hash.slice(7, 10) + '-' + hash.slice(10, 22);
const idempotencyKey = 'riesenobjekte-first-party:' + submissionId;

const allowedExtensions = new Set(['ai','eps','gif','jpeg','jpg','pdf','png','svg','webp']);
const allowedMimes = new Set([
  'application/illustrator','application/octet-stream','application/pdf',
  'application/postscript','image/gif','image/jpeg','image/png','image/svg+xml','image/webp'
]);
const binary = {};
const ignoredInline = [];
const rejected = [];
const htmlLower = rawHtml.toLowerCase();

for (const [key, original] of Object.entries(source.binary || {})) {
  const file = original || {};
  const fileName = clean(file.fileName || key, 255);
  const extension = (fileName.toLowerCase().match(/\.([a-z0-9]+)$/) || [,''])[1];
  let mimeType = clean(file.mimeType || 'application/octet-stream', 120).toLowerCase().split(';')[0];
  if (mimeType === 'image/jpg') mimeType = 'image/jpeg';
  if (extension === 'svg' && ['application/xml','text/xml','text/plain'].includes(mimeType)) mimeType = 'image/svg+xml';
  const contentId = clean(file.contentId || file.contentID || file.cid || '', 500).replace(/^<|>$/g, '');
  const explicitInline = file.isInline === true || file.inline === true || file.attachmentType === 'inline';
  const cidNeedle = contentId ? 'cid:' + contentId.toLowerCase() : '';
  const cidPosition = cidNeedle ? htmlLower.indexOf(cidNeedle) : -1;
  const cidReferenced = cidPosition >= 0;
  const sizeBytes = Number(file.fileSize || file.size || 0);
  const inlineImage = mimeType.startsWith('image/') && (explicitInline || cidReferenced);
  const signatureMarkers = [
    /mit\s+freundlichen\s+gr(?:ü|&uuml;|ue|u)(?:ß|&szlig;|ss)en?/i,
    /freundliche\s+gr(?:ü|&uuml;|ue|u)(?:ß|&szlig;|ss)en?/i,
    /<[^>]+(?:id|class)=["'][^"']*(?:signature|signatur)[^"']*["']/i
  ];
  const signaturePositions = signatureMarkers
    .map((pattern) => htmlLower.search(pattern))
    .filter((position) => position >= 0);
  const signatureBoundary = signaturePositions.length
    ? Math.min(...signaturePositions)
    : Number.POSITIVE_INFINITY;
  const inlineAfterSignature = inlineImage && cidPosition >= signatureBoundary;
  const tinyTrackingImage = mimeType.startsWith('image/') && sizeBytes > 0 && sizeBytes <= 2048;
  const namedSignatureAsset = /^(signature|signatur|footer|spacer|pixel|tracking|logo)([-_0-9].*)?\.(png|jpe?g|gif|webp)$/i.test(fileName);
  const unreferencedSignatureAsset = inlineImage && cidPosition < 0 && namedSignatureAsset;
  if (inlineAfterSignature || tinyTrackingImage || unreferencedSignatureAsset) {
    ignoredInline.push(fileName);
    continue;
  }
  if (!allowedExtensions.has(extension) || !allowedMimes.has(mimeType)) {
    rejected.push(fileName + ' (' + mimeType + ')');
    continue;
  }
  if (sizeBytes > 15 * 1024 * 1024) {
    rejected.push(fileName + ' (groesser als 15 MB)');
    continue;
  }
  binary[key] = { ...file, fileName, mimeType };
}
if (rejected.length) {
  throw new Error('Nicht unterstuetzte Kundenanhaenge: ' + rejected.slice(0, 5).join(', ') + '. E-Mail bleibt im Quellordner.');
}
if (Object.keys(binary).length > 5) {
  throw new Error('Mehr als 5 Kundenanhaenge; E-Mail bleibt im Quellordner.');
}

return [{
  json: {
    graphMessageId,
    imapUid,
    imapMailboxPath,
    internetMessageId,
    conversationId,
    receivedDateTime,
    senderEmail,
    senderName: senderName || senderEmail,
    subject,
    bodyText,
    extractionText: bodyText.slice(0, 20000),
    submissionId,
    idempotencyKey,
    attachmentCount: Object.keys(binary).length,
    ignoredInlineAttachments: ignoredInline,
    _startTime: Date.now()
  },
  binary
}];
