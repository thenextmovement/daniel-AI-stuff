"use client";
import { useCallback, useEffect, useState } from "react";
import { KeyRound, LogOut, UserRound } from "lucide-react";
import type { PhoneIdentity, PhoneTeamMember } from "@/lib/ops/voice-phone-contract";
import { readPhoneCentralResponse } from "./phone-central-data";
import styles from "./phone-central.module.css";

type Props = {
  value:string; onChange:(name:string)=>void; busy:boolean;
  onTeam:(team:PhoneTeamMember[])=>void; onIdentity:(identity:PhoneIdentity)=>void;
};
export function PhoneAccount({value,onChange,busy,onTeam,onIdentity}:Props) {
  const [identity,setIdentity]=useState<PhoneIdentity|null>(null);
  const [code,setCode]=useState("");
  const [label,setLabel]=useState("Mein Browser");
  const [working,setWorking]=useState(false);
  const [error,setError]=useState("");
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    const response=await fetch("/api/ops/voice-phone",{cache:"no-store",signal:signal || AbortSignal.timeout(10000)});
    const state=await readPhoneCentralResponse<PhoneIdentity>(response,"Dein Telefonprofil ist gerade nicht erreichbar.");
    if(typeof state.enabled!=="boolean" || !Array.isArray(state.team))throw new Error("Dein Telefonprofil ist gerade nicht erreichbar.");
    setIdentity(state);onIdentity(state);onTeam(state.team);setError("");
    return state;
  },[onTeam,onIdentity]);
  useEffect(()=>{
    const controller=new AbortController();
    void refresh(controller.signal).catch(()=>{if(!controller.signal.aborted)setError("Dein Telefonprofil ist gerade nicht erreichbar.");});
    return ()=>controller.abort();
  },[refresh]);
  useEffect(()=>{
    if(identity?.profile?.displayName && identity.profile.displayName!==value)onChange(identity.profile.displayName);
  },[identity?.profile?.displayName,value,onChange]);
  useEffect(()=>{
    if(!identity?.enabled)return;
    const timer=window.setInterval(()=>{void refresh().catch(()=>{onTeam([]);setError("Der Telefonstatus konnte nicht aktualisiert werden.");});},20000);
    return ()=>window.clearInterval(timer);
  },[identity?.enabled,refresh,onTeam]);
  async function change(action:"enroll_code"|"enroll_access"|"logout") {
    if(working || busy)return;
    setWorking(true);setError("");
    try{
      const response=await fetch("/api/ops/voice-phone",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({action,...(action!=="logout"?{label}:{}),...(action==="enroll_code"?{code:code.trim()}: {})}),
        signal:AbortSignal.timeout(15000),
      });
      await readPhoneCentralResponse(response,"Die Telefonanmeldung hat nicht geklappt. Bitte prüfe deinen Einrichtungscode.");
      setCode("");
      const state=await refresh();
      if(action==="logout" && !state.profile)onChange("");
    }catch{setError(action==="logout"?"Die Telefonabmeldung konnte nicht bestätigt werden.":"Die Telefonanmeldung hat nicht geklappt. Bitte prüfe deinen Einrichtungscode oder versuche es erneut.");}
    finally{setWorking(false);}
  }
  if(!identity?.enabled)return <div className={styles.phoneAccount}>
    <label><span className="sr-only">Mitarbeiter für Gesprächsbegleitung</span>
      <input className={styles.device} value={value} disabled={busy} placeholder="Dein Name" onChange={e=>onChange(e.target.value)}/>
    </label>
    {error?<span className={styles.small} role="status">{error}</span>:null}
  </div>;
  return <details className={styles.phoneAccount}>
    <summary className={styles.phoneAccountSummary}><UserRound size={18}/>{identity.profile?.displayName || "Telefon anmelden"}
      {identity.profile?.extension?<span>· {identity.profile.extension}</span>:null}
    </summary>
    <div className={styles.phoneAccountBody}>
      {identity.profile && identity.device ? <>
        <strong>{identity.profile.displayName}</strong>
        <p className={styles.small}>Dieses Gerät: {identity.device.label}</p>
        <p className={styles.small}>Die Telefonanmeldung gilt für diese Person auf diesem Gerät.</p>
        <button type="button" className={styles.button} disabled={busy||working} onClick={()=>void change("logout")}><LogOut size={16}/>Telefon abmelden</button>
      </>:<>
        <p>Melde dieses Gerät einmal für dein persönliches Telefonprofil an.</p>
        <label className={styles.phoneAccountField}>Name dieses Geräts
          <input value={label} maxLength={80} disabled={working||busy} onChange={e=>setLabel(e.target.value)} autoComplete="off"/>
        </label>
        {identity.personalAccessAvailable ? <button type="button" className={styles.button+" "+styles.primary}
          disabled={working||busy||label.trim().length<2} onClick={()=>void change("enroll_access")}>Mit meiner Anmeldung verbinden</button>:null}
        <label className={styles.phoneAccountField}>Persönlicher Einrichtungscode
          <input type="password" value={code} maxLength={100} autoComplete="one-time-code" spellCheck={false}
            disabled={working||busy} onChange={e=>setCode(e.target.value)}/>
        </label>
        <p className={styles.small}>Der Code wird dir persönlich zugeordnet und kann nur einmal verwendet werden.</p>
        <button type="button" className={styles.button} disabled={working||busy||!code.trim()||label.trim().length<2}
          onClick={()=>void change("enroll_code")}><KeyRound size={16}/>{working?"Wird angemeldet …":"Mit Code anmelden"}</button>
      </>}
      {error?<p className={styles.searchError} role="alert">{error}</p>:null}
    </div>
  </details>;
}
