"use client";
import {useEffect,useRef,useState} from "react";
import type {useBrowserPhone} from "./use-browser-phone";
import styles from "./phone-central.module.css";
type Phone=ReturnType<typeof useBrowserPhone>;
export function PhoneTransferPanel({phone}:{phone:Phone}) {
 const [ringtone,setRingtone]=useState(false),[soundError,setSoundError]=useState("");
 const audio=useRef<AudioContext|null>(null);
 async function toggleSound(checked:boolean) {
  setRingtone(checked);setSoundError("");
  if(!checked)return;
  try{audio.current ||= new AudioContext();await audio.current.resume();}
  catch{setRingtone(false);setSoundError("Der Browser konnte den Klingelton nicht einschalten.");}
 }
 useEffect(()=>()=>{void audio.current?.close();audio.current=null;},[]);
 useEffect(()=>{
  if(!ringtone||!phone.incoming)return;
  const ring=()=>{
   const context=audio.current;if(!context||context.state!=="running")return;
   const oscillator=context.createOscillator(),gain=context.createGain();
   oscillator.type="sine";oscillator.frequency.value=660;
   gain.gain.setValueAtTime(0,context.currentTime);gain.gain.linearRampToValueAtTime(.07,context.currentTime+.02);
   gain.gain.setValueAtTime(.07,context.currentTime+.22);gain.gain.linearRampToValueAtTime(0,context.currentTime+.32);
   oscillator.connect(gain);gain.connect(context.destination);oscillator.start();oscillator.stop(context.currentTime+.34);
   oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
  };
  ring();const timer=window.setInterval(ring,3000);return ()=>window.clearInterval(timer);
 },[ringtone,phone.incoming?.id]);
 const t=phone.transfer,offer=phone.incoming;
 const locked=phone.working||t?.state==="committing"||!!t?.ownerAdopted||!!t?.cancelRequested||!!t?.endedAt;
 return <>
  <div className={styles.phoneSound}><label><input type="checkbox" checked={ringtone} onChange={event=>void toggleSound(event.target.checked)}/> Klingelton für Übergaben</label>
   {soundError?<span role="status">{soundError}</span>:null}</div>
  {offer?<section className={styles.transferIncoming} aria-label="Eingehende Übergabe">
   <div role="status"><span className={styles.transferDot}/><strong>{offer.fromName} möchte ein Gespräch weitergeben</strong><p>{offer.call.phone} · Erst Rücksprache mit dem Kollegen</p></div>
   <div className={styles.actions}>
    <button type="button" className={styles.button+" "+styles.primary} disabled={phone.working} onClick={()=>void phone.acceptTransfer()}>Annehmen</button>
    <button type="button" className={styles.button} disabled={phone.working} onClick={()=>void phone.transferAction("cancel",offer)}>Ablehnen</button>
   </div>
  </section>:null}
  {t?<section className={styles.transferPanel} aria-label="Gespräch weitergeben">
   <div role="status"><strong>{t.cancelRequested?"Zurück zum bisherigen Gespräch …":t.state==="committing"?"Gespräch wird übergeben …":t.targetJoined?
    "Rücksprache · "+(t.role==="source"?t.toName:t.fromName):t.role==="source"?"Einladung an "+t.toName:"Verbindung mit "+t.fromName}</strong>
    <p>{t.state==="preparing"?"Der Kunde wird kurz in die Warteschleife gelegt.":t.ownerAdopted?"Die Verbindung zum neuen Mitarbeiter wird bestätigt.":"Der Kunde wartet. Die Rücksprache bleibt intern."}</p>
   </div>
   <div className={styles.actions}>
    {t.role==="source"?<button type="button" className={styles.button+" "+styles.primary} disabled={locked||!t.targetJoined}
      onClick={()=>void phone.transferAction("commit")}>Übergabe abschließen</button>:null}
    <button type="button" className={styles.button} disabled={locked} onClick={()=>void phone.transferAction("cancel")}>
     {t.role==="source"?"Zurück zum Kunden":"Rücksprache verlassen"}</button>
   </div>
  </section>:null}
  {phone.notice?<p className={styles.phoneNotice} role="status">{phone.notice}</p>:null}
 </>;
}
