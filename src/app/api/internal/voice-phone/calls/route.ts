import {isPhoneEnabled} from "@/lib/ops/voice-phone-identity";
import {NextRequest,NextResponse} from "next/server";
import {authorizeVoiceRuntimeApi,readVoiceRuntimeJson,voiceRuntimeApiFailure} from "@/lib/ops/voice-runtime-api";
import {phoneRuntimeAction,phoneCallsToRecover} from "@/lib/ops/voice-phone-calls";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest) {
 const denied=authorizeVoiceRuntimeApi(request);if(denied)return denied;
 try {
  const input=await readVoiceRuntimeJson(request);
  if(!input || typeof input!=="object" || Array.isArray(input))return NextResponse.json({ok:false,error:"invalid_phone_payload"},{status:422});
  if(!isPhoneEnabled())return NextResponse.json({ok:false,error:"browser_calling_not_configured"},{status:503});
  const result=input.action==="recover"?{calls:await phoneCallsToRecover()}:await phoneRuntimeAction(input);
  return NextResponse.json({ok:true,...result},{headers:{"cache-control":"no-store"}});
 }catch(error){return voiceRuntimeApiFailure(error,"phone_call");}
}
