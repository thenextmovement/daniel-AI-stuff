import test from 'node:test';
import assert from 'node:assert/strict';
import * as mod from './payment-recovery.mjs';
const ctx=()=>({job:{id:'66cdafb5-f754-486c-a7de-0119a4c63c06',job_type:'PROJECT_PAYMENT_EASYBILL',attempt_count:1,payload:{repairFullPayment:'20261026-full-qonto-no-email',repairAdmissionValidUntil:new Date(Date.now()+300000).toISOString(),customerEmailSuppressed:true,documentId:'3717331959',proformaId:'3675733235',amountCents:116382,paidAt:'2026-10-26T08:10:28.510Z',paymentId:'055b1062-e9fd-4d2a-9c97-147b3c5e1c54',providerTransactionId:'01a17742-cb98-7b8f-af8e-9743ed3ad972'}},billingCase:{id:'17ebf87b-f7c3-4ba3-9b14-bbf79f7b6588',shopify_order_name:'#NEONT4692',total_gross_cents:116382,currency:'EUR',status:'INVOICED',paid_at:'2026-10-26T08:10:28.510Z',tax_review_status:'NOT_REQUIRED',cancelled_at:null,refunded_at:null},originalInvoice:{easybill_document_id:'3717331959',status:'FINALIZED',sent_at:null}});
const response=body=>({statusCode:200,body});
const data=()=>({invoice:response({id:3717331959,number:'#NEONT4692',type:'INVOICE',is_draft:false,currency:'EUR',amount:116382,paid_amount:0,paid_at:null,customer_id:2680070576,last_postbox_id:null}),payments:response({page:1,pages:1,total:0,items:[]}),proforma:response({id:3675733235,number:'PF-NEONT4692',type:'PROFORMA_INVOICE',is_draft:false,currency:'EUR',amount:116382,paid_amount:0,paid_at:null,customer_id:2680070576}),proformaPayments:response({page:1,pages:1,total:0,items:[]}),hooks:response({page:1,pages:1,total:1,items:[{id:22631,is_active:false,events:['document.create']}]}),ledger:response([{billing_case_id:ctx().billingCase.id,billing_cases:{...ctx().billingCase,billing_documents:[{...ctx().originalInvoice,document_type:'INVOICE'}]},id:'055b1062-e9fd-4d2a-9c97-147b3c5e1c54',provider:'QONTO',provider_transaction_id:'01a17742-cb98-7b8f-af8e-9743ed3ad972',amount_cents:116382,currency:'EUR',match_status:'MATCHED',booked_at:'2026-10-26T08:10:28.510Z',easybill_projection_status:'PENDING'}])});
const payment=()=>({id:987654,document_id:3717331959,amount:116382,payment_at:'2026-10-26',type:'BANK_TRANSFER',provider:'NEONTRIP Billing v2',reference:'#NEONT4692',notice:'Qonto-ID 01a17742-cb98-7b8f-af8e-9743ed3ad972; NEONTRIP no-email repair 20261026',is_overdue_fee:false});
const paid=()=>{const d=data();d.invoice.body.paid_amount=116382;d.invoice.body.paid_at='2026-10-26';d.payments.body={page:1,pages:1,total:1,items:[payment()]};return d;};
test('first verified full bank payment can be posted',()=>assert.equal(mod.decide(ctx(),data()).alreadyDone,false));
test('exact existing provider payment is reused without another POST',()=>assert.equal(mod.decide(ctx(),paid()).alreadyDone,true));
for(const [label,change] of [
 ['different case',(c,d)=>c.billingCase.id='unrelated'],
 ['second attempt with empty history',(c,d)=>c.job.attempt_count=2],
 ['missing attempt',(c,d)=>delete c.job.attempt_count],
 ['active mail-capable webhook',(c,d)=>d.hooks.body.items[0].is_active=true],
 ['unknown webhook state',(c,d)=>delete d.hooks.body.items[0].is_active],
 ['incomplete history',(c,d)=>d.payments.body.pages=2],
 ['non-200 read',(c,d)=>d.invoice.statusCode=502],
 ['missing mail suppression',(c,d)=>delete c.job.payload.customerEmailSuppressed],
 ['collective proof confusion',(c,d)=>c.job.payload.collectivePaymentId='x'],
 ['paid proforma',(c,d)=>d.proforma.body.paid_amount=116382],
 ['unknown invoice paid amount',(c,d)=>d.invoice.body.paid_amount=null],
 ['unknown proforma paid amount',(c,d)=>d.proforma.body.paid_amount=null],
 ['other ledger payment',(c,d)=>d.ledger.body.push({...d.ledger.body[0],id:'other'})],
 ['bank total mismatch',(c,d)=>d.ledger.body[0].amount_cents=1],
 ['invoice mail already scheduled',(c,d)=>d.invoice.body.last_postbox_id=7],
 ['refund/cancellation',(c,d)=>c.billingCase.cancelled_at='2026-10-26'],
 ['foreign payment marker',(c,d)=>{Object.assign(d,paid());d.payments.body.items[0].notice='unrelated';}],
 ]) test('blocks '+label,()=>{const c=ctx(),d=data();change(c,d);assert.throws(()=>mod.decide(c,d));});
