import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildInstallationWorkflow, nextShopifyPage} from './build_shipping_installation_workflow.mjs';
const base = JSON.parse(fs.readFileSync(new URL('../n8n/backups/2026-11-02-shipping-installation-documents/active-before.json',import.meta.url),'utf8'));
const wf = buildInstallationWorkflow(base);
const node = name => wf.nodes.find(n => n.name === name);
const run = (name, input, lookup = () => {throw new Error('unexpected lookup');}) => vm.runInNewContext('(function(){'+node(name).parameters.jsCode+'})()',{$input:{all:()=>input,first:()=>input[0]},$:lookup});
const pages=[{json:{body:{orders:[{id:123,name:'#TEST1',email:'synthetic@example.test',fulfillments:[{id:456,order_id:123,status:'success',tracking_numbers:['parcel-1'],tracking_company:'DHL',line_items:[{id:1,quantity:1}]}],line_items:[{id:1,title:'LED Neonschild',quantity:1}]}]}}},{json:{body:{orders:[{id:124,name:'#TEST2',email:'synthetic@example.test',fulfillment_status:'partial',fulfillments:[{id:457,order_id:124,status:'success',tracking_numbers:['parcel-2'],tracking_company:'DPD',line_items:[{id:2,quantity:1}]}],line_items:[{id:2,title:'LED Neonschild',quantity:2}]}]}}}];
test('only three original nodes and one branch connection change',()=>{
 const changed=base.nodes.filter(b=>JSON.stringify(b)!==JSON.stringify(node(b.name))).map(n=>n.name);
 assert.deepEqual(changed,['Shopify: Recent Fulfilled Orders','Build Shipment Records','Build Shopify Event Records']);
 for(const b of base.nodes) assert.deepEqual(node(b.name).credentials,b.credentials);
 assert.deepEqual(wf.settings,base.settings); assert.equal(wf.active,base.active);
 const connections=structuredClone(wf.connections);
 connections['Shopify: Recent Fulfilled Orders'].main[0].pop();
 for(const key of Object.keys(connections)) if(key.startsWith('Installation: '))delete connections[key];
 assert.deepEqual(connections,base.connections);
});
test('publication guard rejects changed active version',()=>assert.throws(()=>buildInstallationWorkflow({...base,activeVersionId:'changed'})));
test('Shopify pagination follows next only on owned host',()=>{
 assert.equal(nextShopifyPage('<https://galaxybuzzdk.myshopify.com/admin/api/2026-04/orders.json?page_info=abc>; rel="next"'),'https://galaxybuzzdk.myshopify.com/admin/api/2026-04/orders.json?page_info=abc');
 assert.equal(nextShopifyPage('<https://galaxybuzzdk.myshopify.com/admin/api/2026-04/orders.json?page_info=abc>; rel="previous"'),'');
 assert.throws(()=>nextShopifyPage('<https://other.example/orders.json?x>; rel="next"'));
 const expr=node('Shopify: Recent Fulfilled Orders').parameters.options.pagination.pagination.nextURL;
 assert.equal(vm.runInNewContext(expr.slice(3,-2),{$response:{headers:{}}}),'');
 assert(!node('Shopify: Recent Fulfilled Orders').parameters.url.includes('fulfillment_status=shipped'));
});
test('all Shopify pages and partial shipments reach canonical tracking',()=>{
 const records=run('Build Shipment Records',pages);
 assert.equal(records.length,2);assert.equal(records[1].json.shipment.shopifyOrderId,'124');
 const single=vm.runInNewContext('(function(){'+base.nodes.find(n=>n.name==='Build Shipment Records').parameters.jsCode+'})()',{$input:{first:()=>({json:pages[0].json.body})}});
 assert.deepEqual(JSON.parse(JSON.stringify(records[0])),JSON.parse(JSON.stringify(single[0])));
});
test('every Graph input retains its own fulfillment linkage',()=>{
 const records=run('Build Shipment Records',pages);
 const input=records.map((r,i)=>({json:{data:{fulfillment:{id:'gid://shopify/Fulfillment/'+(456+i),events:{edges:[{node:{id:'gid://shopify/FulfillmentEvent/'+(100+i),status:'IN_TRANSIT',happenedAt:'2026-11-02T10:00:00Z'}}]}}}}}));
 const out=run('Build Shopify Event Records',input,name=>{assert.equal(name,'Build Shipment Records');return {itemMatching:i=>records[i]};});
 assert.equal(out.length,2);assert.equal(out[1].json.shipment.shopifyOrderId,'124'); assert.equal(out[1].pairedItem.item,1);
});
test('installation candidates keep only target fulfillment and all purchased lines',()=>{
 const result=run('Installation: Fulfillments',[{json:{id:'sent-folder'}}],name=> name==='Installation: Mailbox'?{first:()=>({json:{id:'4d977ed3-c401-43e5-ad00-b171a294e787',mail:'support@neontrip.de'}})}:{all:()=>pages});
 assert.equal(result.length,2);assert.equal(result[1].json.fulfillmentId,'457'); assert.equal(result[1].json.order.line_items[0].quantity,2);assert.equal(result[1].json.order.fulfillments[0].line_items[0].quantity,1);
});
test('empty claims, failures and replays are filtered with correct pairing',()=>{
 for(const name of ['Installation: Ready Drafts','Installation: Ready Sends']){
 const result=run(name,[{json:{ready:false}},{json:{error:'timeout'}},{json:{ready:true,notificationId:'winner'}},{json:{ready:'true'}}]);
 assert.equal(result.length,1);assert.equal(result[0].json.notificationId,'winner');assert.equal(result[0].pairedItem.item,2);
 }
});
test('external writes and authorization never retry; every Graph call uses immutable ids',()=>{
 for(const n of wf.nodes.filter(n=>n.name.startsWith('Installation: ')&&n.type==='n8n-nodes-base.httpRequest')){
  if(n.parameters.method==='POST')assert.equal(n.retryOnFail,false,n.name);
  if(n.parameters.nodeCredentialType==='microsoftOutlookOAuth2Api')assert(n.parameters.headerParameters.parameters.some(h=>h.name==='Prefer'&&h.value==='IdType="ImmutableId"'));
  assert.equal(n.onError,'continueRegularOutput');
 }
 const send=node('Installation: Send Draft');assert(send.parameters.url.includes('$json.draftId'));
 assert(node('Installation: Authorize').parameters.jsonBody.includes('.item.json.notificationId'));
 assert(node('Installation: Read Sent Copy').parameters.url.includes('.item.json.draftId'));
});
