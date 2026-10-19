
const src=$('Read Summary').first().json, now=new Date().toISOString();
function rest(name){const pages=$(name).all().map(i=>i.json);let all=[],total=null;for(const p of pages){if(![200,206].includes(p.statusCode)||!Array.isArray(p.body))throw Error(name+'_HTTP');const range=String(p.headers?.['content-range']||p.headers?.['Content-Range']||'');const t=range.split('/')[1];if(!/^\d+$/.test(t||''))throw Error(name+'_COUNT');if(total!==null&&total!==Number(t))throw Error(name+'_CHANGED');total=Number(t);all.push(...p.body);}if(all.length!==total)throw Error(name+'_INCOMPLETE');return all;}
const states=rest('Read Daily Dunning States'),logs=rest('Read Daily Reminder Logs'),mails=rest('Read Daily Mail Evidence'),audits=rest('Read Daily Verified Stages');
const senderIssues=rest('Read Daily Sender Issues');
const norm=x=>'#NEONT'+String(x||'').replace(/\D/g,'');
const cents=m=>Math.round(Number(m?.shopMoney?.amount)*100);
const bank=new Map(src.bank.map(b=>[b.transaction_id,b]));
function paid(id,amount){const b=bank.get(id);return b?.side==='credit'&&b.status==='completed'&&b.currency==='EUR'&&Math.round(Number(b.amount)*100)===amount;}
const allocations={
'4421':paid('dara-nova-gmbh-6402-1-transaction-019f2853-7bd1-7c3e-a747-7b4ed2-846c7b',63573)?63573:0,
'4427':paid('dara-nova-gmbh-6402-1-transaction-01a0d8d7-9523-7709-8ea3-36e944-8a7185',59857)?59857:0,
'4652':paid('dara-nova-gmbh-6402-1-transaction-01a0a046-9a76-7918-b6c5-a142cd-7fab25',469693)?100912:0,
'4653':paid('dara-nova-gmbh-6402-1-transaction-01a0a046-9a76-7918-b6c5-a142cd-7fab25',469693)?368781:0,
'4680':paid('dara-nova-gmbh-6402-1-transaction-01a090be-01f2-7dd0-89d0-c38b08-ca545f',2121175)?2121175:0,
'4422':src.bank.some(b=>b.side==='credit'&&b.status==='completed'&&b.amount===330&&String(b.reference||'').includes('4329'))?33000:0,
'4485':105672
};
const issues={
'4421':'635,73 EUR Teilzahlung; manuelle S2 vom 17.09.; Fortsetzung des Altverlaufs prüfen.',
'4422':'330,00 EUR wurden von Altauftrag 4329 zugeordnet; Rest höchstens 62,70 EUR; Erinnerung vom 09.09. nachgewiesen.',
'4427':'598,57 EUR am 25.09. bezahlt; Zahlung in Shopify/Abrechnung noch nicht zugeordnet. Keine weitere Mahnung.',
'4449':'Pause und Stopptag; Leistungs-/Rechnungsprüfung erforderlich.',
'4485':'Zwei dokumentierte PayPal-Zahlungen über 1.056,72 EUR; Shopify offen. Buchungsabgleich erforderlich, keine Mahnung.',
'4499':'Manuelle Zahlungserinnerung am 08.09. nachgewiesen; Rechnung anschließend an invoiceeu@emco-eroller.de.',
'4539':'Stopptag und kollidierende Rechnungsnummer; keine pauschale Nachsendung.',
'4543':'Aktueller Beleg 4543, ursprünglich versandt als Rechnung 4540; Bankreferenz 4543 gehört anderem Kunden. Belegzuordnung prüfen.',
'4652':'Sammelzahlung 4.696,93 EUR vom 14.09. deckt 4652 und 4653 vollständig; Zuordnung in Shopify/Abrechnung fehlt.',
'4653':'Sammelzahlung 4.696,93 EUR vom 14.09. deckt 4652 und 4653 vollständig; Zuordnung in Shopify/Abrechnung fehlt.',
'4662':'Zahlungszuordnung prüfen: zweimal 4.899,24 EUR für anderen Auftrag 4659 eingegangen; möglichen Überhang vor Erinnerung klären.',
'4676':'Barzahlung bei Abholung ausdrücklich vereinbart; Kasse/Abholung prüfen.',
'4680':'50 Prozent / 21.211,75 EUR am 11.09. bezahlt; Restfälligkeit und Stopptag prüfen.'
};
const cases=[];
for(const o of src.shopify.open){const key=norm(o.name),digits=String(o.name).replace(/\D/g,'');const state=states.find(s=>norm(s.shopify_order_number)===key);
const validLogs=logs.filter(l=>norm(l.shopify_order_number)===key&&['sent','sent-custom','import-outlook'].includes(l.status));
const proofs=audits.filter(a=>String(a.document_id)===String(o.legacyResourceId)&&a.metadata?.provider_message_id&&a.metadata?.sent_at);
// The shared status table and imported sent logs may be copies of modern evidence.
const modernProofs=proofs.filter(a=>(a.metadata?.evidence_schema==='t099.sender.evidence.v1'&&a.metadata?.stage_model!=='legacy_4')||a.metadata?.evidence_schema==='dunning.reviewed.reminder.v1');
const matchesModern=(stage,sentAt)=>Number.isFinite(Date.parse(sentAt))&&modernProofs.some(a=>Number(a.metadata.stage)===stage&&Date.parse(a.metadata.sent_at)===Date.parse(sentAt));
const legacyLogs=validLogs.filter(l=>!matchesModern(Number(l.mahnstufe)||0,l.sent_at));
const projectedStage=Number(state?.mahnstufe)||0;
const legacyStage=Math.max(matchesModern(projectedStage,state?.last_sent_at)?0:projectedStage,...legacyLogs.map(l=>Number(l.mahnstufe)||0),...proofs.filter(a=>!modernProofs.includes(a)).map(a=>Number(a.metadata.stage)||0));
const modernStage=Math.max(0,...modernProofs.map(a=>Number(a.metadata.stage)||0));
const stage=Math.max(legacyStage,modernStage);
const stageConflict=legacyStage>0&&modernStage>0&&(legacyStage!==modernStage||legacyStage>=4);
const stageSource=stageConflict?'mixed':modernStage>0?'t099':legacyStage>0?'legacy':'unknown';
const labels={0:'Noch keine Nachricht',1:'Kurze Rückfrage',2:'Freundliche Erinnerung',3:'Letzte freundliche Erinnerung',4:'1. Mahnung',5:'2. Mahnung',6:'3. und letzte Mahnung'};
const stageLabel=stageConflict?'Mahnstufe '+stage+' (Zuordnung prüfen)':stageSource==='legacy'&&stage>=4?'Letzte Mahnstufe (Altbestand, Stufe '+stage+')':labels[stage]||'Mahnstufe '+stage;
const finalStage=!stageConflict&&(legacyStage>=4||modernStage>=6);
const docs=[...src.invoices,...src.proformas].filter(d=>norm(d.order_number)===key&&!d.cancel_id&&!d.is_draft);
const email=String(o.email||'').toLowerCase();
const candidates=mails.filter(m=>m.sent_at&&m.message_id&&new RegExp('NEON[T]?[ -]?'+digits+'(?![0-9])','i').test(String(m.subject||''))&&(m.to_emails||[]).some(e=>String(e).toLowerCase()===email));
const reminder=candidates.filter(m=>/mahnung|zahlungserinnerung|offener restbetrag|rechnung.*angekommen|rückfrage.*rechnung/i.test(m.subject||'')).sort((a,b)=>String(b.sent_at).localeCompare(String(a.sent_at)))[0];
const test=['4622','4625'].includes(digits)||(o.tags||[]).some(t=>/e2e|testbestellung/i.test(t));
const gross=cents(o.totalOutstandingSet),allocated=Math.min(gross,allocations[digits]||0),remaining=Math.max(0,gross-allocated);
const hold=Boolean(state?.paused)||(o.tags||[]).some(t=>/mahnstop|mahn.stop|keine.?mahnung|keine.?zahlungserinnerung|nicht.?mahnen|inkasso|insolven|warten.?auf.?zahlung|mit.*anwalt/i.test(t));
let status=o.cancelledAt?'cancelled':test?'test':o.displayFinancialStatus==='PAID'?'payment_data_conflict':remaining===0?'payment_recording_required':hold?'held':stageConflict?'stage_source_review':finalStage?'final_stage_review':stage>0||reminder?'reminder_evidenced':'reminder_missing';
if(!['cancelled','test','payment_data_conflict','payment_recording_required','held','final_stage_review','stage_source_review'].includes(status)&&state?.next_due_at&&String(state.next_due_at)<now.slice(0,10))status='follow_up_due';
const bankCandidates=src.bank.filter(b=>b.side==='credit'&&b.status==='completed'&&new RegExp('NEON\\s*T?\\s*'+digits+'(?![0-9])','i').test(String(b.reference||''))).map(b=>({transaction_id:b.transaction_id,amount:b.amount,settled_at:b.settled_at}));
const latestBlocked=senderIssues.filter(a=>String(a.document_id)===String(o.legacyResourceId)).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0];
const latestSent=[state?.last_sent_at,...validLogs.map(l=>l.sent_at),...proofs.map(a=>a.metadata.sent_at)].filter(Boolean).sort((a,b)=>Date.parse(b)-Date.parse(a))[0];
const blockUnresolved=latestBlocked&&(!latestSent||Date.parse(latestBlocked.created_at)>Date.parse(latestSent));
if(blockUnresolved&&!['cancelled','test','payment_data_conflict','payment_recording_required','held','final_stage_review','stage_source_review'].includes(status))status='sender_blocked';
const permanentBlockReasons=new Set(['EXISTING_COMPANY_DOMAIN_PRIOR_PAID','SHOPIFY_CANCELLED','SHOPIFY_REFUND_OR_VOID_PRESENT','SHOPIFY_CHARGEBACK_OR_DISPUTE_PRESENT','EASYBILL_STORNO','EASYBILL_STORNO_RELATED','EASYBILL_FULL_CREDIT','EASYBILL_PARTIAL_CREDIT_REVIEW','EASYBILL_REPLACEMENT_INVOICE','CUSTOMER_EMAIL_INVALID','CUSTOMER_REPLIED_TO_PAYMENT_REMINDER','CUSTOMER_REPLY_BEFORE_T268_CUTOVER','T268_PARTIAL_BEFORE_CUTOVER']);
const rawBlockReasons=latestBlocked?.metadata?.reasons||[];
const effectiveBlockReasons=rawBlockReasons.includes('SHOPIFY_LIVE_GATE_INCOMPLETE')&&!latestBlocked?.metadata?.live_evidence?.shopify_order_id?rawBlockReasons.filter(r=>!['SHOPIFY_REFUND_OR_VOID_PRESENT','CUSTOMER_EMAIL_INVALID'].includes(r)):rawBlockReasons;
const senderBlockKind=blockUnresolved?(effectiveBlockReasons.some(r=>permanentBlockReasons.has(r))?'permanent':'technical'):null;
const blockNote=blockUnresolved?'Automatischer Versand Stufe '+latestBlocked.metadata?.stage+' am '+latestBlocked.created_at+' blockiert: '+(latestBlocked.metadata?.reasons||[]).join(', ')+'. ':'';
const stageNote=stageLabel+' | Ablauf: '+(stageSource==='t099'?'aktuell':stageSource==='legacy'?'Altbestand':stageSource==='mixed'?'Zuordnung prüfen':'noch unbelegt')+(state?.next_due_at&&!finalStage&&!stageConflict?' | Nächste Frist '+state.next_due_at:'')+'. ';
const note=stageNote+blockNote+(issues[digits]||(status==='follow_up_due'?'Nächste Mahnstufe seit '+state.next_due_at+' fällig; Versandlauf und Sperren prüfen.':!docs.length?'Kein eindeutig passender offener Easybill-Beleg; Zuordnung prüfen.':status==='reminder_missing'?'Keine Zahlungserinnerung im geprüften Versandnachweis; Zahlung/Beleg/Sperren vor Nachsendung prüfen.':status==='held'?'Bestehende Pause oder Shopify-Sperre beachten.':stageConflict?'Zuordnung zwischen Altbestand und aktuellem Ablauf prüfen; keine automatische Fortsetzung.':finalStage?'Letzte Mahnstufe erreicht; Folgeprüfung statt weiterer pauschaler Erinnerung.':'Versandverlauf vorhanden; nächste Fälligkeit und Sperren prüfen.'));
cases.push({order:key,shopify_order_id:String(o.legacyResourceId),created_at:o.createdAt,customer:o.billingAddress?.company||[o.billingAddress?.firstName,o.billingAddress?.lastName].filter(Boolean).join(' '),email,gross_cents:gross,allocated_cents:allocated,remaining_cents:remaining,stage,stage_source:stageSource,stage_label:stageLabel,next_due_at:state?.next_due_at||null,status,note,sender_blocked:Boolean(blockUnresolved),sender_block_kind:senderBlockKind,invoice_count:docs.length,proforma_only:docs.length>0&&docs.every(d=>d.type==='PROFORMA_INVOICE'),last_reminder_at:[latestSent,reminder?.sent_at].filter(Boolean).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]||null,bank_candidates:bankCandidates});
}
const continuation = (
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
    if (!o || o.cancelledAt || !['PENDING','PARTIALLY_PAID'].includes(o.displayFinancialStatus) || !instant(o.createdAt) || Date.parse(o.createdAt) > now - 35 * 86400000) { exclude('ORDER_NOT_ELIGIBLE'); continue; }
    const state = states.find(s => key(s.shopify_order_number) === c.order);
    if (state?.paused || (o.tags || []).some(t => /mahnstop|mahn.stop|keine.?mahnung|keine.?zahlungserinnerung|nicht.?mahnen|inkasso|insolven|warten.?auf.?zahlung|mit.*anwalt|e2e|testbestellung/i.test(t))) { exclude('MANUAL_OR_TAG_HOLD'); continue; }
    const matches = documents.filter(d => key(d.order_number) === c.order && !d.cancel_id && d.is_draft === false && d.paid_at == null);
    const invoices = matches.filter(d => d.type === 'INVOICE');
    const docs = invoices.length ? invoices : matches.filter(d => d.type === 'PROFORMA_INVOICE');
    if (docs.length !== 1) { exclude('DOCUMENT_NOT_UNIQUE'); continue; }
    const d = docs[0], total = cents(o.totalPriceSet), current = cents(o.currentTotalPriceSet), due = cents(o.totalOutstandingSet), paid = cents(o.totalReceivedSet);
    if (![total,current,due,paid,d.amount,d.paid_amount].every(Number.isSafeInteger) || total <= 0 || current !== total || due <= 0 || paid < 0 || paid + due !== total || d.amount !== total || d.paid_amount !== paid || c.remaining_cents !== due || c.gross_cents !== due) { exclude('PAYMENT_OR_AMOUNT_MISMATCH'); continue; }
    const explicitImmediateProforma = d.type === 'PROFORMA_INVOICE' && d.due_date == null && d.due_in_days === 0 && /^Zahlbar sofort[.!]/i.test(String(d.text || '').replace(/<[^>]*>/g,' ').trim()) && /^\d{4}-\d{2}-\d{2}$/.test(d.document_date || '');
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
    if (!anchor && d.type === 'INVOICE' && Date.parse(o.createdAt) >= Date.parse('2026-08-05T15:30:00Z')) { exclude('REGULAR_INTAKE'); continue; }
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


)({ orders:src.shopify.orders, documents:[...src.invoices,...src.proformas], states, logs, mails, proofs:audits, cases, observedAt:now });
for (const row of continuation.candidates) { const date=DateTime.fromFormat(String(row.easybill_document_created_at), 'yyyy-MM-dd HH:mm:ss', {zone:'Europe/Berlin'}); if(date.isValid) row.easybill_document_created_at=date.toUTC().toISO(); }
for (const c of cases) { const candidate=continuation.candidates.find(row=>row.shopify_order_name===c.order); const exclusion=continuation.excluded.find(row=>row.order===c.order); if(candidate) c.note += ' Automatische Fortsetzung aufgenommen; vor jedem Versand erneute Live-Prüfung.'; c.automation = candidate ? {status:'enrolled',stage_model:candidate.continuation.stage_model} : {status:exclusion?.reason==='REGULAR_INTAKE'?'regular_intake':'excluded',reason:exclusion?.reason||'UNCLASSIFIED'}; }
const active=cases.filter(c=>!['cancelled','test','payment_data_conflict','payment_recording_required'].includes(c.status));
const noteRows=cases.map(c=>{const old=states.find(s=>norm(s.shopify_order_number)===c.order);const prior=String(old?.note||'').replace(/\n?\[35-TAGE-KONTROLLE\][\s\S]*?\[\/35-TAGE-KONTROLLE\]/g,'').trim();const note='[35-TAGE-KONTROLLE] '+now.slice(0,10)+' | '+c.status+' | Arbeitsrest '+(c.remaining_cents/100).toFixed(2)+' EUR | '+c.note+' [/35-TAGE-KONTROLLE]';return{shopify_order_number:c.order,note:[prior,note].filter(Boolean).join('\n'),updated_by:'n8n:35-day-dunning-control',updated_at:now};});
const orderRows=src.shopify.orders.map(o=>({shopify_order_id:String(o.legacyResourceId),name:o.name,financial_status:String(o.displayFinancialStatus||'').toLowerCase(),total_price:Number(o.currentTotalPriceSet.shopMoney.amount),total_outstanding:Number(o.totalOutstandingSet.shopMoney.amount),currency:o.totalOutstandingSet.shopMoney.currencyCode,email:o.email||null,tags:(o.tags||[]).join(', '),created_at:o.createdAt,cancelled_at:o.cancelledAt||null,ingested_at:now}));
const totals={orders_checked:src.shopify.total,raw_positive:cases.length,excluded_cancelled:cases.filter(c=>c.status==='cancelled').length,excluded_tests:cases.filter(c=>c.status==='test').length,payment_recording_required:cases.filter(c=>c.status==='payment_recording_required').length,open_or_review:active.length,working_amount_cents:active.reduce((s,c)=>s+c.remaining_cents,0),sender_blocked:active.filter(c=>c.sender_blocked).length,missing_reminder_evidence:active.filter(c=>c.status==='reminder_missing').length,held:active.filter(c=>c.status==='held').length,follow_up_due:active.filter(c=>c.status==='follow_up_due').length};
const record={document_id:now.slice(0,10),workflow_name:'NEONTRIP Daily 35-Day Dunning Control',action:'daily_35_day_dunning_audit',status:'success',metadata:{schema:'dunning.35day.control.v1',cutoff:src.shopify.cutoff,observed_at:now,continuation,totals,stages:[...new Set([0,1,2,3,4,5,6,...active.map(c=>c.stage)])].sort((a,b)=>a-b).map(stage=>({stage,count:active.filter(c=>c.stage===stage).length,amount_cents:active.filter(c=>c.stage===stage).reduce((s,c)=>s+c.remaining_cents,0)})),cases,source_counts:{shopify_pages:src.shopify.pages,invoices:src.invoices.length,proformas:src.proformas.length,unique_bank_transactions:src.bank.length,messages:mails.length}}};
return[{json:{order_rows:orderRows,note_rows:noteRows,audit_record:record,totals}}];
