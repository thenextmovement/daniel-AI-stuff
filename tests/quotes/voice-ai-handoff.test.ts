import test from "node:test";
import assert from "node:assert/strict";
import type twilio from "twilio";
import {AiHandoffs,TwilioAiHandoffProvider,aiHandoffAgentTwiml,aiHandoffCustomerTwiml,aiHandoffReady,type AiHandoff,type AiHandoffResult} from "../../services/voice-runtime/phone-ai-handoff";
import type {PhoneCallRecord} from "../../services/voice-runtime/phone-calls";
import {phoneCaptureBinding} from "../../services/voice-runtime/phone-capture-protocol";
import type {RuntimeConfig} from "../../services/voice-runtime/config";
const id="29500000-0000-4000-8000-000000000501",callId="29500000-0000-4000-8000-000000000502",attempt="29500000-0000-4000-8000-000000000503";
const staff="29500000-0000-4000-8000-000000000001",device="29500000-0000-4000-8000-000000000101",capture="29500000-0000-4000-8000-000000000504";
const agent="CA"+"1".repeat(32),customer="CA"+"2".repeat(32),room="CF"+"3".repeat(32),nextAgent="CA"+"4".repeat(32);
const config={aiHandoffEnabled:true,transport:"media_streams",teamPhoneEnabled:true,browserCallsEnabled:true,phoneTranscriptionEnabled:true,
 phoneAllowedNumbers:["+493055501234"],twilioFromNumber:"+493055500000",twilioAccountSid:"AC"+"a".repeat(32),
 twilioAuthToken:"fixture",twilioApiKeySid:"SK"+"b".repeat(32),twilioApiKeySecret:"fixture",twilioPhoneAppSid:"AP"+"c".repeat(32),
 openAiApiKey:"fixture",sipBindingSecret:"fixture",publicUrl:"https://voice.example.test"} as RuntimeConfig;
function record():AiHandoff{return {id,attempt_id:attempt,session_id:callId,staff_id:staff,device_id:device,phone:config.phoneAllowedNumbers[0],
 customer_call_sid:customer,agent_call_sid:agent,conference_sid:room,capture_id:capture,state:"ready",agent_joined:true,redirect_claimed_at:null,connected_at:null,
 expires_at:new Date(Date.now()+60000).toISOString(),ended_at:null,cleanup_pending:false,cleanup_customer:false,updated_at:new Date().toISOString()};}
