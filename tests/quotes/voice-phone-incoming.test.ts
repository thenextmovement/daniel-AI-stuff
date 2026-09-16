import test from "node:test";
import assert from "node:assert/strict";
import type {RuntimeConfig} from "../../services/voice-runtime/config";
import {IncomingPhoneCalls,incomingCustomerTwiml,inboundPhoneReady,type IncomingPhoneRecord,type IncomingEvent} from "../../services/voice-runtime/phone-incoming";
import type {PhoneCallRecord} from "../../services/voice-runtime/phone-calls";
import {exactIncomingCustomer} from "../../src/lib/ops/voice-phone-incoming";
import type {VoiceDirectoryContact} from "../../src/lib/ops/voice-directory";

const id="29500000-0000-4000-8000-000000000701",customer="CA"+"b".repeat(32),room="CF"+"c".repeat(32);
const config={teamPhoneEnabled:true,browserCallsEnabled:true,inboundPhoneEnabled:true,inboundPhoneNumbers:["+493055500000"],
 twilioAccountSid:"AC"+"4".repeat(32),twilioAuthToken:"fixture-only",twilioApiKeySid:"SK"+"5".repeat(32),twilioApiKeySecret:"fixture-key",
 twilioPhoneAppSid:"AP"+"6".repeat(32),twilioFromNumber:"+493055500000",phoneAllowedNumbers:["+493055501234"],publicUrl:"https://voice.example.test"} as RuntimeConfig;
function record(overrides:Partial<IncomingPhoneRecord>={}):IncomingPhoneRecord{return {id,customer_call_sid:customer,phone:"+493055501234",called_number:"+493055500000",
 customer_id:null,request_id:null,display_name:null,state:"waiting",device_id:null,staff_id:null,conference_sid:null,customer_joined:false,
 created_at:new Date().toISOString(),updated_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),ended_at:null,cleanup_pending:false,...overrides};}
function fixture(overrides:Partial<IncomingPhoneRecord>={},settings=config){
 const row=record(overrides),actions:Record<string,unknown>[]=[],routed:string[]=[],closed:string[]=[];
 let effect:IncomingEvent={incoming:row},transferHandled=false,stopFailure=false;
 const ops={incomingAction:async<T>(input:Record<string,unknown>):Promise<T>=>{
  actions.push(input);return (input.action==="pending"?{incoming:[row]}:input.action==="event"?effect:{incoming:row}) as T;
 }};
 return {row,actions,routed,closed,
  engine:new IncomingPhoneCalls(settings,ops,{event:async()=>{routed.push("call");},closeRecorded:async(c:PhoneCallRecord)=>{closed.push(c.id);}},
   {conference:async()=>{routed.push("transfer");return transferHandled;}},
   async()=>{closed.push("pending");if(stopFailure)throw Error("provider_unavailable");}),
  effect(value:IncomingEvent){effect=value;},handleTransfer(){transferHandled=true;},failStop(){stopFailure=true;},
 };
}
const request=()=>new URLSearchParams({Direction:"inbound",From:"+493055501234",To:"+493055500000",CallSid:customer});
const callback=(label="customer",sid=customer)=>new URLSearchParams({FriendlyName:"ntp_"+id,ConferenceSid:room,SequenceNumber:"1",
 StatusCallbackEvent:"participant-join",ParticipantLabel:label,CallSid:sid});

