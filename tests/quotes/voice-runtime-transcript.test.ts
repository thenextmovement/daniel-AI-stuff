import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST as transcript } from "../../src/app/api/internal/voice-platform/transcript/route";
import { POST as finalize } from "../../src/app/api/internal/voice-platform/finalize/route";

const attempt = "11111111-1111-4111-8111-111111111111";
const session = "22222222-2222-4222-8222-222222222222";
const segment = { id:"ai-event",speaker:"customer",text:"Bitte prüfen.",revision:1,final:true,startMs:0,endMs:10 };
const outcome = { terminalStatus:"completed",outcomeCode:"no_clear_outcome",summaryForHuman:"Gespräch beendet." };
async function fixture(run:(requests:Array<{url:URL;method:string;body:Record<string,unknown>}>,
 fail:(value:boolean)=>void)=>Promise<void>) {
 const before={...process.env},original=globalThis.fetch,requests:Array<{url:URL;method:string;body:Record<string,unknown>}>=[];let failure=false;
 try {
  process.env.SUPABASE_URL="https://database.test";process.env.SUPABASE_SERVICE_ROLE_KEY="fixture";
  process.env.VOICE_RUNTIME_API_TOKEN="fixture-runtime";
  globalThis.fetch=(async (url,init)=>{
   const path=new URL(String(url));const body=JSON.parse(String(init?.body||"{}"));requests.push({url:path,method:init?.method||"GET",body});
   if(path.pathname.endsWith("/voice_call_sessions")) return Response.json([{id:session}]);
   if(path.pathname.endsWith("/voice_call_attempts")) return Response.json([{id:attempt,context_snapshot:{request_id:"internal-test:"+attempt,allowlist_only:true}}]);
   if(path.pathname.endsWith("/rpc/persist_voice_runtime_transcript")) return failure?Response.json({message:"fixture outage"},{status:503}):Response.json({saved:true,captureStatus:"capturing",humanContinuation:true});
   if(path.pathname.endsWith("/rpc/finalize_voice_call_attempt")) return Response.json([{attempt_id:attempt,target_status:"completed",duplicate:false}]);
   throw new Error("Unexpected request: "+path.pathname);
  }) as typeof fetch;
  await run(requests,value=>{failure=value;});
 } finally {globalThis.fetch=original;for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);}
}
const request=(path:string,body:unknown,authorized=true)=>new NextRequest("https://ops.example.test/api/internal/voice-platform/"+path,{
 method:"POST",headers:{"content-type":"application/json",...(authorized?{authorization:"Bearer fixture-runtime"}:{})},body:JSON.stringify(body),
});
test("runtime transcript endpoint binds the attempt and delegates closure atomically without session patches",async()=>{
 await fixture(async requests=>{
  const response=await transcript(request("transcript",{attemptId:attempt,sessionId:"foreign",segments:[segment],finish:"complete"}));
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{saved:true,captureStatus:"capturing",humanContinuation:true});
  assert.equal(requests.length,2);assert.equal(requests[0].url.searchParams.get("attempt_id"),"eq."+attempt);
  assert.equal(requests[0].url.searchParams.get("select"),"id");
  assert.deepEqual(requests[1].body,{p_attempt_id:attempt,p_segments:[segment],p_finish:"complete"});
  assert.ok(requests.every(r=>r.method!=="PATCH"));
 });
});
test("late AI finalization performs one transaction and preserves internal test side-effect restrictions",async()=>{
 await fixture(async requests=>{
  const response=await finalize(request("finalize",{attemptId:attempt,outcome:{...outcome,callbackAt:"2026-09-18T12:00:00Z",humanHandoffCompleted:true}}));
  assert.equal(response.status,200);assert.equal(requests.length,2);
  assert.equal(requests[1].url.pathname,"/rest/v1/rpc/finalize_voice_call_attempt");
  assert.equal(requests[1].body.p_callback_at,null);assert.equal(requests[1].body.p_handoff_completed,false);
  assert.ok(requests.every(r=>r.method!=="PATCH"));
 });
});
test("runtime transcript/finalization authentication and validation reject before storage",async()=>{
 await fixture(async requests=>{
  for(const [handler,path,body] of [[transcript,"transcript",{attemptId:attempt,segments:[segment]}],[finalize,"finalize",{attemptId:attempt,outcome}]] as const){
   assert.equal((await handler(request(path,body,false))).status,401);
  }
  for(const body of [
   {attemptId:"bad",segments:[segment]},
   {attemptId:attempt,segments:[segment],finish:"bogus"},
   {attemptId:attempt,segments:[{...segment,speaker:"operator"}]},
   {attemptId:attempt,segments:[{...segment,id:session+":inbound:forged"}]},
  ]) assert.equal((await transcript(request("transcript",body))).status,422);
  assert.equal(requests.length,0);
 });
});
test("failed transcript transaction is not acknowledged or followed by a session mutation",async()=>{
 await fixture(async(requests,fail)=>{
  fail(true);const response=await transcript(request("transcript",{attemptId:attempt,segments:[segment],finish:"complete"}));
  assert.equal(response.status,502);assert.deepEqual(await response.json(),{ok:false,error:"voice_data_unavailable"});
  assert.equal(requests.length,2);assert.ok(requests.every(r=>r.method!=="PATCH"));
 });
});
