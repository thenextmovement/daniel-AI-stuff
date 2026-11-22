"use client";
import {useEffect,useRef,useState} from "react";
import {CalendarClock,RefreshCw} from "lucide-react";
import type {VoiceDirectoryContact} from "@/lib/ops/voice-directory";
import type {VoiceHotLead} from "@/lib/ops/voice-hot-leads";
import {berlinDate,shiftLeadDate} from "@/lib/ops/voice-hot-lead-rules";
import {readPhoneCentralResponse} from "./phone-central-data";
import styles from "./phone-central.module.css";
export function leadAmount(lead:Pick<VoiceHotLead,"amount"|"currency">){return lead.amount===null?null:new Intl.NumberFormat("de-DE",{style:"currency",currency:lead.currency}).format(lead.amount);}
export function HotLeads({onSelect,busy,revision,finishedCall}:{finishedCall:{customerId:string;requestId:string;callId:string}|null;onSelect:(contact:VoiceDirectoryContact)=>void;busy:boolean;revision:number}){
 const [filter,setFilter]=useState("today"),[sort,setSort]=useState("priority"),[refresh,setRefresh]=useState(0),[offset,setOffset]=useState(0);
 const [data,setData]=useState<{results:VoiceHotLead[];nextOffset:number|null;total:number}|null>(null);
 const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState("");
 const knownLeads=useRef(new Map<string,VoiceHotLead>());
 const handledCall=useRef<string|null>(null);
 useEffect(()=>{
  if(!finishedCall||handledCall.current===finishedCall.callId)return;
  const lead=knownLeads.current.get(finishedCall.customerId+":"+finishedCall.requestId);
  if(!lead)return;handledCall.current=finishedCall.callId;void save(lead,"ignored");
 // Keep the binding captured when this lead was loaded; never use the currently selected customer.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[finishedCall]);
 const [notReached,setNotReached]=useState<VoiceHotLead|null>(null),[notice,setNotice]=useState("");
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError("");
  void fetch("/api/ops/voice-copilot/hot-leads?"+new URLSearchParams({filter,sort,offset:String(offset)}),{cache:"no-store",signal:controller.signal})
   .then(r=>readPhoneCentralResponse<NonNullable<typeof data>>(r,"Hot-Leads konnten nicht vollständig geladen werden. Bitte erneut versuchen."))
   .then(result=>{if(!controller.signal.aborted){setData(result);for(const lead of result.results)knownLeads.current.set(lead.customerId+":"+lead.requestId,lead);}})
   .catch(e=>{if(!controller.signal.aborted){setData(null);setError(e.message);}}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[filter,sort,offset,refresh,revision]);
 async function save(lead:VoiceHotLead,status:"ignored"|"reached"|"scheduled",dueDate:string|null=null){
  setSaving(true);setError("");setNotice("");
  try{
   const response=await fetch("/api/ops/voice-copilot/hot-leads",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:lead.id,customerId:lead.customerId,status,sourceAt:lead.sourceAt,revision:lead.revision,dueDate})});
   const result=await readPhoneCentralResponse<{state:{revision:number}}>(response,"Änderung nicht gespeichert. Bitte aktualisieren und erneut versuchen.");
   setNotReached(status==="ignored"?{...lead,revision:result.state.revision}:null);
   setNotice(status==="scheduled"?"Wiedervorlage gespeichert: "+new Date(dueDate!+"T12:00:00").toLocaleDateString("de-DE"):status==="reached"?"Als erreicht aus der Liste entfernt.":"Ignoriert. Dieser Eintrag ist aus der Liste entfernt.");
   setOffset(0);setRefresh(n=>n+1);
  }catch(e){setError(e instanceof Error?e.message:"Speichern fehlgeschlagen.");}finally{setSaving(false);}
 }
 const disabled=busy||saving||loading;
 return <section aria-label="Hot-Leads">
  <h2 className={styles.leftTitle}>Hot-Leads</h2>
  <div className={styles.leadFilters}>
   <label>Zeitraum<select value={filter} onChange={e=>{setFilter(e.target.value);setOffset(0);}}><option value="today">Heute + Wiedervorlagen</option><option value="recent">Letzte 3 Wochen + Wiedervorlagen</option></select></label>
   <label>Sortieren<select value={sort} onChange={e=>{setSort(e.target.value);setOffset(0);}}><option value="priority">Empfohlene Reihenfolge</option><option value="amount">Betrag absteigend (EUR)</option><option value="newest">Neueste zuerst</option></select></label>
  </div>
  <p className={styles.small}>Offene Anfragen und Angebote. Die Empfehlung berücksichtigt Aktualität, Wiedervorlage und Angebotsaufrufe.</p>
  <button type="button" className={styles.retry} disabled={loading} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={15}/> Aktualisieren</button>
  {error?<p role="alert" className={styles.searchError}>{error}</p>:null}
  {notice?<p role="status">{notice}</p>:null}
  {notReached?<div className={styles.leadFollowup}><strong>Anruf bearbeitet: {notReached.displayName||notReached.company}</strong><p>Falls nicht erreicht: Du kannst den Eintrag morgen erneut aufnehmen. Ohne weitere Auswahl bleibt er ignoriert.</p><button type="button" className={styles.button} onClick={()=>setNotReached(null)}>Ignorieren</button><button type="button" className={styles.button} disabled={saving} onClick={()=>void save(notReached,"scheduled",shiftLeadDate(berlinDate(),1))}>Morgen wieder in Hot-Leads aufnehmen</button></div>:null}
  <p role="status" className={styles.directoryStatus}>{loading?"Hot-Leads werden geladen …":data?data.total+" offene Einträge":""}</p>
  {!loading&&data&&!data.results.length?<p>Für diesen Zeitraum ist die Liste erledigt.</p>:null}
  <div className={styles.results}>{data?.results.map(lead=><article key={lead.id} className={styles.leadCard}>
   <button type="button" className={styles.result} disabled={disabled} onClick={()=>onSelect(lead)}>
    <span className={styles.resultContent}><strong>{lead.company||lead.displayName||"Kontakt"} {lead.segment?<small className={styles.leadBadge} title="Automatisch anhand der E-Mail-Domain">{lead.segment}</small>:null}</strong>
     <span>{lead.requestTitle}</span><span>{lead.phone||"Rufnummer fehlt"}</span><span>{lead.email}</span>
     {leadAmount(lead)?<strong>{lead.offerNumber?"Angebot "+lead.offerNumber+": ":"Anfrage: "}{leadAmount(lead)}</strong>:null}
     <span>{lead.reasons.join(" · ")}</span>
    </span>
   </button>
   <div className={styles.leadActions}>
    <button type="button" disabled={disabled} onClick={()=>void save(lead,"reached")}>Erreicht</button>
    <button type="button" disabled={disabled} onClick={()=>void save(lead,"ignored")}>Nicht erreicht</button>
    <SnoozeMenu disabled={disabled} onSchedule={day=>void save(lead,"scheduled",day)}/>
   </div>
  </article>)}</div>
  {data&&data.total>30?<div className={styles.leadActions}><button type="button" disabled={disabled||offset===0} onClick={()=>setOffset(Math.max(0,offset-30))}>Zurück</button><button type="button" disabled={disabled||data.nextOffset===null} onClick={()=>setOffset(data.nextOffset!)}>Weitere Leads</button></div>:null}
 </section>;
}