test('valid POST still needs final exact invoice and history',()=>{assert.throws(()=>mod.confirm(ctx(),{statusCode:201,body:payment()},data().invoice,data().payments));});
test('confirms actual paid invoice and matching new provider receipt',()=>{const d=paid();const r=mod.confirm(ctx(),{statusCode:201,body:payment()},d.invoice,d.payments);assert.equal(r.repairPaymentVerified,true);assert.equal(r.easybillPaymentId,987654);});
test('conflicting final receipt refused',()=>{const d=paid();assert.throws(()=>mod.confirm(ctx(),{statusCode:201,body:{...payment(),id:999}},d.invoice,d.payments));});
test('non-201 mutation is never a confirmed success',()=>{const d=paid();assert.throws(()=>mod.confirm(ctx(),{statusCode:200,body:payment()},d.invoice,d.payments));});
import {buildPatch,baselineHash,patchAlarm} from './patch-workflow.mjs';
const base=()=>({id:'K9poQw3a1DOO16Vd',active:true,settings:{timezone:'Europe/Berlin'},nodes:[
 {id:'schedule',name:'Every Minute',type:'n8n-nodes-base.scheduleTrigger',parameters:{rule:{interval:[{field:'minutes',minutesInterval:1}]}}},
 {id:'route',name:'Easybill Payment',type:'n8n-nodes-base.if',parameters:{}},
 {id:'post',name:'Easybill Record Payment',type:'n8n-nodes-base.httpRequest',parameters:{jsonBody:"={{ {notice:$json.job.payload.manualPaidQontoProof?'manual':'ordinary'} }}"},credentials:{httpHeaderAuth:{id:'test'}}},
 {id:'success',name:'Prepare Projection Success',type:'n8n-nodes-base.code',parameters:{jsCode:"const fail=()=>{};const body=$json;return [{json:{ordinary:true}}];"}},
 {id:'collective',name:'Collective Easybill?',type:'n8n-nodes-base.if',parameters:{conditions:'unchanged'}},
 {id:'shopify',name:'Shopify Read Payment State',type:'n8n-nodes-base.httpRequest',parameters:{url:'unchanged'}},
 {id:'failure',name:'Prepare Projection Failure',type:'n8n-nodes-base.code',parameters:{jsCode:'return []'}},
],connections:{'Every Minute':{main:[[{node:'Easybill Payment',type:'main',index:0}]]},'Easybill Payment':{main:[[{node:'Collective Easybill?',type:'main',index:0}],[{node:'Shopify Read Payment State',type:'main',index:0}]]},'Easybill Record Payment':{main:[[{node:'Prepare Projection Success',type:'main',index:0}],[{node:'Prepare Projection Failure',type:'main',index:0}]]}}});
const candidate=()=>{const b=base();return buildPatch(b,baselineHash(b)).workflow;};
const execute=(w,name,json,records)=>new Function('$','$json','$input',w.nodes.find(n=>n.name===name).parameters.jsCode)(name=>({first:()=>({json:records[name]})}),json,{first:()=>({json})});
test('4796 exact full payment allowed with its own immutable IDs',()=>{const s=mod.CASES[1],c=ctx(),d=data();Object.assign(c.job,{id:s.jobId});Object.assign(c.job.payload,{documentId:s.invoice,proformaId:s.proforma,amountCents:s.amount,paidAt:s.paidAt,paymentId:s.paymentId,providerTransactionId:s.qontoId});Object.assign(c.billingCase,{id:s.caseId,shopify_order_name:s.order,total_gross_cents:s.amount,paid_at:s.paidAt});c.originalInvoice.easybill_document_id=s.invoice;Object.assign(d.invoice.body,{id:Number(s.invoice),number:s.order,amount:s.amount,customer_id:Number(s.customer)});Object.assign(d.proforma.body,{id:Number(s.proforma),number:'PF-'+s.order.slice(1),amount:s.amount,customer_id:Number(s.customer)});Object.assign(d.ledger.body[0],{id:s.paymentId,provider_transaction_id:s.qontoId,amount_cents:s.amount,booked_at:s.paidAt,billing_case_id:s.caseId,billing_cases:{...c.billingCase,billing_documents:[{...c.originalInvoice,document_type:'INVOICE'}]}});assert.equal(mod.decide(c,d).alreadyDone,false);});
test('all generated code compiles alongside existing ordinary guard names',()=>{for(const n of candidate().nodes.filter(n=>n.type.endsWith('.code')))new Function('$','$json','$input',n.parameters.jsCode);});
test('actual generated decision returns existing receipt, then verifies completion',()=>{const w=candidate(),d=paid(),c=ctx(),records={'Normalize Projection Job':c,'Repair: Read Invoice':d.invoice,'Repair: Read Payments':d.payments,'Repair: Read Proforma':d.proforma,'Repair: Read Proforma Payments':d.proformaPayments,'Repair: Read Webhooks':d.hooks};const out=execute(w,'Repair: Decide',d.ledger,records)[0].json;const complete=execute(w,'Prepare Projection Success',out,records)[0].json;assert.equal(complete.success,true);assert.equal(complete.result.easybillPaymentId,987654);assert.equal(complete.result.reused,true);});
test('raw 201 cannot bypass final provider verification in success node',()=>{assert.throws(()=>execute(candidate(),'Prepare Projection Success',{statusCode:201,body:payment()},{'Normalize Projection Job':ctx()}));});
test('ordinary payment completion and unrelated branches remain unchanged',()=>{const b=base(),w=buildPatch(b,baselineHash(b)).workflow;for(const n of b.nodes.filter(n=>!['post','success'].includes(n.id)))assert.deepEqual(w.nodes.find(x=>x.id===n.id),n);assert.deepEqual(w.settings,b.settings);assert.deepEqual(w.connections['Easybill Payment'].main[1],b.connections['Easybill Payment'].main[1]);const c=ctx();delete c.job.payload.repairFullPayment;assert.deepEqual(execute(w,'Prepare Projection Success',{}, {'Normalize Projection Job':c}),[{json:{ordinary:true}}]);});
test('reads are bounded, fail closed, and cannot send messages or retry POST',()=>{const w=candidate();for(const n of w.nodes.filter(n=>n.name.startsWith('Repair:')&&n.type.endsWith('.httpRequest'))){assert.equal(n.parameters.method,'GET');assert.equal(n.parameters.options.timeout,10000);assert.equal(n.parameters.options.response.response.fullResponse,true);assert.equal(n.retryOnFail,false);assert.equal(w.connections[n.name].main[1][0].node,'Prepare Projection Failure');}assert.equal(w.connections['Easybill Record Payment'].main[0][0].node,'Repair Verify?');assert.equal(w.connections['Repair: Confirm'].main[0][0].node,'Prepare Projection Success');});
test('unexpected live baseline rejected before producing operations',()=>assert.throws(()=>buildPatch(base(),'wrong')));
test('internal alarm route adds only exact payment worker preserving existing recipients',()=>{const old="={{ ['bvRcF5Xaj3eGY0J4'].some(id=>id===$json.source_workflow_id) ? 'support@neontrip.de' : 'info@NeonTrip.de' }}";const p=patchAlarm({id:'M4uG1HAtN9Zggxww',active:true,nodes:[{id:'mail',name:'Send Prepared Alert Email',parameters:{toRecipients:old}}]});assert.equal(p.updates['parameters.toRecipients'].replace(", 'K9poQw3a1DOO16Vd'",''),old);});
test('expired admission cannot create a payment even on attempt one',()=>{const c=ctx();c.job.payload.repairAdmissionValidUntil='2000-01-01T00:00:00Z';assert.throws(()=>mod.decide(c,data()));});
test('fresh case refund discovered after claim prevents POST',()=>{const d=data();d.ledger.body[0].billing_cases={...ctx().billingCase,refunded_at:'2026-10-26',billing_documents:[{...ctx().originalInvoice,document_type:'INVOICE'}]};assert.throws(()=>mod.decide(ctx(),d));});
