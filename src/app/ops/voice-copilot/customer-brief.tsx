"use client";
import {useEffect,useState} from "react";
import type {VoiceCustomerContext} from "@/lib/ops/voice-knowledge";
import styles from "./phone-central.module.css";

type Entry={id:string;occurred_at:string|null;kind:string;subject:string|null;detail:string|null;request_ref:string|null;session_id:string|null;placetel?:{dispatch:string;recording:string}};
type Page={entries:Entry[];brief:Entry[];nextOffset:number|null};
const labels:Record<string,string>={inbound:"Kunde schreibt",outbound:"Unsere Antwort",transcript:"Gesprächsnotiz",call:"Anruf"};
function phoneEntry(entry:Entry) {
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
  const dispatch:Record<string,string>={
    unreserved:"Die Wahl wurde vorbereitet. Eine Übergabe an Placetel ist nicht bestätigt.",
    reserved:"Die Wahl ist vorgemerkt. Eine Übergabe an Placetel ist nicht bestätigt.",
    dispatched:"Die Übergabe an Placetel wurde gestartet. Eine Bestätigung steht aus.",
    uncertain:"Ob Placetel die Wahl angenommen hat, ist unklar.",
    accepted:"Placetel hat den Wählauftrag angenommen. Die Aufnahme steht noch aus.",
    rejected:"Der Wählauftrag wurde abgelehnt.",
    expired:"Der Wählauftrag ist vor der Übergabe an Placetel abgelaufen.",
  };
  const detail=state.dispatch==="rejected" || state.dispatch==="expired" ? dispatch[state.dispatch]
    : recording[state.recording] || dispatch[state.dispatch] || "Der Stand des Wählauftrags ist unbekannt.";
  return {label:"Wählversuch",subject:"Ausgehender Wählversuch",detail,transcript:false};
}
function abridge(input:string|null,max=240) {
  const text=(input||"").split(/(?:\n(?:Von:|From:|Am .+ schrieb)|\s(?:Mit freundlichen Grüßen|Viele Grüße|Beste Grüße)\b)/i)[0]
    .replace(/^(?:Hallo|Hi|Guten Tag|Moin)\s+[^,\n]{1,55}[,\n]\s*/i,"").replace(/\s+/g," ").trim();
  if(text.length<=max)return text;
  return text.slice(0,max).replace(/\s+\S*$/,"")+"…";
}
export function CustomerBrief({id,requestId,context}:{id:string;requestId:string;context:VoiceCustomerContext|null}) {
  const [channel,setChannel]=useState<"email"|"phone">("phone");
  const [unassigned,setUnassigned]=useState<Entry[]>([]);
  const [page,setPage]=useState<Page|null>(null),[offset,setOffset]=useState(0),[retry,setRetry]=useState(0);
  const [error,setError]=useState(false),[loading,setLoading]=useState(true);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError(false);
    const params=new URLSearchParams({history:"1",channel,customerId:id,offset:String(offset),requestId});
    void fetch("/api/ops/voice-copilot/context?"+params,{signal:controller.signal,cache:"no-store"})
      .then(async response=>{if(!response.ok)throw Error();return await response.json() as Page;})
      .then(data=>{if(controller.signal.aborted)return;
        if(channel==="email" && !offset)setUnassigned(data.entries.filter(e=>!e.request_ref));
        setPage(old=>offset&&old?{...data,brief:old.brief,entries:[...new Map([...old.entries,...data.entries].map(e=>[e.id,e])).values()]}:data);})
      .catch(()=>{if(!controller.signal.aborted)setError(true);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[id,requestId,channel,offset,retry]);
  const waiting=page?.entries.some(({placetel})=>placetel && ["reserved","dispatched","uncertain","accepted"].includes(placetel.dispatch) &&
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
    <p className={styles.label}>Vor dem Anruf</p><h3>Auf einen Blick</h3>
    {context && <p className={styles.small}>{[context.customer.email,context.customer.phone].filter(Boolean).join(" · ")}</p>}
    {req ? <><p><strong>{req.title || "Anfrage"} · {requestId.slice(0,8)}</strong></p>
      <p>{abridge(req.description,320)||"Keine Beschreibung hinterlegt."}</p>
      <p>{[req.size,...req.colors,req.application,req.deliveryTime].filter(Boolean).join(" · ")}</p></> : <p>{requestId ? "Ausgewählter Vorgang · " + requestId.slice(0,8) : "Kein Vorgang ausgewählt."}</p>}
    {page?.brief.map(e=><p key={e.id}><strong>{phoneEntry(e).label}: </strong>{abridge(phoneEntry(e).detail)||e.subject}</p>)}
    {page && requestId && !page.brief.length && <p className={styles.small}>Keine Mail oder Gesprächsnotiz eindeutig dieser Anfrage zugeordnet.</p>}
    {page && !page.brief.some(e=>e.kind==="inbound"||e.kind==="outbound") && ["inbound","outbound"].map(kind=>{
      const entry=unassigned.find(e=>e.kind===kind);
      return entry && <p key={kind}><strong>{labels[kind]} (ohne Vorgangsverweis): </strong>{abridge(entry.detail)||entry.subject}</p>;
    })}
    {loading && <p role="status">Verlauf wird geladen …</p>}
    {error && <p role="status">Verlauf konnte nicht geladen werden. <button onClick={()=>setRetry(n=>n+1)}>Erneut versuchen</button></p>}
    <section aria-label="Kommunikationsverlauf"><h3>E-Mail- und Telefonverlauf</h3>
      <p className={styles.small}>Alle Vorgänge dieses Kunden · Neueste zuerst</p>
      <button type="button" className={styles.link} disabled={loading} onClick={()=>{setOffset(0);setRetry(n=>n+1);}}>Verlauf aktualisieren</button>
      <div className={styles.historyTabs} role="group" aria-label="Verlauf auswählen">
        {(["email","phone"] as const).map(kind=><button key={kind} type="button" aria-pressed={channel===kind} onClick={()=>{
          if(kind===channel)return;
          setPage(old=>old ? {...old,entries:[],nextOffset:null} : null);
          setError(false);setLoading(true);setOffset(0);setChannel(kind);
        }}>{kind==="email"?"E-Mail":"Telefon"}</button>)}
      </div>
      {page?.entries.map(e=>{const display=phoneEntry(e);return <article className={styles.historyMessage} data-kind={e.kind} key={e.id}>
        <small>{e.occurred_at && new Date(e.occurred_at).toLocaleString("de-DE")} · {display.label} · {e.request_ref?"Vorgang "+e.request_ref.slice(0,8):"Ohne Vorgangsverweis"}</small>
        <p><strong>{display.subject || "Ohne Betreff"}</strong></p><p>{display.detail}</p>
        {display.transcript && e.session_id && <a className={styles.link} href={"/ops/voice-copilot?transcript="+encodeURIComponent(e.session_id)} target="_blank" rel="noreferrer">Transkript öffnen ↗</a>}
      </article>;})}
      {page && !loading && !error && !page.entries.length && <p>{channel==="email"?"Keine E-Mails gespeichert.":"Keine Telefonate gespeichert."}</p>}
      {page?.nextOffset!=null && <button className={styles.button} disabled={loading} onClick={()=>{if(offset===page.nextOffset)setRetry(n=>n+1);else setOffset(page.nextOffset!);}}>Ältere Einträge laden</button>}
    </section>
  </section>;
}
