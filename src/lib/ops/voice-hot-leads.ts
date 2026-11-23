import {supabaseRequest,supabaseRpc,SupabaseRestError} from "@/lib/quotes/supabase-rest";
import {QuoteValidationError} from "@/lib/quotes/validation";
import {requireVoiceUuid} from "./voice-platform-contract";
import {berlinDate,shiftLeadDate,leadQueue,contactSegment,type HotLeadState,type LeadStage,type LeadProgress} from "./voice-hot-lead-rules";
import type {VoiceDirectoryContact} from "./voice-directory";
type Offer={id:string;trelloCardId:string|null;offerNumber:string|null;status:string;totalGross:number;currency:string;createdAt:string;sentAt:string|null;viewedAt:string|null;closed:boolean;priority?:{score:number;level:string;label:string;detail:string}|null};
type Candidate={stage?:LeadStage|null;due_at?:string|null;outcomes?:LeadProgress["outcomes"];offer_ids?:string[];id:string;request_id:string;customer_id:string;trello_card_id:string|null;title:string|null;created_at:string;status:string;deal_status:string|null;name:string|null;company:string|null;company_name:string|null;email:string|null;phone:string|null;additional_phones:string[];estimated_amount:number|null;list_status:LeadProgress["status"];source_at:string|null;handled_at:string|null;due_date:string|null;revision:number;last_confirmed_call:string|null;blocked:boolean;callback_at:string|null};
export type VoiceHotLead=VoiceDirectoryContact & {firstSentAt:string|null;stage:LeadStage;indicators:ReturnType<typeof leadQueue>["indicators"];overdueDays:number;needsPlanning:boolean;dueAt:string|null;listStatus:LeadProgress["status"];score:Offer["priority"]|null;capturedAt:string;canSchedule:boolean;id:string;amount:number|null;currency:string;segment:"B2B"|"Privat"|null;sourceAt:string;offerNumber:string|null;reasons:string[];priority:number;revision:number;dueDate:string|null};
const invalid=(message:string)=>new QuoteValidationError(message,["invalid_hot_lead"],422);
async function candidates(filter:Record<string,string>){
 const all:Candidate[]=[];
 for(let offset=0;offset<10000;offset+=500){
  const page=await supabaseRequest<Candidate[]>("voice_hot_lead_candidates",{signal:AbortSignal.timeout(15000)},{select:"*",...filter,order:"id.asc",offset,limit:500});
  if(!Array.isArray(page))throw Error("Invalid lead response");
  all.push(...page);if(page.length<500)return all;
 }
 throw Error("Lead result exceeds safe paging limit");
}
async function offers(filter:{since:string}|{cardIds:string}|{ids:string}){
 const base=process.env.NEONTRIP_OFFERS_BASE_URL?.replace(/\/+$/,"");
 const key=process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY;
 if(!base||!key)throw Error("Offers connection unavailable");
 const all:Offer[]=[];let cursor:string|null=null;
 for(let page=0;page<100;page++){
  const query=new URLSearchParams({...filter,...(cursor?{cursor}:{})});
  const response=await fetch(base+"/api/internal/offers/voice-leads?"+query,{cache:"no-store",headers:{Authorization:"Bearer "+key},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error("Offers feed unavailable");
  const data=await response.json() as {results:Offer[];nextCursor:string|null};
  if(!Array.isArray(data.results)||data.results.some(x=>! /^[a-zA-Z0-9_-]{1,100}$/.test(x.id)|| (x.trelloCardId!==null&&!/^[a-f0-9]{24}(?::special:[0-9]{13})?$/.test(x.trelloCardId)) || !/^[A-Z]{3}$/.test(x.currency)||!Number.isFinite(x.totalGross)||!Number.isFinite(Date.parse(x.createdAt))||(x.sentAt!==null&&!Number.isFinite(Date.parse(x.sentAt)))||(x.priority!=null&&(!Number.isFinite(x.priority.score)||x.priority.score<0||x.priority.score>100||typeof x.priority.level!=="string"||typeof x.priority.label!=="string"))))throw Error("Invalid offers feed");
  all.push(...data.results);if(!data.nextCursor)return all;
  if(data.nextCursor===cursor)throw Error("Invalid offer cursor");cursor=data.nextCursor;
 }
 throw Error("Offers feed exceeds safe paging limit");
}
async function offersForRows(rows:Candidate[]){
 const cards=[...new Set(rows.flatMap(r=>r.trello_card_id?[r.trello_card_id]:[]))].filter(x=>/^[a-f0-9]{24}$/.test(x));
 const ids=[...new Set(rows.flatMap(r=>r.offer_ids||[]))].filter(x=>/^[a-zA-Z0-9_-]{1,100}$/.test(x));
 const all:Offer[]=[];
 for(let i=0;i<cards.length;i+=100)all.push(...await offers({cardIds:cards.slice(i,i+100).join(",")}));
 const missing=ids.filter(id=>!all.some(o=>o.id===id));
 for(let i=0;i<missing.length;i+=100)all.push(...await offers({ids:missing.slice(i,i+100).join(",")}));
 return [...new Map(all.map(o=>[o.id,o])).values()];
}
function rowOffer(row:Candidate,all:Offer[]){
 const matching=all.filter(o=>row.offer_ids?.includes(o.id)||(row.trello_card_id&&o.trelloCardId===row.trello_card_id));
 const chosen=matching.sort((a,b)=>Number(b.closed)-Number(a.closed)||Date.parse(b.createdAt)-Date.parse(a.createdAt))[0];
 if(!chosen)return undefined;
 const firstSent=matching.flatMap(o=>o.sentAt?[o.sentAt]:[]).sort((a,b)=>Date.parse(a)-Date.parse(b))[0]??null;
 return {...chosen,sentAt:firstSent};
}
function toLead(row:Candidate,offer:Offer|undefined,now=new Date()):VoiceHotLead{
 const queue=queueFor(row,offer,now);
 const sourceAt=[row.created_at,offer?.createdAt,offer?.sentAt].filter((x):x is string=>Boolean(x)).sort((a,b)=>Date.parse(b)-Date.parse(a))[0];
 const phones=[...new Set([row.phone,...(row.additional_phones||[])].filter((p):p is string=>Boolean(p)))];
 const reasons=[...(row.due_date?["Wiedervorlage"]:[]),...(offer?.viewedAt?["Angebot angesehen"]:offer?["Angebot erstellt"]:["Neue Anfrage"])];
 return {...queue,firstSentAt:offer?.sentAt??null,score:offer?.priority??null,listStatus:row.list_status,capturedAt:now.toISOString(),canSchedule:!row.blocked&&!offer?.closed&&!["won","lost","closed","duplicate_closed","internal_test","legacy_ghost"].includes(row.status)&&!["won","lost","closed"].includes(row.deal_status||""),id:row.id,customerId:row.customer_id,requestId:row.request_id,displayName:row.name,company:row.company||row.company_name,email:row.email,phone:phones[0]||null,phoneNumbers:phones,requestTitle:row.title,requestCreatedAt:row.created_at,amount:offer?.totalGross??(row.estimated_amount==null?null:Number(row.estimated_amount)),currency:offer?.currency||"EUR",segment:contactSegment(row.email),sourceAt,offerNumber:offer?.offerNumber||null,reasons,priority:(row.due_date?100:0)+(offer?.viewedAt?40:offer?25:10),revision:row.revision,dueDate:queue.dueDate};
}
function queueFor(row:Candidate,offer:Offer|undefined,now:Date){
 return leadQueue(row.created_at,offer?.sentAt??null,{status:row.list_status,stage:row.stage??null,dueDate:row.due_date,dueAt:row.due_at??null,outcomes:row.outcomes??{},handledAt:row.handled_at},row.callback_at,now);
}
export async function listVoiceHotLeads(filter:string,sort:string,offset:number,now=new Date(),status="all",score="all",age="all"){
 if(!["all","1","3","5","7","14","30","60","90"].includes(age)||!["today","recent"].includes(filter)||!["priority","amount","newest","overdue"].includes(sort)||!Number.isSafeInteger(offset)||offset<0||offset>10000||!["all","inquiry","offer","reminder"].includes(status)||!["all","very_hot","hot","warm_plus","warm","cold","low_intent","problem","paused","unknown"].includes(score))throw invalid("Ungültiger Listenfilter.");
 const today=berlinDate(now);
 // Fixed rollout baseline: preserve the existing three-week workset, never age out its overdue items.
 const since="2026-11-02T00:00:00+01:00";
 const rows=await candidates({or:`(created_at.gte.${since},list_status.not.is.null)`});
 const recentOffers=await offers({since});
 const cards=[...new Set(recentOffers.flatMap(o=>o.trelloCardId&&/^[a-f0-9]{24}$/.test(o.trelloCardId)?[o.trelloCardId]:[]))];
 for(let i=0;i<cards.length;i+=100)rows.push(...await candidates({trello_card_id:"in.("+cards.slice(i,i+100).join(",")+")"}));
 const ids=recentOffers.map(o=>o.id);
 for(let i=0;i<ids.length;i+=100)rows.push(...await candidates({offer_ids:"ov.{"+ids.slice(i,i+100).join(",")+"}"}));
 const unique=[...new Map(rows.map(r=>[r.id,r])).values()].filter(r=>!r.blocked&&!["ignored","no_followup"].includes(r.list_status||"")&&!["won","lost","closed","duplicate_closed","internal_test","legacy_ghost"].includes(r.status));
 const allOffers=await offersForRows(unique);
 const results=unique.flatMap(row=>{
  const offer=rowOffer(row,allOffers),lead=toLead(row,offer,now);
  if(!lead.canSchedule||!row.request_id||!queueFor(row,offer,now).visible)return [];
  // Historical reached entries have no reliable stage: preserve dismissal without inventing outcomes.
  if(row.list_status==='reached'&&!row.stage&&row.source_at&&Date.parse(lead.sourceAt)<=Date.parse(row.source_at))return [];
  if(status!=="all"&&lead.stage!==({inquiry:1,offer:2,reminder:3} as Record<string,number>)[status])return [];
  if(score!=="all"&&(lead.score?.level??"unknown")!==score)return [];
  if(age!=="all"){
   const elapsed=lead.firstSentAt?now.getTime()-Date.parse(lead.firstSentAt):NaN;
   if(!Number.isFinite(elapsed)||elapsed<0||elapsed>Number(age)*86400000)return [];
  }
  lead.reasons=[lead.stage===1?"Anfrage eingegangen":lead.stage===2?"Erstes Angebot gesendet":"Reminder",...(lead.needsPlanning?["Nachfassen noch planen"]:[])];
  return [lead];
 });
 results.sort((a,b)=>(sort==="amount"?(b.currency==="EUR"?b.amount??-1:-1)-(a.currency==="EUR"?a.amount??-1:-1):sort==="priority"?(b.score?.score??-1)-(a.score?.score??-1):sort==="overdue"?b.overdueDays-a.overdueDays:Date.parse(b.sourceAt)-Date.parse(a.sourceAt))||b.overdueDays-a.overdueDays||a.id.localeCompare(b.id));
 return {results:results.slice(offset,offset+30),nextOffset:results.length>offset+30?offset+30:null,total:results.length,today};
}
export async function voiceDirectoryAmounts(customerIds:string[]){
 if(customerIds.length>100)throw invalid("Zu viele Kontakte.");
 const ids=customerIds.map(id=>requireVoiceUuid(id,"Kunde"));
 if(!ids.length)return {results:[]};
 const rows=await candidates({customer_id:"in.("+ids.join(",")+")"});
 const allOffers=await offersForRows(rows);
 return {results:rows.map(r=>toLead(r,rowOffer(r,allOffers))).sort((a,b)=>Date.parse(b.sourceAt)-Date.parse(a.sourceAt))};
}
export async function saveVoiceHotLead(input:Record<string,unknown>){
 const requestId=requireVoiceUuid(input.id,"Anfrage"),customerId=requireVoiceUuid(input.customerId,"Kunde");
 if(!["ignored","reached","scheduled","not_reached","no_followup","active"].includes(String(input.status))||!Number.isSafeInteger(input.revision)||Number(input.revision)<0)throw invalid("Ungültiger Listenstatus.");
 if(typeof input.sourceAt!=="string"||!Number.isFinite(Date.parse(input.sourceAt))||Date.parse(input.sourceAt)>Date.now()+60000)throw invalid("Ungültiger Anfragestand.");
 let dueDate:null|string=null;
 if(input.status==="scheduled"){
  try{if(typeof input.dueDate!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate))throw Error();dueDate=shiftLeadDate(input.dueDate,0);}catch{throw invalid("Bitte ein gültiges Datum wählen.");}
  if(dueDate<berlinDate())throw invalid("Das Datum darf nicht in der Vergangenheit liegen.");
 }
 const actionId=requireVoiceUuid(input.actionId,"Aktion");
 if(![1,2,3].includes(Number(input.stage))||typeof input.capturedAt!=="string"||!Number.isFinite(Date.parse(input.capturedAt))||Date.parse(input.capturedAt)>Date.now()+60000)throw invalid("Ungültige Anrufstufe.");
 let dueAt:string|null=null;
 if(input.dueAt!=null){
  if(input.status!=="scheduled"||typeof input.dueAt!=="string"||!Number.isFinite(Date.parse(input.dueAt))||Date.parse(input.dueAt)<=Date.now()||berlinDate(new Date(input.dueAt))!==dueDate)throw invalid("Ungültiger Rückruftermin.");
  dueAt=input.dueAt;
 }
 const row=(await candidates({id:"eq."+requestId,customer_id:"eq."+customerId}))[0];
 if(!row)throw invalid("Vorgang nicht gefunden.");
 const offer=rowOffer(row,await offersForRows([row]));
 if(!toLead(row,offer).canSchedule)throw invalid("Dieser Vorgang ist bereits abgeschlossen oder gesperrt.");
 // A captured inquiry call may finish after the first send; never reclassify it.
 const captured=Date.parse(input.capturedAt);
 if(Number(input.stage)===1&&offer?.sentAt&&Date.parse(offer.sentAt)<=captured)throw invalid("Anrufstufe veraltet. Bitte aktualisieren.");
 if(Number(input.stage)>1&&(!offer?.sentAt||Date.parse(offer.sentAt)>captured))throw invalid("Das Angebot war zu diesem Zeitpunkt noch nicht gesendet.");
 try{return await supabaseRpc("save_voice_hot_lead_v2",{p_request_id:requestId,p_customer_id:customerId,p_status:input.status,p_source_at:input.sourceAt,p_due_date:dueDate,p_due_at:dueAt,p_revision:input.revision,p_stage:Number(input.stage),p_action_id:actionId,p_captured_at:input.capturedAt});}
 catch(error){if(error instanceof SupabaseRestError&&String(error.details).includes("revision_conflict"))throw new QuoteValidationError("Dieser Eintrag wurde inzwischen geändert. Bitte aktualisieren.",["revision_conflict"],409);throw error;}
}
