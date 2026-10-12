import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createFailureReporter,sanitizeFailureReport} from '../deploy/configurator/failure-reporting.js';
import {onRequestPost} from '../functions/api/r.js';
import {createCheckoutClient,checkoutPayload} from '../deploy/configurator/checkout-client.js';

const now=()=>Date.now();
const payload=(extra={})=>({kind:'configurator_failure',version:1,stage:'checkout',code:'GEOMETRY_MISMATCH',attemptId:randomUUID(),source:'client',browser:'safari',build:'test',occurredAt:new Date().toISOString(),...extra});
test('sanitizer keeps only technical fields and refuses ordinary validation or arbitrary codes',()=>{
  const safe=sanitizeFailureReport(payload({text:'PRIVATE',url:'https://example.test/?token=SECRET',email:'customer@example.test',stack:'secret',proxy_ip:'127.0.0.1',path:'/checkout/secret'}));
  assert.equal(safe.path,'/configurator/');
  assert.equal(/PRIVATE|SECRET|customer|127.0.0.1/.test(JSON.stringify(safe)),false);
  for(const code of ['INVALID_DELIVERY','DELIVERY_TOO_EARLY','EMPTY_TEXT','UNKNOWN','<script>'])assert.equal(sanitizeFailureReport(payload({code})),null);
  assert.equal(sanitizeFailureReport(payload({attemptId:'cart-token-secret'})),null);
  for(const stage of ['constructor','__proto__','toString'])assert.equal(sanitizeFailureReport(payload({stage})),null);
  assert.equal(sanitizeFailureReport(payload({occurredAt:'2020-01-01T00:00:00Z'})),null);
});
test('same incident is sent once, changed attempt can report, transport failure never retries or rejects',async()=>{
  const calls=[],reporter=createFailureReporter({now,userAgent:'Mozilla Safari iPhone PRIVATE',fetcher:async(url,init)=>{calls.push({url,init});throw new Error('PRIVATE provider body');}});
  const event={stage:'calculation',code:'WORKER_TIMEOUT',attemptId:randomUUID()};
  assert.equal(await reporter.report(event),false);
  assert.equal(await reporter.report(event),false);
  assert.equal(calls.length,1);
  await reporter.report({...event,attemptId:randomUUID()});assert.equal(calls.length,2);
  assert.equal(calls[0].url,'/api/r?kind=configurator_failure');
  assert.equal(JSON.parse(calls[0].init.body).browser,'safari');
  assert.equal(calls[0].init.credentials,'omit');assert.equal(calls[0].init.keepalive,true);
  assert.equal(/PRIVATE/.test(calls[0].init.body),false);
});
test('Pages configurator branch is bounded and sanitized; old form alerts retain behavior',async()=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(_url,options)=>{calls.push(JSON.parse(options.body));return new Response('',{status:200});};
  const request=(body,query='?kind=configurator_failure',origin='https://anfrage.neontrip.de')=>new Request('https://anfrage.neontrip.de/api/r'+query,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':'127.0.0.1'},body:JSON.stringify(body)});
  try{
    const data=payload({text:'PRIVATE',email:'PRIVATE',cf_city:'PRIVATE'});
    assert.equal((await onRequestPost({request:request(data)})).status,202);
    assert.equal(calls.length,1);assert.equal(/PRIVATE|127.0.0.1/.test(JSON.stringify(calls[0])),false);
    assert.equal((await onRequestPost({request:request(data)})).status,429);assert.equal(calls.length,1);
    assert.equal((await onRequestPost({request:request(payload(),'','https://elsewhere.test')})).status,200); // Legacy unchanged.
    calls.length=0;
    assert.equal((await onRequestPost({request:request(payload({nt_dry_run:true}))})).status,200);assert.equal(calls.length,0);
    assert.equal((await onRequestPost({request:request(payload(),'?kind=configurator_failure','https://elsewhere.test')})).status,403);
    assert.equal((await onRequestPost({request:request(payload({padding:'x'.repeat(5000)}))})).status,400);assert.equal(calls.length,0);
    await onRequestPost({request:request({form:'existing-form',error:'upstream_timeout'},'')});
    assert.equal(calls[0].form,'existing-form');assert.equal(calls[0].proxy_ip,'127.0.0.1');
  }finally{globalThis.fetch=original;}
});
test('checkout clicks share one attempt; retry gets a new incident without changing owner or cart',async()=>{
  const calls=[],items=[{quantity:1,design:{mode:'text',text:'TEST',fontId:'Waikiki'},snapshot:{mode:'text',text:'TEST',font:{id:'Waikiki'},sign:{glyphs:[]},plate:{},mount:{}}}];
  const client=createCheckoutClient({readSession:async()=> 'a'.repeat(43),saveSession:async value=>value,readFile:async()=>null,fetcher:async(url,init)=>{calls.push({url,init});return Response.json({error:{code:'GEOMETRY_MISMATCH'}},{status:422});}});
  const prepare=()=>client.prepare(items,{dateIso:'2026-12-01',businessDays:15},18900);
  const first=prepare(),same=prepare();assert.equal(first,same);
  let firstError;try{await first;}catch(error){firstError=error;}
  assert.equal(firstError.code,'GEOMETRY_MISMATCH');assert.equal(firstError.attemptId,calls[0].init.headers['X-Neontrip-Attempt-ID']);
  await assert.rejects(prepare(),{code:'GEOMETRY_MISMATCH'});
  assert.equal(calls.length,2);assert.notEqual(calls[0].init.headers['X-Neontrip-Attempt-ID'],calls[1].init.headers['X-Neontrip-Attempt-ID']);
  assert.equal(calls[0].init.body,calls[1].init.body);assert.equal(calls[0].init.headers['X-Neontrip-Cart-Token'],calls[1].init.headers['X-Neontrip-Cart-Token']);
});
test('checkout retains the declared raster version and leaves legacy drafts unversioned',()=>{
  const item={quantity:1,design:{mode:'text',text:'TEST',fontId:'Waikiki'},snapshot:{mode:'text',text:'TEST',font:{id:'Waikiki'},sign:{glyphs:[]},plate:{},mount:{}}};
  const delivery={dateIso:'2026-12-01',businessDays:15};
  const legacy=checkoutPayload([item],delivery).items[0];
  assert.equal(Object.hasOwn(legacy.design,'rasterVersion'),false);assert.equal(Object.hasOwn(legacy.snapshot,'rasterVersion'),false);
  item.design.rasterVersion=2;item.snapshot.rasterVersion=2;
  const current=checkoutPayload([item],delivery).items[0];
  assert.equal(current.design.rasterVersion,2);assert.equal(current.snapshot.rasterVersion,2);
});
