const fail=reason=>{throw new Error('COLLECTIVE_PAYMENT_'+reason);};
const norm=v=>String(v??'').toLowerCase().replace(/[^a-z0-9]/g,'');
const numericId=v=>String(v??'').replace(/^gid:\/\/shopify\/Order\//,'');
const money=m=>{if(!m||m.currencyCode!=='EUR'||!/^\d+(?:\.\d{1,2})?$/.test(String(m.amount)))fail('MONEY');return Math.round(Number(m.amount)*100);};
export function references(text){return [...new Set([...String(text??'').toUpperCase().matchAll(/(?:^|[^A-Z0-9])R?NEON[-_\s]*T?\s*#?\s*(\d{4})(?![A-Z0-9])/g)].map(m=>'NEONT'+m[1]))].sort();}
export function verifyBank(raw,expected){
 const tx=raw.transaction||raw, refs=references(tx.reference);
 if(!/^[a-f0-9-]{36}$/.test(String(tx.id))||tx.id!==expected.transaction_id||tx.status!=='completed'||tx.side!=='credit'||tx.currency!=='EUR')fail('BANK_IDENTITY');
 const amount=Number(tx.amount_cents);
 if(!Number.isSafeInteger(amount)||amount<=0||amount!==Math.round(Number(tx.amount)*100)||amount!==Number(expected.amountCents)||String(tx.reference)!==expected.reference)fail('BANK_AMOUNT');
 if(refs.length<2||refs.length>10||!Number.isFinite(Date.parse(tx.settled_at)))fail('BANK_REFERENCES');
 const payer=String(tx.counterparty_name||tx.label||'').trim();if(norm(payer).length<4)fail('PAYER');
 return {payment:{id:tx.id,transactionId:String(tx.transaction_id||tx.id),amountCents:amount,currency:'EUR',bookedAt:tx.settled_at,reference:tx.reference,payer},references:refs};
}
export function planGroup(bank,graph,cases){
 const conn=graph.data?.orders;if(graph.errors?.length||!conn||conn.pageInfo?.hasNextPage!==false||!Array.isArray(conn.nodes)||!Array.isArray(cases))fail('SEARCH_INCOMPLETE');
 const allocations=[],documents=[];
 for(const ref of bank.references){
  const matches=conn.nodes.filter(o=>o.name==='#'+ref);if(matches.length!==1)fail('ORDER_NOT_UNIQUE');
  const o=matches[0], id=numericId(o.legacyResourceId||o.id);
  const matchesC=cases.filter(c=>numericId(c.shopify_order_id)===id&&c.shopify_order_name===o.name);if(matchesC.length!==1)fail('CASE_NOT_UNIQUE');
  const c=matchesC[0],amt=money(o.currentTotalPriceSet?.shopMoney);
  if(o.cancelledAt||o.displayFinancialStatus!=='PENDING'||amt<=0||amt!==money(o.totalPriceSet?.shopMoney)||amt!==money(o.totalOutstandingSet?.shopMoney))fail('ORDER_STATE');
  const identity=o.billingAddress?.company||[o.billingAddress?.firstName,o.billingAddress?.lastName].filter(Boolean).join(' ');
  const cIdentity=c.customer?.company||c.customer?.name;
  if(norm(identity)!==norm(bank.payment.payer)||norm(cIdentity)!==norm(bank.payment.payer))fail('CUSTOMER');
  if(c.currency!=='EUR'||Number(c.total_gross_cents)!==amt||!['PAYMENT_PENDING','INVOICED'].includes(c.status)||c.tax_review_status==='REVIEW_REQUIRED'||c.paid_at||c.cancelled_at||c.refunded_at||!Array.isArray(c.billing_payments)||c.billing_payments.length)fail('CASE_STATE');
  if(Date.parse(bank.payment.bookedAt)<Date.parse(o.createdAt))fail('PAYMENT_BEFORE_ORDER');
  const type=c.final_invoice_at?'INVOICE':'PROFORMA';
  const docs=(c.billing_documents||[]).filter(d=>d.document_type===type&&['FINALIZED','SENT'].includes(d.status)&&(type==='INVOICE'||d.revision===c.current_revision));
  if(docs.length!==1||Number(docs[0].amount_cents)!==amt||docs[0].currency!=='EUR'||!/^\d+$/.test(docs[0].easybill_document_id))fail('DOCUMENT_BINDING');
  allocations.push({caseId:c.id,orderId:id,orderName:o.name,amountCents:amt,lockVersion:c.lock_version,company:String(cIdentity)});
  documents.push({id:String(docs[0].easybill_document_id),number:docs[0].document_number,type:type==='INVOICE'?'INVOICE':'PROFORMA_INVOICE',orderName:o.name,amountCents:amt});
 }
 if(allocations.reduce((s,a)=>s+a.amountCents,0)!==bank.payment.amountCents||new Set(allocations.map(a=>a.orderId)).size!==bank.references.length||cases.length!==bank.references.length)fail('TOTAL_OR_EXTRA_CASE');
 return {payment:bank.payment,allocations:allocations.sort((a,b)=>a.orderId.localeCompare(b.orderId)),documents};
}
export function verifyDocuments(plan,docs){
 if(docs.length!==plan.documents.length)fail('EASYBILL_COUNT');
 for(const d of plan.documents){
  const found=docs.filter(x=>String(x.id)===d.id);if(found.length!==1)fail('EASYBILL_NOT_UNIQUE');
  const x=found[0];if(x.number!==d.number||x.type!==d.type||x.order_number!==d.orderName||Number(x.amount)!==d.amountCents||x.currency!=='EUR'||Number(x.paid_amount)!==0||x.paid_at||x.cancel_id||x.is_draft!==false||norm(x.address?.company_name||[x.address?.first_name,x.address?.last_name].filter(Boolean).join(' '))!==norm(plan.payment.payer))fail('EASYBILL_STATE');
 }
 return {payment:plan.payment,allocations:plan.allocations};
}
export function shopifyDecision(ctx,body){
 const o=body.data?.order,id='gid://shopify/Order/'+numericId(ctx.billingCase.shopify_order_id), expected=Number(ctx.job.payload.amountCents);
 if(body.errors?.length||!o||o.id!==id||o.name!==ctx.billingCase.shopify_order_name||o.cancelledAt||expected!==Number(ctx.billingCase.total_gross_cents)||money(o.currentTotalPriceSet?.shopMoney)!==expected||money(o.totalPriceSet?.shopMoney)!==expected)fail('SHOPIFY_SNAPSHOT');
 const outstanding=money(o.totalOutstandingSet?.shopMoney);
 if(o.displayFinancialStatus==='PAID'&&outstanding===0)return {...ctx,alreadyDone:true,collectiveVerifiedPaid:true};
 if(o.displayFinancialStatus!=='PENDING'||outstanding!==expected||o.canMarkAsPaid!==true)fail('SHOPIFY_OUTSTANDING');
 return {...ctx,alreadyDone:false};
}
export function easybillDecision(ctx,doc,list){
 const p=ctx.job.payload, marker='Qonto allocation '+p.collectiveAllocationId;
 if(String(doc.id)!==String(p.documentId)||doc.type!=='INVOICE'||doc.number!==ctx.billingCase.shopify_order_name||doc.cancel_id||doc.is_draft!==false||doc.currency!=='EUR'||Number(doc.amount)!==Number(p.amountCents))fail('EASYBILL_INVOICE');
 if(!Array.isArray(list.items)||Number(list.page)!==1||Number(list.pages)>1||Number(list.total)!==list.items.length)fail('EASYBILL_PAYMENT_HISTORY');
 if(list.items.some(x=>String(x.document_id)!==String(p.documentId)))fail('EASYBILL_HISTORY_FILTER');
 const own=list.items.filter(x=>x.notice===marker);
 if(own.length===1&&Number(own[0].amount)===Number(p.amountCents)&&String(own[0].payment_at).slice(0,10)===String(p.paidAt).slice(0,10)&&Number(doc.paid_amount)===Number(doc.amount)&&doc.paid_at)return {...ctx,alreadyDone:true,collectiveVerifiedPaid:true,easybillPaymentId:own[0].id};
 if(own.length||Number(doc.paid_amount)!==0||doc.paid_at||list.items.length)fail('EASYBILL_PAYMENT_CONFLICT');
 if(Number(ctx.job.attempt_count||1)>1)fail('EASYBILL_AMBIGUOUS_RETRY');
 return {...ctx,alreadyDone:false};
}
export function projectionSuccess(ctx,body){
 const p=ctx.job.payload;
 if(body.collectiveVerifiedPaid===true&&body.alreadyDone===true)return {jobId:ctx.job.id,leaseToken:ctx.job.lease_token,success:true,result:{worker:'n8n-payment-projection-v2',collectivePaymentId:p.collectivePaymentId,reused:true}};
 if(ctx.job.job_type==='PROJECT_PAYMENT_SHOPIFY'){
  const result=body.data?.orderMarkAsPaid;
  if(body.errors?.length||!result||result.userErrors?.length||result.order?.id!=='gid://shopify/Order/'+numericId(ctx.billingCase.shopify_order_id)||result.order.displayFinancialStatus!=='PAID'||result.order.cancelledAt||money(result.order.currentTotalPriceSet?.shopMoney)!==Number(p.amountCents)||money(result.order.totalPriceSet?.shopMoney)!==Number(p.amountCents)||money(result.order.totalOutstandingSet?.shopMoney)!==0)fail('SHOPIFY_MUTATION_UNCONFIRMED');
 } else {
  if(!body.id||String(body.document_id)!==String(p.documentId)||Number(body.amount)!==Number(p.amountCents)||body.notice!=='Qonto allocation '+p.collectiveAllocationId)fail('EASYBILL_MUTATION_UNCONFIRMED');
 }
 return {jobId:ctx.job.id,leaseToken:ctx.job.lease_token,success:true,result:{worker:'n8n-payment-projection-v2',projection:ctx.job.job_type,collectivePaymentId:p.collectivePaymentId}};
}
