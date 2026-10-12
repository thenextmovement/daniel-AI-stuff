import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise the actual browser request lifecycle with a controlled worker and
// clock. No real timeouts, customer drafts, API requests or checkout side effects.
const source=readFileSync(new URL('../deploy/configurator/configurator.js',import.meta.url),'utf8');
const lifecycle=source.slice(source.indexOf('function startWorker()'),source.indexOf('function ensureFont('))
  .replace(/new URL\('\.\/font-worker\.js[^']*',import\.meta\.url\)/,"'font-worker.js'");
function harness(){
  const timers=new Map(),workers=[];let timerId=0;
  class Worker{
    constructor(){this.messages=[];this.terminated=false;workers.push(this);}
    postMessage(message){this.messages.push(message);}
    terminate(){this.terminated=true;}
    respond(requestId,extra={}){this.onmessage({data:{requestId,ok:true,...extra}});}
  }
  const context=vm.createContext({Worker,Map,Error,setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);}});
  vm.runInContext(`let worker,requestId=0,revision=1;const loaded=new Map(),pending=new Map();${lifecycle}
    startWorker();globalThis.api={callWorker,loaded,pending,setRevision(value){revision=value;}};`,context);
  return {...context.api,workers,expire(id){const callback=timers.get(id);assert.ok(callback,'deadline exists');timers.delete(id);callback();}};
}
const settled=promise=>promise.then(value=>({value}),error=>({error}));

test('an older comparison deadline cannot terminate the newer active render',async()=>{
  const h=harness(),background=settled(h.callWorker({type:'render',fontId:'comparison'}));
  h.setRevision(2);const active=h.callWorker({type:'render',fontId:'selected'},{activeRevision:2});
  h.expire(1);
  assert.equal((await background).error.code,'WORKER_TIMEOUT');
  assert.equal(h.workers.length,1);assert.equal(h.workers[0].terminated,false);
  assert.equal(h.pending.size,1);
  h.workers[0].respond(2,{marker:'latest'});assert.equal((await active).marker,'latest');
});

test('a superseded active deadline does not erase the newer design',async()=>{
  const h=harness(),old=settled(h.callWorker({type:'render'},{activeRevision:1}));
  h.setRevision(2);const latest=h.callWorker({type:'render'},{activeRevision:2});
  h.expire(1);assert.equal((await old).error.code,'WORKER_TIMEOUT');
  assert.equal(h.workers.length,1);h.workers[0].respond(2);await latest;
});

test('the current active deadline restarts once, clears font cache and ignores the retired worker',async()=>{
  const h=harness();h.loaded.set('Alexa',Promise.resolve());
  const secondary=settled(h.callWorker({type:'render'}));
  const active=settled(h.callWorker({type:'render'},{activeRevision:1}));
  h.expire(2);
  const error=(await active).error;
  assert.equal(error.code,'WORKER_TIMEOUT');assert.equal(error.workerRestarted,true);
  assert.equal((await secondary).error,error);assert.equal(h.workers.length,2);
  assert.equal(h.loaded.size,0);assert.equal(h.pending.size,0);
  const next=h.callWorker({type:'load'},{activeRevision:1});
  h.workers[0].onerror();h.workers[0].respond(3,{marker:'retired'});
  assert.equal(h.workers.length,2);assert.equal(h.pending.size,1);
  h.workers[1].respond(3,{marker:'current'});assert.equal((await next).marker,'current');
});

test('a worker crash retains a typed recoverable cause',async()=>{
  const h=harness(),active=settled(h.callWorker({type:'render'},{activeRevision:1}));
  h.workers[0].onerror();const {error}=await active;
  assert.equal(error.code,'WORKER_INTERRUPTED');assert.equal(error.workerRestarted,true);
  assert.equal(h.workers.length,2);
});

test('ordinary worker validation errors do not restart the processor',async()=>{
  const h=harness(),active=settled(h.callWorker({type:'render'},{activeRevision:1}));
  h.workers[0].onmessage({data:{requestId:1,ok:false,code:'UNSUPPORTED_GLYPH',error:'Bitte Text anpassen.'}});
  assert.equal((await active).error.code,'UNSUPPORTED_GLYPH');assert.equal(h.workers.length,1);
});
