import {supabaseRequest,supabaseRpc,SupabaseRestError} from "@/lib/quotes/supabase-rest";
import {QuoteValidationError} from "@/lib/quotes/validation";
import {currentPhoneDevice,isPhoneEnabled} from "./voice-phone-identity";
import {requireVoiceUuid,normalizePhoneE164} from "./voice-platform-contract";
import {loadVoiceContextRecord} from "./voice-context-record";
import type {PhoneCallRecord,PhoneEventResult} from "../../../services/voice-runtime/phone-calls";

const FIELDS="id,direction,device_id,staff_id,phone,state,customer_id,request_id,agent_call_sid,customer_call_sid,conference_sid,customer_dispatch,agent_joined,customer_joined,created_at,updated_at,ended_at,cleanup_pending";
async function phoneRowRpc(name:string,args:Record<string,unknown>) {
 const row=await supabaseRequest<PhoneCallRecord>("rpc/"+name,{
  method:"POST",headers:{accept:"application/vnd.pgrst.object+json"},body:JSON.stringify(args),
 });
 if(!row || Array.isArray(row) || !row.id || !row.device_id)throw Error("phone_row_not_acknowledged");
 return row;
}
export function phoneAllowedNumbers() {
 return (process.env.VOICE_PHONE_ALLOWED_NUMBERS||"").split(",").map(x=>x.trim()).filter(x=>/^[+][1-9][0-9]{6,14}$/.test(x));
}
export function isBrowserCallingEnabled() {return isPhoneEnabled() && process.env.VOICE_BROWSER_CALLS_ENABLED==="true" && phoneAllowedNumbers().length>0;}
function invalid(message:string,code:string,status=409):never {throw new QuoteValidationError(message,[code],status);}
export async function requirePersonalPhone() {
 if(!isPhoneEnabled())invalid("Der Browser-Anschluss wird noch eingerichtet.","browser_calling_not_configured",503);
 const current=await currentPhoneDevice();
 if(!current)invalid("Bitte melde dein Telefon persönlich an.","phone_identity_required",401);
 return current;
}
function phoneNumber(value:unknown) {
 const raw=String(value||"").trim().replace(/^(?:\+|00)49\s*\(0\)/,"+49");
 return normalizePhoneE164(raw.startsWith("0")&&!raw.startsWith("00")?"+49"+raw.slice(1):raw);
}
export async function reservePhoneCall(input:Record<string,unknown>) {
 if(!isBrowserCallingEnabled())invalid("Der Browser-Anschluss wird noch eingerichtet.","browser_calling_not_configured",503);
 const current=await requirePersonalPhone();
 const requestKey=requireVoiceUuid(input.requestKey,"Anrufkennung");
 let customerId:string|null=null,requestId:string|null=null,target:string;
 if(input.customerId!=null) {
  customerId=requireVoiceUuid(input.customerId,"Kunde");
  if(input.requestId!=null) {
   if(typeof input.requestId!=="string")invalid("Der Vorgang ist ungültig.","invalid_request_id",422);
   const record=await loadVoiceContextRecord(input.requestId,customerId);
   requestId=record.requestId;target=phoneNumber(record.phone);
  } else {
   const rows=await supabaseRequest<Array<{id:string;phone:string|null}>>("master_customers",{}, {select:"id,phone",id:"eq."+customerId,limit:1});
   if(rows[0]?.id!==customerId)invalid("Der Kunde wurde nicht gefunden.","phone_customer_not_found",404);
   target=phoneNumber(rows[0].phone);
  }
 } else {
  if(input.requestId!=null)invalid("Wähle den zugehörigen Kunden aus.","phone_customer_required",422);
  target=phoneNumber(input.phone);
 }
 if(!phoneAllowedNumbers().includes(target))invalid("Im Telefon-Pilot sind nur freigegebene Testnummern erreichbar.","phone_target_not_allowed",403);
 try {
  const call=await phoneRowRpc("reserve_voice_phone_call",{
   p_device_id:current.device.id,p_staff_id:current.staff.id,p_request_key:requestKey,
   p_phone:target,p_customer_id:customerId,p_request_id:requestId,
  });
  return publicPhoneCall(call);
 } catch(error) {
  if(error instanceof SupabaseRestError && error.status===400)invalid("Es läuft bereits ein Anruf oder die Telefonzuordnung ist nicht mehr gültig.","phone_reservation_rejected");
  throw error;
 }
}
export function publicPhoneCall(call:PhoneCallRecord) {
 return {id:call.id,direction:call.direction||"outbound",state:call.state,phone:call.phone,customerId:call.customer_id||null,requestId:call.request_id||null,startedAt:call.created_at,endedAt:call.ended_at,connected:call.agent_joined && call.customer_joined && !call.ended_at,cleanupPending:call.cleanup_pending,isTest:true};
}
export async function getPersonalPhoneCall(id:unknown) {
 const current=await requirePersonalPhone();
 const call=await getRuntimePhoneCall(id);
 if(call.device_id!==current.device.id || call.staff_id!==current.staff.id)invalid("Dieser Anruf gehört zu einem anderen Telefon.","phone_call_forbidden",403);
 return {current,call};
}
export async function getRuntimePhoneCall(id:unknown) {
 const callId=requireVoiceUuid(id,"Anruf");
 const rows=await supabaseRequest<PhoneCallRecord[]>("voice_phone_calls",{}, {select:FIELDS,id:"eq."+callId,limit:1});
 if(!rows[0])invalid("Der Anruf wurde nicht gefunden.","phone_call_not_found",404);
 return rows[0];
}
export async function phoneRuntimeAction(input:Record<string,unknown>) {
 if(!isPhoneEnabled())invalid("Browser-Anschluss ist nicht freigeschaltet.","browser_calling_not_configured",503);
 const callId=requireVoiceUuid(input.callId,"Anruf");
 if(input.action==="get")return {call:await getRuntimePhoneCall(callId)};
 if(input.action==="bind") {
  const deviceId=requireVoiceUuid(input.deviceId,"Telefon");
  if(typeof input.agentCallSid!=="string" || !/^CA[a-f0-9]{32}$/i.test(input.agentCallSid))invalid("Ungültige Anrufzuordnung.","invalid_phone_leg",422);
  return {call:await phoneRowRpc("bind_voice_phone_call",{p_call_id:callId,p_device_id:deviceId,p_agent_call_sid:input.agentCallSid})};
 }
 if(input.action==="event") {
  if(typeof input.key!=="string" || input.key.length<1 || input.key.length>160 || typeof input.kind!=="string" || input.kind.length>60)invalid("Ungültige Anrufmeldung.","invalid_phone_event",422);
  return supabaseRpc<PhoneEventResult>("apply_voice_phone_event",{
   p_call_id:callId,p_key:input.key,p_kind:input.kind,p_call_sid:input.callSid??null,p_conference_sid:input.conferenceSid??null,
  });
 }
 if(input.action==="cleanup") {
  if(typeof input.updatedAt!=="string" || !Number.isFinite(Date.parse(input.updatedAt)))invalid("Ungültige Anrufmeldung.","invalid_phone_event",422);
  // Do not acknowledge a cleanup based on an older version if a late callback
  // has just revealed another provider leg that also needs closing.
  await supabaseRequest("voice_phone_calls",{method:"PATCH",body:JSON.stringify({cleanup_pending:false})},{
   id:"eq."+callId,ended_at:"not.is.null",updated_at:"eq."+input.updatedAt,
  });
  return {call:await getRuntimePhoneCall(callId)};
 }
 invalid("Unbekannte Telefonaktion.","invalid_phone_action",422);
}
export async function phoneCallsToRecover() {
 return supabaseRequest<PhoneCallRecord[]>("voice_phone_calls",{},{
  select:FIELDS,or:"(ended_at.is.null,cleanup_pending.eq.true)",order:"updated_at.asc,id.asc",limit:50,
 });
}
