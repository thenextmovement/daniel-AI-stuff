import test from 'node:test';
import assert from 'node:assert/strict';
import {readCheckoutAttribution,createCheckoutClient} from '../deploy/configurator/checkout-client.js';

const granted={analytics:true,marketing:true,preferences:true};
const denied={analytics:true,marketing:false,preferences:false};
function browser(search='',gtag=()=>{}){
  return {location:{hostname:'anfrage.neontrip.de',search},Cookiebot:{hasResponse:true,consent:{statistics:true,marketing:true,preferences:true}},gtag};
}
function checkout({choice=granted,attribution={gclid:'TestClick_123'},respond=()=>{}}={}){
  const state={choice,requests:[],reads:0};
  const items=[{quantity:2,design:{mode:'text',text:'TEST',fontId:'Waikiki'},snapshot:{mode:'text',text:'TEST',font:{id:'Waikiki'},sign:{glyphs:[]},plate:{},mount:{}}}];
  const client=createCheckoutClient({readSession:async()=>'a'.repeat(43),saveSession:async v=>v,readFile:async()=>{throw Error('no upload');},
    readVisitorConsent:()=>state.choice,readAttribution:async()=>{state.reads++;return typeof attribution==='function'?attribution(state):attribution;},
    fetcher:async(_url,options)=>{
      const body=JSON.parse(options.body);state.requests.push(body);
      const receipt={id:'b'.repeat(64),status:'CREATED',priceVersion:'approved-v1',currency:'EUR',subtotalCents:32310,blockers:[],delivery:body.delivery,visitorConsent:body.visitorConsent,checkoutUrl:'https://www.neontrip.de/cart/c/test?key=keep&_cs=consent%2Bkeep'};
      respond(receipt,state);
      return new Response(JSON.stringify(receipt),{headers:{'content-type':'application/json'}});
    }});
  return {state,prepare:()=>client.prepare(items,{dateIso:'2026-10-29',businessDays:15},32310)};
}

test('current click IDs and campaign survive; private design, email, fragment and linker are excluded',async()=>{
  const result=await readCheckoutAttribution(browser('?gclid=Click-1&gbraid=Braid_2&wbraid=Braid.3&utm_source=google&utm_campaign=Konfigurator+DE&email=private%40example.com&text=PRIVATE&_gl=expired&key=bad'));
  assert.deepEqual(result,{gclid:'Click-1',gbraid:'Braid_2',wbraid:'Braid.3',utm_source:'google',utm_campaign:'Konfigurator DE'});
});
test('prior visit uses supported Google get only; current campaign never takes an older click ID',async()=>{
  const calls=[],r=browser('',(...args)=>{calls.push(args.slice(0,3));args[3]('PreviousClick');});
  assert.deepEqual(await readCheckoutAttribution(r),{gclid:'PreviousClick'});
  assert.deepEqual(calls,[['get','AW-314675901','gclid']]);
  for(const search of ['?wbraid=CurrentBraid','?gclid=bad%40id','?utm_source=other']){
    r.location.search=search;await readCheckoutAttribution(r);
  }
  assert.equal(calls.length,1);
});
test('no consent, analytics-only, withdrawal and preview never read or forward advertising IDs',async()=>{
  for(const alter of [r=>{delete r.Cookiebot;},r=>{r.Cookiebot.hasResponse=false;},r=>{r.Cookiebot.consent.marketing=false;},r=>{r.location.hostname='preview.pages.dev';}]){
    const r=browser('?gclid=Current',()=>assert.fail('No Google read allowed'));alter(r);
    assert.deepEqual(await readCheckoutAttribution(r),{});
  }
  const r=browser('',(_command,_tag,_field,done)=>{r.Cookiebot.consent.marketing=false;done('Old');});
  assert.deepEqual(await readCheckoutAttribution(r),{});
});
test('blocked or unavailable Google tag has a bounded fallback without blocking checkout',async()=>{
  const r=browser('',()=>{throw Error('blocked');});
  assert.deepEqual(await readCheckoutAttribution(r),{});
  assert.deepEqual(await readCheckoutAttribution(browser()),{});
});
test('malformed, oversized and control-character parameters are dropped',async()=>{
  assert.deepEqual(await readCheckoutAttribution(browser('?gclid=bad%40id&gbraid='+ 'x'.repeat(513)+'&utm_campaign=bad%0Avalue')),{});
});
test('one verified checkout gets attribution without changing request, cart, consent or payment key',async()=>{
  const r=checkout({attribution:{gclid:'Click-1',wbraid:'Braid',utm_source:'google',key:'bad',_cs:'bad',email:'PRIVATE'}});
  const first=r.prepare(),second=r.prepare();assert.equal(first,second);
  const result=await first,url=new URL(result.checkoutUrl);
  assert.equal(r.state.requests.length,1);assert.equal(r.state.reads,1);
  assert.equal(url.searchParams.get('key'),'keep');assert.equal(url.searchParams.get('_cs'),'consent+keep');
  assert.equal(url.searchParams.get('gclid'),'Click-1');assert.equal(url.searchParams.get('wbraid'),'Braid');
  assert.equal(url.searchParams.has('email'),false);
  const baseline=checkout();await baseline.prepare();
  assert.deepEqual(r.state.requests,baseline.state.requests);
  assert.equal(result.id,'b'.repeat(64));
});
test('denied or absent marketing consent never calls attribution reader',async()=>{
  for(const choice of [denied,null]){
    const r=checkout({choice:choice??undefined});
    if(choice===null)r.state.choice=undefined;
    const result=await r.prepare();assert.equal(r.state.reads,0);
    assert.equal(new URL(result.checkoutUrl).searchParams.has('gclid'),false);
  }
});
test('a changed choice during Google read stops before Shopify; a changed choice during request stops navigation',async()=>{
  const before=checkout({attribution:state=>{state.choice=denied;return {gclid:'Old'};}});
  await assert.rejects(before.prepare(),{code:'CONSENT_CHANGED'});assert.equal(before.state.requests.length,0);
  const during=checkout({respond:(_receipt,state)=>{state.choice=denied;}});
  await assert.rejects(during.prepare(),{code:'CONSENT_CHANGED'});assert.equal(during.state.requests.length,1);
});
test('tracking errors do not block purchase and cannot bypass destination or price validation',async()=>{
  const r=checkout({attribution:()=>{throw Error('blocked');}});
  assert.equal((await r.prepare()).status,'CREATED');
  for(const [change,code] of [[receipt=>{receipt.checkoutUrl='https://evil.example/cart/c/test';},'INVALID_RESPONSE'],[receipt=>{receipt.subtotalCents=1;},'PRICE_CHANGED']]){
    await assert.rejects(checkout({respond:change}).prepare(),{code});
  }
});
test('an existing Shopify attribution parameter is preserved without adding duplicates',async()=>{
  const r=checkout({respond:receipt=>{receipt.checkoutUrl+='&gclid=Existing';}});
  const url=new URL((await r.prepare()).checkoutUrl);
  assert.deepEqual(url.searchParams.getAll('gclid'),['Existing']);
});
