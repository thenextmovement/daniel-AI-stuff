import { supabaseRequest, supabaseRpc } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";
import { deliveryIdempotencyKey, emailDomain, findOrganizationByEmail, nextDeliveryState, normalizeEmail, validateOfferExtraction, type DeliveryStatus } from "./eu-supplier-quotes";

type OrgRow = { id:string; name:string; canonical_domain:string; email_domains:string[]; contact_emails:string[]; website_url:string|null; country_code:string|null; research:Record<string,unknown> };
type RequestRow = { id:string; correlation_id:string; trello_card_id:string; trello_card_url:string; trello_card_name:string; request_snapshot:Record<string,unknown>; status:string; selected_organization_id:string|null; selected_by:string|null; selected_at:string|null; selection_note:string|null; created_at:string };
type DeliveryRow = { id:string; request_id:string; organization_id:string; recipient_email:string; status:DeliveryStatus; attempt_count:number; provider_message_id?:string|null; provider_conversation_id?:string|null; sent_at:string|null; failed_at:string|null; alert_status:string; last_error_summary:string|null };
type ReplyRow = { id:string; request_id:string|null; organization_id:string|null; sender_email:string; sender_domain:string; received_at:string; subject:string|null; match_status:string; extraction_status:string };
type OfferRow = { id:string; request_id:string; organization_id:string; currency:string|null; unit_price:number|null; total_price:number|null; shipping_cost:number|null; production_days_min:number|null; production_days_max:number|null; shipping_days_min:number|null; shipping_days_max:number|null; valid_until:string|null; confidence:number|null; review_status:string };

