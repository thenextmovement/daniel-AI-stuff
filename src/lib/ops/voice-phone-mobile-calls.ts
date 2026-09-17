import {supabaseRequest,supabaseRpc} from "@/lib/quotes/supabase-rest";
import {QuoteValidationError} from "@/lib/quotes/validation";
import {requireVoiceUuid} from "./voice-platform-contract";
import {getRuntimePhoneCall,phoneAllowedNumbers} from "./voice-phone-calls";
import type {MobileCallLeg,MobileCallResult} from "../../../services/voice-runtime/phone-mobile-calls";
import {getPhoneTransfer} from "./voice-phone-transfers";
import {configuredMobileCalling,configuredMobileTransfers} from "./voice-phone-identity";
const FIELDS="id,transfer_id,call_id,staff_id,device_id,mobile_link_id,phone,state,provider_call_sid,claimed_at,confirmed_at,expires_at,ended_at,provider_ended_at,cleanup_pending,updated_at";
export async function runtimeMobileCallAction(input:Record<string,unknown>){
 if(input.action==="recover")return {legs:await supabaseRequest<MobileCallLeg[]>("voice_phone_mobile_legs",{},{select:FIELDS,or:"(ended_at.is.null,cleanup_pending.eq.true)",order:"updated_at.asc,id.asc",limit:100})};
 const id=requireVoiceUuid(input.id,"Handyverbindung");
 const leg=(await supabaseRequest<MobileCallLeg[]>("voice_phone_mobile_legs",{},{select:FIELDS,id:"eq."+id,limit:1}))[0];
 if(!leg)throw new QuoteValidationError("Handyverbindung nicht gefunden.",["mobile_leg_not_found"],404);
 if(input.action==="get")return {leg,transfer:leg.transfer_id?(await getPhoneTransfer(leg.transfer_id)).transfer:null,call:await getRuntimePhoneCall(leg.call_id),dial:false,join:false,closeCall:false};
 if(input.action!=="event"||typeof input.kind!=="string"||!["claim","bind","prompt","confirm","reject","terminal","expire","cancel","cleanup"].includes(input.kind))
  throw new QuoteValidationError("Ungültige Handyaktion.",["mobile_call_action_invalid"],422);
 if(["claim","prompt","confirm"].includes(input.kind)&&(!configuredMobileCalling()||(!!leg.transfer_id&&!configuredMobileTransfers())||
  !phoneAllowedNumbers().includes((await getRuntimePhoneCall(leg.call_id)).phone)||
  !(process.env.VOICE_PHONE_MOBILE_NUMBERS||"").split(",").map(x=>x.trim()).includes(leg.phone)))
  throw new QuoteValidationError("Handygespräche sind nicht aktiviert.",["mobile_calls_disabled"],503);
 if(input.callSid!=null&&(typeof input.callSid!=="string"||!/^CA[a-f0-9]{32}$/i.test(input.callSid)))
  throw new QuoteValidationError("Ungültige Telefonverbindung.",["mobile_leg_invalid"],422);
 if(input.updatedAt!=null&&(typeof input.updatedAt!=="string"||!Number.isFinite(Date.parse(input.updatedAt))))
  throw new QuoteValidationError("Ungültiger Stand.",["mobile_version_invalid"],422);
 return supabaseRpc<MobileCallResult>("advance_voice_phone_mobile",{p_id:id,p_kind:input.kind,p_call_sid:input.callSid??null,p_updated_at:input.updatedAt??null});
}
