import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { POST } from '../../src/app/api/internal/billing/order-confirmation/route';
import { orderConfirmationFromBillingCase,orderConfirmationFromSnapshot } from '../../src/lib/ops/order-confirmation';
const c:any={id:'12345678-1234-1234-1234-123456789012',source_offer_id:'offer-1',shopify_order_id:'42',shopify_order_name:'#NEONT42',customer:{name:'Muster'},billing_address:{name:'Neue Rechnungsadresse'},delivery_address:{name:'Lieferanschrift'},line_items:[{title:'Neon',description:'Blau',quantity:2,unitPriceNet:50}],totals:{},subtotal_net_cents:10000,vat_cents:1900,total_gross_cents:11900,currency:'EUR',created_at:'2026-11-03T12:00:00Z',payment_method:'VORKASSE'};
test('AB uses current billing amounts and addresses, while retaining only selected delivery and accepted order details',()=>{
 const sale={offer_number:'A/N 123',offer_snapshot:{acceptedAt:c.created_at,billingAddress:{name:'Alte Adresse'},delivery:{requestedDays:20,requestedDate:'2026-12-01',note:'Abweichender Kundenwunsch: 23.11.2026'},totals:{totalGross:999},lineItems:[{title:'Neon',description:'Blau'}]}};
 const input=orderConfirmationFromBillingCase(c,sale);
 assert.equal(input.total,119);assert.equal(input.billingAddress.name,'Neue Rechnungsadresse');assert.equal(input.items[0].total,100);
 assert.equal(input.delivery,'ca. 20 Werktage. Gewählter Termin: 01.12.2026.');
 assert.doesNotMatch(JSON.stringify(input),/Abweichender Kundenwunsch|23\.11\.2026|Alte Adresse/);
 assert.match(orderConfirmationFromBillingCase({...c,paid_at:c.created_at},sale).paymentTerms||'',/vollständig bezahlt/);
 assert.match(orderConfirmationFromBillingCase({...c,payment_method:'KAUF_AUF_RECHNUNG',payment_terms_days:14},sale).paymentTerms||'',/14 Tage/);
});
test('worker PDF endpoint rejects unauthenticated and malformed requests before reading any data',async()=>{
 process.env.BILLING_WORKER_API_TOKEN='t'.repeat(32);
 const old=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('unexpected external call');};
 try{
  assert.equal((await POST(new NextRequest('https://ops.test/api/internal/billing/order-confirmation',{method:'POST',body:'{}'}))).status,401);
  assert.equal((await POST(new NextRequest('https://ops.test/api/internal/billing/order-confirmation',{method:'POST',headers:{authorization:'Bearer '+'t'.repeat(32)},body:JSON.stringify({billingCaseId:'bad'})}))).status,422);
 }finally{globalThis.fetch=old;delete process.env.BILLING_WORKER_API_TOKEN;}
});
test('worker renders a PDF for the exact billing case without invoking any send endpoint',async()=>{
 const old=globalThis.fetch,oldEnv={...process.env};let reads=0;
 process.env.BILLING_WORKER_API_TOKEN='t'.repeat(32);process.env.SUPABASE_URL='https://supabase.test';process.env.SUPABASE_SERVICE_ROLE_KEY='test-key';
 globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input));assert.equal(init?.method||'GET','GET');assert.equal(url.origin,'https://supabase.test');reads++;
  if(url.pathname.endsWith('/billing_cases')){assert.equal(url.searchParams.get('id'),`eq.${c.id}`);return Response.json([c]);}
  if(url.pathname.endsWith('/supplier_sales')){assert.equal(url.searchParams.get('shopify_order_id'),'in.(42,gid://shopify/Order/42)');return Response.json([{offer_id:'offer-1',offer_number:'A/N 123',created_at:c.created_at,offer_snapshot:{delivery:{requestedDays:20,requestedDate:'2026-12-01'}}}]);}
  throw new Error('Unexpected external side effect: '+url.pathname);
 };
 try{
  const response=await POST(new NextRequest('https://ops.test/api/internal/billing/order-confirmation',{method:'POST',headers:{authorization:'Bearer '+'t'.repeat(32)},body:JSON.stringify({billingCaseId:c.id})}));
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.ok,true);assert.equal(body.contentType,'application/pdf');assert.ok(Buffer.from(body.contentBase64,'base64').toString('utf8',0,8).startsWith('%PDF-'));assert.equal(reads,2);
 }finally{globalThis.fetch=old;for(const key of ['BILLING_WORKER_API_TOKEN','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']){if(oldEnv[key]===undefined)delete process.env[key];else process.env[key]=oldEnv[key];}}
});
