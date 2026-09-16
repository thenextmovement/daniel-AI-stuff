import twilio from "twilio";
import type {RuntimeConfig} from "./config.js";
import type {OpsClient} from "./ops-client.js";
import type {PhoneCallRecord,PhoneEventResult} from "./phone-calls.js";
import {browserCallingReady,phoneRoom} from "./phone-calls.js";
import {PhoneTransferFlow,TwilioTransferProvider,type PhoneTransfer,type TransferStore,type TransferEvent,type TransferProvider} from "./phone-transfers.js";
type Snapshot={transfer:PhoneTransfer;call:PhoneCallRecord};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function uuid(input:unknown){if(typeof input!=="string"||!UUID.test(input))throw Error("invalid_transfer_identity");return input;}
export type TransferOps=Pick<OpsClient,"transferAction"|"getPhoneDevice"|"phoneEvent">;
class OpsTransferStore implements TransferStore{
 constructor(private readonly ops:TransferOps){}
 get(id:string){return this.ops.transferAction<Snapshot>({action:"get",transferId:id});}
 event(id:string,key:string,kind:string,callSid?:string|null,actorDeviceId?:string|null){
  return this.ops.transferAction<TransferEvent>({action:"event",transferId:id,key,kind,callSid,actorDeviceId});
 }
 currentDevice(deviceId:string,staffId:string){return this.ops.getPhoneDevice(deviceId,staffId);}
}
export class RuntimePhoneTransfers{
 private readonly store:OpsTransferStore;
 private readonly provider:TransferProvider;
 private readonly flow:PhoneTransferFlow;
 constructor(private readonly config:RuntimeConfig,private readonly ops:TransferOps,private readonly closeCall:(call:PhoneCallRecord)=>Promise<void>,provider?:TransferProvider){
  this.store=new OpsTransferStore(ops);this.provider=provider||new TwilioTransferProvider(config);this.flow=new PhoneTransferFlow(this.store,this.provider);
 }
 private kick(id:string,work:Promise<void>){void work.catch(()=>console.warn("phone transfer action pending",id));}
 async control(input:Record<string,unknown>){
  const deviceId=uuid(input.deviceId),staffId=uuid(input.staffId);
  await this.ops.getPhoneDevice(deviceId,staffId);
  if(input.action==="begin"){
   if(!browserCallingReady(this.config))throw Error("browser_calling_not_configured");
   const {transfer:t}=await this.ops.transferAction<{transfer:PhoneTransfer}>({
    action:"begin",callId:uuid(input.callId),deviceId,targetStaffId:uuid(input.targetStaffId),requestKey:uuid(input.requestKey),
   });
   this.kick(t.id,this.flow.prepare(t.id));return {transferId:t.id};
  }
  const id=uuid(input.transferId),{transfer:t}=await this.store.get(id);
  if(t.from_device_id!==deviceId&&t.to_device_id!==deviceId)throw Error("transfer_actor_forbidden");
  if(input.action==="commit"){
   // Persist intent before returning to the browser; the same stable step key
   // is used by retries and by the recovery worker.
   await this.store.event(id,"operator:commit","request_commit",null,deviceId);
   this.kick(id,this.flow.resume(id));
  }else if(input.action==="cancel"){
   await this.store.event(id,"operator:cancel-intent","intent_cancel",null,deviceId);
   this.kick(id,this.flow.resume(id));
  }else throw Error("invalid_transfer_action");
  return {transferId:id};
 }
 async client(params:URLSearchParams){
  if(!browserCallingReady(this.config))throw Error("browser_calling_not_configured");
  const id=uuid(params.get("transferId")),from=params.get("From")||"",sid=params.get("CallSid")||"";
  if(!/^client:ntd_[a-f0-9]{32}$/.test(from)||!/^CA[a-f0-9]{32}$/i.test(sid))throw Error("invalid_transfer_identity");
  const hex=from.slice("client:ntd_".length),deviceId=hex.slice(0,8)+"-"+hex.slice(8,12)+"-"+hex.slice(12,16)+"-"+hex.slice(16,20)+"-"+hex.slice(20);
  const {transfer:t,call}=await this.ops.transferAction<Snapshot>({action:"bind",transferId:id,deviceId,callSid:sid});
  if(t.id!==id||t.to_device_id!==deviceId||t.to_call_sid!==sid||t.ended_at||t.cancel_requested||call.ended_at||!t.customer_held||!call.conference_sid)
   throw Error("transfer_invitation_not_current");
  const response=new twilio.twiml.VoiceResponse();
  response.dial({timeLimit:900}).conference({
   participantLabel:"xfer_"+t.id,startConferenceOnEnter:true,endConferenceOnExit:false,beep:"false",jitterBufferSize:"small",region:"de1",maxParticipants:4,
   statusCallback:this.config.publicUrl+"/phone/twilio/conference?id="+encodeURIComponent(call.id),
   statusCallbackMethod:"POST",statusCallbackEvent:["start","end","join","leave"],
  },phoneRoom(call.id));response.hangup();
  return response.toString();
 }
 async conference(callId:string,params:URLSearchParams){
  const label=params.get("ParticipantLabel")||"";
  if(!label.startsWith("xfer_"))return false;
  const id=uuid(label.slice(5)),{transfer:t,call}=await this.store.get(id),sid=params.get("CallSid")||"";
  if(call.id!==callId||t.call_id!==callId||call.conference_sid!==params.get("ConferenceSid")||
   params.get("FriendlyName")!==phoneRoom(callId)||t.to_call_sid!==sid||!/^[0-9]{1,10}$/.test(params.get("SequenceNumber")||""))
   throw Error("invalid_transfer_conference");
  const event=params.get("StatusCallbackEvent");
  if(event!=="participant-join"&&event!=="participant-leave")return true;
  const key="conf:"+call.conference_sid+":"+params.get("SequenceNumber");
  if(call.agent_call_sid===sid || t.state==="transferred"){
   const result:PhoneEventResult=await this.ops.phoneEvent(call.id,key,event==="participant-join"?"agent_join":"agent_leave",sid,call.conference_sid);
   if(result.close)await this.closeCall(result.call);
  }else{
   const result=await this.store.event(id,key,event==="participant-join"?"target_joined":"target_left",sid);
   if(result.transfer.state==="cancelling")this.kick(id,this.flow.resume(id));
  }
  return true;
 }
 async reconcile(){
  const {transfers}=await this.ops.transferAction<{transfers:PhoneTransfer[]}>({action:"pending"});
  for(const row of transfers){
   try{
    const {transfer:t,call}=await this.store.get(row.id);
    if(call.ended_at){
     if(!t.ended_at)await this.store.event(t.id,"recovery:call-ended","call_ended");
     if(t.to_call_sid)await this.provider.remove(t.to_call_sid);
     await this.provider.remove(t.from_call_sid);
     const fresh=await this.store.get(t.id);
     await this.ops.transferAction({action:"cleanup",transferId:t.id,updatedAt:fresh.transfer.updated_at});
    }else if(t.ended_at){
     if(!t.cleanup_pending)continue;
     if(t.owner_adopted){
      const closed=await this.ops.phoneEvent(call.id,"transfer:failed:"+t.id,"cancel");
      await this.closeCall(closed.call);
     }else{
      if(t.to_call_sid)await this.provider.remove(t.to_call_sid);
      await this.ops.transferAction({action:"cleanup",transferId:t.id,updatedAt:t.updated_at});
     }
    }else if(["preparing","dialing"].includes(t.state)&&(Date.parse(t.expires_at)<Date.now()||!this.config.browserCallsEnabled)){
     await this.flow.cancel(t.id,t.from_device_id);
    }else{
     try{await this.store.currentDevice(t.to_device_id,t.to_staff_id);}
     catch(error){
      if(![401,403,404].includes((error as {status?:number}).status||0))throw error;
      if(t.to_call_sid){
       await this.provider.remove(t.to_call_sid);
       await this.store.event(t.id,"recovery:target-left","target_left",t.to_call_sid);
      }else await this.store.event(t.id,"recovery:cancel-intent","intent_cancel",null,t.from_device_id);
     }
     await this.flow.resume(t.id);
    }
   }catch{console.warn("phone transfer recovery pending",row.id);}
  }
 }
}
