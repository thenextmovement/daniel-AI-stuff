import {NextRequest,NextResponse} from "next/server";
import {authorizeVoiceCopilotApi,readVoiceCopilotJson,voiceCopilotApiFailure} from "@/lib/ops/voice-copilot-api";
import {phoneRequestIsSameOrigin} from "@/lib/ops/voice-phone-contract";
import {readPersonalMobile,changePersonalMobile} from "@/lib/ops/voice-phone-mobile";
import {QuoteValidationError} from "@/lib/quotes/validation";
export const dynamic="force-dynamic";
const headers={"cache-control":"no-store","referrer-policy":"no-referrer"};
export async function GET(request:NextRequest) {
 const denied=await authorizeVoiceCopilotApi(request);if(denied)return denied;
 try{return NextResponse.json({ok:true,...await readPersonalMobile(request.nextUrl.searchParams.get("id"))},{headers});}
 catch(error){return voiceCopilotApiFailure(error,"phone_mobile");}
}
export async function POST(request:NextRequest) {
 const denied=await authorizeVoiceCopilotApi(request);if(denied)return denied;
 try {
  if(!phoneRequestIsSameOrigin(request.headers.get("origin"),request.headers.get("x-forwarded-host")||request.headers.get("host"),request.headers.get("sec-fetch-site"),process.env.NODE_ENV==="production"))throw new QuoteValidationError("Diese Telefonaktion ist nicht erlaubt.",["invalid_phone_origin"],403);
  return NextResponse.json({ok:true,...await changePersonalMobile(await readVoiceCopilotJson(request))},{headers});
 }catch(error){return voiceCopilotApiFailure(error,"phone_mobile");}
}
