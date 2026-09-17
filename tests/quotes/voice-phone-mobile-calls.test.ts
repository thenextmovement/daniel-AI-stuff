import test from "node:test";
import assert from "node:assert/strict";
import twilio from "twilio";
import {MobilePhoneCalls,TwilioMobileCallProvider,type MobileCallLeg,type MobileCallResult} from "../../services/voice-runtime/phone-mobile-calls";
import {BrowserPhoneCalls,mobileCallingReady,browserCallingReady,type PhoneCallRecord,type PhoneEventResult} from "../../services/voice-runtime/phone-calls";
import type {RuntimeConfig} from "../../services/voice-runtime/config";
const id="29500000-0000-4000-8000-000000000901",callId="29500000-0000-4000-8000-000000000902";
const sid="CA"+"a".repeat(32),customerSid="CA"+"b".repeat(32),conf="CF"+"c".repeat(32);
const config={teamPhoneEnabled:true,mobileCallsEnabled:true,mobilePhoneNumbers:["+493055501999"],browserCallsEnabled:false,
 twilioAccountSid:"AC"+"4".repeat(32),twilioAuthToken:"fixture-only",twilioFromNumber:"+493055500000",
 phoneAllowedNumbers:["+493055501234"],publicUrl:"https://voice.example.test",twilioApiKeySid:"",twilioApiKeySecret:"",twilioPhoneAppSid:""} as RuntimeConfig;
