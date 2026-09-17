"use client";
import {useEffect,useRef,useState} from "react";
import type {useBrowserPhone} from "./use-browser-phone";
import {readPhoneCentralResponse} from "./phone-central-data";
import styles from "./phone-central.module.css";
type AiCall={attemptId:string;callId:string;phone:string;startedAt:string};
type Segment={source_item_id:string;speaker:string;text:string;is_final:boolean;start_ms:number};
type View={calls:AiCall[];segments:Segment[]};
export function PhoneAiCallsPanel({phone,onTakeover}:{phone:ReturnType<typeof useBrowserPhone>;onTakeover:(id:string)=>void}){
 const [calls,setCalls]=useState<AiCall[]>([]),[selected,setSelected]=useState(""),[segments,setSegments]=useState<Segment[]>([]);
 const [error,setError]=useState(""),[loaded,setLoaded]=useState(false);const generation=useRef(0);
 useEffect(()=>{
  const epoch=++generation.current;let running=false;
  setSegments([]);setError("");
  const poll=async()=>{
   if(running)return;running=true;
   try{
    const response=await fetch("/api/ops/voice-phone/ai-handoffs?active=1"+(selected?"&attemptId="+encodeURIComponent(selected):""),{cache:"no-store",signal:AbortSignal.timeout(12000)});
    const data=await readPhoneCentralResponse<View>(response,"KI-Gespräche gerade nicht erreichbar.");
    if(epoch!==generation.current)return;
    if(selected){
     setSegments(data.segments);
     if(!data.calls.some(c=>c.attemptId===selected)){setSelected("");setCalls([]);}
    }else{setCalls(data.calls);if(data.calls.length===1)setSelected(data.calls[0].attemptId);}
    setLoaded(true);setError("");
   }catch{if(epoch===generation.current)setError("KI-Gespräche gerade nicht erreichbar. Die Anrufe laufen unabhängig davon weiter.");}
   finally{running=false;}
  };
  void poll();const timer=window.setInterval(()=>void poll(),2000);
  return ()=>{generation.current++;window.clearInterval(timer);};
 },[selected]);
 return <section className={styles.phoneTranscript} aria-label="Laufende KI-Gespräche">
  <div className={styles.phoneTranscriptTitle}><h3>KI im Gespräch</h3><span>Testbetrieb</span></div>
  {!selected?<div>{calls.map(c=><button type="button" className={styles.button} key={c.attemptId} onClick={()=>setSelected(c.attemptId)}>Mitschrift · {c.phone}</button>)}</div>:<>
   <p className={styles.small}>{calls.find(c=>c.attemptId===selected)?.phone||"KI-Testanruf"} · {calls.find(c=>c.attemptId===selected)?.startedAt?new Date(calls.find(c=>c.attemptId===selected)!.startedAt).toLocaleString("de-DE"):""}</p>
   <div className={styles.actions}>
    <button type="button" className={styles.button+" "+styles.primary} disabled={phone.busy||!phone.registered} onClick={()=>onTakeover(selected)}>Im Browser übernehmen</button>
    <button type="button" className={styles.button} disabled={!!phone.aiHandoff} onClick={()=>setSelected("")}>Alle KI-Gespräche</button>
   </div>
   {!phone.registered?<p className={styles.small}>Verbinde oben dein persönlich angemeldetes Browser-Telefon.</p>:null}
   <ol className={styles.phoneTranscriptLines} aria-label="Live-Mitschrift der KI">
    {segments.map(segment=><li key={segment.source_item_id}><div><strong>{segment.speaker==="customer"?"Gesprächspartner":segment.speaker==="assistant"?"KI":"Mitarbeiter"}</strong><time>{Math.floor(segment.start_ms/60000)}:{String(Math.floor(segment.start_ms/1000)%60).padStart(2,"0")}</time>{!segment.is_final?<span>Vorläufig</span>:null}</div><p>{segment.text}</p></li>)}
   </ol>
   <p className={styles.small}>Letzte 100 Beiträge. Testgespräch · getrennt von der Kundenhistorie.</p>
  </>}
  {loaded&&!calls.length&&!selected&&!error?<p className={styles.small}>Gerade kein übernehmbares KI-Testgespräch.</p>:null}
  {error?<p className={styles.searchError} role="alert">{error}</p>:null}
 </section>;
}
