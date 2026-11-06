export const REPAIR = '20261026-4692';
const ID = {job:'c4ebb761-c3d9-47d0-afbe-49c4533a007d',case:'17ebf87b-f7c3-4ba3-9b14-bbf79f7b6588',payment:'055b1062-e9fd-4d2a-9c97-147b3c5e1c54',order:'gid://shopify/Order/8513317896459',app:'gid://shopify/App/290803777537',invoice:'3717331959'};
function fail(reason){throw new Error('SHOPIFY_4692_REPAIR_'+reason);}
function scope(ctx){
 const j=ctx?.job,p=j?.payload,c=ctx?.billingCase,d=ctx?.originalInvoice;
 if(j?.id!==ID.job||j.job_type!=='PROJECT_PAYMENT_SHOPIFY'||!j.lease_token||!Number.isInteger(j.attempt_count)||j.attempt_count<1||
 p?.repairShopifyPaid!==REPAIR||p.paymentId!==ID.payment||p.amountCents!==116382||p.skontoCents!==0||p.settlementType!=='FULL'||p.customerEmailSuppressed!==true||
 p.reviewHold||p.collectivePaymentId||p.manualPaidQontoProof||p.repairFullPayment||
 c?.id!==ID.case||String(c.shopify_order_id).replace('gid://shopify/Order/','')!=='8513317896459'||c.shopify_order_name!=='#NEONT4692'||
 c.status!=='INVOICED'||c.currency!=='EUR'||c.total_gross_cents!==116382||!c.paid_at||c.cancelled_at||c.refunded_at||!['NOT_REQUIRED','VERIFIED'].includes(c.tax_review_status)||
 String(d?.easybill_document_id)!==ID.invoice||d.status!=='FINALIZED'||d.sent_at!==null)fail('SCOPE');
 const checked=Date.parse(p.repairShopifyPaidCheckedAt),expires=Date.parse(p.repairShopifyPaidExpiresAt);
 if(!Number.isFinite(checked)||!Number.isFinite(expires)||expires-checked!==300000)fail('ADMISSION');
 return {checked,expires};
}
function body(response){
 if(response?.statusCode!==200||!response.body||typeof response.body!=='object'||response.body.errors?.length)fail('READ_UNCONFIRMED');
 return response.body;
}
function cents(m){
 if(m?.currencyCode!=='EUR'||!/^\d+(?:\.\d{1,2})?$/.test(String(m.amount)))fail('MONEY');
 return Math.round(Number(m.amount)*100);
}
function snapshot(o,full=true){
 if(!o||o.id!==ID.order||o.cancelledAt||cents(o.totalPriceSet?.shopMoney)!==116382||cents(o.currentTotalPriceSet?.shopMoney)!==116382)fail('ORDER_SNAPSHOT');
 if(full&&(o.name!=='#NEONT4692'||o.app?.id!==ID.app||!Array.isArray(o.transactions)||!Array.isArray(o.paymentGatewayNames)))fail('ORDER_IDENTITY');
 return cents(o.totalOutstandingSet?.shopMoney);
}
function paid(o,admission,now){
 if(snapshot(o)!==0||o.displayFinancialStatus!=='PAID'||o.transactions.length!==1||o.paymentGatewayNames.length!==1||o.paymentGatewayNames[0]!=='manual')fail('PAID_UNCONFIRMED');
 const t=o.transactions[0],created=Date.parse(t.createdAt);
 if(!/^gid:\/\/shopify\/OrderTransaction\/\d+$/.test(t.id??'')||t.kind!=='SALE'||t.status!=='SUCCESS'||t.gateway!=='manual'||t.manualPaymentGateway!==true||
 cents(t.amountSet?.shopMoney)!==116382||!Number.isFinite(created)||created<Math.floor(admission.checked/1000)*1000||created>now)fail('RECEIPT');
 return t.id;
}
export function decide(ctx,response,now=Date.now()){
 const admission=scope(ctx);
 if(admission.checked>now)fail('FUTURE_PROOF');
 const o=body(response).data?.order,outstanding=snapshot(o);
 if(o.displayFinancialStatus==='PAID')return {...ctx,alreadyDone:true,repairShopifyPaidVerified:true,shopifyTransactionId:paid(o,admission,now)};
 if(o.displayFinancialStatus!=='PENDING'||outstanding!==116382||o.canMarkAsPaid!==true||o.transactions.length!==0||o.paymentGatewayNames.length!==0)fail('PENDING_SNAPSHOT');
 if(admission.expires<=now)fail('ADMISSION_EXPIRED');
 if(ctx.job.attempt_count!==1)fail('AMBIGUOUS_RETRY_NO_SECOND_POST');
 return {...ctx,alreadyDone:false};
}
export function confirm(ctx,mutationResponse,readResponse,now=Date.now()){
 const admission=scope(ctx),mutation=body(mutationResponse).data?.orderMarkAsPaid;
 if(!mutation||!Array.isArray(mutation.userErrors)||mutation.userErrors.length||snapshot(mutation.order,false)!==0||mutation.order.displayFinancialStatus!=='PAID')fail('MUTATION_UNCONFIRMED');
 return {...ctx,alreadyDone:false,repairShopifyPaidVerified:true,shopifyTransactionId:paid(body(readResponse).data?.order,admission,now)};
}
export function completion(ctx,verified){
 scope(ctx);
 if(verified.repairShopifyPaidVerified!==true||!/^gid:\/\/shopify\/OrderTransaction\/\d+$/.test(verified.shopifyTransactionId??''))fail('UNVERIFIED_COMPLETION');
 return {jobId:ctx.job.id,leaseToken:ctx.job.lease_token,success:true,result:{worker:'n8n-payment-projection-v2',projection:ctx.job.job_type,
 repairShopifyPaid:REPAIR,paymentId:ID.payment,shopifyOrderId:ID.order,shopifyTransactionId:verified.shopifyTransactionId,amountCents:116382,reused:verified.alreadyDone===true,
 customerEmailRequested:false}};
}