function fixture(settings=config){
 const leg:MobileCallLeg={id,call_id:callId,staff_id:"29500000-0000-4000-8000-000000000001",device_id:"29500000-0000-4000-8000-000000000101",
 mobile_link_id:"29500000-0000-4000-8000-000000000801",phone:"+493055501999",state:"ready",provider_call_sid:null,
 claimed_at:null,confirmed_at:null,expires_at:new Date(Date.now()+60000).toISOString(),ended_at:null,provider_ended_at:null,cleanup_pending:false,updated_at:new Date().toISOString()};
 const call:PhoneCallRecord={id:callId,device_id:leg.device_id,staff_id:leg.staff_id,phone:"+493055501234",state:"reserved",agent_transport:"mobile",mobile_leg_id:id,
 agent_call_sid:null,customer_call_sid:null,conference_sid:null,customer_dispatch:"ready",agent_joined:false,customer_joined:false,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),ended_at:null,cleanup_pending:false};
 const events:Record<string,unknown>[]=[],starts:string[]=[],closes:string[]=[],closedCalls:string[]=[];
 let failStart=false,failClose=false,providerEnded=false;
 const view=(dial=false,join=false):MobileCallResult=>({leg:{...leg},call:{...call},dial,join,closeCall:!!call.ended_at&&call.cleanup_pending});
 const ops={mobileCallAction:async<T>(input:Record<string,unknown>):Promise<T>=>{
  events.push(input);
  if(input.action==="recover")return {legs:[{...leg}]} as T;
  if(input.action==="get")return view() as T;
  let dial=false,join=false;
  if(input.kind==="claim"&&!leg.claimed_at&&!leg.ended_at){leg.claimed_at=new Date().toISOString();leg.state="claimed";leg.cleanup_pending=true;dial=true;}
  if(input.callSid){
   if(leg.provider_call_sid&&input.callSid!==leg.provider_call_sid)throw Error("mobile_leg_conflict");
   leg.provider_call_sid=String(input.callSid);
   if(!call.agent_call_sid&&!call.ended_at)call.agent_call_sid=leg.provider_call_sid;
  }
  if(input.kind==="prompt"&&!leg.ended_at)leg.state="screening";
  if(input.kind==="confirm"&&!leg.ended_at){leg.state="confirmed";leg.confirmed_at=new Date().toISOString();join=true;}
  if(["cancel","reject","terminal"].includes(String(input.kind))){
   leg.ended_at=new Date().toISOString();leg.state="ended";
   if(call.mobile_leg_id===id){call.ended_at=leg.ended_at;call.cleanup_pending=true;}
  }
  if(input.kind==="terminal"){leg.provider_ended_at=new Date().toISOString();leg.cleanup_pending=false;}
  if(input.kind==="cleanup")leg.cleanup_pending=false;
  return view(dial,join) as T;
 }};
 return {leg,call,events,starts,closes,closedCalls,engine:new MobilePhoneCalls(settings,ops,{start:async l=>{starts.push(l.id);if(failStart)throw Error("timeout");return sid;},
  close:async s=>{closes.push(s);if(failClose)throw Error("provider_failure");},ended:async()=>providerEnded},async c=>{closedCalls.push(c.id);}),
  failStart(){failStart=true;},failClose(){failClose=true;},ended(){providerEnded=true;}};
}
const params=()=>new URLSearchParams({To:"+493055501999",From:"+493055500000",CallSid:sid,CallStatus:"in-progress"});
test("mobile call uses a distinct opt-in flag and no browser SDK credentials",()=>{
 assert.equal(mobileCallingReady(config),true);assert.equal(browserCallingReady(config),false);
 assert.equal(mobileCallingReady({...config,mobileCallsEnabled:false}),false);
 assert.equal(mobileCallingReady({...config,mobilePhoneNumbers:[]}),false);
 assert.equal(mobileCallingReady({...config,phoneAllowedNumbers:[]}),false);
});
test("mobile call dispatch is claimed once, including timeout and repeated requests",async()=>{
 const f=fixture();await Promise.all([f.engine.start(id),f.engine.start(id)]);
 assert.deepEqual(f.starts,[id]);assert.equal(f.call.agent_call_sid,sid);
 const uncertain=fixture();uncertain.failStart();await uncertain.engine.start(id);await uncertain.engine.start(id);
 assert.deepEqual(uncertain.starts,[id]);
 const disabled=fixture({...config,mobileCallsEnabled:false});await assert.rejects(disabled.engine.start(id),/not_configured/);assert.equal(disabled.starts.length,0);
});
test("screening keeps customer audio out until one is pressed and exact conference admission is returned",async()=>{
 const f=fixture();await f.engine.start(id);
 const xml=await f.engine.webhook(id,"prompt",params());
 assert.match(xml,/numDigits="1"/);assert.match(xml,/actionOnEmptyResult="true"/);assert(!xml.includes("<Conference"));
 assert.equal(f.call.customer_dispatch,"ready");
 const p=params();p.set("Digits","1");
 const joined=await f.engine.webhook(id,"confirm",p);
 assert.match(joined,/<Conference/);assert.match(joined,/participantLabel="agent"/);
 assert(joined.includes("ntp_"+callId));assert(joined.includes("/phone/twilio/conference?id="+callId));
 assert.equal(f.call.customer_dispatch,"ready","DTMF admission is not proof that the employee joined");
});
test("voicemail, wrong confirmation, wrong number and a second SID cannot join",async()=>{
 for(const digits of ["","2","11"]){
  const f=fixture();await f.engine.start(id);const p=params();p.set("Digits",digits);
  assert.match(await f.engine.webhook(id,"confirm",p),/<Hangup/);
  assert(f.leg.ended_at);assert.equal(f.call.customer_dispatch,"ready");
 }
 for(const field of ["To","From","CallSid"]){
  const f=fixture();await f.engine.start(id);const p=params();p.set(field,"wrong");
  await assert.rejects(f.engine.webhook(id,"prompt",p),/binding_invalid/);
 }
 const f=fixture();await f.engine.start(id);const p=params();p.set("CallSid","CA"+"9".repeat(32));
 await assert.rejects(f.engine.webhook(id,"prompt",p),/leg_conflict/);
});
test("late former-handset completion does not close the adopted browser call",async()=>{
 const f=fixture();await f.engine.start(id);
 f.call.agent_transport="browser";f.call.mobile_leg_id=null;f.call.agent_call_sid="CA"+"f".repeat(32);
 const p=params();p.set("CallStatus","completed");
 await f.engine.webhook(id,"status",p);
 assert(f.leg.provider_ended_at);assert.equal(f.closedCalls.length,0);assert.equal(f.call.ended_at,null);
});
test("handset cleanup failure remains pending and is not acknowledged",async()=>{
 const f=fixture();await f.engine.start(id);f.failClose();const p=params();p.set("Digits","");
 await assert.rejects(f.engine.webhook(id,"confirm",p),/provider_failure/);
 assert(f.leg.cleanup_pending);assert(!f.events.some(e=>e.kind==="terminal"||e.kind==="cleanup"));
});
test("customer dispatch and recovery honor mobile readiness even with browser calling disabled",async()=>{
 const f=fixture();await f.engine.start(id);f.call.conference_sid=conf;f.call.state="connecting";
 let dialed=0,cancelled=0;
 const ops={
  phoneCall:async()=>({call:f.call}),getPhoneDevice:async()=>({deviceId:f.call.device_id,staffId:f.call.staff_id,expiresAt:new Date(Date.now()+600000).toISOString()}),
  phoneRecover:async()=>[f.call],
  phoneEvent:async(_id:string,_key:string,kind:string):Promise<PhoneEventResult>=>{
   if(kind==="cancel"||kind==="conference_end")cancelled++;
   return {call:f.call,dial:kind==="agent_join",close:false,duplicate:false};
  },
 };
 const engine=new BrowserPhoneCalls(config,ops,{startCustomer:async()=>{dialed++;return customerSid;},close:async()=>{},ended:async()=>false});
 await engine.event(callId,"conference",new URLSearchParams({CallSid:sid,ConferenceSid:conf,FriendlyName:"ntp_"+callId,SequenceNumber:"1",StatusCallbackEvent:"participant-join",ParticipantLabel:"agent"}));
 assert.equal(dialed,1);
 f.call.agent_joined=true;f.call.customer_joined=true;f.call.state="connected";
 await engine.reconcile();assert.equal(cancelled,0);
 const disabled=new BrowserPhoneCalls({...config,mobileCallsEnabled:false},ops,{startCustomer:async()=>customerSid,close:async()=>{},ended:async()=>false});
 await disabled.reconcile();assert.equal(cancelled,1);
});
test("provider targets only the saved mobile leg with finite ringing and no recording",async()=>{
 let input:Record<string,unknown>|null=null;
 const client={calls:Object.assign(()=>({fetch:async()=>({status:"completed"})}),{create:async(x:Record<string,unknown>)=>{input=x;return {sid};}})};
 const f=fixture(),provider=new TwilioMobileCallProvider(config,client as unknown as ReturnType<typeof twilio>);
 assert.equal(await provider.start(f.leg),sid);
 assert.equal(input!.to,f.leg.phone);assert.equal(input!.timeout,25);assert.equal(input!.timeLimit,900);assert.equal(input!.record,false);
 assert.equal(input!.url,config.publicUrl+"/phone/twilio/mobile-call/prompt?id="+id);
});
