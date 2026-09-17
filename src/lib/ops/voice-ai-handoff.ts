import {supabaseRequest,supabaseRpc,SupabaseRestError} from "@/lib/quotes/supabase-rest";
import {QuoteValidationError} from "@/lib/quotes/validation";
import {requireVoiceUuid} from "./voice-platform-contract";
import {requirePersonalPhone,phoneAllowedNumbers,isBrowserCallingEnabled} from "./voice-phone-calls";
import {phoneCaptureEnabled} from "./voice-phone-captures";
import type {AiHandoff,AiHandoffResult} from "../../../services/voice-runtime/phone-ai-handoff";
const FIELDS="id,attempt_id,session_id,staff_id,device_id,phone,customer_call_sid,agent_call_sid,conference_sid,capture_id,state,agent_joined,redirect_claimed_at,connected_at,expires_at,ended_at,cleanup_pending,cleanup_customer,updated_at";
function invalid(code:string,status=422):never{throw new QuoteValidationError("Die KI-Übernahme konnte nicht verarbeitet werden.",[code],status);}
export function aiHandoffEnabled(){return isBrowserCallingEnabled()&&phoneCaptureEnabled()&&process.env.VOICE_PHONE_AI_HANDOFF_ENABLED==="true";}
export async function getAiHandoff(id:unknown){
 const rows=await supabaseRequest<AiHandoff[]>("voice_ai_handoffs",undefined,{select:FIELDS,id:"eq."+requireVoiceUuid(id,"Übernahme"),limit:1});
 if(!rows[0])invalid("ai_handoff_not_found",404);return rows[0];
}
export async function runtimeAiHandoff(input:Record<string,unknown>){
 if(!input||typeof input!=="object"||Array.isArray(input))invalid("ai_handoff_action_invalid");
 if(input.action==="claim_stop")return supabaseRpc<{allowed:boolean;owner:string;providerCallId?:string|null;openAiCallId?:string|null}>(
  "claim_voice_ai_stop",{p_attempt_id:requireVoiceUuid(input.attemptId,"KI-Anruf")});
 if(input.action==="pending")return {handoffs:await supabaseRequest<AiHandoff[]>("voice_ai_handoffs",undefined,
  {select:FIELDS,or:"(ended_at.is.null,cleanup_pending.eq.true)",order:"created_at.asc,id.asc",limit:50})};
 const id=requireVoiceUuid(input.id,"Übernahme");
 if(input.action==="get")return {handoff:await getAiHandoff(id)};
 if(input.action!=="event"||typeof input.key!=="string"||!input.key||input.key.length>160||
  typeof input.kind!=="string"||!["bind","agent_join","agent_leave","conference_end","redirect","customer_join","customer_leave","cancel","expire","failed","cleanup"].includes(input.kind))
  invalid("ai_handoff_event_invalid");
 for(const key of ["callSid","conferenceSid"]){
  if(input[key]!=null&&(typeof input[key]!=="string"||!(key==="callSid"?/^CA[a-f0-9]{32}$/i:/^CF[a-f0-9]{32}$/i).test(String(input[key]))))invalid("ai_handoff_binding_invalid");
 }
 if(input.updatedAt!=null&&(typeof input.updatedAt!=="string"||!Number.isFinite(Date.parse(input.updatedAt))))invalid("ai_handoff_version_invalid");
 return supabaseRpc<AiHandoffResult>("advance_voice_ai_handoff",{p_id:id,p_key:input.key,p_kind:input.kind,
  p_call_sid:input.callSid??null,p_conference_sid:input.conferenceSid??null,
  p_device_id:input.deviceId==null?null:requireVoiceUuid(input.deviceId,"Telefon"),p_updated_at:input.updatedAt??null});
}
export function publicAiHandoff(h:AiHandoff){
 return {id:h.id,attemptId:h.attempt_id,callId:h.session_id,state:h.state,expiresAt:h.expires_at,phone:h.phone,
  connected:h.state==="connected",captureId:h.capture_id,cleanupPending:h.cleanup_pending};
}
export async function activeAiCalls(attemptId?:unknown){
 await requirePersonalPhone();
 if(!aiHandoffEnabled())return {calls:[],segments:[]};
 const attempts=await supabaseRequest<Array<{id:string;target_id:string}>>("voice_call_attempts",undefined,{
  select:"id,target_id",status:"eq.live",ended_at:"is.null",control_owner:"eq.ai",provider:"eq.twilio",
  "model_snapshot->>model_id":"eq.gpt-live-1","context_snapshot->>allowlist_only":"eq.true",
  ...(attemptId?{id:"eq."+requireVoiceUuid(attemptId,"KI-Anruf")} : {}),order:"created_at.desc",limit:50,
 });
 if(!attempts.length)return {calls:[],segments:[]};
 const [sessions,targets]=await Promise.all([
  supabaseRequest<Array<{id:string;attempt_id:string;started_at:string}>>("voice_call_sessions",undefined,{
   select:"id,attempt_id,started_at",attempt_id:"in.("+attempts.map(a=>a.id).join(",")+")",
   mode:"eq.internal_test",status:"eq.live",ended_at:"is.null",ai_ended_at:"is.null",
   consent_status:"eq.confirmed",transcript_storage_enabled:"eq.true",order:"started_at.desc",limit:50,
  }),
  supabaseRequest<Array<{id:string;phone_e164:string}>>("voice_call_targets",undefined,{
   select:"id,phone_e164",id:"in.("+[...new Set(attempts.map(a=>a.target_id))].join(",")+")",status:"eq.live",limit:50,
  }),
 ]);
 const allowed=phoneAllowedNumbers();
 const calls=sessions.flatMap(session=>{
  const target=targets.find(t=>t.id===attempts.find(a=>a.id===session.attempt_id)?.target_id);
  return target&&allowed.includes(target.phone_e164)?[{attemptId:session.attempt_id,callId:session.id,phone:target.phone_e164,startedAt:session.started_at}]:[];
 });
 const selected=calls.find(c=>c.attemptId===attemptId);
 const segments=selected?await supabaseRequest<Array<{source_item_id:string;speaker:string;text:string;is_final:boolean;start_ms:number;end_ms:number|null}>>(
  "voice_transcript_segments",undefined,{select:"source_item_id,speaker,text,is_final,start_ms,end_ms",session_id:"eq."+selected.callId,order:"start_ms.desc,source_item_id.desc",limit:100}):[];
 return {calls,segments:segments.reverse()};
}
export async function personalAiHandoff(input:Record<string,unknown>){
 const current=await requirePersonalPhone();
 if(input.action==="list"){
  if(!aiHandoffEnabled())return {handoffs:[]};
  const rows=await supabaseRequest<AiHandoff[]>("voice_ai_handoffs",undefined,{select:FIELDS,device_id:"eq."+current.device.id,
   staff_id:"eq."+current.staff.id,order:"created_at.desc",limit:5});
  return {handoffs:rows.map(publicAiHandoff)};
 }
 if(input.action==="begin"){
  if(!aiHandoffEnabled())invalid("ai_handoff_not_configured",503);
  try{
   const h=await supabaseRpc<AiHandoff>("begin_voice_ai_handoff",{p_attempt_id:requireVoiceUuid(input.attemptId,"KI-Anruf"),
    p_device_id:current.device.id,p_request_key:requireVoiceUuid(input.requestKey,"Übernahmekennung"),p_allowed_phones:phoneAllowedNumbers()});
   if(h.device_id!==current.device.id||h.staff_id!==current.staff.id)invalid("ai_handoff_owner_required",403);
   return {handoff:publicAiHandoff(h)};
  }catch(error){
   if(error instanceof SupabaseRestError&&error.status===400)invalid("ai_handoff_not_available",409);throw error;
  }
 }
 const h=await getAiHandoff(input.id);
 if(h.device_id!==current.device.id||h.staff_id!==current.staff.id)invalid("ai_handoff_owner_required",403);
 if(input.action==="get")return {handoff:publicAiHandoff(h)};
 if(input.action!=="cancel")invalid("ai_handoff_action_invalid");
 const r=await runtimeAiHandoff({action:"event",id:h.id,key:"personal:cancel",kind:"cancel",deviceId:current.device.id}) as AiHandoffResult;
 return {handoff:publicAiHandoff(r.handoff)};
}
