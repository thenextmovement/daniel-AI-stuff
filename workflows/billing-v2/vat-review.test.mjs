import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const workflow=JSON.parse(readFileSync(new URL('./generated/vat-review-alert-worker-v2.inactive.json',import.meta.url)));
async function run(payload, company='Kröswang GmbH', address='Kickendorf 8', override={}) {
 const source=workflow.nodes.find(n=>n.name==='Prepare VAT Review Alert').parameters.jsCode;
 const c={id:'case',shopify_order_name:'#NEONT4867',vat_id:'ATU69734567',tax_review_status:'REVIEW_REQUIRED',billing_address:{company,street:address,zip:'4710',city:'Grieskirchen',country:'AT'},delivery_address:{country:'AT'},...override};
 const context={$json:{body:{claimed:{job:{id:'job',lease_token:'lease',payload:{}},billingCase:c}}},$env:{},helpers:{httpRequest:async()=>{if(payload instanceof Error)throw payload;return payload;}}};
 return (await vm.runInNewContext('(async function(){'+source+'}).call({helpers})',context))[0]?.json;
}
test('actual VIES result matches abbreviated legal form and exact address',async()=>{
 const r=await run({isValid:true,userError:'VALID',name:'Kröswang Gesellschaft m.b.H.',address:'Kickendorf 8\nAT-4710 Grieskirchen'});
 assert.equal(r.evidence?.outcome,'VERIFIED');
});
test('provider unavailable with isValid false is never interpreted as invalid',async()=>{
 for(const response of [{isValid:false,userError:'MS_UNAVAILABLE'},new Error('timeout'),{}]) {
  assert.equal((await run(response)).evidence?.outcome,'UNAVAILABLE');
 }
});
test('explicit invalid response remains invalid',async()=>{
 assert.equal((await run({isValid:false,userError:'INVALID'})).evidence?.outcome,'INVALID');
});
test('valid number belonging to another company cannot release tax gate',async()=>{
 assert.equal((await run({isValid:true,userError:'VALID',name:'Andere GmbH',address:'Kickendorf 8\nAT-4710 Grieskirchen'})).evidence?.outcome,'IDENTITY_MISMATCH');
});
test('different street number cannot release tax gate',async()=>{
 assert.equal((await run({isValid:true,userError:'VALID',name:'Kröswang GmbH',address:'Kickendorf 80\nAT-4710 Grieskirchen'})).evidence?.outcome,'IDENTITY_MISMATCH');
});
test('missing registry identity requires review',async()=>{
 assert.equal((await run({isValid:true,userError:'VALID',name:'---',address:'---'})).evidence?.outcome,'IDENTITY_UNAVAILABLE');
});
test('foreign country or invalid format is explicit',async()=>{
 assert.equal((await run({},undefined,undefined,{vat_id:'ATU123'})).evidence?.outcome,'FORMAT_INVALID');
 assert.equal((await run({},undefined,undefined,{vat_id:'DE123456789'})).evidence?.outcome,'COUNTRY_MISMATCH');
});
test('VAT retry is persisted by Wait and exact reclaim',()=>{
 assert.equal(workflow.nodes.find(n=>n.name==='Wait Five Minutes for VIES')?.type,'n8n-nodes-base.wait');
 assert.ok(workflow.nodes.find(n=>n.name==='Reclaim VAT Retry')?.parameters.url.includes('billing_vat_retry_claim'));
});
