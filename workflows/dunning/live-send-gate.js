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
const candidate = $('Select Earliest Due Future Stage').first().json || {};
const replyDecisionState = $('Validate T268 Reply Decision').first().json || {};
const dunningEnvelope = $('Read Current Dunning Hold').first().json || {};
const dunningRows = Array.isArray(dunningEnvelope.body) ? dunningEnvelope.body : [];
const dunningComplete = Number(dunningEnvelope.statusCode || 0) >= 200 && Number(dunningEnvelope.statusCode || 0) < 300 && dunningRows.length <= 1;
const shopEnvelope = $('Shopify Complete Live Gate').first().json || {};
const invoiceEnvelope = $('Easybill Live Invoice').first().json || {};
const versionsEnvelope = $('Easybill Immutable Versions').first().json || {};
const relatedEnvelope = $('Easybill Customer Documents').first().json || {};
const paymentsEnvelope = $('Easybill Document Payments').first().json || {};
const qontoGate = $('Normalize Qonto Live Gate').first().json || {};
const body = (envelope) => envelope.body ?? envelope;
const ok = (envelope) => Number(envelope.statusCode || 0) >= 200 && Number(envelope.statusCode || 0) < 300;
const dunningKeys = dunningRows.map((row) => String(row.shopify_order_number || '').normalize('NFKC').trim().toUpperCase()); const dunningScopeValid = dunningKeys.every(Boolean) && new Set(dunningKeys).size === dunningKeys.length; const normalizedOrderName = String(candidate.shopify_order_name || '').normalize('NFKC').trim().toUpperCase(); const matchingDunningRows = dunningRows.filter((row) => String(row.shopify_order_number || '').normalize('NFKC').trim().toUpperCase() === normalizedOrderName);
const shop = body(shopEnvelope); const easybill = body(invoiceEnvelope);
const versionsPayload = body(versionsEnvelope); const relatedPayload = body(relatedEnvelope); const paymentsPayload = body(paymentsEnvelope);
const order = shop.data?.order || null; const customers = shop.data?.customers || null; const disputes = shop.data?.disputes || null;
const versions = Array.isArray(versionsPayload) ? versionsPayload : (Array.isArray(versionsPayload?.items) ? versionsPayload.items : []);
const related = Array.isArray(relatedPayload) ? relatedPayload : (Array.isArray(relatedPayload?.items) ? relatedPayload.items : []);
const payments = Array.isArray(paymentsPayload) ? paymentsPayload : (Array.isArray(paymentsPayload?.items) ? paymentsPayload.items : []);
const qontoTransactions = Array.isArray(qontoGate.transactions) ? qontoGate.transactions : [];
const completeCollection = (envelope, payload, rows) => Boolean(ok(envelope) && Array.isArray(rows) && (Array.isArray(payload) ? rows.length < 100 : Number.isSafeInteger(Number(payload?.page)) && Number.isSafeInteger(Number(payload?.pages)) && Number.isSafeInteger(Number(payload?.total)) && Number.isSafeInteger(Number(payload?.limit)) && Number(payload.page) === 1 && Number(payload.pages) <= 1 && Number(payload.total) === rows.length && Number(payload.limit) === 100 && rows.length <= 100));
const strictAmountText = (value) => String(value ?? '').trim(); const decimalBig = (value) => BigInt(strictAmountText(value).split('.')[0]) * 100n + BigInt((strictAmountText(value).split('.')[1] || '').padEnd(2, '0')); const decimalCents = (value) => /^\d+(?:\.\d{1,2})?$/.test(strictAmountText(value)) && decimalBig(value) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(decimalBig(value)) : null; const moneyCents = (bag) => decimalCents(bag?.shopMoney?.amount ?? bag?.presentmentMoney?.amount ?? bag?.amount); const integerBig = (value) => BigInt(strictAmountText(value)); const integerCents = (value) => typeof value === 'number' ? (Number.isSafeInteger(value) && value >= 0 ? value : null) : (/^\d+$/.test(strictAmountText(value)) && integerBig(value) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(integerBig(value)) : null);
const token = (value) => String(value ?? '').normalize('NFKC').trim().replace(/^#+/, '').replace(/\s+/g, '').toUpperCase(); const shopKey = (value) => /^NEONT\d+$/.test(token(value)) ? token(value) : null; const easyKey = (value) => /^NEONT\d+$/.test(token(value)) ? token(value) : (/^\d+$/.test(token(value)) ? 'NEONT' + token(value) : null);
const tagTokens = (value) => (Array.isArray(value) ? value : String(value || '').split(',')).map((entry) => String(entry || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE')).filter(Boolean);
const domainOf = (value) => String(value || '').trim().toLowerCase().includes('@') ? String(value || '').trim().toLowerCase().split('@').pop().replace(/\.$/, '') : null;
const publicDomains = new Set(["gmail.com","googlemail.com","outlook.com","outlook.de","hotmail.com","hotmail.de","live.com","live.de","yahoo.com","yahoo.de","gmx.de","gmx.net","web.de","icloud.com","me.com","mac.com","t-online.de","proton.me","protonmail.com","aol.com","mail.com","freenet.de"]);
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
// Stop this invoice after a human reply to any verified prior reminder.
const checkCustomerReminderReplies = (candidate, pageItems) => {
  const stage = Number(candidate.stage);
  const threads = Array.isArray(candidate.reply_threads) ? candidate.reply_threads : [];
  const result = { applicable: stage > 1, complete: true, checked_conversation_ids: [], ignored_automatic_count: 0, replies: [] };
  const validText = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 4096 && !/[\r\n]/.test(value);
  const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
  if (!Number.isInteger(stage) || stage < 1 || stage > 6 || !Array.isArray(candidate.reply_threads) || threads.length !== stage - 1) result.complete = false;
  const expectedKey = String(candidate.lock_key || '');
  if (!/:S[1-6]$/.test(expectedKey)) result.complete = false;
  const threadByConversation = new Map();
  for (let index = 0; index < threads.length; index += 1) {
    const thread = threads[index] || {};
    if (thread.stage !== index + 1 || thread.lock_key !== expectedKey.replace(/:S[1-6]$/, ':S' + (index + 1)) || !validText(thread.conversation_id) || !validText(thread.message_id) || !validText(thread.internet_message_id) || !validTime(thread.sent_at)) {
      result.complete = false;
      continue;
    }
    const prior = threadByConversation.get(thread.conversation_id);
    if (!prior || Date.parse(thread.sent_at) < Date.parse(prior.sent_at)) threadByConversation.set(thread.conversation_id, thread);
  }
  result.checked_conversation_ids = [...threadByConversation.keys()];
  if (stage === 1) return result;
  if (!result.complete || !Array.isArray(pageItems) || pageItems.length < 1 || pageItems.length > 10) return { ...result, complete: false };
  const seen = new Set();
  const email = (value) => String(value || '').trim().toLowerCase();
  const internal = (value) => /^[^@\s]+@(?:[^@\s]+\.)?neontrip\.de$/.test(value);
  for (let pageIndex = 0; pageIndex < pageItems.length; pageIndex += 1) {
    const envelope = pageItems[pageIndex] || {};
    const payload = envelope.body;
    const next = payload?.['@odata.nextLink'];
    if (Number(envelope.statusCode) !== 200 || !Array.isArray(payload?.value) || payload.value.length > 100 || Boolean(next) !== (pageIndex < pageItems.length - 1) || (next && !/^https:\/\/graph\.microsoft\.com\/v1\.0\//.test(String(next)))) {
      result.complete = false;
      continue;
    }
    for (const message of payload.value) {
      if (!validText(message?.id) || seen.has(message.id) || !threadByConversation.has(message.conversationId) || typeof message.isDraft !== 'boolean') {
        result.complete = false;
        continue;
      }
      seen.add(message.id);
      if (message.isDraft) continue;
      const thread = threadByConversation.get(message.conversationId);
      const from = email(message.from?.emailAddress?.address);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from) || !validTime(message.receivedDateTime)) { result.complete = false; continue; }
      if (internal(from) || Date.parse(message.receivedDateTime) <= Date.parse(thread.sent_at)) continue;
      if (!validText(message.internetMessageId) || !Array.isArray(message.internetMessageHeaders) || !message.internetMessageHeaders.every((header) => typeof header?.name === 'string' && typeof header?.value === 'string')) {
        result.complete = false;
        continue;
      }
      const headers = message.internetMessageHeaders.map((header) => ({ name: header.name.toLowerCase(), value: header.value.trim().toLowerCase() }));
      const automaticHeader = headers.some((header) =>
        (header.name === 'auto-submitted' && header.value.split(';')[0].trim() !== 'no') ||
        (['x-autoreply','x-autorespond'].includes(header.name) && header.value !== 'no' && header.value !== 'false')
      );
      const normalizedSubject = String(message.subject || '').normalize('NFKC').trim().toLowerCase().replace(/^(?:(?:re|aw|fw|fwd|wg)\s*:\s*)+/, '');
      const automaticSubject = /^(?:automatische(?:r)?\s+(?:antwort|rückantwort|benachrichtigung)|automatic\s+reply|auto(?:matic)?[- ]?(?:reply|response)|out\s+of\s+(?:the\s+)?office|abwesenheits(?:notiz|nachricht|assistent)|abwesenheit|unzustellbar|undeliverable|delivery\s+(?:status\s+notification|failure)|mail\s+delivery\s+(?:subsystem|failed)|read\s*:|gelesen\s*:)/i.test(normalizedSubject);
      if (automaticHeader || automaticSubject) { result.ignored_automatic_count += 1; continue; }
      result.replies.push({ message_id: message.id, internet_message_id: message.internetMessageId, conversation_id: message.conversationId, received_at: message.receivedDateTime, from_email: from, reminder_stage: thread.stage, reminder_lock_key: thread.lock_key });
    }
  }
  result.replies.sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at));
  return { ...result, replies: result.replies.slice(0, 20) };
};

