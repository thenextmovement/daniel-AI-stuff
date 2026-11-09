import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=n=>readFileSync(new URL(n,import.meta.url),'utf8');
const run=(name,json,lookups={},state={})=>new Function('$json','$input','$','$getWorkflowStaticData','$env',read(name))(json,{first:()=>({json})},n=>({first:()=>lookups[n]?{json:lookups[n]}:undefined,all:()=>lookups[n]?[{json:lookups[n]}]:[]}),()=>state,{});
const order={id:123,name:'#NEONT9001',total_price:'878.22',total_outstanding:'878.22',currency:'EUR',financial_status:'pending',cancelled_at:null,billing_address:{company:'Example Project GmbH'}};
const tx={amountCents:87222,amount:872.22,neonNumber:'NEONT9001',transaction_id:'qonto-1',customer_name:'Example Project GmbH',customer_identity_candidates:['Example Project GmbH'],fuzzyMatch:false,raw_transaction:{status:'completed',side:'credit',currency:'EUR'},reference:'PF-NEONT9001'};
const candidates={data:{orders:{nodes:[],pageInfo:{hasNextPage:false}}}};
const resolve=(o=order,t=tx)=>run('qonto-validate-order.js',candidates,{'Shopify: Find Order':{orders:[o]},'Not Duplicate?':t})[0].json;
test('received EUR872.22 and EUR6 missing prompts production review without declaring fully paid',()=>{
 const r=resolve();assert.equal(r.reason,'confirmed_underpayment_small');assert.equal(r.receivedCents,87222);assert.equal(r.remainingCents,600);assert.equal(r.stop,true);assert.equal(r.sendEmail,true);assert.equal(r.emailRecipient,'support@neontrip.de');assert.match(r.emailBody,/872,22/);assert.match(r.emailBody,/6,00/);assert.match(r.emailBody,/admin.shopify.com/);assert.equal(r.shopifyNeedsUpdate,undefined);
});
test('EUR20 threshold inclusive, larger shortage remains explicit',()=>{assert.equal(resolve(order,{...tx,amountCents:85822}).reason,'confirmed_underpayment_small');assert.equal(resolve(order,{...tx,amountCents:85821}).reason,'confirmed_underpayment');});
test('full exact payment retains existing automatic match',()=>{const r=resolve(order,{...tx,amountCents:87822});assert.equal(r.stop,false);assert.equal(r.customerIdentityMatched,true);});
test('wrong identity, fuzzy reference, cancelled, paid, non-EUR or unsettled bank do not claim confirmed partial receipt',()=>{
 for(const [o,t] of [[{...order,billing_address:{company:'Other Customer'}},tx],[order,{...tx,fuzzyMatch:true}],[{...order,cancelled_at:'2026-10-21'},tx],[{...order,financial_status:'paid'},tx],[order,{...tx,raw_transaction:{...tx.raw_transaction,status:'pending'}}],[order,{...tx,raw_transaction:{...tx.raw_transaction,currency:'USD'}}]])assert.doesNotMatch(resolve(o,t).reason||'',/^confirmed_underpayment/);
});
test('remaining amount uses outstanding balance and HTML escapes payer/reference',()=>{
 const r=resolve({...order,financial_status:'partially_paid',total_outstanding:'100.00'},{...tx,amountCents:9400,reference:'<img src=x>'});
 assert.equal(r.remainingCents,600);assert.doesNotMatch(r.emailBody,/<img/);assert.match(r.emailBody,/&lt;img/);
});
test('void preparation failure retains claimed lease and original error',()=>{
 const r=run('void-failure.js',{error:{message:'easybill_proforma_id_missing'}},{'Claim Proforma Void Job':{body:{claimed:{job:{id:'job-1',lease_token:'lease-1'}}}}})[0].json;
 assert.equal(r.jobId,'job-1');assert.equal(r.leaseToken,'lease-1');assert.equal(r.success,false);assert.equal(r.error,'easybill_proforma_id_missing');
});
test('provider outage leaves jobs unclaimed, deduplicates warnings and recovers',()=>{
 const state={},config={'Billing Worker Config':{opsBaseUrl:'https://ops.neontrip.de',worker:'billing-worker'}};
 const check=j=>run('provider-gate.js',j,config,state)[0].json;
 assert.equal(check({statusCode:503,body:'offline'}).providerHealthy,false);
 assert.equal(check({statusCode:503,body:'offline'}).notifyProviderFailure,false);
 const ok=check({statusCode:200,body:{items:[],page:1,pages:0,total:0}});assert.equal(ok.providerHealthy,true);assert.equal(ok.worker,'billing-worker');
 const failed=check({error:{message:'timeout'}});assert.equal(failed.providerHealthy,false);assert.equal(failed.notifyProviderFailure,true);
 assert.equal(check({statusCode:200,body:'offline html'}).providerHealthy,false);
});


