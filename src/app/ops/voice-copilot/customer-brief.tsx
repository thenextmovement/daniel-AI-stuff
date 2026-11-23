"use client";
import {useEffect,useState} from "react";
import type {VoiceCustomerContext} from "@/lib/ops/voice-knowledge";
import {currentEmailReply} from "@/lib/ops/voice-email-reply";
import { fetchPhoneRead } from "./phone-central-data";
import styles from "./phone-central.module.css";

import { VoiceHistoryPanel } from "./voice-history-panel";

import type { CustomerOpsNote } from "@/lib/ops/customer-records";

type Entry={callNotes?:CustomerOpsNote[];id:string;occurred_at:string|null;kind:string;subject:string|null;detail:string|null;request_ref:string|null;session_id:string|null;placetel?:{dispatch:string;recording:string;endedAt:string|null}};
type LatestCall={id:string;startedAt:string;endedAt:string|null;summary:string|null;recording:string|null;requestId:string;status:string};
type Page={entries:Entry[];brief:Entry[];nextOffset:number|null};
const labels:Record<string,string>={inbound:"Kunde schreibt",outbound:"Unsere Antwort",note:"Interne Notiz",transcript:"Gesprächsnotiz",call:"Anruf"};
function phoneEntry(entry:Entry) {
  if (entry.kind === "inbound" || entry.kind === "outbound") return {
    label:labels[entry.kind], subject:entry.subject, detail:currentEmailReply(entry.detail) || "Kein eigener Nachrichtentext.", transcript:false,
  };
  const state=entry.placetel;
  if(!state) return {label:labels[entry.kind],subject:entry.subject,detail:entry.detail,transcript:Boolean(entry.session_id)};
  const recorded=state.recording==="complete" || state.recording==="single_speaker";
  if(recorded) return {label:"Gesprächsnotiz",subject:state.recording==="single_speaker"?"Mitschrift · Eine Stimme erkannt":"Mitschrift und Zusammenfassung",detail:entry.detail,transcript:true};
  const recording:Record<string,string>={
    missing:"Bisher ist keine passende Aufnahme verfügbar. Die Prüfung läuft weiter.",
    failed:"Die Aufnahme konnte noch nicht verarbeitet werden. Ein weiterer Versuch folgt.",
    ambiguous:"Die Aufnahme lässt sich diesem Anruf nicht eindeutig zuordnen.",
    expired:"Die Prüfung ist beendet. Es liegt keine zugeordnete Mitschrift vor.",
  };
  if (state.endedAt) return {
    label:"Anruf", subject:"Gespräch beendet",
    detail:recording[state.recording] || "Mitschrift und Zusammenfassung werden nach der Aufzeichnung ergänzt.",
    transcript:false,
  };
  const dispatch:Record<string,string>={
    unreserved:"Die Wahl wurde vorbereitet. Eine Übergabe an Placetel ist nicht bestätigt.",
    reserved:"Die Wahl ist vorgemerkt. Eine Übergabe an Placetel ist nicht bestätigt.",
    dispatched:"Die Übergabe an Placetel wurde gestartet. Eine Bestätigung steht aus.",
    uncertain:"Ob Placetel die Wahl angenommen hat, ist unklar.",
    softphone:"Direktwahl im Softphone vorbereitet. Die Aufnahme steht noch aus.",
    accepted:"Placetel hat den Wählauftrag angenommen. Die Aufnahme steht noch aus.",
    rejected:"Der Wählauftrag wurde abgelehnt.",
    expired:"Der Wählauftrag ist vor der Übergabe an Placetel abgelaufen.",
  };
  const detail=state.dispatch==="rejected" || state.dispatch==="expired" ? dispatch[state.dispatch]
    : recording[state.recording] || dispatch[state.dispatch] || "Der Stand des Wählauftrags ist unbekannt.";
  return {label:"Wählversuch",subject:"Ausgehender Wählversuch",detail,transcript:false};
}
export function CustomerBrief({id,requestId,context,revision,onNoteTarget}:{revision:number;onNoteTarget:(callId:string,time:string)=>void;id:string;requestId:string;context:VoiceCustomerContext|null}) {
  const [summaryTab,setSummaryTab]=useState<"latest"|"overall">("overall");
  const [latest,setLatest]=useState<LatestCall|null>(null);
  const [latestLoading,setLatestLoading]=useState(true),[latestFailed,setLatestFailed]=useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [channel,setChannel]=useState<"email"|"phone"|"notes">("phone");
  const [summary,setSummary]=useState<string|null>(null);
  const [summaryLoading,setSummaryLoading]=useState(true);
  const [summaryFailed,setSummaryFailed]=useState(false);
  const [counts,setCounts]=useState<Record<string,number|null>>({});
  const [page,setPage]=useState<Page|null>(null),[offset,setOffset]=useState(0),[retry,setRetry]=useState(0);
  const [error,setError]=useState(false),[loading,setLoading]=useState(true);
  useEffect(()=>{
    const controller=new AbortController();
    const params=new URLSearchParams({customerId:id,requestId});
    const read=async (part:string)=>{
      return fetchPhoneRead<any>("/api/ops/voice-copilot/overview?"+params+"&part="+part,controller.signal,part==="summary"?60000:15000);
    };
    setLatestLoading(true);setLatestFailed(false);
    void read("latest").then(data=>{if(!controller.signal.aborted)setLatest(data.latest);})
      .catch(()=>{if(!controller.signal.aborted)setLatestFailed(true);})
      .finally(()=>{if(!controller.signal.aborted)setLatestLoading(false);});
    let fresh=false;
    void read("cached").then(data=>{if(!controller.signal.aborted && !fresh && data.summary)setSummary(data.summary);}).catch(()=>{});
    setSummaryFailed(false);
    setSummaryLoading(true);
    void read("counts").then(data=>{if(!controller.signal.aborted)setCounts(data);})
      .catch(()=>{if(!controller.signal.aborted)setCounts({email:null,phone:null,notes:null});});
    void read("summary").then(data=>{if(!controller.signal.aborted){fresh=true;setSummary(data.summary);}})
      .catch(()=>{if(!controller.signal.aborted)setSummaryFailed(true);})
      .finally(()=>{if(!controller.signal.aborted)setSummaryLoading(false);});
    return ()=>controller.abort();
  },[id,requestId,revision,retry]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError(false);
    const params=new URLSearchParams({history:"1",channel,customerId:id,offset:String(offset),requestId});
    const notesOnly=channel==="notes";
    const url=notesOnly ? "/api/ops/customer-records/notes?"+new URLSearchParams({requestId,offset:String(offset)}) : "/api/ops/voice-copilot/context?"+params;
    void fetchPhoneRead<Page | {notes:CustomerOpsNote[];nextOffset:number|null}>(url,controller.signal)
      .then(result=>{if (!notesOnly) return result as Page;
        const data=result as {notes:CustomerOpsNote[];nextOffset:number|null};
        return {nextOffset:data.nextOffset,brief:[],entries:data.notes.map(n=>({
          id:n.id, occurred_at:n.createdAt, kind:"note", subject:n.callId ? "Notiz zum Telefonat" + (n.callStartedAt ? " vom "+new Date(n.callStartedAt).toLocaleString("de-DE") : "") : "Notiz zum Vorgang",
          detail:n.note,request_ref:requestId,session_id:n.callId || null,
        }))} as Page;})
      .then(data=>{if(controller.signal.aborted)return;
        setPage(old=>offset&&old?{...data,brief:old.brief,entries:[...new Map([...old.entries,...data.entries].map(e=>[e.id,e])).values()]}:notesOnly ? {...data,brief:old?.brief || []} : data);})
      .catch(()=>{if(!controller.signal.aborted)setError(true);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[id,requestId,channel,offset,retry,revision]);
  const waiting=page?.entries.some(({placetel})=>placetel && ["reserved","dispatched","uncertain","accepted","softphone"].includes(placetel.dispatch) &&
    ["pending","missing","failed"].includes(placetel.recording));
  useEffect(()=>{
    if(channel!=="phone" || offset!==0 || !waiting) return;
    const timer=window.setInterval(()=>{
      if(document.visibilityState==="visible") setRetry(n=>n+1);
    },30000);
    return ()=>window.clearInterval(timer);
  },[channel,offset,waiting]);
  const req=context?.request;
  return <section className={styles.prep} aria-label="Gesprächsüberblick">
    <header className={styles.overviewHeader}>
      <h3>Auf einen Blick</h3>
      <button type="button" className={styles.link} disabled={summaryLoading || loading} onClick={()=>{setOffset(0);setRetry(n=>n+1);}}>{summaryLoading ? "Wird aktualisiert …" : "Aktualisieren"}</button>
    </header>
    <div className={styles.historyTabs} role="group" aria-label="Zusammenfassung auswählen">
      <button type="button" aria-pressed={summaryTab==="latest"} onClick={()=>setSummaryTab("latest")}>Letztes Gespräch</button>
      <button type="button" aria-pressed={summaryTab==="overall"} onClick={()=>setSummaryTab("overall")}>Gesamtzusammenfassung</button>
    </div>
    <section className={styles.currentBrief} aria-label={summaryTab==="latest"?"Zusammenfassung des letzten Gesprächs":"Gesamtzusammenfassung"}>
    {summaryTab==="overall" ? <>
      {summaryFailed && !summary ? <p>Zusammenfassung derzeit nicht verfügbar. <button className={styles.link} onClick={()=>setRetry(n=>n+1)}>Erneut versuchen</button></p>
        : summary ? <ul className={styles.briefBullets}>{summary.split(/\n+/).map(line=>line.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean).map((line,i)=><li key={i}>{line}</li>)}</ul> : <p>KI-Zusammenfassung wird erstellt …</p>}
      {summary && summaryLoading && <small>Gespeicherter Stand · Aktualisierung läuft …</small>}
      {summary && summaryFailed && <small>Gespeicherter Stand · Aktualisierung derzeit nicht verfügbar.</small>}
    </> : <>
      {latest && <p className={styles.small}>{new Date(latest.startedAt).toLocaleString("de-DE")} · Vorgang {latest.requestId.slice(0,8)}</p>}
      <p>{latestFailed ? "Das letzte Gespräch konnte nicht geladen werden." : latestLoading && !latest ? "Letztes Gespräch wird geladen …" : !latest ? "Noch kein Gespräch gespeichert." : latest.summary || (
        latest.recording==="expired" || latest.recording==="ambiguous" ? "Für dieses Gespräch liegt keine eindeutig zugeordnete Aufnahme vor. Eine KI-Zusammenfassung ist noch nicht verfügbar." :
        latest.endedAt ? "Gespräch beendet. Sobald die Aufnahme bereitsteht, erstellt die KI automatisch Mitschrift und Zusammenfassung." :
        "Die Zusammenfassung wird nach dem Gespräch aus der Aufnahme erstellt.")}</p>
      {latest?.recording==="single_speaker" && <small>Nur eine Stimme erkannt · die Zusammenfassung kann unvollständig sein.</small>}
      {latestFailed && <button className={styles.link} onClick={()=>setRetry(n=>n+1)}>Erneut versuchen</button>}
    </>}
    </section>
    {req && <div className={styles.caseFacts}>
      <details>
        <summary>Produktdetails</summary><dl>
          {[["Produktart",req.productType],["Größe",req.size],["Farbe",req.colors.join(", ")],["Einsatzort",req.application],["Liefertermin",req.deliveryTime],["Anfrage",req.description]].filter(([,value])=>value).map(([label,value])=>
            <div key={label}><dt>{label}:</dt><dd>{value}</dd></div>)}
        </dl>
        {![req.productType,req.size,req.colors.length,req.application,req.deliveryTime,req.description].some(Boolean) && <p>Keine Produktdetails hinterlegt.</p>}
      </details>
    </div>}
    {loading && <p role="status">Verlauf wird geladen …</p>}
    {error && <p role="status">Verlauf konnte nicht geladen werden. <button onClick={()=>setRetry(n=>n+1)}>Erneut versuchen</button></p>}
    <section aria-label="Kommunikationsverlauf"><h3>E-Mail- und Telefonverlauf</h3>
      <p className={styles.small}>{channel==="notes" ? "Unsere Notizen zum ausgewählten Vorgang" : "Alle Vorgänge dieses Kunden"} · Neueste zuerst</p>
      <button type="button" className={styles.link} disabled={loading} onClick={()=>{setOffset(0);setRetry(n=>n+1);}}>Verlauf aktualisieren</button>
      <div className={styles.historyTabs} role="group" aria-label="Verlauf auswählen">
        {(["email","phone","notes"] as const).filter(kind=>kind!=="notes" || requestId).map(kind=><button key={kind} type="button" aria-pressed={channel===kind} onClick={()=>{
          if(kind===channel)return;
          setExpanded(null);
          setPage(old=>old ? {...old,entries:[],nextOffset:null} : null);
          setError(false);setLoading(true);setOffset(0);setChannel(kind);
        }}>{kind==="email"?"E-Mail":kind==="phone"?"Telefon":"Unsere Notizen"} <span className={styles.countBadge} title={counts[kind]===null ? "Anzahl nicht verfügbar" : undefined}>{counts[kind] ?? (counts[kind]===null ? "–" : "…")}</span></button>)}
      </div>
      {page?.entries.map(e=>{const display=phoneEntry(e);return <article className={styles.historyMessage} data-kind={e.kind} key={e.id}>
        <small>{e.occurred_at && new Date(e.occurred_at).toLocaleString("de-DE")} · {display.label} · {e.request_ref?"Vorgang "+e.request_ref.slice(0,8):"Ohne Vorgangsverweis"}</small>
        <p><strong>{display.subject || "Ohne Betreff"}</strong></p><p>{display.detail}</p>
        {e.callNotes?.map(note=><div className={styles.callNote} key={note.id}><small><strong>Interne Notiz</strong> · {note.createdAt && new Date(note.createdAt).toLocaleString("de-DE")}</small><p>{note.note}</p></div>)}
        {channel==="phone" && e.session_id && (e.request_ref===requestId || e.request_ref===requestId.slice(0,8)) && <button type="button" className={styles.link} onClick={()=>onNoteTarget(e.session_id!,e.occurred_at || "")}>Notiz zum Telefonat schreiben</button>}
        {channel==="phone" && display.transcript && e.session_id && <><button type="button" className={styles.link} aria-expanded={expanded===e.id} onClick={()=>setExpanded(expanded===e.id ? null : e.id)}>{expanded===e.id ? "Transkription einklappen" : "Transkription anzeigen"}</button>
          {expanded===e.id && <VoiceHistoryPanel key={e.session_id} initialSessionId={e.session_id} inline/>}</>}
      </article>;})}
      {page && !loading && !error && !page.entries.length && <p>{channel==="email"?"Keine E-Mails gespeichert.":channel==="notes"?"Keine internen Notizen gespeichert.":"Keine Telefonate gespeichert."}</p>}
      {page?.nextOffset!=null && <button className={styles.button} disabled={loading} onClick={()=>{if(offset===page.nextOffset)setRetry(n=>n+1);else setOffset(page.nextOffset!);}}>Ältere Einträge laden</button>}
    </section>
  </section>;
}
