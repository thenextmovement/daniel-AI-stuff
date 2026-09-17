import twilio from "twilio";
import type {RuntimeConfig} from "./config.js";
import type {OpsClient} from "./ops-client.js";
import type {BrowserPhoneCalls} from "./phone-calls.js";
import type {RuntimePhoneTransfers} from "./phone-transfer-controller.js";
import {browserCallingReady,phoneRoom} from "./phone-calls.js";
import {phoneCaptureReady} from "./phone-capture.js";
import {PHONE_CAPTURE_PATH,phoneCaptureBinding} from "./phone-capture-protocol.js";
export type AiHandoff={
 id:string;attempt_id:string;session_id:string;staff_id:string;device_id:string;phone:string;
 customer_call_sid:string;agent_call_sid:string|null;conference_sid:string|null;capture_id:string|null;
 state:"preparing"|"ready"|"redirecting"|"connected"|"cancelled"|"failed";agent_joined:boolean;
 redirect_claimed_at:string|null;connected_at:string|null;expires_at:string;ended_at:string|null;
 cleanup_pending:boolean;cleanup_customer:boolean;updated_at:string;
};
export type AiHandoffResult={handoff:AiHandoff;redirect:boolean;join:boolean;duplicate:boolean};
type Store=Pick<OpsClient,"aiHandoffAction">;
export interface AiHandoffProvider{redirect(h:AiHandoff):Promise<void>;closeWaitingAgent(h:AiHandoff):Promise<void>;}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function aiHandoffReady(c:RuntimeConfig){
 return c.aiHandoffEnabled&&c.transport==="media_streams"&&browserCallingReady(c)&&phoneCaptureReady(c);
}
function conference(config:RuntimeConfig,h:AiHandoff,response:InstanceType<typeof twilio.twiml.VoiceResponse>,agent:boolean){
 response.dial({timeLimit:900,action:config.publicUrl+"/phone/twilio/ai-handoff/end?id="+encodeURIComponent(h.id),method:"POST"}).conference({
  participantLabel:agent?"agent":"customer",startConferenceOnEnter:true,endConferenceOnExit:true,beep:"false",
  maxParticipants:4,jitterBufferSize:"small",region:"de1",statusCallback:config.publicUrl+"/phone/twilio/ai-handoff/conference?id="+encodeURIComponent(h.id),
  statusCallbackMethod:"POST",statusCallbackEvent:["start","end","join","leave"],
 },phoneRoom(h.session_id));
 response.hangup();
}
export function aiHandoffAgentTwiml(config:RuntimeConfig,h:AiHandoff){
 const response=new twilio.twiml.VoiceResponse();conference(config,h,response,true);return response.toString();
}
export function aiHandoffCustomerTwiml(config:RuntimeConfig,h:AiHandoff){
 if(!h.capture_id||!h.conference_sid||!h.agent_joined||h.state!=="redirecting")throw Error("ai_handoff_not_ready");
 const response=new twilio.twiml.VoiceResponse(),url=new URL(PHONE_CAPTURE_PATH,config.publicUrl);url.protocol="wss:";
 const stream=response.start().stream({name:"ntcapture_"+h.capture_id,url:url.toString(),track:"both_tracks"});
 stream.parameter({name:"captureId",value:h.capture_id});
 stream.parameter({name:"binding",value:phoneCaptureBinding(h.capture_id,h.customer_call_sid,config.sipBindingSecret)});
 response.say({language:"de-DE"},"Ein Mitarbeiter ist jetzt verbunden und übernimmt unser Gespräch.");
 conference(config,h,response,false);return response.toString();
}
export class TwilioAiHandoffProvider implements AiHandoffProvider{
 private readonly client:ReturnType<typeof twilio>;
 constructor(private readonly config:RuntimeConfig,client?:ReturnType<typeof twilio>){
  this.client=client||twilio(config.twilioAccountSid,config.twilioAuthToken,{autoRetry:false,timeout:10000});
 }
 async redirect(h:AiHandoff){
  const endpoint=this.client.calls(h.customer_call_sid),call=await endpoint.fetch();
  if(call.sid!==h.customer_call_sid||call.status!=="in-progress"||call.to!==h.phone||call.from!==this.config.twilioFromNumber)
   throw Error("ai_handoff_customer_mismatch");
  // Update the existing leg exactly once; a timeout is reconciled, never redialed.
  const result=await endpoint.update({twiml:aiHandoffCustomerTwiml(this.config,h)});
  if(result.sid!==h.customer_call_sid)throw Error("ai_handoff_redirect_unconfirmed");
 }
 async closeWaitingAgent(h:AiHandoff){
  if(!h.agent_call_sid)return;
  const endpoint=this.client.calls(h.agent_call_sid);
  const terminal=new Set(["completed","failed","busy","no-answer","canceled"]);
  try{
   const call=await endpoint.fetch();if(terminal.has(call.status))return;
   try{await endpoint.update({status:["queued","ringing"].includes(call.status)?"canceled":"completed"});}
   catch(error){if(!terminal.has((await endpoint.fetch()).status))throw error;}
  }catch(error){if((error as {status?:number}).status!==404)throw error;}
 }
}
export class AiHandoffs{
 constructor(private readonly config:RuntimeConfig,private readonly store:Store,private readonly provider:AiHandoffProvider,
  private readonly calls:Pick<BrowserPhoneCalls,"event"|"closeRecorded">,
  private readonly transfers:Pick<RuntimePhoneTransfers,"conference">,
  private readonly phoneStore:Pick<OpsClient,"phoneCall"|"phoneEvent">){}
 private get(id:string){if(!UUID.test(id))throw Error("ai_handoff_id_invalid");return this.store.aiHandoffAction<{handoff:AiHandoff}>({action:"get",id});}
 private event(id:string,key:string,kind:string,extra:Record<string,unknown>={}){
  return this.store.aiHandoffAction<AiHandoffResult>({action:"event",id,key,kind,...extra});
 }
 private async cleanup(h:AiHandoff){
  if(!h.cleanup_pending||!h.ended_at)return;
  if(h.cleanup_customer){
   const {call}=await this.phoneStore.phoneCall("get",{callId:h.session_id});
   if(!call.ended_at)throw Error("ai_handoff_call_not_ended");
   await this.calls.closeRecorded(call);
  }else await this.provider.closeWaitingAgent(h);
  await this.event(h.id,"cleanup:"+h.updated_at,"cleanup",{updatedAt:h.updated_at});
 }
 async client(params:URLSearchParams){
  if(!aiHandoffReady(this.config))throw Error("ai_handoff_not_configured");
  const id=params.get("aiHandoffId")||"",from=params.get("From")||"",sid=params.get("CallSid")||"";
  if(!/^client:ntd_[a-f0-9]{32}$/.test(from)||!/^CA[a-f0-9]{32}$/i.test(sid))throw Error("invalid_phone_identity");
  const hex=from.slice(11),deviceId=hex.slice(0,8)+"-"+hex.slice(8,12)+"-"+hex.slice(12,16)+"-"+hex.slice(16,20)+"-"+hex.slice(20);
  const {handoff:before}=await this.get(id);
  if(before.device_id!==deviceId||!this.config.phoneAllowedNumbers.includes(before.phone))throw Error("ai_handoff_forbidden");
  const r=await this.event(id,"bind:"+sid,"bind",{callSid:sid,deviceId});
  if(r.join&&r.handoff.agent_call_sid===sid&&r.handoff.device_id===deviceId)return aiHandoffAgentTwiml(this.config,r.handoff);
  await this.cleanup(r.handoff);const response=new twilio.twiml.VoiceResponse();response.hangup();return response.toString();
 }
 async kick(id:string){
  const {handoff:h}=await this.get(id);
  if(h.cleanup_pending){await this.cleanup(h);return;}
  if(h.state!=="ready")return;
  if(!aiHandoffReady(this.config)||!this.config.phoneAllowedNumbers.includes(h.phone)){
   await this.cleanup((await this.event(id,"config:cancel","cancel")).handoff);return;
  }
  const r=await this.event(id,"redirect","redirect");
  if(!r.redirect){await this.cleanup(r.handoff);return;}
  try{await this.provider.redirect(r.handoff);}
  catch{/* The saved claim may have reached the provider. A signed join or expiry resolves it. */}
 }
 async conference(id:string,params:URLSearchParams){
  const {handoff:h}=await this.get(id),sid=params.get("CallSid"),room=params.get("ConferenceSid"),event=params.get("StatusCallbackEvent")||"",label=params.get("ParticipantLabel");
  if(params.get("FriendlyName")!==phoneRoom(h.session_id)||!/^CF[a-f0-9]{32}$/i.test(room||"")||
   h.conference_sid&&h.conference_sid!==room||!/^\d{1,10}$/.test(params.get("SequenceNumber")||""))throw Error("invalid_ai_handoff_conference");
  if(h.state==="connected"){
   if(!await this.transfers.conference(h.session_id,params))await this.calls.event(h.session_id,"conference",params);
   return;
  }
  let kind:string;
  if(event==="conference-end")kind="conference_end";
  else if(["participant-join","participant-leave"].includes(event)&&["agent","customer"].includes(label||""))
   kind=label+"_"+event.split("-")[1];
  else return;
  const r=await this.event(id,"conf:"+room+":"+params.get("SequenceNumber"),kind,{callSid:sid,conferenceSid:room});
  await this.cleanup(r.handoff);
  if(r.handoff.state==="ready")await this.kick(id);
 }
 async end(id:string,params:URLSearchParams){
  const {handoff:h}=await this.get(id),sid=params.get("CallSid");
  if(sid!==h.agent_call_sid&&sid!==h.customer_call_sid)throw Error("ai_handoff_leg_invalid");
  if(h.state==="connected"){
   // After a later staff transfer, the original agent is deliberately obsolete.
   const {call}=await this.phoneStore.phoneCall("get",{callId:h.session_id});
   if(sid===call.customer_call_sid||sid===call.agent_call_sid){
    const r=await this.phoneStore.phoneEvent(h.session_id,"ai-end:"+sid,sid===call.customer_call_sid?"customer_leave":"agent_leave",sid);
    if(r.close)await this.calls.closeRecorded(r.call);
   }
  }else await this.cleanup((await this.event(id,"end:"+sid,sid===h.customer_call_sid?"customer_leave":"agent_leave",{callSid:sid})).handoff);
  const response=new twilio.twiml.VoiceResponse();response.hangup();return response.toString();
 }
 async reconcile(){
  const {handoffs}=await this.store.aiHandoffAction<{handoffs:AiHandoff[]}>({action:"pending"});
  for(const h of handoffs)try{
   const r=await this.event(h.id,"expire:"+h.expires_at,"expire");
   await this.cleanup(r.handoff);
   if(r.handoff.state==="ready")await this.kick(h.id);
  }catch{console.warn("AI handoff recovery pending",h.id);}
 }
}
