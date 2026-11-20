import {NextRequest,NextResponse} from "next/server";
import {authorizeVoiceCopilotApi,voiceCopilotApiFailure} from "@/lib/ops/voice-copilot-api";
import {requireVoiceUuid} from "@/lib/ops/voice-platform-contract";
import {listVoiceDirectory} from "@/lib/ops/voice-directory";
import {loadOrganizationOrders,organizationOrderScope} from "@/lib/ops/voice-organization-orders";
import {supabaseRpc} from "@/lib/quotes/supabase-rest";
import type {CustomerOrderMembership} from "@/lib/ops/voice-organization-orders";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest){
 const denied=await authorizeVoiceCopilotApi(request);if(denied)return denied;
 try{
  const id=requireVoiceUuid(request.nextUrl.searchParams.get("customerId"),"Kunde");
  const {results}=await listVoiceDirectory("",0,id);
  const customer=results.find(row=>row.customerId===id);
  if(!customer)return NextResponse.json({error:"Kunde nicht gefunden."},{status:404});
  if(!customer.email || !organizationOrderScope(customer.email))return NextResponse.json({unavailable:"Für die Zuordnung fehlt eine gültige E-Mail-Adresse."},{headers:{"cache-control":"no-store"}});
  const membership=await supabaseRpc<CustomerOrderMembership|null>("voice_customer_order_members_v1",{p_customer_id:id,p_tenant_id:"a0000000-0000-0000-0000-000000000001"});
  if(!membership) return NextResponse.json({error:"Kunde nicht gefunden."},{status:404});
  const data=await loadOrganizationOrders(customer.email,membership);
  return NextResponse.json(data,{headers:{"cache-control":"no-store"}});
 }catch(error){return voiceCopilotApiFailure(error,"organization-orders");}
}
