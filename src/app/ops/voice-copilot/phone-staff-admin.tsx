"use client";
import {useEffect,useRef,useState} from "react";
import type {PhoneIdentity} from "@/lib/ops/voice-phone-contract";
import type {PhoneManagedStaff,PhoneProfileValues} from "@/lib/ops/voice-phone-management-contract";
import {readPhoneCentralResponse} from "./phone-central-data";
import styles from "./phone-central.module.css";
const empty=():PhoneProfileValues=>({displayName:"",accessEmail:null,extension:null,enabled:true});
const date=(value:string)=>new Intl.DateTimeFormat("de-DE",{dateStyle:"short",timeStyle:"short"}).format(new Date(value));
type Code={value:string;name:string;expiresAt:string};
async function request<T>(body?:Record<string,unknown>,signal?:AbortSignal){
 const response=await fetch("/api/ops/voice-phone/team",{cache:"no-store",signal:signal||AbortSignal.timeout(15000),
  ...(body?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{})});
 if(response.status===409){
  const data=await response.clone().json().catch(()=>null);
  const messages:Record<string,string>={
   phone_profile_changed:"Das Profil wurde inzwischen geändert. Lade die Teamliste neu und prüfe deine Änderung.",
   phone_profile_conflict:"E-Mail-Adresse oder Nebenstelle ist bereits einem Telefonprofil zugeordnet.",
   phone_manager_self_lockout:"Dein eigenes Verwaltungsprofil kannst du hier nicht deaktivieren oder einer anderen E-Mail-Adresse zuordnen.",
  };
  const key=Array.isArray(data?.issues)?data.issues.find((x:unknown)=>typeof x==="string"&&Object.hasOwn(messages,x)):null;
  throw new Error(key?messages[key]:"Die Änderung konnte nicht übernommen werden. Lade die Teamliste neu und prüfe das ausgewählte Profil.");
 }
 if(response.status===422)throw new Error("Bitte prüfe Anzeigename, persönliche E-Mail und Nebenstelle.");
 return readPhoneCentralResponse<T>(response,"Die Telefonverwaltung ist gerade nicht erreichbar.");
}
export function PhoneStaffAdmin({identity,open,onToggle}:{identity:PhoneIdentity;open:boolean;onToggle:()=>void}){
 const [staff,setStaff]=useState<PhoneManagedStaff[]>([]),[selectedId,setSelectedId]=useState<string|null>(null);
 const [draft,setDraft]=useState<PhoneProfileValues>(empty),[working,setWorking]=useState(false),[loaded,setLoaded]=useState(false);
 const [error,setError]=useState(""),[notice,setNotice]=useState(""),[code,setCode]=useState<Code|null>(null),[showCode,setShowCode]=useState(false);
 const generation=useRef(0),newId=useRef<string|null>(null);
 const member=staff.find(x=>x.id===selectedId)||null,own=member?.id===identity.profile?.id;
 function select(value:PhoneManagedStaff|null){
  setSelectedId(value?.id||null);setDraft(value?{displayName:value.displayName,accessEmail:value.accessEmail,extension:value.extension,enabled:value.enabled}:empty());
  setCode(null);setShowCode(false);setError("");setNotice("");newId.current=value?null:crypto.randomUUID();
 }
 async function load(epoch:number,id:string|null,signal?:AbortSignal){
  const data=await request<{staff:PhoneManagedStaff[]}>(undefined,signal);
  if(epoch!==generation.current)return;
  setStaff(data.staff);setLoaded(true);select(data.staff.find(x=>x.id===id)||data.staff[0]||null);
 }
 useEffect(()=>{
  const epoch=++generation.current,controller=new AbortController();
  setCode(null);setShowCode(false);setLoaded(false);setWorking(false);setError("");setNotice("");
  if(open){setWorking(true);void load(epoch,null,controller.signal).catch(()=>{
   if(epoch===generation.current&&!controller.signal.aborted)setError("Dein Profil ist nicht berechtigt oder die Telefonverwaltung ist gerade nicht erreichbar.");
  }).finally(()=>{if(epoch===generation.current)setWorking(false);});}
  return ()=>{controller.abort();generation.current++;};
 // Identity and visibility changes invalidate pending responses and clear codes.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[open,identity.device?.id]);
 useEffect(()=>{
  if(!code)return;
  const timer=window.setTimeout(()=>{setCode(null);setShowCode(false);setNotice("Der Einrichtungscode ist abgelaufen. Bei Bedarf einen neuen erstellen.");},Math.max(0,Date.parse(code.expiresAt)-Date.now()));
  return ()=>window.clearTimeout(timer);
 },[code]);
 async function mutate(body:Record<string,unknown>,message:string){
  if(working)return;setWorking(true);setError("");setNotice("");setCode(null);setShowCode(false);const epoch=generation.current;
  try{
   const data=await request<{staffId:string;code?:string;expiresAt?:string}>(body);
   if(epoch!==generation.current)return;
   await load(epoch,data.staffId);
   if(epoch!==generation.current)return;
   if(data.code&&data.expiresAt)setCode({value:data.code,name:member?.displayName||draft.displayName,expiresAt:data.expiresAt});
   setNotice(message);
  }catch(error){if(epoch===generation.current)setError(error instanceof Error?error.message:"Die Änderung konnte nicht bestätigt werden. Bitte aktualisiere die Teamliste.");}
  finally{if(epoch===generation.current)setWorking(false);}
 }
 async function refresh(){
  if(working)return;setWorking(true);setError("");const epoch=generation.current;
  try{await load(epoch,selectedId);}catch{if(epoch===generation.current)setError("Die Teamliste konnte nicht aktualisiert werden.");}
  finally{if(epoch===generation.current)setWorking(false);}
 }
 async function copy(){
  if(!code)return;
  try{await navigator.clipboard.writeText(code.value);setNotice("Einrichtungscode kopiert. Gib ihn ausschließlich der genannten Person.");}
  catch{setNotice("Kopieren ist im Browser gesperrt. Zeige den Code an und kopiere ihn aus dem Feld.");}
 }
 return <section id="voice-phone-team" className={styles.phoneAdmin} aria-label="Telefonteam verwalten">
  <div className={styles.phoneAdminTitle}><div><h2>Telefonteam</h2><p>Persönliche Profile, Einrichtungscodes und angemeldete Geräte.</p></div>
   <button type="button" className={styles.button} aria-expanded={open} onClick={onToggle}>{open?"Verwaltung schließen":"Team verwalten"}</button></div>
  {open?<><p className={styles.small}>Nur freigeschaltete Verwalter können diese Zuordnung ändern. Eure Anmeldung in Ops bleibt bestehen.</p>
   {error?<p role="alert" className={styles.searchError}>{error}</p>:null}
   {notice?<p role="status" className={styles.phoneAdminNotice}>{notice}</p>:null}
   {!loaded?<p role="status">{working?"Team wird geladen …":"Die Teamliste ist nicht verfügbar."}</p>:<div className={styles.phoneAdminGrid}>
    <aside aria-label="Telefonprofile"><div className={styles.actions}>
     <button type="button" className={styles.button} disabled={working} onClick={()=>select(null)}>Person hinzufügen</button>
     <button type="button" className={styles.button} disabled={working} onClick={()=>void refresh()}>Aktualisieren</button>
    </div><ul className={styles.phoneAdminList}>{staff.map(s=><li key={s.id}>
     <button type="button" className={s.id===selectedId?styles.phoneAdminSelected:""} disabled={working} aria-pressed={s.id===selectedId} onClick={()=>select(s)}>
      <strong>{s.displayName}</strong><span>{s.extension?"Nebenstelle "+s.extension+" · ":""}{s.enabled?"Aktiv":"Deaktiviert"}{s.canManagePhone?" · Verwaltung":""}</span>
     </button>
    </li>)}</ul></aside>
    <div className={styles.phoneAdminDetail}>
     <h3>{member?member.displayName:"Neue Person"}</h3>
     <form onSubmit={event=>{event.preventDefault();if(!newId.current&&!member)newId.current=crypto.randomUUID();void mutate({
      action:member?"update":"create",staffId:member?.id||newId.current,values:draft,...(member?{revision:member.revision}:{})
     },"Telefonprofil gespeichert.");}}>
      <label className={styles.phoneAccountField}>Anzeigename<input value={draft.displayName} required minLength={2} maxLength={100} disabled={working} onChange={e=>setDraft({...draft,displayName:e.target.value})}/></label>
      <label className={styles.phoneAccountField}>Nebenstelle<input value={draft.extension||""} inputMode="numeric" pattern="[0-9]{1,6}" maxLength={6} disabled={working} onChange={e=>setDraft({...draft,extension:e.target.value||null})}/></label>
      <label className={styles.phoneAccountField}>Persönliche Anmelde-E-Mail (optional)<input type="email" value={draft.accessEmail||""} maxLength={254} disabled={working||own} onChange={e=>setDraft({...draft,accessEmail:e.target.value||null})}/></label>
      <p className={styles.small}>Ohne persönliche E-Mail kann die Person ihr Gerät mit einem Einrichtungscode verbinden.</p>
      <label className={styles.phoneAdminCheck}><input type="checkbox" checked={draft.enabled} disabled={working||own} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/>Telefonprofil aktiv</label>
      {member&&!own?<p className={styles.small}>Deaktivieren oder eine andere E-Mail-Adresse melden bestehende Telefongeräte ab. Laufende Telefonverbindungen werden beendet.</p>:null}
      <button type="submit" className={styles.button+" "+styles.primary} disabled={working||draft.displayName.trim().length<2}>{working?"Wird verarbeitet …":"Profil speichern"}</button>
     </form>
     {member?<><div className={styles.phoneAdminPart}><h3>Gerät verbinden</h3>
      <p className={styles.small}>Ein Code gilt einmal für {member.displayName}, maximal 15 Minuten. Ein neuer Code ersetzt ungenutzte ältere Codes.</p>
      <button type="button" className={styles.button} disabled={working||!member.enabled} onClick={()=>void mutate({action:"issue_invite",staffId:member.id},"Code erstellt. Nur an die genannte Person weitergeben.")}>Einrichtungscode erstellen</button>
      {code?<div className={styles.phoneAdminCode}><strong>Einrichtungscode für {code.name}</strong><p className={styles.small}>Gültig bis {date(code.expiresAt)}. Nach dem Schließen wird er hier nicht erneut angezeigt.</p>
       <label className={styles.phoneAccountField}>Einmaliger Einrichtungscode<input readOnly type={showCode?"text":"password"} value={code.value} autoComplete="off" spellCheck={false}/></label>
       <div className={styles.actions}><button type="button" className={styles.button} onClick={()=>void copy()}>Code kopieren</button>
        <button type="button" className={styles.button} onClick={()=>setShowCode(!showCode)}>{showCode?"Verbergen":"Anzeigen"}</button></div>
      </div>:null}
      {member.invites.map(i=><div className={styles.phoneAdminDevice} key={i.id}><span>Offener Code · bis {date(i.expiresAt)}</span>
       <button type="button" className={styles.button} disabled={working} onClick={()=>void mutate({action:"revoke_invite",staffId:member.id,relatedId:i.id},"Einrichtungscode widerrufen.")}>Code widerrufen</button></div>)}
     </div><div className={styles.phoneAdminPart}><h3>Angemeldete Geräte</h3>
      <p className={styles.small}>Gerät abmelden beendet dessen Telefonzugang und gegebenenfalls eine laufende Telefonverbindung. Der Zugang zu Ops bleibt erhalten.</p>
      {member.devices.length?member.devices.map(d=><div className={styles.phoneAdminDevice} key={d.id}><div><strong>{d.label}{d.isCurrent?" · dieses Gerät":""}</strong>
       <p className={styles.small}>{d.lastSeenAt?"Zuletzt gesehen: "+date(d.lastSeenAt):"Noch nicht verbunden"}</p></div>
       {d.isCurrent?<span className={styles.small}>Abmelden oben im persönlichen Telefonmenü.</span>:<button type="button" className={styles.button} disabled={working}
        onClick={()=>void mutate({action:"revoke_device",staffId:member.id,relatedId:d.id},"Gerät vom Telefonzugang abgemeldet.")}>Gerät abmelden</button>}</div>):<p className={styles.small}>Keine angemeldeten Geräte.</p>}
     </div></>:null}
    </div>
   </div>}
  </>:null}
 </section>;
}
