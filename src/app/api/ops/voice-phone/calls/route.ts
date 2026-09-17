import {NextRequest,NextResponse} from "next/server";
import {authorizeVoiceCopilotApi,readVoiceCopilotJson,voiceCopilotApiFailure} from "@/lib/ops/voice-copilot-api";
import {phoneRequestIsSameOrigin} from "@/lib/ops/voice-phone-contract";
import {reservePhoneCall,getPersonalPhoneCall,publicPhoneCall,activePersonalMobileCall} from "@/lib/ops/voice-phone-calls";
import {QuoteValidationError} from "@/lib/quotes/validation";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest) {
 const denied=await authorizeVoiceCopilotApi(request);if(denied)return denied;
 try {
  if(request.nextUrl.searchParams.get("active")==="mobile")return NextResponse.json({ok:true,call:await activePersonalMobileCall()},{headers:{"cache-control":"no-store"}});
  const {call}=await getPersonalPhoneCall(request.nextUrl.searchParams.get("id"));
  return NextResponse.json({ok:true,call:publicPhoneCall(call)},{headers:{"cache-control":"no-store"}});
 }catch(error){return voiceCopilotApiFailure(error,"phone_call_status");}
}
export async function POST(request:NextRequest) {
 const denied=await authorizeVoiceCopilotApi(request);if(denied)return denied;
 try {
  if(!phoneRequestIsSameOrigin(request.headers.get("origin"),request.headers.get("x-forwarded-host")||request.headers.get("host"),request.headers.get("sec-fetch-site"),process.env.NODE_ENV==="production"))throw new QuoteValidationError("Diese Telefonaktion ist nicht erlaubt.",["invalid_phone_origin"],403);
  const input=await readVoiceCopilotJson(request);
  if(!input || typeof input!=="object" || Array.isArray(input))throw new QuoteValidationError("Ungültige Telefonaktion.",["invalid_phone_payload"],422);
  if(input.action==="reserve")return NextResponse.json({ok:true,call:await reservePhoneCall(input)},{headers:{"cache-control":"no-store"}});
  if(input.action!=="cancel")throw new QuoteValidationError("Unbekannte Telefonaktion.",["invalid_phone_action"],422);
  const {current,call}=await getPersonalPhoneCall(input.callId);
  const base=(process.env.VOICE_RUNTIME_BASE_URL||"").trim().replace(/\/+$/,""),token=(process.env.VOICE_DISPATCH_TOKEN||"").trim();
  if(!base||!token)throw new QuoteValidationError("Der Telefonanschluss ist nicht erreichbar.",["phone_runtime_unavailable"],503);
  const response=await fetch(base+"/phone/cancel",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},
   body:JSON.stringify({callId:call.id,deviceId:current.device.id,staffId:current.staff.id}),signal:AbortSignal.timeout(20000),cache:"no-store"});
  if(!response.ok)throw new QuoteValidationError("Das Beenden ist noch nicht bestätigt. Bitte auch im Telefon auflegen.",["phone_cancel_pending"],503);
  return NextResponse.json({ok:true},{headers:{"cache-control":"no-store"}});
 }catch(error){return voiceCopilotApiFailure(error,"phone_call");}
}
