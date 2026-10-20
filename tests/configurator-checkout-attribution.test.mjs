import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const moduleUrl=process.env.NEONTRIP_CONFIGURATOR_ROOT
  ? pathToFileURL(resolve(process.env.NEONTRIP_CONFIGURATOR_ROOT,'checkout-client.js'))
  : new URL('../deploy/configurator/checkout-client.js',import.meta.url);
assert.equal(readFileSync(moduleUrl,'utf8'),readFileSync(new URL('../deploy/configurator/checkout-client.js',import.meta.url),'utf8'),'Test the exact committed handoff source with the verified release dependencies');
const {readCheckoutAttribution,createCheckoutClient,rememberCheckoutAttribution,initCheckoutAttribution}=await import(moduleUrl);

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

const contextKey='nt_attr_google_checkout_v1';
function savedBrowser(search=''){
  const r=browser(search,()=>assert.fail('Saved context must not need Google or send events'));
  const entries=new Map(),listeners=new Map();
  r.sessionStorage={getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)};
  r.localStorage={getItem:()=>assert.fail('Untimed localStorage must not be read')};
  r.document={referrer:''};
  r.addEventListener=(name,cb)=>{const list=listeners.get(name)||[];list.push(cb);listeners.set(name,list);};
  return {r,entries,listeners};
}
test('all three Google click kinds survive removal of URL parameters in the same consented tab',async()=>{
  for(const key of ['gclid','gbraid','wbraid']){
    const {r}=savedBrowser('?'+key+'=SavedClick&utm_source=google&utm_campaign=Campaign');
    initCheckoutAttribution(r);
    r.location.search='';
    assert.deepEqual(await readCheckoutAttribution(r),{[key]:'SavedClick',utm_source:'google',utm_campaign:'Campaign'});
  }
});
test('an immediately referring landing page can confirm existing legacy session data',async()=>{
  for(const key of ['gclid','gbraid','wbraid']){
    const {r,entries}=savedBrowser();
    r.document.referrer='https://anfrage.neontrip.de/neon-schilder/?'+key+'=Saved&utm_source=google';
    entries.set('nt_attr_'+key,'Saved');
    initCheckoutAttribution(r);
    assert.deepEqual(await readCheckoutAttribution(r),{[key]:'Saved',utm_source:'google'});
  }
});
test('legacy cookie, stored landing URL, unrelated referrer and mismatched click do not establish freshness',async()=>{
  for(const referrer of ['', 'https://other.example/?gclid=Saved','https://anfrage.neontrip.de/logo/?gclid=Different']){
    const {r,entries}=savedBrowser();
    r.gtag=(_a,_b,_c,done)=>done(undefined);
    r.document.referrer=referrer;r.document.cookie='_neontrip_gclid=Saved';
    entries.set('nt_attr_gclid','Saved');
    entries.set('nt_attr_landing_page_url','https://anfrage.neontrip.de/logo/?gclid=Saved');
    assert.deepEqual(await readCheckoutAttribution(r),{});
  }
});
test('only the same campaign can supplement missing click IDs; a newer source remains a barrier on later navigation',async()=>{
  const {r,entries}=savedBrowser('?gclid=Saved&utm_source=google&utm_campaign=First');
  initCheckoutAttribution(r);
  r.location.search='?utm_source=google&utm_campaign=First';
  assert.deepEqual(await readCheckoutAttribution(r),{utm_source:'google',utm_campaign:'First',gclid:'Saved'});
  r.location.search='?utm_source=newsletter';
  assert.deepEqual(await readCheckoutAttribution(r),{utm_source:'newsletter'});
  assert.equal(JSON.parse(entries.get(contextKey)).blocked,true);
  r.location.search='';
  assert.deepEqual(await readCheckoutAttribution(r),{});
});
test('different Google campaign, another platform and malformed current click cannot resurrect older click context',async()=>{
  for(const search of ['?utm_source=google&utm_campaign=Second','?fbclid=Facebook','?msclkid=Bing','?twclid=Twitter','?gclid=bad%40id']){
    const {r,entries}=savedBrowser('?gclid=Old&utm_source=google&utm_campaign=First');
    initCheckoutAttribution(r);r.location.search=search;
    const result=await readCheckoutAttribution(r);
    assert.equal(result.gclid,undefined);
    assert.equal(JSON.parse(entries.get(contextKey)).blocked,true);
  }
});
test('expiry, future timestamps and broken storage fail safely without extending saved context',async()=>{
  for(const at of [Date.now()-30*60*1000-1,Date.now()+60000]){
    const {r,entries}=savedBrowser();
    entries.set(contextKey,JSON.stringify({at,values:{wbraid:'Old'}}));
    entries.set('nt_attr_wbraid','Old');
    r.document.referrer='https://anfrage.neontrip.de/logo/?wbraid=Old';
    r.gtag=(_a,_b,_c,done)=>done(undefined);
    assert.deepEqual(await readCheckoutAttribution(r),{});
  }
  const {r,entries}=savedBrowser('?gclid=Current');
  initCheckoutAttribution(r);
  const before=entries.get(contextKey);rememberCheckoutAttribution(r);
  assert.equal(entries.get(contextKey),before);
  r.sessionStorage={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}};
  assert.deepEqual(await readCheckoutAttribution(r),{gclid:'Current'});
});
test('storage is never read or written before consent and withdrawal clears only the handoff context',async()=>{
  for(const change of [r=>{delete r.Cookiebot},r=>{r.Cookiebot.hasResponse=false},r=>{r.Cookiebot.consent.marketing=false}]){
    const {r}=savedBrowser('?gclid=Current');change(r);
    r.sessionStorage={getItem(){assert.fail('No storage read')},setItem(){assert.fail('No storage write')},removeItem(){}};
    initCheckoutAttribution(r);assert.deepEqual(await readCheckoutAttribution(r),{});
  }
  const {r,entries,listeners}=savedBrowser('?wbraid=Current');
  initCheckoutAttribution(r);initCheckoutAttribution(r);
  assert.equal(listeners.get('CookiebotOnDecline').length,1);
  entries.set('neontrip-checkout-session-v1','Unchanged');
  r.Cookiebot.consent.marketing=false;
  for(const callback of listeners.get('CookiebotOnDecline'))callback();
  assert.equal(entries.has(contextKey),false);
  assert.equal(entries.get('neontrip-checkout-session-v1'),'Unchanged');
});
test('consent granted after loading captures the current URL without firing a conversion',async()=>{
  const {r,entries,listeners}=savedBrowser('?gbraid=Current');
  r.Cookiebot.hasResponse=false;initCheckoutAttribution(r);
  assert.equal(entries.size,0);
  r.Cookiebot.hasResponse=true;
  for(const callback of listeners.get('CookiebotOnAccept'))callback();
  r.location.search='';
  assert.deepEqual(await readCheckoutAttribution(r),{gbraid:'Current'});
});
test('stored click context passes through one checkout request without changing cart, consent, or transaction behavior',async()=>{
  const {r}=savedBrowser('?wbraid=Saved&utm_source=google');
  initCheckoutAttribution(r);r.location.search='';
  const c=checkout({attribution:()=>readCheckoutAttribution(r)});
  const a=c.prepare(),b=c.prepare();assert.equal(a,b);
  const result=await a,url=new URL(result.checkoutUrl);
  assert.equal(c.state.requests.length,1);
  assert.equal(url.searchParams.get('wbraid'),'Saved');
  assert.equal(url.searchParams.get('key'),'keep');
  assert.equal(url.searchParams.get('_cs'),'consent+keep');
  assert.equal('gclid' in c.state.requests[0],false);
  assert.equal('wbraid' in c.state.requests[0],false);
});
