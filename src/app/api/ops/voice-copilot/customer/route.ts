import {NextRequest,NextResponse} from "next/server";
import {authorizeVoiceCopilotApi,readVoiceCopilotJson,voiceCopilotApiFailure} from "@/lib/ops/voice-copilot-api";
import {phoneRequestIsSameOrigin} from "@/lib/ops/voice-phone-contract";
import {currentPhoneDevice} from "@/lib/ops/voice-phone-identity";
import {requireVoiceUuid} from "@/lib/ops/voice-platform-contract";
import {readCustomerEditor,saveCustomerEditor} from "@/lib/ops/voice-customer-editor";
import {QuoteValidationError} from "@/lib/quotes/validation";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest){
 const denied=await authorizeVoiceCopilotApi(request);if(denied)return denied;
 try{return NextResponse.json({ok:true,...await readCustomerEditor(requireVoiceUuid(request.nextUrl.searchParams.get("customerId"),"Kunde"))},{headers:{"cache-control":"no-store"}});}
 catch(error){return voiceCopilotApiFailure(error,"customer-edit-read");}
}
export async function PATCH(request:NextRequest){
 const denied=await authorizeVoiceCopilotApi(request);if(denied)return denied;
 try{
 if(!phoneRequestIsSameOrigin(request.headers.get("origin"),request.headers.get("x-forwarded-host")||request.headers.get("host"),request.headers.get("sec-fetch-site"),process.env.NODE_ENV==="production"))throw new QuoteValidationError("Diese Aktion ist nicht erlaubt.",["invalid_origin"],403);
 const current=await currentPhoneDevice();
 if(!current)throw new QuoteValidationError("Melde dein Telefonprofil an.",["phone_identity_required"],403);
 const input=await readVoiceCopilotJson(request);
 if(!input||typeof input!=="object"||Array.isArray(input))throw new QuoteValidationError("Ungültige Eingabe.",["invalid_payload"],422);
 return NextResponse.json({ok:true,...await saveCustomerEditor(requireVoiceUuid(input.customerId,"Kunde"),input,current.staff.id)},{headers:{"cache-control":"no-store"}});
 }catch(error){return voiceCopilotApiFailure(error,"customer-edit-save");}
}
