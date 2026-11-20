import {NextRequest,NextResponse} from "next/server";
import {authorizeVoiceCopilotApi,readVoiceCopilotJson,voiceCopilotApiFailure} from "@/lib/ops/voice-copilot-api";
import {phoneRequestIsSameOrigin} from "@/lib/ops/voice-phone-contract";
import {currentPhoneDevice} from "@/lib/ops/voice-phone-identity";
import {requireVoiceUuid} from "@/lib/ops/voice-platform-contract";
import {customerPhone,customerPhones} from "@/lib/ops/voice-customer-phones";
import {supabaseRequest,supabaseRpc,SupabaseRestError} from "@/lib/quotes/supabase-rest";
import {QuoteValidationError} from "@/lib/quotes/validation";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest){
 const denied=await authorizeVoiceCopilotApi(request);if(denied)return denied;
 try{
  if(!phoneRequestIsSameOrigin(request.headers.get("origin"),request.headers.get("x-forwarded-host")||request.headers.get("host"),request.headers.get("sec-fetch-site"),process.env.NODE_ENV==="production"))
   throw new QuoteValidationError("Diese Aktion ist nicht erlaubt.",["invalid_phone_origin"],403);
  const current=await currentPhoneDevice();
  if(!current)throw new QuoteValidationError("Melde dein Telefonprofil an.",["phone_identity_required"],403);
  const input=await readVoiceCopilotJson(request);
  if(!input||Array.isArray(input)||typeof input!=="object")throw new QuoteValidationError("Ungültige Eingabe.",["invalid_payload"],422);
  const id=requireVoiceUuid(input.customerId,"Kunde"),phone=customerPhone(input.phone,input.country ?? "DE");
  const [customer]=await supabaseRequest<Array<{id:string;phone:string|null}>>("master_customers",{},{select:"id,phone",id:"eq."+id,limit:1});
  if(!customer)throw new QuoteValidationError("Kunde nicht gefunden.",["customer_not_found"],404);
  try {
   await supabaseRpc("add_voice_customer_phone_v1",{p_customer_id:id,p_phone:phone,p_actor:current.staff.id});
  } catch(error) {
   if(error instanceof SupabaseRestError && String(error.details).includes("contact_limit_reached"))
    throw new QuoteValidationError("Maximal zehn zusätzliche Telefonnummern. Bearbeite die vorhandenen Nummern über den Stift.",["contact_limit"],422);
   throw error;
  }
  return NextResponse.json({ok:true,phone,phoneNumbers:await customerPhones(id,customer.phone)},{headers:{"cache-control":"no-store"}});
 }catch(error){return voiceCopilotApiFailure(error,"customer-phone-add");}
}
