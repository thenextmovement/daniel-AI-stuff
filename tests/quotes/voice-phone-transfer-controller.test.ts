import test from "node:test";
import assert from "node:assert/strict";
import type {RuntimeConfig} from "../../services/voice-runtime/config";
import {RuntimePhoneTransfers,type TransferOps} from "../../services/voice-runtime/phone-transfer-controller";
import type {PhoneTransfer,TransferProvider} from "../../services/voice-runtime/phone-transfers";
import type {PhoneCallRecord} from "../../services/voice-runtime/phone-calls";
const id="29500000-0000-4000-8000-000000000501",callId="29500000-0000-4000-8000-000000000201";
const dA="29500000-0000-4000-8000-000000000101",dB="29500000-0000-4000-8000-000000000102",dX="29500000-0000-4000-8000-000000000103";
const sA="29500000-0000-4000-8000-000000000001",sB="29500000-0000-4000-8000-000000000002";
const ca="CA"+"1".repeat(32),cb="CA"+"2".repeat(32),cc="CA"+"3".repeat(32),room="CF"+"4".repeat(32);
const config={teamPhoneEnabled:true,browserCallsEnabled:true,twilioAccountSid:"AC"+"4".repeat(32),twilioAuthToken:"fixture-only",
 twilioApiKeySid:"SK"+"5".repeat(32),twilioApiKeySecret:"fixture-key",twilioPhoneAppSid:"AP"+"6".repeat(32),
 twilioFromNumber:"+493055500000",phoneAllowedNumbers:["+493055501234"],publicUrl:"https://voice.example.test"} as RuntimeConfig;
function fixture(){
 const t={id,call_id:callId,from_device_id:dA,from_staff_id:sA,from_call_sid:ca,to_device_id:dB,to_staff_id:sB,to_call_sid:cb,
  state:"dialing",customer_held:true,dial_claimed:true,cancel_requested:false,owner_adopted:false,ended_at:null,
  expires_at:new Date(Date.now()+60000).toISOString(),updated_at:new Date().toISOString()} as PhoneTransfer;
 const call={id:callId,device_id:dA,staff_id:sA,phone:"+493055501234",agent_call_sid:ca,customer_call_sid:cc,conference_sid:room,ended_at:null} as PhoneCallRecord;
 const actions:Record<string,unknown>[]=[],events:string[]=[],providerEvents:string[]=[];let closed=0,deviceRevoked=false;
 const ops:TransferOps={
  transferAction:async<T>(input:Record<string,unknown>)=>{
   actions.push(input);
   if(input.action==="event"){
    events.push(input.kind as string);
    if(input.kind==="intent_cancel")t.cancel_requested=true;
    if(input.kind==="request_commit"){assert.equal(input.actorDeviceId,dA);t.state="committing";}
    return {transfer:{...t},dial:false,duplicate:false} as T;
   }
   if(input.action==="pending")return {transfers:[t]} as T;
   return {transfer:{...t},call:{...call}} as T;
  },
  getPhoneDevice:async(deviceId,staffId)=>{
   if(deviceRevoked)throw Object.assign(Error("revoked"),{status:401});
   return {deviceId,staffId,expiresAt:new Date(Date.now()+3600000).toISOString()};
  },
  phoneEvent:async(_id,_key,kind,sid)=>{events.push(kind+":"+sid);return {call,close:kind==="agent_leave",dial:false,duplicate:false};},
 };
 const provider:TransferProvider={
  holdCustomer:async()=>{providerEvents.push("hold");throw Error("fixture_stop");},
  guard:async()=>{providerEvents.push("guard");throw Error("fixture_stop");},
  remove:async sid=>{providerEvents.push("remove:"+sid);},
 };
 return {controller:new RuntimePhoneTransfers(config,ops,async()=>{closed++;},provider),t,call,actions,events,providerEvents,
  get closed(){return closed;},revoke(){deviceRevoked=true;}};
}
const clientParams=()=>new URLSearchParams({transferId:id,From:"client:ntd_"+dB.replace(/-/g,""),CallSid:cb,To:"+499999999999"});
const eventParams=(kind="participant-join")=>new URLSearchParams({ParticipantLabel:"xfer_"+id,CallSid:cb,ConferenceSid:room,FriendlyName:"ntp_"+callId,SequenceNumber:"18",StatusCallbackEvent:kind});
test("recipient TwiML admits only the device and call leg bound by the invitation",async()=>{
 const f=fixture();const xml=await f.controller.client(clientParams());
 assert(xml.includes('participantLabel="xfer_'+id+'"'));assert(xml.includes('endConferenceOnExit="false"'));
 assert(xml.includes("ntp_"+callId));assert(!xml.includes("+499999999999"));
 assert.deepEqual(f.actions[0],{action:"bind",transferId:id,deviceId:dB,callSid:cb});
 f.t.to_device_id=dX;await assert.rejects(f.controller.client(clientParams()),/invitation_not_current/);
 f.t.to_device_id=dB;f.t.cancel_requested=true;await assert.rejects(f.controller.client(clientParams()),/invitation_not_current/);
 assert.equal(f.providerEvents.length,0,"admission does not create an external customer leg");
});
test("transfer callback checks exact room, invitation, target and sequence",async()=>{
 const f=fixture();await f.controller.conference(callId,eventParams());
 assert.deepEqual(f.events,["target_joined"]);
 const wrong=eventParams();wrong.set("CallSid",ca);
 await assert.rejects(f.controller.conference(callId,wrong),/invalid_transfer_conference/);
 wrong.set("CallSid",cb);wrong.set("FriendlyName","ntp_"+id);
 await assert.rejects(f.controller.conference(callId,wrong),/invalid_transfer_conference/);
 assert.equal(f.events.length,1);
 assert.equal(await f.controller.conference(callId,new URLSearchParams({ParticipantLabel:"customer"})),false);
});
test("adopted recipient exits use the call reducer, including a subsequent onward transfer",async()=>{
 const f=fixture();f.t.owner_adopted=true;f.t.state="transferred";f.t.ended_at=new Date().toISOString();
 f.call.agent_call_sid=cb;await f.controller.conference(callId,eventParams("participant-leave"));
 assert.equal(f.closed,1);assert.deepEqual(f.events,["agent_leave:"+cb]);
 // The call reducer recognizes this former agent after a second handoff.
 f.call.agent_call_sid=ca;await f.controller.conference(callId,eventParams("participant-leave"));
 assert.equal(f.events[1],"agent_leave:"+cb);
 assert(!f.events.includes("target_left"),"an old transfer must not become active again");
});
test("unrelated or revoked devices cannot control a transfer",async()=>{
 const f=fixture();
 await assert.rejects(f.controller.control({action:"cancel",transferId:id,deviceId:dX,staffId:sA}),/forbidden/);
 assert.equal(f.events.length,0);f.revoke();
 await assert.rejects(f.controller.control({action:"cancel",transferId:id,deviceId:dA,staffId:sA}),/revoked/);
 assert.equal(f.events.length,0);
});
test("cancel intent is stored before acknowledgment even if later provider cleanup fails",async()=>{
 const f=fixture();const result=await f.controller.control({action:"cancel",transferId:id,deviceId:dA,staffId:sA});
 assert.equal(result.transferId,id);assert.equal(f.events[0],"intent_cancel");assert(f.t.cancel_requested);
 await new Promise<void>(r=>setImmediate(r));
});
