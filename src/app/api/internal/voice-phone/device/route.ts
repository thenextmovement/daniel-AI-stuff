import {NextRequest,NextResponse} from "next/server";
import {authorizeVoiceRuntimeApi,readVoiceRuntimeJson,voiceRuntimeApiFailure} from "@/lib/ops/voice-runtime-api";
import {getPhoneRuntimeDevice,isPhoneEnabled} from "@/lib/ops/voice-phone-identity";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest) {
  const denied=authorizeVoiceRuntimeApi(request);if(denied)return denied;
  if(!isPhoneEnabled())return NextResponse.json({ok:false,error:"phone_not_enabled"},{status:503});
  try{
    const input=await readVoiceRuntimeJson(request);
    const device=await getPhoneRuntimeDevice(input?.deviceId,input?.staffId);
    return NextResponse.json({ok:true,device},{headers:{"cache-control":"no-store"}});
  }catch(error){return voiceRuntimeApiFailure(error,"phone_device");}
}
