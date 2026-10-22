import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DEFAULT} from '../../deploy/3d-konfigurator/model.js';
import {cartEntry} from '../../deploy/3d-konfigurator/cart.js';
import {createDraftSync,DRAFT_SESSION_KEY} from '../../deploy/3d-konfigurator/draft-sync.js';
import {sha256} from '../../deploy/3d-konfigurator/vendor/sha256.js';
import {parseDraftSave} from '../../functions/_shared/configurator-3d-drafts.js';
import {proxy3D} from '../../functions/_shared/configurator-3d-proxy.js';
const item=cartEntry({id:'first',design:{...DEFAULT}});
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};};
const reply=(body,revision)=>({version:1,status:'SAVED',revision,references:body.items.map(i=>({localId:i.id,designId:'3d_'+'1'.repeat(64),versionId:'2'.repeat(64),previewHash:null})),savedAt:'2026-10-22T12:00:00.000Z',purchaseEnabled:false});
const json=(body,status=200)=>Response.json(body,{status});
test('HTTP LAN fingerprint matches SHA256 without SubtleCrypto',()=>{for(const text of ['','abc','ü'.repeat(40000)])assert.equal(Buffer.from(sha256(new TextEncoder().encode(text))).toString('hex'),createHash('sha256').update(text).digest('hex'));});
test('Shared save contract excludes prices and rejects malformed/inactive configuration fields',()=>{
 assert.equal(parseDraftSave({version:1,expectedRevision:0,items:[item]}).items.length,1);
 for(const raw of [{version:1,expectedRevision:0,items:[{...item,price:0}]},{version:1,expectedRevision:0,items:[{...item,design:{...DEFAULT,night:'false'}}]},{version:1,expectedRevision:0,items:[item,item]}])assert.throws(()=>parseDraftSave(raw));
});
test('Durable sync serializes concurrent changes and does not create duplicate saves on reload',async()=>{
 const local=storage(),states=[],calls=[];let release;
 const sync=createDraftSync({storage:local,onState:s=>states.push(s.status),fetcher:async(path,init)=>{assert.equal(path,'/api/public/configurator-3d/drafts');const body=JSON.parse(init.body);calls.push(body);if(calls.length===1)await new Promise(resolve=>release=resolve);return json(reply(body,calls.length));}});
 const first=sync.save([item]);await new Promise(resolve=>setTimeout(resolve,0));const last=sync.save([{...item,quantity:4}]);release();await Promise.all([first,last]);
 assert.equal(calls.length,2);assert.equal(calls[1].expectedRevision,1);assert.equal(calls[1].items[0].quantity,4);assert.equal(sync.status,'saved');
 const restored=createDraftSync({storage:local,fetcher:()=>{throw Error('No duplicate upload');}});await restored.save([{...item,quantity:4}]);assert.equal(restored.status,'saved');assert.match(restored.link('https://anfrage.neontrip.de'),/#entwuerfe=[a-f0-9]{64}$/);
 assert.equal(JSON.parse(local.getItem(DRAFT_SESSION_KEY)).revision,2);
});
test('Lost response is retryable with same token/revision; conflicts stop writes until explicit fork',async()=>{
 const local=storage();let calls=0,seenToken;const sync=createDraftSync({storage:local,fetcher:async(path,init)=>{calls++;const body=JSON.parse(init.body);if(!seenToken)seenToken=init.headers.Authorization;assert.equal(init.headers.Authorization,seenToken);assert.equal(body.expectedRevision,0);if(calls===1)throw Error('response lost');return json(reply(body,1));}});
 await assert.rejects(sync.save([item]));assert.equal(sync.status,'unavailable');await sync.retry([item]);assert.equal(sync.status,'saved');
 let requests=0;const conflict=createDraftSync({storage:local,fetcher:async(path,init)=>{requests++;const body=JSON.parse(init.body);if(requests===1)return json({error:{code:'REVISION_CONFLICT'}},409);assert.notEqual(init.headers.Authorization,seenToken);assert.equal(body.expectedRevision,0);return json(reply(body,1));}});
 await assert.rejects(conflict.save([{...item,quantity:3}]));assert.equal(conflict.status,'conflict');await conflict.save([{...item,quantity:5}]);assert.equal(requests,1);await conflict.fork([{...item,quantity:5}]);assert.equal(requests,2);
});
test('Tokens are saved before upload; failed device storage never claims durable success',async()=>{
 let network=0;const sync=createDraftSync({storage:{getItem:()=>null,setItem:()=>{throw Error('quota');}},fetcher:()=>{network++;}});
 await assert.rejects(sync.save([item]));await assert.rejects(sync.retry([item]));assert.equal(network,0);assert.equal(sync.status,'unavailable');assert.throws(()=>sync.link('https://example.com'));
});
test('A synchronous device-storage failure can recover without reloading or changing the draft',async()=>{
 const local=storage(),setItem=local.setItem;let available=false,uploads=0;
 local.setItem=(key,value)=>{if(!available)throw Error('quota');setItem(key,value);};
 const states=[],sync=createDraftSync({storage:local,onState:s=>states.push(s),fetcher:async(path,init)=>{uploads++;assert.ok(local.getItem(DRAFT_SESSION_KEY));return json(reply(JSON.parse(init.body),1));}});
 await assert.rejects(sync.save([item]),{code:'DEVICE_STORAGE_UNAVAILABLE'});assert.equal(uploads,0);
 assert.equal(states.at(-1).code,'DEVICE_STORAGE_UNAVAILABLE');
 available=true;await sync.retry([{...item,quantity:3}]);
 assert.equal(uploads,1);assert.equal(sync.status,'saved');assert.equal(JSON.parse(local.getItem(DRAFT_SESSION_KEY)).revision,1);
});
test('A receipt that could not be stored is persisted before retry reports success',async()=>{
 const local=storage(),setItem=local.setItem;let available=true,uploads=0;
 local.setItem=(key,value)=>{if(!available)throw Error('quota');setItem(key,value);};
 const sync=createDraftSync({storage:local,fetcher:async(path,init)=>{uploads++;available=false;return json(reply(JSON.parse(init.body),1));}});
 await assert.rejects(sync.save([item]),{code:'DEVICE_STORAGE_UNAVAILABLE'});
 await assert.rejects(sync.retry([item]),{code:'DEVICE_STORAGE_UNAVAILABLE'});assert.equal(sync.status,'unavailable');assert.equal(uploads,1);
 available=true;await sync.retry([item]);assert.equal(sync.status,'saved');assert.equal(uploads,1);assert.equal(JSON.parse(local.getItem(DRAFT_SESSION_KEY)).revision,1);
});
test('Edits during a network outage retain the retry state and save the latest quantities',async()=>{
 let online=false,uploads=0;const states=[];
 const sync=createDraftSync({storage:storage(),onState:s=>states.push(s.status),fetcher:async(path,init)=>{uploads++;if(!online)throw Error('offline');const body=JSON.parse(init.body);assert.equal(body.items[0].quantity,7);return json(reply(body,1));}});
 await assert.rejects(sync.save([item]));
 await sync.save([{...item,quantity:4}]);await sync.save([{...item,quantity:7}]);
 assert.equal(uploads,1);assert.deepEqual(states.slice(-3),['unavailable','unavailable','unavailable']);assert.throws(()=>sync.link('https://example.com'));
 online=true;await sync.retry([{...item,quantity:7}]);assert.equal(uploads,2);assert.equal(sync.status,'saved');
});
test('Two devices retain both versions on conflict, including edits made after the conflict',async()=>{
 const collections=new Map();let writes=0;
 const fetcher=async(path,init)=>{
  const key=init.headers.Authorization,body=init.body?JSON.parse(init.body):null,current=collections.get(key)||{items:[],revision:0};
  if(init.method==='GET')return json({...reply(current,current.revision),items:current.items});
  writes++;if(body.expectedRevision!==current.revision)return json({error:{code:'REVISION_CONFLICT'}},409);
  const saved={items:body.items,revision:current.revision+1};collections.set(key,saved);return json(reply(saved,saved.revision));
 };
 const first=createDraftSync({storage:storage(),fetcher}),states=[],second=createDraftSync({storage:storage(),fetcher,onState:s=>states.push(s.status)});
 await first.save([item]);const originalToken=first.sessionToken;
 await second.adopt(originalToken,await second.load(originalToken));
 await first.save([{...item,quantity:2}]);await assert.rejects(second.save([{...item,quantity:3}]),{code:'REVISION_CONFLICT'});
 const before=writes;await second.save([{...item,quantity:5}]);assert.equal(writes,before);assert.equal(states.at(-1),'conflict');
 await second.fork([{...item,quantity:5}]);assert.notEqual(second.sessionToken,originalToken);
 assert.equal((await first.load(originalToken)).items[0].quantity,2);assert.equal((await second.restoreOwn()).items[0].quantity,5);
 assert.equal(collections.size,2);assert.equal(second.status,'saved');
});
test('Restore validates server response; private token stays in Authorization, not URL',async()=>{
 const secret='a'.repeat(64);const sync=createDraftSync({storage:storage(),fetcher:async(path,init)=>{assert.equal(init.method,'GET');assert.equal(init.headers.Authorization,'Bearer '+secret);assert.ok(!path.includes(secret));return json({...reply({items:[item]},1),items:[item]});}});
 const restored=await sync.load(secret);assert.deepEqual(restored.items,[item]);await sync.adopt(secret,restored);assert.equal(sync.status,'saved');
 const bad=createDraftSync({storage:storage(),fetcher:async()=>json({items:[item],revision:1})});await assert.rejects(bad.load(secret));
});
test('Pages proxy pins Offers upstream, strips cookies, rejects foreign origins and redirects',async()=>{
 const previous=globalThis.fetch;let called=0;
 globalThis.fetch=async(url,init)=>{called++;assert.equal(url,'https://angebote.neontrip.de/api/public/configurator-3d/drafts');assert.equal(init.headers.has('cookie'),false);assert.equal(init.redirect,'manual');return json({version:1});};
 try{
  const request=new Request('https://anfrage.neontrip.de/api/public/configurator-3d/drafts',{headers:{cookie:'private',authorization:'Bearer '+ '1'.repeat(64)}});const result=await proxy3D(request,'drafts');assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'private, no-store');
  assert.equal((await proxy3D(new Request(request,{headers:{origin:'https://evil.example'}}),'drafts')).status,403);assert.equal(called,1);
  assert.equal((await proxy3D(request,'https://evil.example')).status,404);
  for(const status of [301,302,303,307,308]){
   let attempts=0;globalThis.fetch=async(url,init)=>{attempts++;assert.equal(new URL(url).host,'angebote.neontrip.de');assert.equal(init.redirect,'manual');return new Response('redirect',{status,headers:{Location:'https://evil.example'}});};
   const blocked=await proxy3D(request,'drafts');assert.equal(blocked.status,503);assert.equal(blocked.headers.has('Location'),false);assert.equal((await blocked.json()).error.code,'STORAGE_UNAVAILABLE');assert.equal(attempts,1);
  }
 }finally{globalThis.fetch=previous;}
});
