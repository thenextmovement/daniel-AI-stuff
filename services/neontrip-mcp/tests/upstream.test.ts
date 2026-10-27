import assert from "node:assert/strict";
import test from "node:test";
import type { GatewayConfig } from "../src/config.js";
import { NeontripApi } from "../src/upstream.js";

function config(): GatewayConfig {
  return {
    env: "test",
    host: "127.0.0.1",
    port: 8787,
    publicUrl: new URL("http://localhost:8787/mcp"),
    allowedHosts: ["localhost"],
    allowedOrigins: [],
    identities: [],
    requiredServices: ["billing", "offers"],
    requestTimeoutMs: 1_000,
    maxResponseBytes: 10_000,
    requestsPerMinute: 240,
    allowDecisionCustomerEmail: false,
    ops: { baseUrl: new URL("https://ops.example.test"), accessClientId: "ops-id", accessClientSecret: "ops-secret" },
    offers: { baseUrl: new URL("https://offers.example.test"), apiKey: "offers-secret" },
  };
}

test("billing requests use only the fixed OPS origin and service-token headers", async () => {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const api = new NeontripApi(config(), async (url, init) => {
    calls.push({ url: new URL(String(url)), init });
    return Response.json({ ok: true, cases: [] });
  });
  await api.listBillingCases({ query: "//evil.example", status: "PENDING", limit: 5 });
  assert.equal(calls[0]?.url.origin, "https://ops.example.test");
  assert.equal(calls[0]?.url.pathname, "/api/ops/billing");
  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers["CF-Access-Client-Id"], "ops-id");
  assert.equal(headers["CF-Access-Client-Secret"], "ops-secret");
  assert.equal(calls[0]?.init?.redirect, "error");
});

test("oversized upstream responses are rejected", async () => {
  const api = new NeontripApi(config(), async () => new Response("x".repeat(10_001), {
    status: 200,
    headers: { "content-type": "application/json", "content-length": "10001" },
  }));
  await assert.rejects(() => api.getOffer("00000000-0000-4000-8000-000000000000"), /zu groß/);
});

test("non-JSON upstream responses are rejected before parsing", async () => {
  const api = new NeontripApi(config(), async () => new Response("<html>login</html>", {
    status: 200,
    headers: { "content-type": "text/html" },
  }));
  await assert.rejects(() => api.getOffer("00000000-0000-4000-8000-000000000000"), /JSON-Antwort/);
});

test("customer history reads use fixed OPS origin, encoded binding and no mutation",async()=>{
 const calls:Array<{url:URL;init?:RequestInit}>=[];
 const api=new NeontripApi(config(),async(url,init)=>{calls.push({url:new URL(String(url)),init});return Response.json({ok:true,entries:[]});});
 await api.searchCustomers("name+test@example.test");
 await api.customerHistory("REQ-1&requestId=OTHER",20);
 await api.customerTranscript("00000000-0000-4000-8000-000000000001",100);
 assert.equal(calls.length,4);
 for(const call of calls){
  assert.equal(call.url.origin,"https://ops.example.test");
  assert.equal(call.init?.method??"GET","GET");
  assert.equal((call.init?.headers as Record<string,string>)["CF-Access-Client-Id"],"ops-id");
 }
 assert.equal(calls[1].url.searchParams.get("requestId"),"REQ-1&requestId=OTHER");
 assert.equal(calls[2].url.searchParams.get("offset"),"20");
 assert.equal(calls[3].url.searchParams.get("offset"),"100");
});

test("offer lists and delivery history preserve date bounds and pagination on authenticated fixed paths", async () => {
 const calls: Array<{url: URL; init?: RequestInit}> = [];
 const api = new NeontripApi(config(), async (url,init) => {
  calls.push({url:new URL(String(url)),init}); return Response.json({ok:true,offers:[]});
 });
 await api.listOffers({limit:2,offset:4,sortBy:"sentAt",sortOrder:"desc"});
 await api.listOfferDeliveries({limit:1,sentFrom:"2026-10-27T00:00:00+01:00",sentTo:"2026-10-28T00:00:00+01:00",status:"SENT",channel:"EMAIL"});
 assert.equal(calls[0]?.url.pathname,"/api/internal/offers/list");
 assert.equal(calls[0]?.url.searchParams.get("offset"),"4");
 assert.equal(calls[1]?.url.pathname,"/api/internal/offers/deliveries");
 assert.equal(calls[1]?.url.searchParams.get("sentFrom"),"2026-10-27T00:00:00+01:00");
 assert.equal(calls[1]?.url.searchParams.has("cursor"),false);
 for(const call of calls) {
  assert.equal(call.url.origin,"https://offers.example.test");
  assert.equal(call.init?.method,"GET");
  assert.equal((call.init?.headers as Record<string,string>).Authorization,"Bearer offers-secret");
 }
});

test("full offers federation uses the caller credential only on the fixed native MCP endpoint",async()=>{
 const calls:Array<{url:string;headers:Record<string,string>;body:Record<string,unknown>}>=[];
 const api=new NeontripApi(config(),async(url,init)=>{
  calls.push({url:String(url),headers:init?.headers as Record<string,string>,body:JSON.parse(String(init?.body))});
  return Response.json({jsonrpc:"2.0",id:1,result:{tools:[]}});
 });
 assert.equal(typeof (api as any).nativeOffers,"function");
 const result=await (api as any).nativeOffers("caller-native-token","tools/list",{});
 assert.deepEqual(result,{tools:[]});
 assert.equal(calls[0]?.url,"https://offers.example.test/api/mcp");
 assert.equal(calls[0]?.headers.Authorization,"Bearer caller-native-token");
 assert.equal(calls[0]?.headers["CF-Access-Client-Secret"],undefined);
});

test("Ops business failures are failures even when HTTP status is 200",async()=>{
 const api=new NeontripApi(config(),async()=>Response.json({ok:false,error:"version_conflict"}));
 await assert.rejects(api.opsOperation("customer_records_patch",{},{},{requestId:"test"}),/version_conflict/);
});
