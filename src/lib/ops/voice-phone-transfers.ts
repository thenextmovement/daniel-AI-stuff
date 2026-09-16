import {supabaseRequest,supabaseRpc} from "@/lib/quotes/supabase-rest";
import {QuoteValidationError} from "@/lib/quotes/validation";
import {requireVoiceUuid} from "./voice-platform-contract";
import {getRuntimePhoneCall,publicPhoneCall,requirePersonalPhone} from "./voice-phone-calls";
import {isPhoneEnabled} from "./voice-phone-identity";
import type {PhoneTransfer,TransferEvent} from "../../../services/voice-runtime/phone-transfers";
const FIELDS="id,call_id,request_key,from_staff_id,from_device_id,from_call_sid,to_staff_id,to_device_id,to_call_sid,state,cancel_requested,customer_held,dial_claimed,target_joined,target_guards_exit,source_releases_exit,owner_adopted,source_removed,target_removed,customer_resumed,cleanup_pending,created_at,expires_at,ended_at,updated_at";
export async function getPhoneTransfer(id:unknown){
 const transferId=requireVoiceUuid(id,"Übergabe");
 const rows=await supabaseRequest<PhoneTransfer[]>("voice_phone_transfers",{}, {select:FIELDS,id:"eq."+transferId,limit:1});
 if(!rows[0])throw new QuoteValidationError("Übergabe nicht gefunden.",["transfer_not_found"],404);
 return {transfer:rows[0],call:await getRuntimePhoneCall(rows[0].call_id)};
}
export async function runtimePhoneTransfer(input:Record<string,unknown>){
 if(!isPhoneEnabled())throw new QuoteValidationError("Telefonanschluss ist nicht aktiv.",["phone_not_enabled"],503);
 if(input.action==="pending")return {transfers:await supabaseRequest<PhoneTransfer[]>("voice_phone_transfers",{},{
  select:FIELDS,or:"(ended_at.is.null,cleanup_pending.eq.true)",order:"updated_at.asc,id.asc",limit:50,
 })};
 if(input.action==="begin")return {transfer:await supabaseRpc<PhoneTransfer>("begin_voice_phone_transfer",{
  p_call_id:requireVoiceUuid(input.callId,"Anruf"),p_device_id:requireVoiceUuid(input.deviceId,"Telefon"),
  p_target_staff_id:requireVoiceUuid(input.targetStaffId,"Mitarbeiter"),p_request_key:requireVoiceUuid(input.requestKey,"Übergabekennung"),
 })};
 const id=requireVoiceUuid(input.transferId,"Übergabe");
 if(input.action==="get")return getPhoneTransfer(id);
 if(input.action==="bind")return supabaseRpc("bind_voice_phone_transfer_device",{
  p_transfer_id:id,p_device_id:requireVoiceUuid(input.deviceId,"Telefon"),p_call_sid:input.callSid,
 });
 if(input.action==="event"){
  if(typeof input.key!=="string" || !input.key.length || input.key.length>160 || typeof input.kind!=="string" || input.kind.length>60)
   throw new QuoteValidationError("Ungültige Übergabemeldung.",["invalid_transfer_event"],422);
  return supabaseRpc<TransferEvent>("advance_voice_phone_transfer",{
   p_transfer_id:id,p_key:input.key,p_kind:input.kind,p_call_sid:input.callSid??null,p_actor_device_id:input.actorDeviceId??null,
  });
 }
 if(input.action==="cleanup"){
  if(typeof input.updatedAt!=="string" || !Number.isFinite(Date.parse(input.updatedAt)))throw new QuoteValidationError("Ungültige Version.",["invalid_transfer_version"],422);
  await supabaseRequest("voice_phone_transfers",{method:"PATCH",body:JSON.stringify({cleanup_pending:false})},
   {id:"eq."+id,ended_at:"not.is.null",updated_at:"eq."+input.updatedAt});
  return getPhoneTransfer(id);
 }
 throw new QuoteValidationError("Unbekannte Übergabeaktion.",["invalid_transfer_action"],422);
}
export async function personalPhoneTransfer(id:unknown){
 const current=await requirePersonalPhone(),data=await getPhoneTransfer(id);
 const t=data.transfer;
 if(t.from_device_id!==current.device.id && t.to_device_id!==current.device.id)
  throw new QuoteValidationError("Diese Übergabe gehört zu einem anderen Telefon.",["transfer_forbidden"],403);
 return {...data,current};
}
export async function publicPhoneTransfer(id:unknown){
 const {transfer:t,call,current}=await personalPhoneTransfer(id);
 const staff=await supabaseRequest<Array<{id:string;display_name:string}>>("voice_staff",{},{
  select:"id,display_name",id:"in.("+t.from_staff_id+","+t.to_staff_id+")",limit:2,
 });
 return {id:t.id,state:t.state,fromStaffId:t.from_staff_id,toStaffId:t.to_staff_id,call:publicPhoneCall(call),expiresAt:t.expires_at,
  role:t.from_device_id===current.device.id?"source":"recipient",
  fromName:staff.find(x=>x.id===t.from_staff_id)?.display_name||"Mitarbeiter",
  toName:staff.find(x=>x.id===t.to_staff_id)?.display_name||"Mitarbeiter",
  cancelRequested:t.cancel_requested,targetJoined:t.target_joined,ownerAdopted:t.owner_adopted,endedAt:t.ended_at,cleanupPending:t.cleanup_pending};
}
export async function incomingPhoneTransfers(){
 const current=await requirePersonalPhone();
 const rows=await supabaseRequest<Array<{id:string}>>("voice_phone_transfers",{},{
  select:"id",to_device_id:"eq."+current.device.id,state:"eq.dialing",cancel_requested:"eq.false",ended_at:"is.null",expires_at:"gt."+new Date().toISOString(),
  order:"created_at.asc",limit:1,
 });
 return Promise.all(rows.map(x=>publicPhoneTransfer(x.id)));
}
