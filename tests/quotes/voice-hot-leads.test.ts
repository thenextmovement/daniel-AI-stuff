import test from "node:test";
import assert from "node:assert/strict";
import {hotLeadVisible,berlinDate,shiftLeadDate,contactSegment} from "../../src/lib/ops/voice-hot-lead-rules";
const today="2026-11-22";
const source="2026-11-21T10:00:00Z";
const state={status:"ignored" as const,source_at:source,due_date:null,handled_at:"2026-11-22T10:00:00Z",revision:1};
test("ignore persists, but a genuinely new offer can qualify again",()=>{
 assert.equal(hotLeadVisible(source,state,today,null),false);
 assert.equal(hotLeadVisible("2026-11-23T10:00:00Z",state,"2026-11-23",null),true);
});
test("snooze remains hidden until its calendar date, then overrides old call history",()=>{
 const snoozed={...state,status:"scheduled" as const,due_date:"2026-11-23"};
 assert.equal(hotLeadVisible(source,snoozed,today,null),false);
 assert.equal(hotLeadVisible(source,snoozed,"2026-11-23","2026-11-22T09:00:00Z"),true);
 assert.equal(hotLeadVisible(source,snoozed,"2026-11-23","2026-11-23T09:00:00Z"),false);
});
test("confirmed call hides; absent call does not",()=>{
 assert.equal(hotLeadVisible(source,null,today,null),true);
 assert.equal(hotLeadVisible(source,null,today,"2026-11-22T09:00:00Z"),false);
});
test("Berlin day and week shifts cross DST and month boundaries correctly",()=>{
 assert.equal(berlinDate(new Date("2026-11-22T23:30:00Z")),"2026-11-23");
 assert.equal(shiftLeadDate("2026-10-24",1),"2026-10-25");
 assert.equal(shiftLeadDate("2026-12-28",7),"2027-01-04");
});
test("domain indicator has unknown for missing email and handles private domains",()=>{
 assert.equal(contactSegment("Test@GMAIL.com"),"Privat");
 assert.equal(contactSegment("test@company.de"),"B2B");
 assert.equal(contactSegment(null),null);
});

import {listVoiceHotLeads,saveVoiceHotLead} from "../../src/lib/ops/voice-hot-leads";
test("feed binds exact request, sorts globally and excludes closed, blocked, called and future callbacks",async()=>{
 const oldFetch=globalThis.fetch,env={...process.env};
 const base={request_id:"request",customer_id:"customer",trello_card_id:null,title:"Synthetic",created_at:"2026-11-22T09:00:00Z",status:"new",deal_status:"open",name:"Test",company:null,company_name:null,email:"test@gmail.com",phone:null,additional_phones:["+4930123456"],estimated_amount:100,list_status:null,source_at:null,handled_at:null,due_date:null,revision:0,last_confirmed_call:null,blocked:false,callback_at:null};
 const rows=[{...base,id:"eligible"},{...base,id:"won",status:"won"},{...base,id:"blocked",blocked:true},{...base,id:"called",last_confirmed_call:"2026-11-22T10:00:00Z"},{...base,id:"callback",callback_at:"2026-11-23T10:00:00Z"},{...base,id:"expensive",estimated_amount:1000},{...base,id:"old-due",created_at:"2026-09-01T00:00:00Z",list_status:"scheduled",source_at:"2026-09-01T00:00:00Z",handled_at:"2026-11-21T10:00:00Z",due_date:"2026-11-22",revision:1}];
 const calls:string[]=[];
 try{
  process.env.SUPABASE_URL="https://db.invalid";process.env.SUPABASE_SERVICE_ROLE_KEY="synthetic";process.env.NEONTRIP_OFFERS_BASE_URL="https://offers.invalid";process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY="synthetic";
  globalThis.fetch=async(input,init)=>{const url=new URL(String(input));calls.push(url.pathname);assert.equal(init?.method||"GET","GET");return Response.json(url.hostname==="offers.invalid"?{results:[],nextCursor:null}:rows);};
  const data=await listVoiceHotLeads("today","amount",0,new Date("2026-11-22T12:00:00Z"));
  assert.deepEqual(data.results.map(x=>x.id),["expensive","eligible","old-due"]);
  assert.equal(data.results[0].phone,"+4930123456");
  assert.ok(calls.every(p=>p==="/api/internal/offers/voice-leads"||p==="/rest/v1/voice_hot_lead_candidates"));
  globalThis.fetch=async()=>new Response("failure",{status:502});
  await assert.rejects(()=>listVoiceHotLeads("today","priority",0));
 }finally{globalThis.fetch=oldFetch;for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);}
});
test("invalid state writes are rejected before any database call",async()=>{
 await assert.rejects(()=>saveVoiceHotLead({id:"invalid"}));
 await assert.rejects(()=>saveVoiceHotLead({id:"11111111-1111-4111-8111-111111111111",customerId:"22222222-2222-4222-8222-222222222222",status:"scheduled",revision:0,sourceAt:"2026-01-01T00:00:00Z",dueDate:"2026-02-30"}));
});

for (const offerCard of ["bbbbbbbbbbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbbbbbbbbbb:special:1795193649198"]) test("canonical offer ID links an offer including special import: "+offerCard,async()=>{
 const oldFetch=globalThis.fetch,env={...process.env};
 const inquiryCard="aaaaaaaaaaaaaaaaaaaaaaaa";
 const offer={id:"offer_123",trelloCardId:offerCard,offerNumber:"123",status:"SENT",totalGross:2584.93,currency:"EUR",createdAt:"2026-11-22T09:00:00Z",sentAt:null,viewedAt:null,closed:false};
 const row={id:"request-internal",request_id:"external",customer_id:"customer",trello_card_id:inquiryCard,offer_ids:["offer_123"],title:"Synthetic",created_at:"2026-11-01T09:00:00Z",status:"new",deal_status:"open",name:"Test",company:null,company_name:null,email:"test@gmail.com",phone:null,additional_phones:[],estimated_amount:null,list_status:null,source_at:null,handled_at:null,due_date:null,revision:0,last_confirmed_call:null,blocked:false,callback_at:null};
 const queried:string[]=[];
 try{
  process.env.SUPABASE_URL="https://db.invalid";process.env.SUPABASE_SERVICE_ROLE_KEY="synthetic";process.env.NEONTRIP_OFFERS_BASE_URL="https://offers.invalid";process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY="synthetic";
  globalThis.fetch=async(input)=>{
   const url=new URL(String(input));queried.push(url.search);
   if(url.hostname==="db.invalid" && url.searchParams.has("trello_card_id"))assert.equal(url.searchParams.get("trello_card_id")?.includes(":special:"),false);
   return Response.json(url.hostname==="offers.invalid"?{results:url.searchParams.has("cardIds")?[]:[offer],nextCursor:null}:[row]);
  };
  const data=await listVoiceHotLeads("today","amount",0,new Date("2026-11-22T12:00:00Z"));
  assert.equal(data.results.length,1);assert.equal(data.results[0].amount,2584.93);
  assert.equal(data.results[0].requestId,"external");assert.equal(data.results[0].offerNumber,"123");
  assert.ok(queried.some(q=>q.includes("ids=offer_123")));
  offer.currency="invalid";
  await assert.rejects(()=>listVoiceHotLeads("today","amount",0,new Date("2026-11-22T12:00:00Z")),/Invalid offers feed/);
 }finally{globalThis.fetch=oldFetch;for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);}
});
