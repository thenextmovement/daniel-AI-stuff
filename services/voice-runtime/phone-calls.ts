import twilio from "twilio";
import type {RuntimeConfig} from "./config.js";
import {browserPhoneReady} from "./phone-token.js";
import {verifyTwilioSignature} from "./security.js";

export type PhoneCallRecord = {
 id:string;device_id:string;staff_id:string;phone:string;state:string;
 agent_call_sid:string|null;customer_call_sid:string|null;conference_sid:string|null;
 customer_dispatch:string;agent_joined:boolean;customer_joined:boolean;
 created_at:string;updated_at:string;ended_at:string|null;cleanup_pending:boolean;
};
export type PhoneEventResult={call:PhoneCallRecord;dial:boolean;close:boolean;duplicate:boolean};
export interface PhoneCallOps {
 phoneCall(action:string,input:Record<string,unknown>):Promise<{call:PhoneCallRecord}>;
 phoneEvent(callId:string,key:string,kind:string,callSid?:string|null,conferenceSid?:string|null):Promise<PhoneEventResult>;
 getPhoneDevice(deviceId:string,staffId:string):Promise<{deviceId:string;staffId:string;expiresAt:string}>;
 phoneRecover():Promise<PhoneCallRecord[]>;
}
export interface PhoneCallProvider {
 startCustomer(call:PhoneCallRecord,callbackUrl:string):Promise<string>;
 close(call:PhoneCallRecord):Promise<void>;
 ended(call:PhoneCallRecord):Promise<boolean>;
}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SID=/^CA[a-f0-9]{32}$/i;
const TERMINAL=new Set(["completed","failed","busy","no-answer","canceled"]);
export function phoneRoom(id:string) {if(!UUID.test(id))throw Error("invalid_phone_call");return "ntp_"+id;}
export function browserPhoneControlReady(config:RuntimeConfig) {
 return config.teamPhoneEnabled && /^AC[a-f0-9]{32}$/i.test(config.twilioAccountSid) && !!config.twilioAuthToken;
}
export function browserCallingReady(config:RuntimeConfig) {
 return browserPhoneReady(config) && config.browserCallsEnabled && !!config.twilioAuthToken &&
  /^[+][1-9][0-9]{6,14}$/.test(config.twilioFromNumber) && config.phoneAllowedNumbers.length>0;
}
export function phoneWebhookParameters(config:RuntimeConfig,url:URL,signature:string|undefined,body:string) {
 const params=new URLSearchParams(body);
 // Twilio's form fields are scalar. Ambiguous duplicate parameters are rejected.
 if([...params.keys()].some(key=>params.getAll(key).length!==1) ||
  !verifyTwilioSignature({signature,url:url.toString(),params,authToken:config.twilioAuthToken}) ||
  params.get("AccountSid")!==config.twilioAccountSid)throw Error("invalid_phone_signature");
 return params;
}
export function phoneAgentTwiml(config:RuntimeConfig,call:PhoneCallRecord) {
 const response=new twilio.twiml.VoiceResponse();
 response.dial({timeLimit:900}).conference({
  participantLabel:"agent",startConferenceOnEnter:true,endConferenceOnExit:true,
  beep:"false",maxParticipants:4,jitterBufferSize:"small",region:"de1",
  statusCallback:config.publicUrl+"/phone/twilio/conference?id="+encodeURIComponent(call.id),
  statusCallbackMethod:"POST",statusCallbackEvent:["start","end","join","leave"],
 },phoneRoom(call.id));
 response.hangup();
 return response.toString();
}
export class TwilioPhoneProvider implements PhoneCallProvider {
 private readonly client;
 constructor(private readonly config:RuntimeConfig,client?:ReturnType<typeof twilio>) {
  this.client=client||twilio(config.twilioAccountSid,config.twilioAuthToken,{autoRetry:false,timeout:15000});
 }
 async startCustomer(call:PhoneCallRecord,callbackUrl:string) {
  if(!call.conference_sid)throw Error("phone_conference_required");
  const result=await this.client.conferences(call.conference_sid).participants.create({
   from:this.config.twilioFromNumber,to:call.phone,label:"customer",
   startConferenceOnEnter:true,endConferenceOnExit:true,beep:"false",
   earlyMedia:true,timeout:30,timeLimit:900,
   statusCallback:callbackUrl,statusCallbackMethod:"POST",statusCallbackEvent:["initiated","ringing","answered","completed"],
  });
  return result.callSid;
 }
 async close(call:PhoneCallRecord) {
  // A conference can end while a participant is still ringing. Stop both legs too.
  const operations:Array<Promise<unknown>>=[];
  const closeConference=async()=>{
   if(!call.conference_sid)return;
   const conference=this.client.conferences(call.conference_sid);
   try {
    if((await conference.fetch()).status==="completed")return;
    try{await conference.update({status:"completed"});}
    catch(error){if((await conference.fetch()).status!=="completed")throw error;}
   }catch(error){if((error as {status?:number}).status!==404)throw error;}
  };
  operations.push(closeConference());
  for(const sid of [call.agent_call_sid,call.customer_call_sid]) if(sid)operations.push((async()=>{
   const endpoint=this.client.calls(sid);
   try {
    const leg=await endpoint.fetch();
    if(TERMINAL.has(leg.status))return;
    try{await endpoint.update({status:["queued","ringing"].includes(leg.status)?"canceled":"completed"});}
    catch(error){if(!TERMINAL.has((await endpoint.fetch()).status))throw error;}
   }catch(error){if((error as {status?:number}).status!==404)throw error;}
  })());
  const results=await Promise.allSettled(operations);
  if(results.some(r=>r.status==="rejected"))throw Error("phone_cleanup_pending");
 }
 async ended(call:PhoneCallRecord) {
  if(!call.agent_call_sid)return false;
  const agent=await this.client.calls(call.agent_call_sid).fetch();
  if(TERMINAL.has(agent.status))return true;
  if(call.customer_call_sid && TERMINAL.has((await this.client.calls(call.customer_call_sid).fetch()).status))return true;
  return false;
 }
}
export class BrowserPhoneCalls {
 constructor(private readonly config:RuntimeConfig,private readonly ops:PhoneCallOps,private readonly provider:PhoneCallProvider) {}
 private requireReady() {if(!browserCallingReady(this.config))throw Error("browser_calling_not_configured");}
 private async close(call:PhoneCallRecord) {
  await this.provider.close(call);
  await this.ops.phoneCall("cleanup",{callId:call.id,updatedAt:call.updated_at});
 }
 async client(params:URLSearchParams) {
  this.requireReady();
  const id=params.get("callId")||"",from=params.get("From")||"",sid=params.get("CallSid")||"";
  if(!UUID.test(id) || !/^client:ntd_[a-f0-9]{32}$/.test(from) || !SID.test(sid))throw Error("invalid_phone_identity");
  const hex=from.slice("client:ntd_".length),deviceId=hex.slice(0,8)+"-"+hex.slice(8,12)+"-"+hex.slice(12,16)+"-"+hex.slice(16,20)+"-"+hex.slice(20);
  const {call}=await this.ops.phoneCall("bind",{callId:id,deviceId,agentCallSid:sid});
  if(call.id!==id || call.device_id!==deviceId || call.agent_call_sid!==sid || call.ended_at ||
   !this.config.phoneAllowedNumbers.includes(call.phone))throw Error("phone_call_forbidden");
  return phoneAgentTwiml(this.config,call);
 }
 async event(id:string,source:"conference"|"customer",params:URLSearchParams) {
  if(!UUID.test(id))throw Error("invalid_phone_call");
  const {call}=await this.ops.phoneCall("get",{callId:id});
  const sid=params.get("CallSid"),conference=params.get("ConferenceSid");
  let kind:string,key:string;
  if(source==="conference") {
   if(params.get("FriendlyName")!==phoneRoom(id) || !/^CF[a-f0-9]{32}$/i.test(conference||"") ||
    !/^[0-9]{1,10}$/.test(params.get("SequenceNumber")||""))throw Error("invalid_phone_conference");
   const event=params.get("StatusCallbackEvent")||"",label=params.get("ParticipantLabel");
   if(event==="conference-start"||event==="conference-end")kind=event.replace("-","_");
   else if(["participant-join","participant-leave"].includes(event) && ["agent","customer"].includes(label||""))
    kind=label+"_"+event.split("-")[1];
   else return;
   key="conf:"+conference+":"+params.get("SequenceNumber");
  } else {
   const status=params.get("CallStatus")||"";
   if(!["queued","initiated","ringing","answered","in-progress","completed","busy","no-answer","failed","canceled"].includes(status) ||
    (params.has("To") && params.get("To")!==call.phone) || !SID.test(sid||""))throw Error("invalid_phone_customer");
   kind="customer_"+(status==="in-progress"?"answered":status==="queued"?"initiated":status);key="leg:"+sid+":"+kind;
  }
  const result=await this.ops.phoneEvent(id,key,kind,sid,source==="conference"?conference:null);
  if(result.close){await this.close(result.call);return;}
  if(!result.dial)return;
  // Atomic claim was persisted before the provider write. Never retry creation
  // after an ambiguous response; a later callback/reconciler resolves it.
  let attempted=false;
  try {
   this.requireReady();
   const fresh=(await this.ops.phoneCall("get",{callId:id})).call;
   if(fresh.ended_at){await this.close(fresh);return;}
   await this.ops.getPhoneDevice(fresh.device_id,fresh.staff_id);
   if(!this.config.phoneAllowedNumbers.includes(fresh.phone))throw Error("phone_target_not_allowed");
   attempted=true;
   const customerSid=await this.provider.startCustomer(fresh,this.config.publicUrl+"/phone/twilio/customer?id="+encodeURIComponent(id));
   if(!SID.test(customerSid))throw Error("invalid_customer_leg");
   const saved=await this.ops.phoneEvent(id,"dispatch:ack","dispatch_ack",customerSid);
   if(saved.close)await this.close(saved.call);
  } catch {
   const uncertain=await this.ops.phoneEvent(id,attempted?"dispatch:uncertain":"dispatch:ineligible",attempted?"dispatch_uncertain":"cancel");
   if(uncertain.close)await this.close(uncertain.call);
  }
 }
 async cancel(id:string,deviceId:string,staffId:string) {
  const {call}=await this.ops.phoneCall("get",{callId:id});
  if(call.device_id!==deviceId || call.staff_id!==staffId)throw Error("phone_call_forbidden");
  const result=await this.ops.phoneEvent(id,"operator:cancel","cancel");
  await this.close(result.call);
 }
 async reconcile() {
  if(!browserPhoneControlReady(this.config))return;
  const calls=await this.ops.phoneRecover();
  for(const call of calls) {
   try {
    if(call.ended_at){if(call.cleanup_pending)await this.close(call);continue;}
    // Reservations have no provider side effect. All other abandoned setup
    // states close after 60s; an uncertain dispatch never triggers a second dial.
    const abandoned=!call.customer_joined && Date.now()-Date.parse(call.created_at)>60000;
    const ended=await this.provider.ended(call);
    let revoked=false;
    try{await this.ops.getPhoneDevice(call.device_id,call.staff_id);}catch(error){
     if([401,403,404].includes((error as {status?:number}).status||0))revoked=true;else throw error;
    }
    if(abandoned || ended || revoked || !this.config.browserCallsEnabled) {
     const result=await this.ops.phoneEvent(call.id,ended?"reconcile:ended":"reconcile:cancel",ended?"conference_end":"cancel");
     await this.close(result.call);
    }
   } catch {console.warn("browser phone reconciliation pending",call.id);}
  }
 }
}
