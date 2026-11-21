import vm from 'node:vm';import fs from 'node:fs';import {test} from 'node:test';import assert from 'node:assert/strict';
const patch=JSON.parse(fs.readFileSync(new URL('./sender.patch.json',import.meta.url)));
const code=patch.nodes.find(n=>n.name==='Check Existing Customer Delivery').parameters.jsCode;
function fixture(){
 const doc={id:3727210508,number:'PF-NEONT4831',currency:'EUR',is_draft:false,calc_vat_from:1,amount:35342,amount_net:29699,items:[{},{},{},{}]};
 const source={netCents:29700,vatCents:5642,grossCents:35342}, actual={netCents:29699,vatCents:5643,grossCents:35342};
 const ctx={documentNumber:doc.number,easybillDocumentId:String(doc.id),kind:'ORDER_CONFIRMATION_PROFORMA',billingCase:{currency:'EUR',subtotal_net_cents:29700,vat_cents:5642,total_gross_cents:35342}};
 const rows=[{payload:{worker:'n8n-easybill-document-v2',easybillDocumentId:String(doc.id),documentNumber:doc.number,verifiedDocumentAmounts:actual,roundingProof:{method:'GROSS_AGGREGATE_VS_ROUNDED_LINES',vatPercent:19,lineCount:4,sourceAmounts:source,documentAmounts:actual}}}];
 return {ctx,doc,rows};
}
function run(f){return vm.runInNewContext('(function(){'+code+'})()',{$:n=>({first:()=>({json:n==='Prepare Customer Delivery'?f.ctx:{body:f.doc}})}),$json:{body:f.rows}})[0].json}
test('passes immutable finalized document with exact creation proof',()=>assert.equal(run(fixture()).easybillDocument.id,3727210508));
for(const [label,change]of Object.entries({
 'missing proof':f=>f.rows=[],
 'ambiguous proof':f=>f.rows.push(f.rows[0]),
 'foreign proof':f=>f.rows[0].payload.easybillDocumentId='999',
 'wrong source':f=>f.ctx.billingCase.subtotal_net_cents++,
 'wrong actual':f=>f.doc.amount_net--,
 'wrong gross':f=>f.doc.amount++,
 'wrong currency':f=>f.doc.currency='USD',
 'draft':f=>f.doc.is_draft=true,
 'wrong calculation':f=>f.doc.calc_vat_from=0,
 'wrong document':f=>f.doc.id++,
 'wrong kind of proof':f=>f.rows[0].payload.roundingProof.method='OTHER'
})){test('rejects '+label,()=>{const f=fixture();change(f);assert.throws(()=>run(f))})}
test('strict legacy exact amount path needs no rounding proof',()=>{const f=fixture();f.doc.amount_net=29700;f.rows=[];run(f)});
test('existing already sent flag preserved',()=>{const f=fixture();f.doc.last_postbox_id=123;assert.equal(run(f).emailAlreadySent,true)});
