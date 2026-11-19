import {parsePhoneNumberFromString,isSupportedCountry,type CountryCode} from "libphonenumber-js/core";
import {normalizePhoneE164} from "./voice-platform-contract";
import metadata from "libphonenumber-js/metadata.max.json";
import {QuoteValidationError} from "@/lib/quotes/validation";
import {supabaseRequest} from "@/lib/quotes/supabase-rest";
export function customerPhone(value:unknown,country:unknown="DE") {
 const invalid=()=>new QuoteValidationError("Bitte prüfe die Rufnummer und das ausgewählte Land.",["invalid_phone"],422);
 if(typeof country!=="string" || !isSupportedCountry(country as CountryCode,metadata)) throw invalid();
 if(typeof value!=="string" || !/^[+0-9 ()/.-]{7,40}$/.test(value.trim())) throw invalid();
 const raw=value.trim().replace(/^00/,"+");
 const parsed=parsePhoneNumberFromString(raw,{defaultCountry:country as CountryCode,extract:false},metadata);
 if(!parsed?.isValid()) throw invalid();
 return String(parsed.number);
}
export async function customerPhones(customerId:string,primary:string|null) {
 const rows=await supabaseRequest<Array<{phone:string}>>("voice_customer_phone_numbers",{signal:AbortSignal.timeout(5000)},
  {select:"phone",customer_id:"eq."+customerId,order:"created_at.asc,phone.asc"});
 let first:string|null=null;
 try{if(primary) {
  // Preserve legacy directory numbers; only newly entered aliases require strict validation.
  const raw=primary.trim().replace(/\./g,"").replace(/^(?:\+|00)49\s*\(0\)/,"+49");
  first=normalizePhoneE164(raw.startsWith("0")&&!raw.startsWith("00")?"+49"+raw.slice(1):raw);
 }}catch{}
 return [...new Set([first,...rows.map(x=>x.phone)].filter((x):x is string=>Boolean(x)))];
}
