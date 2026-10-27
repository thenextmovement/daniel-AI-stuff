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
