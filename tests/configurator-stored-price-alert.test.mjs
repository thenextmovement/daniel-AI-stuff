import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../deploy/configurator/configurator.js',import.meta.url),'utf8');
const stored=source.slice(source.indexOf('async function storedPrice('),source.indexOf('async function displayStoredPrice(')).replace('import.meta.url',"'https://test.invalid/configurator.js'");
const status=source.slice(source.indexOf('function priceStatusForError('),source.indexOf('function errorMessage('));
test('saved-cart technical failures report once per incident; success permits a later incident',async()=>{
 let issue='WORKER_TIMEOUT',counter=0;const events=[];
 const context=vm.createContext({Map,URL,Error,JSON,Promise,PRICE_RULES:{version:'test'},FONTS:['Alexa'],storedPriceCache:new Map(),storedPriceFailureAttempts:new Map(),
  createFailureAttemptId:()=>String(++counter),failureReporter:{report:event=>{events.push(event);return Promise.resolve();}},
  callWorker:async request=>{if(request.type==='render'&&issue)throw Object.assign(new Error('Technical'),{code:issue});return {};},priceForResult:()=>({status:'calculated',net:200}),errorMessage:error=>error.message});
 vm.runInContext(status+stored+';globalThis.price=storedPrice;',context);
 const design={mode:'text',fontId:'Alexa',text:'PRIVATE',axis:'width',valueMm:500};
 assert.equal((await context.price(design)).status,'calculation-error');await context.price(design);
 assert.equal(events.length,2);assert.equal(events[0].attemptId,events[1].attemptId);assert.equal(JSON.stringify(events).includes('PRIVATE'),false);
 issue=null;await context.price(design);context.storedPriceCache.clear();issue='WORKER_TIMEOUT';await context.price(design);
 assert.notEqual(events[2].attemptId,events[0].attemptId);
 context.storedPriceCache.clear();issue='UNSUPPORTED_GLYPH';await context.price(design);assert.equal(events.length,3);
});
