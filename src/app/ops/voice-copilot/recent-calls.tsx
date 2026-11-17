"use client";
import { useEffect, useState } from "react";
import type { RecentPhoneCall } from "@/lib/ops/voice-recent-calls";
import type { VoiceDirectoryContact } from "@/lib/ops/voice-directory";
import styles from "./phone-central.module.css";

export function RecentCalls({busy,onSelect,onNumber}:{busy:boolean;onSelect:(contact:VoiceDirectoryContact)=>void;onNumber:(phone:string)=>void}) {
  const [calls,setCalls]=useState<RecentPhoneCall[]|null>(null);
  const [failed,setFailed]=useState(false);
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setFailed(false);
    void fetch("/api/ops/voice-copilot/context?recentCalls=1",{cache:"no-store",signal:controller.signal})
      .then(async response=>{if (!response.ok) throw Error();return await response.json();})
      .then(data=>{if(!Array.isArray(data.calls)) throw Error();if(!controller.signal.aborted)setCalls(data.calls);})
      .catch(()=>{if(!controller.signal.aborted)setFailed(true);});
    return ()=>controller.abort();
  },[retry]);
  return <section className={styles.prep} aria-label="Letzte Anrufe"><h3>Letzte Anrufe</h3>
    {failed ? <p>Anrufe konnten nicht geladen werden. <button className={styles.link} onClick={()=>setRetry(n=>n+1)}>Erneut versuchen</button></p>
      : calls===null ? <p>Anrufe werden geladen …</p> : !calls.length ? <p>Noch keine Anrufe gespeichert.</p> :
      calls.map(call=><button type="button" key={call.id} className={styles.recentCall} disabled={busy}
        onClick={()=>call.contact ? onSelect(call.contact) : onNumber(call.phone)}>
        <strong>{call.contact?.company || call.contact?.displayName || call.phone}</strong>
        <small>{call.contact ? call.phone : "Ohne Kundenzuordnung"} · {new Date(call.time).toLocaleString("de-DE",{dateStyle:"short",timeStyle:"short"})}</small>
      </button>)}
  </section>;
}
