import test from "node:test";
import assert from "node:assert/strict";
import {NextRequest} from "next/server";
import {GET} from "../../src/app/api/ops/voice-copilot/overview/route";
const id="11111111-1111-4111-8111-111111111111";
let sequence=0;
async function fixture(run:(state:any)=>Promise<void>) {
 const env={...process.env}, original=globalThis.fetch;
 const state={ai:0,saves:[] as any[],status:"completed",failOnce:false,fail:false,savedHash:null as string|null,customerId:id,input:null as any,hash:"hash-"+(++sequence)};
 try {
  (process.env as any).NODE_ENV="test";
  process.env.SUPABASE_URL="https://database.test";process.env.SUPABASE_SERVICE_ROLE_KEY="test-key";
  process.env.OPS_OPENAI_API_KEY="test-openai";delete process.env.OPS_OFFERS_API_KEY;
  globalThis.fetch=async (input,init)=>{
   const url=new URL(String(input)),body=init?.body?JSON.parse(String(init.body)):{};
   if(url.origin==="https://api.openai.com"){
    state.ai++;state.input=body;
    if(state.fail || (state.failOnce&&state.ai===1))return Response.json({error:"temporary"},{status:503});
    return Response.json({status:state.status,output:[{type:"message",content:[{type:"output_text",text:"Neue KI-Zusammenfassung"}]}]});
   }
   assert.equal(url.origin,"https://database.test");
   if(url.pathname.endsWith("voice_customer_brief_input"))return Response.json({customerId:state.customerId,capturedAt:"2026-11-19T12:00:00Z",hash:state.hash,savedHash:state.savedHash,previousSummary:"Gespeicherter Stand",instructions:"Nur belegte Fakten",sources:{kommunikation:[{kind:"inbound",detail:"Neue Antwort\nAm 1. Januar schrieb Test:\nAlter Verlauf"}]}});
   if(url.pathname.endsWith("save_voice_customer_brief")){state.saves.push(body);return Response.json(null);}
   if(url.pathname.endsWith("voice_customer_briefs"))return Response.json([{summary:"Gespeicherter Stand",updated_at:"2026-11-19T11:00:00Z"}]);
   throw Error("Unexpected path "+url.pathname);
  };
  await run(state);
 } finally {globalThis.fetch=original;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
}
const request=(part="summary")=>new NextRequest("http://localhost/api/ops/voice-copilot/overview?customerId="+id+"&part="+part,{headers:{host:"localhost"}});
test("unchanged sources reuse saved summary without AI",async()=>fixture(async s=>{
 s.savedHash=s.hash;const response=await GET(request());assert.equal(response.status,200);assert.equal((await response.json()).summary,"Gespeicherter Stand");assert.equal(s.ai,0);
}));
test("transient AI error retries, strips old email and saves customer-wide summary",async()=>fixture(async s=>{
 s.failOnce=true;const response=await GET(request());assert.equal(response.status,200);assert.equal(s.ai,2);assert.equal(s.input.model,"gpt-4.1-mini");assert.ok(!s.input.input.includes("Alter Verlauf"));assert.equal(s.saves[0].p_customer,id);assert.equal(s.saves[0].p_request,"");
}));
test("incomplete output is never persisted and cached read stays available",async()=>fixture(async s=>{
 s.status="incomplete";assert.equal((await GET(request())).status,500);assert.equal(s.saves.length,0);
 const cached=await GET(request("cached"));assert.equal((await cached.json()).summary,"Gespeicherter Stand");
}));
test("source customer mismatch never reaches AI or save",async()=>fixture(async s=>{
 s.customerId="22222222-2222-4222-8222-222222222222";assert.equal((await GET(request())).status,500);assert.equal(s.ai,0);assert.equal(s.saves.length,0);
}));
test("parallel same-source requests share AI generation",async()=>fixture(async s=>{
 const replies=await Promise.all([GET(request()),GET(request())]);assert.ok(replies.every(r=>r.status===200));assert.equal(s.ai,1);
}));

