import test from "node:test";
import assert from "node:assert/strict";
import { fetchPhoneDirectory } from "../../src/app/ops/voice-copilot/phone-central-data";

async function fixture(responses: (Response | Error)[], run: (calls: () => number) => Promise<void>) {
  const before = globalThis.fetch;
  let count = 0;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal);
    const item = responses[count++];
    if (item instanceof Error) throw item;
    assert.ok(item, "No unbounded retries");
    return item;
  }) as typeof fetch;
  try { await run(() => count); } finally { globalThis.fetch = before; }
}
const success = () => Response.json({ok:true,results:[{customerId:"customer-a"}],nextOffset:null});

for (const failure of [500,502,503,504,"network","timeout"]) {
  test("directory recovers automatically after "+failure, async () => {
    const response = typeof failure === "number" ? new Response("gateway error",{status:failure})
      : failure === "timeout" ? new DOMException("Timed out","TimeoutError") : new TypeError("fetch failed");
    await fixture([response,success()], async calls => {
      const result=await fetchPhoneDirectory<{results:{customerId:string}[]}>("/api/ops/voice-copilot/context?directory=1",new AbortController().signal);
      assert.equal(result.results[0].customerId,"customer-a"); assert.equal(calls(),2);
    });
  });
}
test("persistent failure remains visible after exactly two attempts",async()=>{
 await fixture([new Response("",{status:500}),new Response("",{status:500})],async calls=>{
  await assert.rejects(()=>fetchPhoneDirectory("/directory",new AbortController().signal),/Kunden konnten/);
  assert.equal(calls(),2);
 });
});
test("expired sessions are not retried",async()=>{
 await fixture([new Response("",{status:401})],async calls=>{
  await assert.rejects(()=>fetchPhoneDirectory("/directory",new AbortController().signal),/Sitzung/);
  assert.equal(calls(),1);
 });
});
test("cancelled searches never request or retry stale results",async()=>{
 const controller=new AbortController();controller.abort();
 await fixture([],async calls=>{
  await assert.rejects(()=>fetchPhoneDirectory("/directory",controller.signal),{name:"AbortError"});
  assert.equal(calls(),0);
 });
});
test("successful empty search is preserved and not retried",async()=>{
 await fixture([Response.json({ok:true,results:[],nextOffset:null})],async calls=>{
  assert.deepEqual(await fetchPhoneDirectory("/directory",new AbortController().signal),{ok:true,results:[],nextOffset:null});
  assert.equal(calls(),1);
 });
});
