import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { GatewayConfig } from "../src/config.js";
import { createGatewayApp } from "../src/server.js";
import { requestedChangesHash } from "../src/safety.js";

const token = "local-http-mcp-test-token";

function config(): GatewayConfig {
  return {
    env: "test",
    host: "127.0.0.1",
    port: 8787,
    publicUrl: new URL("http://127.0.0.1:8787/mcp"),
    allowedHosts: ["127.0.0.1"],
    allowedOrigins: [],
    identities: [{
      clientId: "http-test",
      actor: "http-test@neontrip",
      role: "billing_automation",
      tokenSha256: createHash("sha256").update(token).digest("hex"),
      scopes: ["system:read", "billing:read", "billing:change:accept"],
      expiresAt: Math.floor(Date.now() / 1000) + 3_600,
    }],
    requiredServices: [],
    requestTimeoutMs: 1_000,
    maxResponseBytes: 10_000,
    requestsPerMinute: 100,
    allowDecisionCustomerEmail: false,
  };
}

function parseMcpBody(rawBody: string) {
  const dataLine = rawBody.split("\n").find((line) => line.startsWith("data: "));
  return JSON.parse(dataLine ? dataLine.slice(6) : rawBody) as Record<string, unknown>;
}

test("HTTP endpoint authenticates, filters tools and performs a guarded silent decision", async (context) => {
  const caseId = "00000000-0000-4000-8000-000000000001";
  const changeRequestId = "00000000-0000-4000-8000-000000000002";
  const changes = { projectNumber: "P-2026-9" };
  let applied = false;
  const upstreamCalls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    upstreamCalls.push({ url: String(url), body });
    if (init?.method === "POST") {
      applied = true;
      return Response.json({ ok: true, result: { decision: "APPLY" } });
    }
    return Response.json({
      ok: true,
      billingCase: { id: caseId },
      changes: [{ id: changeRequestId, status: applied ? "APPLIED" : "PENDING", requested_changes: changes }],
    });
  };
  const { app, close } = createGatewayApp({ config: { ...config(), ops: { baseUrl: new URL("https://ops.example.test"), accessClientId: "id", accessClientSecret: "secret" } }, fetchImpl, audit: () => undefined });
  const listener = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => listener.once("listening", resolve));
  context.after(async () => {
    await close();
    await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  });
  const port = (listener.address() as AddressInfo).port;
  const endpoint = `http://127.0.0.1:${port}/mcp`;

  const anonymous = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  assert.equal(anonymous.status, 401);

  const authorized = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "neontrip-mcp-test", version: "1.0.0" },
      },
    }),
  });
  assert.equal(authorized.status, 200);
  const body = parseMcpBody(await authorized.text()) as { result?: { serverInfo?: { name?: string } } };
  assert.equal(body.result?.serverInfo?.name, "neontrip-operations");

  const request = async (method: string, params: Record<string, unknown>) => fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: randomId++, method, params }),
  });
  let randomId = 10;
  const toolsResponse = await request("tools/list", {});
  assert.equal(toolsResponse.status, 200);
  const toolsBody = parseMcpBody(await toolsResponse.text()) as { result?: { tools?: Array<{ name: string }> } };
  const toolNames = toolsBody.result?.tools?.map((tool) => tool.name) || [];
  assert.ok(toolNames.includes("billing_accept_change_request"));
  assert.ok(!toolNames.includes("billing_reject_change_request"));
  assert.ok(!toolNames.includes("offers_send"));
  assert.ok(!toolNames.includes("customers_get_transcript"));
  assert.ok(!toolNames.includes("customers_search"));

  const decisionResponse = await request("tools/call", {
    name: "billing_accept_change_request",
    arguments: {
      caseId,
      changeRequestId,
      expectedRequestedChangesSha256: requestedChangesHash(changes),
      idempotencyKey: "mcp-test-decision-1",
      note: "Automatisch geprüft",
    },
  });
  assert.equal(decisionResponse.status, 200);
  const decisionBody = parseMcpBody(await decisionResponse.text()) as { result?: { isError?: boolean } };
  assert.notEqual(decisionBody.result?.isError, true);
  const actionCall = upstreamCalls.find((call) => call.body?.action === "APPLY_CHANGE_REQUEST");
  assert.equal((actionCall?.body?.payload as Record<string, unknown>)?.notifyCustomer, false);

  const replayResponse = await request("tools/call", {
    name: "billing_accept_change_request",
    arguments: {
      caseId,
      changeRequestId,
      expectedRequestedChangesSha256: requestedChangesHash(changes),
      idempotencyKey: "mcp-test-decision-1",
      note: "Automatisch geprüft",
    },
  });
  assert.equal(replayResponse.status, 200);
  const replayBody = parseMcpBody(await replayResponse.text()) as { result?: { isError?: boolean } };
  assert.notEqual(replayBody.result?.isError, true);
  assert.equal(upstreamCalls.filter((call) => call.body?.action === "APPLY_CHANGE_REQUEST").length, 1);
});

