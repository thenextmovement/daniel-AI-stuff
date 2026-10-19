const response = (name) => { const envelope = $(name).first().json || {}; const body = envelope.body; const status = Number(envelope.statusCode || 0); const headers = envelope.headers || {}; const range = String(headers['content-range'] || headers['Content-Range'] || ''); const totalPart = range.includes('/') ? range.split('/').pop() : ''; const total = /^\d+$/.test(totalPart) ? Number(totalPart) : null; const complete = status >= 200 && status < 300 && Array.isArray(body) && total !== null && total <= body.length && body.length < 1000; return { envelope, rows: Array.isArray(body) ? body : [], complete, status, total }; };
const paginatedResponse = (name) => {
  const pageSize = 1000;
  const pageItems = $(name).all().map((item) => item.json || {});
  const rows = [];
  let complete = pageItems.length > 0 && pageItems.length <= 500;
  let total = null;
  for (let index = 0; index < pageItems.length; index += 1) {
    const envelope = pageItems[index] || {};
    const body = envelope.body;
    const status = Number(envelope.statusCode || 0);
    const headers = envelope.headers || {};
    const range = String(headers['content-range'] || headers['Content-Range'] || '');
    if (status < 200 || status >= 300 || !Array.isArray(body)) { complete = false; continue; }
    if (range === '*/0') {
      if (index !== 0 || pageItems.length !== 1 || body.length !== 0 || (total !== null && total !== 0)) complete = false;
      total = 0;
      continue;
    }
    const rangeParts = range.split('/');
    const bounds = rangeParts.length === 2 ? rangeParts[0].split('-') : [];
    const numericRange = bounds.length === 2 && /^\d+$/.test(bounds[0]) && /^\d+$/.test(bounds[1]) && /^\d+$/.test(rangeParts[1]);
    if (!numericRange) { complete = false; rows.push(...body); continue; }
    const start = Number(bounds[0]);
    const end = Number(bounds[1]);
    const pageTotal = Number(rangeParts[1]);
    if (![start, end, pageTotal].every(Number.isSafeInteger) || start !== index * pageSize || body.length < 1 || body.length > pageSize || end !== start + body.length - 1 || pageTotal < body.length) complete = false;
    if (total == null) total = pageTotal; else if (total !== pageTotal) complete = false;
    if (end + 1 < pageTotal && body.length !== pageSize) complete = false;
    if (end + 1 >= pageTotal && index !== pageItems.length - 1) complete = false;
    rows.push(...body);
  }
  const expectedPages = total === 0 ? 1 : (Number.isSafeInteger(total) && total > 0 ? Math.ceil(total / pageSize) : null);
  if (total == null || total !== rows.length || expectedPages == null || pageItems.length !== expectedPages) complete = false;
  return { pages: pageItems, rows, complete, total };
};
if (true !== true) return [];
const locksResponse = paginatedResponse('Read Existing One-Shot Ledger'); const auditResponse = paginatedResponse('Read Sender Evidence Audits'); const messageResponse = paginatedResponse('Read Sender Evidence Messages'); const holdsResponse = paginatedResponse('Read All Manual Dunning Holds'); const enrollmentResponse = paginatedResponse('Read Active Legacy Enrollments'); const intakeEnvelope = $('Read Latest Live Complete Intake').first().json || {}; const intakeRows = Array.isArray(intakeEnvelope.body) ? intakeEnvelope.body : []; const intake = intakeRows[0] || null; const metadata = intake?.metadata || {}; const cutover = DateTime.fromISO('2026-08-05T17:30:00+02:00', { setZone: true }).toUTC(); const observed = DateTime.fromISO(String(metadata.observed_at || ''), { setZone: true }).toUTC(); const freshUntil = DateTime.fromISO(String(metadata.fresh_until || ''), { setZone: true }).toUTC(); const nowUtc = $now.toUTC();
const latestRunId = String(metadata.run_id || ''); const duplicateRows = latestRunId ? intakeRows.filter((row) => String(row?.metadata?.run_id || '') === latestRunId) : []; const snapshotFingerprint = (row) => JSON.stringify({ workflow_name: row?.workflow_name, action: row?.action, status: row?.status, error_message: row?.error_message ?? null, metadata: row?.metadata }); const duplicateConsistent = duplicateRows.length > 0 && duplicateRows.every((row) => snapshotFingerprint(row) === snapshotFingerprint(intake)); const sourceCountersValid = Number.isSafeInteger(metadata.sources?.shopify?.row_count) && Number.isSafeInteger(metadata.sources?.easybill?.row_count) && Number.isSafeInteger(metadata.union?.key_count) && Array.isArray(metadata.union?.rows) && metadata.union.key_count === metadata.union.rows.length && Array.isArray(metadata.candidates) && metadata.union?.candidate_count === metadata.candidates.length;
const candidateKeys = Array.isArray(metadata.candidates) ? metadata.candidates.map((row) => String(row?.candidate_key || '')) : []; const candidatesValid = candidateKeys.length === new Set(candidateKeys).size && candidateKeys.every(Boolean) && metadata.schema === 't099.intake.snapshot.v2' && (metadata.candidates || []).every((row) => row.preliminary_only === true && DateTime.fromISO(String(row.shopify_order_created_at || ''), { setZone: true }).toUTC().isValid && DateTime.fromISO(String(row.shopify_order_updated_at || ''), { setZone: true }).toUTC().isValid && DateTime.fromISO(String(row.easybill_document_created_at || ''), { setZone: true }).toUTC().isValid && DateTime.fromISO(String(row.shopify_order_created_at || ''), { setZone: true }).toUTC() >= cutover && DateTime.fromISO(String(row.easybill_document_created_at || ''), { setZone: true }).toUTC() >= cutover && Number.isSafeInteger(Number(row.invoice_amount_cents)) && Number(row.invoice_amount_cents) > 0 && Number.isSafeInteger(Number(row.payment_received_cents)) && Number(row.payment_received_cents) >= 0 && Number.isSafeInteger(Number(row.easybill_paid_cents)) && Number(row.easybill_paid_cents) === Number(row.payment_received_cents) && Number.isSafeInteger(Number(row.amount_due_cents)) && Number(row.amount_due_cents) > 0 && Number(row.payment_received_cents) + Number(row.amount_due_cents) === Number(row.invoice_amount_cents) && ['initial','partial_payment'].includes(String(row.cycle_kind || '')) && String(row.cycle_id || '').length > 0);
const senderLockKeys = locksResponse.rows.map((row) => String(row.request_id || '')); const senderLocksScoped = senderLockKeys.every((key) => key.startsWith('e936881a-fe32-4d94-aa1d-eaffcf4a75be:T099:PAYMENT_COLLECTION:')) && new Set(senderLockKeys).size === senderLockKeys.length; const allowedSenderAuditActions = new Set(['customer_send_blocked_preclaim','customer_stage_sent_verified','customer_reply_decision']); const senderAuditIds = auditResponse.rows.map((row) => String(row.id || '')); const senderAuditsScoped = senderAuditIds.every(Boolean) && new Set(senderAuditIds).size === senderAuditIds.length && auditResponse.rows.every((row) => row.workflow_name === 'TICKET-099 Existing Ledger Sender' && allowedSenderAuditActions.has(String(row.action || '')) && String(row.metadata?.lock_key || '').startsWith('e936881a-fe32-4d94-aa1d-eaffcf4a75be:T099:PAYMENT_COLLECTION:') && DateTime.fromISO(String(row.created_at || ''), { setZone: true }).toUTC().isValid && DateTime.fromISO(String(row.created_at || ''), { setZone: true }).toUTC() >= cutover && (row.action !== 'customer_reply_decision' || (row.status === 'success' && row.metadata?.schema === 't268.reply-decision.v1' && ['continue_dunning','stop_dunning','uncertain'].includes(String(row.metadata?.decision || '')) && typeof row.metadata?.reply_message_id === 'string' && row.metadata.reply_message_id.length > 0 && DateTime.fromISO(String(row.metadata?.reply_received_at || ''), { setZone: true }).toUTC().isValid && Number.isSafeInteger(Number(row.metadata?.payment_received_cents)) && Number(row.metadata?.payment_received_cents) >= 0 && Number.isSafeInteger(Number(row.metadata?.amount_due_cents)) && Number(row.metadata?.amount_due_cents) > 0)));
const holdOrders = new Map(); let holdsUnique = true; for (const row of holdsResponse.rows) { const key = String(row.shopify_order_number || '').normalize('NFKC').trim().toUpperCase(); if (!key) { holdsUnique = false; continue; } if (holdOrders.has(key)) holdsUnique = false; holdOrders.set(key, row); }
const senderMessageIds = messageResponse.rows.map((row) => String(row.message_id || '')); const senderMessagesScoped = senderMessageIds.every(Boolean) && new Set(senderMessageIds).size === senderMessageIds.length && messageResponse.rows.every((row) => row.direction === 'outbound' && row.source === 'outlook' && DateTime.fromISO(String(row.sent_at || ''), { setZone: true }).toUTC().isValid && DateTime.fromISO(String(row.sent_at || ''), { setZone: true }).toUTC() >= cutover);
const enrollmentIds = enrollmentResponse.rows.map((row) => String(row.id || ''));
const normalCandidateKeys = new Set(candidateKeys);
let enrollmentsValid = enrollmentIds.every(Boolean) && new Set(enrollmentIds).size === enrollmentIds.length;
const enrolledCandidates = [];
for (const enrollment of enrollmentResponse.rows) {
  const m = enrollment?.metadata || {};
  const row = m.candidate_snapshot || {};
  const orderId = String(row.shopify_order_id || '').replace(/^gid:\/\/shopify\/Order\//, '');
  const orderName = String(row.shopify_order_name || '').normalize('NFKC').trim().toUpperCase();
  const invoiceNumber = String(row.easybill_invoice_number || '').normalize('NFKC').trim().toUpperCase();
  const normalizedOrderNumber = orderName.replace(/^#?NEONT/, '');
  const normalizedInvoiceNumber = invoiceNumber.replace(/^#?NEONT/, '');
  const candidateKey = String(row.candidate_key || '');
  const orderCreated = DateTime.fromISO(String(row.shopify_order_created_at || ''), { setZone: true }).toUTC();
  const invoiceCreated = DateTime.fromISO(String(row.easybill_document_created_at || ''), { setZone: true }).toUTC();
  const email = String(row.shopify_email_hint || '').trim().toLowerCase();
  const valid = enrollment.workflow_name === 'TICKET-248 Legacy Enrollment' &&
    enrollment.action === 'legacy_candidate_enrolled' &&
    enrollment.status === 'success' &&
    enrollment.error_message == null &&
    m.schema === 't099.legacy.enrollment.v1' &&
    m.approved_ticket === 'TICKET-248' &&
    m.approved_by === 'Rahim' &&
    m.authorization_scope === 'single_case_after_verified_s1' &&
    row.preliminary_only === true &&
    row.intake_evidence?.source === 'manual_legacy_enrollment_v1' &&
    row.intake_evidence?.approved_ticket === 'TICKET-248' &&
    row.intake_evidence?.approved_by === 'Rahim' &&
    /^\d+$/.test(orderId) &&
    orderName === '#NEONT' + normalizedOrderNumber &&
    invoiceNumber === '#NEONT' + normalizedInvoiceNumber &&
    normalizedOrderNumber === normalizedInvoiceNumber &&
    String(row.easybill_document_id || '').length > 0 &&
    String(row.easybill_customer_id || '').length > 0 &&
    candidateKey.length > 0 &&
    !normalCandidateKeys.has(candidateKey) &&
    orderCreated.isValid &&
    invoiceCreated.isValid &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(row.easybill_due_date || '')) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    Number.isSafeInteger(Number(row.amount_due_cents)) &&
    Number(row.amount_due_cents) > 0 &&
    /^[A-Z]{3}$/.test(String(row.currency || '').toUpperCase());
  if (!valid) { enrollmentsValid = false; continue; }
  normalCandidateKeys.add(candidateKey);
  enrolledCandidates.push({
    ...row,
    shopify_order_id: orderId,
    shopify_order_gid: String(row.shopify_order_gid || 'gid://shopify/Order/' + orderId),
    shopify_order_name: orderName,
    easybill_invoice_number: invoiceNumber,
    shopify_email_hint: email,
    currency: String(row.currency || '').toUpperCase(),
    intake_evidence: {
      source: 'manual_legacy_enrollment_v1',
      enrollment_audit_id: String(enrollment.id),
      approved_ticket: 'TICKET-248',
      approved_by: 'Rahim',
      candidate_key: candidateKey,
      observed_at: String(enrollment.created_at || '')
    }
  });
}

const historicalEnvelope = $('Read Latest Historical Control').first().json || {};
const historicalAudit = Array.isArray(historicalEnvelope.body) ? historicalEnvelope.body[0] : null;
const historical = historicalAudit?.metadata?.continuation;
const historicalRows = historical?.candidates || [];
const historicalObserved = DateTime.fromISO(String(historical?.observed_at || ''), { setZone: true }).toUTC();
const historicalUntil = DateTime.fromISO(String(historical?.fresh_until || ''), { setZone: true }).toUTC();
if (Number(historicalEnvelope.statusCode) !== 200 || historicalAudit?.status !== 'success' || historicalAudit?.action !== 'daily_35_day_dunning_audit' || historical?.schema !== 'dunning.historical.snapshot.v1' || !historicalObserved.isValid || !historicalUntil.isValid || historicalObserved > nowUtc || historicalUntil.toMillis() - historicalObserved.toMillis() !== 26 * 3600000 || nowUtc > historicalUntil || !Array.isArray(historicalRows)) throw new Error('HISTORICAL_CONTINUATION_SOURCE_STALE_OR_INCOMPLETE');
const historicalOrderIds = new Set();
for (const row of historicalRows) {
  const c = row.continuation || {}, a = c.anchor;
  const valid = row.preliminary_only === true && row.intake_evidence?.source === 'historical_control_v1' && c.schema === 'dunning.historical.candidate.v1' &&
    /^\d+$/.test(row.shopify_order_id || '') && /^#NEONT\d+$/.test(row.shopify_order_name || '') &&
    !historicalOrderIds.has(row.shopify_order_id) && c.cycle_prefix === 'e936881a-fe32-4d94-aa1d-eaffcf4a75be:T099:PAYMENT_COLLECTION:' + row.shopify_order_id + ':C-' + c.cycle_id &&
    /^[A-Za-z0-9-]+$/.test(c.cycle_id || '') && ['current_6','legacy_4'].includes(c.stage_model) && ['INVOICE','PROFORMA_INVOICE'].includes(c.document_type) &&
    row.easybill_document_type === c.document_type && Number.isSafeInteger(row.amount_due_cents) && row.amount_due_cents > 0 &&
    Number.isSafeInteger(row.payment_received_cents) && row.payment_received_cents >= 0 && row.easybill_paid_cents === row.payment_received_cents &&
    row.amount_due_cents + row.payment_received_cents === row.invoice_amount_cents &&
    c.observed_at === historical.observed_at &&
    (!a || (Number.isInteger(a.stage) && a.stage >= 1 && a.stage < (c.stage_model === 'legacy_4' ? 4 : 6) && a.message_id && a.internet_message_id && a.conversation_id && DateTime.fromISO(a.sent_at, {setZone:true}).isValid && ['reviewed_reminder','outlook_legacy'].includes(a.evidence)));
  if (!valid) throw new Error('HISTORICAL_CONTINUATION_CANDIDATE_INVALID');
  historicalOrderIds.add(row.shopify_order_id);
}
const historicalProtected = new Set((historical?.excluded || []).filter(row => row.reason !== 'REGULAR_INTAKE').map(row => row.order));
const allCandidateRows = [...(metadata.candidates || []), ...enrolledCandidates].filter(row => !historicalOrderIds.has(String(row.shopify_order_id)) && !historicalProtected.has(String(row.shopify_order_name))).concat(historicalRows);

if (Number(intakeEnvelope.statusCode || 0) < 200 || Number(intakeEnvelope.statusCode || 0) >= 300 || !intake || !duplicateConsistent || intake.workflow_name !== 'TICKET-099 Existing Ledger Intake' || intake.action !== 'future_candidate_snapshot' || intake.status !== 'success' || metadata.schema !== 't099.intake.snapshot.v2' || metadata.source_complete !== true || metadata.sources?.shopify?.complete !== true || metadata.sources?.easybill?.complete !== true || metadata.candidates_truncated !== false || !observed.isValid || !freshUntil.isValid || freshUntil.toMillis() - observed.toMillis() !== 90 * 60 * 1000 || nowUtc > freshUntil || !DateTime.fromISO(String(metadata.cutover_at || ''), { setZone: true }).toUTC().equals(cutover) || !sourceCountersValid || !candidatesValid || !locksResponse.complete || !senderLocksScoped || !auditResponse.complete || !senderAuditsScoped || !messageResponse.complete || !senderMessagesScoped || !holdsResponse.complete || !holdsUnique || !enrollmentResponse.complete || !enrollmentsValid) return [];
const t268Cutover = DateTime.fromISO('2026-09-09T11:01:25Z', { setZone: true }).toUTC();
const permanentReasons = new Set(['EXISTING_COMPANY_DOMAIN_PRIOR_PAID','SHOPIFY_CANCELLED','SHOPIFY_REFUND_OR_VOID_PRESENT','SHOPIFY_CHARGEBACK_OR_DISPUTE_PRESENT','EASYBILL_STORNO','EASYBILL_STORNO_RELATED','EASYBILL_FULL_CREDIT','EASYBILL_PARTIAL_CREDIT_REVIEW','EASYBILL_REPLACEMENT_INVOICE','CUSTOMER_EMAIL_INVALID','CUSTOMER_REPLIED_TO_PAYMENT_REMINDER','CUSTOMER_REPLY_BEFORE_T268_CUTOVER','T268_PARTIAL_BEFORE_CUTOVER']);
const permanentBlockedKeys = new Set();
const recentTechnicalBlockedKeys = new Set();
for (const audit of auditResponse.rows) {
  if (audit.action !== 'customer_send_blocked_preclaim') continue;
  const key = String(audit.metadata?.lock_key || '');
  const reasons = Array.isArray(audit.metadata?.reasons) ? audit.metadata.reasons.map(String) : [];
  if (!key) continue;
  const unavailableShopifyOrder = reasons.includes('SHOPIFY_LIVE_GATE_INCOMPLETE') && !String(audit.metadata?.live_evidence?.shopify_order_id || '').trim();
  const permanentEvidenceReasons = unavailableShopifyOrder ? reasons.filter((reason) => !['SHOPIFY_REFUND_OR_VOID_PRESENT','CUSTOMER_EMAIL_INVALID'].includes(reason)) : reasons;
  if (permanentEvidenceReasons.some((reason) => permanentReasons.has(reason))) permanentBlockedKeys.add(key);
  else {
    const created = DateTime.fromISO(String(audit.created_at || ''), { setZone: true });
    if (created.isValid && created >= nowUtc.minus({ hours: 2 })) recentTechnicalBlockedKeys.add(key);
  }
}
const sentAudits = new Map(); for (const audit of auditResponse.rows) if (audit.action === 'customer_stage_sent_verified' && audit.status === 'sent' && audit.metadata?.lock_key) sentAudits.set(String(audit.metadata.lock_key), audit); const sentMessagesById = new Map(messageResponse.rows.map((message) => [String(message.message_id || ''), message])); const lockByKey = new Map(locksResponse.rows.map((row) => [String(row.request_id), row])); const verified = (row, key, stageNumber) => { const audit = sentAudits.get(key); const message = sentMessagesById.get(String(row?.message_id || '')); const sentAt = DateTime.fromISO(String(row?.lease_until || ''), { setZone: true }); const to = Array.isArray(message?.to_emails) ? message.to_emails.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean) : []; return Boolean(row && row.status === 'draft_created' && row.message_id && sentAt.isValid && audit && message && message.direction === 'outbound' && message.source === 'outlook' && String(message.message_id || '') === String(row.message_id) && String(message.internet_message_id || '') === String(row.internet_message_id || '') && String(message.conversation_id || '') === String(row.conversation_id || '') && String(audit.metadata?.provider_message_id || '') === String(row.message_id) && String(audit.metadata?.provider_internet_message_id || '') === String(row.internet_message_id || '') && String(audit.metadata?.provider_conversation_id || '') === String(row.conversation_id || '') && String(audit.metadata?.evidence_schema || '') === 't099.sender.evidence.v1' && String(audit.metadata?.ticket || '') === '099' && Number(audit.metadata?.stage) === stageNumber && DateTime.fromISO(String(message.sent_at || ''), { setZone: true }).toMillis() === sentAt.toMillis() && DateTime.fromISO(String(audit.metadata?.sent_at || ''), { setZone: true }).toMillis() === sentAt.toMillis() && to.length === 1 && to[0] === String(audit.metadata?.recipient || audit.metadata?.live_evidence?.customer_email || '').trim().toLowerCase() && (message.cc_emails == null || message.cc_emails.length === 0) && (message.bcc_emails == null || message.bcc_emails.length === 0) && audit.metadata?.attachment_verified === true && (stageNumber >= 4 ? Boolean(audit.metadata?.pdf_sha256 && Number(audit.metadata?.pdf_bytes) >= 1000 && audit.metadata?.attachment_id && audit.metadata?.attachment_content_sha256 === audit.metadata?.pdf_sha256) : ((audit.metadata?.pdf_sha256 == null && audit.metadata?.pdf_bytes == null) || Boolean(audit.metadata?.pdf_sha256 && Number(audit.metadata?.pdf_bytes) >= 1000 && audit.metadata?.attachment_id && audit.metadata?.attachment_content_sha256 === audit.metadata?.pdf_sha256)))); }; const publicDomains = new Set(["gmail.com","googlemail.com","outlook.com","outlook.de","hotmail.com","hotmail.de","live.com","live.de","yahoo.com","yahoo.de","gmx.de","gmx.net","web.de","icloud.com","me.com","mac.com","t-online.de","proton.me","protonmail.com","aol.com","mail.com","freenet.de"]); const now = $now.setZone('Europe/Berlin');
const addBusinessDays = (value, days) => { let out = value; if (!out?.isValid || !Number.isInteger(days) || days < 0) return out; let remaining = days; while (remaining > 0) { out = out.plus({ days: 1 }); if (out.weekday <= 5) remaining -= 1; } return out; };
const nextBusinessDayOrSame = (value) => { let out = value; if (!out?.isValid) return out; while (out.weekday > 5) out = out.plus({ days: 1 }); return out; };
// Explicit Umdasch payment terms: 3% Skonto within 30 days; no payment reminder during the first 45 calendar days.
const isUmdaschCustomer = (emails = [], companies = [], customerIds = []) => {
  const knownCustomerIds = new Set(['2669065012', '2669064937']);
  if (customerIds.some((value) => knownCustomerIds.has(String(value || '').trim()))) return true;
  const emailMatch = emails.some((value) => {
    const email = String(value || '').normalize('NFKC').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
    const domain = email.split('@').pop().replace(/\.$/, '');
    return domain === 'umdasch.com' || domain.endsWith('.umdasch.com');
  });
  return emailMatch || companies.some((value) => /\bumdasch\b/.test(String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()));
};
const baseLockPrefix = 'e936881a-fe32-4d94-aa1d-eaffcf4a75be:T099:PAYMENT_COLLECTION:';
const fnv = (value) => {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
};
const replyDecisionsByOrder = new Map();
for (const audit of auditResponse.rows) {
  if (audit.action !== 'customer_reply_decision' || audit.status !== 'success' || audit.metadata?.schema !== 't268.reply-decision.v1') continue;
  const orderId = String(audit.metadata?.shopify_order_id || '');
  if (!orderId) continue;
  if (!replyDecisionsByOrder.has(orderId)) replyDecisionsByOrder.set(orderId, []);
  replyDecisionsByOrder.get(orderId).push(audit);
}
for (const rows of replyDecisionsByOrder.values()) rows.sort((a, b) => Date.parse(String(a.created_at || '')) - Date.parse(String(b.created_at || '')) || Number(a.id) - Number(b.id));
const candidates = [];
if (now.weekday > 5) return [];
for (const row of allCandidateRows) {
  const continuation = row.continuation || null;
  const anchor = continuation?.anchor || null;
  const endpoint = continuation?.stage_model === 'legacy_4' ? 4 : 6;
  const umdaschCustomer = isUmdaschCustomer([row.shopify_email_hint], [row.shopify_company_hint, row.easybill_company_hint], [row.easybill_customer_id]);
  const orderNameKey = String(row.shopify_order_name || '').normalize('NFKC').trim().toUpperCase();
  const holdRow = holdOrders.get(orderNameKey) || null;
  const managedPauseUntil = DateTime.fromISO(String(holdRow?.pause_until || ''), { setZone: true }).toUTC();
  const managedPauseUpdatedAt = DateTime.fromISO(String(holdRow?.updated_at || ''), { setZone: true }).toUTC();
  const managedPauseVersion = Number(holdRow?.pause_version);
  const dueManagedPause = Boolean(
    holdRow?.paused === true &&
    holdRow?.pause_mode === 'until_date' &&
    typeof holdRow?.pause_reason === 'string' &&
    holdRow.pause_reason.trim().length >= 3 &&
    typeof holdRow?.paused_by === 'string' &&
    holdRow.paused_by.trim().length >= 3 &&
    Number.isSafeInteger(managedPauseVersion) &&
    managedPauseVersion > 0 &&
    managedPauseUntil.isValid &&
    managedPauseUntil <= nowUtc &&
    managedPauseUpdatedAt.isValid
  );
  if (holdRow?.paused === true && !dueManagedPause) continue;
  const orderCreated = DateTime.fromISO(String(row.shopify_order_created_at || ''), { setZone: true }).setZone('Europe/Berlin');
  let invoiceCreated = DateTime.fromISO(String(row.easybill_document_created_at || ''), { setZone: true }).setZone('Europe/Berlin');
  if (!invoiceCreated.isValid && continuation) invoiceCreated = DateTime.fromFormat(String(row.easybill_document_created_at || ''), 'yyyy-MM-dd HH:mm:ss', { zone: 'Europe/Berlin' });
  const invoiceDue = DateTime.fromISO(String(row.easybill_due_date || ''), { zone: 'Europe/Berlin' }).startOf('day').plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
  if (!orderCreated.isValid || !invoiceCreated.isValid) continue;
  const umdaschReminderEarliest = nextBusinessDayOrSame(invoiceCreated.plus({ days: 45 }).startOf('day').set({ hour: 9, minute: 0, second: 0, millisecond: 0 }));
  if (umdaschCustomer && (!umdaschReminderEarliest.isValid || now < umdaschReminderEarliest)) continue;
  const firstEligibleBase = orderCreated > invoiceCreated ? orderCreated : invoiceCreated;
  const legacyId = String(row.shopify_order_id || '').replace(/^gid:\/\/shopify\/Order\//, '');
  const paidCents = Number.isSafeInteger(Number(row.payment_received_cents)) ? Number(row.payment_received_cents) : 0;
  const dueCents = Number(row.amount_due_cents);
  let cycleKind = String(row.cycle_kind || 'initial') === 'partial_payment' ? 'partial_payment' : 'initial';
  let cycleId = cycleKind === 'partial_payment' ? 'P' + paidCents + '-R' + dueCents : 'INITIAL';
  let cycleBaseline = cycleKind === 'partial_payment'
    ? DateTime.fromISO(String(row.shopify_order_updated_at || ''), { setZone: true }).setZone('Europe/Berlin')
    : firstEligibleBase;
  let cycleTriggerReplyId = null;
  let cycleDecisionAuditId = null;
  const balanceDecisions = (replyDecisionsByOrder.get(legacyId) || []).filter((audit) => Number(audit.metadata?.payment_received_cents) === paidCents && Number(audit.metadata?.amount_due_cents) === dueCents);
  const latestDecision = balanceDecisions.length ? balanceDecisions.at(-1) : null;
  if (latestDecision) {
    const decision = String(latestDecision.metadata?.decision || '');
    const decisionCreated = DateTime.fromISO(String(latestDecision.created_at || ''), { setZone: true }).toUTC();
    const holdUpdated = DateTime.fromISO(String(holdRow?.updated_at || ''), { setZone: true }).toUTC();
    const manuallyContinued = ['stop_dunning','uncertain'].includes(decision) && holdRow?.paused === false && decisionCreated.isValid && holdUpdated.isValid && holdUpdated > decisionCreated;
    if (decision === 'continue_dunning' || manuallyContinued) {
      const baselineValue = manuallyContinued ? holdRow.updated_at : latestDecision.metadata.reply_received_at;
      const baseline = DateTime.fromISO(String(baselineValue || ''), { setZone: true }).setZone('Europe/Berlin');
      if (!baseline.isValid || baseline.toUTC() < t268Cutover) continue;
      cycleKind = 'reply_restart';
      cycleTriggerReplyId = String(latestDecision.metadata.reply_message_id || '');
      cycleId = 'R' + fnv(cycleTriggerReplyId);
      cycleBaseline = baseline;
      cycleDecisionAuditId = String(latestDecision.id || '');
    } else if (['stop_dunning','uncertain'].includes(decision)) {
      continue;
    }
  }
  if (continuation) { cycleId = continuation.cycle_id; cycleKind = 'historical_continuation'; if (!latestDecision) cycleBaseline = firstEligibleBase; }
  if (!cycleBaseline?.isValid) continue;
  const cyclePrefix = continuation ? continuation.cycle_prefix : cycleKind === 'initial' ? baseLockPrefix + legacyId : baseLockPrefix + legacyId + ':C-' + cycleId;
  const keyFor = (stage) => cyclePrefix + ':S' + stage;
  const anchorLock = anchor ? { message_id: anchor.message_id, internet_message_id: anchor.internet_message_id, conversation_id: anchor.conversation_id, lease_until: anchor.sent_at } : null;
  const priorLock = number => number === anchor?.stage ? anchorLock : lockByKey.get(keyFor(number));
  const priorVerified = number => number === anchor?.stage ? true : verified(priorLock(number), keyFor(number), number);
  // Do not restart an earlier stage or overlook an unknown delivery in any cycle.
  if (continuation && locksResponse.rows.some(lock => String(lock.request_id).startsWith(baseLockPrefix + legacyId + ':') && lock.request_id !== anchor?.lock_key && !verified(lock, lock.request_id, Number(String(lock.request_id).match(/:S(\d)$/)?.[1])))) continue;
  if (continuation && Number(holdRow?.mahnstufe || 0) >= endpoint && !anchor) continue;
  let stage = null;
  let scheduledAt = null;
  for (let number = (anchor?.stage || 0) + 1; number <= endpoint; number += 1) {
    const currentKey = keyFor(number);
    const current = lockByKey.get(currentKey);
    if (current) {
      if (verified(current, currentKey, number)) continue;
      break;
    }
    if (number > 1 && !priorVerified(number - 1)) break;
    const previous = number > 1 ? priorLock(number - 1) : null;
    if (number === 1) scheduledAt = cycleKind === 'partial_payment' ? addBusinessDays(firstEligibleBase, 3) : addBusinessDays(cycleBaseline, 3);
    else {
      const previousSent = DateTime.fromISO(String(previous?.lease_until || ''), { setZone: true }).setZone('Europe/Berlin');
      if (!previousSent.isValid) break;
      if (number === 2 || number === 3) scheduledAt = addBusinessDays(previousSent, 4);
      else if (number === 4) {
        scheduledAt = nextBusinessDayOrSame(orderCreated.plus({ days: 14 }));
        const relativeDue = nextBusinessDayOrSame(previousSent.plus({ days: 7 }));
        if (scheduledAt < relativeDue) scheduledAt = relativeDue;
        if (!invoiceDue.isValid) break;
        const businessInvoiceDue = nextBusinessDayOrSame(invoiceDue);
        if (scheduledAt < businessInvoiceDue) scheduledAt = businessInvoiceDue;
      } else scheduledAt = nextBusinessDayOrSame(previousSent.plus({ days: 7 }));
    }
    if (continuation && cycleDecisionAuditId) {
      const replyEarliest = addBusinessDays(cycleBaseline, 3);
      if (!scheduledAt || scheduledAt < replyEarliest) scheduledAt = replyEarliest;
    }
    if (!scheduledAt?.isValid) break;
    if (now >= scheduledAt) stage = number;
    break;
  }
  if (!stage || permanentBlockedKeys.has(keyFor(stage)) || recentTechnicalBlockedKeys.has(keyFor(stage))) continue;
  const snapshotEmail = String(row.shopify_email_hint || '').trim().toLowerCase();
  const snapshotDomain = snapshotEmail.includes('@') ? snapshotEmail.split('@').pop().replace(/\.$/, '') : '';
  const domainHistory = stage >= 3 && Boolean(String(row.shopify_company_hint || '').trim() || String(row.easybill_company_hint || '').trim()) && Boolean(snapshotDomain) && !publicDomains.has(snapshotDomain);
  const replyThreads = [];
  for (let previousStage = anchor?.stage || 1; previousStage < stage; previousStage += 1) {
    const previousKey = keyFor(previousStage);
    const previousLock = priorLock(previousStage);
    replyThreads.push({ stage: previousStage, lock_key: previousKey, message_id: String(previousLock?.message_id || ''), internet_message_id: String(previousLock?.internet_message_id || ''), conversation_id: String(previousLock?.conversation_id || ''), sent_at: previousLock?.lease_until || null });
  }
  candidates.push({
    stage,
    continuation,
    stage_model: continuation?.stage_model || 'current_6',
    easybill_document_type: row.easybill_document_type || 'INVOICE',
    cycle_kind: cycleKind,
    cycle_id: cycleId,
    cycle_source_kind: String(row.cycle_kind || 'initial'),
    cycle_baseline_at: cycleBaseline.toUTC().toISO(),
    cycle_trigger_reply_id: cycleTriggerReplyId,
    cycle_decision_audit_id: cycleDecisionAuditId,
    pause_resume_required: dueManagedPause,
    pause_resume_expected_version: dueManagedPause ? managedPauseVersion : null,
    pause_resume_expected_updated_at: dueManagedPause ? String(holdRow.updated_at) : null,
    pause_resume_until: dueManagedPause ? managedPauseUntil.toISO() : null,
    reply_threads: replyThreads,
    scheduled_at: scheduledAt.toUTC().toISO(),
    previous_stage_sent_at: stage > 1 ? priorLock(stage - 1)?.lease_until || null : null,
    lock_key: keyFor(stage),
    shopify_order_id: legacyId,
    shopify_order_gid: String(row.shopify_order_gid || 'gid://shopify/Order/' + legacyId),
    shopify_order_name: String(row.shopify_order_name || ''),
    shopify_order_created_at: row.shopify_order_created_at,
    shopify_order_updated_at: row.shopify_order_updated_at || null,
    mirror_email: snapshotEmail,
    intake_company: String(row.shopify_company_hint || '').trim() || null,
    intake_easybill_company: String(row.easybill_company_hint || '').trim() || null,
    company_history_query_mode: domainHistory ? 'domain' : 'exact_email',
    company_history_query_value: domainHistory ? snapshotDomain : snapshotEmail,
    easybill_document_id: String(row.easybill_document_id),
    easybill_invoice_number: String(row.easybill_invoice_number || ''),
    easybill_customer_id: String(row.easybill_customer_id || ''),
    easybill_due_date: String(row.easybill_due_date || ''),
    easybill_due_basis: row.easybill_due_basis || 'document_due_date',
    invoice_amount_cents: Number.isSafeInteger(Number(row.invoice_amount_cents)) ? Number(row.invoice_amount_cents) : Number(row.amount_due_cents),
    payment_received_cents: paidCents,
    easybill_paid_cents: Number.isSafeInteger(Number(row.easybill_paid_cents)) ? Number(row.easybill_paid_cents) : 0,
    amount_due_cents: dueCents,
    currency: String(row.currency || '').toUpperCase(),
    intake_evidence: ['manual_legacy_enrollment_v1','historical_control_v1'].includes(row.intake_evidence?.source)
      ? { ...row.intake_evidence }
      : { audit_id: intake.id, run_id: metadata.run_id, observed_at: metadata.observed_at, candidate_key: row.candidate_key }
  });
}
candidates.sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)) || a.stage - b.stage || a.shopify_order_id.localeCompare(b.shopify_order_id));
return candidates.length ? [{ json: candidates[0] }] : [];