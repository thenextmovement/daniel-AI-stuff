"use client";
import {useEffect,useRef,useState} from "react";
import type {BrowserCall} from "./use-browser-phone";
import {readPhoneCentralResponse} from "./phone-central-data";
import styles from "./phone-central.module.css";
type View={enabled:boolean;coverageInterrupted:boolean;captures:Array<{id:string;state:string;startedAt:string|null;endedAt:string|null;cleanupPending:boolean}>;
 segments:Array<{source_item_id:string;speaker:string;text:string;is_final:boolean;start_ms:number;end_ms:number|null}>};
export function PhoneTranscriptPanel({call,recipientConsultation}:{call:BrowserCall|null;recipientConsultation:boolean}){
 const [view,setView]=useState<View|null>(null),[consent,setConsent]=useState(false),[working,setWorking]=useState(false),[error,setError]=useState("");
 const requestKey=useRef<string|null>(null),generation=useRef(0),activeId=call?.id||null;
 useEffect(()=>{
  const epoch=++generation.current;setView(null);setConsent(false);setError("");setWorking(false);requestKey.current=null;
  if(!activeId||recipientConsultation)return;
  let running=false;
  const refresh=async()=>{
   if(running)return;running=true;
   try{
    const response=await fetch("/api/ops/voice-phone/captures?id="+encodeURIComponent(activeId),{cache:"no-store",signal:AbortSignal.timeout(12000)});
    const data=await readPhoneCentralResponse<View>(response,"Mitschrift gerade nicht erreichbar.");
    if(epoch===generation.current){setView(data);setError("");}
   }catch(error){if(epoch===generation.current)setError(error instanceof Error?error.message:"Mitschrift gerade nicht erreichbar.");}
   finally{running=false;}
  };
  void refresh();const timer=window.setInterval(()=>void refresh(),2000);
  return ()=>{generation.current++;window.clearInterval(timer);};
 },[activeId,recipientConsultation]);
 if(!call||recipientConsultation)return null;
 const latest=view?.captures[0],active=latest&&!latest.endedAt;
 const state=latest?.state;
 async function act(action:"start"|"stop"){
  if(working||!activeId)return;const epoch=generation.current;
  setWorking(true);setError("");
  if(action==="start"&&!requestKey.current)requestKey.current=crypto.randomUUID();
  try{
   const response=await fetch("/api/ops/voice-phone/captures",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
    action,callId:activeId,...(action==="start"?{requestKey:requestKey.current,consentConfirmed:consent}:{captureId:latest?.id}),
   }),signal:AbortSignal.timeout(22000)});
   await readPhoneCentralResponse(response,"Mitschrift konnte nicht bestätigt werden.");
   if(epoch===generation.current){requestKey.current=null;setConsent(false);}
  }catch(error){if(epoch===generation.current)setError(error instanceof Error?error.message:"Mitschrift konnte nicht bestätigt werden.");}
  finally{if(epoch===generation.current)setWorking(false);}
 }
 return <section className={styles.phoneTranscript} aria-label="Telefonmitschrift">
  <div className={styles.phoneTranscriptTitle}><h3>Telefonmitschrift</h3><span role="status">{state==="active"?"Mitschrift läuft":active?"Mitschrift startet …":state==="interrupted"?"Mitschrift unterbrochen":state==="complete"?"Gespeichert":"Noch keine Mitschrift"}</span></div>
  {!active&&view?.enabled&&call.connected&&!latest?.cleanupPending?<div className={styles.phoneTranscriptConsent}>
   <label><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/> Transkription und Speicherung mit dem Gesprächspartner geklärt und bestätigt.</label>
   <button type="button" className={styles.button} disabled={!consent||working} onClick={()=>void act("start")}>{working?"Wird gestartet …":"Mitschrift starten"}</button>
  </div>:null}
  {active?<button type="button" className={styles.retry} disabled={working} onClick={()=>void act("stop")}>Mitschrift beenden · Gespräch fortsetzen</button>:null}
  {view?.coverageInterrupted?<p className={styles.small}>Die Mitschrift kann Lücken enthalten. Das Telefonat kann weiterlaufen.</p>:null}
  {view&&!view.enabled&&!latest?<p className={styles.small}>Die Mitschrift wird für diesen Anschluss noch eingerichtet.</p>:null}
  {error?<p className={styles.searchError} role="alert">{error}</p>:null}
  {view?.segments.length?<ol className={styles.phoneTranscriptLines} aria-label="Gespeicherte Gesprächsbeiträge">
   {view.segments.map(segment=><li key={segment.source_item_id}><div><strong>{segment.speaker==="customer"?"Kunde":segment.speaker==="assistant"?"KI":"Gegenseite · beim Kunden hörbar"}</strong><time>{Math.floor(segment.start_ms/60000)}:{String(Math.floor(segment.start_ms/1000)%60).padStart(2,"0")}</time>{!segment.is_final?<span>Vorläufig</span>:null}</div><p>{segment.text}</p></li>)}
  </ol>:null}
  <p className={styles.small}>Mitschrift ab Freigabe. Testgespräch · getrennt von der Kundenhistorie gespeichert. Angezeigt werden die letzten 100 Beiträge. Zeitangaben beziehen sich auf Audioabschnitte.</p>
 </section>;
}
