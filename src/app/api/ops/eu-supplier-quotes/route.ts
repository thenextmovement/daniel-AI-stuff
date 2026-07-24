import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { claimDelivery, claimFailureAlert, ingestReply, listEuSupplierBoard, queueDeliveries, recordAlertOutcome, recordDeliveryDraft, recordDeliveryOutcome, reserveReply, selectOrganization, upsertRequest } from "@/lib/ops/eu-supplier-store";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";
export const dynamic="force-dynamic";
const MAX_BYTES=2_000_000, WINDOW_MS=10*60*1000;
function host(request:NextRequest){return request.headers.get("x-forwarded-host")||request.headers.get("host");}
function safeEqual(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
function automationSecret(){return String(process.env.EU_SUPPLIER_WEBHOOK_SECRET||"").trim();}
function verifyAutomation(request:NextRequest,raw:string){
  const secret=automationSecret(),signature=String(request.headers.get("x-neontrip-signature")||""),timestamp=String(request.headers.get("x-neontrip-timestamp")||"");
  const millis=Number(timestamp)*1000;if(!secret||!signature||!timestamp||!Number.isFinite(millis)||Math.abs(Date.now()-millis)>WINDOW_MS)return false;
  return safeEqual(signature,`sha256=${createHmac("sha256",secret).update(`${timestamp}.${raw}`).digest("hex")}`);
}
async function opsAccess(request:NextRequest){
  const value=host(request);if(!isOpsPortalConfigured(value))return false;
  return isOpsPortalBypassed(value)||hasOpsSession(value,request.headers);
}
function failure(error:unknown){
  if(error instanceof QuoteValidationError)return NextResponse.json({ok:false,error:error.message,issues:error.issues},{status:error.status});
  if(error instanceof SupabaseRestError){console.error("eu supplier database error",{status:error.status});return NextResponse.json({ok:false,error:"supplier_data_unavailable"},{status:error.status});}
  console.error("eu supplier route error",error);return NextResponse.json({ok:false,error:"internal_error"},{status:500});
}
export async function GET(request:NextRequest){
  if(!(await opsAccess(request)))return NextResponse.json({ok:false,error:"unauthorized"},{status:401});
  try{return NextResponse.json({ok:true,board:await listEuSupplierBoard()},{headers:{"Cache-Control":"no-store"}});}catch(error){return failure(error);}
}
export async function POST(request:NextRequest){
  const raw=await request.text();if(raw.length>MAX_BYTES)return NextResponse.json({ok:false,error:"payload_too_large"},{status:413});
  let body:Record<string,unknown>;try{body=JSON.parse(raw||"{}");}catch{return NextResponse.json({ok:false,error:"invalid_json"},{status:400});}
  const action=String(body.action||"");
  const automationActions=new Set(["upsert_request","queue_deliveries","claim_delivery","delivery_draft_created","delivery_outcome","reserve_reply","ingest_reply","claim_failure_alert","alert_outcome"]);
  const allowed=automationActions.has(action)?verifyAutomation(request,raw):await opsAccess(request);
  if(!allowed)return NextResponse.json({ok:false,error:"unauthorized"},{status:401});
  try{
    if(action==="upsert_request")return NextResponse.json({ok:true,request:await upsertRequest(body)});
    if(action==="queue_deliveries")return NextResponse.json({ok:true,deliveries:await queueDeliveries(String(body.requestId||""),Array.isArray(body.organizationIds)?body.organizationIds.map(String):undefined)});
    if(action==="claim_delivery")return NextResponse.json({ok:true,delivery:await claimDelivery(body.worker)});
    if(action==="delivery_draft_created")return NextResponse.json({ok:true,delivery:await recordDeliveryDraft(body)});
    if(action==="delivery_outcome")return NextResponse.json({ok:true,delivery:await recordDeliveryOutcome(body)});
    if(action==="reserve_reply")return NextResponse.json({ok:true,...await reserveReply(body)});
    if(action==="ingest_reply")return NextResponse.json({ok:true,reply:await ingestReply(body)});
    if(action==="claim_failure_alert")return NextResponse.json({ok:true,delivery:await claimFailureAlert(body.worker)});
    if(action==="alert_outcome")return NextResponse.json({ok:true,delivery:await recordAlertOutcome(body)});
    if(action==="select_organization")return NextResponse.json({ok:true,request:await selectOrganization(body)});
    return NextResponse.json({ok:false,error:"unsupported_action"},{status:400});
  }catch(error){return failure(error);}
}
