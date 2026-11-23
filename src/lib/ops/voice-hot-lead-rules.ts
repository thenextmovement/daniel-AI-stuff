import {Temporal} from "@js-temporal/polyfill";
export type HotLeadState={status:"ignored"|"reached"|"scheduled";source_at:string;handled_at:string;due_date:string|null;revision:number};
export function berlinDate(now=new Date()){return Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO("Europe/Berlin").toPlainDate().toString();}
export function shiftLeadDate(day:string,days:number){return Temporal.PlainDate.from(day).add({days}).toString();}
const personal=new Set("gmail.com googlemail.com gmx.de gmx.net gmx.at gmx.ch web.de yahoo.com yahoo.de yahoo.fr yahoo.co.uk hotmail.com hotmail.de outlook.com outlook.de live.com live.de icloud.com me.com mac.com aol.com aol.de t-online.de freenet.de mail.de email.de posteo.de mailbox.org proton.me protonmail.com bluewin.ch sunrise.ch arcor.de vodafone.de online.de onet.pl wp.pl o2online.de unitybox.de".split(" "));
export function contactSegment(email:string|null):"Privat"|"B2B"|null{
 const domain=email?.trim().toLowerCase().split("@");
 return domain?.length===2&&domain[1].includes(".")?(personal.has(domain[1])?"Privat":"B2B"):null;
}

export type LeadStage=1|2|3;
export type LeadOutcome='reached'|'not_reached';
export type LeadProgress={status:HotLeadState['status']|'not_reached'|'no_followup'|'active'|null;stage:LeadStage|null;dueDate:string|null;dueAt:string|null;outcomes:Partial<Record<LeadStage,LeadOutcome>>;handledAt:string|null};
export function leadQueue(createdAt:string,sentAt:string|null,p:LeadProgress,callbackAt:string|null,now=new Date()){
 const today=berlinDate(now);
 const stage:LeadStage=!sentAt?1:p.outcomes[2]||p.stage===3?3:2;
 const indicators:('open'|'skipped'|LeadOutcome)[]=[p.outcomes[1]??(sentAt?'skipped':'open'),p.outcomes[2]??'open',p.outcomes[3]??'open'];
 const scheduled=p.status==='scheduled'&&(p.stage===stage||p.stage===null);
 const dueDate=scheduled&&p.dueDate?p.dueDate:berlinDate(new Date(stage===1?createdAt:stage===2?sentAt!:p.handledAt||sentAt!));
 const activeCallback=!scheduled&&callbackAt&&(!p.handledAt||Date.parse(callbackAt)>Date.parse(p.handledAt))?callbackAt:null;
 const callback=activeCallback?Date.parse(activeCallback):null;
 const dueAt=scheduled?p.dueAt:null;
 const effectiveDate=activeCallback?berlinDate(new Date(activeCallback)):dueDate;
 const overdueDays=Math.max(0,Temporal.PlainDate.from(effectiveDate).until(Temporal.PlainDate.from(today)).days);
 const needsPlanning=!scheduled&&((stage===3&&p.status!=='no_followup')||(p.status==='not_reached'&&p.stage===stage));
 const visible=!['ignored','no_followup'].includes(p.status||'')&&!(stage===1&&p.status==='reached'&&p.stage===1)&&
  (callback!==null?callback<=now.getTime():dueDate<=today&&(!dueAt||Date.parse(dueAt)<=now.getTime()));
 return {stage,indicators,dueDate:effectiveDate,dueAt:activeCallback||dueAt,overdueDays,needsPlanning,visible};
}

export function stageAtCallStart(current:LeadStage,firstSentAt:string|null,startedAt:string):LeadStage{
 return !firstSentAt||Date.parse(firstSentAt)>Date.parse(startedAt)?1:current===1?2:current;
}
