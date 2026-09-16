import test from "node:test";
import assert from "node:assert/strict";
import twilio from "twilio";
import type {RuntimeConfig} from "../../services/voice-runtime/config";
import {BrowserPhoneCalls,browserCallingReady,browserPhoneControlReady,phoneAgentTwiml,phoneWebhookParameters,
 type PhoneCallRecord,type PhoneCallOps,type PhoneCallProvider,type PhoneEventResult} from "../../services/voice-runtime/phone-calls";

const id="29500000-0000-4000-8000-000000000201",deviceId="29500000-0000-4000-8000-000000000101";
const staffId="29500000-0000-4000-8000-000000000001",agent="CA"+"1".repeat(32),customer="CA"+"2".repeat(32),conference="CF"+"3".repeat(32);
const config={teamPhoneEnabled:true,browserCallsEnabled:true,twilioAccountSid:"AC"+"4".repeat(32),twilioAuthToken:"fixture-only",
 twilioApiKeySid:"SK"+"5".repeat(32),twilioApiKeySecret:"fixture-key",twilioPhoneAppSid:"AP"+"6".repeat(32),
 twilioFromNumber:"+493055500000",phoneAllowedNumbers:["+493055501234"],publicUrl:"https://voice.example.test"} as RuntimeConfig;
function record(overrides:Partial<PhoneCallRecord>={}):PhoneCallRecord{return {
 id,device_id:deviceId,staff_id:staffId,phone:"+493055501234",state:"dialing",agent_call_sid:agent,customer_call_sid:null,conference_sid:conference,
 customer_dispatch:"claimed",agent_joined:true,customer_joined:false,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),ended_at:null,cleanup_pending:false,...overrides,
};}
function fixture(overrides:Partial<PhoneCallRecord>={},settings:RuntimeConfig=config) {
 let call=record(overrides),creates=0,closes=0;const actions:Array<{action:string;input:Record<string,unknown>}>=[],events:string[]=[];
 const effects:Partial<PhoneEventResult>[]=[];
 let providerFailure=false,closeFailure=false,deviceFailure=false;
 const ops:PhoneCallOps={
  phoneCall:async(action,input)=>{actions.push({action,input});return {call};},
  phoneEvent:async(_id,_key,kind)=>{events.push(kind);const effect=effects.shift()||{};return {call,dial:false,close:false,duplicate:false,...effect};},
  getPhoneDevice:async(d,s)=>{assert.equal(d,deviceId);assert.equal(s,staffId);if(deviceFailure)throw Object.assign(Error("revoked"),{status:401});return {deviceId,staffId,expiresAt:new Date(Date.now()+3600000).toISOString()};},
  phoneRecover:async()=>[call],
 };
 const provider:PhoneCallProvider={
  startCustomer:async(value,url)=>{creates++;assert.equal(value.phone,call.phone);assert.equal(url,config.publicUrl+"/phone/twilio/customer?id="+id);if(providerFailure)throw Error("network_uncertain");return customer;},
  close:async()=>{closes++;if(closeFailure)throw Error("provider_unavailable");},
  ended:async()=>false,
 };
 return {engine:new BrowserPhoneCalls(settings,ops,provider),actions,events,effects,
  get creates(){return creates;},get closes(){return closes;},
  setCall(value:PhoneCallRecord){call=value;},failProvider(){providerFailure=true;},failClose(){closeFailure=true;},revoke(){deviceFailure=true;},
 };
}
const join=()=>new URLSearchParams({FriendlyName:"ntp_"+id,ConferenceSid:conference,SequenceNumber:"1",StatusCallbackEvent:"participant-join",ParticipantLabel:"agent",CallSid:agent});

