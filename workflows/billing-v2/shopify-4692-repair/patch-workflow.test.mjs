import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {patchWorkflow} from './patch-workflow.mjs';
const fixture=JSON.parse(readFileSync(new URL('./affected-nodes.fixture.json',import.meta.url),'utf8'));
test('only three existing parameter values and one success edge change',()=>{
 const before=structuredClone(fixture);before.nodes.push({id:'unrelated',name:'Unrelated',parameters:{keep:true}});const {workflow:w,operations}=patchWorkflow(before);
 assert.equal(operations.length,11);assert.equal(w.active,before.active);assert.deepEqual(w.settings,before.settings);
 assert.equal(w.nodes.length,before.nodes.length+2);
 for(const node of before.nodes){
  const after=w.nodes.find(n=>n.id===node.id);
  if(!['Shopify Read Payment State','Decide Shopify Payment','Prepare Projection Success'].includes(node.name))assert.deepEqual(after,node);
  else {const n=structuredClone(after),b=structuredClone(node);delete n.parameters;delete b.parameters;assert.deepEqual(n,b);}
 }
 assert.deepEqual(w.connections['Shopify Mark Order Paid'].main[1],before.connections['Shopify Mark Order Paid'].main[1]);
 for(const [name,c] of Object.entries(before.connections))if(name!=='Shopify Mark Order Paid')assert.deepEqual(w.connections[name],c);
 assert.ok(w.nodes.find(n=>n.name==='Decide Shopify Payment').parameters.jsCode.endsWith(before.nodes.find(n=>n.name==='Decide Shopify Payment').parameters.jsCode));
 assert.ok(w.nodes.find(n=>n.name==='Prepare Projection Success').parameters.jsCode.endsWith(before.nodes.find(n=>n.name==='Prepare Projection Success').parameters.jsCode));
 assert.ok(!w.nodes.find(n=>n.name==='Shopify Mark Order Paid').retryOnFail);
 for(const n of w.nodes.filter(n=>n.type==='n8n-nodes-base.code'))new Function('$','$json',n.parameters.jsCode);
});
test('node, graph and version drift abort patch',()=>{for(const change of [w=>w.versionId='other',w=>w.nodes[0].parameters.timeout=1,w=>w.connections['Shopify Mark Order Paid'].main[0]=[]]){const w=structuredClone(fixture);change(w);assert.throws(()=>patchWorkflow(w));}});
test('new read cannot create customer communications',()=>{const {workflow:w}=patchWorkflow(fixture);const read=w.nodes.find(n=>n.name==='Repair Shopify 4692: Read Final');assert.ok(read.parameters.jsonBody.includes('query BillingPaymentState'));assert.ok(!read.parameters.jsonBody.includes('mutation'));assert.equal(read.onError,'continueErrorOutput');});
