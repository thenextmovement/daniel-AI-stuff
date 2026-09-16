import {NextRequest,NextResponse} from "next/server";
import {authorizeVoiceCopilotApi,readVoiceCopilotJson,voiceCopilotApiFailure} from "@/lib/ops/voice-copilot-api";
import {phoneRequestIsSameOrigin} from "@/lib/ops/voice-phone-contract";
import {personalIncomingPhone} from "@/lib/ops/voice-phone-incoming";
import {QuoteValidationError} from "@/lib/quotes/validation";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest){
 const denied=await authorizeVoiceCopilotApi(request);if(denied)return denied;
 try{return NextResponse.json({ok:true,...await personalIncomingPhone({action:"list"})},{headers:{"cache-control":"no-store"}});}
 catch(error){return voiceCopilotApiFailure(error,"phone_incoming");}
}
export async function POST(request:NextRequest){
 const denied=await authorizeVoiceCopilotApi(request);if(denied)return denied;
 try{
  if(!phoneRequestIsSameOrigin(request.headers.get("origin"),request.headers.get("x-forwarded-host")||request.headers.get("host"),request.headers.get("sec-fetch-site"),process.env.NODE_ENV==="production"))
   throw new QuoteValidationError("Diese Telefonaktion ist nicht erlaubt.",["invalid_phone_origin"],403);
  const input=await readVoiceCopilotJson(request);
  if(!input||typeof input!=="object"||Array.isArray(input)||!["accept","decline"].includes(String(input.action)))
   throw new QuoteValidationError("Ungültige Anrufaktion.",["invalid_incoming_action"],422);
  return NextResponse.json({ok:true,...await personalIncomingPhone(input)},{headers:{"cache-control":"no-store"}});
 }catch(error){return voiceCopilotApiFailure(error,"phone_incoming");}
}
