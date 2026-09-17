import twilio from "twilio";
import {mobileIncomingReady} from "./phone-mobile-incoming.js";
import type {RuntimeConfig} from "./config.js";
import type {OpsClient} from "./ops-client.js";
import type {BrowserPhoneCalls,PhoneCallRecord} from "./phone-calls.js";
import {phoneRoom,browserCallingReady} from "./phone-calls.js";
import type {RuntimePhoneTransfers} from "./phone-transfer-controller.js";
export type IncomingPhoneRecord={id:string;customer_call_sid:string;phone:string;called_number:string;customer_id:string|null;request_id:string|null;display_name:string|null;
 state:"waiting"|"claimed"|"connected"|"missed"|"ended";device_id:string|null;staff_id:string|null;conference_sid:string|null;customer_joined:boolean;
 created_at:string;expires_at:string;ended_at:string|null;cleanup_pending:boolean;updated_at:string};
export type IncomingEvent={incoming:IncomingPhoneRecord;call?:PhoneCallRecord;close?:boolean;closeCall?:boolean};
type IncomingOps=Pick<OpsClient,"incomingAction">;
type Calls=Pick<BrowserPhoneCalls,"event"|"closeRecorded">;
type Transfers=Pick<RuntimePhoneTransfers,"conference">;
export function inboundPhoneReady(config:RuntimeConfig){
 return (browserCallingReady(config)||mobileIncomingReady(config))&&config.inboundPhoneEnabled&&config.inboundPhoneNumbers.length>0;
}
export function incomingCustomerTwiml(config:RuntimeConfig,row:IncomingPhoneRecord){
 const response=new twilio.twiml.VoiceResponse();
 if(row.ended_at){response.hangup();return response.toString();}
 response.say({language:"de-DE"},"NEONTRIP. Wir verbinden Sie mit unserem Team. Einen Moment bitte.");
 response.dial({timeLimit:900,action:config.publicUrl+"/phone/twilio/incoming/end?id="+encodeURIComponent(row.id),method:"POST"}).conference({
  participantLabel:"customer",startConferenceOnEnter:false,endConferenceOnExit:true,beep:"false",maxParticipants:4,jitterBufferSize:"small",region:"de1",
  statusCallback:config.publicUrl+"/phone/twilio/incoming/conference?id="+encodeURIComponent(row.id),statusCallbackMethod:"POST",statusCallbackEvent:["start","end","join","leave"],
 },phoneRoom(row.id));
 response.hangup();return response.toString();
}
export class IncomingPhoneCalls{
 private readonly client:ReturnType<typeof twilio>;
 constructor(private config:RuntimeConfig,private ops:IncomingOps,private calls:Calls,private transfers:Transfers,
  private stopPending?:(row:IncomingPhoneRecord)=>Promise<void>,private syncMobile?:(row:IncomingPhoneRecord)=>Promise<void>){
  this.client=twilio(config.twilioAccountSid,config.twilioAuthToken,{autoRetry:false,timeout:10000});
 }
 async receive(params:URLSearchParams){
  const from=params.get("From")||"",to=params.get("To")||"",sid=params.get("CallSid")||"";
  if(!inboundPhoneReady(this.config)||params.get("Direction")!=="inbound"||!/^CA[a-f0-9]{32}$/i.test(sid)||
   !this.config.inboundPhoneNumbers.includes(to)||!this.config.phoneAllowedNumbers.includes(from)){
   const reject=new twilio.twiml.VoiceResponse();reject.reject({reason:"rejected"});return reject.toString();
  }
  const {incoming}=await this.ops.incomingAction<{incoming:IncomingPhoneRecord}>({action:"receive",phone:from,calledNumber:to,callSid:sid});
  if(incoming.customer_call_sid!==sid||incoming.phone!==from||incoming.called_number!==to)throw Error("incoming_binding_unconfirmed");
  return incomingCustomerTwiml(this.config,incoming);
 }
 private async effect(result:IncomingEvent){
  if(this.syncMobile)try{await this.syncMobile(result.incoming);}catch{console.warn("incoming mobile sync pending",result.incoming.id);}
  if(result.closeCall&&result.call)await this.calls.closeRecorded(result.call);
  if(result.close){
   const row=result.incoming;
   if(this.stopPending)await this.stopPending(row);
   else{
    const endpoint=this.client.calls(row.customer_call_sid),call=await endpoint.fetch();
    if(!["completed","failed","busy","no-answer","canceled"].includes(call.status)){
     try{await endpoint.update({status:"completed"});}
     catch(error){if(!["completed","failed","busy","no-answer","canceled"].includes((await endpoint.fetch()).status))throw error;}
    }
   }
   await this.ops.incomingAction({action:"cleanup",incomingId:row.id,updatedAt:row.updated_at});
  }
 }
 async conference(id:string,params:URLSearchParams){
  const {incoming:row}=await this.ops.incomingAction<{incoming:IncomingPhoneRecord}>({action:"get",incomingId:id});
  const room=params.get("ConferenceSid"),event=params.get("StatusCallbackEvent")||"",label=params.get("ParticipantLabel"),sid=params.get("CallSid");
  if(params.get("FriendlyName")!==phoneRoom(row.id)||!/^CF[a-f0-9]{32}$/i.test(room||"")||
   (row.conference_sid&&row.conference_sid!==room)||!/^\d{1,10}$/.test(params.get("SequenceNumber")||""))throw Error("invalid_incoming_conference");
  const key="conf:"+room+":"+params.get("SequenceNumber");
  if(["participant-join","participant-leave"].includes(event)&&label==="customer"){
   if(sid!==row.customer_call_sid)throw Error("incoming_call_mismatch");
   await this.effect(await this.ops.incomingAction<IncomingEvent>({action:"event",incomingId:id,key,kind:"customer_"+event.split("-")[1],callSid:sid,conferenceSid:room}));
  }else if(event==="conference-start"||event==="conference-end"){
   await this.effect(await this.ops.incomingAction<IncomingEvent>({action:"event",incomingId:id,key,kind:event.replace("-","_"),conferenceSid:room}));
  }else if(row.device_id){
   if(!await this.transfers.conference(id,params))await this.calls.event(id,"conference",params);
   await this.effect(await this.ops.incomingAction<IncomingEvent>({action:"event",incomingId:id,key:"sync:"+key,kind:"sync"}));
  }
 }
 async end(id:string,params:URLSearchParams){
  const {incoming:row}=await this.ops.incomingAction<{incoming:IncomingPhoneRecord}>({action:"get",incomingId:id});
  if(params.get("CallSid")!==row.customer_call_sid)throw Error("incoming_call_mismatch");
  await this.effect(await this.ops.incomingAction<IncomingEvent>({action:"event",incomingId:id,key:"dial:end",kind:"dial_end",callSid:row.customer_call_sid}));
  const response=new twilio.twiml.VoiceResponse();response.hangup();return response.toString();
 }
 async reconcile(){
  const {incoming}=await this.ops.incomingAction<{incoming:IncomingPhoneRecord[]}>({action:"pending"});
  for(const row of incoming)try{
   if(row.cleanup_pending){await this.effect({incoming:row,close:true});continue;}
   const expired=["waiting","claimed"].includes(row.state)&&Date.parse(row.expires_at)<=Date.now();
   await this.effect(await this.ops.incomingAction<IncomingEvent>({action:"event",incomingId:row.id,key:expired?"expire:"+row.expires_at:"sync:"+row.updated_at,kind:expired?"expire":"sync"}));
  }catch{console.warn("incoming phone recovery pending",row.id);}
 }
}
