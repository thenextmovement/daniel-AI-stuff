import {NextRequest,NextResponse} from "next/server";
import {authorizeVoiceCopilotApi,readVoiceCopilotJson,voiceCopilotApiFailure} from "@/lib/ops/voice-copilot-api";
import {isPhoneEnabled,currentPhoneDevice} from "@/lib/ops/voice-phone-identity";
import {phoneRequestIsSameOrigin} from "@/lib/ops/voice-phone-contract";
import {QuoteValidationError} from "@/lib/quotes/validation";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest) {
  try{
    const denied=await authorizeVoiceCopilotApi(request);if(denied)return denied;
    if(!phoneRequestIsSameOrigin(request.headers.get("origin"),request.headers.get("x-forwarded-host")||request.headers.get("host"),request.headers.get("sec-fetch-site"),process.env.NODE_ENV==="production"))
      return NextResponse.json({ok:false,error:"same_origin_required"},{status:403});
    await readVoiceCopilotJson(request);
    if(!isPhoneEnabled())throw new QuoteValidationError("Das Browser-Telefon ist noch nicht freigeschaltet.",["phone_not_enabled"],503);
    const current=await currentPhoneDevice();
    if(!current)throw new QuoteValidationError("Bitte melde dein Telefon persönlich an.",["phone_identity_required"],401);
    const base=String(process.env.VOICE_RUNTIME_BASE_URL||"").trim().replace(/\/+$/,"");
    const token=String(process.env.VOICE_DISPATCH_TOKEN||"").trim();
    if(!base||!token)throw new QuoteValidationError("Der Telefonanschluss wird noch eingerichtet.",["phone_runtime_unavailable"],503);
    const response=await fetch(base+"/phone/token",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},
      body:JSON.stringify({deviceId:current.device.id,staffId:current.staff.id}),signal:AbortSignal.timeout(10000),cache:"no-store"});
    const payload=await response.json().catch(()=>null);
    if(!response.ok || typeof payload?.token!=="string" || payload.identity!=="ntd_"+current.device.id.replace(/-/g,""))
      throw new QuoteValidationError("Das Browser-Telefon ist gerade nicht verfügbar.",["phone_token_unavailable"],503);
    return NextResponse.json({ok:true,token:payload.token,identity:payload.identity,expiresAt:payload.expiresAt},{headers:{"cache-control":"no-store"}});
  }catch(error){return voiceCopilotApiFailure(error,"browser_phone_token");}
}
