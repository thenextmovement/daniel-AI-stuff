import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cookiebotVisitorConsent,createCheckoutClient} from '../deploy/configurator/checkout-client.js';

const denied={analytics:false,marketing:false,preferences:false};
const granted={analytics:true,marketing:true,preferences:true};
const delivery={dateIso:'2026-10-29',businessDays:15};
const items=[{quantity:1,design:{mode:'text',text:'TEST',fontId:'Waikiki'},snapshot:{mode:'text',text:'TEST',font:{id:'Waikiki'},sign:{glyphs:[]},plate:{},mount:{}}}];
const session='a'.repeat(43);
function fixture(options={}){
  const choice=Object.hasOwn(options,'choice')?options.choice:denied,{respond}=options;
  const state={choice,calls:[]};
  const client=createCheckoutClient({readSession:async()=>session,saveSession:async value=>value,readFile:async()=>{throw new Error('No upload expected');},readVisitorConsent:()=>state.choice,fetcher:async(url,options)=>{
    const body=JSON.parse(options.body);state.calls.push({url,body,token:options.headers['X-Neontrip-Cart-Token']});
    const receipt={id:'b'.repeat(64),status:'CREATED',priceVersion:'approved-v1',currency:'EUR',subtotalCents:32310,blockers:[],delivery:body.delivery,checkoutUrl:'https://www.neontrip.de/cart/c/test?key=test&consent=encoded'};
    if(body.visitorConsent!==undefined)receipt.visitorConsent=body.visitorConsent;
    await respond?.(receipt,state);
    return new Response(JSON.stringify(receipt),{status:200,headers:{'content-type':'application/json'}});
  }});
  return {state,prepare:()=>client.prepare(items,delivery,32310)};
}

test('only an explicit Cookiebot choice becomes checkout consent',()=>{
  assert.equal(cookiebotVisitorConsent(undefined),undefined);
  assert.equal(cookiebotVisitorConsent({hasResponse:false,consent:{statistics:false,marketing:false,preferences:false}}),undefined);
  assert.deepEqual(cookiebotVisitorConsent({hasResponse:true,consent:{statistics:true,marketing:false,preferences:true}}),{analytics:true,marketing:false,preferences:true});
  assert.throws(()=>cookiebotVisitorConsent({hasResponse:true,consent:{statistics:'false',marketing:false,preferences:false}}),{code:'INVALID_CONSENT'});
});
for(const choice of [denied,granted,{analytics:true,marketing:false,preferences:false},undefined]){
  test(`checkout preserves explicit purposes or absent choice: ${JSON.stringify(choice)}`,async()=>{
    const {prepare,state}=fixture({choice});
    const result=await prepare();
    assert.equal(result.status,'CREATED');
    assert.deepEqual(state.calls[0].body.visitorConsent,choice);
    assert.equal(Object.hasOwn(state.calls[0].body.items[0],'visitorConsent'),false);
    assert.equal(new URL(result.checkoutUrl).searchParams.get('consent'),'encoded');
    assert.equal(state.calls.length,1);
  });
}
test('an old backend ignoring consent cannot trigger checkout navigation',async()=>{
  const {prepare}=fixture({respond:receipt=>{delete receipt.visitorConsent;}});
  await assert.rejects(prepare(),{code:'INVALID_CONSENT'});
});
test('a mismatching consent receipt cannot trigger checkout navigation',async()=>{
  const {prepare}=fixture({respond:receipt=>{receipt.visitorConsent=granted;}});
  await assert.rejects(prepare(),{code:'INVALID_CONSENT'});
});
for(const [before,after] of [[granted,denied],[undefined,denied],[denied,undefined]]){
test(`a choice change ${JSON.stringify(before)} -> ${JSON.stringify(after)} stops the stale URL without an automatic retry`,async()=>{
  let first=true;
  const {prepare,state}=fixture({choice:before,respond:(_receipt,current)=>{if(first){first=false;current.choice=after;}}});
  await assert.rejects(prepare(),{code:'CONSENT_CHANGED'});
  assert.equal(state.calls.length,1);
  const result=await prepare();
  assert.equal(result.status,'CREATED');
  assert.equal(state.calls.length,2);
  assert.equal(state.calls[0].token,state.calls[1].token);
  assert.deepEqual(state.calls[0].body.items,state.calls[1].body.items);
  assert.deepEqual(state.calls[0].body.delivery,state.calls[1].body.delivery);
  assert.deepEqual(state.calls[1].body.visitorConsent,after);
});
}
test('a choice changed while an asset uploads is read after the upload finishes',async()=>{
  let choice=granted,releaseUpload,announceUpload;
  const uploadGate=new Promise(resolve=>{releaseUpload=resolve;});
  const uploadStarted=new Promise(resolve=>{announceUpload=resolve;});
  const calls=[],sha=createHash('sha256').update('font').digest('hex');
  const uploadedItems=structuredClone(items);uploadedItems[0].design.fontId='upload-test';
  const client=createCheckoutClient({readSession:async()=>session,saveSession:async value=>value,readFile:async()=>new Blob(['font']),readVisitorConsent:()=>choice,fetcher:async(url,options)=>{
    calls.push({url,token:options.headers['X-Neontrip-Cart-Token']});
    let receipt;
    if(url.endsWith('/assets')){
      announceUpload();await uploadGate;
      receipt={id:sha,sha256:sha,kind:'font',byteLength:4};
    }else{
      const body=JSON.parse(options.body);
      assert.deepEqual(body.visitorConsent,denied);
      receipt={id:'b'.repeat(64),status:'CREATED',priceVersion:'approved-v1',currency:'EUR',subtotalCents:32310,blockers:[],delivery:body.delivery,visitorConsent:body.visitorConsent,checkoutUrl:'https://www.neontrip.de/cart/c/test?key=test&consent=encoded'};
    }
    return new Response(JSON.stringify(receipt),{status:200,headers:{'content-type':'application/json'}});
  }});
  const pending=client.prepare(uploadedItems,delivery,32310);
  await uploadStarted;choice=denied;releaseUpload();
  assert.equal((await pending).status,'CREATED');
  assert.equal(calls.length,2);
  assert.equal(calls[0].token,calls[1].token);
});
test('simultaneous clicks share one checkout request',async()=>{
  const {prepare,state}=fixture();
  const first=prepare(),second=prepare();
  assert.equal(first,second);
  await Promise.all([first,second]);
  assert.equal(state.calls.length,1);
});
test('a mismatching purchase price remains blocked',async()=>{
  const {prepare}=fixture({respond:receipt=>{receipt.subtotalCents=32311;}});
  await assert.rejects(prepare(),{code:'PRICE_CHANGED'});
});
