import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { createGatewayApp } from "../src/server.js";

test("own conversion scope exposes only fixed invoice conversion, never payment actions", async t => {
 const token="synthetic-invoice-token";
 const config=loadConfig({NODE_ENV:"test",MCP_PUBLIC_URL:"http://127.0.0.1:8787/mcp",MCP_REQUIRED_SERVICES:"",MCP_IDENTITIES_JSON:JSON.stringify([{clientId:"hermes-klara",actor:"hermes-klara@neontrip",role:"operator",scopes:["system:read","billing:read","billing:invoice:create"],tokenSha256:createHash("sha256").update(token).digest("hex"),expiresAt:Math.floor(Date.now()/1000)+3600}])});
 config.ops={baseUrl:new URL("https://ops.invalid"),accessClientId:"test",accessClientSecret:"test"};
 const calls: {url: URL;body: Record<string,unknown>}[]=[];
 const {app,close}=createGatewayApp({config,audit:()=>undefined,fetchImpl:async(url,init)=>{
  const target=new URL(String(url));assert.equal(target.origin,"https://ops.invalid");assert.equal(init?.method,"POST");
  calls.push({url:target,body:JSON.parse(String(init?.body))});
  return Response.json({ok:true,result:{status:"INVOICE_PENDING",duplicate:false}});
 }});
 const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
 t.after(async()=>{await close();await new Promise<void>(r=>server.close(()=>r()));});
 async function rpc(method:string,params:Record<string,unknown>){
  const response=await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json",accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});
  const raw=await response.text(),line=raw.split("\n").find(x=>x.startsWith("data: "));return JSON.parse(line?line.slice(6):raw);
 }
 const catalog=await rpc("tools/list",{}),names=catalog.result.tools.map((x:{name:string})=>x.name);
 assert.ok(names.includes("billing_convert_proforma"));
 for(const forbidden of ["billing_apply_action","ops_write","billing_accept_change_request"]) assert.ok(!names.includes(forbidden));
 const args={caseId:"00000000-0000-4000-8000-000000000000",expectedRevision:0,expectedUpdatedAt:"2026-11-06T10:00:00.123456Z",customerRequestConfirmed:true,customerRequestRef:"outlook:synthetic-request",idempotencyKey:"synthetic-invoice-1"};
 for(const patch of [{customerRequestConfirmed:false},{customerRequestRef:""},{expectedRevision:-1},{expectedUpdatedAt:"yesterday"},{action:"MARK_PAID"},{paid:true},{actor:"other-person"}]){
  const result=await rpc("tools/call",{name:"billing_convert_proforma",arguments:{...args,...patch}});assert.ok(result.error||result.result?.isError);
 }
 assert.equal(calls.length,0);
 const valid=await rpc("tools/call",{name:"billing_convert_proforma",arguments:args});
 assert.notEqual(valid.result?.isError,true);assert.equal(calls.length,1);
 assert.equal(calls[0].url.pathname,`/api/ops/billing/${args.caseId}/invoice`);
 assert.equal(calls[0].body.actor,"hermes-klara@neontrip");assert.equal(calls[0].body.expectedUpdatedAt,args.expectedUpdatedAt);
 await rpc("tools/call",{name:"billing_apply_action",arguments:{caseId:args.caseId,action:"MARK_PAID",idempotencyKey:"test-payment-1"}});
 assert.equal(calls.length,1,"payment scope is absent");
});
