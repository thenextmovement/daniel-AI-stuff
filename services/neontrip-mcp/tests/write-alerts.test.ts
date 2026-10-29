import assert from "node:assert/strict";
import test from "node:test";
import { notifyWriteFailure } from "../src/write-alerts.js";
test("write alert metadata is actor-bound, stable and never includes arguments",async()=>{
 const notices:unknown[]=[];const notify=async(n:unknown)=>{notices.push(n);return {status:"provider_accepted",deliveryConfirmed:false}};
 const input={clientId:"a",tool:"ops_write",args:{body:{idempotencyKey:"stable",secret:"private"}},correlationId:"one",code:"upstream_timeout",notify};
 const a=await notifyWriteFailure(input),b=await notifyWriteFailure({...input,correlationId:"two"});
 assert.equal(a.actionId,b.actionId);assert.notEqual(a.actionId,(await notifyWriteFailure({...input,clientId:"b"})).actionId);
 assert.doesNotMatch(JSON.stringify(notices),/private|stable/);
 assert.equal((notices[0] as {code:string}).code,"MCP_UPSTREAM_TIMEOUT");
});
test("relay failures remain explicit and cannot mask business failure",async()=>{
 const r=await notifyWriteFailure({clientId:"a",tool:"ops_write",args:{},correlationId:"one",code:"secret@example.com",notify:async()=>{throw Error("credential")}});
 assert.deepEqual(r.failureNotification,{status:"unknown",deliveryConfirmed:false});assert.doesNotMatch(JSON.stringify(r),/credential|secret/);
});

import { NeontripApi } from "../src/upstream.js";
import { loadConfig } from "../src/config.js";
test("relay uses fixed authenticated origin, bounded timeout, and returns only status",async()=>{
 const config=loadConfig({NODE_ENV:"test",MCP_IDENTITIES_JSON:JSON.stringify([{clientId:"test",actor:"test",role:"operator",scopes:["system:read"],tokenSha256:"a".repeat(64),expiresAt:Math.floor(Date.now()/1000)+3600}])});
 config.offers={baseUrl:new URL("https://offers.invalid"),apiKey:"test-key"};
 let calls=0;
 const api=new NeontripApi(config,async(url,init)=>{calls++;assert.equal(String(url),"https://offers.invalid/api/internal/mcp-alerts");assert.equal((init?.headers as Record<string,string>).Authorization,"Bearer test-key");assert.equal(init?.redirect,"error");assert.ok(init?.signal);return Response.json({ok:true,failureNotification:{status:"provider_accepted",deliveryConfirmed:false,secret:"discard"}})});
 assert.deepEqual(await api.notifyWriteFailure({tool:"ops_write",actionId:"a".repeat(64),code:"MCP_BLOCKED"}),{status:"provider_accepted",deliveryConfirmed:false});assert.equal(calls,1);
 const failed=new NeontripApi(config,async()=>{throw Error("private")});assert.deepEqual(await failed.notifyWriteFailure({tool:"ops_write",actionId:"a".repeat(64),code:"MCP_BLOCKED"}),{status:"unknown",deliveryConfirmed:false});
});
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createGatewayApp } from "../src/server.js";
import { OPS_OPERATIONS } from "../src/ops-catalog.js";
test("HTTP write catch reports failure once while read catch sends no alert",async t=>{
 const token="test-alert-only-token";
 const config=loadConfig({NODE_ENV:"test",MCP_PUBLIC_URL:"http://127.0.0.1:8787/mcp",MCP_REQUIRED_SERVICES:"",MCP_IDENTITIES_JSON:JSON.stringify([{clientId:"alert",actor:"tester",role:"operator",scopes:["ops:read","ops:write"],tokenSha256:createHash("sha256").update(token).digest("hex"),expiresAt:Math.floor(Date.now()/1000)+3600}])});
 config.offers={baseUrl:new URL("https://offers.invalid"),apiKey:"test-key"};config.ops={baseUrl:new URL("https://ops.invalid"),accessClientId:"test",accessClientSecret:"test"};
 let alerts=0,business=0,alertTool="";
 const {app,close}=createGatewayApp({config,audit:()=>undefined,fetchImpl:async(url,init)=>{
  if(String(url).endsWith("/api/internal/mcp-alerts")){alerts++;alertTool=JSON.parse(String(init?.body)).tool;return Response.json({ok:true,failureNotification:{status:"unknown",deliveryConfirmed:false}})}
  business++;throw Error("not connected");
 }});
 const listener=app.listen(0,"127.0.0.1");await new Promise<void>(r=>listener.once("listening",r));t.after(async()=>{await close();await new Promise<void>(r=>listener.close(()=>r()))});
 for(const readOnly of [true,false]){
 const op=OPS_OPERATIONS.find(x=>x.readOnly===readOnly && x.pathParameters.length===0)!;
 const response=await fetch(`http://127.0.0.1:${(listener.address() as AddressInfo).port}/mcp`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json",accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:readOnly?"ops_read":"ops_write",arguments:{operation:op.id,...(readOnly?{}:{reason:"controlled test"})}}})});
 const raw=await response.text();const line=raw.split("\n").find(x=>x.startsWith("data: "));const result=JSON.parse(line?line.slice(6):raw).result;
 assert.equal(result.isError,true);assert.equal(alerts,readOnly?0:1);
 if(!readOnly){assert.deepEqual(result.structuredContent.failureNotification,{status:"unknown",deliveryConfirmed:false});assert.equal(alertTool,"ops_"+op.id);}
 }
 assert.equal(business,2);
});
