import test from "node:test";
import assert from "node:assert/strict";
import type {RuntimeConfig} from "../../services/voice-runtime/config";
import {createHmac} from "node:crypto";
import {browserPhoneReady,browserPhoneToken} from "../../services/voice-runtime/phone-token";
const deviceId="29500000-0000-4000-8000-000000000101",staffId="29500000-0000-4000-8000-000000000001";
const config={teamPhoneEnabled:true,twilioAccountSid:"AC"+"1".repeat(32),twilioApiKeySid:"SK"+"2".repeat(32),twilioApiKeySecret:"synthetic-signing-secret",twilioPhoneAppSid:"AP"+"3".repeat(32)} as RuntimeConfig;
test("browser token is short-lived and binds the exact revalidated personal device",async()=>{
 const now=Date.now();let lookups=0;
 const ops={getPhoneDevice:async(d:string,s:string)=>{lookups++;assert.equal(d,deviceId);assert.equal(s,staffId);return {deviceId,staffId,expiresAt:new Date(now+3600000).toISOString()};}} as never;
 const result=await browserPhoneToken(config,ops,{deviceId,staffId,identity:"another-person"});
 const [head,payload,signature]=result.token.split(".");
 const parsed=JSON.parse(Buffer.from(payload,"base64url").toString());
 assert.equal(result.identity,"ntd_"+deviceId.replace(/-/g,""));
 assert.equal(parsed.grants.identity,result.identity);
 assert.equal(parsed.grants.voice.incoming.allow,true);
 assert.equal(parsed.grants.voice.outgoing.application_sid,config.twilioPhoneAppSid);
 assert.equal(parsed.exp-parsed.iat,600);
 assert.equal(signature,createHmac("sha256",config.twilioApiKeySecret).update(head+"."+payload).digest("base64url"));
 assert.equal(lookups,1);assert(!result.token.includes(config.twilioApiKeySecret));
});
test("revoked or mismatched devices and disabled phone configuration cannot receive tokens",async()=>{
 assert.equal(browserPhoneReady({...config,teamPhoneEnabled:false}),false);
 let lookups=0;
 const ops={getPhoneDevice:async()=>{lookups++;return {deviceId:"other",staffId,expiresAt:new Date(Date.now()+600000).toISOString()};}} as never;
 await assert.rejects(browserPhoneToken({...config,teamPhoneEnabled:false},ops,{deviceId,staffId}),/not_configured/);
 await assert.rejects(browserPhoneToken(config,ops,{deviceId:"Rahim",staffId}),/invalid_phone_identity/);
 assert.equal(lookups,0);
 await assert.rejects(browserPhoneToken(config,ops,{deviceId,staffId}),/phone_identity_not_current/);
 await assert.rejects(browserPhoneToken(config,{getPhoneDevice:async()=>{throw Error("device_revoked");}} as never,{deviceId,staffId}),/device_revoked/);
});
test("a device near expiry receives no token beyond its own validity",async()=>{
 const now=Date.now(),ops={getPhoneDevice:async()=>({deviceId,staffId,expiresAt:new Date(now+120000).toISOString()})} as never;
 const result=await browserPhoneToken(config,ops,{deviceId,staffId});
 const payload=JSON.parse(Buffer.from(result.token.split(".")[1],"base64url").toString());
 assert(payload.exp-payload.iat<=120 && payload.exp-payload.iat>=115);
 assert(payload.exp*1000<=now+120000);
 await assert.rejects(browserPhoneToken(config,{getPhoneDevice:async()=>({deviceId,staffId,expiresAt:new Date(now+10000).toISOString()})} as never,{deviceId,staffId}),/phone_identity_not_current/);
});
