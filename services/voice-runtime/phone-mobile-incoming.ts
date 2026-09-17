import twilio from "twilio";
import type {RuntimeConfig} from "./config.js";
import type {IncomingPhoneRecord} from "./phone-incoming.js";
import type {OpsClient} from "./ops-client.js";
import type {MobilePhoneCalls} from "./phone-mobile-calls.js";
import {mobileCallingReady} from "./phone-calls.js";
import {TwilioMobileProvider} from "./phone-mobile.js";
export type IncomingMobileOffer={id:string;incoming_id:string;staff_id:string;device_id:string;mobile_link_id:string;phone:string;
 state:string;provider_call_sid:string|null;claimed_at:string|null;ended_at:string|null;provider_ended_at:string|null;
 mobile_leg_id:string|null;expires_at:string;cleanup_pending:boolean;updated_at:string};
export type IncomingMobileResult={offer:IncomingMobileOffer;incoming:IncomingPhoneRecord;dial:boolean};
export interface IncomingMobileProvider{start(offer:IncomingMobileOffer):Promise<string>;close(sid:string):Promise<void>;ended(sid:string):Promise<boolean>}
type Ops=Pick<OpsClient,"incomingAction">;
const SID=/^CA[a-f0-9]{32}$/i,TERMINAL=new Set(["completed","failed","busy","no-answer","canceled"]);
export function mobileIncomingReady(config:RuntimeConfig){
 return !!(mobileCallingReady(config)&&config.inboundPhoneEnabled&&config.mobileIncomingEnabled&&config.inboundPhoneNumbers.length>0);
}
export class TwilioMobileIncomingProvider implements IncomingMobileProvider{
 private readonly client;private readonly cleanup;
 constructor(private readonly config:RuntimeConfig){
  this.client=twilio(config.twilioAccountSid,config.twilioAuthToken,{autoRetry:false,timeout:10000});
  this.cleanup=new TwilioMobileProvider(config,this.client);
 }
 async start(offer:IncomingMobileOffer){
  const base=this.config.publicUrl+"/phone/twilio/mobile-incoming";
  return (await this.client.calls.create({to:offer.phone,from:this.config.twilioFromNumber,
   url:base+"/prompt?id="+encodeURIComponent(offer.id),method:"POST",
   statusCallback:base+"/status?id="+encodeURIComponent(offer.id),statusCallbackMethod:"POST",statusCallbackEvent:["initiated","ringing","answered","completed"],
   timeout:25,timeLimit:900,record:false})).sid;
 }
 close(sid:string){return this.cleanup.close(sid);}
 ended(sid:string){return this.cleanup.ended(sid);}
}
export class IncomingMobileCalls{
 constructor(private readonly config:RuntimeConfig,private readonly ops:Ops,private readonly provider:IncomingMobileProvider,
  private readonly mobileCalls:Pick<MobilePhoneCalls,"webhook">){}
 private get(id:string){return this.ops.incomingAction<IncomingMobileResult>({action:"mobile_get",id});}
 private event(id:string,kind:string,extra:Record<string,unknown>={}){
  return this.ops.incomingAction<IncomingMobileResult>({action:"mobile_event",id,kind,...extra});
 }
 private allowed(r:IncomingMobileResult){
  return mobileIncomingReady(this.config)&&this.config.mobilePhoneNumbers.includes(r.offer.phone)&&
   this.config.phoneAllowedNumbers.includes(r.incoming.phone)&&this.config.inboundPhoneNumbers.includes(r.incoming.called_number);
 }
 private async cleanup(r:IncomingMobileResult){
  if(r.offer.mobile_leg_id||!r.offer.ended_at||!r.offer.cleanup_pending)return;
  if(r.offer.provider_call_sid){
   await this.provider.close(r.offer.provider_call_sid);
   await this.event(r.offer.id,"terminal",{callSid:r.offer.provider_call_sid});
  }else if(Date.now()>Date.parse(r.offer.expires_at)+60000){
   await this.event(r.offer.id,"cleanup",{updatedAt:r.offer.updated_at});
  }
 }
 private async start(r:IncomingMobileResult){
  if(!this.allowed(r)||r.offer.mobile_leg_id)return;
  const result=await this.event(r.offer.id,"claim");
  if(!result.dial){await this.cleanup(result);return;}
  try{
   const sid=await this.provider.start(result.offer);
   if(!SID.test(sid))throw Error("incoming_mobile_sid_invalid");
   await this.cleanup(await this.event(result.offer.id,"bind",{callSid:sid}));
  }catch{/* A possible provider dispatch is never repeated. Callbacks/recovery own resolution. */}
 }
 async sync(row:IncomingPhoneRecord){
  const {offers}=await this.ops.incomingAction<{offers:IncomingMobileOffer[]}>({
   action:"mobile_offers",incomingId:row.id,allowedPhones:mobileIncomingReady(this.config)?this.config.mobilePhoneNumbers:[],
  });
  const results=await Promise.allSettled(offers.map(async offer=>{
   let r=await this.get(offer.id);
   if(r.offer.mobile_leg_id)return;
   r=await this.event(offer.id,this.allowed(r)?"expire":"cancel");
   await this.cleanup(r);
   if(!r.offer.ended_at&&r.offer.state==="ready")await this.start(r);
  }));
  if(results.some(x=>x.status==="rejected"))console.warn("incoming mobile sync pending",row.id);
 }
 private adopted(r:IncomingMobileResult,kind:"prompt"|"confirm"|"status",params:URLSearchParams){
  const forwarded=new URLSearchParams(params);
  // Replayed prompt belongs to the already-confirmed call, not a new invitation.
  if(kind==="prompt")forwarded.set("Digits","1");
  return this.mobileCalls.webhook(r.offer.mobile_leg_id!,kind==="prompt"?"confirm":kind,forwarded);
 }
 async webhook(id:string,kind:"prompt"|"confirm"|"status",params:URLSearchParams){
  let r=await this.get(id);const sid=params.get("CallSid")||"";
  if(!SID.test(sid)||params.get("From")!==this.config.twilioFromNumber||params.get("To")!==r.offer.phone)
   throw Error("incoming_mobile_binding_invalid");
  if(r.offer.mobile_leg_id)return this.adopted(r,kind,params);
  const response=new twilio.twiml.VoiceResponse();
  if(kind==="status"){
   const status=params.get("CallStatus")||"";
   if(!["queued","initiated","ringing","answered","in-progress",...TERMINAL].includes(status))throw Error("incoming_mobile_status_invalid");
   r=await this.event(id,TERMINAL.has(status)?"terminal":"bind",{callSid:sid});
   if(r.offer.mobile_leg_id)return this.adopted(r,kind,params);
   await this.cleanup(r);return response.toString();
  }
  if(!this.allowed(r)){
   await this.event(id,"bind",{callSid:sid});await this.cleanup(await this.event(id,"cancel"));
   response.hangup();return response.toString();
  }
  r=await this.event(id,kind==="prompt"?"prompt":params.get("Digits")==="1"?"confirm":"reject",{callSid:sid});
  if(r.offer.mobile_leg_id){
   // The durable winner is already recorded; losing handset cleanup must not
   // delay its audio. Recovery also completes this work after a process exit.
   void this.sync(r.incoming).catch(()=>console.warn("incoming mobile losers pending",r.incoming.id));
   return this.adopted(r,kind,params);
  }
  if(kind==="prompt"&&!r.offer.ended_at){
   response.gather({input:["dtmf"],numDigits:1,timeout:15,actionOnEmptyResult:true,method:"POST",
    action:this.config.publicUrl+"/phone/twilio/mobile-incoming/confirm?id="+encodeURIComponent(id)})
    .say({language:"de-DE"},"NEONTRIP Telefonzentrale. Ein Anruf wartet. Drücke die Eins, um ihn anzunehmen. Andernfalls lege bitte auf.");
  }else await this.cleanup(r);
  response.hangup();return response.toString();
 }
 async reconcile(){
  const {offers}=await this.ops.incomingAction<{offers:IncomingMobileOffer[]}>({action:"mobile_recover"});
  for(const offer of offers)try{
   let r=await this.get(offer.id);if(r.offer.mobile_leg_id)continue;
   r=offer.provider_call_sid&&await this.provider.ended(offer.provider_call_sid)?
    await this.event(offer.id,"terminal",{callSid:offer.provider_call_sid}):
    await this.event(offer.id,this.allowed(r)?"expire":"cancel");
   await this.cleanup(r);
   if(!r.offer.ended_at&&r.offer.state==="ready")await this.start(r);
  }catch{console.warn("incoming mobile recovery pending",offer.id);}
 }
}