test("browser client binds the personal device and uses stored room; forged target is ignored",async()=>{
 const f=fixture();
 const xml=await f.engine.client(new URLSearchParams({callId:id,From:"client:ntd_"+deviceId.replace(/-/g,""),CallSid:agent,To:"+499999999999"}));
 assert(xml.includes("ntp_"+id));assert(!xml.includes("+499999999999"));
 assert(xml.includes('endConferenceOnExit="true"'));assert(xml.includes('timeLimit="900"'));assert(xml.includes('participantLabel="agent"'));
 assert.deepEqual(f.actions[0],{action:"bind",input:{callId:id,deviceId,agentCallSid:agent}});
 assert.equal(f.creates,0,"the customer must not be dialed before the agent joined");
 await assert.rejects(f.engine.client(new URLSearchParams({callId:id,From:"Rahim",CallSid:agent})),/invalid_phone_identity/);
 const wrong=fixture({device_id:"29500000-0000-4000-8000-000000000999"});
 await assert.rejects(wrong.engine.client(new URLSearchParams({callId:id,From:"client:ntd_"+deviceId.replace(/-/g,""),CallSid:agent})),/phone_call_forbidden/);
 const denied=fixture({phone:"+493099999999"});
 await assert.rejects(denied.engine.client(new URLSearchParams({callId:id,From:"client:ntd_"+deviceId.replace(/-/g,""),CallSid:agent})),/phone_call_forbidden/);
});
test("callbacks require an exact Twilio signature, account and unambiguous fields",()=>{
 const url=new URL(config.publicUrl+"/phone/twilio/conference?id="+id),params=join();params.set("AccountSid",config.twilioAccountSid);
 const sign=(p:URLSearchParams)=>twilio.getExpectedTwilioSignature(config.twilioAuthToken,url.toString(),Object.fromEntries(p));
 assert.equal(phoneWebhookParameters(config,url,sign(params),params.toString()).get("CallSid"),agent);
 assert.throws(()=>phoneWebhookParameters(config,url,"invalid",params.toString()),/signature/);
 assert.throws(()=>phoneWebhookParameters(config,new URL(url.toString()+"x"),sign(params),params.toString()),/signature/);
 const wrong=new URLSearchParams(params);wrong.set("AccountSid","AC"+"a".repeat(32));
 assert.throws(()=>phoneWebhookParameters(config,url,sign(wrong),wrong.toString()),/signature/);
 const duplicate=new URLSearchParams(params);duplicate.append("CallSid",customer);
 assert.throws(()=>phoneWebhookParameters(config,url,sign(duplicate),duplicate.toString()),/signature/);
});
test("only the atomic joined effect creates one customer leg and acknowledges it",async()=>{
 const f=fixture();f.effects.push({dial:true},{});
 await f.engine.event(id,"conference",join());
 assert.equal(f.creates,1);assert.deepEqual(f.events,["agent_join","dispatch_ack"]);
 f.effects.push({duplicate:true});
 await f.engine.event(id,"conference",join());assert.equal(f.creates,1);
});
test("uncertain provider write never retries dialing, including recovery",async()=>{
 const f=fixture({created_at:new Date(Date.now()-70000).toISOString()});f.failProvider();f.effects.push({dial:true},{});
 await f.engine.event(id,"conference",join());
 assert.equal(f.creates,1);assert.deepEqual(f.events,["agent_join","dispatch_uncertain"]);
 await f.engine.event(id,"conference",join());assert.equal(f.creates,1);
 f.effects.push({close:true});await f.engine.reconcile();assert.equal(f.creates,1);assert.equal(f.closes,1);assert(f.events.includes("cancel"));
});
test("revocation before provider write cancels without calling",async()=>{
 const f=fixture();f.revoke();f.effects.push({dial:true},{close:true,call:record({ended_at:new Date().toISOString(),cleanup_pending:true})});
 await f.engine.event(id,"conference",join());assert.equal(f.creates,0);assert.equal(f.closes,1);assert(f.events.includes("cancel"));
});
test("wrong conference, caller leg status or participant cannot reach the state reducer",async()=>{
 const f=fixture(),bad=join();bad.set("FriendlyName","ntp_other");
 await assert.rejects(f.engine.event(id,"conference",bad),/invalid_phone_conference/);
 const wrong=new URLSearchParams({CallSid:customer,CallStatus:"ringing",To:"+499999999999"});
 await assert.rejects(f.engine.event(id,"customer",wrong),/invalid_phone_customer/);
 const unknown=join();unknown.set("ParticipantLabel","unregistered-member");
 await f.engine.event(id,"conference",unknown);assert.equal(f.events.length,0);
});
test("failed cleanup is left pending and successful cleanup acknowledges only its version",async()=>{
 const pending=record({ended_at:new Date().toISOString(),cleanup_pending:true});
 const f=fixture();f.effects.push({close:true,call:pending});f.failClose();
 await assert.rejects(f.engine.event(id,"conference",join()),/provider_unavailable/);
 assert(!f.actions.some(x=>x.action==="cleanup"));
 const successful=fixture(pending);await successful.engine.reconcile();
 assert.deepEqual(successful.actions.find(x=>x.action==="cleanup")?.input,{callId:id,updatedAt:pending.updated_at});
});
test("disabling new browser calls retains cleanup control and closes an active pilot",async()=>{
 const settings={...config,browserCallsEnabled:false};assert.equal(browserCallingReady(settings),false);assert.equal(browserPhoneControlReady(settings),true);
 const f=fixture({},settings);f.effects.push({close:true});
 await assert.rejects(f.engine.client(new URLSearchParams()),/not_configured/);
 await f.engine.reconcile();assert.equal(f.creates,0);assert.equal(f.closes,1);
});
test("another staff or device cannot cancel the call",async()=>{
 const f=fixture();
 await assert.rejects(f.engine.cancel(id,deviceId,"29500000-0000-4000-8000-000000000002"),/phone_call_forbidden/);
 assert.equal(f.closes,0);assert.equal(f.events.length,0);
});

