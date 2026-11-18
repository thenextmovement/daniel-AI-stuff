import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const baseline=JSON.parse(fs.readFileSync('workflows/manual-paid/gateway-baseline.json'));
const patch=fs.existsSync('workflows/manual-paid/gateway.patch.json')?JSON.parse(fs.readFileSync('workflows/manual-paid/gateway.patch.json')):{operations:[]};
const nodes=structuredClone(baseline.nodes);
for(const op of patch.operations){const n=nodes.find(n=>n.name===op.nodeName);Object.assign(n,op.updates);}
const node=name=>nodes.find(n=>n.name===name);
const source=fs.readFileSync('src/lib/ops/billing/manual-paid-reconciliation.ts','utf8').split('export function validManualPaidCompletion')[0].replace(/^import .*;\n/m,'').replace(/export /g,'');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const request={scope:'MANUAL_SHOPIFY_PAID',operation:'claim',worker:'manual-paid-reconciliation',executionId:'1234',jobTypes:['RECONCILE'],leaseSeconds:120,candidates:[]};
function run(prepared,response){return vm.runInNewContext('(function(){'+node('Restore Verified Billing Intake').parameters.jsCode+'})()',{$:()=>({first:()=>({json:prepared})}),$input:{first:()=>({json:response})}});}
const health={statusCode:200,body:[]};
test('claim and availability no longer depend on deploying OPS web server',()=>{
 for(const name of ['Check Billing API Availability','Recheck Billing API Availability','Admit or Claim Manual Paid Reconciliation']){
 const n=node(name);assert.equal(new URL(n.parameters.url).hostname,'klibiejfisijpagzkxls.supabase.co');assert.deepEqual(n.credentials,baseline.readCredential);
 }
 const n=node('Admit or Claim Manual Paid Reconciliation');assert.equal(n.retryOnFail,false);assert.equal(n.onError,'continueErrorOutput');assert.equal(n.parameters.jsonBody,'={{ {p_request: $json.request} }}');
});
test('healthy database with zero rows preserves intake and normalizes revision exactly like server',()=>{
 const p={request:{...request,candidates:[{origin:'handoff',shopifyOrderId:'123',shopifyOrderName:'#NEONT123',sourceRevision:{updatedAt:'2026-11-17T12:00:00Z',financialStatus:'paid',cancelledAt:null,refundCount:0,manualPaidObserved:true,paymentRoute:'VORKASSE',untrustedExtra:'omit'}}]},prospectivePending:{keep:true},existingLegacyIds:[]};
 const result=JSON.parse(JSON.stringify(run(p,health)[0].json));
 const expected=vm.runInNewContext(compiled+'; ({...input, candidates:input.candidates.map(c=>({...c,sourceRevision:manualPaidSourceRevision(c.sourceRevision)}))})',{input:p.request});
 assert.deepEqual(result,{...p,request:JSON.parse(JSON.stringify(expected))});
});
test('availability failures stop before claim, including misleading OPS health response',()=>{
 for(const r of [{statusCode:502,body:[]},{statusCode:200,body:{ok:true}},{statusCode:200,body:[{id:1}]},{body:[]}])assert.throws(()=>run({request},r),/BILLING_API_UNAVAILABLE/);
});
test('preserves all server input validation gates',()=>{
 const cases=[request,{...request,operation:'admit'},{...request,scope:'OTHER'},{...request,leaseSeconds:601},{...request,executionId:'x'},{...request,jobTypes:['CREATE_INVOICE']},{...request,candidates:[{origin:'handoff',shopifyOrderId:'123',shopifyOrderName:'#NEONT123',amountCents:-1}]},{...request,candidates:[{origin:'handoff',shopifyOrderId:'123',shopifyOrderName:'#NEONT123',sourceRevision:{invalid:true}}]}];
 for(const input of cases){const valid=vm.runInNewContext(compiled+';validManualPaidClaim(input)',{input});if(valid)assert.equal(run({request:input},health).length,1);else assert.throws(()=>run({request:input},health),/MANUAL_PAID_REQUEST_INVALID/);}
 assert.ok(node('Restore Verified Billing Intake').parameters.jsCode.includes(compiled.trim()));
});
test('patch is limited to four nodes and preserves stop/retry/timeouts',()=>{
 assert.equal(patch.operations.length,4);
 for(const n of nodes){const old=baseline.nodes.find(x=>x.name===n.name);assert.equal(n.id,old.id);assert.deepEqual(n.position,old.position);assert.equal(n.retryOnFail,old.retryOnFail);assert.equal(n.onError,old.onError);assert.deepEqual(n.parameters.options,old.parameters.options);}
});
