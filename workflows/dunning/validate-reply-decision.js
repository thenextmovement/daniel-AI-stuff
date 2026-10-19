
const meta = $('Build T268 Reply Decision Request').first().json || {};
const extractText = (value) => {
  if (typeof value?.text === 'string') return value.text;
  if (typeof value?.response === 'string') return value.response;
  if (typeof value?.mergedResponse === 'string') return value.mergedResponse;
  if (typeof value?.content === 'string') return value.content;
  if (Array.isArray(value?.content)) return value.content.map((part) => part?.text || '').join('\n');
  if (Array.isArray(value?.output)) return value.output.flatMap((item) => item?.content || []).map((part) => part?.text || '').join('\n');
  return '';
};
const allowedReasons = new Set(['document_request_fulfilled','no_different_arrangement','payment_promised_without_agreement','unrelated_substantive_reply','agreed_payment_plan','agreed_deferment','claims_paid','invoice_copy_or_document_request','invoice_or_amount_dispute','delivery_or_quality_dispute','cancellation_or_refund','legal_or_collection_objection','complaint','cannot_determine','prompt_injection_attempt','other']);
const allowedRisks = new Set(['payment_claim','agreement','document_needed','dispute','complaint','legal','cancellation_or_refund','prompt_injection','ambiguity']);
const continueReasons = new Set(['document_request_fulfilled','no_different_arrangement','payment_promised_without_agreement','unrelated_substantive_reply']);
const stopReasons = new Set(['agreed_payment_plan','agreed_deferment','claims_paid','invoice_copy_or_document_request','invoice_or_amount_dispute','delivery_or_quality_dispute','cancellation_or_refund','legal_or_collection_objection','complaint']);
let parsed = null;
let validationError = null;
if (meta.requires_ai === true) {
  try {
    const raw = extractText($input.first().json).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    parsed = JSON.parse(raw);
  } catch (error) {
    validationError = 'invalid_json';
  }
}
const requiredKeys = ['decision','confidence','summary','reason_codes','risk_flags','evidence_quote','requires_human_review'];
const keysValid = parsed && !Array.isArray(parsed) && JSON.stringify(Object.keys(parsed).sort()) === JSON.stringify([...requiredKeys].sort());
const decisionValid = keysValid && ['continue_dunning','stop_dunning','uncertain'].includes(parsed.decision);
const confidenceValid = decisionValid && typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence) && parsed.confidence >= 0 && parsed.confidence <= 1;
const summaryValid = confidenceValid && typeof parsed.summary === 'string' && parsed.summary.trim().length > 0 && parsed.summary.length <= 500;
const reasonsValid = summaryValid && Array.isArray(parsed.reason_codes) && parsed.reason_codes.length >= 1 && parsed.reason_codes.length <= 8 && parsed.reason_codes.every((value) => allowedReasons.has(value));
const risksValid = reasonsValid && Array.isArray(parsed.risk_flags) && parsed.risk_flags.length <= 8 && parsed.risk_flags.every((value) => allowedRisks.has(value));
const evidenceValid = risksValid && typeof parsed.evidence_quote === 'string' && parsed.evidence_quote.length <= 300 && String(meta.latest_reply?.body_text || '').includes(parsed.evidence_quote);
const reviewFlagValid = evidenceValid && typeof parsed.requires_human_review === 'boolean' && (parsed.decision === 'uncertain' ? parsed.requires_human_review === true : parsed.requires_human_review === false);
const confidencePolicyValid = reviewFlagValid && (parsed.decision === 'uncertain' || parsed.confidence >= 0.90);
const resolutionProofValid = !parsed?.reason_codes?.includes('document_request_fulfilled') || meta.resolved_document_request_evidence === true;
const reasonPolicyValid = resolutionProofValid && confidencePolicyValid && (parsed.decision === 'continue_dunning' ? parsed.reason_codes.every((value) => continueReasons.has(value)) : parsed.decision === 'stop_dunning' ? parsed.reason_codes.some((value) => stopReasons.has(value)) : true);
if (meta.requires_ai === true && !(keysValid && decisionValid && confidenceValid && summaryValid && reasonsValid && risksValid && evidenceValid && reviewFlagValid && confidencePolicyValid && reasonPolicyValid)) validationError = validationError || 'invalid_schema_or_policy';
if (meta.requires_ai === true && validationError) throw new Error('CLASSIFIER_TECHNICAL_FAILURE: ' + validationError + '; no customer decision or pause was recorded');
let decision = null;
let confidence = null;
let summary = null;
let reasonCodes = [];
let riskFlags = [];
let evidenceQuote = '';
let requiresHumanReview = false;
if (meta.cached_decision) {
  decision = String(meta.cached_decision.decision || 'uncertain');
  confidence = Number(meta.cached_decision.confidence || 0);
  summary = String(meta.cached_decision.summary || '');
  reasonCodes = Array.isArray(meta.cached_decision.reason_codes) ? meta.cached_decision.reason_codes : [];
  riskFlags = Array.isArray(meta.cached_decision.risk_flags) ? meta.cached_decision.risk_flags : [];
  evidenceQuote = String(meta.cached_decision.evidence_quote || '');
  requiresHumanReview = decision === 'uncertain';
} else if (meta.requires_ai === true) {
  if (validationError || meta.prompt_injection_detected === true) {
    decision = 'uncertain';
    confidence = 0;
    summary = meta.prompt_injection_detected === true ? 'Die Kundennachricht enthält mögliche Anweisungen an die Klassifizierung und muss manuell geprüft werden.' : 'Die KI-Antwort war nicht eindeutig oder entsprach nicht dem festgelegten Ausgabeformat.';
    reasonCodes = [meta.prompt_injection_detected === true ? 'prompt_injection_attempt' : 'cannot_determine'];
    riskFlags = [meta.prompt_injection_detected === true ? 'prompt_injection' : 'ambiguity'];
    evidenceQuote = String(meta.latest_reply?.body_text || '').slice(0, 300);
    requiresHumanReview = true;
  } else {
    decision = parsed.decision;
    confidence = parsed.confidence;
    summary = parsed.summary.trim();
    reasonCodes = [...new Set(parsed.reason_codes)];
    riskFlags = [...new Set(parsed.risk_flags)];
    evidenceQuote = parsed.evidence_quote;
    requiresHumanReview = parsed.requires_human_review;
  }
}
const isNewDecision = meta.requires_ai === true && Boolean(meta.latest_reply);
const esc = (value) => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
const currency = String(meta.currency || 'EUR').toUpperCase();
const amountText = new Intl.NumberFormat('de-DE',{style:'currency',currency:/^[A-Z]{3}$/.test(currency)?currency:'EUR'}).format(Number(meta.amount_due_cents || 0)/100);
const safeSummary = String(summary || '').replace(/[\r\n]+/g,' ').slice(0,500);
const safeExcerpt = String(meta.latest_reply?.body_text || '').slice(0,1200);
const reviewSubject = '[Mahnwesen Entscheidung] ' + String(meta.shopify_order_name || '').replace(/[\r\n]+/g,' ').slice(0,80) + ' – weiterführen oder stoppen?';
const reviewBody = '<p>Die automatische Antwortanalyse konnte nicht sicher entscheiden, wie das Mahnwesen fortgeführt werden soll.</p><p><strong>Bestellung:</strong> ' + esc(meta.shopify_order_name) + '<br><strong>Rechnung:</strong> ' + esc(meta.easybill_invoice_number) + '<br><strong>Offener Restbetrag:</strong> ' + esc(amountText) + '</p><p><strong>KI-Einschätzung:</strong> ' + esc(safeSummary) + '<br><strong>Gründe:</strong> ' + esc(reasonCodes.join(', ') || 'cannot_determine') + '</p><p><strong>Kundennachricht:</strong></p><blockquote>' + esc(safeExcerpt).replace(/\n/g,'<br>') + '</blockquote><p>Der Vorgang wurde vorsorglich in der Mahnabteilung pausiert. Bitte entscheiden Sie dort: <strong>Weiterführen</strong> = Pause aufheben; <strong>Stoppen</strong> = pausiert lassen.</p><p><a href="https://ops.neontrip.de/ops/mahnwesen">Mahnabteilung öffnen</a></p>';
const priorNote = String(meta.previous_dunning_note || '').replace(/\s+/g,' ').trim();
const decisionLabel = decision === 'stop_dunning' ? 'KI-Entscheidung: Mahnwesen stoppen' : 'KI unsicher: manuelle Entscheidung erforderlich';
const dunningNote = [priorNote, decisionLabel + ' | TICKET-268 | Antwort ' + String(meta.latest_reply?.message_id || '').slice(0,180) + ' | ' + safeSummary].filter(Boolean).join(' | ').slice(0,1900);
const fnv = (value) => { let hash = 2166136261; const text = String(value || ''); for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); } return ('00000000' + (hash >>> 0).toString(16)).slice(-8); };
const reviewLockKey = 'e936881a-fe32-4d94-aa1d-eaffcf4a75be:T099:PAYMENT_COLLECTION:' + String(meta.shopify_order_id || '') + ':T268:REVIEW:' + fnv(meta.latest_reply?.message_id || '');
const output = {
  ...meta,
  decision,
  confidence,
  summary:safeSummary,
  reason_codes:reasonCodes,
  risk_flags:riskFlags,
  evidence_quote:evidenceQuote,
  requires_human_review:requiresHumanReview,
  is_new_decision:isNewDecision,
  validation_error:validationError,
  review_email_subject:reviewSubject,
  review_email_html:reviewBody,
  dunning_note:dunningNote,
  review_lock_key:reviewLockKey
};
return [{json:output}];
