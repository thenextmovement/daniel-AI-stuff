import {supabaseRequest,supabaseRpc,SupabaseRestError} from "@/lib/quotes/supabase-rest";
import {QuoteValidationError} from "@/lib/quotes/validation";
import {customerPhone} from "./voice-customer-phones";
export type CustomerEditorRecord={
 id:string; first_name:string|null;last_name:string|null;email:string;phone:string|null;
 updated_at:string;customer_organization_id:string|null;organization_id:string;
};
export type CustomerEditorData={customer:CustomerEditorRecord;emails:string[];phones:string[];organizations:{id:string;name:string}[];organizationManuallySet:boolean};
const invalid=(message:string)=>new QuoteValidationError(message,["invalid_customer_contact"],422);
export function validateCustomerEditor(input:Record<string,unknown>,primary?:Pick<CustomerEditorRecord,"email"|"phone">){
 const text=(key:string,max:number)=>{const v=input[key];if(typeof v!=="string"||v.length>max||/[\u0000-\u001f]/.test(v))throw invalid("Bitte prüfe die Kontaktdaten.");return v.trim();};
 const email=(v:unknown)=>{if(typeof v!=="string")throw invalid("Ungültige E-Mail-Adresse.");const s=v.trim().toLowerCase();if(s.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))throw invalid("Bitte prüfe die E-Mail-Adresse.");return s;};
 const list=(key:string,parse:(v:unknown)=>string)=>{const v=input[key];if(!Array.isArray(v)||v.length>10)throw invalid("Maximal zehn zusätzliche Kontakte je Typ.");const values=v.map(parse);if(new Set(values).size!==values.length)throw invalid("Ein Kontakt ist doppelt eingetragen.");return values;};
 const primaryEmail=primary?primary.email:email(input.email),phone=primary?primary.phone:text("phone",40);
 const emails=list("emails",email),phones=list("phones",v=>typeof v === "object" && v !== null ? customerPhone((v as Record<string,unknown>).phone,(v as Record<string,unknown>).country) : customerPhone(v));
 let primaryPhone:string|null=null;
 try { primaryPhone=phone?customerPhone(phone):null; } catch(error) { if(!primary)throw error; }
 if(emails.includes(primaryEmail?.trim().toLowerCase())||(primaryPhone&&phones.includes(primaryPhone)))throw invalid("Der Hauptkontakt darf nicht zusätzlich eingetragen werden.");
 const organizationId=input.organizationId;
 if(organizationId!==null&&(typeof organizationId!=="string"||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(organizationId)))throw invalid("Ungültige Organisation.");
 const expectedUpdatedAt=text("expectedUpdatedAt",50);
 if(!Number.isFinite(Date.parse(expectedUpdatedAt)))throw invalid("Bitte lade den Kunden erneut.");
 const newOrganizationName=text("newOrganizationName",200);
 if(organizationId&&newOrganizationName)throw invalid("Wähle eine bestehende oder eine neue Organisation.");
 return {firstName:text("firstName",120),lastName:text("lastName",120),email:primaryEmail,phone:primary?primary.phone:primaryPhone,emails,phones,organizationId,newOrganizationName,expectedUpdatedAt};
}
export async function readCustomerEditor(id:string):Promise<CustomerEditorData>{
 const [tenant]=await supabaseRequest<{id:string}[]>("crm_organizations",{},{select:"id",slug:"eq.neontrip",limit:1});
 if(!tenant)throw Error("neontrip_tenant_missing");
 const [customer]=await supabaseRequest<CustomerEditorRecord[]>("master_customers",{},{select:"id,first_name,last_name,email,phone,updated_at,customer_organization_id,organization_id",id:"eq."+id,organization_id:"eq."+tenant.id,limit:1});
 if(!customer)throw new QuoteValidationError("Kunde nicht gefunden.",["customer_not_found"],404);
 const [contacts,legacy,organizations,manual]=await Promise.all([
 supabaseRequest<{kind:string;value:string}[]>("customer_contact_points",{},{select:"kind,value",customer_id:"eq."+id,order:"kind.asc,slot.asc"}),
 supabaseRequest<{phone:string}[]>("voice_customer_phone_numbers",{},{select:"phone",customer_id:"eq."+id,order:"created_at.asc"}),
 supabaseRequest<{id:string;name:string}[]>("customer_organizations",{},{select:"id,name",organization_id:"eq."+tenant.id,order:"name.asc",limit:1000}),
 supabaseRequest<{fields:string[]}[]>("customer_manual_contact_fields",{},{select:"fields",customer_id:"eq."+id,limit:1})]);
 return {customer,emails:contacts.filter(x=>x.kind==="email").map(x=>x.value),phones:[...new Set([...contacts.filter(x=>x.kind==="phone").map(x=>x.value),...legacy.map(x=>x.phone)])].filter(x=>x!==customer.phone),organizations,organizationManuallySet:manual[0]?.fields.includes("customer_organization_id")||false};
}
export async function saveCustomerEditor(id:string,input:Record<string,unknown>,actor:string|null){
 const {customer}=await readCustomerEditor(id);
 // Primary contacts are server-owned; preserve legacy formats verbatim.
 const values=validateCustomerEditor(input,customer);
 try{
 await supabaseRpc("save_voice_customer_v1",{p_customer_id:id,p_tenant_id:customer.organization_id,p_expected_updated_at:values.expectedUpdatedAt,p_first_name:values.firstName,p_last_name:values.lastName,p_email:customer.email,p_phone:customer.phone,p_emails:values.emails,p_phones:values.phones,p_customer_organization_id:values.organizationId,p_new_organization_name:values.newOrganizationName||null,p_actor:actor});
 }catch(error){
 if(error instanceof SupabaseRestError){
 const details=String(error.details);
 if(details.includes("customer_changed_reload"))throw new QuoteValidationError("Der Kunde wurde inzwischen geändert. Bitte neu öffnen.",["customer_changed"],409);
 if(details.includes("email_already_assigned")||details.includes("23505"))throw invalid("Diese E-Mail-Adresse ist bereits zugeordnet oder doppelt eingetragen.");
 }
 throw error;
 }
 return readCustomerEditor(id);
}
