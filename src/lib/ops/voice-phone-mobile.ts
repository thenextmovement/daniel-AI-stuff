import {supabaseRequest,supabaseRpc,SupabaseRestError} from "@/lib/quotes/supabase-rest";
import {QuoteValidationError} from "@/lib/quotes/validation";
import {requirePersonalPhone} from "./voice-phone-calls";
import {isPhoneEnabled} from "./voice-phone-identity";
import {requireVoiceUuid} from "./voice-platform-contract";
import {mobileLinkInput} from "./voice-mobile-contract";
import type {MobileAttempt,MobileResult} from "../../../services/voice-runtime/phone-mobile";
import {mobileCodeHash} from "../../../services/voice-runtime/mobile-code";
const FIELDS="id,device_id,staff_id,staff_revision,phone,state,provider_call_sid,created_at,expires_at,updated_at,ended_at,provider_ended_at,cleanup_pending,verified_at,revoked_at";
function invalid(message:string,code:string,status=409):never {throw new QuoteValidationError(message,[code],status);}
function numbers() {return (process.env.VOICE_PHONE_MOBILE_NUMBERS||"").split(",").map(x=>x.trim()).filter(x=>/^[+][1-9][0-9]{6,14}$/.test(x));}
export function mobileLinkEnabled() {return isPhoneEnabled()&&process.env.VOICE_PHONE_MOBILE_ENABLED==="true"&&numbers().length>0;}
export function publicMobileAttempt(a:MobileAttempt) {return {id:a.id,phone:a.phone,state:a.state,expiresAt:a.expires_at,endedAt:a.ended_at,cleanupPending:a.cleanup_pending};}
async function row(id:unknown) {
 const key=requireVoiceUuid(id,"Handy-Einrichtung");
 const a=(await supabaseRequest<MobileAttempt[]>("voice_mobile_links",{},{select:FIELDS,id:"eq."+key,limit:1}))[0];
 if(!a)invalid("Diese Handy-Einrichtung wurde nicht gefunden.","mobile_attempt_not_found",404);
 return a;
}
export async function readPersonalMobile(id?:string|null) {
 const current=await requirePersonalPhone();
 if(!mobileLinkEnabled()&&!id)return {enabled:false,link:null,attempt:null};
 let attempt:MobileAttempt|null=null;
 if(id){attempt=await row(id);if(attempt.device_id!==current.device.id)invalid("Diese Einrichtung gehört zu einem anderen Gerät.","mobile_attempt_forbidden",403);}
 else attempt=(await supabaseRequest<MobileAttempt[]>("voice_mobile_links",{},{select:FIELDS,device_id:"eq."+current.device.id,order:"created_at.desc",limit:1}))[0]||null;
 const linked=(await supabaseRequest<MobileAttempt[]>("voice_mobile_links",{},{select:FIELDS,staff_id:"eq."+current.staff.id,state:"eq.verified",revoked_at:"is.null",limit:1}))[0];
 let link:null|{id:string;phone:string;verifiedAt:string|null}=null;
 // A completed proof belongs to this profile revision, independently of
 // the browser used to verify it. Logging that browser out is not an unlink.
 if(linked&&linked.staff_revision===current.staff.revision)
  link={id:linked.id,phone:linked.phone,verifiedAt:linked.verified_at};
 return {enabled:mobileLinkEnabled(),link,attempt:attempt?publicMobileAttempt(attempt):null};
}
async function poke(action:"start"|"cancel",id:string) {
 const base=(process.env.VOICE_RUNTIME_BASE_URL||"").trim().replace(/\/+$/,""),token=(process.env.VOICE_DISPATCH_TOKEN||"").trim();
 if(!base||!token)return false;
 try {
  const response=await fetch(base+"/phone/mobile/"+action,{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({id}),signal:AbortSignal.timeout(20000),cache:"no-store"});
  return response.ok;
 }catch{return false;}
}
export async function changePersonalMobile(value:unknown) {
 let input:ReturnType<typeof mobileLinkInput>;
 try{input=mobileLinkInput(value);}catch{invalid("Bitte prüfe die Handynummer und starte die Einrichtung erneut.","mobile_input_invalid",422);}
 const current=await requirePersonalPhone();
 try {
  if(input.action==="start") {
   if(!mobileLinkEnabled())invalid("Die Handy-Einrichtung wird noch freigeschaltet.","mobile_not_configured",503);
   if(!input.phone||!numbers().includes(input.phone))invalid("Im Pilot kann nur eine freigegebene Handynummer bestätigt werden.","mobile_target_not_allowed",403);
   await supabaseRpc<MobileAttempt>("reserve_voice_mobile_link",{p_id:input.id,p_device_id:current.device.id,p_phone:input.phone,p_code_hash:mobileCodeHash(input.id,input.code!)});
   const dispatched=await poke("start",input.id);
   return {...await readPersonalMobile(input.id),dispatchPending:!dispatched};
  }
  if(input.action==="unlink") {
   await supabaseRpc("unlink_voice_mobile",{p_device_id:current.device.id,p_link_id:input.id});
   return readPersonalMobile();
  }
  const attempt=await row(input.id);
  if(attempt.device_id!==current.device.id)invalid("Diese Einrichtung gehört zu einem anderen Gerät.","mobile_attempt_forbidden",403);
  // Persist cancellation before contacting the runtime. Recovery sees it even
  // if the HTTP response is lost or the runtime is unavailable.
  await supabaseRpc("advance_voice_mobile_link",{p_id:input.id,p_action:"cancel"});
  await poke("cancel",input.id);
  return readPersonalMobile(input.id);
 }catch(error) {
  if(error instanceof SupabaseRestError&&[400,409].includes(error.status))invalid("Es läuft bereits eine Einrichtung oder die kurze Wartezeit zwischen Versuchen ist noch nicht vorbei.","mobile_change_rejected");
  throw error;
 }
}
export async function runtimeMobileAction(input:Record<string,unknown>) {
 if(input.action==="recover")return {attempts:await supabaseRequest<MobileAttempt[]>("voice_mobile_links",{},{select:FIELDS,or:"(ended_at.is.null,cleanup_pending.eq.true)",order:"updated_at.asc,id.asc",limit:100})};
 const attempt=await row(input.id);
 if(input.action==="get")return {attempt};
 const action=String(input.action||"");
 if(!["claim","bind","prompt","verify","terminal","cancel","expire","cleanup"].includes(action))invalid("Ungültige Handyaktion.","mobile_action_invalid",422);
 if(["claim","prompt","verify"].includes(action)&&!mobileLinkEnabled())invalid("Handy-Einrichtung ist nicht freigeschaltet.","mobile_not_configured",503);
 if(["claim","prompt","verify"].includes(action)&&!numbers().includes(attempt.phone))invalid("Handynummer ist nicht freigegeben.","mobile_target_not_allowed",403);
 if(input.callSid!=null&&(typeof input.callSid!=="string"||!/^CA[a-f0-9]{32}$/i.test(input.callSid)))invalid("Ungültige Verbindung.","mobile_leg_invalid",422);
 if(input.codeHash!=null&&(typeof input.codeHash!=="string"||!/^([a-f0-9]{64})$/.test(input.codeHash)))invalid("Ungültige Bestätigung.","mobile_code_invalid",422);
 if(input.updatedAt!=null&&(typeof input.updatedAt!=="string"||!Number.isFinite(Date.parse(input.updatedAt))))invalid("Ungültiger Stand.","mobile_version_invalid",422);
 return supabaseRpc<MobileResult>("advance_voice_mobile_link",{p_id:attempt.id,p_action:action,p_call_sid:input.callSid??null,p_code_hash:input.codeHash??null,p_updated_at:input.updatedAt??null});
}
