"use client";
import {useEffect,useRef,useState} from "react";
import {RefreshCw,ChevronDown,SlidersHorizontal,ArrowDownWideNarrow} from "lucide-react";
import {Temporal} from "@js-temporal/polyfill";
import type {VoiceDirectoryContact} from "@/lib/ops/voice-directory";
import type {VoiceHotLead} from "@/lib/ops/voice-hot-leads";
import {berlinDate,shiftLeadDate,stageAtCallStart} from "@/lib/ops/voice-hot-lead-rules";
import {readPhoneCentralResponse} from "./phone-central-data";
import styles from "./phone-central.module.css";
export function leadAmount(lead:Pick<VoiceHotLead,"amount"|"currency">){return lead.amount===null?null:new Intl.NumberFormat("de-DE",{style:"currency",currency:lead.currency}).format(lead.amount);}
export function LeadStages({lead}:{lead:VoiceHotLead}){
 const labels=["Anfrage","Angebot","Nachfassen"];
 const descriptions={open:"Anruf offen",skipped:"Kein Anfrage-Anruf erfasst; Angebot bereits gesendet",reached:"Erreicht",not_reached:"Nicht erreicht"};
 return <ol className={styles.leadStages} aria-label="Anrufphasen">{labels.map((label,i)=>{const state=lead.indicators?.[i]||"open";const current=lead.canSchedule&&lead.stage===i+1;return <li key={label} data-state={state} aria-current={current?'step':undefined} title={`${current?'Aktuelle Phase. ':''}${descriptions[state]}`}><span aria-label={descriptions[state]}>{state==='reached'?'✓':state==='not_reached'?'×':state==='skipped'?'–':'○'}</span> {label}{current?<small>aktuell</small>:null}</li>;})}</ol>;
}
export function LeadScore({lead}:{lead:VoiceHotLead}){return <span className={styles.leadScore} data-tone={!lead.score?'unknown':lead.score.score>=55?'green':lead.score.score>=22?'amber':'red'} aria-label={lead.score?`Angebots-Score ${lead.score.score} von 100`:'Score nicht verfügbar'} title={lead.score?`Angebots-Score: ${lead.score.score}/100. Grün ab 55, Gelb ab 22, Rot unter 22. Keine Abschlusswahrscheinlichkeit.`:'Score nicht verfügbar'}>{lead.score?lead.score.score:'–'}</span>;}
export function HotLeads({onSelect,busy,revision,finishedCall}:{finishedCall:{customerId:string;requestId:string;callId:string}|null;onSelect:(contact:VoiceDirectoryContact)=>void;busy:boolean;revision:number}){
 const [status,setStatus]=useState("all"),[age,setAge]=useState("all"),[sort,setSort]=useState("priority"),[refresh,setRefresh]=useState(0),[offset,setOffset]=useState(0);
 const [data,setData]=useState<{results:VoiceHotLead[];nextOffset:number|null;total:number}|null>(null);
 const [loading,setLoading]=useState(false),[error,setError]=useState("");
 useEffect(()=>{const reload=()=>{if(!document.hidden)setRefresh(n=>n+1);};const timer=window.setInterval(reload,60000);window.addEventListener('focus',reload);document.addEventListener('visibilitychange',reload);return()=>{clearInterval(timer);window.removeEventListener('focus',reload);document.removeEventListener('visibilitychange',reload);};},[]);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError("");
  void fetch("/api/ops/voice-copilot/hot-leads?"+new URLSearchParams({status,sort,age,offset:String(offset)}),{cache:"no-store",signal:controller.signal})
   .then(r=>readPhoneCentralResponse<NonNullable<typeof data>>(r,"Hot-Leads konnten nicht vollständig geladen werden. Bitte erneut versuchen."))
   .then(result=>{if(!controller.signal.aborted)setData(result);})
   .catch(e=>{if(!controller.signal.aborted){setData(null);setError(e.message);}}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[status,sort,age,offset,refresh,revision,finishedCall]);
 const statusOptions={all:"Alle",inquiry:"Anfrage",offer:"Angebot",reminder:"Reminder"};
 const sortOptions={priority:"Score",overdue:"Fälligkeit",amount:"Betrag"};
 return <section aria-label="Hot-Leads" className={styles.hotLeads}>
  <div className={styles.leadToolbar}>
   <details className={styles.leadMenu} onKeyDown={e=>{if(e.key==='Escape')e.currentTarget.open=false;}}>
    <summary><SlidersHorizontal size={14}/><span>{statusOptions[status as keyof typeof statusOptions]}</span><ChevronDown size={12}/></summary>
    <div className={styles.leadMenuOptions} aria-label="Status filtern">{Object.entries(statusOptions).map(([value,label])=><button type="button" key={value} aria-pressed={status===value} onClick={e=>{setStatus(value);setOffset(0);e.currentTarget.closest('details')?.removeAttribute('open');}}>{label}</button>)}</div>
   </details>
   <details className={styles.leadMenu} onKeyDown={e=>{if(e.key==='Escape')e.currentTarget.open=false;}}>
    <summary><ArrowDownWideNarrow size={14}/><span>{sortOptions[sort as keyof typeof sortOptions]}</span><ChevronDown size={12}/></summary>
    <div className={styles.leadMenuOptions} aria-label="Sortieren">{Object.entries(sortOptions).map(([value,label])=><button type="button" key={value} aria-pressed={sort===value} onClick={e=>{setSort(value);setOffset(0);e.currentTarget.closest('details')?.removeAttribute('open');}}>{label}{value==='overdue'?' · älteste zuerst':' · absteigend'}</button>)}</div>
   </details>
   <details className={styles.leadMenu} onKeyDown={e=>{if(e.key==='Escape')e.currentTarget.open=false;}}>
    <summary title="Alter ab bestätigtem Angebotsversand"><span>{age==='all'?'Angebotsalter':`≤ ${age} ${age==='1'?'Tag':'Tage'}`}</span><ChevronDown size={12}/></summary>
    <div className={styles.leadMenuOptions} aria-label="Angebotsalter filtern">{['all','1','3','5','7','14','30','60','90'].map(value=><button type="button" key={value} aria-pressed={age===value} onClick={e=>{setAge(value);setOffset(0);e.currentTarget.closest('details')?.removeAttribute('open');}}>{value==='all'?'Alle':`Bis ${value} ${value==='1'?'Tag':'Tage'}`}</button>)}</div>
   </details>

  </div>
  {error?<p role="alert" className={styles.searchError}>{error}</p>:null}
  <div className={styles.leadCount}><span role="status">{loading?"Wird aktualisiert …":data?data.total+" fällige Einträge":""}</span><button type="button" className={styles.leadRefresh} aria-label="Hot-Leads aktualisieren" title="Aktualisieren" disabled={loading} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={15}/></button></div>
  {!loading&&data&&!data.results.length?<p>Keine fälligen Einträge für diese Filter.</p>:null}
  <div className={styles.leadResults}>{data?.results.map(lead=><article key={lead.id} className={styles.leadCard}>
   <div className={styles.leadHeading}><button type="button" className={styles.leadName} disabled={busy} onClick={()=>onSelect(lead)}>{lead.company||lead.displayName||"Kontakt"}</button>{lead.segment?<small className={styles.leadBadge} title="Automatisch anhand der E-Mail-Domain">{lead.segment}</small>:null}</div>
   <LeadStages lead={lead}/>
   <button type="button" className={styles.result} disabled={busy} onClick={()=>onSelect(lead)}><span className={styles.resultContent}><span>{lead.requestTitle}</span><span>{lead.phone||"Rufnummer fehlt"}</span><span>{lead.email}</span>{leadAmount(lead)?<strong>{lead.offerNumber?"Angebot "+lead.offerNumber+": ":"Anfrage: "}{leadAmount(lead)}</strong>:null}<span>{lead.reasons.join(" · ")}</span></span></button>
   <div className={styles.leadFooter}>
    <span className={styles.leadSent}>{lead.firstSentAt?<>AN gesendet am: <time dateTime={lead.firstSentAt}>{new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin'}).format(new Date(lead.firstSentAt))}</time></>:"Versand nicht bestätigt"}</span>
    <LeadScore lead={lead}/>
   </div>
  </article>)}</div>
  {data&&data.total>30?<div className={styles.leadActions}><button type="button" disabled={loading||offset===0} onClick={()=>setOffset(Math.max(0,offset-30))}>Zurück</button><button type="button" disabled={loading||data.nextOffset===null} onClick={()=>setOffset(data.nextOffset!)}>Weitere Leads</button></div>:null}
 </section>;
}

export function LeadPlanner({customerId,requestId,revision,callStartedAt,onRecorded,onSaved,onLeadChange}:{customerId:string;requestId:string;revision:number;callStartedAt:string|null;onRecorded:()=>void;onSaved:()=>void;onLeadChange?:(lead:VoiceHotLead|null)=>void}){
 const [lead,setLead]=useState<VoiceHotLead|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[saving,setSaving]=useState(false),[refresh,setRefresh]=useState(0);
 useEffect(()=>{onLeadChange?.(lead);},[lead,onLeadChange]);
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
   .catch(e=>{if(!controller.signal.aborted){setLead(null);setError(e.message);}});
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
 return <section className={styles.leadPlanner} aria-label="Nächsten Anruf planen"><div className={styles.leadPlannerHead}><h3>Nächsten Anruf planen</h3><LeadStages lead={lead}/></div>
 {error?<p role="alert" className={styles.searchError}>{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
 {removed?<button type="button" className={styles.button} disabled={saving} onClick={()=>void save('active')}>Wieder in Hot-Leads aufnehmen</button>:<>
 <div className={styles.leadActions}><button type="button" disabled={saving} title="Speichert den Anruf als erreicht (grüner Haken). Einen weiteren Anruf planst du separat mit +1 bis +7 oder über das Datum." onClick={()=>void save('reached')}>Erreicht</button><button type="button" disabled={saving} title="Speichert den Anruf als nicht erreicht (rotes Kreuz). Plane den nächsten Versuch mit +1 bis +7 oder über das Datum; ein Termin wird nicht automatisch gesetzt." onClick={()=>void save('not_reached')}>Nicht erreicht</button></div>
 {lead.needsPlanning?<p className={styles.leadPlanningHint}>Nächsten Versuch planen:</p>:null}
 <div className={`${styles.leadActions} ${styles.leadQuickDays}`} aria-label="Wiedervorlage in Kalendertagen"><small>In Tagen</small>{[1,2,3,4,5,6,7].map(n=><button key={n} type="button" title={n===1?"Morgen (Europe/Berlin)":`In ${n} Kalendertagen (Europe/Berlin)`} disabled={saving} onClick={()=>void save('scheduled',shiftLeadDate(berlinDate(),n))}>+{n}</button>)}</div>
 <form className={styles.leadCalendar} onSubmit={e=>{e.preventDefault();void save('scheduled',date,time);}}><label>Datum<input type="date" required min={berlinDate()} value={date} onChange={e=>setDate(e.target.value)}/></label><label>Uhrzeit (optional)<input type="time" value={time} onChange={e=>setTime(e.target.value)}/></label><button className={styles.button} disabled={saving||!date}>Planen</button></form>
 <div className={`${styles.leadActions} ${styles.leadDismissActions}`}><button type="button" disabled={saving} onClick={()=>void save('no_followup')}>Kein weiterer Anruf</button><button type="button" disabled={saving} onClick={()=>confirm.current?.showModal()}>Ignorieren</button></div>
 <dialog ref={confirm} className={styles.leadConfirm}><h3>Aus Hot-Leads entfernen?</h3><p>Dieser Vorgang bleibt ausgeblendet, bis du ihn im Verzeichnis wieder aufnimmst. Der Kunde bleibt gespeichert.</p><div className={styles.leadActions}><button type="button" onClick={()=>confirm.current?.close()}>Abbrechen</button><button type="button" onClick={()=>{confirm.current?.close();void save('ignored');}}>Ja, ignorieren</button></div></dialog>
 </>}
 </section>;
}
