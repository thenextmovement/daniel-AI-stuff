import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesignEmailClient} from '../deploy/configurator/design-email.js';
import {createDesignLink,readDesignLink} from '../deploy/configurator/design-share.js';
import {checkoutPayload,designPayloadItems} from '../deploy/configurator/checkout-client.js';

const design={mode:'text',text:'Mein Neon',fontId:'Amsterdam',axis:'width',valueMm:500,alignment:'center',lineHeight:.8,
  color:'pink',charColors:[['char:["Mein Neon",0,0,"M"]','green']],wordColors:[],rasterVersion:2,lightMode:'rgb',
  backing:'contour',mount:'hanging-kit',plateFinish:{kind:'mirror-gold',color:'#D4AF37'},outdoor:true,
  dimmer:true,extraCable2m:true,powerSupply:'premium-white',accessoryQuantities:{'wall-mount':1,'hanging-kit':2,'adhesive-kit':0,'table-stand':0,dimmer:2,extraCable2m:3,'premium-white':1},
  photo:{secret:'private-photo'},room:'reception'};
const item={quantity:1,design,snapshot:{mode:'text',text:design.text,font:{id:'Amsterdam'},sign:{glyphs:[]},plate:{},mount:{},price:{gross:1},room:'PRIVATE'}};
const policy={fonts:['Amsterdam'],palette:['pink','green'],rooms:['reception']};
const reply=status=>new Response(JSON.stringify({id:'a'.repeat(64),status}),{status:status==='SENT'?200:202,headers:{'content-type':'application/json'}});

test('client submits only on demand; simultaneous clicks share a request and persisted ownership survives a new client',async()=>{
  let session,calls=0,bodies=[],tokens=[];
  const options={readSession:async()=>session,saveSession:async value=>session??=value,fetcher:async(url,request)=>{
    calls++;bodies.push(request.body);tokens.push(request.headers['X-Neontrip-Cart-Token']);assert.ok(url.endsWith('/design-email'));return reply('UNKNOWN');
  }};
  const client=createDesignEmailClient(options);assert.equal(calls,0);
  const first=client.send(' Visitor@Example.org ',item),second=client.send('visitor@example.org',item);
  assert.equal(first,second);assert.equal((await first).status,'UNKNOWN');assert.equal(calls,1);
  assert.equal((await createDesignEmailClient(options).send('visitor@example.org',item)).status,'UNKNOWN');
  assert.equal(tokens[0],tokens[1]);assert.equal(bodies[0],bodies[1]);
  const body=JSON.parse(bodies[0]);assert.deepEqual(Object.keys(body),['email','items']);assert.equal(body.email,'visitor@example.org');
  assert.ok(!bodies[0].includes('PRIVATE'));assert.ok(!bodies[0].includes('private-photo'));assert.ok(!bodies[0].includes('price'));
});
test('storage and unknown network failures never auto-retry or claim delivery',async()=>{
  let calls=0;
  const base={readSession:async()=>'a'.repeat(43),saveSession:async value=>value,fetcher:async()=>{calls++;throw new TypeError('lost');}};
  await assert.rejects(createDesignEmailClient({...base,readSession:async()=>null,saveSession:async()=>undefined}).send('a@example.org',item));
  assert.equal(calls,0);
  await assert.rejects(createDesignEmailClient(base).send('a@example.org',item),/unterbrochen/);assert.equal(calls,1);
  await assert.rejects(createDesignEmailClient({...base,fetcher:async()=>new Response('<html>error</html>')}).send('a@example.org',item));
});
test('mail item extraction preserves checkout contract and never introduces a delivery choice',()=>{
  const items=designPayloadItems([item]);
  const checkout=checkoutPayload([item],{dateIso:'2026-10-30',businessDays:15});
  assert.deepEqual(checkout.items,items);assert.equal(checkout.delivery.countryCode,'DE');
  assert.throws(()=>checkoutPayload([item],null),{code:'DELIVERY_REQUIRED'});
  assert.notEqual(items[0].design,item.design);assert.ok(!items[0].snapshot.price);
});
test('v4 links restore renderer, colors and every accessory while v1/v2/v3 remain readable',()=>{
  const link=createDesignLink([design],'https://anfrage.neontrip.de/configurator/',policy);
  const restored=readDesignLink(new URL(link).hash,policy)[0];
  assert.equal(restored.rasterVersion,2);assert.deepEqual(restored.charColors,design.charColors);
  assert.deepEqual(restored.accessoryQuantities,design.accessoryQuantities);assert.equal(restored.photo,null);
  for(const field of ['text','fontId','axis','valueMm','alignment','lineHeight','lightMode','backing','mount','outdoor','dimmer','extraCable2m','powerSupply'])assert.equal(restored[field],design[field]);
  const packet=JSON.parse(Buffer.from(new URL(link).hash.slice(8),'base64url').toString());
  for(const v of [1,2,3]){
    const old={v,d:[packet.d[0].slice(0,26-(4-v))]};
    const recovered=readDesignLink('#design='+Buffer.from(JSON.stringify(old)).toString('base64url'),policy)[0];
    assert.equal(recovered.rasterVersion,undefined);assert.equal(recovered.text,design.text);
  }
  assert.throws(()=>createDesignLink([{...design,rasterVersion:3}],'https://anfrage.neontrip.de/configurator/',policy));
});
