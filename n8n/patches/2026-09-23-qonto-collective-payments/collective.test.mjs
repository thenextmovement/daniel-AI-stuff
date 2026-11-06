import test from 'node:test'; import assert from 'node:assert/strict';
import { references, verifyBank, planGroup, verifyDocuments, shopifyDecision, easybillDecision, projectionSuccess } from './collective.mjs';
const id='11111111-1111-4111-8111-111111111111';
const bank={id,transaction_id:'bank-'+id,amount:300,amount_cents:30000,currency:'EUR',side:'credit',status:'completed',reference:'PF-NEONT5001,PF-NEONT5002',label:'Muster.GmbH',settled_at:'2026-09-22T10:00:00Z'};
const orders=[1,2].map(i=>({id:'gid://shopify/Order/'+i,legacyResourceId:String(i),name:'#NEONT500'+i,cancelledAt:null,displayFinancialStatus:'PENDING',totalPriceSet:{shopMoney:{amount:String(i*100),currencyCode:'EUR'}},currentTotalPriceSet:{shopMoney:{amount:String(i*100),currencyCode:'EUR'}},totalOutstandingSet:{shopMoney:{amount:String(i*100),currencyCode:'EUR'}},billingAddress:{company:'Muster GmbH',firstName:'Ada',lastName:'Beispiel'},customer:{id:'gid://shopify/Customer/1'},createdAt:'2026-09-10T10:00:00Z'}));
const cases=[1,2].map(i=>({id:'00000000-0000-4000-8000-00000000000'+i,shopify_order_id:String(i),shopify_order_name:'#NEONT500'+i,customer:{company:'Muster GmbH'},currency:'EUR',total_gross_cents:i*10000,status:'PAYMENT_PENDING',tax_review_status:'NOT_REQUIRED',lock_version:1,paid_at:null,cancelled_at:null,refunded_at:null,billing_payments:[],billing_documents:[{easybill_document_id:String(100+i),document_type:'PROFORMA',document_number:'PF-NEONT500'+i,status:'SENT',amount_cents:i*10000,currency:'EUR',revision:0}],current_revision:0}));
const clone=v=>structuredClone(v);
const plan=()=>planGroup(verifyBank(bank,{transaction_id:id,amountCents:30000,reference:bank.reference}),{data:{orders:{nodes:clone(orders),pageInfo:{hasNextPage:false}}}},clone(cases));
test('all explicit refs, duplicate mentions, no date digits',()=>assert.deepEqual(references('RNr. PF-NEONT5001,PF-NEONT5002 NEONT5001 RDat. 11.09.2026'),['NEONT5001','NEONT5002']));
test('bank proves completed EUR credit',()=>assert.equal(plan().allocations.length,2));
for(const [key,value] of [['status','pending'],['side','debit'],['currency','USD'],['amount_cents',29999],['id','22222222-1111-4111-8111-111111111111']])test('reject bank '+key,()=>assert.throws(()=>verifyBank({...bank,[key]:value},{transaction_id:id,amountCents:30000,reference:bank.reference})));
test('no substring ref',()=>assert.deepEqual(references('NEONT50010'),[]));
for(const [label,mutate] of [
 ['underpayment',x=>x[0].totalPriceSet.shopMoney.amount='99.99'],
 ['cancelled',x=>x[0].cancelledAt='2026-09-21'],
 ['paid',x=>x[0].displayFinancialStatus='PAID'],
 ['partial',x=>x[0].totalOutstandingSet.shopMoney.amount='50'],
 ['wrong company',x=>x[1].billingAddress.company='Andere GmbH'],
 ['duplicate order',x=>x[1]=clone(x[0])],
 ['missing order',x=>x.pop()]
])test('reject order '+label,()=>{const o=clone(orders);mutate(o);assert.throws(()=>planGroup(verifyBank(bank,{transaction_id:id,amountCents:30000,reference:bank.reference}),{data:{orders:{nodes:o,pageInfo:{hasNextPage:false}}}},clone(cases)));});
test('reject incomplete GraphQL search',()=>assert.throws(()=>planGroup(verifyBank(bank,{transaction_id:id,amountCents:30000,reference:bank.reference}),{data:{orders:{nodes:orders,pageInfo:{hasNextPage:true}}}},cases)));
for(const [label,mutate] of [['foreign payment',x=>x[0].billing_payments=[{id:'foreign'}]],['changed amount',x=>x[0].total_gross_cents--],['tax review',x=>x[0].tax_review_status='REVIEW_REQUIRED'],['missing case',x=>x.pop()],['cancelled case',x=>x[0].cancelled_at='2026-09-21']])test('reject case '+label,()=>{const c=clone(cases);mutate(c);assert.throws(()=>planGroup(verifyBank(bank,{transaction_id:id,amountCents:30000,reference:bank.reference}),{data:{orders:{nodes:orders,pageInfo:{hasNextPage:false}}}},c));});
const docs=[1,2].map(i=>({id:100+i,number:'PF-NEONT500'+i,type:'PROFORMA_INVOICE',order_number:'#NEONT500'+i,amount:i*10000,currency:'EUR',paid_amount:0,paid_at:null,cancel_id:null,is_draft:false,address:{company_name:'Muster GmbH'}}));
test('exact two authoritative Easybill documents',()=>assert.equal(verifyDocuments(plan(),docs).allocations.length,2));
test('reject Easybill prior payment',()=>assert.throws(()=>verifyDocuments(plan(),[{...docs[0],paid_amount:1},docs[1]])));
test('reject Easybill mismatch',()=>assert.throws(()=>verifyDocuments(plan(),[{...docs[0],amount:9999},docs[1]])));
test('reject duplicate Easybill document',()=>assert.throws(()=>verifyDocuments(plan(),[docs[0],docs[0]])));
const ctx={job:{id:'job',lease_token:'lease',job_type:'PROJECT_PAYMENT_SHOPIFY',payload:{collectivePaymentId:id,amountCents:10000}},billingCase:{shopify_order_id:'1',shopify_order_name:'#NEONT5001',total_gross_cents:10000,currency:'EUR'}};
const so={...orders[0],canMarkAsPaid:true};
test('Shopify verified exact unpaid state',()=>assert.equal(shopifyDecision(ctx,{data:{order:so}}).alreadyDone,false));
test('Shopify changed total blocked',()=>assert.throws(()=>shopifyDecision(ctx,{data:{order:{...so,currentTotalPriceSet:{shopMoney:{amount:'110',currencyCode:'EUR'}}}}})));
test('Shopify errors blocked',()=>assert.throws(()=>shopifyDecision(ctx,{errors:[{message:'fail'}]})));
test('Shopify PAID requires zero outstanding',()=>assert.throws(()=>shopifyDecision(ctx,{data:{order:{...so,displayFinancialStatus:'PAID'}}})));
test('Shopify mutation empty response is not success',()=>assert.throws(()=>projectionSuccess(ctx,{})));
test('Shopify mutation paid exact id succeeds',()=>assert.equal(projectionSuccess(ctx,{data:{orderMarkAsPaid:{order:{...so,displayFinancialStatus:'PAID',totalOutstandingSet:{shopMoney:{amount:'0',currencyCode:'EUR'}}},userErrors:[]}}}).success,true));
test('Shopify different order blocked',()=>assert.throws(()=>projectionSuccess(ctx,{data:{orderMarkAsPaid:{order:{id:'gid://shopify/Order/99',displayFinancialStatus:'PAID'},userErrors:[]}}})));
const ebctx={...ctx,job:{...ctx.job,job_type:'PROJECT_PAYMENT_EASYBILL',payload:{collectivePaymentId:id,collectiveAllocationId:id+':allocation:1',documentId:999,amountCents:10000,paidAt:bank.settled_at}}};
const invoice={id:999,number:'#NEONT5001',type:'INVOICE',amount:10000,currency:'EUR',paid_amount:0,paid_at:null,cancel_id:null,is_draft:false};
test('Easybill unpaid with complete empty history may post',()=>assert.equal(easybillDecision(ebctx,invoice,{page:1,pages:1,total:0,items:[]}).alreadyDone,false));
test('Easybill partial external payment blocks',()=>assert.throws(()=>easybillDecision(ebctx,{...invoice,paid_amount:1},{page:1,pages:1,total:0,items:[]})));
test('Easybill incomplete payment history blocks',()=>assert.throws(()=>easybillDecision(ebctx,invoice,{page:1,pages:2,total:101,items:[]})));
test('Easybill exact prior allocation skips POST on retry',()=>{const marker='Qonto allocation '+ebctx.job.payload.collectiveAllocationId;const payment={id:777,document_id:999,amount:10000,payment_at:'2026-09-22',notice:marker};assert.equal(easybillDecision(ebctx,{...invoice,paid_amount:10000,paid_at:'2026-09-22'},{page:1,pages:1,total:1,items:[payment]}).alreadyDone,true);});
test('Easybill paid without own evidence blocks',()=>assert.throws(()=>easybillDecision(ebctx,{...invoice,paid_amount:10000,paid_at:'2026-09-22'},{page:1,pages:1,total:0,items:[]})));

test('Easybill ambiguous retry without a durable receipt cannot POST again',()=>assert.throws(()=>easybillDecision({...ebctx,job:{...ebctx.job,attempt_count:2}},invoice,{page:1,pages:1,total:0,items:[]}),/AMBIGUOUS_RETRY/));
test('Shopify changed amount in mutation response blocks invoice continuation',()=>assert.throws(()=>projectionSuccess(ctx,{data:{orderMarkAsPaid:{order:{...so,displayFinancialStatus:'PAID',currentTotalPriceSet:{shopMoney:{amount:'110',currencyCode:'EUR'}},totalOutstandingSet:{shopMoney:{amount:'0',currencyCode:'EUR'}}},userErrors:[]}}})));
