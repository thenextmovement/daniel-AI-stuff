import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmPersistedPaidCompletion, restoreReadyIntake } from './n8n_database_availability.mjs';

const expected = () => ({jobId:'11111111-1111-4111-8111-111111111111', request:{
 scope:'MANUAL_SHOPIFY_PAID', executionId:'12345', inputGeneration:3,
 inputFingerprint:'a'.repeat(64), bindingFingerprint:'b'.repeat(64), outcome:'EXACT_INVOICE_PAID',
 proof:{easybillDocumentId:'123456',easybillNumber:'#NEONT1234',invoiceAmountCents:12999,paidCents:12999,expectedAmountCents:12999,currency:'EUR'}
}});
function receipt() {
 const e=expected();
 return {statusCode:200,body:[{id:e.jobId,billing_case_id:'22222222-2222-4222-8222-222222222222',job_type:'RECONCILE',status:'DONE',scope:'MANUAL_SHOPIFY_PAID',
 last_error:null,next_attempt_at:null,lease_expires_at:null,input_generation:3,input_fingerprint:e.request.inputFingerprint,
 claim:{executionId:'12345',inputGeneration:3,inputFingerprint:e.request.inputFingerprint,bindingFingerprint:e.request.bindingFingerprint,startedAt:'2026-10-20T13:00:00Z'},
 last_check:{executionId:'12345',inputFingerprint:e.request.inputFingerprint,bindingFingerprint:e.request.bindingFingerprint,outcome:'EXACT_INVOICE_PAID',recordedAt:'2026-10-20T13:00:01Z',proof:{...e.request.proof}}
 }]};
}
const lost = {error:{httpCode:'409',description:'BILLING_JOB_LEASE_INVALID'}};
test('acknowledges a committed exact-paid receipt after its HTTP response was lost',()=>{
 const got=confirmPersistedPaidCompletion(expected(),receipt(),lost);
 assert.deepEqual(got,{statusCode:200,body:{ok:true,completed:{jobId:'11111111-1111-4111-8111-111111111111',billingCaseId:'22222222-2222-4222-8222-222222222222',status:'DONE',nextAttemptAt:null,outcome:'EXACT_INVOICE_PAID',disposition:'RECORDED'}}});
});
for (const [label,mutate] of [
 ['missing row',r=>r.body=[]],['multiple rows',r=>r.body.push(r.body[0])],['failed read',r=>r.statusCode=503],
 ['wrong job',r=>r.body[0].id='another'],['blocked job',r=>r.body[0].status='BLOCKED'],
 ['new input generation',r=>r.body[0].input_generation=4],['changed input',r=>r.body[0].input_fingerprint='c'.repeat(64)],
 ['other execution',r=>r.body[0].last_check.executionId='12346'],['changed binding',r=>r.body[0].last_check.bindingFingerprint='c'.repeat(64)],
 ['other claim',r=>r.body[0].claim.executionId='12346'],['old claim generation',r=>r.body[0].claim.inputGeneration=2],
 ['unconfirmed outcome',r=>r.body[0].last_check.outcome='OUTCOME_UNKNOWN'],['different amount',r=>r.body[0].last_check.proof.paidCents=12998],
 ['different invoice',r=>r.body[0].last_check.proof.easybillDocumentId='9999'],['unreleased lease',r=>r.body[0].lease_expires_at='2026-10-20T13:02:00Z'],
 ['outstanding error',r=>r.body[0].last_error='ERROR'],['scheduled recheck',r=>r.body[0].next_attempt_at='2026-10-20T14:00:00Z'],
 ['receipt predates claim',r=>r.body[0].last_check.recordedAt='2026-10-20T12:00:00Z']
]) test('does not acknowledge '+label,()=>{const r=receipt();mutate(r);assert.throws(()=>confirmPersistedPaidCompletion(expected(),r,lost),/UNCONFIRMED/);});
test('does not conceal authorization failure with a stored receipt',()=>{
 assert.throws(()=>confirmPersistedPaidCompletion(expected(),receipt(),{error:{httpCode:'401'}}),/UNCONFIRMED/);
});
test('never acknowledges unknown payment effects',()=>{
 const e=expected();e.request.outcome='BILLING_PAYMENTS_REGISTERED';
 assert.throws(()=>confirmPersistedPaidCompletion(e,receipt(),lost),/UNCONFIRMED/);
});
test('accepts reordered JSON proof keys after a transport timeout',()=>{
 const r=receipt(); r.body[0].last_check.proof=Object.fromEntries(Object.entries(r.body[0].last_check.proof).reverse());
 assert.equal(confirmPersistedPaidCompletion(expected(),r,{error:{code:'ETIMEDOUT'}}).body.ok,true);
});
test('health check restores exactly the original request without creating a claim',()=>{
 const p={request:{executionId:'12345',candidates:[]},unchanged:true};
 assert.strictEqual(restoreReadyIntake(p,{statusCode:200,body:{ok:true,service:'neontrip-ops',commit:'c'.repeat(40)}}),p);
});
for(const r of [{statusCode:502,body:{}},{statusCode:200,body:{ok:false,service:'neontrip-ops'}},{statusCode:200,body:{ok:true,service:'wrong'}},{error:'timeout'}]) {
 test('unhealthy API cannot reach claim '+JSON.stringify(r),()=>assert.throws(()=>restoreReadyIntake({request:{}},r),/UNAVAILABLE/));
}

test('accepts actual n8n Axios error outlet shapes',()=>{
 for(const error of [
 {message:'409 - {"ok":false,"error":"BILLING_JOB_LEASE_INVALID"}',name:'AxiosError',code:'ERR_BAD_REQUEST',status:409},
 {message:'502 - Bad gateway',name:'AxiosError',code:'ERR_BAD_RESPONSE',status:502},
 {message:'timeout of 1ms exceeded',name:'AxiosError',code:'ECONNABORTED'}
 ]) assert.equal(confirmPersistedPaidCompletion(expected(),receipt(),{error}).body.ok,true);
});
