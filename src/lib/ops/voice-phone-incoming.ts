import {supabaseRequest,supabaseRpc} from "@/lib/quotes/supabase-rest";
import {QuoteValidationError} from "@/lib/quotes/validation";
import {requireVoiceUuid,normalizePhoneE164} from "./voice-platform-contract";
import {requirePersonalPhone,phoneAllowedNumbers,publicPhoneCall} from "./voice-phone-calls";
import {isPhoneEnabled} from "./voice-phone-identity";
import {listVoiceDirectory,directoryPhoneDigits,type VoiceDirectoryContact} from "./voice-directory";
import type {IncomingPhoneRecord,IncomingEvent} from "../../../services/voice-runtime/phone-incoming";
import type {PhoneCallRecord} from "../../../services/voice-runtime/phone-calls";
const FIELDS="id,customer_call_sid,phone,called_number,customer_id,request_id,display_name,state,device_id,staff_id,conference_sid,customer_joined,created_at,expires_at,ended_at,cleanup_pending,updated_at";
export function incomingPhoneEnabled(){return isPhoneEnabled()&&process.env.VOICE_PHONE_INBOUND_ENABLED==="true";}
const targets=()=>String(process.env.VOICE_PHONE_INBOUND_NUMBERS||"").split(",").map(x=>x.trim()).filter(x=>/^[+][1-9][0-9]{6,14}$/.test(x));
function invalid(code:string,status=422):never{throw new QuoteValidationError("Der eingehende Anruf konnte nicht verarbeitet werden.",[code],status);}
export function exactIncomingCustomer(phone:string,results:VoiceDirectoryContact[],nextOffset:number|null){
 const exact=results.filter(x=>x.phone&&directoryPhoneDigits(x.phone)===directoryPhoneDigits(phone));
 return nextOffset===null&&exact.length===1?exact[0]:null;
}
export async function getIncomingPhone(id:unknown){
 const rows=await supabaseRequest<IncomingPhoneRecord[]>("voice_phone_incoming",{},{select:FIELDS,id:"eq."+requireVoiceUuid(id,"Eingehender Anruf"),limit:1});
 if(!rows[0])invalid("incoming_not_found",404);
 return rows[0];
}
export async function runtimeIncomingPhone(input:Record<string,unknown>){
 if(!isPhoneEnabled())invalid("phone_not_enabled",503);
 if(input.action==="receive"){
  const phone=normalizePhoneE164(input.phone),calledNumber=normalizePhoneE164(input.calledNumber);
  if(!incomingPhoneEnabled()||!targets().includes(calledNumber)||!phoneAllowedNumbers().includes(phone))invalid("incoming_pilot_not_allowed",403);
  if(typeof input.callSid!=="string"||!/^CA[a-f0-9]{32}$/i.test(input.callSid))invalid("invalid_incoming_call");
  let customer:VoiceDirectoryContact|null=null;
  try{const directory=await listVoiceDirectory(phone);customer=exactIncomingCustomer(phone,directory.results,directory.nextOffset);}
  catch{console.warn("incoming customer lookup unavailable");}
  return {incoming:await supabaseRpc<IncomingPhoneRecord>("receive_voice_phone_incoming",{
   p_call_sid:input.callSid,p_phone:phone,p_called_number:calledNumber,p_customer_id:customer?.customerId??null,p_request_id:customer?.requestId??null,
   p_display_name:customer?.displayName||customer?.company||null,
  })};
 }
 if(input.action==="pending")return {incoming:await supabaseRequest<IncomingPhoneRecord[]>("voice_phone_incoming",{},{select:FIELDS,or:"(ended_at.is.null,cleanup_pending.eq.true)",order:"created_at.asc,id.asc",limit:50})};
 const id=requireVoiceUuid(input.incomingId,"Eingehender Anruf");
 if(input.action==="get")return {incoming:await getIncomingPhone(id)};
 if(input.action==="event"){
  if(typeof input.key!=="string"||!input.key||input.key.length>160||typeof input.kind!=="string"||input.kind.length>60)invalid("invalid_incoming_event");
  return supabaseRpc<IncomingEvent>("event_voice_phone_incoming",{p_incoming_id:id,p_key:input.key,p_kind:input.kind,p_call_sid:input.callSid??null,p_conference_sid:input.conferenceSid??null});
 }
 if(input.action==="cleanup"){
  if(typeof input.updatedAt!=="string"||!Number.isFinite(Date.parse(input.updatedAt)))invalid("invalid_incoming_version");
  await supabaseRequest("voice_phone_incoming",{method:"PATCH",body:JSON.stringify({cleanup_pending:false})},{id:"eq."+id,ended_at:"not.is.null",updated_at:"eq."+input.updatedAt});
  return {ok:true};
 }
 invalid("invalid_incoming_action");
}
export async function personalIncomingPhone(input:Record<string,unknown>){
 const current=await requirePersonalPhone();
 if(input.action==="list"&&!incomingPhoneEnabled())return {incoming:[]};
 if(input.action==="accept"&&!incomingPhoneEnabled())invalid("incoming_phone_not_enabled",503);
 if(!["list","accept","decline"].includes(String(input.action)))invalid("invalid_incoming_action");
 const result=await supabaseRpc<{incoming?:IncomingPhoneRecord[];call?:PhoneCallRecord;declined?:boolean}>("personal_voice_phone_incoming",{
  p_device_id:current.device.id,p_action:input.action,p_incoming_id:input.action==="list"?null:requireVoiceUuid(input.incomingId,"Eingehender Anruf"),
 });
 if(input.action==="accept"){
  if(!result.call||result.call.device_id!==current.device.id||result.call.staff_id!==current.staff.id)invalid("incoming_accept_unconfirmed",503);
  return {call:{...publicPhoneCall(result.call),direction:"inbound" as const}};
 }
 return {incoming:(result.incoming||[]).map(row=>({id:row.id,phone:row.phone,displayName:row.display_name,customerId:row.customer_id,requestId:row.request_id,
  expiresAt:row.expires_at,state:row.state})),declined:result.declined};
}
