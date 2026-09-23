export function collectiveReconciliationWait(ctx,response,now=Date.now()){
 const keep={...ctx,_collectiveWait:false};
 if(!ctx._manualPaidReconcile)return keep;
 if(Number(response.statusCode)!==200||!Array.isArray(response.body))throw new Error('COLLECTIVE_RECONCILIATION_READ_FAILED');
 const rows=response.body;if(rows.length!==1)return keep;
 const c=rows[0],ps=c.billing_payments,js=c.billing_jobs;
 const norm=v=>String(v??'').toLowerCase().replace(/[^a-z0-9]/g,'');
 if(!Array.isArray(ps)||!Array.isArray(js)||ps.length!==1)return keep;
 const p=ps[0],e=p.evidence||{},r=e.collectivePaymentId,request=e.collectiveRequest||{},bank=request.payment||{},as=request.allocations;
 if(!/^[a-f0-9-]{36}$/.test(String(r))||p.provider!=='QONTO'||p.match_status!=='MATCHED'||p.currency!=='EUR'||p.billing_case_id!==c.id||
 String(c.shopify_order_id).replace('gid://shopify/Order/','')!==ctx.shopifyOrderId||c.shopify_order_name!==ctx.shopifyOrderName||
 c.currency!=='EUR'||Number(c.total_gross_cents)!==ctx.amountCents||Number(p.amount_cents)!==ctx.amountCents||
 !['INVOICE_PENDING','INVOICED'].includes(c.status)||c.cancelled_at||c.refunded_at||c.tax_review_status==='REVIEW_REQUIRED'||
 bank.id!==r||bank.currency!=='EUR'||norm(bank.payer)!==norm(c.customer?.company||c.customer?.name)||
 Date.parse(bank.bookedAt)!==Date.parse(p.booked_at)||!Array.isArray(as)||as.length<2||as.length>10||
 as.some(a=>!Number.isSafeInteger(a.amountCents)||a.amountCents<=0)||new Set(as.map(a=>a.orderId)).size!==as.length||
 as.reduce((sum,a)=>sum+a.amountCents,0)!==bank.amountCents||
 as.filter(a=>a.caseId===c.id&&a.orderId===ctx.shopifyOrderId&&a.orderName===ctx.shopifyOrderName&&a.amountCents===ctx.amountCents).length!==1||
 p.provider_transaction_id!==r+':allocation:'+ctx.shopifyOrderId)return keep;
 const type=ctx._proformaTransition?'CREATE_INVOICE':'PROJECT_PAYMENT_EASYBILL';
 const jobs=js.filter(j=>j.job_type===type);
 if(jobs.length!==1)return keep;
 const j=jobs[0],age=now-Date.parse(j.created_at);
 if(j.billing_case_id!==c.id||!['PENDING','PROCESSING','DONE'].includes(j.status)||!Number.isFinite(age)||age<0||age>30*60*1000)return keep;
 if(type==='CREATE_INVOICE'){
  const ids=j.payload?.collectiveRequiredShopifyPaymentIds;
  if(j.idempotency_key!=='billing:'+c.id+':invoice'||j.payload.documentNumber!==ctx.shopifyOrderName||j.payload.collectivePaymentId!==r||
   !Array.isArray(ids)||ids.length!==as.length||new Set(ids).size!==ids.length||!ids.includes(p.id))return keep;
 }else if(j.idempotency_key!=='billing:'+c.id+':project-payment-easybill'||String(j.payload?.documentId)!==String(ctx.easybillDocumentId)||Number(j.payload?.amountCents)!==ctx.amountCents)return keep;
 return {...ctx,_collectiveWait:true,_manualPaidOutcome:'BILLING_PAYMENTS_REGISTERED',reasonCode:'COLLECTIVE_PAYMENT_PROJECTION_IN_PROGRESS',
 _manualPaidProof:{collectivePaymentId:r,paymentIds:[p.id],amountCents:ctx.amountCents,currency:'EUR',projectionJobId:j.id,projectionJobType:type,projectionJobStatus:j.status}};
}
