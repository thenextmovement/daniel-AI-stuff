import { createHash, randomBytes } from "node:crypto";

export const PHONE_DEVICE_COOKIE = "neontrip_phone_device";
export const PHONE_DEVICE_SECONDS = 30 * 24 * 60 * 60;
export type PhoneStaff = {
  id: string; displayName: string; extension: string | null;
};
export type PhoneDevice = {
  id: string; label: string; available: boolean; registered: boolean; expiresAt: string;
};
export type PhoneTeamMember = PhoneStaff & { receiveVia?:"browser"|"mobile";presence: "available" | "away" | "offline" | "busy" };
export type PhoneIdentity = {
  enabled: boolean;
  browserCallingAvailable: boolean;
  mobileCallingAvailable?: boolean;
  mobilePhone?: string|null;
  mobileTransfersAvailable?:boolean;
  mobileReceiving?:boolean;
  profile: PhoneStaff | null;
  device: PhoneDevice | null;
  team: PhoneTeamMember[];
  personalAccessAvailable: boolean;
  canManagePhone?: boolean;
};

export function newPhoneCredential() { return randomBytes(32).toString("base64url"); }
export function phoneCredentialHash(value: unknown, purpose: "device" | "invite"): string | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value) ||
      Buffer.from(value, "base64url").toString("base64url") !== value) return null;
  return createHash("sha256").update("neontrip:voice:" + purpose + ":" + value).digest("hex");
}
export function phoneDeviceLabel(value: unknown) {
  if (typeof value !== "string" || value.trim().length < 2 || value.trim().length > 80 ||
      /[\u0000-\u001f\u007f]/.test(value)) throw new Error("invalid_device_label");
  return value.trim();
}
export function phoneDeviceIsCurrent(device: {expires_at: string; revoked_at: string | null}, now = Date.now()) {
  return !device.revoked_at && Number.isFinite(Date.parse(device.expires_at)) && Date.parse(device.expires_at) > now;
}
export function phonePresence(devices: Array<{
  expires_at: string; revoked_at: string | null; last_seen_at: string | null; registered: boolean; available: boolean;
}>, now = Date.now()): PhoneTeamMember["presence"] {
  const online = devices.filter(device => phoneDeviceIsCurrent(device, now) && device.registered &&
    device.last_seen_at && Date.parse(device.last_seen_at) <= now + 5000 && Date.parse(device.last_seen_at) > now - 45000);
  return online.some(device => device.available) ? "available" : online.length ? "away" : "offline";
}

export function phoneRequestIsSameOrigin(origin:string|null,host:string|null,fetchSite:string|null,secure:boolean) {
  if(!origin || !host || !["same-origin","none",null].includes(fetchSite))return false;
  try {
    const url=new URL(origin);
    return url.origin===origin && url.host===host &&
      (secure ? url.protocol==="https:" : ["http:","https:"].includes(url.protocol));
  } catch {return false;}
}
