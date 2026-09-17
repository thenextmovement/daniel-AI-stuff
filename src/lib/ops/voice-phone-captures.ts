import {randomBytes,createHash} from "node:crypto";
import {supabaseRequest,supabaseRpc} from "@/lib/quotes/supabase-rest";
import {QuoteValidationError} from "@/lib/quotes/validation";
import {requireVoiceUuid} from "./voice-platform-contract";
import {getPersonalPhoneCall} from "./voice-phone-calls";
import {isPhoneEnabled} from "./voice-phone-identity";
import {validateTranscriptBatch} from "./voice-history";
import type {PhoneCaptureRecord} from "../../../services/voice-runtime/phone-capture";
const FIELDS="id,call_id,customer_call_sid,state,stream_sid,created_at,stream_started_at,ended_at,updated_at,cleanup_pending";
export function phoneCaptureEnabled(){return isPhoneEnabled()&&process.env.VOICE_PHONE_TRANSCRIPTION_ENABLED==="true";}
function invalid(code:string,status=422):never{throw new QuoteValidationError("Die Mitschrift konnte nicht verarbeitet werden.",[code],status);}
export async function personalPhoneCapture(input:Record<string,unknown>){
 const {call,current}=await getPersonalPhoneCall(input.callId);
 if(input.action==="start"){
  if(!phoneCaptureEnabled())invalid("phone_transcription_not_enabled",503);
  if(input.consentConfirmed!==true)invalid("transcript_consent_required");
  const capture=await supabaseRpc<PhoneCaptureRecord>("reserve_voice_phone_capture",{
   p_call_id:call.id,p_device_id:current.device.id,p_request_key:requireVoiceUuid(input.requestKey,"Mitschriftkennung"),
   p_token_hash:createHash("sha256").update(randomBytes(32)).digest("hex"),
  });
  return {capture,deviceId:current.device.id};
 }
 const rows=await supabaseRequest<PhoneCaptureRecord[]>("voice_phone_captures",{},{select:FIELDS,call_id:"eq."+call.id,order:"created_at.desc,id.desc",limit:8});
 if(input.action==="stop"){
  const capture=rows.find(row=>row.id===input.captureId);
  if(!capture)invalid("capture_not_found",404);
  const stopped=await supabaseRpc<PhoneCaptureRecord>("interrupt_voice_phone_capture",{p_capture_id:capture.id,p_device_id:current.device.id});
  return {capture:stopped,deviceId:current.device.id};
 }
 if(input.action!=="status")invalid("invalid_capture_action");
 const session=(await supabaseRequest<Array<{capture_status:string}>>("voice_call_sessions",{}, {select:"capture_status",id:"eq."+call.id,limit:1}))[0];
 const segments=await supabaseRequest<Array<{source_item_id:string;speaker:string;text:string;is_final:boolean;start_ms:number;end_ms:number|null}>>("voice_transcript_segments",{},{
  select:"source_item_id,speaker,text,is_final,start_ms,end_ms",session_id:"eq."+call.id,order:"start_ms.desc,source_item_id.desc",limit:100,
 });
 return {enabled:phoneCaptureEnabled(),coverageInterrupted:session?.capture_status==="interrupted"||rows.some(row=>row.state==="interrupted"),captures:rows.map(row=>({id:row.id,state:row.state,startedAt:row.stream_started_at,endedAt:row.ended_at,cleanupPending:row.cleanup_pending})),segments:segments.reverse()};
}
export async function runtimePhoneCapture(input:Record<string,unknown>){
 // Keep persistence and cleanup working if new capture admission is switched off.
 if(!isPhoneEnabled())invalid("phone_not_enabled",503);
 if(input.action==="pending")return {captures:await supabaseRequest<PhoneCaptureRecord[]>("voice_phone_captures",{},{
  select:FIELDS,or:"(ended_at.is.null,cleanup_pending.eq.true)",order:"updated_at.asc,id.asc",limit:50,
 })};
 const id=requireVoiceUuid(input.captureId,"Mitschrift");
 if(input.action==="get"){
  const rows=await supabaseRequest<PhoneCaptureRecord[]>("voice_phone_captures",{},{select:FIELDS,id:"eq."+id,limit:1});
  if(!rows[0])invalid("capture_not_found",404);
  return {capture:rows[0]};
 }
 if(input.action==="claim"||input.action==="bind"){
  if(!phoneCaptureEnabled())invalid("phone_transcription_not_enabled",503);
  if(input.action==="claim")return supabaseRpc("claim_voice_phone_capture",{p_capture_id:id});
  if(typeof input.callSid!=="string"||!/^CA[a-f0-9]{32}$/i.test(input.callSid)||typeof input.streamSid!=="string"||!/^MZ[a-f0-9]{32}$/i.test(input.streamSid))invalid("invalid_capture_binding");
  return supabaseRpc("bind_voice_phone_capture",{p_capture_id:id,p_call_sid:input.callSid,p_stream_sid:input.streamSid});
 }
 if(input.action==="persist"){
  if(typeof input.streamSid!=="string"||!/^MZ[a-f0-9]{32}$/i.test(input.streamSid))invalid("invalid_capture_binding");
  if(input.finish!=null&&!["complete","interrupted"].includes(String(input.finish)))invalid("invalid_capture_finish");
  return supabaseRpc("persist_voice_phone_capture",{p_capture_id:id,p_stream_sid:input.streamSid,p_segments:validateTranscriptBatch(input.segments),p_finish:input.finish??null});
 }
 if(input.action==="interrupt"){
  if(input.updatedAt!=null&&(typeof input.updatedAt!=="string"||!Number.isFinite(Date.parse(input.updatedAt))))invalid("invalid_capture_version");
  return {capture:await supabaseRpc("interrupt_voice_phone_capture",{p_capture_id:id,p_expected_updated_at:input.updatedAt??null})};
 }
 if(input.action==="cleanup"){
  if(typeof input.updatedAt!=="string"||!Number.isFinite(Date.parse(input.updatedAt)))invalid("invalid_capture_version");
  await supabaseRequest("voice_phone_captures",{method:"PATCH",body:JSON.stringify({cleanup_pending:false})},{id:"eq."+id,ended_at:"not.is.null",updated_at:"eq."+input.updatedAt});
  return {ok:true};
 }
 invalid("invalid_capture_action");
}
