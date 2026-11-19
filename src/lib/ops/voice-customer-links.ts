import {QuoteValidationError} from "@/lib/quotes/validation";
export const customerLinkBoards={quentin:"62bae9b97705e7419ed64593",inquiry:"63d10c34105771f01ccf4296"} as const;
export type CustomerLinkKind="quentin"|"inquiry"|"offer";
export function customerLink(value:unknown,kind:CustomerLinkKind){
 try{
  if(typeof value!=="string"||value.length>2048)throw Error();
  const u=new URL(value);
  if(u.protocol!=="https:"||u.username||u.password||u.port)throw Error();
  if(kind!=="offer"){if(u.hostname!=="trello.com"||!/^\/c\/[a-zA-Z0-9]+(?:\/|$)/.test(u.pathname))throw Error();}
  else if(!["offers.neontrip.de","angebote.neontrip.de","ops.neontrip.de"].includes(u.hostname))throw Error();
  return u.href;
 }catch{throw new QuoteValidationError("Bitte gib einen gültigen "+(kind==="offer"?"NEONTRIP-Angebotslink":"Trello-Kartenlink")+" ein.",["invalid_customer_link"],422);}
}
