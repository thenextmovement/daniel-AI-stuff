import {requireVoiceUuid} from "./voice-platform-contract";
import {QuoteValidationError} from "@/lib/quotes/validation";
export type PhoneManagedStaff={
 id:string;displayName:string;accessEmail:string|null;extension:string|null;enabled:boolean;canManagePhone:boolean;revision:number;
 devices:Array<{id:string;label:string;createdAt:string;lastSeenAt:string|null;expiresAt:string;isCurrent:boolean}>;
 invites:Array<{id:string;expiresAt:string}>;
};
export type PhoneProfileValues={displayName:string;accessEmail:string|null;extension:string|null;enabled:boolean};
function invalid(message="Bitte prüfe die Angaben zum Telefonprofil."):never{
 throw new QuoteValidationError(message,["invalid_phone_management_input"],422);
}
export function phoneManagementInput(input:Record<string,unknown>){
 const action=String(input.action||"");
 const allowed:Record<string,string[]>={create:["staffId","values"],update:["staffId","values","revision"],issue_invite:["staffId"],revoke_invite:["staffId","relatedId"],revoke_device:["staffId","relatedId"]};
 if(!Object.hasOwn(allowed,action)||Object.keys(input).some(key=>key!=="action"&&!allowed[action].includes(key)))invalid();
 const staffId=requireVoiceUuid(input.staffId,"Telefonprofil");
 let values:PhoneProfileValues|undefined;
 if(action==="create"||action==="update"){
  if(!input.values||typeof input.values!=="object"||Array.isArray(input.values))invalid();
  const v=input.values as Record<string,unknown>;
  if(Object.keys(v).some(key=>!["displayName","accessEmail","extension","enabled"].includes(key)))invalid();
  if(typeof v.displayName!=="string"||v.displayName.trim().length<2||v.displayName.trim().length>100||/[\u0000-\u001f\u007f]/.test(v.displayName)||typeof v.enabled!=="boolean")invalid();
  const email=v.accessEmail===null||v.accessEmail===undefined?"":typeof v.accessEmail==="string"?v.accessEmail.trim().toLowerCase():invalid();
  const extension=v.extension===null||v.extension===undefined?"":typeof v.extension==="string"?v.extension.trim():invalid();
  if(email&&(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))invalid("Bitte trage eine gültige persönliche E-Mail-Adresse ein.");
  if(extension&&!/^\d{1,6}$/.test(extension))invalid("Die Nebenstelle darf nur eine bis sechs Ziffern enthalten.");
  values={displayName:v.displayName.trim(),accessEmail:email||null,extension:extension||null,enabled:v.enabled};
 }
 if(action==="update"&&(!Number.isInteger(input.revision)||Number(input.revision)<1))invalid();
 return {action,staffId,values,revision:action==="update"?Number(input.revision):null,
  relatedId:action.startsWith("revoke_")?requireVoiceUuid(input.relatedId,"Gerät oder Einrichtungscode"):null};
}
