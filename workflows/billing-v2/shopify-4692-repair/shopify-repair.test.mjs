import test from 'node:test';
import assert from 'node:assert/strict';
import {decide, confirm, completion} from './shopify-repair.mjs';
const now=Date.parse('2026-10-26T22:00:00Z');
function ctx(){return {job:{id:'c4ebb761-c3d9-47d0-afbe-49c4533a007d',job_type:'PROJECT_PAYMENT_SHOPIFY',attempt_count:1,lease_token:'lease',payload:{repairShopifyPaid:'20261026-4692',repairShopifyPaidCheckedAt:'2026-10-26T21:59:00Z',repairShopifyPaidExpiresAt:'2026-10-26T22:04:00Z',paymentId:'055b1062-e9fd-4d2a-9c97-147b3c5e1c54',amountCents:116382,skontoCents:0,settlementType:'FULL',customerEmailSuppressed:true}},billingCase:{id:'17ebf87b-f7c3-4ba3-9b14-bbf79f7b6588',shopify_order_id:'8513317896459',shopify_order_name:'#NEONT4692',status:'INVOICED',currency:'EUR',total_gross_cents:116382,paid_at:'2026-10-26T08:10:28.51Z',tax_review_status:'NOT_REQUIRED',cancelled_at:null,refunded_at:null},originalInvoice:{easybill_document_id:'3717331959',status:'FINALIZED',sent_at:null}};}
const money=n=>({shopMoney:{amount:(n/100).toFixed(2),currencyCode:'EUR'}});
function order(paid=false){return {id:'gid://shopify/Order/8513317896459',name:'#NEONT4692',app:{id:'gid://shopify/App/290803777537'},displayFinancialStatus:paid?'PAID':'PENDING',canMarkAsPaid:!paid,cancelledAt:null,totalPriceSet:money(116382),currentTotalPriceSet:money(116382),totalOutstandingSet:money(paid?0:116382),paymentGatewayNames:paid?['manual']:[],transactions:paid?[{id:'gid://shopify/OrderTransaction/999',kind:'SALE',status:'SUCCESS',gateway:'manual',manualPaymentGateway:true,amountSet:money(116382),createdAt:'2026-10-26T21:59:30Z'}]:[]};}
const read=o=>({statusCode:200,body:{data:{order:o}}});
const post=o=>({statusCode:200,body:{data:{orderMarkAsPaid:{order:o,userErrors:[]}}}});
test('first exact pending order can use existing mutation',()=>assert.equal(decide(ctx(),read(order()),now).alreadyDone,false));
test('verified paid receipt can be reused after expiry without another mutation',()=>{const c=ctx();c.job.attempt_count=2;const result=decide(c,read(order(true)),now+600000);assert.equal(result.alreadyDone,true);assert.equal(result.repairShopifyPaidVerified,true);assert.equal(completion(c,result).result.shopifyTransactionId,'gid://shopify/OrderTransaction/999');});
for(const [name,change] of [
 ['wrong job',c=>c.job.id='other'],['wrong case',c=>c.billingCase.id='other'],['wrong payment',c=>c.job.payload.paymentId='other'],['wrong amount',c=>c.job.payload.amountCents=116381],['discount',c=>c.job.payload.skontoCents=1],['wrong order',c=>c.billingCase.shopify_order_id='123'],['email permission missing',c=>c.job.payload.customerEmailSuppressed=false],['other repair',c=>c.job.payload.repairFullPayment='x'],['review hold retained',c=>c.job.payload.reviewHold='hold'],['wrong final invoice',c=>c.originalInvoice.easybill_document_id='123'],['cancelled case',c=>c.billingCase.cancelled_at='2026-10-26'],['unpaid case',c=>c.billingCase.paid_at=null],['unclaimed attempt',c=>c.job.attempt_count=0],['future proof',c=>c.job.payload.repairShopifyPaidCheckedAt='2026-10-27T00:00:00Z'],['extended admission',c=>c.job.payload.repairShopifyPaidExpiresAt='2026-10-27T00:00:00Z']
])test(name,()=>{const c=ctx();change(c);assert.throws(()=>decide(c,read(order()),now));});
for(const [name,change] of [
 ['wrong response order',o=>o.id='gid://shopify/Order/123'],['wrong name',o=>o.name='#NEONT1'],['wrong app',o=>o.app.id='gid://shopify/App/123'],['currency',o=>o.totalPriceSet.shopMoney.currencyCode='USD'],['changed price',o=>o.currentTotalPriceSet=money(1)],['partial payment',o=>o.totalOutstandingSet=money(1)],['cancelled order',o=>o.cancelledAt='2026-10-26'],['gateway conflict',o=>o.paymentGatewayNames=['card']],['authorization present',o=>o.transactions=[{kind:'AUTHORIZATION'}]],['cannot mark paid',o=>o.canMarkAsPaid=false]
])test(name,()=>{const o=order();change(o);assert.throws(()=>decide(ctx(),read(o),now));});
test('expired first attempt fails',()=>assert.throws(()=>decide(ctx(),read(order()),now+600000),/EXPIRED/));
test('pending retry cannot POST',()=>{const c=ctx();c.job.attempt_count=2;assert.throws(()=>decide(c,read(order()),now),/SECOND_POST/);});
test('transport error rejected',()=>assert.throws(()=>decide(ctx(),{statusCode:502,body:{}},now),/READ/));
test('GraphQL errors rejected',()=>{const r=read(order());r.body.errors=[{message:'partial'}];assert.throws(()=>decide(ctx(),r,now));});
test('mutation and independent final read both required',()=>assert.equal(confirm(ctx(),post(order(true)),read(order(true)),now).repairShopifyPaidVerified,true));
test('mutation business errors rejected',()=>{const r=post(order(true));r.body.data.orderMarkAsPaid.userErrors=[{message:'no'}];assert.throws(()=>confirm(ctx(),r,read(order(true)),now));});
test('mutation 502 cannot become DONE even after paid read',()=>assert.throws(()=>confirm(ctx(),{statusCode:502},read(order(true)),now)));
test('pending final state rejected',()=>assert.throws(()=>confirm(ctx(),post(order(true)),read(order()),now)));
for(const [name,change] of [
 ['old unrelated receipt',o=>o.transactions[0].createdAt='2026-10-25T00:00:00Z'],['duplicate receipt',o=>o.transactions.push({...o.transactions[0]})],['nonmanual receipt',o=>o.transactions[0].manualPaymentGateway=false],['failed receipt',o=>o.transactions[0].status='FAILURE'],['receipt wrong amount',o=>o.transactions[0].amountSet=money(1)],['capture instead of sale',o=>o.transactions[0].kind='CAPTURE']
])test(name,()=>{const o=order(true);change(o);assert.throws(()=>decide(ctx(),read(o),now));});
test('unverified success cannot complete',()=>assert.throws(()=>completion(ctx(),{}),/UNVERIFIED/));

