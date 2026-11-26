import test from "node:test";
import assert from "node:assert/strict";
import {fetchDhlRates,type DhlRateConfig} from "../src/dhl-rates.js";
import {draft} from "./fixtures/dhl-preview.js";
const config:DhlRateConfig={environment:"test",username:"test-user",password:"test-secret",accountNumber:"123456789"};
const data={products:[{productCode:"N",productName:"TEST PRODUCT",totalPrice:[{currencyType:"BILLC",priceCurrency:"EUR",price:42.5}],deliveryCapabilities:{estimatedDeliveryDateAndTime:"2026-11-30T18:00:00"}}]};
test("DHL rate call has fixed endpoint and correct real parcel fields, never shipment creation",async()=>{
 let count=0;
 const fake:typeof fetch=async(url,init)=>{
  count++;assert.equal(String(url),"https://express.api.dhl.com/mydhlapi/test/rates");
  assert.equal(init?.method,"POST"); assert.equal(init?.redirect,"error");
  const body=JSON.parse(String(init?.body));
  assert.deepEqual(body.packages,[{weight:2,dimensions:{length:40,width:30,height:20}}]);
  assert.deepEqual(body.accounts,[{typeCode:"shipper",number:"123456789"}]);
  assert.equal(body.plannedShippingDateAndTime,"2026-11-27T10:00:00GMT+01:00");
  return Response.json(data);
 };
 const r=await fetchDhlRates(draft,config,fake,()=>Date.parse("2026-11-26T10:00:00Z"));
 assert.equal(count,1); assert.equal(r.offers[0]?.amount,42.5);assert.equal(r.offers[0]?.currency,"EUR");
 assert.equal(r.offers[0]?.deliveryDate,"2026-11-30T18:00:00");
 assert.ok(!JSON.stringify(r).includes("test-secret"));
});
test("no public rates, invented currency, absent price or absent delivery date are fabricated",async()=>{
 for(const totalPrice of [[{currencyType:"PULCL",priceCurrency:"EUR",price:5}],[{currencyType:"BILLC",price:1}],[{currencyType:"BILLC",priceCurrency:"EUR"}]]){
  const r=await fetchDhlRates(draft,config,async()=>Response.json({products:[{productCode:"N",totalPrice}]}),()=>Date.parse("2026-11-26"));
  assert.equal(r.offers.length,0);assert.ok(r.warnings.length);
 }
 const r=await fetchDhlRates(draft,config,async()=>Response.json({products:[{...data.products[0],deliveryCapabilities:undefined}]}),()=>Date.parse("2026-11-26"));
 assert.equal(r.offers[0]?.deliveryDate,undefined);
});
test("one failed date preserves other account rates; upstream errors do not leak text",async()=>{
 let i=0;
 const r=await fetchDhlRates({...draft,shippingDates:[...draft.shippingDates,"2026-11-30T10:00:00+01:00"]},config,async()=> ++i===1 ? new Response("secret upstream payload",{status:401}) : Response.json(data),()=>Date.parse("2026-11-26"));
 assert.equal(r.offers.length,1);assert.equal(r.warnings.length,1);
 assert.ok(!JSON.stringify(r).includes("secret upstream payload"));
});
test("malformed, oversized and unreachable upstream fail closed; dates outside ten days never call DHL",async()=>{
 for(const fake of [async()=>new Response("bad"),async()=>new Response("x".repeat(1500001)),async()=>{throw new DOMException("test-secret","AbortError");}]){
  const r=await fetchDhlRates(draft,config,fake as typeof fetch,()=>Date.parse("2026-11-26"));
  assert.equal(r.offers.length,0);assert.ok(r.warnings.length);assert.ok(!JSON.stringify(r).includes("test-secret"));
 }
 let calls=0;
 await assert.rejects(()=>fetchDhlRates(draft,config,async()=>{calls++;return Response.json(data)},()=>Date.parse("2026-12-01")));
 assert.equal(calls,0);
});
