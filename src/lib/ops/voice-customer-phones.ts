import {normalizePhoneE164} from "./voice-platform-contract";
import {QuoteValidationError} from "@/lib/quotes/validation";
import {supabaseRequest} from "@/lib/quotes/supabase-rest";
export function customerPhone(value:unknown) {
 if(typeof value!=="string" || !/^[+0-9 ()/.-]{7,40}$/.test(value.trim()))
  throw new QuoteValidationError("Bitte gib eine gültige Rufnummer mit Vorwahl ein.",["invalid_phone"],422);
 const raw=value.trim().replace(/\./g,"").replace(/^(?:\+|00)49\s*\(0\)/,"+49");
 return normalizePhoneE164(raw.startsWith("0")&&!raw.startsWith("00")?"+49"+raw.slice(1):raw);
}
export async function customerPhones(customerId:string,primary:string|null) {
 const rows=await supabaseRequest<Array<{phone:string}>>("voice_customer_phone_numbers",{signal:AbortSignal.timeout(5000)},
  {select:"phone",customer_id:"eq."+customerId,order:"created_at.asc,phone.asc"});
 let first:string|null=null;
 try{if(primary)first=customerPhone(primary);}catch{}
 return [...new Set([first,...rows.map(x=>x.phone)].filter((x):x is string=>Boolean(x)))];
}
