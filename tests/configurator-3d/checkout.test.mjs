import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEFAULT,choosePaint} from '../../deploy/3d-konfigurator/model.js';
import {cartEntry,restoreCart,storeCart,CART_KEY,safePreview} from '../../deploy/3d-konfigurator/cart.js';
import {checkoutPayload3D,parseCheckout3DRequest,prepareCheckout3D,blockedCheckout3D} from '../../deploy/3d-konfigurator/checkout-contract.js';
import {DELIVERY_3D,DELIVERY_LABEL} from '../../deploy/3d-konfigurator/delivery.js';
import {onRequest} from '../../functions/api/public/configurator-3d/checkout.js';
import {shopify3DLineMetadata} from '../../functions/_shared/configurator-3d-shopify.js';
const line=(design={...DEFAULT},extras={})=>cartEntry({id:'design-1',design,quantity:2,dimensions:{height:30,overallWidth:120,overallHeight:30},...extras});
const post=body=>new Request('https://preview.example/api/public/configurator-3d/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

test('Legacy cart migration retains choices/quantity and removes purchase state and unsafe images',()=>{
 const design=choosePaint({...DEFAULT,mount:'rail',railCustomColor:true},'railColor',{ral:'7016'});
 const restored=restoreCart([{...line(design),preview:'https://tracker.invalid/image',checkoutUrl:'https://invalid/',price:0,purchaseEnabled:true},line(),{id:'bad',design:{...DEFAULT,text:''}}]);
 assert.equal(restored.length,1);assert.equal(restored[0].quantity,2);assert.equal(restored[0].design.railRal,'RAL 7016');
 assert.equal(restored[0].preview,null);assert.equal(restored[0].purchaseEnabled,undefined);assert.equal(restored[0].price,undefined);assert.equal(restored[0].checkoutUrl,undefined);
 assert.equal(restoreCart([{...line(),quantity:999}])[0].quantity,1);
});
test('Storage quota drops only optional thumbnails and preserves all order choices',()=>{
 const items=[line(DEFAULT,{preview:'data:image/jpeg;base64,YWJj',quantity:3}),line(DEFAULT,{id:'design-2'})];
 let stored;const storage={setItem(key,value){assert.equal(key,CART_KEY);if(value.includes('data:image'))throw Error('quota');stored=value;}};
 const saved=storeCart(storage,items);assert.equal(saved.previewsOmitted,true);assert.equal(saved.items.length,2);assert.equal(saved.items[0].quantity,3);assert.equal(saved.items[0].preview,null);assert.equal(JSON.parse(stored)[1].id,'design-2');
 assert.equal(items[0].preview,'data:image/jpeg;base64,YWJj','Caller data is not mutated');
 assert.throws(()=>storeCart({setItem(){throw Error('blocked');}},items),/blocked/);
 for(const input of ['data:image/svg+xml;base64,YWJj','javascript:alert(1)','https://external/image','data:image/jpeg;base64,'+'a'.repeat(90000)])assert.equal(safePreview(input),null);
});
test('Payload separates manufacturing choices from scene, images and client prices',()=>{
 const front=choosePaint({...DEFAULT,lighting:'front',acrylic:'#2474e5',mount:'plate'},'sideColor',{ral:'9016'});
 const payload=checkoutPayload3D([line(front,{preview:'data:image/jpeg;base64,YWJj'})]);
 assert.deepEqual(parseCheckout3DRequest(payload),payload);assert.deepEqual(payload.delivery,DELIVERY_3D);
 const config=payload.items[0].configuration;assert.equal(config.sideRal,'RAL 9016');assert.equal(config.acrylic,'#2474e5');assert.equal(config.plate,DEFAULT.plate);
 for(const key of ['wall','night','lightOn','backFinish','color','preview','price','grossCents'])assert.equal(config[key],undefined);
 assert.equal(payload.items[0].preview,undefined);assert.equal(payload.items[0].quantity,2);
 const otherScene=checkoutPayload3D([line({...front,night:true,wall:'dark',lightOn:false})]);assert.deepEqual(otherScene,payload);
});
test('Backlit steel RAL and mounting colour survive the future Shopify metadata mapping',()=>{
 let design=choosePaint({...DEFAULT,mount:'rail',railCustomColor:true},'body',{ral:'9005'});
 design=choosePaint(design,'railColor',{ral:'7016'});
 const payload=checkoutPayload3D([line(design)]),metadata=shopify3DLineMetadata(payload)[0];
 assert.equal(metadata.quantity,2);assert.equal(metadata.localLineId,'design-1');
 const text=metadata.attributes.map(x=>x.value).join('\n');assert.match(text,/RAL 9005/);assert.match(text,/RAL 7016/);assert.match(text,/1 cm/);assert.match(text,/2–3 Wochen ab Bestellung/);
 assert.equal(metadata.merchandiseId,undefined);assert.equal(metadata.price,undefined);
});
test('Checkout refuses invalid quantities, duplicate IDs and silently coerced configurations',()=>{
 for(const items of [[],[line(),line()],Array.from({length:21},(_,i)=>line(DEFAULT,{id:'line-'+i})),[{...line(),quantity:0}],[{...line(),quantity:100}],[{...line(),quantity:1.5}],[{...line(),design:{...DEFAULT,width:'120'}}],[{...line(),design:{...DEFAULT,font:'unknown'}}],[{...line(),design:{...DEFAULT,depth:999}}],[{...line(),design:{...DEFAULT,text:'A'.repeat(61)}}]])assert.throws(()=>checkoutPayload3D(items));
});
test('Request parsing rejects fabricated prices, product family, delivery dates and extra fields',()=>{
 const original=checkoutPayload3D([line()]);
 for(const mutate of [x=>x.grossCents=0,x=>x.purchaseEnabled=true,x=>x.productFamily='neon-tube',x=>x.delivery.startsAt='draft',x=>x.delivery.dateIso='2026-10-24',x=>x.items[0].configuration.width=999,x=>x.items[0].configuration.bodyRal='RAL 9005',x=>x.items[0].quantity=0,x=>x.items[0].previewDimensions.height=-1]){
  const payload=structuredClone(original);mutate(payload);assert.throws(()=>parseCheckout3DRequest(payload));
 }
});
test('Client preparation remains blocked even if persisted price or flags claim approval; no fetch occurs',async()=>{
 const previous=globalThis.fetch;globalThis.fetch=()=>{throw Error('No network permitted');};
 try{const result=await prepareCheckout3D([{...line(),purchaseEnabled:true,priceVersion:'approved',grossCents:1,checkoutUrl:'https://www.neontrip.de/cart/c/fake'}]);assert.deepEqual(result,blockedCheckout3D());assert.equal(result.checkoutUrl,null);assert.equal(result.grossCents,null);assert.equal(result.purchaseEnabled,false);}finally{globalThis.fetch=previous;}
});
test('Server endpoint rejects unsupported data and valid carts always return 409 without Shopify writes',async()=>{
 const previous=globalThis.fetch;globalThis.fetch=()=>{throw Error('No Shopify calls permitted');};
 try{
  const response=await onRequest({request:post(checkoutPayload3D([line()])),env:{ENABLE_3D_CHECKOUT:true,SHOPIFY_ADMIN_API_ACCESS_TOKEN:'never-used'}});
  assert.equal(response.status,409);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),blockedCheckout3D());
  assert.equal((await onRequest({request:post({...checkoutPayload3D([line()]),price:0})})).status,400);
  assert.equal((await onRequest({request:new Request('https://preview.example')})).status,405);
  assert.equal((await onRequest({request:new Request('https://preview.example',{method:'POST',body:'{}'})})).status,415);
  assert.equal((await onRequest({request:post({padding:'a'.repeat(128001)})})).status,413);
  assert.equal((await onRequest({request:new Request('https://preview.example',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})})).status,400);
 }finally{globalThis.fetch=previous;}
});
test('Lead time is approximate and begins with an order, not a saved draft',async()=>{
 assert.equal(DELIVERY_LABEL,'Ca. 2–3 Wochen ab Bestellung');assert.equal(DELIVERY_3D.startsAt,'order');assert.equal(DELIVERY_3D.approximate,true);
 const html=await readFile(new URL('../../deploy/3d-konfigurator/index.html',import.meta.url),'utf8');
 assert.equal((html.match(/data-delivery-label/g)||[]).length,2);assert.match(html, /id="checkout" disabled/);assert.match(html,/Speichern eines Entwurfs startet noch keine Fertigung/);
});
