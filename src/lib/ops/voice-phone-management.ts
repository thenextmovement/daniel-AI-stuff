import {currentPhoneDevice,isPhoneEnabled} from "./voice-phone-identity";
import {newPhoneCredential,phoneCredentialHash} from "./voice-phone-contract";
import {phoneManagementInput,type PhoneManagedStaff} from "./voice-phone-management-contract";
import {supabaseRpc,SupabaseRestError} from "@/lib/quotes/supabase-rest";
import {QuoteValidationError} from "@/lib/quotes/validation";
function denied():never{throw new QuoteValidationError("Dieses Telefonprofil darf das Telefonteam nicht verwalten.",["phone_management_forbidden"],403);}
async function manager(){
 if(!isPhoneEnabled())denied();
 const current=await currentPhoneDevice();
 if(!current?.staff.can_manage_phone)denied();
 return current;
}
async function managementRpc<T>(args:Record<string,unknown>){
 try{return await supabaseRpc<T>("manage_voice_staff",args);}
 catch(error){
  if(error instanceof SupabaseRestError){
   let detail:{code?:string;message?:string}={};
   try{detail=typeof error.details==="string"?JSON.parse(error.details):{};}catch{}
   if(detail.code==="42501")denied();
   if(detail.code==="23505")throw new QuoteValidationError("E-Mail-Adresse oder Nebenstelle ist bereits einem Telefonprofil zugeordnet.",["phone_profile_conflict"],409);
   if(detail.message==="phone_profile_changed")throw new QuoteValidationError("Das Profil wurde inzwischen geändert. Lade die Teamliste neu und prüfe deine Änderung.",["phone_profile_changed"],409);
   if(detail.message==="phone_manager_self_lockout")throw new QuoteValidationError("Dein eigenes Verwaltungsprofil kannst du hier nicht deaktivieren oder einer anderen E-Mail-Adresse zuordnen.",["phone_manager_self_lockout"],409);
   if(detail.code==="22023")throw new QuoteValidationError("Die Änderung konnte nicht übernommen werden. Lade die Teamliste neu und prüfe das ausgewählte Profil.",["phone_management_unavailable"],409);
  }
  throw error;
 }
}
export async function readPhoneManagement(){
 const current=await manager();
 return managementRpc<{staff:PhoneManagedStaff[]}>({p_actor_device_id:current.device.id,p_action:"list"});
}
export async function changePhoneManagement(input:Record<string,unknown>){
 const current=await manager(),command=phoneManagementInput(input);
 const code=command.action==="issue_invite"?newPhoneCredential():null;
 const result=await managementRpc<{staffId:string;inviteId:string|null;expiresAt:string|null}>({
  p_actor_device_id:current.device.id,p_action:command.action,p_staff_id:command.staffId,p_values:command.values||{},
  p_related_id:command.relatedId,p_revision:command.revision,p_token_hash:code?phoneCredentialHash(code,"invite"):null,
 });
 if(code&&(!result.inviteId||!result.expiresAt||result.staffId!==command.staffId))throw new Error("phone_invite_unconfirmed");
 return {...result,...(code?{code}: {})};
}
