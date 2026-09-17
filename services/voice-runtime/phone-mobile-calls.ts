import twilio from "twilio";
import type {RuntimeConfig} from "./config.js";
import {phoneAgentTwiml,mobileCallingReady,type PhoneCallRecord} from "./phone-calls.js";
import {TwilioMobileProvider} from "./phone-mobile.js";
export type MobileCallLeg={id:string;call_id:string;staff_id:string;device_id:string;mobile_link_id:string;phone:string;state:string;provider_call_sid:string|null;claimed_at:string|null;confirmed_at:string|null;expires_at:string;ended_at:string|null;provider_ended_at:string|null;cleanup_pending:boolean;updated_at:string};
export type MobileCallResult={leg:MobileCallLeg;call:PhoneCallRecord;dial:boolean;join:boolean;closeCall:boolean};
export interface MobileCallOps{mobileCallAction<T=unknown>(input:Record<string,unknown>):Promise<T>}
export interface MobileCallProvider{start(leg:MobileCallLeg):Promise<string>;close(sid:string):Promise<void>;ended(sid:string):Promise<boolean>}
const SID=/^CA[a-f0-9]{32}$/i,TERMINAL=new Set(["completed","failed","busy","no-answer","canceled"]);
export class TwilioMobileCallProvider implements MobileCallProvider {
 private readonly client;private readonly cleanup;
 constructor(private readonly config:RuntimeConfig,client?:ReturnType<typeof twilio>){
  this.client=client||twilio(config.twilioAccountSid,config.twilioAuthToken,{autoRetry:false,timeout:15000});
  this.cleanup=new TwilioMobileProvider(config,this.client);
 }
 async start(leg:MobileCallLeg){
  const base=this.config.publicUrl+"/phone/twilio/mobile-call";
  return (await this.client.calls.create({to:leg.phone,from:this.config.twilioFromNumber,
   url:base+"/prompt?id="+encodeURIComponent(leg.id),method:"POST",
   statusCallback:base+"/status?id="+encodeURIComponent(leg.id),statusCallbackMethod:"POST",statusCallbackEvent:["initiated","ringing","answered","completed"],
   timeout:25,timeLimit:900,record:false})).sid;
 }
 close(sid:string){return this.cleanup.close(sid);}
 ended(sid:string){return this.cleanup.ended(sid);}
}
export class MobilePhoneCalls{
 constructor(private readonly config:RuntimeConfig,private readonly ops:MobileCallOps,private readonly provider:MobileCallProvider,private readonly closeCall:(call:PhoneCallRecord)=>Promise<void>){}
 private get(id:string){return this.ops.mobileCallAction<MobileCallResult>({action:"get",id});}
 private event(id:string,kind:string,extra:Record<string,unknown>={}){return this.ops.mobileCallAction<MobileCallResult>({action:"event",id,kind,...extra});}
 private allowed(r:MobileCallResult){return mobileCallingReady(this.config)&&this.config.mobilePhoneNumbers.includes(r.leg.phone)&&this.config.phoneAllowedNumbers.includes(r.call.phone);}
 private async cleanup(result:MobileCallResult){
  let r=result;
  if(r.leg.ended_at&&r.leg.cleanup_pending){
   if(r.leg.provider_call_sid){
    await this.provider.close(r.leg.provider_call_sid);
    r=await this.event(r.leg.id,"terminal",{callSid:r.leg.provider_call_sid});
   }else if(Date.now()>Date.parse(r.leg.expires_at)+60000){
    r=await this.event(r.leg.id,"cleanup",{updatedAt:r.leg.updated_at});
   }
  }
  if(r.closeCall)await this.closeCall(r.call);
 }
 async start(id:string){
  const before=await this.get(id);if(!this.allowed(before))throw Error("mobile_call_not_configured");
  const result=await this.event(id,"claim");if(!result.dial){await this.cleanup(result);return;}
  try{
   const sid=await this.provider.start(result.leg);if(!SID.test(sid))throw Error("invalid_mobile_leg");
   await this.cleanup(await this.event(id,"bind",{callSid:sid}));
  }catch{/* An ambiguous provider result is never redialed. Signed callbacks and recovery resolve it. */}
 }
 async webhook(id:string,kind:"prompt"|"confirm"|"status",params:URLSearchParams){
  const before=await this.get(id),sid=params.get("CallSid")||"";
  if(!SID.test(sid)||params.get("From")!==this.config.twilioFromNumber||params.get("To")!==before.leg.phone)throw Error("mobile_call_binding_invalid");
  const response=new twilio.twiml.VoiceResponse();
  if(kind==="status"){
   const status=params.get("CallStatus")||"";
   if(!["queued","initiated","ringing","answered","in-progress",...TERMINAL].includes(status))throw Error("mobile_call_status_invalid");
   await this.cleanup(await this.event(id,TERMINAL.has(status)?"terminal":"bind",{callSid:sid}));
   return response.toString();
  }
  if(!this.allowed(before)){
   await this.event(id,"bind",{callSid:sid});
   await this.cleanup(await this.event(id,"cancel"));
   response.hangup();return response.toString();
  }
  if(kind==="prompt"){
   const result=await this.event(id,"prompt",{callSid:sid});
   if(result.leg.ended_at||result.call.ended_at){await this.cleanup(result);response.hangup();return response.toString();}
   response.gather({input:["dtmf"],numDigits:1,timeout:15,actionOnEmptyResult:true,method:"POST",
    action:this.config.publicUrl+"/phone/twilio/mobile-call/confirm?id="+encodeURIComponent(id)})
    .say({language:"de-DE"},"NEONTRIP Telefonzentrale. Drücke die Eins, um deinen angeforderten Anruf zu verbinden. Falls du keinen Anruf gestartet hast, lege bitte auf.");
   response.hangup();return response.toString();
  }
  const result=await this.event(id,params.get("Digits")==="1"?"confirm":"reject",{callSid:sid});
  if(result.join&&result.call.agent_call_sid===sid&&result.call.mobile_leg_id===id)return phoneAgentTwiml(this.config,result.call);
  await this.cleanup(result);response.hangup();return response.toString();
 }
 async reconcile(){
  const {legs}=await this.ops.mobileCallAction<{legs:MobileCallLeg[]}>({action:"recover"});
  for(const leg of legs){
   try{
    let result=await this.get(leg.id);
    if(leg.provider_call_sid&&await this.provider.ended(leg.provider_call_sid))result=await this.event(leg.id,"terminal",{callSid:leg.provider_call_sid});
    else result=await this.event(leg.id,this.allowed(result)?"expire":"cancel");
    await this.cleanup(result);
    if(!result.leg.ended_at&&result.leg.state==="ready")await this.start(leg.id);
   }catch{console.warn("mobile call recovery pending",leg.id);}
  }
 }
}
