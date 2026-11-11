"use client";
import {useEffect,useState} from "react";
import type {VoiceCustomerContext} from "@/lib/ops/voice-knowledge";
import styles from "./phone-central.module.css";

type Entry={id:string;occurred_at:string|null;kind:string;subject:string|null;detail:string|null;request_ref:string|null;session_id:string|null};
type Page={entries:Entry[];brief:Entry[];nextOffset:number|null};
const labels:Record<string,string>={inbound:"Kunde schreibt",outbound:"Unsere Antwort",transcript:"Gesprächsnotiz",call:"Anruf"};
function abridge(input:string|null,max=240) {
  const text=(input||"").split(/(?:\n(?:Von:|From:|Am .+ schrieb)|\s(?:Mit freundlichen Grüßen|Viele Grüße|Beste Grüße)\b)/i)[0]
    .replace(/^(?:Hallo|Hi|Guten Tag|Moin)\s+[^,\n]{1,55}[,\n]\s*/i,"").replace(/\s+/g," ").trim();
  if(text.length<=max)return text;
  return text.slice(0,max).replace(/\s+\S*$/,"")+"…";
}
export function CustomerBrief({id,requestId,context}:{id:string;requestId:string;context:VoiceCustomerContext|null}) {
  const [page,setPage]=useState<Page|null>(null),[offset,setOffset]=useState(0),[retry,setRetry]=useState(0);
  const [error,setError]=useState(false),[loading,setLoading]=useState(true);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError(false);
    const params=new URLSearchParams({history:"1",customerId:id,offset:String(offset),requestId});
    void fetch("/api/ops/voice-copilot/context?"+params,{signal:controller.signal,cache:"no-store"})
      .then(async response=>{if(!response.ok)throw Error();return await response.json() as Page;})
      .then(data=>{if(controller.signal.aborted)return;setPage(old=>offset&&old?{...data,brief:old.brief,entries:[...new Map([...old.entries,...data.entries].map(e=>[e.id,e])).values()]}:data);})
      .catch(()=>{if(!controller.signal.aborted)setError(true);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[id,requestId,offset,retry]);
  const req=context?.request;
  return <section className={styles.prep} aria-label="Gesprächsüberblick">
    <p className={styles.label}>Vor dem Anruf</p><h3>Auf einen Blick</h3>
    {context && <p className={styles.small}>{[context.customer.email,context.customer.phone].filter(Boolean).join(" · ")}</p>}
    {req ? <><p><strong>{req.title || "Anfrage"} · {requestId.slice(0,8)}</strong></p>
      <p>{abridge(req.description,320)||"Keine Beschreibung hinterlegt."}</p>
      <p>{[req.size,...req.colors,req.application,req.deliveryTime].filter(Boolean).join(" · ")}</p></> : <p>{requestId ? "Ausgewählter Vorgang · " + requestId.slice(0,8) : "Kein Vorgang ausgewählt."}</p>}
    {page?.brief.map(e=><p key={e.id}><strong>{labels[e.kind]}: </strong>{abridge(e.detail)||e.subject}</p>)}
    {page && requestId && !page.brief.length && <p className={styles.small}>Keine Mail oder Gesprächsnotiz eindeutig dieser Anfrage zugeordnet.</p>}
    {page && !page.brief.some(e=>e.kind==="inbound"||e.kind==="outbound") && ["inbound","outbound"].map(kind=>{
      const entry=page.entries.find(e=>e.kind===kind && !e.request_ref);
      return entry && <p key={kind}><strong>{labels[kind]} (ohne Vorgangsverweis): </strong>{abridge(entry.detail)||entry.subject}</p>;
    })}
    {loading && <p role="status">Verlauf wird geladen …</p>}
    {error && <p role="status">Verlauf konnte nicht geladen werden. <button onClick={()=>setRetry(n=>n+1)}>Erneut versuchen</button></p>}
    <details><summary className={styles.link}>E-Mail- und Telefonverlauf</summary>
      <p className={styles.small}>Alle Vorgänge dieses Kunden · Neueste zuerst</p>
      {page?.entries.map(e=><article className={styles.event} key={e.id}>
        <small>{e.occurred_at && new Date(e.occurred_at).toLocaleString("de-DE")} · {labels[e.kind]} · {e.request_ref?"Vorgang "+e.request_ref.slice(0,8):"Ohne Vorgangsverweis"}</small>
        <p><strong>{e.subject || "Ohne Betreff"}</strong></p><p>{e.detail}</p>
        {e.session_id && <a className={styles.link} href={"/ops/voice-copilot?transcript="+encodeURIComponent(e.session_id)} target="_blank" rel="noreferrer">Transkript öffnen ↗</a>}
      </article>)}
      {page && !page.entries.length && <p>Noch keine Kommunikation gespeichert.</p>}
      {page?.nextOffset!=null && <button className={styles.button} disabled={loading} onClick={()=>{if(offset===page.nextOffset)setRetry(n=>n+1);else setOffset(page.nextOffset!);}}>Ältere Einträge laden</button>}
    </details>
  </section>;
}
