import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const dir=process.env.COLLECTIVE_SNAPSHOT_DIR;
if(!dir)throw new Error('COLLECTIVE_SNAPSHOT_DIR required; restricted snapshots stay outside Git');
for(const kind of ['qonto','projection']){
 const before=JSON.parse(fs.readFileSync(dir+'/'+kind+'.before.json')),after=JSON.parse(fs.readFileSync(dir+'/'+kind+'.after.json'));
 test(kind+' keeps all existing node identities, credentials and settings',()=>{
  assert.deepEqual(after.settings,before.settings);assert.equal(after.active,before.active);
  for(const n of before.nodes){const current=after.nodes.find(a=>a.id===n.id);assert.ok(current);assert.deepEqual(current.credentials,n.credentials);assert.equal(current.disabled,n.disabled);}
 });
 test(kind+' all code nodes compile',()=>{for(const n of after.nodes.filter(n=>n.type==='n8n-nodes-base.code'))assert.doesNotThrow(()=>new Function(n.parameters.jsCode),n.name);});
 test(kind+' connections target existing nodes',()=>{const names=new Set(after.nodes.map(n=>n.name));for(const [name,c]of Object.entries(after.connections)){assert.ok(names.has(name));for(const output of c.main||[])for(const edge of output||[])assert.ok(names.has(edge.node));}});
 if(kind==='qonto')test('single-payment existing node definitions remain identical',()=>{for(const n of before.nodes)assert.deepEqual(after.nodes.find(a=>a.id===n.id),n);assert.equal(after.connections['Collective Payment?'].main[1][0].node,'Shopify: Find Order');});
 if(kind==='projection')test('untagged Easybill jobs retain original POST route',()=>assert.equal(after.connections['Collective Easybill?'].main[1][0].node,'Easybill Record Payment'));
}

const rb=JSON.parse(fs.readFileSync(dir+'/recon.before.json')),ra=JSON.parse(fs.readFileSync(dir+'/recon.after.json'));
test('reconciliation preserves every existing node definition and settings',()=>{for(const n of rb.nodes)assert.deepEqual(ra.nodes.find(a=>a.id===n.id),n);assert.deepEqual(ra.settings,rb.settings);assert.equal(ra.active,rb.active);});
test('reconciliation collective waits complete bookkeeping; all other matches use original Qonto route',()=>{const c=ra.connections['Registered Collective Projection Pending?'].main;assert.equal(c[0][0].node,'Prepare Manual Paid Reconciliation Completion');assert.equal(c[1][0].node,'Read Qonto Transactions');});
test('reconciliation guard code compiles',()=>assert.doesNotThrow(()=>new Function(ra.nodes.find(n=>n.name==='Check Registered Collective Context').parameters.jsCode)));