test("offer reader discovers and calls delivery history without granting write tools", async (context) => {
 const cfg=config();
 cfg.identities[0]!.role="operator";
 cfg.identities[0]!.scopes=["system:read","offers:read"];
 cfg.offers={baseUrl:new URL("https://offers.example.test"),apiKey:"test-key"};
 let upstreamUrl="";
 const {app,close}=createGatewayApp({config:cfg,audit:()=>undefined,fetchImpl:async(url)=>{
  upstreamUrl=String(url);return Response.json({ok:true,deliveries:[{id:"attempt-1",status:"SENT",sentAt:"2026-10-27T12:00:00Z"}],hasMore:false});
 }});
 const listener=app.listen(0,"127.0.0.1");
 await new Promise<void>(resolve=>listener.once("listening",resolve));
 context.after(async()=>{await close();await new Promise<void>(resolve=>listener.close(()=>resolve()));});
 const endpoint=`http://127.0.0.1:${(listener.address() as AddressInfo).port}/mcp`;
 let id=1;
 async function call(method:string,params:Record<string,unknown>){
  const response=await fetch(endpoint,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json",accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:id++,method,params})});
  assert.equal(response.status,200);
  return parseMcpBody(await response.text()) as {result?:{tools?:Array<{name:string}>;isError?:boolean}};
 }
 const catalog=await call("tools/list",{});
 const names=catalog.result?.tools?.map(t=>t.name)||[];
 assert.ok(names.includes("offers_list"));
 assert.ok(names.includes("offers_list_deliveries"));
 assert.ok(!names.includes("offers_send"));
 const result=await call("tools/call",{name:"offers_list_deliveries",arguments:{offerId:"c123456789012345678901234",limit:1,sentFrom:"2026-10-27T00:00:00+01:00",sentTo:"2026-10-28T00:00:00+01:00"}});
 assert.notEqual(result.result?.isError,true,JSON.stringify(result));
 assert.equal(new URL(upstreamUrl).searchParams.get("status"),"SENT");
 assert.equal(new URL(upstreamUrl).searchParams.get("channel"),"EMAIL");
 assert.equal(new URL(upstreamUrl).searchParams.get("offerId"),"c123456789012345678901234");
 const offer=await call("tools/call",{name:"offers_get",arguments:{offerId:"c123456789012345678901234"}});
 assert.notEqual(offer.result?.isError,true);
 assert.equal(new URL(upstreamUrl).pathname,"/api/internal/offers/c123456789012345678901234");
});

test("full operator discovers Ops operations; limited automation never inherits them", async (context) => {
 const cfg=config(); cfg.identities[0]!.role="operator";
 cfg.identities[0]!.scopes=["system:read","ops:read","ops:write"] as typeof cfg.identities[0]["scopes"];
 const calls:Array<{url:string;method:string;body:unknown}>=[];
 cfg.ops={baseUrl:new URL("https://ops.example.test"),accessClientId:"id",accessClientSecret:"secret"};
 const {app,close}=createGatewayApp({config:cfg,audit:()=>undefined,fetchImpl:async(url,init)=>{
  if(String(url).endsWith("/tasks"))throw new DOMException("Uncertain test result","AbortError");
  calls.push({url:String(url),method:init?.method||"GET",body:typeof init?.body==="string"?JSON.parse(init.body):null});
  return Response.json({ok:true,results:[]});
 }});
 const listener=app.listen(0,"127.0.0.1"); await new Promise<void>(r=>listener.once("listening",r));
 context.after(async()=>{await close();await new Promise<void>(r=>listener.close(()=>r()));});
 const endpoint="http://127.0.0.1:"+ (listener.address() as AddressInfo).port +"/mcp";
 const call=async(method:string,params:Record<string,unknown>)=>parseMcpBody(await (await fetch(endpoint,{
  method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json",accept:"application/json, text/event-stream"},
  body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})
 })).text()) as any;
 const listed=await call("tools/list",{});
 const names=listed.result.tools.map((t:{name:string})=>t.name);
 assert.ok(names.includes("ops_read"));
 assert.ok(names.includes("ops_write"));
 assert.ok(names.includes("ops_describe_operation"));
 const read=await call("tools/call",{name:"ops_read",arguments:{operation:"customer_records_get",query:{query:"NEON"}}});
 assert.equal(read.result.isError,undefined);
 assert.equal(calls[0]?.url,"https://ops.example.test/api/ops/customer-records?query=NEON");
 const write=await call("tools/call",{name:"ops_write",arguments:{operation:"customer_records_patch",body:{requestId:"REQ-TEST",updates:{company:"Test"}},reason:"Explicit local test"}});
 assert.equal(write.result.isError,undefined);
 assert.equal(calls[1]?.method,"PATCH");
 const blocked=await call("tools/call",{name:"ops_read",arguments:{operation:"customer_records_patch",body:{requestId:"REQ-TEST"}}});
 assert.ok(blocked.error || blocked.result?.isError);
 assert.equal(calls.length,2);
 const resolve=await call("tools/call",{name:"ops_write",arguments:{operation:"company_brain_resolve_get",reason:"Explicit local test"}});
 assert.equal(resolve.result.isError,undefined);
 assert.equal(calls[2]?.method,"GET");
 assert.equal(calls[2]?.body,null);
 const uncertain=await call("tools/call",{name:"ops_write",arguments:{operation:"tasks_post",body:{action:"create"},reason:"Explicit local test"}});
 assert.equal(uncertain.result.isError,true);
 assert.equal(uncertain.result.structuredContent.error.code,"upstream_timeout");
 assert.equal(uncertain.result.structuredContent.error.retryable,false);
 assert.equal(uncertain.result.structuredContent.error.requiresHumanReview,true);
 cfg.identities[0]!.role="billing_automation"; cfg.identities[0]!.scopes=["system:read"];
 const limited=await call("tools/list",{});
 assert.equal(limited.result.tools.some((t:{name:string})=>t.name.startsWith("ops_")),false);
});

