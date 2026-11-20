import test from "node:test";
import assert from "node:assert/strict";
import {organizationOrderScope,summarizeOrganizationOrders,readVoiceShopifyOrders,type OrganizationOrder} from "../../src/lib/ops/voice-organization-orders";
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
test("full Shopify scan verifies production shop and historical scope, follows pages, fails closed",async()=>{
 const before={domain:process.env.SHOPIFY_SHOP_DOMAIN,token:process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN};
 process.env.SHOPIFY_SHOP_DOMAIN="galaxybuzzdk.myshopify.com";process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN="test-not-a-secret";
 const access={shop:{myshopifyDomain:"galaxybuzzdk.myshopify.com"},currentAppInstallation:{accessScopes:[{handle:"read_all_orders"}]}};
 let calls=0;
 const mock=(async(_url:unknown,init:RequestInit)=>{
  const body=JSON.parse(String(init.body));calls++;
  if(calls===1)return Response.json({data:access});
  assert.equal(body.variables.after,calls===2?null:"page2");
  return Response.json({data:{orders:{nodes:[row(String(calls),"a@example.de")],pageInfo:{hasNextPage:calls===2,endCursor:"page2"}}}});
 }) as typeof fetch;
 try{
  const result=await readVoiceShopifyOrders(mock);assert.equal(result.orders.length,2);assert.equal(calls,3);
  await assert.rejects(readVoiceShopifyOrders((async()=>Response.json({data:{...access,currentAppInstallation:{accessScopes:[]}}})) as typeof fetch),/history_permission/);
  calls=0;await assert.rejects(readVoiceShopifyOrders((async()=>{calls++;return calls===1?Response.json({data:access}):Response.json({errors:[{message:"denied"}]});}) as typeof fetch),/read_failed/);
  calls=0;await assert.rejects(readVoiceShopifyOrders((async()=>{calls++;return Response.json({data:calls===1?access:{orders:{nodes:[],pageInfo:{hasNextPage:true,endCursor:"repeat"}}}});}) as typeof fetch),/invalid_cursor/);
  calls=0;
  const recovered=await readVoiceShopifyOrders((async()=>{calls++;if(calls===1)return Response.json({errors:[{extensions:{code:"THROTTLED"}}]});return Response.json({data:calls===2?access:{orders:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}});}) as typeof fetch);
  assert.equal(recovered.orders.length,0);assert.equal(calls,3);
  process.env.SHOPIFY_SHOP_DOMAIN="wrong.myshopify.com";await assert.rejects(readVoiceShopifyOrders(mock),/not_configured/);
 }finally{
  if(before.domain===undefined)delete process.env.SHOPIFY_SHOP_DOMAIN;else process.env.SHOPIFY_SHOP_DOMAIN=before.domain;
  if(before.token===undefined)delete process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;else process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN=before.token;
 }
});
