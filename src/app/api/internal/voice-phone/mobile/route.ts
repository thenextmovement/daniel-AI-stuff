import {NextRequest,NextResponse} from "next/server";
import {authorizeVoiceRuntimeApi,readVoiceRuntimeJson,voiceRuntimeApiFailure} from "@/lib/ops/voice-runtime-api";
import {runtimeMobileAction} from "@/lib/ops/voice-phone-mobile";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest) {
 const denied=authorizeVoiceRuntimeApi(request);if(denied)return denied;
 try {
  const input=await readVoiceRuntimeJson(request);
  if(!input||typeof input!=="object"||Array.isArray(input))return NextResponse.json({ok:false,error:"invalid_mobile_payload"},{status:422});
  return NextResponse.json({ok:true,...await runtimeMobileAction(input) as object},{headers:{"cache-control":"no-store"}});
 }catch(error){return voiceRuntimeApiFailure(error,"phone_mobile");}
}