test("provider cleanup tolerates already-ended and racing call legs without hiding active failures",async()=>{
 const {TwilioPhoneProvider}=await import("../../services/voice-runtime/phone-calls");
 let conferenceReads=0,agentReads=0,customerReads=0,updates=0;
 const client={
  conferences:()=>({fetch:async()=>{conferenceReads++;return {status:"completed"};},update:async()=>{throw Error("must not update closed conference");}}),
  calls:(sid:string)=>({
   fetch:async()=>({status:sid===agent?(++agentReads===1?"in-progress":"completed"):(++customerReads,"completed")}),
   update:async()=>{updates++;throw Object.assign(Error("already ended"),{status:400});},
  }),
 };
 await new TwilioPhoneProvider(config,client as never).close(record({customer_call_sid:customer}));
 assert.equal(conferenceReads,1);assert.equal(agentReads,2);assert.equal(customerReads,1);assert.equal(updates,1);
 const failing={...client,calls:()=>({fetch:async()=>({status:"in-progress"}),update:async()=>{throw Error("network");}})};
 await assert.rejects(new TwilioPhoneProvider(config,failing as never).close(record()),/phone_cleanup_pending/);
});

test("a stale operator or recovery observation cannot close the adopted call",async()=>{
 const f=fixture({created_at:new Date(Date.now()-70000).toISOString()});
 // The SQL reducer returns close:false when its expected agent is no longer owner.
 await f.engine.cancel(id,deviceId,staffId);
 await f.engine.reconcile();
 assert.equal(f.closes,0);
 assert(!f.actions.some(x=>x.action==="cleanup"));
});

test("incoming browser joins require the inbound flag, and answered caller alone is not a connected public call",async()=>{
 const p=new URLSearchParams({callId:id,From:"client:ntd_"+deviceId.replace(/-/g,""),CallSid:agent});
 const enabled=fixture({direction:"inbound"},{...config,inboundPhoneEnabled:true});
 assert.match(await enabled.engine.client(p),/<Conference/);
 await assert.rejects(fixture({direction:"inbound"},{...config,inboundPhoneEnabled:false}).engine.client(p),/phone_call_forbidden/);
 const {publicPhoneCall}=await import("../../src/lib/ops/voice-phone-calls");
 assert.equal(publicPhoneCall(record({direction:"inbound",customer_joined:true,agent_joined:false})).connected,false);
 assert.equal(publicPhoneCall(record({direction:"inbound",customer_joined:true,agent_joined:true})).connected,true);
});