test('legacy fallback only admits a proven missing case after a masked API failure',()=>{
 const previous={billingFailureCode:'BILLING_PAYMENT_FAILED',billingFailureStatus:500,customerIdentityMatched:true,shopifyOrderId:'123',order:{id:123}};
 const check=r=>run('legacy-case-check.js',r,{'Validate Billing v2 Payment':previous})[0].json;
 assert.equal(check({statusCode:200,body:[]}).billingFailureCode,'BILLING_CASE_NOT_FOUND');
 for(const response of [{statusCode:500,body:[]},{statusCode:401,body:[]},{statusCode:200,body:[{id:'exists'}]},{statusCode:200,body:null},{error:{message:'timeout'}}])assert.notEqual(check(response).billingFailureCode,'BILLING_CASE_NOT_FOUND');
 const unrelated={...previous,billingFailureCode:'BILLING_PAYMENT_INVALID',billingFailureStatus:409};
 assert.equal(run('legacy-case-check.js',{statusCode:200,body:[]},{'Validate Billing v2 Payment':unrelated})[0].json.billingFailureCode,'BILLING_PAYMENT_INVALID');
});
test('OSS invoice preserves delivery tax country when corrected billing address is in Germany',()=>{
 const billingCase={shopify_order_name:'#NEONT9002',billing_address:{company:'Example Talent GmbH',country:'DE'},delivery_address:{country:'NL'},customer_email:'example@example.com',tax_treatment:'EU_B2C_OSS',totals:{originalVatRate:21},total_gross_cents:35700,subtotal_net_cents:29504,vat_cents:6196,line_items:[{title:'Repair',quantity:1,unitPriceGross:357,lineGross:357}],currency:'EUR',payment_method:'VORKASSE'};
 const input={claimed:{job:{job_type:'CREATE_INVOICE',idempotency_key:'test',payload:{documentNumber:'#NEONT9002'}},billingCase}};
 const result=run('prepare-easybill-command.js',input)[0].json;
 assert.equal(result.customerPayload.country,'DE');assert.equal(result.documentPayload.vat_country,'NL');assert.equal(result.documentPayload.items[0].vat_percent,21);
 const domestic=run('prepare-easybill-command.js',{claimed:{...input.claimed,billingCase:{...billingCase,tax_treatment:'DE_STANDARD',totals:{originalVatRate:19}}}})[0].json;
 assert.equal(domestic.documentPayload.vat_country,'DE');
});

test('wrapped API error is classified then consumed by the legacy invoice guard',()=>{
 const previous={billingFailureCode:'',billingFailureStatus:0,customerIdentityMatched:true,shopifyOrderId:'123',order:{id:123},neonNumber:'NEONT123'};
 const classified=run('legacy-case-check.js',{statusCode:200,body:[]},{'Validate Billing v2 Payment':previous})[0].json;
 assert.equal(classified.billingFailureCode,'BILLING_CASE_NOT_FOUND');
 const rejected=run('legacy-prepare-existing-invoice.js',{items:[]},{'Legacy: Classify Missing Case':classified,'Validate Billing v2 Payment':previous})[0].json;
 assert.equal(rejected.reason,'LEGACY_EASYBILL_INVOICE_NOT_UNIQUE');
 assert.equal(rejected.legacyCaseSafe,false);
 const badIdentity=run('legacy-case-check.js',{statusCode:200,body:[]},{'Validate Billing v2 Payment':{...previous,customerIdentityMatched:false}})[0].json;
 assert.notEqual(badIdentity.billingFailureCode,'BILLING_CASE_NOT_FOUND');
});