test("incoming pilot is opt-in and restricts both caller and called number before storage",async()=>{
 for(const settings of [{...config,inboundPhoneEnabled:false},{...config,inboundPhoneNumbers:[]},{...config,browserCallsEnabled:false}]){
  assert.equal(inboundPhoneReady(settings),false);const f=fixture({},settings);
  assert.match(await f.engine.receive(request()),/<Reject/);assert.equal(f.actions.length,0);
 }
 for(const [key,value] of [["Direction","outbound-api"],["From","+493055509999"],["To","+493055509999"],["CallSid","invalid"]]){
  const f=fixture(),p=request();p.set(key,value);assert.match(await f.engine.receive(p),/<Reject/);assert.equal(f.actions.length,0);
 }
});
test("arrival parks the existing caller, never dials another number, and binds its full conference lifecycle",async()=>{
 const f=fixture();const xml=await f.engine.receive(request());
 assert.match(xml,/startConferenceOnEnter="false"/);assert.match(xml,/endConferenceOnExit="true"/);
 assert.match(xml,/participantLabel="customer"/);assert.match(xml,/statusCallbackEvent="start end join leave"/);
 assert(xml.includes("/phone/twilio/incoming/conference?id="+id));assert(xml.includes("/phone/twilio/incoming/end?id="+id));
 assert(xml.includes("ntp_"+id));assert(!xml.includes("<Number>"));assert.equal(f.actions[0].action,"receive");
 await assert.rejects(fixture({phone:"+493055509999"}).engine.receive(request()),/binding_unconfirmed/);
 assert(!incomingCustomerTwiml(config,record({ended_at:new Date().toISOString()})).includes("<Conference"));
});
test("customer callback binding is checked before a state event, including room, leg and sequence",async()=>{
 for(const [key,value] of [["FriendlyName","ntp_other"],["ConferenceSid","CF"+"d".repeat(32)],["CallSid","CA"+"e".repeat(32)],["SequenceNumber","bad"]]){
  const f=fixture({conference_sid:room}),p=callback();p.set(key,value);
  await assert.rejects(f.engine.conference(id,p),/invalid_incoming_conference|incoming_call_mismatch/);
  assert.equal(f.actions.filter(x=>x.action==="event").length,0);
 }
 const f=fixture();await f.engine.conference(id,callback());
 assert.deepEqual(f.actions[1],{action:"event",incomingId:id,key:"conf:"+room+":1",kind:"customer_join",callSid:customer,conferenceSid:room});
 assert.equal(f.routed.length,0);
});
test("employee and later transfer participants reuse the bound call reducer behind the first participant callback",async()=>{
 const f=fixture({device_id:"29500000-0000-4000-8000-000000000101",conference_sid:room});
 await f.engine.conference(id,callback("agent","CA"+"e".repeat(32)));
 assert.deepEqual(f.routed,["transfer","call"]);assert.equal(f.actions.at(-1)?.kind,"sync");
 const t=fixture({device_id:f.row.device_id,conference_sid:room});t.handleTransfer();
 await t.engine.conference(id,callback("xfer_target","CA"+"f".repeat(32)));
 assert.deepEqual(t.routed,["transfer"]);assert.equal(t.actions.at(-1)?.kind,"sync");
 const pending=fixture();await pending.engine.conference(id,callback("agent","CA"+"e".repeat(32)));
 assert.equal(pending.routed.length,0);
});
test("dial end closes only the exact stored caller; pending cleanup is acknowledged after provider success",async()=>{
 const f=fixture({ended_at:new Date().toISOString(),cleanup_pending:true});f.effect({incoming:f.row,close:true});
 await assert.rejects(f.engine.end(id,new URLSearchParams({CallSid:"CA"+"e".repeat(32)})),/incoming_call_mismatch/);
 assert.equal(f.closed.length,0);
 assert.match(await f.engine.end(id,new URLSearchParams({CallSid:customer})),/<Hangup/);
 assert.deepEqual(f.closed,["pending"]);
 assert.deepEqual(f.actions.at(-1),{action:"cleanup",incomingId:id,updatedAt:f.row.updated_at});
 const failed=fixture({cleanup_pending:true});failed.effect({incoming:failed.row,close:true});failed.failStop();
 await assert.rejects(failed.engine.end(id,new URLSearchParams({CallSid:customer})),/provider_unavailable/);
 assert(!failed.actions.some(x=>x.action==="cleanup"));
});
test("accepted call cleanup uses the existing call lifecycle rather than an independent caller close",async()=>{
 const f=fixture();f.effect({incoming:f.row,call:{id} as PhoneCallRecord,closeCall:true});
 await f.engine.end(id,new URLSearchParams({CallSid:customer}));
 assert.deepEqual(f.closed,[id]);assert(!f.actions.some(x=>x.action==="cleanup"));
});
test("recovery expires abandoned incoming claims and leaves connected calls to normal call recovery",async()=>{
 const expired=fixture({state:"claimed",expires_at:new Date(Date.now()-1000).toISOString()});
 await expired.engine.reconcile();assert.equal(expired.actions[1].kind,"expire");
 const connected=fixture({state:"connected",expires_at:expired.row.expires_at});
 await connected.engine.reconcile();assert.equal(connected.actions[1].kind,"sync");
 const cleanup=fixture({cleanup_pending:true,ended_at:new Date().toISOString()});
 await cleanup.engine.reconcile();assert.deepEqual(cleanup.closed,["pending"]);assert.equal(cleanup.actions.at(-1)?.action,"cleanup");
});
test("phone lookup auto-selects only a unique exact, completely fetched customer match",()=>{
 const customer={customerId:"customer-a",phone:"+49 30 55501234"} as VoiceDirectoryContact;
 assert.equal(exactIncomingCustomer("+493055501234",[customer],null),customer);
 assert.equal(exactIncomingCustomer("+493055501234",[customer,{...customer,customerId:"customer-b"}],null),null);
 assert.equal(exactIncomingCustomer("+493055501234",[customer],40),null);
 assert.equal(exactIncomingCustomer("+493055501234",[{...customer,phone:"+493055509999"}],null),null);
});
