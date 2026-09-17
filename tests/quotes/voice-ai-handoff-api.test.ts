import test from "node:test";
import assert from "node:assert/strict";
import {NextRequest} from "next/server";
import {POST} from "../../src/app/api/internal/voice-phone/ai-handoffs/route";
import {publicAiHandoff} from "../../src/lib/ops/voice-ai-handoff";
import type {AiHandoff} from "../../services/voice-runtime/phone-ai-handoff";
const id="29500000-0000-4000-8000-000000000501",sid="CA"+"1".repeat(32);
const request=(body:unknown,auth=true)=>new NextRequest("https://ops.example.test/api/internal/voice-phone/ai-handoffs",{
 method:"POST",headers:{"content-type":"application/json",...(auth?{authorization:"Bearer fixture-runtime"}:{})},body:JSON.stringify(body)});
async function fixture(run:(seen:Array<{url:URL;body:Record<string,unknown>}>)=>Promise<void>){
 const original=globalThis.fetch,before={...process.env},seen:Array<{url:URL;body:Record<string,unknown>}>=[];
 try{
  process.env.SUPABASE_URL="https://database.test";process.env.SUPABASE_SERVICE_ROLE_KEY="fixture";process.env.VOICE_RUNTIME_API_TOKEN="fixture-runtime";
  globalThis.fetch=(async(url,init)=>{
   seen.push({url:new URL(String(url)),body:JSON.parse(String(init?.body||"{}"))});
   return Response.json({allowed:false,owner:"human"});
  }) as typeof fetch;
  await run(seen);
 }finally{globalThis.fetch=original;for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);}
}
test("handoff runtime API rejects missing credentials and malformed envelopes before database access",async()=>{
 await fixture(async seen=>{
  assert.equal((await POST(request({action:"pending"},false))).status,401);
  for(const body of [null,[],{}, {action:"claim_stop",attemptId:"bad"},{action:"event",id,kind:"bind",key:"bind",callSid:"bad"},
   {action:"event",id,kind:"redirect",key:""},{action:"event",id,kind:"cleanup",key:"cleanup",updatedAt:"bad"}])
   assert.equal((await POST(request(body))).status,422);
  assert.equal(seen.length,0);
 });
});
test("stop authority ignores caller-provided customer SID and stays available when admission is disabled",async()=>{
 await fixture(async seen=>{
  process.env.VOICE_PHONE_AI_HANDOFF_ENABLED="false";
  const response=await POST(request({action:"claim_stop",attemptId:id,providerCallId:sid}));
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{allowed:false,owner:"human"});
  assert.equal(seen.length,1);assert.equal(seen[0].url.pathname,"/rest/v1/rpc/claim_voice_ai_stop");
  assert.deepEqual(seen[0].body,{p_attempt_id:id});
 });
});
test("handoff callbacks retain signed actor, leg and version bindings in the atomic event",async()=>{
 await fixture(async seen=>{
  const response=await POST(request({action:"event",id,kind:"bind",key:"bind:"+sid,deviceId:id,callSid:sid}));
  assert.equal(response.status,200);assert.equal(seen.length,1);
  assert.deepEqual(seen[0].body,{p_id:id,p_key:"bind:"+sid,p_kind:"bind",p_call_sid:sid,p_device_id:id,p_conference_sid:null,p_updated_at:null});
 });
});
test("personal handoff projection exposes only UI fields, never provider or credential metadata",()=>{
 const result=publicAiHandoff({id,attempt_id:id,session_id:id,phone:"+493055501234",state:"ready",expires_at:"2099-01-01",capture_id:null,cleanup_pending:false,
  customer_call_sid:sid,agent_call_sid:sid,device_id:id,staff_id:id} as AiHandoff);
 assert.deepEqual(Object.keys(result).sort(),["id","attemptId","callId","phone","state","expiresAt","connected","captureId","cleanupPending"].sort());
 assert(!JSON.stringify(result).includes(sid));assert.equal(result.connected,false);
});