const historicalContinuation = candidate.continuation?.schema === 'dunning.historical.candidate.v1' && candidate.intake_evidence?.source === 'historical_control_v1';
const stage = Number(candidate.stage); const reasons = []; const warnings = [];
const customerReplyEvidence = replyDecisionState.reply_evidence || { complete: false, replies: [] };
if (customerReplyEvidence.complete !== true) reasons.push('CUSTOMER_REPLY_SCAN_INCOMPLETE');
if (replyDecisionState.legacy_reply_present === true) reasons.push('CUSTOMER_REPLY_BEFORE_T268_CUTOVER');
if (replyDecisionState.is_new_decision === true && replyDecisionState.decision === 'continue_dunning') reasons.push('CUSTOMER_REPLY_CONTINUE_RESTART_PENDING');
if (replyDecisionState.is_new_decision === true && replyDecisionState.decision === 'stop_dunning') reasons.push('CUSTOMER_REPLY_AI_STOP');
if (replyDecisionState.is_new_decision === true && replyDecisionState.decision === 'uncertain') reasons.push('CUSTOMER_REPLY_AI_REVIEW_REQUIRED');
const total = moneyCents(order?.totalPriceSet); const current = moneyCents(order?.currentTotalPriceSet); const outstanding = moneyCents(order?.totalOutstandingSet); const received = moneyCents(order?.totalReceivedSet); const refunded = moneyCents(order?.totalRefundedSet);
const invoiceAmount = integerCents(easybill?.amount); const invoicePaid = integerCents(easybill?.paid_amount);
const shopCurrency = String(order?.totalPriceSet?.shopMoney?.currencyCode || '').toUpperCase(); const easyCurrency = String(easybill?.currency || '').toUpperCase();
const transactions = Array.isArray(order?.transactions) ? order.transactions : (Array.isArray(order?.transactions?.nodes) ? order.transactions.nodes : []);
const tags = tagTokens(order?.tags); const legacyId = String(order?.legacyResourceId || '').replace(/^gid:\/\/shopify\/Order\//, '');
const approvedLegacyRecipient = candidate.intake_evidence?.source === 'manual_legacy_enrollment_v1' && candidate.intake_evidence?.approved_ticket === 'TICKET-248' && candidate.intake_evidence?.approved_by === 'Rahim' ? String(candidate.mirror_email || '').trim().toLowerCase() : ''; const approvedHistoricalRecipient = historicalContinuation && candidate.continuation?.anchor?.evidence === 'reviewed_reminder' && candidate.continuation.anchor.audit_id ? String(candidate.continuation.anchor.recipient || '').toLowerCase() : ''; const liveCustomerEmail = approvedHistoricalRecipient || approvedLegacyRecipient || String(order?.email || '').trim().toLowerCase(); const domain = domainOf(liveCustomerEmail); const company = String(order?.billingAddress?.company || '').trim(); const easyCompany = String(easybill?.address?.company || '').trim();
const corporateApplicable = stage >= 3 && Boolean(company || easyCompany) && Boolean(domain) && !publicDomains.has(domain); const expectedQueryMode = corporateApplicable ? 'domain' : 'exact_email'; const expectedQueryValue = corporateApplicable ? domain : liveCustomerEmail;
const customerPagesComplete = Boolean(customers) && customers.pageInfo?.hasNextPage === false && (customers.nodes || []).length < 100 && (customers.nodes || []).every((customer) => customer.orders?.pageInfo?.hasNextPage === false && (customer.orders?.nodes || []).length < 100);
const priorOrders = (customers?.nodes || []).flatMap((customer) => (customer.orders?.nodes || []).map((prior) => ({ ...prior, customerEmail: customer.email })));
const currentOrderCreatedAt = DateTime.fromISO(String(order?.createdAt || candidate.shopify_order_created_at || ''), { setZone: true }); const malformedPaidHistory = priorOrders.some((prior) => String(prior.displayFinancialStatus || '').toUpperCase() === 'PAID' && (moneyCents(prior.totalReceivedSet) == null || moneyCents(prior.totalRefundedSet) == null)); const priorCreatedAt = (prior) => DateTime.fromISO(String(prior?.createdAt || ''), { setZone: true }); const priorPaid = priorOrders.find((prior) => String(prior.legacyResourceId || '').replace(/^gid:\/\/shopify\/Order\//, '') !== String(candidate.shopify_order_id) && priorCreatedAt(prior).isValid && currentOrderCreatedAt.isValid && priorCreatedAt(prior) < currentOrderCreatedAt && domainOf(prior.email || prior.customerEmail) === domain && String(prior.displayFinancialStatus || '').toUpperCase() === 'PAID' && moneyCents(prior.totalReceivedSet) > 0 && moneyCents(prior.totalRefundedSet) === 0 && !prior.cancelledAt) || null;
const disputeComplete = Boolean(disputes) && disputes.pageInfo?.hasNextPage === false && (disputes.nodes || []).length < 100;
const matchingDisputes = (disputes?.nodes || []).filter((entry) => String(entry.order?.legacyResourceId || '') === String(candidate.shopify_order_id) || String(entry.order?.id || '') === String(candidate.shopify_order_gid));
const sortedVersions = [...versions].filter((row) => row?.id != null).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || Number(b.id) - Number(a.id));
const selectedVersion = sortedVersions[0] || null; const defaultItems = (selectedVersion?.items || []).filter((item) => String(item.document_version_item_type || '').toLowerCase() === 'default' && item?.id != null); const selectedItem = defaultItems.length === 1 ? defaultItems[0] : null;
const versionsComplete = completeCollection(versionsEnvelope, versionsPayload, versions) && Boolean(selectedVersion && selectedItem);
const relatedComplete = completeCollection(relatedEnvelope, relatedPayload, related); const paymentsComplete = completeCollection(paymentsEnvelope, paymentsPayload, payments);
const link = (document) => String(document.id) === String(easybill?.id) || String(document.ref_id || '') === String(easybill?.id) || String(document.root_id || '') === String(easybill?.id) || (easyKey(document.order_number) && easyKey(document.order_number) === easyKey(easybill?.order_number));
const linked = related.filter(link); const paymentValues = payments.map((row) => integerCents(row.amount)); const creditValues = linked.filter((row) => String(row.type || '').toUpperCase() === 'CREDIT' && row.is_draft === false).map((row) => integerCents(row.amount)); const paymentAmount = paymentValues.every((value) => value != null) ? paymentValues.reduce((sum, value) => sum + value, 0) : null; const creditAmount = creditValues.every((value) => value != null) ? creditValues.reduce((sum, value) => sum + value, 0) : null; const successfulPaymentTransactions = transactions.filter((row) => ['SALE','CAPTURE'].includes(String(row.kind || '').toUpperCase()) && String(row.status || '').toUpperCase() === 'SUCCESS'); const successfulPaymentValues = successfulPaymentTransactions.map((row) => moneyCents(row.amountSet)); const successfulPaymentAmount = successfulPaymentValues.every((value) => value != null) ? successfulPaymentValues.reduce((sum, value) => sum + value, 0) : null; const successfulPaymentTimes = successfulPaymentTransactions.map((row) => DateTime.fromISO(String(row.createdAt || ''), { setZone: true }).toUTC()); const latestSuccessfulPaymentAt = successfulPaymentTimes.length && successfulPaymentTimes.every((value) => value.isValid) ? successfulPaymentTimes.reduce((latest, value) => value > latest ? value : latest) : null;
const normalizeParty = (value) => String(value || '').normalize('NFKC').toLocaleLowerCase('de-DE').replace(/[^a-z0-9äöüß]+/g, ' ').trim().split(/\s+/).filter((part) => part && !new Set(['gmbh','mbh','ug','haftungsbeschränkt','ag','kg','ohg','gbr','se','e','v']).has(part)).join(' ');
const partyCandidates = [...new Set([
  company,
  easyCompany,
  easybill?.address?.company_name,
  [order?.billingAddress?.firstName, order?.billingAddress?.lastName].filter(Boolean).join(' ')
].map(normalizeParty).filter((value) => value.length >= 5))];
const referenceKeys = [...new Set([shopKey(order?.name), shopKey(candidate.shopify_order_name), easyKey(easybill?.number), easyKey(candidate.easybill_invoice_number)].filter(Boolean))];
const qontoCredits = qontoTransactions.map((row) => ({ ...row, cents: decimalCents(row.amount), ref_compact: String(row.reference || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]+/g, ''), payer: normalizeParty(row.counterparty_name) })).filter((row) => row.side === 'credit' && !['failed','declined','reversed','cancelled','canceled'].includes(String(row.status || '').toLowerCase()) && row.currency === (easyCurrency || shopCurrency) && row.cents != null && row.cents > 0);
const exactReferenceCredits = qontoCredits.filter((row) => referenceKeys.some((key) => row.ref_compact.includes(key)));
const exactReferenceCreditCents = exactReferenceCredits.reduce((sum, row) => sum + row.cents, 0);
const qontoUnreflectedCredits = exactReferenceCreditCents > Number(received || 0) ? exactReferenceCredits : [];
const payerMatches = (payer) => payer.length >= 5 && partyCandidates.some((candidateName) => payer === candidateName || (payer.length >= 8 && candidateName.length >= 8 && (payer.includes(candidateName) || candidateName.includes(payer))));
const qontoAmbiguousCredits = exactReferenceCredits.length ? [] : qontoCredits.filter((row) => payerMatches(row.payer) && [invoiceAmount, outstanding].includes(row.cents));

if (qontoGate.complete !== true) reasons.push('QONTO_LIVE_GATE_INCOMPLETE');
if (qontoUnreflectedCredits.length) reasons.push('QONTO_UNREFLECTED_PAYMENT_PRESENT');
if (qontoAmbiguousCredits.length) reasons.push('QONTO_AMBIGUOUS_POSSIBLE_PAYMENT');
if (!dunningComplete || !dunningScopeValid || matchingDunningRows.length > 1) reasons.push('MANUAL_HOLD_EVIDENCE_INCOMPLETE');
if (matchingDunningRows[0]?.paused === true) reasons.push('MANUAL_DUNNING_HOLD');
const umdaschCustomer = isUmdaschCustomer([order?.email, candidate.mirror_email], [company, easyCompany, easybill?.address?.company_name, candidate.intake_company, candidate.intake_easybill_company], [easybill?.customer_id, candidate.easybill_customer_id]);
const shopApiVersion = Object.entries(shopEnvelope.headers || {}).find(([key]) => key.toLowerCase() === 'x-shopify-api-version')?.[1]; if (!ok(shopEnvelope) || String(shopApiVersion || '') !== '2026-07' || (shop.errors || []).length || !order || legacyId !== String(candidate.shopify_order_id)) reasons.push('SHOPIFY_LIVE_GATE_INCOMPLETE');
if (order?.cancelledAt) reasons.push('SHOPIFY_CANCELLED');
const liveShopStatus = String(order?.displayFinancialStatus || '').toUpperCase(); if (!['PENDING','PARTIALLY_PAID'].includes(liveShopStatus)) reasons.push('SHOPIFY_NOT_OPEN_FOR_COLLECTION');
if (tags.some(t => /mahnstop|mahn.stop|keine.?mahnung|keine.?zahlungserinnerung|nicht.?mahnen|inkasso|insolven|warten.?auf.?zahlung|mit.*anwalt|e2e|testbestellung/i.test(t))) reasons.push('SHOPIFY_EXACT_STOP_TAG');
if (total == null || total <= 0 || current == null || outstanding == null || received == null || current !== total || outstanding <= 0 || received < 0 || received >= total || received + outstanding !== total) reasons.push('SHOPIFY_OPEN_BALANCE_INVALID'); if ((received === 0 && liveShopStatus !== 'PENDING') || (received > 0 && liveShopStatus !== 'PARTIALLY_PAID')) reasons.push('SHOPIFY_OPEN_STATUS_BALANCE_MISMATCH');
if (refunded == null || refunded !== 0 || transactions.some((row) => ['REFUND', 'VOID'].includes(String(row.kind || '').toUpperCase()) && String(row.status || '').toUpperCase() === 'SUCCESS')) reasons.push('SHOPIFY_REFUND_OR_VOID_PRESENT');
if (transactions.length >= 100 || transactions.some((row) => moneyCents(row.amountSet) == null) || !disputeComplete) reasons.push('SHOPIFY_TRANSACTION_OR_DISPUTE_SCAN_INCOMPLETE');
if (matchingDisputes.length) reasons.push('SHOPIFY_CHARGEBACK_OR_DISPUTE_PRESENT');
if (!ok(invoiceEnvelope) || String(easybill?.id || '') !== String(candidate.easybill_document_id) || !((historicalContinuation ? ['INVOICE','PROFORMA_INVOICE'] : ['INVOICE']).includes(String(easybill?.type || '').toUpperCase())) || (historicalContinuation && easybill?.type !== candidate.easybill_document_type) || easybill?.is_draft !== false) reasons.push('EASYBILL_LIVE_GATE_INCOMPLETE');
if (easybill?.cancel_id != null) reasons.push('EASYBILL_STORNO');
if (easybill?.paid_at != null) reasons.push('EASYBILL_MARKED_PAID'); if (invoicePaid == null || paymentAmount == null || received == null || invoicePaid !== paymentAmount || invoicePaid !== received) reasons.push('EASYBILL_PAYMENT_RECONCILIATION_MISMATCH'); if (Number(candidate.payment_received_cents || 0) !== received || Number(candidate.easybill_paid_cents || 0) !== invoicePaid || Number(candidate.amount_due_cents) !== outstanding) reasons.push('INTAKE_BALANCE_CHANGED'); if (successfulPaymentAmount == null || successfulPaymentAmount !== received || (received > 0 && !latestSuccessfulPaymentAt)) reasons.push('SHOPIFY_PAYMENT_TRANSACTION_RECONCILIATION_MISMATCH');
if (!versionsComplete || !relatedComplete || !paymentsComplete) reasons.push('EASYBILL_LINKAGE_OR_PDF_SCAN_INCOMPLETE');
if (linked.some((row) => ['STORNO', 'STORNO_CREDIT'].includes(String(row.type || '').toUpperCase()))) reasons.push('EASYBILL_STORNO_RELATED');
if (creditAmount == null) reasons.push('EASYBILL_LINKAGE_OR_PDF_SCAN_INCOMPLETE'); else if (invoiceAmount > 0 && creditAmount >= invoiceAmount) reasons.push('EASYBILL_FULL_CREDIT');
else if (creditAmount > 0) reasons.push('EASYBILL_PARTIAL_CREDIT_REVIEW');
if (linked.some((row) => String(row.type || '').toUpperCase() === 'INVOICE' && String(row.id) !== String(easybill?.id) && row.is_draft === false && easyKey(row.order_number) && easyKey(row.order_number) === easyKey(easybill?.order_number))) reasons.push('EASYBILL_REPLACEMENT_INVOICE');
if (String(easybill?.number || '').trim() !== String(candidate.easybill_invoice_number || '').trim() || !shopKey(order?.name) || easyKey(easybill?.order_number) !== shopKey(order?.name)) reasons.push('EASYBILL_IMMUTABLE_LINK_MISMATCH');
if (!Number.isInteger(invoiceAmount) || invoiceAmount <= 0 || invoiceAmount !== total || invoicePaid == null || outstanding == null || invoiceAmount - invoicePaid !== outstanding || invoiceAmount !== Number(candidate.invoice_amount_cents || invoiceAmount) || outstanding !== Number(candidate.amount_due_cents)) reasons.push('AMOUNT_CENTS_MISMATCH');
if (!shopCurrency || !easyCurrency || shopCurrency !== easyCurrency || easyCurrency !== String(candidate.currency || '').toUpperCase()) reasons.push('CURRENCY_MISMATCH');
if (liveCustomerEmail !== String(candidate.mirror_email || '').trim().toLowerCase()) reasons.push('SHOPIFY_EMAIL_CHANGED_SINCE_INTAKE');
if (String(candidate.company_history_query_mode || '') !== expectedQueryMode || String(candidate.company_history_query_value || '').toLowerCase() !== String(expectedQueryValue || '').toLowerCase()) reasons.push('COMPANY_HISTORY_QUERY_SCOPE_MISMATCH');
if (corporateApplicable && (!customerPagesComplete || malformedPaidHistory)) reasons.push('COMPANY_HISTORY_SCAN_INCOMPLETE');
if (corporateApplicable && priorPaid) reasons.push('EXISTING_COMPANY_DOMAIN_PRIOR_PAID');
const recipient = liveCustomerEmail; if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) reasons.push('CUSTOMER_EMAIL_INVALID');
if (company && easyCompany && company.toLocaleLowerCase('de-DE') !== easyCompany.toLocaleLowerCase('de-DE')) warnings.push('ADDRESS_OR_COMPANY_DIFFERENT_NONBLOCKING');
const localNow = $now.setZone('Europe/Berlin');
const addBusinessDays = (value, days) => { let out = value; if (!out?.isValid || !Number.isInteger(days) || days < 0) return out; let remaining = days; while (remaining > 0) { out = out.plus({ days: 1 }); if (out.weekday <= 5) remaining -= 1; } return out; };
const nextBusinessDayOrSame = (value) => { let out = value; if (!out?.isValid) return out; while (out.weekday > 5) out = out.plus({ days: 1 }); return out; };
const immediateProforma = historicalContinuation && easybill?.type === 'PROFORMA_INVOICE' && easybill?.due_date == null && easybill?.due_in_days === 0 && /^Zahlbar sofort[.!]/i.test(String(easybill?.text || '').replace(/<[^>]*>/g,' ').trim()) && /^\d{4}-\d{2}-\d{2}$/.test(easybill?.document_date || '');
const liveDueDate = immediateProforma ? easybill.document_date : easybill?.due_date;
if (historicalContinuation && String(liveDueDate || '') !== String(candidate.easybill_due_date || '')) reasons.push('LIVE_PAYMENT_TERMS_CHANGED_OR_MISSING');
const due = DateTime.fromISO(String(liveDueDate || (!historicalContinuation ? candidate.easybill_due_date : '') || ''), { zone: 'Europe/Berlin' }).startOf('day'); const dunningEarliest = nextBusinessDayOrSame(due.plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 })); const liveOrderCreated = DateTime.fromISO(String(order?.createdAt || candidate.shopify_order_created_at || ''), { setZone: true }).setZone('Europe/Berlin'); let liveEasyCreated = DateTime.fromISO(String(easybill?.created_at || ''), { zone: 'Europe/Berlin' }); if (!liveEasyCreated.isValid) liveEasyCreated = DateTime.fromFormat(String(easybill?.created_at || ''), 'yyyy-MM-dd HH:mm:ss', { zone: 'Europe/Berlin' }); const umdaschReminderEarliest = liveEasyCreated.isValid ? nextBusinessDayOrSame(liveEasyCreated.plus({ days: 45 }).startOf('day').set({ hour: 9, minute: 0, second: 0, millisecond: 0 })) : null; if (umdaschCustomer && (!umdaschReminderEarliest?.isValid || localNow < umdaschReminderEarliest)) reasons.push('UMDASCH_45_DAY_GRACE_ACTIVE'); const liveCutover = DateTime.fromISO('2026-08-05T17:30:00+02:00', { setZone: true }); const t268Cutover = DateTime.fromISO('2026-09-09T11:01:25Z', { setZone: true }).toUTC(); const manualLegacyEnrollment = candidate.intake_evidence?.source === 'manual_legacy_enrollment_v1' && candidate.intake_evidence?.approved_ticket === 'TICKET-248' && candidate.intake_evidence?.approved_by === 'Rahim' && String(candidate.intake_evidence?.enrollment_audit_id || '').length > 0; if (!liveOrderCreated.isValid || !liveEasyCreated.isValid || (!manualLegacyEnrollment && !historicalContinuation && (liveOrderCreated < liveCutover || liveEasyCreated < liveCutover))) reasons.push('LIVE_FUTURE_BOUNDARY_INVALID'); const liveFirstEligibleBase = liveOrderCreated > liveEasyCreated ? liveOrderCreated : liveEasyCreated; const previousSent = DateTime.fromISO(String(candidate.previous_stage_sent_at || ''), { setZone: true }).setZone('Europe/Berlin'); const cycleKind = String(candidate.cycle_kind || 'initial'); const cycleBaseline = DateTime.fromISO(String(candidate.cycle_baseline_at || ''), { setZone: true }).setZone('Europe/Berlin'); let liveStageDue = null; if (stage === 1 && (cycleKind === 'partial_payment' || (historicalContinuation && candidate.cycle_source_kind === 'partial_payment'))) { if (!latestSuccessfulPaymentAt || latestSuccessfulPaymentAt < t268Cutover) reasons.push('T268_PARTIAL_BEFORE_CUTOVER'); else liveStageDue = addBusinessDays(latestSuccessfulPaymentAt.setZone('Europe/Berlin'), 3); } else if (stage === 1 && cycleKind === 'reply_restart') { if (!cycleBaseline.isValid || cycleBaseline.toUTC() < t268Cutover) reasons.push('T268_REPLY_CYCLE_BASELINE_INVALID'); else liveStageDue = addBusinessDays(cycleBaseline, 3); } else if (stage === 1) liveStageDue = addBusinessDays(liveFirstEligibleBase, 3); else if (stage >= 2 && !previousSent.isValid) reasons.push('PREVIOUS_STAGE_TIME_EVIDENCE_MISSING'); else if (stage === 2 || stage === 3) liveStageDue = addBusinessDays(previousSent, 4); else if (stage === 4) { liveStageDue = nextBusinessDayOrSame(liveOrderCreated.plus({ days: 14 })); const relativeDue = nextBusinessDayOrSame(previousSent.plus({ days: 7 })); if (liveStageDue < relativeDue) liveStageDue = relativeDue; if (dunningEarliest.isValid && liveStageDue < dunningEarliest) liveStageDue = dunningEarliest; } else if (stage === 5 || stage === 6) liveStageDue = nextBusinessDayOrSame(previousSent.plus({ days: 7 })); if (historicalContinuation && candidate.cycle_decision_audit_id) { if (!cycleBaseline.isValid || cycleBaseline.toUTC() < t268Cutover) reasons.push('T268_REPLY_CYCLE_BASELINE_INVALID'); else { const replyEarliest = addBusinessDays(cycleBaseline, 3); if (!liveStageDue || liveStageDue < replyEarliest) liveStageDue = replyEarliest; } } if (stage >= 3 && !due.isValid) reasons.push('EASYBILL_DUE_DATE_MISSING_FOR_CUSTOMER_DEADLINE'); if (localNow.weekday > 5) reasons.push('WEEKEND_SEND_BLOCK'); if (!liveStageDue?.isValid || localNow < liveStageDue) reasons.push('LIVE_STAGE_NOT_DUE');
if (historicalContinuation && candidate.continuation.original_shopify_email && String(order?.email || '').trim().toLowerCase() !== candidate.continuation.original_shopify_email) reasons.push('SHOPIFY_EMAIL_CHANGED_SINCE_INTAKE');
if (historicalContinuation) {
  const c = candidate.continuation;
  if (c.cycle_prefix + ':S' + stage !== candidate.lock_key || !['current_6','legacy_4'].includes(c.stage_model) || stage > (c.stage_model === 'legacy_4' ? 4 : 6) || liveOrderCreated > localNow.minus({days:35})) reasons.push('HISTORICAL_CONTINUATION_SCOPE_INVALID');
  if (c.anchor) {
    const pages = $('Graph Read Prior Reminder Threads').all().flatMap(i => i.json?.body?.value || []);
    const m = pages.find(m => m.internetMessageId === c.anchor.internet_message_id);
    const from = String(m?.from?.emailAddress?.address || '').toLowerCase();
    const to = (m?.toRecipients || []).map(r => String(r.emailAddress?.address || '').toLowerCase());
    if (!m || m.isDraft !== false || !/@neontrip\.de$/.test(from) || m.conversationId !== c.anchor.conversation_id || Date.parse(m.sentDateTime) !== Date.parse(c.anchor.sent_at) || to.length !== 1 || to[0] !== recipient || (m.ccRecipients || []).length || (m.bccRecipients || []).length) reasons.push('HISTORICAL_ANCHOR_NOT_LIVE_VERIFIED');
  }
}
const dueDateText = due.isValid ? due.toFormat('dd.MM.yyyy') : 'zum Rechnungsfälligkeitstermin'; const dunningDeadline = localNow.plus({ days: 7 }).toFormat('dd.MM.yyyy');
let businessDay = localNow.plus({ days: 1 }).startOf('day').set({ hour: 9 }); if (localNow.weekday === 5) businessDay = localNow.plus({ days: 3 }).startOf('day').set({ hour: 9 }); else if (localNow.weekday === 6) businessDay = localNow.plus({ days: 2 }).startOf('day').set({ hour: 9 }); else if (localNow.weekday === 7) businessDay = localNow.plus({ days: 1 }).startOf('day').set({ hour: 9 });
const nextBusinessDay = (localNow.weekday <= 4 ? 'morgen, den ' : 'Montag, den ') + businessDay.toFormat('dd.MM.yyyy') + ', 09:00 Uhr';
const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const invoiceNumber = String(easybill?.number || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120); const invoiceSubject = invoiceNumber.replace(/[\r\n]+/g, ' ').slice(0, 100); const safeFileInvoice = invoiceNumber.replace(/[^\p{L}\p{N}._-]/gu, '-').slice(0, 80) || 'Rechnung'; const amountText = new Intl.NumberFormat('de-DE', { style: 'currency', currency: easyCurrency || 'EUR' }).format((outstanding || 0) / 100); const customerName = String(easyCompany || company || [order?.billingAddress?.firstName, order?.billingAddress?.lastName].filter(Boolean).join(' ')).replace(/[\r\n]+/g, ' ').trim().slice(0, 160); const hello = customerName ? 'Guten Tag ' + esc(customerName) + ',' : 'Guten Tag,'; const openBalanceText = received > 0 ? 'ein offener Restbetrag von <strong>' + esc(amountText) + '</strong>' : 'der Betrag von <strong>' + esc(amountText) + '</strong>';
const formalCommon = '<p>' + hello + '</p><p>Zu unserer Rechnung <strong>' + esc(invoiceNumber) + '</strong> ist ' + openBalanceText + ' weiterhin offen.</p>'; const formalPayment = '<p>Bitte verwenden Sie als Verwendungszweck ausschließlich die Easybill-Rechnungsnummer <strong>' + esc(invoiceNumber) + '</strong>.</p><p>Falls Sie bereits gezahlt haben, betrachten Sie diese Nachricht bitte als gegenstandslos.</p><p>Freundliche Grüße<br>NEONTRIP Kundendienst</p>'; const friendlyTail = '<p>Vielleicht ist die Überweisung bereits unterwegs oder die Rechnung befindet sich intern noch in Bearbeitung. Dann betrachten Sie diese Nachricht bitte einfach als kurze Zwischeninformation.</p><p>Falls etwas unklar ist oder Sie die Rechnung erneut benötigen, antworten Sie gern kurz auf diese E-Mail.</p><p>Für die Zuordnung verwenden Sie bei der Überweisung bitte die Rechnungsnummer <strong>' + esc(invoiceNumber) + '</strong> als Verwendungszweck.</p><p>Vielen Dank und freundliche Grüße<br>NEONTRIP Kundendienst</p>';
const templates = {
  1: ['Kurze Rückfrage zu Ihrer Rechnung ' + invoiceSubject, '<p>' + hello + '</p><p>wir möchten kurz nachfragen, ob unsere Rechnung <strong>' + esc(invoiceNumber) + '</strong> gut bei Ihnen angekommen ist. Bei uns ist ' + openBalanceText + ' offen.</p>' + friendlyTail],
  2: ['Freundliche Erinnerung zu Ihrer Rechnung ' + invoiceSubject, '<p>' + hello + '</p><p>Zu unserer Rechnung <strong>' + esc(invoiceNumber) + '</strong> ist ' + openBalanceText + ' weiterhin offen. Wir möchten freundlich daran erinnern und kurz nachfragen, ob es hierzu noch Rückfragen gibt.</p>' + friendlyTail],
  3: ['Letzte freundliche Erinnerung zu Ihrer Rechnung ' + invoiceSubject, '<p>' + hello + '</p><p>Zu unserer Rechnung <strong>' + esc(invoiceNumber) + '</strong> ist ' + openBalanceText + ' weiterhin offen.</p>' + (due < localNow.startOf('day') ? '<p>Die Rechnung war am <strong>' + esc(dueDateText) + '</strong> fällig. Bitte überweisen Sie den noch offenen Betrag.</p>' : '<p>Bevor anschließend unser Mahnverfahren beginnt, möchten wir Sie freundlich bitten, den offenen Betrag bis zum Rechnungsfälligkeitstermin <strong>' + esc(dueDateText) + '</strong> zu überweisen.</p>') + friendlyTail],
  4: ['1. Mahnung – Rechnung ' + invoiceSubject, formalCommon + '<p>Hiermit mahnen wir den offenen Rechnungsbetrag an. Bitte zahlen Sie bis <strong>' + esc(dunningDeadline) + '</strong>. Die zugehörige Rechnung ist dieser E-Mail beigefügt.</p>' + formalPayment],
  5: ['2. Mahnung – Rechnung ' + invoiceSubject, formalCommon + '<p>Trotz unserer ersten Mahnung ist der Betrag weiterhin offen. Bitte zahlen Sie bis <strong>' + esc(dunningDeadline) + '</strong>. Die Rechnung ist erneut beigefügt.</p>' + formalPayment],
  6: ['3. und letzte Mahnung – Rechnung ' + invoiceSubject, formalCommon + '<p><strong>Dies ist Ihre letzte Möglichkeit, ein Inkassoverfahren und weitere Kosten abzuwenden.</strong> Zahlen Sie den vollständigen Betrag spätestens bis <strong>' + esc(nextBusinessDay) + '</strong>. Nach fruchtlosem Ablauf werden wir am nächsten Geschäftstag ohne weitere Ankündigung ein Inkassounternehmen mit der weiteren Bearbeitung beauftragen. Dadurch können Ihnen – soweit gesetzlich zulässig und erstattungsfähig – zusätzliche Inkassokosten und Verzugszinsen entstehen. Die Rechnung ist beigefügt.</p>' + formalPayment],
};
// An unavailable Shopify response is a technical block, not proof of a refund or invalid address.
if (!order && (!ok(shopEnvelope) || (shop.errors || []).length)) {
  for (let i = reasons.length - 1; i >= 0; i -= 1) {
    if (['SHOPIFY_REFUND_OR_VOID_PRESENT','CUSTOMER_EMAIL_INVALID'].includes(reasons[i])) reasons.splice(i, 1);
  }
}
if ((shop.errors || []).some((error) => error?.extensions?.code === 'ACCESS_DENIED')) reasons.push('SHOPIFY_ACCESS_SCOPE_MISSING');
return [{ json: { ...candidate, send_allowed: reasons.length === 0, reasons: [...new Set(reasons)], warnings, recipient, subject: templates[candidate.stage_model === 'legacy_4' && stage === 4 ? 6 : stage]?.[0] || '', body_html: templates[candidate.stage_model === 'legacy_4' && stage === 4 ? 6 : stage]?.[1] || '', attachment_required: stage >= 4, safe_file_invoice: safeFileInvoice, easybill_version_id: selectedVersion ? String(selectedVersion.id) : null, easybill_version_item_id: selectedItem ? String(selectedItem.id) : null, live_evidence: { shopify_api_errors: (shop.errors || []).map((error) => ({ code: error?.extensions?.code || null, path: error?.path || null, message: String(error?.message || '').slice(0,300) })), qonto_payment_gate: { complete: qontoGate.complete === true, queried_from: qontoGate.queried_from || null, transaction_count: Number(qontoGate.transaction_count || 0), exact_reference_credit_cents: exactReferenceCreditCents, unreflected_credit_ids: qontoUnreflectedCredits.map((row) => row.id), ambiguous_credit_ids: qontoAmbiguousCredits.map((row) => row.id) }, checked_at: $now.toUTC().toISO(), customer_reply_check: customerReplyEvidence, reply_decision: replyDecisionState.decision || null, reply_decision_confidence: replyDecisionState.confidence ?? null, cycle_kind: cycleKind, cycle_id: candidate.cycle_id || null, cycle_baseline_at: candidate.cycle_baseline_at || null, shopify_order_id: legacyId, easybill_document_id: String(easybill?.id || ''), invoice_number: invoiceNumber, invoice_total_cents: invoiceAmount, payment_received_cents: received, amount_due_cents: outstanding, amount_cents: invoiceAmount, currency: easyCurrency, customer_name: customerName || null, company_domain: corporateApplicable ? domain : null, history_query_mode: expectedQueryMode, history_query_value: expectedQueryValue, prior_paid_order_id: priorPaid ? String(priorPaid.legacyResourceId || priorPaid.id) : null, customer_specific_payment_policy: umdaschCustomer ? { customer: 'UMDASCH', skonto_percent: 3, skonto_days: 30, reminder_grace_days: 45, reminder_grace_basis: 'easybill_invoice_created_at', reminder_earliest_at: umdaschReminderEarliest?.isValid ? umdaschReminderEarliest.toISO() : null } : null, address_warning: warnings[0] || null } } }];