function fixture(){
 const h=record(),effects:string[]=[],events:Record<string,unknown>[]=[];
 const call={id:callId,agent_call_sid:agent,customer_call_sid:customer,ended_at:null,cleanup_pending:false} as PhoneCallRecord;
 let fail=false,handledTransfer=false;
 const store={aiHandoffAction:async<T>(input:Record<string,unknown>):Promise<T>=>{
  if(input.action==="get")return {handoff:{...h}} as T;
  if(input.action==="pending")return {handoffs:[{...h}]} as T;
  events.push(input);let redirect=false;
  if(input.kind==="redirect"&&h.state==="ready"){h.state="redirecting";h.redirect_claimed_at=new Date().toISOString();redirect=true;}
  if(input.kind==="cancel"&&!h.redirect_claimed_at){h.state="cancelled";h.ended_at=new Date().toISOString();h.cleanup_pending=true;}
  if(input.kind==="cleanup")h.cleanup_pending=false;
  return {handoff:{...h},redirect,join:input.kind==="bind",duplicate:false} as AiHandoffResult as T;
 }};
 const engine=new AiHandoffs(config,store,{redirect:async()=>{effects.push("redirect");if(fail)throw Error("uncertain");},closeWaitingAgent:async()=>{effects.push("close-agent");}},
  {event:async()=>{effects.push("phone-event");},closeRecorded:async()=>{effects.push("close-call");}},
  {conference:async()=>{effects.push("transfer-event");return handledTransfer;}},
  {phoneCall:async()=>({call}),phoneEvent:async(_id,_key,kind,sid)=>{assert.equal(_id,callId);assert.equal(sid,kind==="customer_leave"?customer:call.agent_call_sid);effects.push(kind);return {call,dial:false,close:true,duplicate:false};}});
 return {h,call,effects,events,engine,fail:()=>{fail=true;},transferHandled:()=>{handledTransfer=true;}};
}
test("AI handoff requires media transport, browser identity and capture readiness",()=>{
 assert.equal(aiHandoffReady(config),true);
 for(const override of [{aiHandoffEnabled:false},{transport:"sip"},{phoneTranscriptionEnabled:false},{browserCallsEnabled:false},{sipBindingSecret:""},{twilioApiKeySecret:""}])
  assert.equal(aiHandoffReady({...config,...override} as RuntimeConfig),false);
});
test("handoff joins one existing room and starts bound both-track capture before its announcement",()=>{
 const h=record();h.state="redirecting";
 const xml=aiHandoffCustomerTwiml(config,h),agentXml=aiHandoffAgentTwiml(config,h);
 assert(xml.indexOf("<Start>")<xml.indexOf("<Say"));assert(xml.indexOf("<Say")<xml.indexOf("<Dial"));
 assert(xml.includes('track="both_tracks"'));assert(xml.includes(phoneCaptureBinding(capture,customer,config.sipBindingSecret)));
 assert(xml.includes("ntp_"+callId));assert(agentXml.includes("ntp_"+callId));assert(agentXml.includes('participantLabel="agent"'));
 assert(!agentXml.includes("<Stream"));assert(!xml.includes("<Number"));assert(!xml.includes(config.openAiApiKey+"?"));
 assert.throws(()=>aiHandoffCustomerTwiml(config,{...h,capture_id:null}),/not_ready/);
});
test("browser admission binds its personal device and saved agent SID before joining",async()=>{
 const f=fixture();const p=new URLSearchParams({aiHandoffId:id,CallSid:agent,From:"client:ntd_"+device.replaceAll("-","")});
 assert.match(await f.engine.client(p),/<Conference/);
 assert.equal(f.events[0].deviceId,device);assert.equal(f.events[0].callSid,agent);
 p.set("From","client:ntd_"+staff.replaceAll("-",""));await assert.rejects(f.engine.client(p),/forbidden/);
 p.set("From","rahim");await assert.rejects(f.engine.client(p),/invalid_phone_identity/);
 assert.equal(f.events.length,1);
});
test("two runtime kickers share one saved dispatch claim and do not retry uncertain redirection",async()=>{
 const f=fixture();f.fail();await Promise.all([f.engine.kick(id),f.engine.kick(id)]);
 await f.engine.reconcile();await f.engine.kick(id);
 assert.deepEqual(f.effects,["redirect"]);assert.equal(f.h.state,"redirecting");
});
test("cancellation before redirection closes only the waiting employee",async()=>{
 const f=fixture();f.h.state="cancelled";f.h.ended_at=new Date().toISOString();f.h.cleanup_pending=true;
 await f.engine.reconcile();assert.deepEqual(f.effects,["close-agent"]);assert.equal(f.h.cleanup_pending,false);
});
test("post-redirection cleanup requires an ended human call before releasing the saved handoff",async()=>{
 const f=fixture();f.h.state="failed";f.h.ended_at=new Date().toISOString();f.h.cleanup_pending=true;f.h.cleanup_customer=true;
 await assert.rejects(f.engine.kick(id),/call_not_ended/);assert(!f.events.some(e=>e.kind==="cleanup"));
 f.call.ended_at=new Date().toISOString();await f.engine.kick(id);assert.deepEqual(f.effects,["close-call"]);assert.equal(f.h.cleanup_pending,false);
});
test("confirmed handoff delegates subsequent conferences to normal transfers and ignores obsolete agent end",async()=>{
 const f=fixture();f.h.state="connected";f.call.agent_call_sid=nextAgent;
 const p=new URLSearchParams({FriendlyName:"ntp_"+callId,ConferenceSid:room,SequenceNumber:"1",StatusCallbackEvent:"participant-leave",ParticipantLabel:"agent",CallSid:agent});
 await f.engine.conference(id,p);assert.deepEqual(f.effects,["transfer-event","phone-event"]);
 f.effects.length=0;f.transferHandled();await f.engine.conference(id,p);assert.deepEqual(f.effects,["transfer-event"]);
 f.effects.length=0;await f.engine.end(id,new URLSearchParams({CallSid:agent}));assert.deepEqual(f.effects,[]);
 await f.engine.end(id,new URLSearchParams({CallSid:customer}));assert.deepEqual(f.effects,["customer_leave","close-call"]);
 p.set("FriendlyName","another");await assert.rejects(f.engine.conference(id,p),/invalid_ai_handoff_conference/);
});
test("provider modifies exactly the stored customer leg after verifying identity and never redials",async()=>{
 const h=record();h.state="redirecting";const updates:Record<string,unknown>[]=[];const fetched:string[]=[];
 const current={sid:customer,status:"in-progress",to:h.phone,from:config.twilioFromNumber};
 const client={calls:(sid:string)=>{fetched.push(sid);return {fetch:async()=>current,update:async(body:Record<string,unknown>)=>{updates.push(body);return {sid};}};}};
 const provider=new TwilioAiHandoffProvider(config,client as unknown as ReturnType<typeof twilio>);
 await provider.redirect(h);assert.deepEqual(fetched,[customer]);assert.equal(updates.length,1);assert.match(String(updates[0].twiml),/übernimmt/);
 current.to="+493055509999";await assert.rejects(provider.redirect(h),/customer_mismatch/);assert.equal(updates.length,1);
});
