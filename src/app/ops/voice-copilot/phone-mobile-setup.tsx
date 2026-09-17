"use client";
import {useEffect,useRef,useState} from "react";
import {Smartphone} from "lucide-react";
import {readPhoneCentralResponse} from "./phone-central-data";
import styles from "./phone-central.module.css";
type State={enabled:boolean;link:{id:string;phone:string;verifiedAt:string}|null;attempt:{id:string;phone:string;state:string;expiresAt:string;endedAt:string|null;cleanupPending:boolean}|null;dispatchPending?:boolean};
export function PhoneMobileSetup({deviceId,busy}:{deviceId:string;busy:boolean}) {
 const [data,setData]=useState<State|null>(null),[phone,setPhone]=useState(""),[code,setCode]=useState(""),[working,setWorking]=useState(false),[error,setError]=useState("");
 const attempt=useRef<{id:string;phone:string;code:string}|null>(null),generation=useRef(0);
 async function request(body?:Record<string,unknown>) {
  const response=await fetch("/api/ops/voice-phone/mobile",{cache:"no-store",signal:AbortSignal.timeout(25000),...(body?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{})});
  return readPhoneCentralResponse<State>(response,"Die Handy-Einrichtung ist gerade nicht erreichbar.");
 }
 useEffect(()=>{
  const epoch=++generation.current;let running=false;
  setData(null);setCode("");setError("");setWorking(false);attempt.current=null;
  const refresh=async()=>{
   if(running)return;running=true;
   try{
    const state=await request();if(epoch!==generation.current)return;setData(state);
    if(state.attempt?.endedAt||state.link?.id===attempt.current?.id){attempt.current=null;setCode("");}
   }catch{if(epoch===generation.current)setError("Die Handy-Einrichtung ist gerade nicht erreichbar.");}
   finally{running=false;}
  };
  void refresh();const timer=window.setInterval(()=>void refresh(),3000);
  return ()=>{generation.current++;attempt.current=null;window.clearInterval(timer);};
 },[deviceId]);
 async function change(action:"start"|"cancel"|"unlink") {
  if(working||busy)return;setWorking(true);setError("");const epoch=generation.current;
  try{
   let body:Record<string,unknown>;
   if(action==="start"){
    if(attempt.current?.phone!==phone.trim()){
     // Rejection sampling avoids a biased six-digit code. Kept only in memory.
     let number=0;do{number=crypto.getRandomValues(new Uint32Array(1))[0];}while(number>=4294000000);
     attempt.current={id:crypto.randomUUID(),phone:phone.trim(),code:String(number%1000000).padStart(6,"0")};
    }
    body={action,...attempt.current};setCode(attempt.current!.code);
   }else {
    const id=action==="cancel"?(data?.attempt?.id||attempt.current?.id):data?.link?.id;
    if(!id)throw Error("mobile_missing_attempt");
    body={action,id};setCode("");attempt.current=null;
   }
   const state=await request(body);if(epoch!==generation.current)return;setData(state);
   if(state.attempt?.endedAt){attempt.current=null;setCode("");}
  }catch{if(epoch===generation.current)setError("Die Einrichtung konnte noch nicht bestätigt werden. Im Pilot sind nur freigegebene Nummern erreichbar. Nach einem Versuch bitte kurz warten.");}
  finally{if(epoch===generation.current)setWorking(false);}
 }
 if(!data?.enabled)return error?<p className={styles.small} role="status">{error}</p>:null;
 const pending=!!data.attempt&&(!data.attempt.endedAt||data.attempt.cleanupPending);
 return <section className={styles.mobileSetup} aria-label="Mein Handy">
  <strong><Smartphone size={17}/> Mein Handy</strong>
  {data.link?<><p className={styles.small}>Bestätigt: {data.link.phone}</p><button type="button" className={styles.button} disabled={working||busy||pending} onClick={()=>void change("unlink")}>Handy-Verknüpfung entfernen</button></>:null}
  <p className={styles.small}>Ordne dein Handy persönlich zu. Dafür rufen wir diese Nummer einmal kurz an. Die Bestätigung allein schaltet noch keine Kundengespräche frei.</p>
  <label className={styles.phoneAccountField}>Meine Handynummer<input type="tel" inputMode="tel" autoComplete="tel" value={phone} maxLength={35} disabled={working||pending||busy} onChange={e=>{setPhone(e.target.value);attempt.current=null;setCode("");}}/></label>
  {!pending?<button type="button" className={styles.button} disabled={working||busy||phone.trim().length<7} onClick={()=>void change("start")}>{working?"Wird vorbereitet …":"Handy zur Bestätigung anrufen"}</button>:null}
  {code?<div className={styles.mobileCode} role="status"><span>Gib diesen Code am angerufenen Handy ein:</span><output aria-label="Handy-Bestätigungscode">{code}</output><span className={styles.small}>Drei Minuten gültig. Nur für diese Einrichtung.</span></div>:null}
  {pending?<><p className={styles.small} role="status">{data.attempt?.endedAt?"Die Verbindung wird beendet …":code?"Warte auf den Anruf und gib den Code über die Wahltasten ein.":"Eine Einrichtung läuft. Wenn dir der Code fehlt, brich sie ab und starte danach neu."}</p><button type="button" className={styles.button} disabled={working||busy} onClick={()=>void change("cancel")}>Einrichtung abbrechen</button></>:null}
  {data.attempt?.endedAt&&["failed","cancelled"].includes(data.attempt.state)?<p className={styles.small} role="status">Die Handy-Einrichtung wurde nicht bestätigt. Du kannst einen neuen Versuch starten.</p>:null}
  {error?<p className={styles.searchError} role="alert">{error}</p>:null}
 </section>;
}
