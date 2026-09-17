import twilio from "twilio";
import type {RuntimeConfig} from "./config.js";
import {phoneRoom,type PhoneCallRecord} from "./phone-calls.js";

export type PhoneTransfer = {
 to_transport?:"browser"|"mobile";mobile_leg_id?:string|null;
 id:string;call_id:string;from_staff_id:string;from_device_id:string;from_call_sid:string;
 to_staff_id:string;to_device_id:string;to_call_sid:string|null;state:string;
 cancel_requested:boolean;customer_held:boolean;dial_claimed:boolean;target_joined:boolean;target_guards_exit:boolean;
 source_releases_exit:boolean;owner_adopted:boolean;source_removed:boolean;target_removed:boolean;
 customer_resumed:boolean;cleanup_pending:boolean;created_at:string;expires_at:string;ended_at:string|null;updated_at:string;
};
export type TransferEvent={transfer:PhoneTransfer;dial:boolean;duplicate:boolean};
export interface TransferStore {
 get(id:string):Promise<{transfer:PhoneTransfer;call:PhoneCallRecord}>;
 event(id:string,key:string,kind:string,callSid?:string|null,actorDeviceId?:string|null):Promise<TransferEvent>;
 currentDevice(deviceId:string,staffId:string):Promise<unknown>;
}
export interface TransferProvider {
 holdCustomer(call:PhoneCallRecord,hold:boolean):Promise<void>;
 guard(call:PhoneCallRecord,sid:string,enabled:boolean):Promise<void>;
 remove(sid:string):Promise<void>;
}
const SID=/^CA[a-f0-9]{32}$/i;
const TERMINAL=new Set(["completed","failed","busy","no-answer","canceled"]);
export class TwilioTransferProvider implements TransferProvider {
 private readonly client;
 constructor(private readonly config:RuntimeConfig,client?:ReturnType<typeof twilio>){
  this.client=client||twilio(config.twilioAccountSid,config.twilioAuthToken,{autoRetry:false,timeout:15000});
 }
 private participant(call:PhoneCallRecord,sid:string) {
  if(!/^CF[a-f0-9]{32}$/i.test(call.conference_sid||"") || !SID.test(sid))throw Error("invalid_transfer_participant");
  return this.client.conferences(call.conference_sid!).participants(sid);
 }
 async holdCustomer(call:PhoneCallRecord,hold:boolean) {
  if(!call.customer_call_sid)throw Error("transfer_customer_missing");
  const result=await this.participant(call,call.customer_call_sid).update({hold});
  if(result.callSid!==call.customer_call_sid || result.conferenceSid!==call.conference_sid || result.hold!==hold)
   throw Error("transfer_hold_unconfirmed");
 }
 async guard(call:PhoneCallRecord,sid:string,enabled:boolean) {
  const result=await this.participant(call,sid).update({endConferenceOnExit:enabled});
  if(result.callSid!==sid || result.conferenceSid!==call.conference_sid || result.endConferenceOnExit!==enabled)
   throw Error("transfer_exit_behavior_unconfirmed");
 }
 async remove(sid:string) {
  if(!SID.test(sid))throw Error("invalid_transfer_participant");
  const endpoint=this.client.calls(sid);
  try {
   let status=(await endpoint.fetch()).status;
   if(TERMINAL.has(status))return;
   try{await endpoint.update({status:["queued","ringing"].includes(status)?"canceled":"completed"});}
   catch(error){status=(await endpoint.fetch()).status;if(!TERMINAL.has(status))throw error;return;}
   if(!TERMINAL.has((await endpoint.fetch()).status))throw Error("transfer_leg_removal_unconfirmed");
  }catch(error){if((error as {status?:number}).status!==404)throw error;}
 }
}
export function phoneTransferTwiml(config:RuntimeConfig,t:PhoneTransfer,call:PhoneCallRecord) {
 const response=new twilio.twiml.VoiceResponse();
 response.dial({timeLimit:900}).conference({
  participantLabel:"xfer_"+t.id,startConferenceOnEnter:true,endConferenceOnExit:t.owner_adopted,beep:"false",jitterBufferSize:"small",region:"de1",maxParticipants:4,
  statusCallback:config.publicUrl+"/phone/twilio/conference?id="+encodeURIComponent(call.id),
  statusCallbackMethod:"POST",statusCallbackEvent:["start","end","join","leave"],
 },phoneRoom(call.id));response.hangup();
 return response.toString();
}
// Each provider change is acknowledged durably before a dependent change starts.
// Repeating an idempotent step is safe. A recipient initiates their own browser
// leg only after accepting a still-current, personally bound invitation.
export class PhoneTransferFlow {
 private readonly pending=new Map<string,Promise<void>>();
 constructor(private readonly store:TransferStore,private readonly provider:TransferProvider){}
 private serial(id:string,work:()=>Promise<void>) {
  const task=(this.pending.get(id)||Promise.resolve()).catch(()=>{}).then(work);
  this.pending.set(id,task);
  return task.finally(()=>{if(this.pending.get(id)===task)this.pending.delete(id);});
 }
 prepare(id:string){return this.serial(id,()=>this.prepareSteps(id));}
 commit(id:string,actorDeviceId:string){return this.serial(id,async()=>{
  await this.store.event(id,"operator:commit","request_commit",null,actorDeviceId);
  await this.finishCommit(id);
 });}
 async cancel(id:string,actorDeviceId:string){
  await this.store.event(id,"operator:cancel-intent","intent_cancel",null,actorDeviceId);
  return this.serial(id,async()=>{
  await this.store.event(id,"operator:cancel","request_cancel",null,actorDeviceId);
  await this.finishCancel(id);
 });}
 resume(id:string){return this.serial(id,async()=>{
  const {transfer:t}=await this.store.get(id);
  if(t.cancel_requested && !t.ended_at && t.state!=="committing" && t.state!=="cancelling"){
   await this.store.event(id,"recovery:cancel","request_cancel",null,t.from_device_id);
   await this.finishCancel(id);
  }else if(t.state==="committing")await this.finishCommit(id);
  else if(t.state==="cancelling")await this.finishCancel(id);
  else if(t.state==="preparing")await this.prepareSteps(id);
 });}
 private async prepareSteps(id:string) {
  let {transfer:t,call}=await this.store.get(id);
  if(call.ended_at || t.ended_at || !["preparing","dialing"].includes(t.state))return;
  await this.store.currentDevice(t.to_device_id,t.to_staff_id);
  if(!t.customer_held){
   await this.provider.holdCustomer(call,true);
   t=(await this.store.event(id,"prepare:held","held")).transfer;
  }
  if(t.cancel_requested)return;
  // The recipient sees a server-bound offer and explicitly accepts in Ops.
  // Their Device.connect reaches the signed admission endpoint before joining;
  // no speculative provider leg is created while the invitation is pending.
  await this.store.event(id,"prepare:dial","claim_dial");
 }
 private async finishCommit(id:string) {
  for(let i=0;i<7;i++){
   const {transfer:t,call}=await this.store.get(id);
   if(t.ended_at || call.ended_at || t.state!=="committing")return;
   if(!t.to_call_sid || !t.target_joined)throw Error("transfer_target_not_connected");
   await this.store.currentDevice(t.to_device_id,t.to_staff_id);
   if(!t.target_guards_exit){
    await this.provider.guard(call,t.to_call_sid,true);
    await this.store.event(id,"commit:target-guards","target_guards");
   }else if(!t.source_releases_exit){
    await this.provider.guard(call,t.from_call_sid,false);
    await this.store.event(id,"commit:source-releases","source_releases");
   }else if(!t.owner_adopted){
    await this.store.event(id,"commit:adopt","adopt");
   }else if(!t.source_removed){
    await this.provider.remove(t.from_call_sid);
    await this.store.event(id,"commit:source-removed","source_removed");
   }else if(!t.customer_resumed){
    await this.provider.holdCustomer(call,false);
    await this.store.event(id,"commit:resumed","resumed");
   }else{
    await this.store.event(id,"commit:complete","complete");return;
   }
  }
 }
 private async finishCancel(id:string) {
  for(let i=0;i<4;i++){
   const {transfer:t,call}=await this.store.get(id);
   if(t.ended_at || call.ended_at || t.state!=="cancelling")return;
   if(t.owner_adopted)throw Error("transfer_owner_already_changed");
   if(!t.target_removed){
    if(t.to_call_sid)await this.provider.remove(t.to_call_sid);
    await this.provider.guard(call,t.from_call_sid,true);
    await this.store.event(id,"cancel:target-removed","target_removed");
   }else if(!t.customer_resumed){
    await this.provider.holdCustomer(call,false);
    await this.store.event(id,"cancel:resumed","rollback_resumed");
   }else{
    await this.store.event(id,"cancel:complete","rollback_complete");return;
   }
  }
 }
}
