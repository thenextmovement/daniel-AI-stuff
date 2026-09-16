import test from "node:test";
import assert from "node:assert/strict";
import type {RuntimeConfig} from "../../services/voice-runtime/config";
import type {PhoneCallRecord} from "../../services/voice-runtime/phone-calls";
import {PhoneTransferFlow,TwilioTransferProvider,type PhoneTransfer,type TransferStore,type TransferProvider} from "../../services/voice-runtime/phone-transfers";

const sid=(n:string)=>"CA"+n.repeat(32),ca=sid("1"),cb=sid("2"),cc=sid("3"),room="CF"+"4".repeat(32);
const id="29500000-0000-4000-8000-000000000501",dA="29500000-0000-4000-8000-000000000101",dB="29500000-0000-4000-8000-000000000102";
function fixture(state="consulting"){
 const t={id,call_id:id,from_device_id:dA,to_device_id:dB,from_staff_id:"a",to_staff_id:"b",from_call_sid:ca,to_call_sid:state==="preparing"?null:cb,
  state,cancel_requested:false,target_joined:state==="consulting",customer_held:state!=="preparing",dial_claimed:state!=="preparing",target_guards_exit:false,source_releases_exit:false,
  owner_adopted:false,source_removed:false,target_removed:false,customer_resumed:false,ended_at:null,cleanup_pending:false} as PhoneTransfer;
 const call={id,conference_sid:room,agent_call_sid:ca,customer_call_sid:cc,ended_at:null} as PhoneCallRecord;
 const log:string[]=[];let fail="",holdGate:Promise<void>|null=null;
 const store:TransferStore={
  get:async()=>({transfer:{...t},call:{...call}}),currentDevice:async()=>{log.push("verify-target");},
  event:async(_id,_key,kind,_sid,actor)=>{
   log.push("save:"+kind);
   if(kind==="request_commit"){assert.equal(actor,dA);t.state="committing";}
   if(kind==="intent_cancel")t.cancel_requested=true;
   if(kind==="request_cancel")t.state="cancelling";
   const fields:Record<string,keyof PhoneTransfer>={held:"customer_held",claim_dial:"dial_claimed",target_guards:"target_guards_exit",source_releases:"source_releases_exit",
    adopt:"owner_adopted",source_removed:"source_removed",resumed:"customer_resumed",target_removed:"target_removed",rollback_resumed:"customer_resumed"};
   if(fields[kind])Object.assign(t,{[fields[kind]]:true});
   if(kind==="claim_dial")t.state="dialing";
   if(kind==="complete"||kind==="rollback_complete"){t.state=kind==="complete"?"transferred":"cancelled";t.ended_at=new Date().toISOString();}
   return {transfer:{...t},dial:kind==="claim_dial",duplicate:false};
  },
 };
 const provider:TransferProvider={
  guard:async(_call,sid,value)=>{log.push("guard:"+sid+":"+value);if(fail==="guard")throw Error("unconfirmed");},
  remove:async sid=>{log.push("remove:"+sid);if(fail==="remove")throw Error("still_connected");},
  holdCustomer:async(_call,value)=>{log.push("hold:"+value);if(holdGate&&value)await holdGate;if(fail==="hold")throw Error("unconfirmed");},
 };
 return {t,log,flow:new PhoneTransferFlow(store,provider),fail(value:string){fail=value;},gate(value:Promise<void>){holdGate=value;}};
}
test("handoff acknowledges new owner and old leg removal before returning the customer",async()=>{
 const f=fixture();await f.flow.commit(id,dA);
 const actions=f.log.filter(x=>x!=="verify-target");
 assert.deepEqual(actions,["save:request_commit","guard:"+cb+":true","save:target_guards","guard:"+ca+":false","save:source_releases","save:adopt",
  "remove:"+ca,"save:source_removed","hold:false","save:resumed","save:complete"]);
 assert.equal(f.t.state,"transferred");
});
test("failed provider confirmation stops dependent steps and resumes from durable progress",async()=>{
 const f=fixture();f.fail("remove");
 await assert.rejects(f.flow.commit(id,dA),/still_connected/);
 assert.equal(f.t.owner_adopted,true);assert.equal(f.t.source_removed,false);assert(!f.log.includes("hold:false"));
 f.fail("");await f.flow.resume(id);
 assert.equal(f.t.state,"transferred");
 assert.equal(f.log.filter(x=>x==="save:adopt").length,1);
});
test("invitation is published only after customer hold is confirmed",async()=>{
 const f=fixture("preparing");f.fail("hold");
 await assert.rejects(f.flow.prepare(id),/unconfirmed/);
 assert(!f.log.includes("save:claim_dial"));
 f.fail("");await f.flow.prepare(id);
 assert.deepEqual(f.log.slice(-4),["verify-target","hold:true","save:held","save:claim_dial"]);
});
test("rollback restores source exit protection and removes recipient before resuming customer",async()=>{
 const f=fixture();await f.flow.cancel(id,dA);
 assert.deepEqual(f.log,["save:intent_cancel","save:request_cancel","remove:"+cb,"guard:"+ca+":true","save:target_removed","hold:false","save:rollback_resumed","save:rollback_complete"]);
 assert.equal(f.t.owner_adopted,false);assert.equal(f.t.state,"cancelled");
});
test("a cancellation waits for an in-flight hold rather than racing it",async()=>{
 const f=fixture("preparing");let release!:()=>void;f.gate(new Promise<void>(r=>{release=r;}));
 const prepare=f.flow.prepare(id);
 await new Promise<void>(r=>setImmediate(r));
 const cancel=f.flow.cancel(id,dA);
 await new Promise<void>(r=>setImmediate(r));
 assert(!f.log.includes("save:request_cancel"));
 release();await Promise.all([prepare,cancel]);
 assert(f.log.indexOf("hold:true")<f.log.indexOf("hold:false"));assert.equal(f.t.state,"cancelled");
});
test("provider adapter demands matching participant and actual hold/exit acknowledgment",async()=>{
 const call={id,conference_sid:room,customer_call_sid:cc} as PhoneCallRecord;
 let mismatch=false;
 const client={conferences:()=>({participants:(requested:string)=>({update:async(input:{hold?:boolean;endConferenceOnExit?:boolean})=>({
  callSid:mismatch?ca:requested,conferenceSid:room,hold:input.hold,endConferenceOnExit:input.endConferenceOnExit,
 })})})};
 const provider=new TwilioTransferProvider({} as RuntimeConfig,client as never);
 await provider.holdCustomer(call,true);await provider.guard(call,cb,true);
 mismatch=true;
 await assert.rejects(provider.holdCustomer(call,false),/unconfirmed/);
 await assert.rejects(provider.guard(call,cb,false),/unconfirmed/);
});
