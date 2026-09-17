import {NextRequest,NextResponse} from "next/server";
import {authorizeVoiceRuntimeApi,readVoiceRuntimeJson,voiceRuntimeApiFailure} from "@/lib/ops/voice-runtime-api";
import {runtimeAiHandoff} from "@/lib/ops/voice-ai-handoff";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest){
 const denied=authorizeVoiceRuntimeApi(request);if(denied)return denied;
 try{return NextResponse.json(await runtimeAiHandoff(await readVoiceRuntimeJson(request)),{headers:{"cache-control":"no-store"}});}
 catch(error){return voiceRuntimeApiFailure(error,"ai_handoff");}
}
