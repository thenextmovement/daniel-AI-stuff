import {NextRequest,NextResponse} from "next/server";
import {authorizeVoiceCopilotApi,readVoiceCopilotJson,voiceCopilotApiFailure} from "@/lib/ops/voice-copilot-api";
import {phoneRequestIsSameOrigin} from "@/lib/ops/voice-phone-contract";
import {personalAiHandoff,activeAiCalls} from "@/lib/ops/voice-ai-handoff";
import {QuoteValidationError} from "@/lib/quotes/validation";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest){
 const denied=await authorizeVoiceCopilotApi(request);if(denied)return denied;
 try{return NextResponse.json({ok:true,...await (request.nextUrl.searchParams.has("active")?activeAiCalls(request.nextUrl.searchParams.get("attemptId")):personalAiHandoff(request.nextUrl.searchParams.has("id")?{action:"get",id:request.nextUrl.searchParams.get("id")}:{action:"list"}))},{headers:{"cache-control":"no-store"}});}
 catch(error){return voiceCopilotApiFailure(error,"ai_handoff");}
}
export async function POST(request:NextRequest){
 const denied=await authorizeVoiceCopilotApi(request);if(denied)return denied;
 try{
  if(!phoneRequestIsSameOrigin(request.headers.get("origin"),request.headers.get("x-forwarded-host")||request.headers.get("host"),request.headers.get("sec-fetch-site"),process.env.NODE_ENV==="production"))
   throw new QuoteValidationError("Diese Telefonaktion ist nicht erlaubt.",["invalid_phone_origin"],403);
  const input=await readVoiceCopilotJson(request);
  if(!input||typeof input!=="object"||Array.isArray(input)||!["begin","cancel"].includes(String(input.action)))
   throw new QuoteValidationError("Ungültige Übernahmeaktion.",["ai_handoff_action_invalid"],422);
  return NextResponse.json({ok:true,...await personalAiHandoff(input)},{headers:{"cache-control":"no-store"}});
 }catch(error){return voiceCopilotApiFailure(error,"ai_handoff");}
}
