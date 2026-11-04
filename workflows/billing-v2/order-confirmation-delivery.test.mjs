import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { attachOrderConfirmation } from './order-confirmation-delivery.mjs';
const names=['Claim Customer Delivery Job','Easybill Load Customer Document','Easybill Send Customer Document','Prepare Customer Delivery','Customer Document Already Sent'];
const base={nodes:names.map(name=>({id:name,name,parameters:name==='Prepare Customer Delivery'?{jsCode:"const kind='ORDER_CONFIRMATION_PROFORMA';return [{json:{kind}}];"}:{},credentials:{httpHeaderAuth:{id:'credential'}}})),connections:{'Customer Document Already Sent':{main:[[{node:'Prepare Customer Delivery Success',type:'main',index:0}],[{node:'Easybill Send Customer Document',type:'main',index:0}]]}},settings:{errorWorkflow:'existing-alert'}};
const wf=attachOrderConfirmation(structuredClone(base));const get=name=>wf.nodes.find(n=>n.name===name);
const run=(name,items,ctx)=>vm.runInNewContext(`(()=>{${get(name).parameters.jsCode}})()`,{$input:{all:()=>items},$json:items[0]?.json,$:n=>({first:()=>({json:ctx[n]})}),Buffer});
test('only unsent proformas enter AB attachment path; other documents and existing postbox retain their paths',()=>{
 assert.equal(wf.connections['Customer Document Already Sent'].main[0][0].node,'Prepare Customer Delivery Success');
 assert.equal(wf.connections['Customer Document Already Sent'].main[1][0].node,'Proforma Needs Order Confirmation');
 assert.equal(wf.connections['Proforma Needs Order Confirmation'].main[1][0].node,'Easybill Send Customer Document');
 assert.equal(wf.settings.errorWorkflow,'existing-alert');
 for(const n of wf.nodes.filter(n=>n.id.startsWith('ab-')&&!n.type.endsWith('.if')))assert.equal(wf.connections[n.name].main[1][0].node,'Prepare Customer Delivery Failure');
});
test('existing AB is reused only when filename and document ownership match',()=>{
 const ctx={'Load Order Confirmation PDF':{filename:'auftragsbestaetigung-42.pdf'},'Check Existing Customer Delivery':{easybillDocumentId:'42'}};
 const result=run('Select Existing Order Confirmation',[{json:{id:7,file_name:'auftragsbestaetigung-42.pdf',document_id:42}}],ctx);
 assert.equal(result[0].json.attached,true);
 assert.equal(run('Select Existing Order Confirmation',[{json:{id:7,file_name:'other.pdf',document_id:42}}],ctx)[0].json.attached,false);
 assert.throws(()=>run('Select Existing Order Confirmation',[{json:{id:7,file_name:'auftragsbestaetigung-42.pdf',document_id:99}}],ctx),/ownership/);
});
test('link must be acknowledged before the email can be sent',()=>{
 const ctx={'Check Existing Customer Delivery':{easybillDocumentId:'42'},'Load Order Confirmation PDF':{filename:'ab.pdf'}};
 assert.throws(()=>run('Verify Order Confirmation Link',[{json:{id:7,document_id:null,file_name:'ab.pdf'}}],ctx),/not_confirmed/);
 assert.equal(run('Verify Order Confirmation Link',[{json:{id:7,document_id:42,file_name:'ab.pdf'}}],ctx)[0].json.attached,true);
});

test('retry reuses only byte-identical AB and blocks a stale paid/address snapshot before sending',async()=>{
 const source=get('Verify Existing Order Confirmation Content').parameters.jsCode;
 const runContent=bytes=>vm.runInNewContext(`(async function(){${source}}).call({helpers:{getBinaryDataBuffer:async()=>bytes}})`,{bytes:Buffer.from(bytes),$:()=>({first:()=>({json:{contentBase64:Buffer.from('current PDF').toString('base64')}})})});
 assert.equal((await runContent('current PDF'))[0].json.attached,true);
 await assert.rejects(runContent('old PDF'),/stale_attachment/);
 assert.equal(wf.connections['Order Confirmation Already Attached'].main[0][0].node,'Load Existing Order Confirmation Content');
 assert.equal(wf.connections['Verify Existing Order Confirmation Content'].main[0][0].node,'Easybill Send Customer Document');
});