function required(value: unknown, field: string) {
  const text = String(value || "").trim();
  if (!text) throw new QuoteValidationError(`${field} fehlt.`, [field], 400);
  return text;
}
function graphIdentifier(value:unknown,field:string){
 const text=required(value,field);
 if(text.length>500||!/^[A-Za-z0-9+/_=.:-]+$/.test(text))throw new QuoteValidationError(`${field} ist ungueltig.`,[field],400);
 return text;
}
function mapOrg(row: OrgRow) { return { id:row.id,name:row.name,canonicalDomain:row.canonical_domain,emailDomains:row.email_domains||[],contactEmails:row.contact_emails||[],websiteUrl:row.website_url,countryCode:row.country_code,research:row.research||{} }; }
export async function listOrganizations() {
  const rows = await supabaseRequest<OrgRow[]>("eu_supplier_organizations", undefined, { select:"*", active:"eq.true", order:"name.asc" });
  return rows.map(mapOrg);
}
export async function listEuSupplierBoard() {
  const [requests,organizations,deliveries,replies,offers] = await Promise.all([
    supabaseRequest<RequestRow[]>("eu_supplier_requests",undefined,{select:"*",order:"created_at.desc",limit:100}),
    listOrganizations(),
    supabaseRequest<DeliveryRow[]>("eu_supplier_deliveries",undefined,{select:"*",order:"created_at.asc",limit:1000}),
    supabaseRequest<ReplyRow[]>("eu_supplier_replies",undefined,{select:"*",order:"received_at.desc",limit:1000}),
    supabaseRequest<OfferRow[]>("eu_supplier_offers",undefined,{select:"*",order:"created_at.desc",limit:1000}),
  ]);
  return { organizations, items:requests.map((request)=>({
    ...request, deliveries:deliveries.filter((item)=>item.request_id===request.id),
    replies:replies.filter((item)=>item.request_id===request.id), offers:offers.filter((item)=>item.request_id===request.id),
  })) };
}
export async function upsertRequest(input: {trelloCardId?:unknown;trelloCardUrl?:unknown;trelloCardName?:unknown;sourceListId?:unknown;snapshot?:unknown}) {
  const body={trello_card_id:required(input.trelloCardId,"trelloCardId"),trello_card_url:required(input.trelloCardUrl,"trelloCardUrl"),trello_card_name:required(input.trelloCardName,"trelloCardName"),source_list_id:String(input.sourceListId||"")||null,request_snapshot:input.snapshot&&typeof input.snapshot==="object"?input.snapshot:{}};
  const rows=await supabaseRequest<RequestRow[]>("eu_supplier_requests",{method:"POST",body:JSON.stringify(body),headers:{Prefer:"resolution=merge-duplicates,return=representation"}},{on_conflict:"trello_card_id"});
  return rows[0];
}
export async function queueDeliveries(requestId: string, organizationIds?: string[]) {
  const organizations=(await listOrganizations()).filter((org)=>!organizationIds?.length||organizationIds.includes(org.id));
  const entries=organizations.flatMap((org)=>org.contactEmails.map((email)=>({request_id:required(requestId,"requestId"),organization_id:org.id,recipient_email:normalizeEmail(email),idempotency_key:deliveryIdempotencyKey(requestId,email)})));
  if (!entries.length) throw new QuoteValidationError("Keine Supplier-Empfaenger konfiguriert.",["organizations"],409);
  return supabaseRequest<DeliveryRow[]>("eu_supplier_deliveries",{method:"POST",body:JSON.stringify(entries),headers:{Prefer:"resolution=ignore-duplicates,return=representation"}},{on_conflict:"idempotency_key"});
}
export async function recordDeliveryOutcome(input:{deliveryId?:unknown;outcome?:"sent"|"retryable_failure"|"terminal_failure";providerMessageId?:unknown;providerConversationId?:unknown;errorCode?:unknown;errorSummary?:unknown;workflowExecutionId?:unknown}) {
  const id=required(input.deliveryId,"deliveryId");
  const rows=await supabaseRequest<DeliveryRow[]>("eu_supplier_deliveries",undefined,{select:"*",id:`eq.${id}`,limit:1});
  const current=rows[0]; if(!current) throw new QuoteValidationError("Versanddatensatz nicht gefunden.",["deliveryId"],404);
  const attemptCount=current.attempt_count; const transition=nextDeliveryState({current:current.status,attemptCount,outcome:input.outcome||"terminal_failure"});
  const providerMessageId=input.providerMessageId?graphIdentifier(input.providerMessageId,"providerMessageId"):current.provider_message_id||null;
  const providerConversationId=input.providerConversationId?graphIdentifier(input.providerConversationId,"providerConversationId"):current.provider_conversation_id||null;
  const now=new Date().toISOString(); const patch={status:transition.status,attempt_count:attemptCount,provider_message_id:providerMessageId,provider_conversation_id:providerConversationId,last_error_code:String(input.errorCode||"")||null,last_error_summary:String(input.errorSummary||"").slice(0,500)||null,workflow_execution_id:String(input.workflowExecutionId||"")||null,sent_at:transition.status==="sent"?now:current.sent_at,failed_at:transition.status==="failed"?now:null,next_attempt_at:transition.status==="retry_wait"?new Date(Date.now()+Math.min(15*60_000,30_000*2**attemptCount)).toISOString():null,alert_status:transition.shouldAlert?"pending":current.alert_status,alert_idempotency_key:transition.shouldAlert?`eu-supplier-mail-failed:v1:${id}`:null,updated_at:now};
  const updated=await supabaseRequest<DeliveryRow[]>("eu_supplier_deliveries",{method:"PATCH",body:JSON.stringify(patch),headers:{Prefer:"return=representation"}},{id:`eq.${id}`});
  return {...updated[0],shouldAlert:transition.shouldAlert,alertSubject:transition.shouldAlert?"EU Supplier Mail fehlgeschlagen":null};
}
export async function recordDeliveryDraft(input:{deliveryId?:unknown;providerMessageId?:unknown;providerConversationId?:unknown;workflowExecutionId?:unknown}){
 const id=required(input.deliveryId,"deliveryId");
 const rows=await supabaseRequest<DeliveryRow[]>("eu_supplier_deliveries",{method:"PATCH",body:JSON.stringify({provider_message_id:graphIdentifier(input.providerMessageId,"providerMessageId"),provider_conversation_id:graphIdentifier(input.providerConversationId,"providerConversationId"),workflow_execution_id:String(input.workflowExecutionId||"").slice(0,200)||null,updated_at:new Date().toISOString()}),headers:{Prefer:"return=representation"}},{id:`eq.${id}`,status:"eq.sending",provider_message_id:"is.null"});
 if(!rows[0])throw new QuoteValidationError("Graph-Entwurf konnte nicht eindeutig gespeichert werden.",["deliveryId"],409);
 return rows[0];
}
export async function ingestReply(input:{internetMessageId?:unknown;conversationId?:unknown;senderEmail?:unknown;receivedAt?:unknown;subject?:unknown;bodyExcerpt?:unknown;attachments?:unknown;requestId?:unknown;extraction?:unknown}) {
  const organizations=await listOrganizations(); const senderEmail=normalizeEmail(input.senderEmail); const match=findOrganizationByEmail(organizations,senderEmail);
  const conversationId=input.conversationId?graphIdentifier(input.conversationId,"conversationId"):null;
  const matchedDeliveries=conversationId?await supabaseRequest<Array<{request_id:string}>>("eu_supplier_deliveries",undefined,{select:"request_id",provider_conversation_id:`eq.${conversationId}`,status:"eq.sent",limit:2}):[];
  const requestId=matchedDeliveries.length===1?matchedDeliveries[0].request_id:null; const extraction=input.extraction===undefined?null:validateOfferExtraction(input.extraction);
  const replyRows=await supabaseRequest<Array<{id:string}>>("eu_supplier_replies",{method:"POST",body:JSON.stringify({internet_message_id:required(input.internetMessageId,"internetMessageId"),conversation_id:conversationId,sender_email:senderEmail,sender_domain:emailDomain(senderEmail),received_at:required(input.receivedAt,"receivedAt"),subject:String(input.subject||"").slice(0,500)||null,body_excerpt:String(input.bodyExcerpt||"").slice(0,2000)||null,attachment_manifest:Array.isArray(input.attachments)?input.attachments:[],request_id:requestId,organization_id:match.organization?.id||null,match_status:match.matchStatus,extraction_status:extraction&&requestId&&match.organization?(extraction.confidence>=0.8?"validated":"needs_review"):"pending",extraction_confidence:extraction?.confidence??null,raw_extraction:extraction}),headers:{Prefer:"resolution=ignore-duplicates,return=representation"}},{on_conflict:"internet_message_id"});
  if(extraction&&requestId&&match.organization&&replyRows[0]) await supabaseRequest("eu_supplier_offers",{method:"POST",body:JSON.stringify({request_id:requestId,organization_id:match.organization.id,reply_id:replyRows[0].id,currency:extraction.currency,unit_price:extraction.unit_price,total_price:extraction.total_price,shipping_cost:extraction.shipping_cost,production_days_min:extraction.production_days_min,production_days_max:extraction.production_days_max,shipping_days_min:extraction.shipping_days_min,shipping_days_max:extraction.shipping_days_max,valid_until:extraction.valid_until,stated_terms:{evidence:extraction.evidence},confidence:extraction.confidence,review_status:extraction.confidence>=0.8?"verified":"needs_review"}),headers:{Prefer:"return=minimal"}});
  return {replyId:replyRows[0]?.id||null,organization:match.organization,matchStatus:match.matchStatus};
}
export async function selectOrganization(input:{requestId?:unknown;organizationId?:unknown;operatorName?:unknown;note?:unknown}) {
  const requestId=required(input.requestId,"requestId"),organizationId=required(input.organizationId,"organizationId"),operatorName=required(input.operatorName,"operatorName");
  const rows=await supabaseRequest<RequestRow[]>("eu_supplier_requests",{method:"PATCH",body:JSON.stringify({status:"selected",selected_organization_id:organizationId,selected_by:operatorName,selected_at:new Date().toISOString(),selection_note:String(input.note||"").slice(0,1000)||null,updated_at:new Date().toISOString()}),headers:{Prefer:"return=representation"}},{id:`eq.${requestId}`,status:"in.(collecting,ready,needs_review,selected)"});
  if(!rows[0]) throw new QuoteValidationError("Anfrage konnte nicht ausgewaehlt werden.",["requestId"],409); return rows[0];
}
async function enrichDelivery(row:DeliveryRow|null){
 if(!row)return null;
 const [requests,organizations]=await Promise.all([
  supabaseRequest<RequestRow[]>("eu_supplier_requests",undefined,{select:"*",id:`eq.${row.request_id}`,limit:1}),
  supabaseRequest<OrgRow[]>("eu_supplier_organizations",undefined,{select:"*",id:`eq.${row.organization_id}`,limit:1}),
 ]);
 return {...row,request:requests[0]||null,organization:organizations[0]?mapOrg(organizations[0]):null};
}
export async function claimDelivery(worker:unknown){return enrichDelivery((await supabaseRpc<DeliveryRow[]>("claim_eu_supplier_delivery",{p_worker:required(worker,"worker")}))[0]||null);}
export async function claimFailureAlert(worker:unknown){return enrichDelivery((await supabaseRpc<DeliveryRow[]>("claim_eu_supplier_failure_alert",{p_worker:required(worker,"worker")}))[0]||null);}
export async function recordAlertOutcome(input:{deliveryId?:unknown;success?:unknown;errorSummary?:unknown}){
 const rows=await supabaseRpc<DeliveryRow[]>("record_eu_supplier_alert_result",{
  p_delivery_id:required(input.deliveryId,"deliveryId"),
  p_success:input.success===true,
  p_error:String(input.errorSummary||"").slice(0,500)||null,
 });
 if(!rows[0])throw new QuoteValidationError("Warnmail-Ergebnis konnte nicht gespeichert werden.",["deliveryId"],409);
 return rows[0];
}
