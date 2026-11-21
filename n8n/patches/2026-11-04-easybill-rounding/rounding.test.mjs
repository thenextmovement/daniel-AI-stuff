import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const patch=JSON.parse(readFileSync(new URL('./workflow.patch.json',import.meta.url)));
const names=['Verify Easybill Draft Amounts','Prepare Document Completion'];
function fixture(){
 const prices=[27667,1130,3570.0000000000005,2975];
 const items=prices.map((p,i)=>({description:'Position '+i,quantity:1,single_price_gross:p,vat_percent:19}));
 const ctx={job:{job_type:'CREATE_PROFORMA',idempotency_key:'billing:case:proforma:0'},billingCase:{subtotal_net_cents:29700,vat_cents:5642,total_gross_cents:35342},documentNumber:'PF-NEONT4831',
 documentPayload:{calc_vat_from:1,currency:'EUR',type:'PROFORMA_INVOICE',items}};
 const doc={id:3727210508,number:ctx.documentNumber,type:'PROFORMA_INVOICE',external_id:ctx.job.idempotency_key,currency:'EUR',calc_vat_from:1,amount:35342,amount_net:29699,items:structuredClone(items).map(i=>({...i,single_price_gross:Math.round(i.single_price_gross)}))};
 return {ctx,doc};
}
function run(name,ctx,doc){
 const code=patch.nodes.find(n=>n.name===name).parameters.jsCode;
 return vm.runInNewContext('(function(){'+code+'})()',{$:()=>({first:()=>({json:ctx})}),$json:{...doc,is_draft:name===names[0]}})[0].json;
}
for(const name of names){
 test(name+': real four-line rounding accepted',()=>{const {ctx,doc}=fixture();const r=run(name,ctx,doc);if(name===names[1])assert.equal(r.roundingProof.netDifferenceCents,-1)});
 for(const [label,change] of Object.entries({
  'wrong gross':(c,d)=>d.amount++,
  'wrong net':(c,d)=>d.amount_net--,
  'wrong currency':(c,d)=>d.currency='USD',
  'wrong document identity':(c,d)=>d.external_id='other',
  'wrong number':(c,d)=>d.number='PF-NEONT9999',
  'wrong type':(c,d)=>d.type='INVOICE',
  'wrong rate':(c,d)=>d.items[0].vat_percent=18,
  'wrong line':(c,d)=>d.items[0].single_price_gross++,
  'wrong quantity':(c,d)=>d.items[0].quantity=2,
  'missing lines':(c,d)=>delete d.items,
  'wrong source net':(c,d)=>{c.billingCase.subtotal_net_cents++;c.billingCase.vat_cents--},
  'net calculation':(c,d)=>c.documentPayload.calc_vat_from=0,
  'discount':(c,d)=>d.items[0].discount=1,
  'credit unchanged':(c,d)=>{c.job.job_type='CREATE_CREDIT';c.job.payload={netCents:29700,vatCents:5642,grossCents:35342}},
  'cancellation unchanged':(c,d)=>c.job.job_type='CREATE_CANCELLATION',
 })){
  test(name+': rejects '+label,()=>{const {ctx,doc}=fixture();change(ctx,doc);assert.throws(()=>run(name,ctx,doc))});
 }
 test(name+': strict matching legacy path unchanged',()=>{const {ctx,doc}=fixture();doc.amount_net=29700;run(name,ctx,doc)});
 test(name+': deterministically supports larger many-line rounding',()=>{const {ctx,doc}=fixture();const items=Array.from({length:20},(_,i)=>({description:'line'+i,quantity:1,single_price_gross:1130,vat_percent:19}));ctx.documentPayload.items=items;doc.items=structuredClone(items);doc.amount=22600;doc.amount_net=Math.round(22600/1.19);ctx.billingCase={subtotal_net_cents:19000,vat_cents:3600,total_gross_cents:22600};run(name,ctx,doc)});
}
test('completion persists both sets of amounts',()=>{const {ctx,doc}=fixture();Object.assign(ctx,run(names[1],ctx,doc));const code=patch.nodes.find(n=>n.name==='Prepare Successful Completion').parameters.jsCode;const result=vm.runInNewContext('(function(){'+code+'})()',{$:()=>({first:()=>({json:ctx})})})[0].json.result;assert.equal(result.verifiedDocumentAmounts.netCents,29699);assert.equal(result.roundingProof.sourceAmounts.netCents,29700)});
