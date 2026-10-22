import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const source=new URL('../deploy/configurator/checkout-client.js',import.meta.url);
const moduleUrl=process.env.NEONTRIP_CONFIGURATOR_ROOT?pathToFileURL(resolve(process.env.NEONTRIP_CONFIGURATOR_ROOT,'checkout-client.js')):source;
assert.equal(readFileSync(moduleUrl,'utf8'),readFileSync(source,'utf8'));
const {createCheckoutClient}=await import(moduleUrl);
const items=()=>[{quantity:1,design:{mode:'text',text:'TEST',fontId:'Waikiki'},snapshot:{mode:'text',text:'TEST',font:{id:'Waikiki'},sign:{glyphs:[]},plate:{},mount:{}}}];
const delivery=()=>({dateIso:'2026-11-12',businessDays:15});
function fixture(){
 const state={requests:[],consent:{analytics:true,marketing:false,preferences:false},next:[]};
 const client=createCheckoutClient({readSession:async()=>'a'.repeat(43),saveSession:async v=>v,readFile:async()=>assert.fail('No upload'),readVisitorConsent:()=>state.consent,
  fetcher:async(_url,options)=>{
   const body=JSON.parse(options.body);state.requests.push(body);
   const custom=state.next.shift();if(custom)return custom(body);
   return response(body,state.requests.length);
  }});
 function response(body,n=1,status='CREATED'){
  return Response.json({id:'b'.repeat(64),status,priceVersion:'approved-v1',currency:'EUR',subtotalCents:10000,blockers:[],delivery:body.delivery,visitorConsent:body.visitorConsent,checkoutUrl:'https://www.neontrip.de/cart/c/test?key=fresh'+n});
 }
 return {state,client,response};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('inspiration is a separate explicit owned action; early checkout never enrolls',async()=>{
 const f=fixture();await f.client.prepareEarly(items(),delivery(),10000);
 assert.equal(f.state.requests.some(body=>body.action==='inspiration_consent'),false);
 f.state.next.push(body=>Response.json({consent:body.consent}));
 await f.client.saveInspirationConsent('b'.repeat(64),{consent:true,version:'four-image-mails-inline-v2-20261014',position:1,context:'business',location:'Praxis'});
 assert.equal(f.state.requests.at(-1).action,'inspiration_consent');assert.equal(f.state.requests.at(-1).position,1);
 f.state.next.push(()=>Response.json({status:'CREATED'}));
 await assert.rejects(f.client.saveInspirationConsent('b'.repeat(64),{consent:false}),{code:'INSPIRATION_UNCONFIRMED'});
 f.state.next.push(body=>Response.json({consent:body.consent}));
 await f.client.saveInspirationConsent('b'.repeat(64),{consent:false});
 assert.equal(f.state.requests.at(-1).consent,false);
});
test('matching foreground joins one in-flight preparation; no second write',async()=>{
 const f=fixture();let finish;f.state.next.push(body=>new Promise(resolve=>{finish=()=>resolve(f.response(body));}));
 const early=f.client.prepareEarly(items(),delivery(),10000);await tick();
 const foreground=f.client.prepare(items(),delivery(),10000);assert.equal(early,foreground);
 finish();assert.equal((await foreground).status,'CREATED');assert.equal(f.state.requests.length,1);
});
test('completed preparation refreshes the owned cart URL at explicit checkout',async()=>{
 const f=fixture();await f.client.prepareEarly(items(),delivery(),10000);
 const receipt=await f.client.prepare(items(),delivery(),10000);
 assert.match(receipt.checkoutUrl,/fresh2/);assert.equal(f.state.requests.length,2);
 assert.deepEqual(f.state.requests[0],f.state.requests[1]);
});
test('reopening the same selection never silently retries an uncertain preparation',async()=>{
 for(const status of ['UNKNOWN','CREATING']){
  const f=fixture();f.state.next.push(body=>f.response(body,1,status));
  await assert.rejects(f.client.prepareEarly(items(),delivery(),10000),{code:'CHECKOUT_UNCONFIRMED'});
  await assert.rejects(f.client.prepareEarly(items(),delivery(),10000),{code:'CHECKOUT_UNCONFIRMED'});
  await assert.rejects(f.client.prepare(items(),delivery(),10000),{code:'CHECKOUT_UNCONFIRMED'});
  assert.equal(f.state.requests.length,1);
 }
});
test('network uncertainty is surfaced on click without an automatic repeat',async()=>{
 const f=fixture();f.state.next.push(()=>{throw Error('lost response');});
 await assert.rejects(f.client.prepareEarly(items(),delivery(),10000),{code:'NETWORK_UNCONFIRMED'});
 await assert.rejects(f.client.prepare(items(),delivery(),10000),{code:'NETWORK_UNCONFIRMED'});
 assert.equal(f.state.requests.length,1);
});
test('changed quantity, design, date, tier and price never reuse the pending receipt',async()=>{
 for(const change of ['quantity','design','date','tier','price']){
  const f=fixture();let finish;f.state.next.push(body=>new Promise(resolve=>{finish=()=>resolve(f.response(body));}));
  const early=f.client.prepareEarly(items(),delivery(),10000);await tick();
  const nextItems=items(),nextDelivery=delivery();let total=10000;
  if(change==='quantity')nextItems[0].quantity=2;
  if(change==='design')nextItems[0].design.text='CHANGED';
  if(change==='date')nextDelivery.dateIso='2026-11-13';
  if(change==='tier')nextDelivery.businessDays=14;
  if(change==='price')total=10001;
  const foreground=f.client.prepare(nextItems,nextDelivery,total);assert.notEqual(foreground,early);
  await tick();assert.equal(f.state.requests.length,1,'serialize different checkout writes');finish();
  if(change==='price')await assert.rejects(foreground,{code:'PRICE_CHANGED'});else await foreground;
  assert.equal(f.state.requests.length,2);
  assert.equal(f.state.requests[1].items[0].quantity,nextItems[0].quantity);
  assert.equal(f.state.requests[1].items[0].design.text,nextItems[0].design.text);
  assert.equal(f.state.requests[1].delivery.dateIso,nextDelivery.dateIso);
  assert.equal(f.state.requests[1].delivery.businessDays,nextDelivery.businessDays);
 }
});
test('consent withdrawal after completed background work requests a fresh matching URL',async()=>{
 const f=fixture();await f.client.prepareEarly(items(),delivery(),10000);
 f.state.consent={analytics:false,marketing:false,preferences:false};
 const receipt=await f.client.prepare(items(),delivery(),10000);
 assert.match(receipt.checkoutUrl,/fresh2/);assert.deepEqual(f.state.requests[1].visitorConsent,f.state.consent);
});
test('consent withdrawal while matching background work is pending prevents stale navigation',async()=>{
 const f=fixture();let finish;f.state.next.push(body=>new Promise(resolve=>{finish=()=>resolve(f.response(body));}));
 const early=f.client.prepareEarly(items(),delivery(),10000);await tick();
 const foreground=f.client.prepare(items(),delivery(),10000);
 f.state.consent={analytics:false,marketing:false,preferences:false};finish();
 await assert.rejects(foreground,{code:'CONSENT_CHANGED'});await assert.rejects(early,{code:'CONSENT_CHANGED'});
 assert.equal(f.state.requests.length,1);
});
