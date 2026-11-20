import test from "node:test";
import assert from "node:assert/strict";
import {organizationOrderScope,summarizeOrganizationOrders,readVoiceSupabaseOrders,type OrganizationOrder} from "../../src/lib/ops/voice-organization-orders";
const row=(id:string,email:string,amount="10.10",currency="EUR",cancelled=false):OrganizationOrder=>({id:"gid://shopify/Order/"+id,name:"#"+id,email,createdAt:"2026-11-19T12:00:00Z",cancelledAt:cancelled?"2026-11-19T13:00:00Z":null,test:false,displayFinancialStatus:"PAID",currentTotalPriceSet:{shopMoney:{amount,currencyCode:currency}}});
test("business domain includes colleagues, excludes suffix lookalikes and subdomains; IDs deduplicate",()=>{
 const a=row("1","A@Example.de");
 const result=summarizeOrganizationOrders(" b@example.de ",[a,a,row("2","c@example.de","20.20"),row("3","x@notexample.de"),row("4","x@sub.example.de")],"now");
 assert.equal(result.scope,"organization");assert.equal(result.count,2);assert.deepEqual(result.totals,[{currency:"EUR",amount:30.3}]);assert.equal(result.orders.length,2);
});
test("private email domains never aggregate unrelated contacts",()=>{
 const result=summarizeOrganizationOrders("a@icloud.com",[row("1","a@icloud.com"),row("2","b@icloud.com")],"now");
 assert.equal(result.scope,"contact");assert.equal(result.count,1);
 assert.equal(organizationOrderScope("missing"),null);
 assert.equal(organizationOrderScope("x@no-customer-email.invalid"),null);
});
test("cancelled orders remain visible but not counted; test orders excluded; currencies separate",()=>{
 const sample=[row("1","a@example.de","10.10"),row("2","b@example.de","20.20","USD"),row("3","b@example.de","99","EUR",true),{...row("4","a@example.de"),test:true}];
 const result=summarizeOrganizationOrders("a@example.de",sample,"now");assert.equal(result.count,2);assert.equal(result.orders.length,3);assert.deepEqual(result.totals,[{currency:"EUR",amount:10.1},{currency:"USD",amount:20.2}]);
});

const now=Date.parse("2026-11-20T10:00:00Z"),observed="2026-11-20T09:50:00Z";
const mirror=(id:string)=>({shopify_order_id:id,name:"#"+id,email:"a@example.de",created_at:"2025-01-01T12:00:00Z",cancelled_at:null,is_test:false,financial_status:"paid",current_total_price:"12.34",currency:"EUR",ingested_at:observed,shopify_updated_at:observed});
function reader(rows:ReturnType<typeof mirror>[],count=rows.length,metadata:Record<string,unknown>={}) {
 const calls:Array<{path:string;query:Record<string,unknown>|undefined}>=[];
 const request=(async(path:string,_init:unknown,query:Record<string,unknown>|undefined)=>{
  calls.push({path,query});
  if(path==="workflow_audit_log")return [{status:"success",metadata:{schema:"ops.source-mirror.v1",source:"shopify",source_complete:true,source_count:count,written_count:count,observed_at:observed,verified_at:"2026-11-20T09:51:00Z",...metadata}}];
  assert.equal(path,"shopify_orders");
  return rows.slice(Number(query?.offset||0),Number(query?.offset||0)+Number(query?.limit));
 }) as Parameters<typeof readVoiceSupabaseOrders>[0];
 return {request,calls};
}
test("Supabase reader follows all pages, verifies snapshot and preserves source timestamp/status",async()=>{
 const {request,calls}=reader(Array.from({length:501},(_,i)=>mirror(String(i+1))));
 const result=await readVoiceSupabaseOrders(request,now);
 assert.equal(result.orders.length,501);assert.equal(result.checkedAt,new Date(observed).toISOString());
 assert.equal(result.orders[0].displayFinancialStatus,"PAID");assert.equal(calls.length,3);
 assert.equal(calls[2].query?.offset,500);
});
test("unverified, stale or future snapshots fail before loading order rows",async()=>{
 for(const meta of [{source_complete:false},{schema:"unknown"},{written_count:0},{observed_at:"2026-11-20T08:00:00Z"},{verified_at:"2026-11-20T10:01:00Z"}]){
  const {request,calls}=reader([mirror("1")],1,meta);
  await assert.rejects(readVoiceSupabaseOrders(request,now),/unverified_or_stale/);assert.equal(calls.length,1);
 }
});
test("partial, duplicate and newer overlapping imports fail closed",async()=>{
 for(const rows of [[mirror("1")],[mirror("1"),mirror("1")],[mirror("1"),{...mirror("2"),ingested_at:"2026-11-20T09:55:00Z"}]]){
  await assert.rejects(readVoiceSupabaseOrders(reader(rows,2).request,now),/incomplete/);
 }
});
test("old retained rows are excluded; missing metadata and malformed amounts fail",async()=>{
 const result=await readVoiceSupabaseOrders(reader([mirror("1"),{...mirror("2"),ingested_at:"2026-11-19T09:00:00Z"}],1).request,now);
 assert.equal(result.orders.length,1);
 for(const patch of [{is_test:null},{current_total_price:null},{current_total_price:""},{current_total_price:"NaN"},{shopify_updated_at:null},{currency:""},{created_at:"bad"}]){
  await assert.rejects(readVoiceSupabaseOrders(reader([{...mirror("1"),...patch} as ReturnType<typeof mirror>]).request,now),/invalid_order/);
 }
});
test("failed Supabase request never becomes an empty history",async()=>{
 const request=(async()=>{throw Error("upstream failed");}) as Parameters<typeof readVoiceSupabaseOrders>[0];
 await assert.rejects(readVoiceSupabaseOrders(request,now),/upstream failed/);
});
