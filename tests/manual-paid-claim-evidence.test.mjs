import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
const base=JSON.parse(readFileSync(new URL('./fixtures/manual-paid-claim-baseline.json',import.meta.url)));
const wf=structuredClone(base);
const patch=process.env.MANUAL_PAID_PATCH ? JSON.parse(readFileSync(process.env.MANUAL_PAID_PATCH)) : {operations:[]};
for(const op of patch.operations) {
 if(op.type==='updateNode') { const n=wf.nodes.find(n=>n.id===op.nodeId); assert.ok(n); Object.assign(n,op.updates); }
 else if(op.type==='addNode') wf.nodes.push(op.node);
 else if(op.type==='addConnection') {
   const mains=wf.connections[op.source].main; mains[op.sourceIndex]=[{node:op.target,type:'main',index:op.targetIndex}];
 } else assert.fail('Unexpected patch operation');
}
test('a lost claim response terminates visibly with bounded execution/input context, without replay',()=>{
 const claim=wf.nodes.find(n=>n.name==='Admit or Claim Manual Paid Reconciliation');
 assert.equal(claim.onError,'continueErrorOutput','Gateway failures must enter the explicit review-only error path');
 assert.equal(claim.retryOnFail,false,'POST claim must never retry automatically');
 assert.deepEqual(wf.connections[claim.name].main[0],base.connections[claim.name].main[0],'successful path unchanged');
 const errorNode=wf.nodes.find(n=>n.name===wf.connections[claim.name].main[1][0].node);
 assert.equal(wf.connections[errorNode.name],undefined,'error node cannot rejoin business actions');
 const execute=new Function('$input','$','$execution',errorNode.parameters.jsCode);
 function message(input,candidates=[],executionId='123') {
   try { execute({first:()=>({json:input})},name=>{
     assert.equal(name,'Prepare Manual Paid Durable Intake');
     return {first:()=>({json:{request:{executionId,scope:'MANUAL_SHOPIFY_PAID',operation:'claim',candidates}}})};
   },{id:'123'}); assert.fail('Must stop'); } catch(e) { return e.message; }
 }
 const msg=message({error:{httpCode:'502',message:'secret token=do-not-copy <html>huge provider response</html>'}},[
   {origin:'handoff',shopifyOrderId:'900001',shopifyOrderName:'#NEONT900001'}
 ]);
 assert.match(msg,/MANUAL_PAID_CLAIM_UNCONFIRMED/);assert.match(msg,/executionId=123/);
 assert.match(msg,/httpStatus=502/);assert.match(msg,/candidateOrderIds=900001/);
 assert.match(msg,/selection=unknown/);assert.doesNotMatch(msg,/do-not-copy|<html>/);
 assert.match(message({error:'timeout'}),/candidateOrderIds=none/);
 assert.match(message({error:'timeout'}),/httpStatus=unknown/);
 assert.doesNotMatch(message({error:{message:'timeout'}},[{shopifyOrderId:'secret@invalid.test'}]),/secret@/);
 assert.match(message({},[],'456'),/CONTEXT_INVALID/,'different execution must not be claimed as its own');
 const long=message({error:'timeout'},Array.from({length:201},(_,i)=>({shopifyOrderId:String(900000+i)})));
 assert.ok(long.length<900,'alert message stays bounded');assert.match(long,/candidateCount=201/);
 for(const node of base.nodes.filter(n=>n.id!==claim.id)) assert.deepEqual(wf.nodes.find(n=>n.id===node.id),node);
 assert.deepEqual(claim.parameters,base.nodes.find(n=>n.id===claim.id).parameters);
 assert.deepEqual(wf.settings,base.settings);assert.equal(wf.active,true);
});
test('Manual Paid alerts reach support without changing other routes',()=>{
 const expr=process.env.MANUAL_PAID_ALERT_PATCH ? JSON.parse(readFileSync(process.env.MANUAL_PAID_ALERT_PATCH)).operations[0].updates['parameters.toRecipients'] : base.alertRecipient;
 const recipient=new Function('$json','return ('+expr.slice(3,-2).trim()+')');
 assert.equal(recipient({source_workflow_id:'6NZnfGpyfUVikqpf'}),'support@neontrip.de');
 assert.equal(recipient({metadata:{affected_workflow_ids:['6NZnfGpyfUVikqpf']}}),'support@neontrip.de');
 for(const id of ['u48KZyTcU2J9pw2P','wqaTsVKuKqKnp2AG','cW08nxn9ANfGFEou']) assert.equal(recipient({source_workflow_id:id}),'support@neontrip.de');
 assert.equal(recipient({source_workflow_id:'unrelated'}),'info@NeonTrip.de');
});
