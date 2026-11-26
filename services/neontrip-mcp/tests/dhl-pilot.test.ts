import test from "node:test";
import assert from "node:assert/strict";
import type {AddressInfo} from "node:net";
import {createPilot} from "../src/dhl-pilot.js";
test("local pilot rejects cross-origin calls, arbitrary tools and missing CSRF header",async(t)=>{
 const pilot=await createPilot({token:"test-only",saveCredentials:()=>{}});
 const listener=pilot.app.listen(0,"127.0.0.1");await new Promise<void>(r=>listener.once("listening",r));
 t.after(async()=>{await pilot.close();await new Promise<void>(r=>listener.close(()=>r()));});
 const url="http://127.0.0.1:"+(listener.address() as AddressInfo).port;
 assert.equal((await fetch(url+"/pilot/current")).status,403);
 assert.equal((await fetch(url+"/pilot/current",{headers:{"x-dhl-pilot":"1",origin:"https://evil.example"}})).status,403);
 const p=await fetch(url+"/pilot/current",{headers:{"x-dhl-pilot":"1"}}).then(r=>r.json());assert.equal(p.mode,"preview");assert.equal(p.offers.length,0);
 const bad=await fetch(url+"/pilot/tool",{method:"POST",headers:{"x-dhl-pilot":"1","content-type":"application/json"},body:JSON.stringify({name:"dhl_create_shipment",arguments:{}})});assert.equal(bad.status,400);
 assert.equal((await fetch(url+"/pilot/settings",{method:"POST",headers:{"content-type":"application/json"},body:"{}"})).status,403);
});