function SnoozeMenu({disabled,onSchedule}:{disabled:boolean;onSchedule:(day:string)=>void}){return <details><summary aria-label="Wiedervorlage verschieben"><CalendarClock size={16}/> Verschieben</summary><div className={styles.leadSchedule}>
     <button type="button" disabled={disabled} onClick={()=>onSchedule(shiftLeadDate(berlinDate(),1))}>Auf morgen verschieben</button>
     <button type="button" disabled={disabled} onClick={()=>onSchedule(shiftLeadDate(berlinDate(),7))}>Auf nächste Woche verschieben</button>
     <form onSubmit={event=>{event.preventDefault();const day=new FormData(event.currentTarget).get("date");if(typeof day==="string")onSchedule(day);}}><label>Ein Datum wählen<input type="date" name="date" required min={berlinDate()}/></label><button type="submit" disabled={disabled}>Verschieben</button></form>
    </div></details>;}
export function DirectoryLeadSnooze({lead,onSaved}:{lead:VoiceHotLead;onSaved:()=>void}){
 const [saving,setSaving]=useState(false),[message,setMessage]=useState("");
 async function schedule(day:string){
  setSaving(true);setMessage("");
  try{
   const response=await fetch("/api/ops/voice-copilot/hot-leads",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:lead.id,customerId:lead.customerId,status:"scheduled",sourceAt:lead.sourceAt,revision:lead.revision,dueDate:day})});
   await readPhoneCentralResponse(response,"Wiedervorlage nicht gespeichert. Bitte aktualisieren und erneut versuchen.");
   setMessage("Wiedervorlage: "+new Date(day+"T12:00:00").toLocaleDateString("de-DE"));onSaved();
  }catch(e){setMessage(e instanceof Error?e.message:"Speichern fehlgeschlagen.");}finally{setSaving(false);}
 }
 return <div className={styles.leadActions} style={{justifyContent:"flex-end"}}><SnoozeMenu disabled={saving} onSchedule={day=>void schedule(day)}/>{message?<span role="status">{message}</span>:null}</div>;
}
