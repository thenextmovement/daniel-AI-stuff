import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';import {buildAlertPatch} from './alert-recipient-patch.mjs';
const w=JSON.parse(readFileSync(new URL('./fixtures/error-recipient-baseline.json',import.meta.url))), p=buildAlertPatch(w), before=w.nodes[0].parameters.toRecipients, after=p.operations[0].updates.parameters.toRecipients;
const recipient=(s,j)=>runInNewContext(s.slice(3,-2),{$json:j});
test('QC immediate and digest alerts use the confirmed internal support route',()=>{
 assert.equal(recipient(after,{source_workflow_id:'bvRcF5Xaj3eGY0J4'}),'support@neontrip.de');
 assert.equal(recipient(after,{metadata:{affected_workflow_ids:['bvRcF5Xaj3eGY0J4']}}),'support@neontrip.de');
});
test('all existing recipients and other mail parameters remain unchanged',()=>{
 for(const id of ['u48KZyTcU2J9pw2P','wqaTsVKuKqKnp2AG','cW08nxn9ANfGFEou','6NZnfGpyfUVikqpf','other'])
  assert.equal(recipient(after,{source_workflow_id:id}),recipient(before,{source_workflow_id:id}));
 assert.deepEqual({...p.operations[0].updates.parameters,toRecipients:before},w.nodes[0].parameters);
});
test('error workflow drift fails closed',()=>assert.throws(()=>buildAlertPatch({...w,versionId:'new'}),/BASELINE_DRIFT/));
