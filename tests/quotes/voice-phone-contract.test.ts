import test from "node:test";
import assert from "node:assert/strict";
import {newPhoneCredential,phoneCredentialHash,phoneDeviceLabel,phoneDeviceIsCurrent,phonePresence,phoneRequestIsSameOrigin} from "../../src/lib/ops/voice-phone-contract";

test("personal device and invite credentials are random, canonical and purpose-separated",()=>{
 const a=newPhoneCredential(),b=newPhoneCredential();
 assert.notEqual(a,b);assert.equal(a.length,43);
 assert.match(phoneCredentialHash(a,"device")!,/^[a-f0-9]{64}$/);
 assert.notEqual(phoneCredentialHash(a,"device"),phoneCredentialHash(a,"invite"));
 for(const invalid of [null,{},a+"=",a.slice(1),"Rahim","ops-session"])assert.equal(phoneCredentialHash(invalid,"device"),null);
 const noncanonical=a.slice(0,-1)+"B";
 assert.equal(phoneCredentialHash(noncanonical,"device"),null);
});
test("device labels cannot substitute identities and reject invisible control characters",()=>{
 assert.equal(phoneDeviceLabel("  Browser im Büro  "),"Browser im Büro");
 for(const input of [null,"","a","a".repeat(81),"Browser\nRahim"])assert.throws(()=>phoneDeviceLabel(input));
});
test("revoked, expired or malformed device sessions are invalid",()=>{
 const now=Date.parse("2026-09-16T12:00:00Z");
 assert.equal(phoneDeviceIsCurrent({expires_at:"2026-09-17T12:00:00Z",revoked_at:null},now),true);
 for(const device of [
  {expires_at:"2026-09-16T12:00:00Z",revoked_at:null},
  {expires_at:"invalid",revoked_at:null},
  {expires_at:"2026-09-17T12:00:00Z",revoked_at:"2026-09-16T11:00:00Z"},
 ])assert.equal(phoneDeviceIsCurrent(device,now),false);
});
test("team presence requires a fresh registered personal device, not a stored name",()=>{
 const now=Date.parse("2026-09-16T12:00:00Z");
 const base={expires_at:"2026-09-17T12:00:00Z",revoked_at:null,registered:true,available:true,last_seen_at:"2026-09-16T11:59:40Z"};
 assert.equal(phonePresence([base],now),"available");
 assert.equal(phonePresence([{...base,available:false}],now),"away");
 for(const device of [
  {...base,registered:false},{...base,last_seen_at:null},{...base,last_seen_at:"2026-09-16T11:59:00Z"},
  {...base,last_seen_at:"2026-09-16T12:01:00Z"},{...base,revoked_at:"2026-09-16T11:50:00Z"},
 ])assert.equal(phonePresence([device],now),"offline");
 assert.equal(phonePresence([{...base,available:false},base],now),"available");
});

test("phone enrollment and logout reject cross-origin and malformed requests",()=>{
 assert.equal(phoneRequestIsSameOrigin("https://ops.example.test","ops.example.test","same-origin",true),true);
 assert.equal(phoneRequestIsSameOrigin("http://localhost:3000","localhost:3000",null,false),true);
 for(const args of [
  ["https://evil.example.test","ops.example.test","cross-site",true],
  ["http://ops.example.test","ops.example.test","same-origin",true],
  ["https://ops.example.test/anything","ops.example.test","same-origin",true],
  [null,"ops.example.test",null,true],["invalid","ops.example.test",null,true],
 ] as const)assert.equal(phoneRequestIsSameOrigin(args[0],args[1],args[2],args[3]),false);
});
