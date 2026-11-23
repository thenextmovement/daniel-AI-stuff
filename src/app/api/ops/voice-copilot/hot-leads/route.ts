import {NextRequest,NextResponse} from "next/server";
import {authorizeVoiceCopilotApi,readVoiceCopilotJson,voiceCopilotApiFailure} from "@/lib/ops/voice-copilot-api";
import {phoneRequestIsSameOrigin} from "@/lib/ops/voice-phone-contract";
import {listVoiceHotLeads,saveVoiceHotLead,voiceDirectoryAmounts} from "@/lib/ops/voice-hot-leads";
import {QuoteValidationError} from "@/lib/quotes/validation";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest){
 const denied=await authorizeVoiceCopilotApi(request);if(denied)return denied;
 try{
  const q=request.nextUrl.searchParams;
  const data=q.has("customerIds")?await voiceDirectoryAmounts(q.get("customerIds")!.split(",").filter(Boolean)):await listVoiceHotLeads(q.get("filter")||"today",q.get("sort")||"priority",Number(q.get("offset")||0),new Date(),q.get("status")||"all",q.get("score")||"all",q.get("age")||"all");
  return NextResponse.json({ok:true,...data},{headers:{"cache-control":"no-store"}});
 }catch(error){return voiceCopilotApiFailure(error,"hot-leads-read");}
}
export async function PATCH(request:NextRequest){
 const denied=await authorizeVoiceCopilotApi(request);if(denied)return denied;
 try{
  if(!phoneRequestIsSameOrigin(request.headers.get("origin"),request.headers.get("x-forwarded-host")||request.headers.get("host"),request.headers.get("sec-fetch-site"),process.env.NODE_ENV==="production"))throw new QuoteValidationError("Diese Aktion ist nicht erlaubt.",["invalid_origin"],403);
  const input=await readVoiceCopilotJson(request);
  if(!input||typeof input!=="object"||Array.isArray(input))throw new QuoteValidationError("Ungültige Eingabe.",["invalid_payload"],422);
  return NextResponse.json({ok:true,state:await saveVoiceHotLead(input)},{headers:{"cache-control":"no-store"}});
 }catch(error){return voiceCopilotApiFailure(error,"hot-leads-save");}
}
