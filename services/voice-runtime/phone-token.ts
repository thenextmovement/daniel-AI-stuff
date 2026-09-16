import twilio from "twilio";
import type { RuntimeConfig } from "./config.js";
import type { OpsClient } from "./ops-client.js";
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function browserPhoneReady(config:RuntimeConfig) {
  return config.teamPhoneEnabled && /^AC[a-f0-9]{32}$/i.test(config.twilioAccountSid) &&
    /^SK[a-f0-9]{32}$/i.test(config.twilioApiKeySid) && !!config.twilioApiKeySecret &&
    /^AP[a-f0-9]{32}$/i.test(config.twilioPhoneAppSid);
}
export async function browserPhoneToken(config:RuntimeConfig,ops:OpsClient,input:Record<string,unknown>) {
  if(!browserPhoneReady(config))throw new Error("browser_phone_not_configured");
  const deviceId=input.deviceId,staffId=input.staffId;
  if(typeof deviceId!=="string" || typeof staffId!=="string" || !UUID.test(deviceId) || !UUID.test(staffId))
    throw new Error("invalid_phone_identity");
  const device=await ops.getPhoneDevice(deviceId,staffId);
  // Recompute after the eligibility lookup; leave room for a signing-second boundary.
  const expiry=Math.floor(Date.parse(device.expiresAt)/1000);
  const ttl=Math.min(600,expiry-Math.floor(Date.now()/1000)-2);
  if(device.deviceId!==deviceId || device.staffId!==staffId || !Number.isFinite(ttl) || ttl<60)
    throw new Error("phone_identity_not_current");
  const identity="ntd_"+deviceId.replace(/-/g,"").toLowerCase();
  const token=new twilio.jwt.AccessToken(config.twilioAccountSid,config.twilioApiKeySid,config.twilioApiKeySecret,{identity,ttl});
  token.addGrant(new twilio.jwt.AccessToken.VoiceGrant({incomingAllow:true,outgoingApplicationSid:config.twilioPhoneAppSid}));
  const signed=token.toJwt();
  const signedExpiry=JSON.parse(Buffer.from(signed.split(".")[1],"base64url").toString()).exp;
  if(!Number.isInteger(signedExpiry) || signedExpiry>expiry)throw new Error("phone_identity_not_current");
  return {token:signed,identity,expiresAt:new Date(signedExpiry*1000).toISOString()};
}
