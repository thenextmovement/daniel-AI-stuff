import {supabaseRequest,supabaseRpc} from "@/lib/quotes/supabase-rest";
import {QuoteValidationError} from "@/lib/quotes/validation";
import {requireVoiceUuid} from "./voice-platform-contract";
import {configuredMobileIncoming} from "./voice-phone-identity";
import {phoneAllowedNumbers} from "./voice-phone-calls";
import type {IncomingMobileOffer,IncomingMobileResult} from "../../../services/voice-runtime/phone-mobile-incoming";
const FIELDS="id,incoming_id,staff_id,device_id,mobile_link_id,phone,state,provider_call_sid,claimed_at,ended_at,provider_ended_at,mobile_leg_id,expires_at,cleanup_pending,updated_at";
const phones=()=>(process.env.VOICE_PHONE_MOBILE_NUMBERS||"").split(",").map(x=>x.trim()).filter(x=>/^[+][1-9][0-9]{6,14}$/.test(x));
function invalid(code:string,status=422):never{throw new QuoteValidationError("Der Handy-Eingang konnte nicht verarbeitet werden.",[code],status);}
export async function runtimeMobileIncoming(input:Record<string,unknown>,incoming:(id:unknown)=>Promise<IncomingMobileResult["incoming"]>){
 if(input.action==="mobile_recover")return {offers:await supabaseRequest<IncomingMobileOffer[]>("voice_phone_mobile_incoming",{},{select:FIELDS,
  or:"(ended_at.is.null,cleanup_pending.eq.true)",order:"updated_at.asc,id.asc",limit:100})};
 if(input.action==="mobile_offers"){
  const row=await incoming(input.incomingId);
  const allowed=configuredMobileIncoming()&&phoneAllowedNumbers().includes(row.phone)?
   phones().filter(x=>Array.isArray(input.allowedPhones)&&input.allowedPhones.includes(x)):[];
  return supabaseRpc<{offers:IncomingMobileOffer[]}>("offer_voice_mobile_incoming",{p_incoming_id:row.id,p_allowed_phones:allowed});
 }
 const id=requireVoiceUuid(input.id,"Handy-Eingang");
 const offer=(await supabaseRequest<IncomingMobileOffer[]>("voice_phone_mobile_incoming",{},{select:FIELDS,id:"eq."+id,limit:1}))[0];
 if(!offer)invalid("incoming_mobile_offer_not_found",404);
 const row=await incoming(offer.incoming_id);
 if(input.action==="mobile_get")return {offer,incoming:row,dial:false};
 if(input.action!=="mobile_event"||typeof input.kind!=="string"||!["claim","bind","prompt","confirm","reject","terminal","expire","cancel","cleanup"].includes(input.kind))
  invalid("incoming_mobile_action_invalid");
 const allowed=configuredMobileIncoming()&&phones().includes(offer.phone)&&phoneAllowedNumbers().includes(row.phone)&&
  (process.env.VOICE_PHONE_INBOUND_NUMBERS||"").split(",").map(x=>x.trim()).includes(row.called_number);
 if(["claim","prompt","confirm"].includes(input.kind)&&!allowed)invalid("incoming_mobile_disabled",503);
 if(input.callSid!=null&&(typeof input.callSid!=="string"||!/^CA[a-f0-9]{32}$/i.test(input.callSid)))invalid("incoming_mobile_leg_invalid");
 if(input.updatedAt!=null&&(typeof input.updatedAt!=="string"||!Number.isFinite(Date.parse(input.updatedAt))))invalid("incoming_mobile_version_invalid");
 return supabaseRpc<IncomingMobileResult>("advance_voice_mobile_incoming",{p_id:id,
  p_kind:input.kind==="expire"&&!allowed?"cancel":input.kind,p_call_sid:input.callSid??null,p_updated_at:input.updatedAt??null});
}
