// Side-effect-free contract embedded in the daily n8n node; all candidates still require the live sender gate.
(function buildHistoricalContinuation({ orders, documents, states, logs, mails, proofs, cases, observedAt }) {
  const prefix = 'e936881a-fe32-4d94-aa1d-eaffcf4a75be:T099:PAYMENT_COLLECTION:';
  const now = Date.parse(observedAt);
  const key = value => '#NEONT' + String(value || '').replace(/\D/g, '');
  const email = value => String(value || '').trim().toLowerCase();
  const cents = value => Math.round(Number(value?.shopMoney?.amount) * 100);
  const instant = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const candidates = [], excluded = [];
  for (const c of cases) {
    const exclude = reason => excluded.push({ order: c.order, reason });
    if (['held','cancelled','test','payment_data_conflict','payment_recording_required','final_stage_review','stage_source_review'].includes(c.status)) { exclude(c.status); continue; }
    if (c.status === 'sender_blocked' && c.sender_block_kind !== 'technical') { exclude('sender_blocked'); continue; }
    if (c.allocated_cents > 0 || c.remaining_cents <= 0) { exclude('PAYMENT_RECORDING_REQUIRED'); continue; }
    if (c.stage_source === 't099' && !proofs.some(p => String(p.document_id) === c.shopify_order_id && (p.metadata?.evidence_schema === 'dunning.reviewed.reminder.v1' || p.metadata?.continuation?.schema === 'dunning.historical.candidate.v1'))) { exclude('REGULAR_INTAKE'); continue; }
    const o = orders.find(o => String(o.legacyResourceId) === c.shopify_order_id && key(o.name) === c.order);
    if (!o || o.cancelledAt || !['PENDING','PARTIALLY_PAID'].includes(o.displayFinancialStatus) || !instant(o.createdAt)) { exclude('ORDER_NOT_ELIGIBLE'); continue; }
    const state = states.find(s => key(s.shopify_order_number) === c.order);
    if (state?.paused || (o.tags || []).some(t => /mahnstop|mahn.stop|keine.?mahnung|keine.?zahlungserinnerung|nicht.?mahnen|inkasso|insolven|warten.?auf.?zahlung|mit.*anwalt|e2e|testbestellung/i.test(t))) { exclude('MANUAL_OR_TAG_HOLD'); continue; }
    const matches = documents.filter(d => key(d.order_number) === c.order && !d.cancel_id && d.is_draft === false && d.paid_at == null);
    const invoices = matches.filter(d => d.type === 'INVOICE');
    const docs = invoices.length ? invoices : matches.filter(d => d.type === 'PROFORMA_INVOICE');
    if (docs.length !== 1) { exclude('DOCUMENT_NOT_UNIQUE'); continue; }
    const d = docs[0], total = cents(o.totalPriceSet), current = cents(o.currentTotalPriceSet), due = cents(o.totalOutstandingSet), paid = cents(o.totalReceivedSet);
    if (![total,current,due,paid,d.amount,d.paid_amount].every(Number.isSafeInteger) || total <= 0 || current !== total || due <= 0 || paid < 0 || paid + due !== total || d.amount !== total || d.paid_amount !== paid || c.remaining_cents !== due || c.gross_cents !== due) { exclude('PAYMENT_OR_AMOUNT_MISMATCH'); continue; }
    const explicitImmediateProforma = d.type === 'PROFORMA_INVOICE' && d.due_date == null && d.due_in_days === 0 && /(?:^|[\n\r])\s*Zahlbar sofort[.!](?:\s|$)/i.test(String(d.text || '').replace(/<br\s*\/?\s*>|<\/p>/gi,'\n').replace(/<[^>]*>/g,' ').trim()) && /^\d{4}-\d{2}-\d{2}$/.test(d.document_date || '');
    const dueDate = explicitImmediateProforma ? d.document_date : d.due_date;
    if (d.currency !== o.totalPriceSet?.shopMoney?.currencyCode || !/^[A-Z]{3}$/.test(d.currency || '') || !text(d.number) || !text(String(d.customer_id || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate || '') || !instant(o.updatedAt) || !text(d.created_at)) { exclude('DOCUMENT_FIELDS_MISSING'); continue; }
    let recipient = email(o.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) { exclude('RECIPIENT_INVALID'); continue; }
    const outbound = mails.filter(m => m.direction === 'outbound' && m.source === 'outlook' && text(m.message_id) && text(m.internet_message_id) && text(m.conversation_id) && instant(m.sent_at) && m.to_emails?.length === 1 && !(m.cc_emails || []).length && !(m.bcc_emails || []).length);
    const changedDocumentProof = proofs.some(p => p.status === 'sent' && String(p.document_id) === c.shopify_order_id && ['dunning.reviewed.reminder.v1','t099.sender.evidence.v1'].includes(p.metadata?.evidence_schema) && String(p.metadata?.easybill_document_id) !== String(d.id));
    if (changedDocumentProof) { exclude('DOCUMENT_CHANGED_SINCE_REMINDER'); continue; }
    const ownProofs = proofs.filter(p => p.status === 'sent' && String(p.document_id) === c.shopify_order_id && String(p.metadata?.easybill_document_id) === String(d.id));
    const reviewed = ownProofs.filter(p => p.action === 'reviewed_reminder_sent_verified' && p.metadata?.evidence_schema === 'dunning.reviewed.reminder.v1' && p.metadata.stage === 1).sort((a,b) => Date.parse(a.metadata.sent_at) - Date.parse(b.metadata.sent_at));
    const priorContinuation = ownProofs.filter(p => p.metadata?.continuation?.schema === 'dunning.historical.candidate.v1').sort((a,b) => Date.parse(a.metadata.sent_at) - Date.parse(b.metadata.sent_at))[0]?.metadata.continuation;
    let anchor = null, model = 'current_6', cycleId = 'H' + String(d.id);
    if (priorContinuation) {
      anchor = priorContinuation.anchor || null; recipient = email(anchor?.recipient || o.email); model = priorContinuation.stage_model; cycleId = priorContinuation.cycle_id;
    } else if (reviewed.length) {
      const a = reviewed[0].metadata;
      if (a.live_evidence?.review_ticket !== 'REPAIR-20261014-MAHN-35D' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email(a.recipient))) { exclude('REVIEWED_RECIPIENT_NOT_PROVEN'); continue; }
      recipient = email(a.recipient);
      const m = outbound.find(m => m.message_id === a.provider_message_id && email(m.to_emails[0]) === recipient);
      const expectedKey = prefix + c.shopify_order_id + ':C-R20261014T35:S1';
      if (!m || a.lock_key !== expectedKey || a.provider_internet_message_id !== m.internet_message_id || a.provider_conversation_id !== m.conversation_id || instant(a.sent_at) !== instant(m.sent_at) || email(a.recipient) !== recipient || a.attachment_verified !== true || !/^[a-f0-9]{64}$/.test(a.pdf_sha256 || '') || a.pdf_sha256 !== a.attachment_content_sha256 || a.pdf_bytes < 1000) { exclude('REVIEWED_SEND_PROOF_INCOMPLETE'); continue; }
      cycleId = 'R20261014T35';
      anchor = { stage: 1, sent_at: instant(m.sent_at), message_id: m.message_id, internet_message_id: m.internet_message_id, conversation_id: m.conversation_id, lock_key: a.lock_key, evidence: 'reviewed_reminder', recipient, audit_id: reviewed[0].id };
    } else if (c.stage > 0) {
      if (c.stage_source === 't099') { exclude('REGULAR_INTAKE'); continue; }
      // Legacy stages keep their four-stage model. Never manufacture missing previous stages.
      if (c.stage_source !== 'legacy' || c.stage >= 4 || !instant(state?.last_sent_at)) { exclude('HISTORICAL_STAGE_NOT_PROVEN'); continue; }
      const refs = [c.order.replace(/^#/, ''), String(d.number).replace(/^#/, '')].map(r => r.replace(/[^A-Za-z0-9-]/g,'')).filter(Boolean);
      const mail = outbound.filter(m => email(m.to_emails[0]) === recipient && Math.abs(Date.parse(m.sent_at) - Date.parse(state.last_sent_at)) <= 60000 && refs.some(ref => new RegExp(ref + '(?![0-9])','i').test(m.subject || '')) && /mahnung|erinnerung|zahlung|rechnung.*angekommen/i.test(m.subject || ''));
      if (mail.length !== 1) { exclude('HISTORICAL_SEND_PROOF_MISSING'); continue; }
      const m = mail[0]; model = 'legacy_4';
      anchor = { stage: c.stage, sent_at: instant(m.sent_at), message_id: m.message_id, internet_message_id: m.internet_message_id, conversation_id: m.conversation_id, lock_key: null, evidence: 'outlook_legacy' };
    } else if (outbound.some(m => /mahnung|zahlungserinnerung|rückfrage.*rechnung|freundliche erinnerung/i.test(m.subject || '') && String(m.subject).includes(c.order.replace(/^#/, '')))) { exclude('UNASSIGNED_PRIOR_REMINDER'); continue; }
    if (!anchor && Date.parse(o.createdAt) >= Date.parse('2026-08-05T15:30:00Z')) { exclude('REGULAR_INTAKE'); continue; }
    const review = proofs.find(p => p.id === '8a19fc8c-1dbf-4bb2-bdbd-2325a04c179c' && p.action === 'one_time_correspondence_review' && p.status === 'success' && p.metadata?.schema === 'dunning.mailreview.v1' && p.metadata?.provider_mailbox === 'support@neontrip.de');
    const finding = review?.metadata?.findings?.[c.order.replace(/\D/g,'')];
    if (finding?.hold === true || finding?.outcome === 'auto_reply_and_billing_route') { exclude(finding.hold ? 'CORRESPONDENCE_REVIEW_HOLD' : 'BILLING_ROUTE_REVIEW_REQUIRED'); continue; }
    const reviewedAt = instant(review?.created_at);
    const correspondenceReview = anchor?.evidence === 'reviewed_reminder' && finding?.hold === false && ['billing_recipient_context','delivery_change_answered','auto_reply_and_correct_contact','confirmed_order','no_new_objection','design_wait_resolved'].includes(finding.outcome) && reviewedAt && Date.parse(reviewedAt) >= Date.parse(anchor.sent_at) && Date.parse(reviewedAt) <= now ? {audit_id:review.id,reviewed_at:reviewedAt,outcome:finding.outcome} : null;
    const continuation = { schema: 'dunning.historical.candidate.v1', stage_model: model, cycle_id: cycleId, cycle_prefix: prefix + c.shopify_order_id + ':C-' + cycleId, anchor, observed_at: observedAt, document_type: d.type, original_shopify_email: email(o.email), correspondence_review:correspondenceReview };
    candidates.push({
      candidate_key: 'shopify:' + c.shopify_order_id + '|easybill:' + d.id,
      shopify_order_id: c.shopify_order_id, shopify_order_gid: o.id, shopify_order_name: c.order,
      shopify_order_created_at: o.createdAt, shopify_order_updated_at: o.updatedAt,
      shopify_email_hint: recipient, shopify_company_hint: o.billingAddress?.company || null,
      easybill_document_id: String(d.id), easybill_invoice_number: d.number, easybill_customer_id: String(d.customer_id),
      easybill_document_created_at: d.created_at, easybill_due_date: dueDate, easybill_due_basis: explicitImmediateProforma ? 'explicit_immediate_proforma' : 'document_due_date', easybill_document_type: d.type,
      easybill_company_hint: d.address?.company || null, invoice_amount_cents: total,
      payment_received_cents: paid, easybill_paid_cents: d.paid_amount, amount_due_cents: due, currency: d.currency,
      cycle_kind: paid ? 'partial_payment' : 'initial', cycle_id: cycleId, preliminary_only: true, continuation,
      intake_evidence: { source: 'historical_control_v1', observed_at: observedAt }
    });
  }
  return { schema: 'dunning.historical.snapshot.v1', observed_at: observedAt, fresh_until: new Date(now + 26 * 3600000).toISOString(), candidates, excluded };
})
