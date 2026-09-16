import {NextRequest,NextResponse} from "next/server";
import {authorizeVoiceCopilotApi,readVoiceCopilotJson,voiceCopilotApiFailure} from "@/lib/ops/voice-copilot-api";
import {phoneRequestIsSameOrigin} from "@/lib/ops/voice-phone-contract";
import {personalPhoneCapture} from "@/lib/ops/voice-phone-captures";
import {QuoteValidationError} from "@/lib/quotes/validation";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest){
 const denied=await authorizeVoiceCopilotApi(request);if(denied)return denied;
 try{return NextResponse.json({ok:true,...await personalPhoneCapture({action:"status",callId:request.nextUrl.searchParams.get("id")})},{headers:{"cache-control":"no-store"}});}
 catch(error){return voiceCopilotApiFailure(error,"phone_capture");}
}
export async function POST(request:NextRequest){
 const denied=await authorizeVoiceCopilotApi(request);if(denied)return denied;
 try{
  if(!phoneRequestIsSameOrigin(request.headers.get("origin"),request.headers.get("x-forwarded-host")||request.headers.get("host"),request.headers.get("sec-fetch-site"),process.env.NODE_ENV==="production"))
   throw new QuoteValidationError("Diese Telefonaktion ist nicht erlaubt.",["invalid_phone_origin"],403);
  const input=await readVoiceCopilotJson(request);
  if(!input||typeof input!=="object"||Array.isArray(input)||!["start","stop"].includes(String(input.action)))
   throw new QuoteValidationError("Ungültige Mitschriftaktion.",["invalid_capture_action"],422);
  const data=await personalPhoneCapture(input);
  if(!data.capture)throw Error("capture_not_reserved");
  const base=(process.env.VOICE_RUNTIME_BASE_URL||"").trim().replace(/\/+$/,""),token=(process.env.VOICE_DISPATCH_TOKEN||"").trim();
  // Reservation/stop intent is durable. Recovery can finish a timed-out kick.
  let pending=true;
  if(base&&token)try{
   const response=await fetch(base+"/phone/capture",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},
    body:JSON.stringify({captureId:data.capture.id}),signal:AbortSignal.timeout(20000),cache:"no-store"});
   pending=!response.ok;
  }catch{}
  return NextResponse.json({ok:true,id:data.capture.id,pending},{status:202,headers:{"cache-control":"no-store"}});
 }catch(error){return voiceCopilotApiFailure(error,"phone_capture");}
}
