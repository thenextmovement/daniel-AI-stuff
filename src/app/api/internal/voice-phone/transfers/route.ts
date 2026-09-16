import {NextRequest,NextResponse} from "next/server";
import {authorizeVoiceRuntimeApi,readVoiceRuntimeJson,voiceRuntimeApiFailure} from "@/lib/ops/voice-runtime-api";
import {runtimePhoneTransfer} from "@/lib/ops/voice-phone-transfers";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest){
 const denied=authorizeVoiceRuntimeApi(request);if(denied)return denied;
 try{
  const input=await readVoiceRuntimeJson(request);
  if(!input || typeof input!=="object" || Array.isArray(input))return NextResponse.json({ok:false,error:"invalid_transfer_payload"},{status:422});
  const result=await runtimePhoneTransfer(input);
  return NextResponse.json({ok:true,...result as object},{headers:{"cache-control":"no-store"}});
 }catch(error){return voiceRuntimeApiFailure(error,"phone_transfer");}
}
