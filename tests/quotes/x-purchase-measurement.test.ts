import assert from "node:assert/strict";
import test from "node:test";
import { acceptedReceipt, captureInput, checkoutHash, cents, paidProof, type ShopifyProof } from "../../src/lib/ops/x-measurement/validation";
import { cors, readJson } from "../../src/lib/ops/x-measurement/http";
import { POST as publicCapture } from "../../src/app/api/public/measurement/x/route";
import { POST as workerRoute } from "../../src/app/api/internal/measurement/x/route";
const now = Date.parse("2026-10-16T12:00:00Z"), id = "1234567890123", token = "checkout_0123456789abcdef";
const paidAt = "2026-10-16T11:00:00.000Z";
function proof(): ShopifyProof {
  return { rest: { id, checkout_token: token, financial_status:"paid",test:false,cancelled_at:null,total_price:"123.45",currency:"EUR" },graphql:{data:{order:{id:"gid://shopify/Order/"+id,displayFinancialStatus:"PAID",test:false,cancelledAt:null,totalPriceSet:{shopMoney:{amount:"123.45",currencyCode:"EUR"}},totalReceivedSet:{shopMoney:{amount:"123.45",currencyCode:"EUR"}},transactions:[{id:"transaction_1",status:"SUCCESS",kind:"SALE",manualPaymentGateway:false,test:false,processedAt:paidAt,amountSet:{shopMoney:{amount:"123.45",currencyCode:"EUR"}}}]}}} };
}
test("confirmed online purchase uses Shopify value, currency, payment time and checkout hash", () => {
  assert.deepEqual(paidProof(proof(),id,undefined,now),{order_id:id,checkout_hash:checkoutHash(token),amount_cents:12345,currency:"EUR",paid_at:paidAt});
  assert.equal(cents("100.1"),10010); assert.throws(()=>cents("1e3")); assert.throws(()=>cents("1.001"));
});
for (const [name,change] of Object.entries({
  unpaid:(p:ShopifyProof)=>{p.rest.financial_status="pending";},
  authorized:(p:ShopifyProof)=>{p.graphql.data!.order!.transactions[0].kind="AUTHORIZATION";},
  failed:(p:ShopifyProof)=>{p.graphql.data!.order!.transactions[0].status="FAILURE";},
  testOrder:(p:ShopifyProof)=>{p.rest.test=true;},
  testTransaction:(p:ShopifyProof)=>{p.graphql.data!.order!.transactions[0].test=true;},
  cancelled:(p:ShopifyProof)=>{p.rest.cancelled_at=paidAt;},
  partiallyPaid:(p:ShopifyProof)=>{p.graphql.data!.order!.transactions[0].amountSet.shopMoney.amount="1.00";},
  currencyMismatch:(p:ShopifyProof)=>{p.graphql.data!.order!.transactions[0].amountSet.shopMoney.currencyCode="USD";},
  changedTotal:(p:ShopifyProof)=>{p.graphql.data!.order!.totalPriceSet.shopMoney.amount="124.45";},
  wrongOrder:(p:ShopifyProof)=>{p.rest.id="9999999999999";},
  graphqlError:(p:ShopifyProof)=>{p.graphql.errors=[{message:"partial response"}];},
  truncatedTransactions:(p:ShopifyProof)=>{p.graphql.data!.order!.transactions=Array(100).fill(p.graphql.data!.order!.transactions[0]);},
  refund:(p:ShopifyProof)=>{const t=p.graphql.data!.order!.transactions;p.graphql.data!.order!.transactions=[...t,{...t[0],id:"refund_1",kind:"REFUND"}];},
  duplicateTransaction:(p:ShopifyProof)=>{p.graphql.data!.order!.transactions.push({...p.graphql.data!.order!.transactions[0]});},
})) test(name+" does not emit a purchase",()=>{const p=proof();change(p);assert.equal(paidProof(p,id,undefined,now),null);});
test("manual paid requires independently reconciled bank funds",()=>{
  const p=proof();p.graphql.data!.order!.transactions[0].manualPaymentGateway=true;
  assert.equal(paidProof(p,id,undefined,now),null);
  assert.equal(paidProof(p,id,{cents:12344,currency:"EUR",paidAt},now),null);
  assert.ok(paidProof(p,id,{cents:12345,currency:"EUR",paidAt},now));
});
test("capture requires explicit consent, valid checkout/click and bounded timestamps; drops all extra fields",()=>{
  const input={checkout_token:token,marketing_allowed:true,twclid:"test_click",click_at:paidAt,consent_at:paidAt,email:"never-forward@example.invalid",value:100};
  const result=captureInput(input,now);assert.equal(result.p_hash,checkoutHash(token));assert.equal(Object.keys(result).length,5);
  for(const patch of [{marketing_allowed:false},{marketing_allowed:"true"},{twclid:"bad\nclick"},{click_at:"2030-01-01"},{consent_at:"2020-01-01"}]) {
    if(patch.marketing_allowed===false) assert.equal(captureInput({...input,...patch},now).p_revoke,true);
    else assert.throws(()=>captureInput({...input,...patch},now));
  }
});
test("only explicit X processing receipt counts, never a green HTTP node alone",()=>{
  const response={statusCode:200,body:{data:{conversions_processed:1,debug_id:"receipt_123456"}}};
  assert.equal(acceptedReceipt(response),"receipt_123456");
  assert.equal(acceptedReceipt({...response,statusCode:202}),null);
  assert.equal(acceptedReceipt({statusCode:200,body:{data:{conversions_processed:0}}}),null);
  assert.equal(acceptedReceipt({statusCode:200,body:{...response.body,errors:["failed"]}}),null);
});
test("public endpoint excludes arbitrary origins and bounds streamed JSON",async()=>{
  assert.equal(cors(new Request("https://ops.neontrip.de",{headers:{origin:"https://unrelated.invalid"}})),null);
  assert.ok(cors(new Request("https://ops.neontrip.de",{headers:{origin:"null"}})));
  await assert.rejects(readJson(new Request("https://ops.neontrip.de",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({long:"x".repeat(9000)})})));
});
test("public route forwards only validated consent mapping; internal route rejects anonymous callers",async(t)=>{
  const previous={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY};
  process.env.SUPABASE_URL="https://unit-test.invalid"; process.env.SUPABASE_SERVICE_ROLE_KEY="unit-test-placeholder";
  t.after(()=>{if(previous.url===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=previous.url;if(previous.key===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=previous.key;});
  const calls:Array<{url:string;body:Record<string,unknown>}>=[];
  t.mock.method(globalThis,"fetch",async(url:unknown,init:RequestInit)=>{calls.push({url:String(url),body:JSON.parse(String(init.body))});return new Response(null,{status:204});});
  const stamp=new Date(Date.now()-1000).toISOString();
  const response=await publicCapture(new Request("https://ops.neontrip.de/api/public/measurement/x",{method:"POST",headers:{origin:"null","content-type":"application/json"},body:JSON.stringify({checkout_token:token,marketing_allowed:true,twclid:"test_click",click_at:stamp,consent_at:stamp,email:"private@example.invalid",value:999})}));
  assert.equal(response.status,204);assert.equal(calls.length,1);assert.match(calls[0].url,/\/rpc\/x_ads_capture$/);assert.equal(calls[0].body.p_hash,checkoutHash(token));assert.equal("email" in calls[0].body,false);assert.equal("value" in calls[0].body,false);
  assert.equal((await workerRoute(new Request("https://ops.neontrip.de/api/internal/measurement/x",{method:"POST"}))).status,401);assert.equal(calls.length,1);
});
