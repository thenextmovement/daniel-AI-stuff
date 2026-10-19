import test from 'node:test';import assert from 'node:assert/strict';
import {validateBankItems,validateShopifyPages,verifyMirrorWrite,patchWorkflow} from './sync.mjs';
const tx={id:'01a15049-e8d4-72c4-b2df-fcfe2cac4031',transaction_id:'bank-tx-1',amount:119,side:'credit',currency:'EUR'};
test('bank rejects partial/error rows and duplicates before any upsert',()=>{
 assert.equal(validateBankItems([{json:tx}]).length,1);
 for(const xs of [[],[{json:{error:'timeout'}}],[{json:{...tx,amount:null}}],[{json:{...tx,amount:''}}],[{json:tx},{json:tx}]])assert.throws(()=>validateBankItems(xs),/QONTO_MIRROR/);
});
const page=(orders,link='')=>({json:{statusCode:200,headers:{link},body:{orders}}});
const order=(id)=>({id,name:'#NEON'+id,total_outstanding:'119.00',total_price:'119.00',currency:'EUR',test:false,updated_at:'2026-10-19T12:40:00Z'});
test('Shopify requires every page and exact frozen count including old orders',()=>{
 assert.equal(validateShopifyPages([page([order(1)],'<next>; rel="next"'),page([order(2)])],2).length,2);
 assert.throws(()=>validateShopifyPages([page([order(1)],'<next>; rel="next"')],2),/TERMINAL/);
 assert.throws(()=>validateShopifyPages([page([order(1)])],2),/COUNT_MISMATCH/);
 assert.throws(()=>validateShopifyPages([page([order(1),order(1)])],2),/ORDER_INVALID/);
 for(const patch of [{total_price:null},{total_outstanding:''},{currency:''},{test:undefined},{updated_at:'invalid'}])assert.throws(()=>validateShopifyPages([page([{...order(1),...patch}])],1),/ORDER_INVALID/);
});
test('no successful freshness marker unless every source ID was written',()=>{
 const b=[{json:{batch:[{id:'1',ingested_at:'2026-10-19T12:40:00Z'},{id:'2'}]}}];
 const response=(ids)=>[{json:{statusCode:201,body:ids.map(id=>({id}))}}];
 assert.throws(()=>verifyMirrorWrite(response(['1']),b,'bank'),/INCOMPLETE/);
 assert.throws(()=>verifyMirrorWrite(response(['1','3']),b,'bank'),/IDS_DIFFER/);
 const r=verifyMirrorWrite(response(['1','2']),b,'bank')[0].json;
 assert.equal(r.metadata.source_count,2);assert.equal(r.metadata.observed_at,'2026-10-19T12:40:00Z');
});

import {mirrorFailureAlert} from './alert.mjs';
test('mirror alerts report process and required action without customer data or raw errors',()=>{
 const r=mirrorFailureAlert({workflow:{id:'FyZCGkPNoA6EQI3N'},execution:{id:'123',error:{message:'SECRET_CUSTOMER_DATA'}}});
 assert.equal(r.emailRecipient,'support@neontrip.de');assert.match(r.emailSubject,/Bankspiegel/);assert.doesNotMatch(JSON.stringify(r),/SECRET_CUSTOMER_DATA/);assert.match(r.emailBody,/vollständigen Abgleich/);
 assert.equal(mirrorFailureAlert({workflow:{id:'unrelated'}}),null);
});

test('credit balances remain valid Shopify source data',()=>{
 assert.equal(validateShopifyPages([page([{...order(1),total_outstanding:'-444.00'}])],1).length,1);
});
test('mirror writes are throttled without touching existing nodes',()=>{
 const untouched={id:'other',name:'Other',parameters:{keep:true}};
 const original={id:'FyZCGkPNoA6EQI3N',nodes:[{id:'map',parameters:{jsCode:'const items = $input.all(); return items;'}},{id:'qonto',name:'Qonto: Transaktionen',parameters:{}},{id:'sb',parameters:{url:'https://example.invalid?on_conflict=id',headerParameters:{parameters:[{name:'Prefer',value:'old'}]},options:{}}},untouched],connections:{},settings:{}};
 const patched=patchWorkflow(original,'bank');
 assert.deepEqual(patched.nodes.find(n=>n.id==='sb').parameters.options.batching,{batch:{batchSize:1,batchInterval:1000}});
 assert.deepEqual(patched.nodes.find(n=>n.id==='other'),untouched);
});
