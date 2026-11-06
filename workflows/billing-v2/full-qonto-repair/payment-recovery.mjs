// Only the two approved source-alignment cases; no general-purpose payment bypass.
export const REPAIR = '20261026-full-qonto-no-email';
export const CASES = [
  {caseId:'17ebf87b-f7c3-4ba3-9b14-bbf79f7b6588', jobId:'66cdafb5-f754-486c-a7de-0119a4c63c06', order:'#NEONT4692', shopifyId:'8513317896459', invoice:'3717331959', proforma:'3675733235', customer:'2680070576', amount:116382, paidAt:'2026-10-26T08:10:28.510Z', paymentId:'055b1062-e9fd-4d2a-9c97-147b3c5e1c54', qontoId:'01a17742-cb98-7b8f-af8e-9743ed3ad972'},
  {caseId:'4e0eeb3f-7411-4751-a7ad-f68df8dd6ad7', jobId:'79b533c8-5f40-4b32-8375-5e2ea836ae74', order:'#NEONT4796', shopifyId:'8618528702731', invoice:'3717333369', proforma:'3714029841', customer:'2704850490', amount:147900, paidAt:'2026-10-23T14:11:06Z', paymentId:'1af5d142-949b-49c4-a2e0-3cbce2fd0b4d', qontoId:'01a16919-e2ff-780e-b230-1496816dc599'}
];
export function fail(reason) { throw new Error('FULL_QONTO_REPAIR_'+reason); }
export function body(response) {
  if(response?.statusCode!==200 || response.body===null || typeof response.body!=='object') fail('READ_UNCONFIRMED');
  return response.body;
}
export function completeList(response) {
  const b=body(response);
  if(!Array.isArray(b.items)||Number(b.page)!==1||Number(b.pages)!==1||Number(b.total)!==b.items.length) fail('INCOMPLETE_HISTORY');
  return b.items;
}
export function scope(ctx) {
  const j=ctx?.job,p=j?.payload,c=ctx?.billingCase;
  const s=CASES.find(s=>s.caseId===c?.id && s.jobId===j?.id);
  if(!s||j.job_type!=='PROJECT_PAYMENT_EASYBILL'||p?.repairFullPayment!==REPAIR||p.customerEmailSuppressed!==true||
    p.markPaid||p.collectivePaymentId||p.collectiveAllocationId||p.manualPaidQontoProof||
    p.documentId!==s.invoice||p.proformaId!==s.proforma||p.paymentId!==s.paymentId||p.providerTransactionId!==s.qontoId||
    p.amountCents!==s.amount||p.paidAt!==s.paidAt||!Number.isInteger(j.attempt_count)||j.attempt_count<1||
    c.shopify_order_name!==s.order||c.total_gross_cents!==s.amount||c.currency!=='EUR'||c.status!=='INVOICED'||
    !['NOT_REQUIRED','VERIFIED'].includes(c.tax_review_status)||c.cancelled_at||c.refunded_at||!c.paid_at||
    String(ctx.originalInvoice?.easybill_document_id)!==s.invoice||ctx.originalInvoice.status!=='FINALIZED'||ctx.originalInvoice.sent_at!==null) fail('SCOPE');
  return s;
}
export function document(response,s,proforma=false) {
  const d=body(response);
  if(String(d.id)!==(proforma?s.proforma:s.invoice)||d.type!==(proforma?'PROFORMA_INVOICE':'INVOICE')||
    d.number!==(proforma?'PF-'+s.order.slice(1):s.order)||d.is_draft!==false||d.currency!=='EUR'||Number(d.amount)!==s.amount||
    String(d.customer_id)!==s.customer||!Number.isSafeInteger(d.paid_amount)||d.cancel_id||d.cancelled_at||(!proforma&&d.last_postbox_id!==null)) fail('DOCUMENT');
  return d;
}
export function marker(s) { return 'Qonto-ID '+s.qontoId+'; NEONTRIP no-email repair 20261026'; }
export function exactPayment(row,s) {
  if(!row?.id||String(row.document_id)!==s.invoice||Number(row.amount)!==s.amount||
    String(row.payment_at).slice(0,10)!==s.paidAt.slice(0,10)||row.type!=='BANK_TRANSFER'||
    row.provider!=='NEONTRIP Billing v2'||row.reference!==s.order||row.notice!==marker(s)||row.is_overdue_fee===true) fail('PAYMENT_RECEIPT');
  return row.id;
}
export function paidReceipt(invoiceResponse,paymentsResponse,s) {
  const d=document(invoiceResponse,s),rows=completeList(paymentsResponse);
  if(rows.length!==1||Number(d.paid_amount)!==s.amount||!d.paid_at) fail('PAYMENT_NOT_CONFIRMED');
  return exactPayment(rows[0],s);
}
export function decide(ctx,data) {
  const s=scope(ctx),d=document(data.invoice,s),pf=document(data.proforma,s,true);
  const rows=completeList(data.payments),pfRows=completeList(data.proformaPayments),hooks=completeList(data.hooks),ledger=body(data.ledger);
  if(hooks.some(h=>h.is_active!==false)) fail('ACTIVE_OR_UNKNOWN_WEBHOOK');
  if(pfRows.length||Number(pf.paid_amount)!==0||pf.paid_at) fail('PROFORMA_PAYMENT_CONFLICT');
  if(!Array.isArray(ledger)||ledger.length!==1) fail('LEDGER');
  const p=ledger[0];
  if(p.id!==s.paymentId||p.provider!=='QONTO'||p.provider_transaction_id!==s.qontoId||p.amount_cents!==s.amount||
    p.billing_case_id!==s.caseId||p.currency!=='EUR'||p.match_status!=='MATCHED'||Date.parse(p.booked_at)!==Date.parse(s.paidAt)||
    !['PENDING','FAILED'].includes(p.easybill_projection_status)) fail('LEDGER');
  const latest=p.billing_cases;
  const invoices=latest?.billing_documents?.filter(d=>d.document_type==='INVOICE');
  if(!invoices||invoices.length!==1) fail('CURRENT_CASE');
  scope({...ctx,billingCase:latest,originalInvoice:invoices[0]});
  if(rows.length) return {...ctx,alreadyDone:true,repairPaymentVerified:true,easybillPaymentId:paidReceipt(data.invoice,data.payments,s)};
  if(Number(d.paid_amount)!==0||d.paid_at) fail('PAYMENT_CONFLICT');
  const expires=Date.parse(ctx.job.payload.repairAdmissionValidUntil);
  if(!Number.isFinite(expires)||expires<=Date.now())fail('ADMISSION_EXPIRED');
  if(ctx.job.attempt_count!==1) fail('AMBIGUOUS_RETRY_NO_SECOND_POST');
  return {...ctx,alreadyDone:false};
}
export function confirm(ctx,postResponse,invoiceResponse,paymentsResponse) {
  const s=scope(ctx);
  if(postResponse?.statusCode!==201) fail('POST_UNCONFIRMED');
  const created=exactPayment(postResponse.body,s),verified=paidReceipt(invoiceResponse,paymentsResponse,s);
  if(String(created)!==String(verified)) fail('RECEIPT_CHANGED');
  return {...ctx,alreadyDone:false,repairPaymentVerified:true,easybillPaymentId:verified};
}
export const runtimeSource = [
  'const REPAIR='+JSON.stringify(REPAIR)+';const CASES='+JSON.stringify(CASES)+';',
  ...[fail,body,completeList,scope,document,marker,exactPayment,paidReceipt,decide,confirm].map(f=>f.toString())
].join('\n');
