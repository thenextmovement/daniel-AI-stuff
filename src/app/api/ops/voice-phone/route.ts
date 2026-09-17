import { NextRequest, NextResponse } from "next/server";
import { authorizeVoiceCopilotApi, readVoiceCopilotJson, voiceCopilotApiFailure } from "@/lib/ops/voice-copilot-api";
import { setMobileReceiving,isPhoneEnabled, readPhoneIdentity, enrollPhoneDevice, updatePhonePresence, revokeCurrentPhoneDevice } from "@/lib/ops/voice-phone-identity";
import { PHONE_DEVICE_COOKIE, PHONE_DEVICE_SECONDS, phoneRequestIsSameOrigin } from "@/lib/ops/voice-phone-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function result(body:Record<string,unknown>,status=200) {
  return NextResponse.json(body,{status,headers:{"cache-control":"no-store"}});
}
export async function GET(request:NextRequest) {
  try {
    const denied=await authorizeVoiceCopilotApi(request);if(denied)return denied;
    return result({ok:true,...await readPhoneIdentity(request)});
  } catch(error) { return voiceCopilotApiFailure(error,"phone_identity"); }
}
export async function POST(request:NextRequest) {
  try {
    const denied=await authorizeVoiceCopilotApi(request);if(denied)return denied;
    const origin=request.headers.get("origin");
    const host=request.headers.get("x-forwarded-host") || request.headers.get("host");
    if (!phoneRequestIsSameOrigin(origin,host,request.headers.get("sec-fetch-site"),process.env.NODE_ENV==="production"))
      return result({ok:false,error:"same_origin_required"},403);
    if(!isPhoneEnabled())return result({ok:false,error:"phone_not_enabled"},503);
    const input=await readVoiceCopilotJson(request);
    if(!input || typeof input!=="object" || Array.isArray(input))return result({ok:false,error:"invalid_phone_action"},422);
    if(input.action==="enroll_code" || input.action==="enroll_access") {
      const enrollment=await enrollPhoneDevice(request,input);
      const response=result({ok:true});
      response.cookies.set(PHONE_DEVICE_COOKIE,enrollment.token,{
        httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",
        path:"/api/ops/voice-phone",maxAge:PHONE_DEVICE_SECONDS,expires:new Date(enrollment.expiresAt),
      });
      return response;
    }
    if(input.action==="mobile_receiving"){await setMobileReceiving(input);return result({ok:true});}
    if(input.action==="presence"){await updatePhonePresence(input);return result({ok:true});}
    if(input.action==="logout"){
      await revokeCurrentPhoneDevice();
      const response=result({ok:true});
      response.cookies.set(PHONE_DEVICE_COOKIE,"",{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:"/api/ops/voice-phone",maxAge:0});
      return response;
    }
    return result({ok:false,error:"unknown_phone_action"},422);
  } catch(error) { return voiceCopilotApiFailure(error,"phone_identity_change"); }
}
