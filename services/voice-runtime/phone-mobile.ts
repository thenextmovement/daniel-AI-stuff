import {mobileCodeHash} from "./mobile-code.js";
export {mobileCodeHash} from "./mobile-code.js";
import twilio from "twilio";
import type {RuntimeConfig} from "./config.js";
import {browserPhoneControlReady} from "./phone-calls.js";

export type MobileAttempt={id:string;device_id:string;staff_id:string;staff_revision:number;phone:string;state:string;provider_call_sid:string|null;created_at:string;expires_at:string;updated_at:string;ended_at:string|null;provider_ended_at:string|null;cleanup_pending:boolean;verified_at:string|null;revoked_at:string|null};
export type MobileResult={attempt:MobileAttempt;claimed:boolean;accepted:boolean};
export interface MobileOps {mobileAction<T=unknown>(input:Record<string,unknown>):Promise<T>}
export interface MobileProvider {start(attempt:MobileAttempt):Promise<string>;close(sid:string):Promise<void>;ended(sid:string):Promise<boolean>}
const SID=/^CA[a-f0-9]{32}$/i;
export function mobilePhoneReady(config:RuntimeConfig) {
 return browserPhoneControlReady(config)&&config.mobilePhoneEnabled&&config.mobilePhoneNumbers.length>0&&/^[+][1-9][0-9]{6,14}$/.test(config.twilioFromNumber);
}
const terminal=new Set(["completed","failed","busy","no-answer","canceled"]);
export class TwilioMobileProvider implements MobileProvider {
 private readonly client;
 constructor(private readonly config:RuntimeConfig,client?:ReturnType<typeof twilio>) {this.client=client||twilio(config.twilioAccountSid,config.twilioAuthToken,{autoRetry:false,timeout:15000});}
 async start(a:MobileAttempt) {
  const base=this.config.publicUrl+"/phone/twilio/mobile";
  const call=await this.client.calls.create({to:a.phone,from:this.config.twilioFromNumber,
   url:base+"/prompt?id="+encodeURIComponent(a.id),method:"POST",
   statusCallback:base+"/status?id="+encodeURIComponent(a.id),statusCallbackMethod:"POST",statusCallbackEvent:["initiated","ringing","answered","completed"],
   timeout:25,timeLimit:60,record:false});
  return call.sid;
 }
 async ended(sid:string) {try{return terminal.has((await this.client.calls(sid).fetch()).status);}catch(e){if((e as {status?:number}).status===404)return true;throw e;}}
 async close(sid:string) {
  if(!SID.test(sid))throw Error("invalid_mobile_leg");
  try {
   const endpoint=this.client.calls(sid),call=await endpoint.fetch();if(terminal.has(call.status))return;
   try{await endpoint.update({status:["queued","ringing"].includes(call.status)?"canceled":"completed"});}
   catch(error){if(!await this.ended(sid))throw error;}
   if(!await this.ended(sid))throw Error("mobile_cleanup_pending");
  }catch(error){if((error as {status?:number}).status!==404)throw error;}
 }
}
export class MobilePhoneLinks {
 constructor(private readonly config:RuntimeConfig,private readonly ops:MobileOps,private readonly provider:MobileProvider) {}
 private event(id:string,action:string,extra:Record<string,unknown>={}) {return this.ops.mobileAction<MobileResult>({action,id,...extra});}
 async start(id:string) {
  if(!mobilePhoneReady(this.config))throw Error("mobile_phone_not_configured");
  const {attempt:before}=await this.ops.mobileAction<{attempt:MobileAttempt}>({action:"get",id});
  if(!this.config.mobilePhoneNumbers.includes(before.phone))throw Error("mobile_target_not_allowed");
  const {attempt,claimed}=await this.event(id,"claim");if(!claimed)return;
  // The database claim is permanent. A timeout must never create a second call.
  try {
   const sid=await this.provider.start(attempt);if(!SID.test(sid))throw Error("invalid_mobile_leg");
   const result=await this.event(id,"bind",{callSid:sid});
   if(result.attempt.ended_at)await this.cleanup(result.attempt);
  }catch { /* Recovery and signed callbacks resolve uncertain dispatches. */ }
 }
 private async cleanup(a:MobileAttempt) {
  if(!a.ended_at||!a.cleanup_pending)return;
  if(a.provider_call_sid) {
   await this.provider.close(a.provider_call_sid);
   await this.event(a.id,"terminal",{callSid:a.provider_call_sid});
  }else if(Date.now()>Date.parse(a.expires_at)+60000) {
   await this.event(a.id,"cleanup",{updatedAt:a.updated_at});
  }
 }
 async webhook(id:string,kind:"prompt"|"verify"|"status",params:URLSearchParams) {
  const {attempt:a}=await this.ops.mobileAction<{attempt:MobileAttempt}>({action:"get",id});
  const sid=params.get("CallSid")||"";
  if(!SID.test(sid)||params.get("To")!==a.phone||params.get("From")!==this.config.twilioFromNumber)throw Error("mobile_leg_conflict");
  const response=new twilio.twiml.VoiceResponse();
  if(kind==="status") {
   const status=params.get("CallStatus")||"";
   if(!["initiated","queued","ringing","answered","in-progress",...terminal].includes(status))throw Error("mobile_status_invalid");
   const result=await this.event(id,terminal.has(status)?"terminal":"bind",{callSid:sid});
   if(result.attempt.ended_at)await this.cleanup(result.attempt);
   return response.toString();
  }
  if(!mobilePhoneReady(this.config)||!this.config.mobilePhoneNumbers.includes(a.phone)) {
   const result=await this.event(id,"cancel");
   await this.event(id,"bind",{callSid:sid});await this.cleanup({...result.attempt,provider_call_sid:sid});
   response.hangup();return response.toString();
  }
  if(kind==="prompt") {
   const result=await this.event(id,"prompt",{callSid:sid});
   if(result.attempt.ended_at){response.hangup();return response.toString();}
   response.gather({input:["dtmf"],numDigits:6,timeout:20,actionOnEmptyResult:true,
    action:this.config.publicUrl+"/phone/twilio/mobile/verify?id="+encodeURIComponent(id),method:"POST"})
    .say({language:"de-DE"},"Hier ist NEONTRIP. Gib den sechsstelligen Code aus deinem persönlich angemeldeten Telefonprofil ein. Falls du diese Einrichtung nicht gestartet hast, lege bitte auf.");
   response.hangup();
  }else {
   const digits=params.get("Digits")||"";
   const result=await this.event(id,"verify",{callSid:sid,codeHash:mobileCodeHash(id,/^[0-9]{6}$/.test(digits)?digits:"invalid")});
   response.say({language:"de-DE"},result.accepted?"Dein Handy ist bestätigt. Du kannst jetzt auflegen.":"Die Bestätigung war nicht erfolgreich. Bitte starte die Einrichtung erneut in deinem Telefonprofil.");
   response.hangup();
  }
  return response.toString();
 }
 async cancel(id:string) {const result=await this.event(id,"cancel");await this.cleanup(result.attempt);}
 async reconcile() {
  const {attempts}=await this.ops.mobileAction<{attempts:MobileAttempt[]}>({action:"recover"});
  for(const a of attempts) {
   try{
    if(a.ended_at){await this.cleanup(a);continue;}
    if(a.provider_call_sid&&await this.provider.ended(a.provider_call_sid)){await this.event(a.id,"terminal",{callSid:a.provider_call_sid});continue;}
    const result=await this.event(a.id,mobilePhoneReady(this.config)&&this.config.mobilePhoneNumbers.includes(a.phone)?"expire":"cancel");
    if(result.attempt.ended_at)await this.cleanup(result.attempt);
    else if(result.attempt.state==="reserved")await this.start(a.id);
   }catch{console.warn("mobile verification recovery pending",a.id);}
  }
 }
}