import {readFileSync} from 'node:fs';
import {patchWorkflow} from './patch-workflow.mjs';
const baseline=JSON.parse(readFileSync(new URL('./affected-nodes.fixture.json',import.meta.url),'utf8'));
const patched=patchWorkflow(baseline).workflow;
function runCode(w,name,c,input,postResponse){
 const code=w.nodes.find(n=>n.name===name).parameters.jsCode;
 const $=name=>({first:()=>({json:name==='Normalize Projection Job'?c:postResponse})});
 const FixedDate=class extends Date{static now(){return now;}};
 return new Function('$','$json','Date',code)($,input,FixedDate);
}
test('actual generated code completes independent final read and reuses paid read',()=>{
 const c=ctx(),d=runCode(patched,'Decide Shopify Payment',c,read(order()));assert.equal(d[0].json.alreadyDone,false);
 const done=runCode(patched,'Prepare Projection Success',c,read(order(true)),post(order(true)));
 assert.equal(done[0].json.success,true);assert.equal(done[0].json.result.shopifyTransactionId,'gid://shopify/OrderTransaction/999');
 const reused=runCode(patched,'Decide Shopify Payment',c,read(order(true)))[0].json;
 assert.equal(runCode(patched,'Prepare Projection Success',c,reused)[0].json.result.reused,true);
});
test('ordinary and collective decisions preserve their original outputs',()=>{
 for(const collective of [false,true]){
  const c=ctx();c.job.id='other';delete c.job.payload.repairShopifyPaid;if(collective)c.job.payload.collectivePaymentId='collective';
  for(const paid of [false,true])assert.deepEqual(runCode(patched,'Decide Shopify Payment',c,read(order(paid))),runCode(baseline,'Decide Shopify Payment',c,read(order(paid))));
 }
});
test('ordinary success and collective success preserve their original outputs',()=>{
 for(const collective of [false,true]){
  const c=ctx();c.job.id='other';delete c.job.payload.repairShopifyPaid;if(collective)c.job.payload.collectivePaymentId='collective';
  assert.deepEqual(runCode(patched,'Prepare Projection Success',c,post(order(true))),runCode(baseline,'Prepare Projection Success',c,post(order(true))));
 }
});
test('exact held job without marker fails closed',()=>{
 const c=ctx();delete c.job.payload.repairShopifyPaid;assert.throws(()=>runCode(patched,'Decide Shopify Payment',c,read(order())),/SCOPE/);
});

test('Shopify receipt timestamps have whole-second precision',()=>{const c=ctx();c.job.payload.repairShopifyPaidCheckedAt='2026-10-26T21:59:30.500Z';c.job.payload.repairShopifyPaidExpiresAt='2026-10-26T22:04:30.500Z';assert.equal(decide(c,read(order(true)),now).alreadyDone,true);});
