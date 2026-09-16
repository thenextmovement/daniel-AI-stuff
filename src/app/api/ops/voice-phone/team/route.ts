import {NextRequest,NextResponse} from "next/server";
import {authorizeVoiceCopilotApi,readVoiceCopilotJson,voiceCopilotApiFailure} from "@/lib/ops/voice-copilot-api";
import {phoneRequestIsSameOrigin} from "@/lib/ops/voice-phone-contract";
import {readPhoneManagement,changePhoneManagement} from "@/lib/ops/voice-phone-management";
import {QuoteValidationError} from "@/lib/quotes/validation";
export const dynamic="force-dynamic";
export const runtime="nodejs";
function result(data:object){return NextResponse.json({ok:true,...data},{headers:{"cache-control":"no-store","referrer-policy":"no-referrer"}});}
export async function GET(request:NextRequest){
 const denied=await authorizeVoiceCopilotApi(request);if(denied)return denied;
 try{return result(await readPhoneManagement());}
 catch(error){return voiceCopilotApiFailure(error,"phone_team_read");}
}
export async function POST(request:NextRequest){
 const denied=await authorizeVoiceCopilotApi(request);if(denied)return denied;
 try{
  if(!phoneRequestIsSameOrigin(request.headers.get("origin"),request.headers.get("x-forwarded-host")||request.headers.get("host"),request.headers.get("sec-fetch-site"),process.env.NODE_ENV==="production"))
   throw new QuoteValidationError("Diese Telefonaktion ist nicht erlaubt.",["invalid_phone_origin"],403);
  const input=await readVoiceCopilotJson(request);
  if(!input||typeof input!=="object"||Array.isArray(input))throw new QuoteValidationError("Ungültige Teamaktion.",["invalid_phone_management_input"],422);
  return result(await changePhoneManagement(input));
 }catch(error){return voiceCopilotApiFailure(error,"phone_team_change");}
}
