import {NextRequest,NextResponse} from "next/server";
import {authorizeVoiceCopilotApi,readVoiceCopilotJson,voiceCopilotApiFailure} from "@/lib/ops/voice-copilot-api";
import {phoneRequestIsSameOrigin} from "@/lib/ops/voice-phone-contract";
import {currentPhoneDevice} from "@/lib/ops/voice-phone-identity";
import {requireVoiceUuid} from "@/lib/ops/voice-platform-contract";
import {loadVoiceContextRecord} from "@/lib/ops/voice-context-record";
import {supabaseRequest} from "@/lib/quotes/supabase-rest";
import {QuoteValidationError} from "@/lib/quotes/validation";
import {customerLink,customerLinkBoards,type CustomerLinkKind} from "@/lib/ops/voice-customer-links";
import {getTrelloCardLocation} from "@/lib/quotes/trello";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest){
 const denied=await authorizeVoiceCopilotApi(request);if(denied)return denied;
 try{
  const id=requireVoiceUuid(request.nextUrl.searchParams.get("customerId"),"Kunde"),ref=request.nextUrl.searchParams.get("requestId")||"";
  const record=await loadVoiceContextRecord(ref,id);
  const saved=await supabaseRequest<Array<{kind:CustomerLinkKind;url:string}>>("voice_customer_links",{},{select:"kind,url",customer_id:"eq."+id,request_id:"eq."+ref});
  const links:Partial<Record<CustomerLinkKind,string>>={};
  let incomplete=false;
  const aliases=await supabaseRequest<Array<{alias_trello_card_id:string}>>("trello_card_aliases",{signal:AbortSignal.timeout(3000)},{select:"alias_trello_card_id",request_id:"eq."+ref,limit:20}).catch(()=>{incomplete=true;return [];});
  const ids=[...new Set([record.request.trelloCardId,...aliases.map(x=>x.alias_trello_card_id)].filter((x):x is string=>!!x))];
  const cards=await Promise.allSettled(ids.map(getTrelloCardLocation));
  for(const result of cards)if(result.status==="fulfilled"){
   const card=result.value;
   for(const [kind,board]of Object.entries(customerLinkBoards))if(card.idBoard===board)links[kind as CustomerLinkKind]=card.url;
  }
  if(cards.some(result=>result.status==="rejected"))incomplete=true;
  for(const row of saved)links[row.kind]=customerLink(row.url,row.kind);
  return NextResponse.json({links,incomplete},{headers:{"cache-control":"no-store"}});
 }catch(e){return voiceCopilotApiFailure(e,"customer-links");}
}
export async function POST(request:NextRequest){
 const denied=await authorizeVoiceCopilotApi(request);if(denied)return denied;
 try{
  if(!phoneRequestIsSameOrigin(request.headers.get("origin"),request.headers.get("x-forwarded-host")||request.headers.get("host"),request.headers.get("sec-fetch-site"),process.env.NODE_ENV==="production"))
   throw new QuoteValidationError("Diese Aktion ist nicht erlaubt.",["invalid_phone_origin"],403);
  const current=await currentPhoneDevice();if(!current)throw new QuoteValidationError("Melde dein Telefonprofil an.",["phone_identity_required"],403);
  const input=await readVoiceCopilotJson(request);
  if(!input||Array.isArray(input)||typeof input!=="object")throw new QuoteValidationError("Ungültige Eingabe.",["invalid_payload"],422);
  const id=requireVoiceUuid(input.customerId,"Kunde");
  if(typeof input.requestId!=="string")throw new QuoteValidationError("Wähle einen Vorgang.",["invalid_request"],422);
  await loadVoiceContextRecord(input.requestId,id);
  if(typeof input.kind!=="string"||!["quentin","inquiry","offer"].includes(input.kind))throw new QuoteValidationError("Ungültige Verknüpfung.",["invalid_link_kind"],422);
  const kind=input.kind as CustomerLinkKind,url=customerLink(input.url,kind);
  if(kind!=="offer"){
   const card=await getTrelloCardLocation(new URL(url).pathname.split("/")[2]);
   if(card.idBoard!==customerLinkBoards[kind])throw new QuoteValidationError("Diese Karte liegt nicht auf dem ausgewählten Board.",["wrong_trello_board"],422);
  }
  await supabaseRequest("voice_customer_links",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({customer_id:id,request_id:input.requestId,kind,url,updated_by:current.staff.id,updated_at:new Date().toISOString()})},{on_conflict:"customer_id,request_id,kind"});
  return NextResponse.json({kind,url});
 }catch(e){return voiceCopilotApiFailure(e,"customer-link-save");}
}
