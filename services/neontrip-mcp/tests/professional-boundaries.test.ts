import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { type AddressInfo } from "node:net";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { HashedTokenVerifier } from "../src/auth.js";
import { createGatewayApp } from "../src/server.js";
import { NeontripApi } from "../src/upstream.js";
import { asJsonValue } from "../src/safety.js";

const token = "local-professional-audit-token";
function config() {
  return loadConfig({ NODE_ENV:"test", MCP_PUBLIC_URL:"http://127.0.0.1:8787/mcp",
    MCP_REQUIRED_SERVICES:"", MCP_IDENTITIES_JSON:JSON.stringify([{
      clientId:"audit", actor:"audit@test.invalid", role:"operator", scopes:["system:read"],
      tokenSha256:createHash("sha256").update(token).digest("hex"), expiresAt:Math.floor(Date.now()/1000)+3600,
    }]),
  });
}
test("gateway rejects foreign browser origins while native requests remain usable",async t=>{
  const cfg=config(); cfg.host="0.0.0.0"; const {app,close}=createGatewayApp({config:cfg,audit:()=>undefined});
  const server=app.listen(0,"127.0.0.1"); await new Promise<void>(r=>server.once("listening",r));
  t.after(async()=>{await close(); await new Promise<void>(r=>server.close(()=>r()));});
  const endpoint=`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  const headers={authorization:`Bearer ${token}`,"content-type":"application/json",accept:"application/json, text/event-stream"};
  const body=JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list",params:{}});
  assert.equal((await fetch(endpoint,{method:"POST",headers:{...headers,origin:"https://foreign.invalid"},body})).status,403);
  assert.equal((await fetch(endpoint,{method:"POST",headers,body})).status,200);
  assert.equal((await fetch(endpoint,{method:"POST",headers:{...headers,origin:cfg.publicUrl.origin},body})).status,200);
});
test("malformed JSON reports a client error without leaking parser internals",async t=>{
  const {app,close}=createGatewayApp({config:config(),audit:()=>undefined});
  const server=app.listen(0,"127.0.0.1"); await new Promise<void>(r=>server.once("listening",r));
  t.after(async()=>{await close(); await new Promise<void>(r=>server.close(()=>r()));});
  const r=await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`,{
    method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:'{"privateCustomerText":',
  });
  assert.equal(r.status,400);
  assert.deepEqual(await r.json(),{error:"invalid_json"});
});
test("one expired identity does not take active accounts offline after restart",async()=>{
  const base=config(); const active=base.identities[0]!;
  const expired={...active,clientId:"expired",tokenSha256:createHash("sha256").update("old-token").digest("hex"),expiresAt:1};
  const cfg=loadConfig({NODE_ENV:"test",MCP_IDENTITIES_JSON:JSON.stringify([expired,active])});
  const verifier=new HashedTokenVerifier(cfg.identities,cfg.publicUrl);
  assert.equal((await verifier.verifyAccessToken(token)).clientId,"audit");
  await assert.rejects(()=>verifier.verifyAccessToken("old-token"));
});
test("capability metadata omits absent fields instead of claiming an undefined error",()=>{
  assert.deepEqual(asJsonValue({ok:true,error:undefined,entries:[undefined,null]}),{ok:true,entries:[null,null]});
});
test("live health identifies the exact deployed commit without reporting untrusted build text",async t=>{
  const cfg=config();
  const release=loadConfig({NODE_ENV:"test",MCP_PUBLIC_URL:"http://127.0.0.1:8787/mcp",SOURCE_COMMIT:"a".repeat(40),MCP_IDENTITIES_JSON:JSON.stringify(cfg.identities)});
  const {app,close}=createGatewayApp({config:release,audit:()=>undefined});
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
  t.after(async()=>{await close();await new Promise<void>(r=>server.close(()=>r()));});
  const response=await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/health/live`);
  assert.deepEqual(await response.json(),{ok:true,commit:"a".repeat(40)});
  assert.throws(()=>loadConfig({NODE_ENV:"test",SOURCE_COMMIT:"not-a-commit",MCP_IDENTITIES_JSON:JSON.stringify(cfg.identities)}));
});
test("native RPC replies must match the request ID",async()=>{
  const cfg=config();cfg.offers={baseUrl:new URL("https://offers.test.invalid"),apiKey:"test"};
  const api=new NeontripApi(cfg,async()=>Response.json({jsonrpc:"2.0",id:99,result:{tools:[]}}));
  await assert.rejects(()=>api.nativeOffers(token,"tools/list",{}),{code:"native_offers_protocol_error"});
});
test("oversized chunked upstream responses stop reading and cancel the stream",async()=>{
  const cfg=config(); cfg.maxResponseBytes=10000;
  cfg.ops={baseUrl:new URL("https://ops.test.invalid"),accessClientId:"test",accessClientSecret:"test"};
  let pulled=0,cancelled=false;
  const stream=new ReadableStream<Uint8Array>({
    pull(c){pulled++;c.enqueue(new Uint8Array(6000));if(pulled===20)c.close();},
    cancel(){cancelled=true;},
  },{highWaterMark:0});
  const api=new NeontripApi(cfg,async()=>new Response(stream,{headers:{"content-type":"application/json"}}));
  await assert.rejects(()=>api.listBillingCases({limit:1}),{code:"upstream_response_too_large"});
  assert.ok(pulled<=3,`read ${pulled} chunks beyond configured response limit`);
  assert.equal(cancelled,true);
});

test("Ops attachments preserve non-image bytes as MCP resources without mistaking login pages for files",async t=>{
  const cfg=config(); cfg.identities[0]!.scopes=["ops:read"];
  cfg.ops={baseUrl:new URL("https://ops.test.invalid"),accessClientId:"test",accessClientSecret:"test"};
  let mime="application/zip", disposition=true;
  const bytes=new Uint8Array([80,75,3,4,0,255,17]);
  const {app,close}=createGatewayApp({config:cfg,audit:()=>undefined,fetchImpl:async()=>new Response(bytes,{
    headers:{"content-type":mime,...(disposition?{"content-disposition":'inline; filename="test.zip"'}:{})},
  })});
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
  t.after(async()=>{await close();await new Promise<void>(r=>server.close(()=>r()));});
  const endpoint=`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  async function call(){
    const response=await fetch(endpoint,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json",accept:"application/json, text/event-stream"},
      body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"ops_read",arguments:{operation:"customer_records_trello_attachments_get",query:{cardId:"a".repeat(24),attachmentId:"b".repeat(24)}}}}),
    });
    const raw=await response.text();return JSON.parse(raw.startsWith('event:')?raw.split('\n').find(l=>l.startsWith('data: '))!.slice(6):raw).result;
  }
  const zip=await call();assert.equal(zip.isError,undefined);
  const resource=zip.content.find((c:{type:string})=>c.type==="resource").resource;
  assert.equal(resource.mimeType,"application/zip");
  assert.deepEqual(Buffer.from(resource.blob,"base64"),Buffer.from(bytes));
  mime="image/svg+xml";
  const svg=await call();assert.equal(svg.isError,undefined);
  assert.equal(svg.content.find((c:{type:string})=>c.type==="resource").resource.mimeType,"application/octet-stream");
  assert.equal(svg.structuredContent.data.originalMimeType,"image/svg+xml");
  mime="text/html";disposition=false;
  const login=await call();assert.equal(login.isError,true);
  assert.equal(login.structuredContent.error.code,"invalid_upstream_content_type");
});

