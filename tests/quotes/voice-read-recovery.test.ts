import test from "node:test";
import assert from "node:assert/strict";
import {fetchPhoneRead} from "../../src/app/ops/voice-copilot/phone-central-data";

async function fixture(replies:(Response|Error)[],run:(calls:()=>number)=>Promise<void>){
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(_input,init)=>{
   assert.equal(init?.method,undefined,"Only GET is allowed");
   assert.equal(init?.cache,"no-store");assert.ok(init?.signal);
   const reply=replies[calls++];assert.ok(reply,"Retries must be bounded");
   if(reply instanceof Error)throw reply;return reply;
 };
 try{await run(()=>calls);}finally{globalThis.fetch=original;}
}
for(const payload of [{notes:[{id:"note-a",note:"Gespeicherte Notiz"}]},{summary:"Aktueller Stand"}]){
 for(const failure of [500,502,503,504,"network","timeout"]){
  test("read recovers "+Object.keys(payload)[0]+" after "+failure,async()=>{
   const error=typeof failure==="number"?new Response("upstream",{status:failure}):
     failure==="timeout"?new DOMException("timeout","TimeoutError"):new TypeError("fetch failed");
   await fixture([error,Response.json(payload)],async calls=>{
    assert.deepEqual(await fetchPhoneRead("/read",new AbortController().signal),payload);
    assert.equal(calls(),2);
   });
  });
 }
}
for(const status of [400,401,403,404]){
 test("does not retry "+status,async()=>fixture([new Response("",{status})],async calls=>{
  await assert.rejects(()=>fetchPhoneRead("/read",new AbortController().signal));
  assert.equal(calls(),1);
 }));
}
test("persistent outage stays an error, never empty notes",async()=>fixture([new Response("",{status:503}),new Response("",{status:503})],async calls=>{
 await assert.rejects(()=>fetchPhoneRead("/read",new AbortController().signal));assert.equal(calls(),2);
}));
test("customer switch aborts stale reads without another request",async()=>{
 const controller=new AbortController();controller.abort();
 await fixture([],async calls=>{await assert.rejects(()=>fetchPhoneRead("/read",controller.signal),{name:"AbortError"});assert.equal(calls(),0);});
});
test("valid empty notes are successful",async()=>fixture([Response.json({notes:[]})],async calls=>{
 assert.deepEqual(await fetchPhoneRead("/read",new AbortController().signal),{notes:[]});assert.equal(calls(),1);
}));
