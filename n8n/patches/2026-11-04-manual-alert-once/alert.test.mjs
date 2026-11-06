import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const code=fs.readFileSync(new URL('./prepare-alert.js',import.meta.url),'utf8');
function run(execution,id='6NZnfGpyfUVikqpf',state={}){return new Function('$input','$getWorkflowStaticData',code)({first:()=>({json:{workflow:{id,name:'NEONTRIP Manual Shopify Paid → Qonto Reconciliation v1'},execution}})},()=>state);}
const execution=(id,order,status=502)=>({id,lastNodeExecuted:'Stop Unconfirmed Manual Paid Claim',error:{message:`MANUAL_PAID_CLAIM_UNCONFIRMED; executionId=${id}; operation=claim; httpStatus=${status}; candidateOrderIds=${order}; candidateCount=1; selection=unknown; Übernahme nicht bestätigt.`}});
test('three concurrent executions for different candidate orders use one durable incident key',()=>{
 const results=[['10007383','8810000000001'],['10007390','8810000000002'],['10007394','8810000000003']].map(([id,o])=>run(execution(id,o))[0].json);
 assert.ok(results[0].metadata.manual_paid_alert_key,'must request durable claim');
 assert.equal(new Set(results.map(r=>r.metadata.manual_paid_alert_key)).size,1);
 assert.deepEqual(results.map(r=>r.metadata.manual_paid_candidate_order_ids),[['8810000000001'],['8810000000002'],['8810000000003']]);
});
test('static-data cooldown cannot hide another unknown claim from durable incident evidence',()=>{
 const state={}; const a=run(execution('10007383','8810000000001'),'6NZnfGpyfUVikqpf',state);
 const b=run(execution('10007390','8810000000002'),'6NZnfGpyfUVikqpf',state);
 assert.equal(a.length,1); assert.equal(b.length,1);
});
test('different HTTP failures remain distinct incidents',()=>{
 assert.notEqual(run(execution('1','1',502))[0].json.metadata.manual_paid_alert_key,run(execution('2','2',401))[0].json.metadata.manual_paid_alert_key);
});
test('unrelated workflows preserve their existing static cooldown',()=>{
 const state={}; assert.equal(run(execution('100001','200001'),'other',state).length,1); assert.equal(run(execution('100002','200002'),'other',state).length,0);
});
test('manual claim mail explains uncertainty and single-incident grouping in paragraphs',()=>{
 const body=run(execution('1','1'))[0].json.body_html;
 assert.match(body,/keine fehlende Kundenzahlung/); assert.match(body,/nur eine E-Mail/); assert.doesNotMatch(body,/15 Minuten lang/); assert.ok((body.match(/<p>/g)||[]).length>=3);
});

const guard=fs.readFileSync(new URL('./guard.js',import.meta.url),'utf8');
function approve(response){return new Function('$input','$',guard)({first:()=>({json:response})},()=>({first:()=>({json:{metadata:{execution_id:'123'},body_html:'<p>Test</p>'}})}));}
test('only explicit boolean approval can reach the send node',()=>{
 assert.equal(approve({statusCode:200,body:{approved:true}}).length,1);
 assert.equal(approve({statusCode:200,body:{approved:false}}).length,0);
 for(const response of [{statusCode:502,body:{approved:true}},{statusCode:200,body:{approved:'true'}},{statusCode:200,body:{}}]) assert.throws(()=>approve(response),/claim_unconfirmed/);
});
