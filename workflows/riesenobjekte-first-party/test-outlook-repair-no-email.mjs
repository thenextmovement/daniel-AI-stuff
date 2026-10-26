import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyAutoReplyGuard, patch} from './outlook-attachment-metadata-patch.mjs';
const baseline=readFileSync(new URL('./fixtures/outlook-autoreply-before-repair-hold.js',import.meta.url),'utf8');
const code=process.env.TEST_BASELINE==='1'?baseline:applyAutoReplyGuard(baseline);
function run(source, selectedCode=code) {
  return new Function('$',selectedCode)(name=>({first:()=>({json:
    name==='Normalize Oldest Outlook Inquiry'?source:
    name==='Assess Existing Lead'?{existingLead:{}}:
    name==='Evaluate Processing Complete'?{ready:true,trelloCardId:'fixture-card'}:{}
  })}));
}
for(const id of ['000ff1ce-9f42-48bc-8aa0-428d5d9d4288','000ff1ce-39ed-4e3b-8738-ede2243bede6']){
 test(id+' produces no wait/send/result input',()=>{
  assert.deepEqual(run({submissionId:id,idempotencyKey:'riesenobjekte-first-party:'+id,senderEmail:'customer@example.test'}),[]);
 });
}
test('matching durable request key also suppresses without submissionId',()=>{
 assert.deepEqual(run({idempotencyKey:'riesenobjekte-first-party:000ff1ce-9f42-48bc-8aa0-428d5d9d4288'}),[]);
});
test('unrelated inquiry keeps original reply content and behavior',()=>{
 const input={submissionId:'unrelated',idempotencyKey:'riesenobjekte-first-party:unrelated',senderEmail:'person@example.test',senderName:'Example Person'};
 assert.deepEqual(run(input),run(input,baseline));assert.equal(run(input).length,1);
});
test('guard refuses changed or already patched source',()=>{
 assert.throws(()=>applyAutoReplyGuard('different'),/baseline mismatch/);
 assert.throws(()=>applyAutoReplyGuard(applyAutoReplyGuard(baseline)),/baseline mismatch/);
});
test('release patch contains only normalizer and reply builder code changes',()=>{
 assert.deepEqual(patch.operations.map(x=>x.nodeName),['Normalize Oldest Outlook Inquiry','Build Normal AutoReply']);
 assert.ok(patch.operations.every(x=>x.fieldPath==='parameters.jsCode'));
});
