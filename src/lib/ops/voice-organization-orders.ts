import { supabaseRequest } from "../quotes/supabase-rest";
import { customerOrganizationEmailDomains } from "./customer-records";

export type OrganizationOrder = { id:string; name:string; email:string|null; createdAt:string; cancelledAt:string|null; test:boolean; displayFinancialStatus:string|null; currentTotalPriceSet:{shopMoney:{amount:string;currencyCode:string}} };
export type OrganizationOrders = { scope:"organization"|"contact"; domain:string|null; count:number; totals:Array<{currency:string;amount:number}>; orders:Array<{id:string;name:string;email:string|null;createdAt:string;cancelled:boolean;status:string|null;amount:number;currency:string;href:string}>; checkedAt:string };
const normalize = (value:string|null|undefined) => value?.trim().toLowerCase() || "";
export function organizationOrderScope(email:string) {
  const normalized=normalize(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.endsWith(".invalid")) return null;
  const domain=customerOrganizationEmailDomains([normalized])[0] || null;
  return { email:normalized, domain };
}
export function summarizeOrganizationOrders(email:string, source:OrganizationOrder[], checkedAt:string):OrganizationOrders {
  const scope=organizationOrderScope(email);
  if(!scope) throw Error("organization_email_missing");
  const unique=new Map(source.map(order=>[order.id,order]));
  const orders=[...unique.values()].filter(order=>!order.test && (scope.domain ? normalize(order.email).split("@")[1]===scope.domain : normalize(order.email)===scope.email)).map(order=>({
    id:order.id,name:order.name,email:order.email,createdAt:order.createdAt,cancelled:!!order.cancelledAt,status:order.displayFinancialStatus,
    amount:Number(order.currentTotalPriceSet.shopMoney.amount),currency:order.currentTotalPriceSet.shopMoney.currencyCode,
    href:"https://admin.shopify.com/store/galaxybuzzdk/orders/"+order.id.split("/").at(-1),
  })).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const totals=new Map<string,number>();
  for(const order of orders) if(!order.cancelled) totals.set(order.currency,(totals.get(order.currency)||0)+Math.round(order.amount*100));
  return {scope:scope.domain?"organization":"contact",domain:scope.domain,count:orders.filter(order=>!order.cancelled).length,totals:[...totals].map(([currency,cents])=>({currency,amount:cents/100})),orders,checkedAt};
}
type MirrorOrder = {
 shopify_order_id:string;name:string;email:string|null;created_at:string;cancelled_at:string|null;
 is_test:boolean;financial_status:string|null;current_total_price:number|string;currency:string;
 ingested_at:string;shopify_updated_at:string;
};
type MirrorAudit = {status:string;metadata:{schema:string;source:string;source_complete:boolean;source_count:number;written_count:number;observed_at:string;verified_at:string}};
const MAX_AGE=45*60_000;
const iso=(value:unknown)=>typeof value==="string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
// Read the already verified mirror. A partial sync or missing metadata must never become a zero history.
export async function readVoiceSupabaseOrders(request:typeof supabaseRequest=supabaseRequest,now=Date.now()) {
 const signal=AbortSignal.timeout(20_000);
 const audits=await request<MirrorAudit[]>("workflow_audit_log",{signal},{
  select:"status,metadata",action:"eq.ops_source_mirror_verified","metadata->>source":"eq.shopify",order:"created_at.desc",limit:1,
 });
 const audit=audits?.[0],meta=audit?.metadata;
 const observed=iso(meta?.observed_at),verified=iso(meta?.verified_at);
 if(audit?.status!=="success" || meta?.schema!=="ops.source-mirror.v1" || meta.source!=="shopify" || meta.source_complete!==true ||
   !Number.isSafeInteger(meta.source_count) || meta.source_count<1 || meta.written_count!==meta.source_count ||
   !observed || !verified || Date.parse(verified)<Date.parse(observed) || Date.parse(verified)>now ||
   now-Date.parse(observed)>MAX_AGE) throw Error("organization_mirror_unverified_or_stale");
 const orders:OrganizationOrder[]=[];
 const ids=new Set<string>();
 let offset=0;
 for(let page=0;page<200;page++) {
  const rows=await request<MirrorOrder[]>("shopify_orders",{signal},{
   select:"shopify_order_id,name,email,created_at,cancelled_at,is_test,financial_status,current_total_price,currency,ingested_at,shopify_updated_at",
   order:"shopify_order_id.asc",limit:500,offset,
  });
  if(!Array.isArray(rows))throw Error("organization_mirror_invalid_page");
  for(const row of rows) {
   const ingested=iso(row.ingested_at);
   if(!ingested || ingested>observed || !/^\d+$/.test(row.shopify_order_id) || ids.has(row.shopify_order_id))throw Error("organization_mirror_incomplete");
   ids.add(row.shopify_order_id);
   if(ingested!==observed)continue; // Provider-deleted historical rows are outside the verified snapshot.
   if(typeof row.name!=="string" || !iso(row.created_at) || !iso(row.shopify_updated_at) ||
    (row.cancelled_at!==null && !iso(row.cancelled_at)) || typeof row.is_test!=="boolean" ||
    (row.email!==null && typeof row.email!=="string") || !/^[A-Z]{3}$/.test(row.currency) ||
    row.current_total_price===null || String(row.current_total_price).trim()==="" ||
    !Number.isFinite(Number(row.current_total_price)) || Number(row.current_total_price)<0)throw Error("organization_mirror_invalid_order");
   orders.push({id:"gid://shopify/Order/"+row.shopify_order_id,name:row.name,email:row.email,createdAt:row.created_at,
    cancelledAt:row.cancelled_at,test:row.is_test,displayFinancialStatus:row.financial_status?.toUpperCase()||null,
    currentTotalPriceSet:{shopMoney:{amount:String(row.current_total_price),currencyCode:row.currency}}});
  }
  if(rows.length<500) {
   if(orders.length!==meta.source_count)throw Error("organization_mirror_incomplete");
   return {orders,checkedAt:observed};
  }
  offset+=rows.length;
 }
 throw Error("organization_mirror_incomplete");
}
let snapshot:Awaited<ReturnType<typeof readVoiceSupabaseOrders>>|null=null;
let expires=0;
let pending:ReturnType<typeof readVoiceSupabaseOrders>|null=null;
let retryAfter=0;
export async function loadOrganizationOrders(email:string) {
 if(!snapshot || Date.now()>=expires) {
  if(Date.now()<retryAfter)throw Error("organization_mirror_retry_later");
  pending??=readVoiceSupabaseOrders().then(value=>{
   snapshot=value;expires=Math.min(Date.now()+60_000,Date.parse(value.checkedAt)+MAX_AGE);return value;
  }).catch(error=>{retryAfter=Date.now()+15_000;throw error;}).finally(()=>{pending=null;});
  await pending;
 }
 return summarizeOrganizationOrders(email,snapshot!.orders,snapshot!.checkedAt);
}
