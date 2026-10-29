import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { createGatewayApp } from "../src/server.js";

test("billing record tool discovers read access and validates collection pages before upstream", async t => {
  const token="synthetic-billing-read";
  const config=loadConfig({NODE_ENV:"test",MCP_PUBLIC_URL:"http://127.0.0.1:8787/mcp",MCP_REQUIRED_SERVICES:"",MCP_IDENTITIES_JSON:JSON.stringify([{clientId:"billing-reader",actor:"test",role:"operator",scopes:["system:read","billing:read"],tokenSha256:createHash("sha256").update(token).digest("hex"),expiresAt:Math.floor(Date.now()/1000)+3600}])});
  config.ops={baseUrl:new URL("https://ops.invalid"),accessClientId:"test",accessClientSecret:"test"};
  const calls: URL[]=[];
  const {app,close}=createGatewayApp({config,audit:()=>undefined,fetchImpl:async(url,init)=>{
    assert.equal(init?.method,"GET");calls.push(new URL(String(url)));
    return Response.json({ok:true,collection:"documents",records:[],pagination:{nextOffset:null}});
  }});
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
  t.after(async()=>{await close();await new Promise<void>(r=>server.close(()=>r()));});
  async function rpc(method:string,params:Record<string,unknown>){
    const response=await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json",accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});
    const raw=await response.text(),line=raw.split("\n").find(x=>x.startsWith("data: "));
    return JSON.parse(line?line.slice(6):raw);
  }
  const catalog=await rpc("tools/list",{}),names=catalog.result.tools.map((x:{name:string})=>x.name);
  assert.ok(names.includes("billing_list_case_records"));assert.ok(!names.includes("billing_apply_action"));
  const capabilities=await rpc("tools/call",{name:"neontrip_capabilities",arguments:{}});
  assert.ok(capabilities.result.structuredContent.data.capabilities.some((x:{name:string})=>x.name==="billing_list_case_records"));
  const args={caseId:"00000000-0000-4000-8000-000000000000",collection:"documents",limit:2,offset:1000};
  const valid=await rpc("tools/call",{name:"billing_list_case_records",arguments:args});
  assert.notEqual(valid.result?.isError,true);assert.equal(calls.length,1);
  assert.equal(calls[0].searchParams.get("collection"),"documents");assert.equal(calls[0].searchParams.get("offset"),"1000");
  for(const invalid of [{collection:"raw_table"},{offset:-1},{limit:201}]){
    const result=await rpc("tools/call",{name:"billing_list_case_records",arguments:{...args,...invalid}});
    assert.ok(result.error||result.result?.isError);
  }
  assert.equal(calls.length,1,"invalid pages must not read or write upstream");
});
