import {Temporal} from "@js-temporal/polyfill";
export type HotLeadState={status:"ignored"|"reached"|"scheduled";source_at:string;handled_at:string;due_date:string|null;revision:number};
export function berlinDate(now=new Date()){return Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO("Europe/Berlin").toPlainDate().toString();}
export function shiftLeadDate(day:string,days:number){return Temporal.PlainDate.from(day).add({days}).toString();}
export function hotLeadVisible(sourceAt:string,state:HotLeadState|null,today:string,lastConfirmedCall:string|null){
 const source=Date.parse(sourceAt);
 if(state?.status==="scheduled"){
  if(!state.due_date||state.due_date>today)return false;
  return !lastConfirmedCall||Date.parse(lastConfirmedCall)<=Date.parse(state.handled_at);
 }
 if(state&&source<=Date.parse(state.source_at))return false;
 return !lastConfirmedCall||Date.parse(lastConfirmedCall)<source;
}
const personal=new Set("gmail.com googlemail.com gmx.de gmx.net gmx.at gmx.ch web.de yahoo.com yahoo.de yahoo.fr yahoo.co.uk hotmail.com hotmail.de outlook.com outlook.de live.com live.de icloud.com me.com mac.com aol.com aol.de t-online.de freenet.de mail.de email.de posteo.de mailbox.org proton.me protonmail.com bluewin.ch sunrise.ch arcor.de vodafone.de online.de onet.pl wp.pl o2online.de unitybox.de".split(" "));
export function contactSegment(email:string|null):"Privat"|"B2B"|null{
 const domain=email?.trim().toLowerCase().split("@");
 return domain?.length===2&&domain[1].includes(".")?(personal.has(domain[1])?"Privat":"B2B"):null;
}
