import {NextRequest,NextResponse} from "next/server";
import {authorizeVoiceCopilotApi,readVoiceCopilotJson,voiceCopilotApiFailure} from "@/lib/ops/voice-copilot-api";
import {phoneRequestIsSameOrigin} from "@/lib/ops/voice-phone-contract";
import {getPersonalPhoneCall,requirePersonalPhone,isBrowserCallingEnabled} from "@/lib/ops/voice-phone-calls";
import {configuredMobileTransfers} from "@/lib/ops/voice-phone-identity";
import {activeMobileTransfer,incomingPhoneTransfers,personalPhoneTransfer,publicPhoneTransfer} from "@/lib/ops/voice-phone-transfers";
import {QuoteValidationError} from "@/lib/quotes/validation";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest){
 try{
  const denied=await authorizeVoiceCopilotApi(request);if(denied)return denied;
  if(request.nextUrl.searchParams.get("active")==="mobile")return NextResponse.json({ok:true,transfer:await activeMobileTransfer()},{headers:{"cache-control":"no-store"}});
  const id=request.nextUrl.searchParams.get("id");
  return NextResponse.json({ok:true,...(id?{transfer:await publicPhoneTransfer(id)}:{incoming:await incomingPhoneTransfers()})},{headers:{"cache-control":"no-store"}});
 }catch(error){return voiceCopilotApiFailure(error,"phone_transfer");}
}
export async function POST(request:NextRequest){
 try{
  const denied=await authorizeVoiceCopilotApi(request);if(denied)return denied;
  if(!phoneRequestIsSameOrigin(request.headers.get("origin"),request.headers.get("x-forwarded-host")||request.headers.get("host"),request.headers.get("sec-fetch-site"),process.env.NODE_ENV==="production"))
   throw new QuoteValidationError("Diese Telefonaktion ist nicht erlaubt.",["invalid_phone_origin"],403);
  const input=await readVoiceCopilotJson(request);
  if(!input||typeof input!=="object"||Array.isArray(input)||!["begin","commit","cancel"].includes(String(input.action)))
   throw new QuoteValidationError("Ungültige Übergabeaktion.",["invalid_transfer_action"],422);
  const current=await requirePersonalPhone();
  if(input.action==="begin"){
   if(!isBrowserCallingEnabled()&&!configuredMobileTransfers())throw new QuoteValidationError("Der Anschluss wird eingerichtet.",["phone_not_enabled"],503);
   await getPersonalPhoneCall(input.callId);
  }else await personalPhoneTransfer(input.transferId);
  const base=(process.env.VOICE_RUNTIME_BASE_URL||"").trim().replace(/\/+$/,""),token=(process.env.VOICE_DISPATCH_TOKEN||"").trim();
  if(!base||!token)throw new QuoteValidationError("Der Anschluss ist nicht erreichbar.",["phone_runtime_unavailable"],503);
  const response=await fetch(base+"/phone/transfer",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},
   body:JSON.stringify({action:input.action,callId:input.callId,transferId:input.transferId,requestKey:input.requestKey,targetStaffId:input.targetStaffId,
    deviceId:current.device.id,staffId:current.staff.id}),signal:AbortSignal.timeout(15000),cache:"no-store"});
  const body=await response.json().catch(()=>null);
  if(!response.ok||!body?.ok||typeof body.transferId!=="string")throw new QuoteValidationError("Die Übergabe konnte noch nicht bestätigt werden.",["transfer_pending"],503);
  return NextResponse.json({ok:true,transferId:body.transferId},{status:202,headers:{"cache-control":"no-store"}});
 }catch(error){return voiceCopilotApiFailure(error,"phone_transfer");}
}