test("generic writes audit target IDs and a private reason fingerprint",async t=>{
  const cfg=config();cfg.identities[0]!.scopes=["ops:write"];
  cfg.ops={baseUrl:new URL("https://ops.test.invalid"),accessClientId:"test",accessClientSecret:"test"};
  const audit:unknown[]=[];
  const {app,close}=createGatewayApp({config:cfg,audit:r=>audit.push(r),fetchImpl:async()=>Response.json({ok:true})});
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
  t.after(async()=>{await close();await new Promise<void>(r=>server.close(()=>r()));});
  const reason="Authorized correction; private customer context";
  await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json",accept:"application/json, text/event-stream"},
    body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"ops_write",arguments:{operation:"company_brain_decisions_decisionId_review_post",pathParameters:{decisionId:"test-decision"},body:{action:"submit"},reason}}}),
  });
  assert.equal(audit.length,1);
  const record=audit[0] as {target:Record<string,string>;reasonSha256:string};
  assert.equal(record.target["path.decisionId"],"test-decision");
  assert.equal(record.reasonSha256,createHash("sha256").update(reason).digest("hex"));
  assert.equal(JSON.stringify(record).includes(reason),false);
  assert.equal(JSON.stringify(record).includes(token),false);
  await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json",accept:"application/json, text/event-stream"},
    body:JSON.stringify({jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"ops_write",arguments:{operation:"company_brain_decisions_decisionId_review_post",pathParameters:{decisionId:"test-decision",customerEmail:"private@example.invalid"},body:{action:"submit"},reason}}}),
  });
  assert.equal(audit.length,2);
  assert.equal(JSON.stringify(audit).includes("private@example.invalid"),false);
  assert.equal((audit[1] as {outcome:string}).outcome,"denied");
  await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json",accept:"application/json, text/event-stream"},
    body:JSON.stringify({jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"ops_write",arguments:{operation:"company_brain_decisions_decisionId_review_post",pathParameters:{decisionId:"private@example.invalid"},body:{action:"submit"},reason}}}),
  });
  assert.equal(audit.length,3);
  assert.equal(JSON.stringify(audit).includes("private@example.invalid"),false,"free text in an ID field must not enter audit logs");
});
