"use client";
import {useEffect,useRef,useState} from "react";
import {RefreshCw} from "lucide-react";
import {Temporal} from "@js-temporal/polyfill";
import type {VoiceDirectoryContact} from "@/lib/ops/voice-directory";
import type {VoiceHotLead} from "@/lib/ops/voice-hot-leads";
import {berlinDate,shiftLeadDate,stageAtCallStart} from "@/lib/ops/voice-hot-lead-rules";
import {readPhoneCentralResponse} from "./phone-central-data";
import styles from "./phone-central.module.css";
export function leadAmount(lead:Pick<VoiceHotLead,"amount"|"currency">){return lead.amount===null?null:new Intl.NumberFormat("de-DE",{style:"currency",currency:lead.currency}).format(lead.amount);}
export function LeadStages({lead}:{lead:VoiceHotLead}){
 const labels=["Anfrage","Angebot","Nachfassen"];
 const descriptions={open:"Offen",skipped:"Ohne Anruf übersprungen",reached:"Erreicht",not_reached:"Nicht erreicht"};
 return <ol className={styles.leadStages}>{labels.map((label,i)=>{const state=lead.indicators?.[i]||"open";return <li key={label} data-state={state} title={descriptions[state]}><span aria-label={descriptions[state]}>{state==='reached'?'✓':state==='not_reached'?'×':state==='skipped'?'–':'○'}</span> {label}</li>;})}</ol>;
}
export function HotLeads({onSelect,busy,revision,finishedCall}:{finishedCall:{customerId:string;requestId:string;callId:string}|null;onSelect:(contact:VoiceDirectoryContact)=>void;busy:boolean;revision:number}){
 const [status,setStatus]=useState("all"),[score,setScore]=useState("all"),[sort,setSort]=useState("priority"),[refresh,setRefresh]=useState(0),[offset,setOffset]=useState(0);
 const [data,setData]=useState<{results:VoiceHotLead[];nextOffset:number|null;total:number}|null>(null);
 const [loading,setLoading]=useState(false),[error,setError]=useState("");
 useEffect(()=>{const reload=()=>{if(!document.hidden)setRefresh(n=>n+1);};const timer=window.setInterval(reload,60000);window.addEventListener('focus',reload);document.addEventListener('visibilitychange',reload);return()=>{clearInterval(timer);window.removeEventListener('focus',reload);document.removeEventListener('visibilitychange',reload);};},[]);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError("");
  void fetch("/api/ops/voice-copilot/hot-leads?"+new URLSearchParams({status,score,sort,offset:String(offset)}),{cache:"no-store",signal:controller.signal})
   .then(r=>readPhoneCentralResponse<NonNullable<typeof data>>(r,"Hot-Leads konnten nicht vollständig geladen werden. Bitte erneut versuchen."))
   .then(result=>{if(!controller.signal.aborted)setData(result);})
   .catch(e=>{if(!controller.signal.aborted){setData(null);setError(e.message);}}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[status,score,sort,offset,refresh,revision,finishedCall]);
 return <section aria-label="Hot-Leads"><h2 className={styles.leftTitle}>Hot-Leads</h2>
  <div className={styles.leadFilters}>
   <label>Status<select value={status} onChange={e=>{setStatus(e.target.value);setOffset(0);}}><option value="all">Alle fälligen Anrufe</option><option value="inquiry">Anfrage eingegangen</option><option value="offer">Erstes Angebot gesendet</option><option value="reminder">Reminder</option></select></label>
   <label>Score<select value={score} onChange={e=>{setScore(e.target.value);setOffset(0);}}><option value="all">Alle Bewertungen</option>{Object.entries({very_hot:'Sehr heiß',hot:'Heiß',warm_plus:'Warm+',warm:'Warm',cold:'Kalt',low_intent:'Wenig Interesse',problem:'Problem',paused:'Pausiert',unknown:'Ohne Bewertung'}).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
   <label>Sortieren<select value={sort} onChange={e=>{setSort(e.target.value);setOffset(0);}}><option value="priority">Angebots-Score absteigend</option><option value="overdue">Am längsten überfällig</option><option value="amount">Betrag absteigend (EUR)</option></select></label>
  </div>
  <p className={styles.small}>Heute fällig und überfällig. Aktualisiert sich automatisch. Score aus der Angebotssoftware, keine Abschlusswahrscheinlichkeit.</p>
  <button type="button" className={styles.retry} disabled={loading} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={15}/> Aktualisieren</button>
  {error?<p role="alert" className={styles.searchError}>{error}</p>:null}
  <p role="status" className={styles.directoryStatus}>{loading?"Wird aktualisiert …":data?data.total+" fällige Einträge":""}</p>
  {!loading&&data&&!data.results.length?<p>Keine fälligen Einträge für diese Filter.</p>:null}
  <div className={styles.results}>{data?.results.map(lead=><article key={lead.id} className={styles.leadCard}>
   <div className={styles.leadHeading}><button type="button" className={styles.leadName} disabled={busy} onClick={()=>onSelect(lead)}>{lead.company||lead.displayName||"Kontakt"}</button>{lead.segment?<small className={styles.leadBadge} title="Automatisch anhand der E-Mail-Domain">{lead.segment}</small>:null}</div>
   <LeadStages lead={lead}/>
   <button type="button" className={styles.result} disabled={busy} onClick={()=>onSelect(lead)}><span className={styles.resultContent}><span>{lead.requestTitle}</span><span>{lead.phone||"Rufnummer fehlt"}</span><span>{lead.email}</span>{leadAmount(lead)?<strong>{lead.offerNumber?"Angebot "+lead.offerNumber+": ":"Anfrage: "}{leadAmount(lead)}</strong>:null}<span>{lead.reasons.join(" · ")}</span></span></button>
   <div className={styles.leadFooter}><span>{lead.score?`${lead.score.label} · ${lead.score.score}/100`:"Score nicht verfügbar"}</span>{lead.overdueDays>0?<strong className={styles.leadOverdue}>Seit {lead.overdueDays} {lead.overdueDays===1?'Tag':'Tagen'} überfällig</strong>:null}</div>
  </article>)}</div>
  {data&&data.total>30?<div className={styles.leadActions}><button type="button" disabled={loading||offset===0} onClick={()=>setOffset(Math.max(0,offset-30))}>Zurück</button><button type="button" disabled={loading||data.nextOffset===null} onClick={()=>setOffset(data.nextOffset!)}>Weitere Leads</button></div>:null}
 </section>;
}

export function LeadPlanner({customerId,requestId,revision,callStartedAt,onRecorded,onSaved}:{customerId:string;requestId:string;revision:number;callStartedAt:string|null;onRecorded:()=>void;onSaved:()=>void}){
 const [lead,setLead]=useState<VoiceHotLead|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[saving,setSaving]=useState(false),[refresh,setRefresh]=useState(0);
 const [date,setDate]=useState(''),[time,setTime]=useState('');
 const frozen=useRef<(Pick<VoiceHotLead,'stage'|'capturedAt'> & {baseline:VoiceHotLead['stage']})|null>(null);
 const confirm=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const timer=window.setInterval(()=>{if(!document.hidden)setRefresh(n=>n+1);},60000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{setLead(null);frozen.current=null;setError('');setNotice('');},[customerId,requestId]);
 useEffect(()=>{if(callStartedAt&&lead){const baseline=frozen.current?.capturedAt===callStartedAt?frozen.current.baseline:lead.stage;frozen.current={stage:stageAtCallStart(baseline,lead.firstSentAt,callStartedAt),baseline,capturedAt:callStartedAt};}},[callStartedAt,lead]);
 useEffect(()=>{
  const controller=new AbortController();
  void fetch('/api/ops/voice-copilot/hot-leads?'+new URLSearchParams({customerIds:customerId}),{cache:'no-store',signal:controller.signal})
   .then(r=>readPhoneCentralResponse<{results:VoiceHotLead[]}>(r,'Anrufplanung konnte nicht geladen werden.'))
   .then(r=>{if(!controller.signal.aborted)setLead(r.results.find(x=>x.requestId===requestId||x.id===requestId)??null);})
   .catch(e=>{if(!controller.signal.aborted)setError(e.message);});
  return()=>controller.abort();
 },[customerId,requestId,revision,refresh]);
 async function save(status:'reached'|'not_reached'|'scheduled'|'ignored'|'no_followup'|'active',day:string|null=null,clock=''){
  if(!lead)return;setSaving(true);setError('');setNotice('');
  try{
   const captured=(status==='reached'||status==='not_reached')?frozen.current:null;
   const dueAt=day&&clock?Temporal.ZonedDateTime.from(`${day}T${clock}[Europe/Berlin]`,{disambiguation:'reject'}).toInstant().toString():null;
   await readPhoneCentralResponse(await fetch('/api/ops/voice-copilot/hot-leads',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:lead.id,customerId:lead.customerId,status,sourceAt:lead.sourceAt,revision:lead.revision,stage:captured?.stage??lead.stage,capturedAt:captured?.capturedAt??new Date().toISOString(),actionId:crypto.randomUUID(),dueDate:day,dueAt})}),'Speichern fehlgeschlagen. Bitte aktualisieren.');
   if(['reached','not_reached','ignored','no_followup'].includes(status)){frozen.current=null;onRecorded();}
   setNotice(status==='scheduled'?`Wiedervorlage: ${day}${clock?' um '+clock:''}`:status==='ignored'?'Aus Hot-Leads entfernt. Im Verzeichnis weiterhin vorhanden.':status==='not_reached'?'Nicht erreicht gespeichert. Bitte nächsten Versuch planen.':status==='reached'?'Erreicht gespeichert.':status==='active'?'Wieder aufgenommen.':'Kein weiterer Anruf geplant.');
   setRefresh(n=>n+1);onSaved();
  }catch(e){setError(e instanceof Error?e.message:'Speichern fehlgeschlagen.');setRefresh(n=>n+1);}finally{setSaving(false);}
 }
 if(!lead)return error?<p role="alert">{error}</p>:null;
 if(!lead.canSchedule)return null;
 const removed=['ignored','no_followup'].includes(lead.listStatus||'');
 return <section className={styles.leadPlanner} aria-label="Nächsten Anruf planen"><h3>Nächsten Anruf planen</h3><LeadStages lead={lead}/>
 {error?<p role="alert" className={styles.searchError}>{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
 {removed?<button type="button" className={styles.button} disabled={saving} onClick={()=>void save('active')}>Wieder in Hot-Leads aufnehmen</button>:<>
 <div className={styles.leadActions}><button type="button" disabled={saving} onClick={()=>void save('reached')}>Erreicht</button><button type="button" disabled={saving} onClick={()=>void save('not_reached')}>Nicht erreicht</button></div>
 <p className={styles.small}>{lead.needsPlanning?'Nachfassen noch planen. ':''}+1 = morgen, +2 = übermorgen. Kalendertage, Europe/Berlin.</p>
 <div className={styles.leadActions}>{[1,2,3,4,5,6,7].map(n=><button key={n} type="button" disabled={saving} onClick={()=>void save('scheduled',shiftLeadDate(berlinDate(),n))}>+{n}</button>)}</div>
 <form className={styles.leadCalendar} onSubmit={e=>{e.preventDefault();void save('scheduled',date,time);}}><label>Datum<input type="date" required min={berlinDate()} value={date} onChange={e=>setDate(e.target.value)}/></label><label>Uhrzeit (optional)<input type="time" value={time} onChange={e=>setTime(e.target.value)}/></label><button className={styles.button} disabled={saving||!date}>Planen</button></form>
 <div className={styles.leadActions}><button type="button" disabled={saving} onClick={()=>void save('no_followup')}>Kein weiterer Anruf</button><button type="button" disabled={saving} onClick={()=>confirm.current?.showModal()}>Ignorieren</button></div>
 <dialog ref={confirm} className={styles.leadConfirm}><h3>Aus Hot-Leads entfernen?</h3><p>Dieser Vorgang bleibt ausgeblendet, bis du ihn im Verzeichnis wieder aufnimmst. Der Kunde bleibt gespeichert.</p><div className={styles.leadActions}><button type="button" onClick={()=>confirm.current?.close()}>Abbrechen</button><button type="button" onClick={()=>{confirm.current?.close();void save('ignored');}}>Ja, ignorieren</button></div></dialog>
 </>}
 </section>;
}