test("full Offers catalog is discovered dynamically and preserves native errors and media", async (context) => {
 const cfg=config(); cfg.identities[0]!.role="operator"; cfg.identities[0]!.scopes=["system:read","offers:full"];
 cfg.offers={baseUrl:new URL("https://offers.example.test"),apiKey:"internal-key-not-for-native"};
 let catalogAvailable=true;
 const audited: unknown[]=[];
 const {app,close}=createGatewayApp({config:cfg,audit:e=>audited.push(e),fetchImpl:async(_url,init)=>{
  assert.equal(new Headers(init?.headers).get("authorization"),"Bearer "+token);
  const req=JSON.parse(String(init?.body));
  if(req.method==="tools/list" && !catalogAvailable)return Response.json({jsonrpc:"2.0",id:1,result:{tools:[]}});
  if(req.method==="tools/list")return Response.json({jsonrpc:"2.0",id:1,result:{tools:[{name:"offers_media_get",description:"Get media",inputSchema:{type:"object",properties:{id:{type:"string"}},required:["id"],additionalProperties:false},annotations:{readOnlyHint:true}},{name:"offers_create",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:false}}]}});
  return Response.json({jsonrpc:"2.0",id:1,result:req.params.name==="offers_create"?{content:[{type:"text",text:"Version conflict"}],isError:true}:{content:[{type:"image",data:"AA==",mimeType:"image/png"}]}});
 }});
 const listener=app.listen(0,"127.0.0.1"); await new Promise<void>(r=>listener.once("listening",r));
 context.after(async()=>{await close();await new Promise<void>(r=>listener.close(()=>r()));});
 const endpoint="http://127.0.0.1:"+(listener.address() as AddressInfo).port+"/mcp";
 const call=async(method:string,params:Record<string,unknown>)=>parseMcpBody(await(await fetch(endpoint,{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json",accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})})).text()) as any;
 const list=await call("tools/list",{});
 assert.ok(list.result.tools.some((t:any)=>t.name==="editor_offers_create"));
 const media=await call("tools/call",{name:"editor_offers_media_get",arguments:{id:"test"}});
 assert.deepEqual(media.result.content,[{type:"image",data:"AA==",mimeType:"image/png"}]);
 const failed=await call("tools/call",{name:"editor_offers_create",arguments:{}});
 assert.equal(failed.result.isError,true);
 assert.ok(audited.some((e:any)=>e.capability==="editor_offers_create" && e.outcome!=="success"));
 catalogAvailable=false;
 const health=await call("tools/call",{name:"neontrip_health",arguments:{}});
 assert.equal(health.result.structuredContent.data.ready,false);
 const capabilities=await call("tools/call",{name:"neontrip_capabilities",arguments:{}});
 assert.equal(capabilities.result.structuredContent.data.readiness.ready,false);
});
