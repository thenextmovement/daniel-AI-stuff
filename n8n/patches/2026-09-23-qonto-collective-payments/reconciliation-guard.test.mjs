import test from 'node:test';import assert from 'node:assert/strict';import {collectiveReconciliationWait as check} from './reconciliation-guard.mjs';
const root='11111111-1111-4111-8111-111111111111',now=Date.parse('2026-09-23T10:05:00Z');
const ctx={_manualPaidReconcile:{jobId:'recon'},_proformaTransition:true,shopifyOrderId:'1',shopifyOrderName:'#NEONT5001',amountCents:10000};
const bank={id:root,currency:'EUR',payer:'Muster.GmbH',bookedAt:'2026-09-22T10:00:00Z',amountCents:30000};
const allocations=[{caseId:'case1',orderId:'1',orderName:'#NEONT5001',amountCents:10000},{caseId:'case2',orderId:'2',orderName:'#NEONT5002',amountCents:20000}];
const p={id:'pay1',billing_case_id:'case1',provider:'QONTO',provider_transaction_id:root+':allocation:1',amount_cents:10000,currency:'EUR',match_status:'MATCHED',booked_at:bank.bookedAt,evidence:{collectivePaymentId:root,collectiveRequest:{payment:bank,allocations}}};
const job={id:'job1',billing_case_id:'case1',idempotency_key:'billing:case1:invoice',job_type:'CREATE_INVOICE',status:'PENDING',created_at:'2026-09-23T10:00:00Z',payload:{documentNumber:'#NEONT5001',collectivePaymentId:root,collectiveRequiredShopifyPaymentIds:['pay1','pay2']}};
const response=()=>structuredClone({statusCode:200,body:[{id:'case1',shopify_order_id:'1',shopify_order_name:'#NEONT5001',total_gross_cents:10000,currency:'EUR',status:'INVOICE_PENDING',customer:{company:'Muster GmbH'},billing_payments:[p],billing_jobs:[job]}]});
test('known collective invoice creation waits without another Qonto allocation',()=>{const r=check(ctx,response(),now);assert.equal(r._collectiveWait,true);assert.equal(r._manualPaidOutcome,'BILLING_PAYMENTS_REGISTERED');});
test('legacy intake unchanged',()=>assert.equal(check({...ctx,_manualPaidReconcile:null},response(),now)._collectiveWait,false));
for(const [name,mutate] of [
 ['ordinary payment',c=>delete c.billing_payments[0].evidence.collectivePaymentId],
 ['amount changed',c=>c.total_gross_cents++],['cancelled',c=>c.cancelled_at='2026-09-23'],['refunded',c=>c.refunded_at='2026-09-23'],
 ['case mismatch',c=>c.billing_payments[0].billing_case_id='other'],['foreign payer',c=>c.customer.company='Andere GmbH'],
 ['wrong root',c=>c.billing_payments[0].evidence.collectiveRequest.payment.id='other'],
 ['wrong total',c=>c.billing_payments[0].evidence.collectiveRequest.payment.amountCents++],
 ['failed invoice',c=>c.billing_jobs[0].status='FAILED'],['old invoice',c=>c.billing_jobs[0].created_at='2026-09-22T10:00:00Z'],
 ['missing group member',c=>c.billing_jobs[0].payload.collectiveRequiredShopifyPaymentIds=['pay1']],
 ['unmatched',c=>c.billing_payments[0].match_status='PARTIAL'],['duplicate case payment',c=>c.billing_payments.push(c.billing_payments[0])]
])test(name+' does not bypass existing review',()=>{const r=response();mutate(r.body[0]);assert.equal(check(ctx,r,now)._collectiveWait,false);});
test('read failure cannot pretend collective proof',()=>assert.throws(()=>check(ctx,{statusCode:500,body:[]},now)));
test('known final-invoice payment projection waits',()=>{const r=response();r.body[0].status='INVOICED';r.body[0].billing_jobs=[{...job,job_type:'PROJECT_PAYMENT_EASYBILL',idempotency_key:'billing:case1:project-payment-easybill',payload:{documentId:'999',amountCents:10000}}];assert.equal(check({...ctx,_proformaTransition:false,easybillDocumentId:'999'},r,now)._collectiveWait,true);});
