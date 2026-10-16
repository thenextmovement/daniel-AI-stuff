import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync('integrations/shopify/neontrip-x-custom-pixel.js','utf8');
async function setup({allowed=true,url='https://www.neontrip.de/?twclid=test_click',storage=new Map()}={}) {
  const events={},calls=[];let consent;
  const flush=async()=>{for(let i=0;i<8;i++)await new Promise(setImmediate);};
  const sandbox={URL,Date,Set,Promise,setTimeout,init:{customerPrivacy:{marketingAllowed:allowed,saleOfDataAllowed:allowed},context:{document:{location:{href:url}}}},analytics:{subscribe:(name,cb)=>{events[name]=cb;}},api:{customerPrivacy:{subscribe:(_,cb)=>{consent=cb;}}},browser:{localStorage:{getItem:async k=>storage.get(k),setItem:async(k,v)=>storage.set(k,v),removeItem:async k=>storage.delete(k)}},fetch:async(url,opts)=>{calls.push({url,...JSON.parse(opts.body)});return{ok:true};}};
  vm.runInNewContext(source,sandbox);await flush();
  const checkout=async(name='checkout_started')=>{events[name]({context:sandbox.init.context,data:{checkout:{token:'checkout_0123456789abcdef',totalPrice:{amount:9999},email:'do-not-send@example.invalid',order:{id:'gid://shopify/Order/123456789'}}}});await flush();};
  return{calls,storage,checkout,flush,consent:async allowed=>{await consent({customerPrivacy:{marketingAllowed:allowed,saleOfDataAllowed:allowed}});await flush();}};
}
test('no consent means no storage and no request',async()=>{const s=await setup({allowed:false});await s.checkout();assert.equal(s.calls.length,0);assert.equal(s.storage.size,0);});
test('checkout_completed captures association only, never a purchase or customer fields',async()=>{
  const s=await setup();await s.checkout('checkout_completed');assert.equal(s.calls.length,1);
  assert.deepEqual(Object.keys(s.calls[0]).sort(),['url','checkout_token','marketing_allowed','twclid','click_at','consent_at'].sort());
});
test('withdrawal after a page reload revokes prior checkout association and clears local IDs',async()=>{
  const s=await setup();await s.checkout();const reloaded=await setup({storage:s.storage,url:'https://www.neontrip.de/pages/thank-you'});
  await reloaded.consent(false);assert.equal(reloaded.calls.length,1);assert.equal(reloaded.calls[0].marketing_allowed,false);assert.equal(s.storage.size,0);
  await reloaded.checkout();assert.equal(reloaded.calls.length,1);
});
test('unrelated domain, QA URL and other campaign do not carry an old X click',async()=>{
  const first=await setup();
  for(const url of ['https://unrelated.invalid/?twclid=x','https://www.neontrip.de/?qa=1','https://www.neontrip.de/?gclid=other']) {
    const s=await setup({storage:new Map(first.storage),url});await s.checkout();assert.equal(s.calls.length,0);
  }
});
