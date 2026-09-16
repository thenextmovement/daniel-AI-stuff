import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { validateCloudflareAccess } from "./auth";
import { supabaseRequest, supabaseRpc, SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";
import { PHONE_DEVICE_COOKIE, newPhoneCredential, phoneCredentialHash, phoneDeviceLabel, phoneDeviceIsCurrent, phonePresence, type PhoneIdentity } from "./voice-phone-contract";

type StaffRow = {id:string;display_name:string;extension:string|null;enabled:boolean;access_email:string|null;can_manage_phone:boolean};
type DeviceRow = {
  id:string;staff_id:string;label:string;available:boolean;registered:boolean;last_seen_at:string|null;
  expires_at:string;revoked_at:string|null;enrolled_via:string;access_email:string|null;
};
const STAFF_FIELDS = "id,display_name,extension,enabled,access_email,can_manage_phone";
const DEVICE_FIELDS = "id,staff_id,label,available,registered,last_seen_at,expires_at,revoked_at,enrolled_via,access_email";
export function isPhoneEnabled() { return process.env.VOICE_PHONE_ENABLED === "true"; }
export async function verifiedPhoneEmail(request: NextRequest) {
  const result = await validateCloudflareAccess(request.headers);
  return result.ok && "email" in result && result.email ? result.email : null;
}
async function readPersonalDevice(query:Record<string,string|number>) {
  const devices = await supabaseRequest<DeviceRow[]>("voice_staff_devices", {}, {select:DEVICE_FIELDS,...query,limit:1});
  const device = devices[0];
  if (!device || !phoneDeviceIsCurrent(device)) return null;
  const staff = (await supabaseRequest<StaffRow[]>("voice_staff", {}, {select:STAFF_FIELDS,id:"eq."+device.staff_id,enabled:"eq.true",limit:1}))[0];
  if (!staff || (device.enrolled_via === "personal_access" && device.access_email !== staff.access_email)) return null;
  return {device,staff};
}
export async function currentPhoneDevice() {
  const hash=phoneCredentialHash((await cookies()).get(PHONE_DEVICE_COOKIE)?.value,"device");
  return hash ? readPersonalDevice({token_hash:"eq."+hash}) : null;
}
export async function getPhoneRuntimeDevice(deviceId:unknown,staffId:unknown) {
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  if(typeof deviceId!=="string" || typeof staffId!=="string" || !uuid.test(deviceId) || !uuid.test(staffId))
    throw new QuoteValidationError("Ungültige Telefonzuordnung.",["invalid_phone_identity"],422);
  const current=await readPersonalDevice({id:"eq."+deviceId,staff_id:"eq."+staffId});
  if(!current)throw new QuoteValidationError("Telefonanmeldung ist nicht mehr gültig.",["phone_identity_required"],401);
  return {deviceId:current.device.id,staffId:current.staff.id,expiresAt:current.device.expires_at};
}
export async function readPhoneIdentity(request: NextRequest): Promise<PhoneIdentity> {
  const empty: PhoneIdentity = {enabled:isPhoneEnabled(),browserCallingAvailable:isPhoneEnabled() && process.env.VOICE_BROWSER_CALLS_ENABLED==="true" && !!process.env.VOICE_PHONE_ALLOWED_NUMBERS?.trim(),profile:null,device:null,team:[],personalAccessAvailable:false,canManagePhone:false};
  if (!empty.enabled) return empty;
  const [current,email,staff,devices,calls,transfers] = await Promise.all([
    currentPhoneDevice(),verifiedPhoneEmail(request),
    supabaseRequest<StaffRow[]>("voice_staff", {}, {select:STAFF_FIELDS,enabled:"eq.true",order:"display_name.asc",limit:50}),
    supabaseRequest<DeviceRow[]>("voice_staff_devices", {}, {select:DEVICE_FIELDS,revoked_at:"is.null",expires_at:"gt."+new Date().toISOString(),order:"last_seen_at.desc.nullslast",limit:400}),
    supabaseRequest<Array<{staff_id:string}>>("voice_phone_calls",{}, {select:"staff_id",or:"(ended_at.is.null,cleanup_pending.eq.true)",limit:100}),
    supabaseRequest<Array<{from_staff_id:string;to_staff_id:string}>>("voice_phone_transfers",{}, {select:"from_staff_id,to_staff_id",or:"(ended_at.is.null,cleanup_pending.eq.true)",limit:100}),
  ]);
  const busy=new Set([...calls.map(call=>call.staff_id),...transfers.flatMap(t=>[t.from_staff_id,t.to_staff_id])]);
  return {
    ...empty,
    canManagePhone:!!current?.staff.can_manage_phone,
    profile:current ? {id:current.staff.id,displayName:current.staff.display_name,extension:current.staff.extension} : null,
    device:current ? {id:current.device.id,label:current.device.label,available:current.device.available,registered:current.device.registered,expiresAt:current.device.expires_at} : null,
    personalAccessAvailable:!!email && staff.some(member=>member.access_email===email),
    team:staff.map(member=>({id:member.id,displayName:member.display_name,extension:member.extension,
      presence:busy.has(member.id)?"busy":phonePresence(devices.filter(device=>device.staff_id===member.id))})),
  };
}
export async function enrollPhoneDevice(request: NextRequest, input: Record<string,unknown>) {
  let label:string;
  try { label=phoneDeviceLabel(input.label); } catch { throw new QuoteValidationError("Bitte benenne dieses Gerät.",["invalid_device_label"],422); }
  const mode = input.action;
  const inviteHash = mode === "enroll_code" ? phoneCredentialHash(input.code,"invite") : null;
  const email = mode === "enroll_access" ? await verifiedPhoneEmail(request) : null;
  if ((mode !== "enroll_code" && mode !== "enroll_access") || (mode === "enroll_code" ? !inviteHash : !email))
    throw new QuoteValidationError("Die persönliche Telefonanmeldung konnte nicht bestätigt werden.",["phone_enrollment_invalid"],401);
  const token = newPhoneCredential();
  try {
    const rows = await supabaseRpc<Array<{device_id:string;staff_id:string;expires_at:string}>>("enroll_voice_staff_device", {
      p_device_hash:phoneCredentialHash(token,"device"),p_label:label,p_invite_hash:inviteHash,p_access_email:email,
    });
    if (!rows?.[0]?.device_id) throw new Error("phone_enrollment_not_acknowledged");
    return {token,expiresAt:rows[0].expires_at};
  } catch(error) {
    if(error instanceof SupabaseRestError && error.status===400)
      throw new QuoteValidationError("Die persönliche Telefonanmeldung konnte nicht bestätigt werden.",["phone_enrollment_invalid"],401);
    throw error;
  }
}
export async function updatePhonePresence(input: Record<string,unknown>) {
  const current = await currentPhoneDevice();
  if (!current) throw new QuoteValidationError("Bitte melde dein Telefon persönlich an.",["phone_identity_required"],401);
  if (typeof input.available !== "boolean" || typeof input.registered !== "boolean")
    throw new QuoteValidationError("Der Telefonstatus ist ungültig.",["invalid_phone_presence"],422);
  await supabaseRequest("voice_staff_devices", {method:"PATCH",body:JSON.stringify({
    available:input.available,registered:input.registered,last_seen_at:new Date().toISOString(),
  })},{id:"eq."+current.device.id,revoked_at:"is.null"});
}
export async function revokeCurrentPhoneDevice() {
  const current = await currentPhoneDevice();
  if (current) await supabaseRequest("voice_staff_devices",{method:"PATCH",body:JSON.stringify({
    revoked_at:new Date().toISOString(),available:false,registered:false,
  })},{id:"eq."+current.device.id,revoked_at:"is.null"});
}
