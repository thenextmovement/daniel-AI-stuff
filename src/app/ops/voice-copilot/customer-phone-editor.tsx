"use client";
import {useRef,useState} from "react";
import styles from "./phone-central.module.css";
export function CustomerPhoneEditor({customerId,disabled,onSaved}:{customerId:string;disabled:boolean;onSaved:(phone:string,numbers:string[])=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [phone,setPhone]=useState(""),[error,setError]=useState(""),[saving,setSaving]=useState(false);
 async function save(event:React.FormEvent){event.preventDefault();if(saving)return;setSaving(true);setError("");
 try{
  const response=await fetch("/api/ops/voice-copilot/phones",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({customerId,phone})});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||"Die Rufnummer konnte nicht gespeichert werden.");
  onSaved(data.phone,data.phoneNumbers);dialog.current?.close();setPhone("");
 }catch(error){setError(error instanceof Error?error.message:"Speichern fehlgeschlagen.");}finally{setSaving(false);}
 }
 return <><button type="button" className={styles.link} disabled={disabled} onClick={()=>{setError("");dialog.current?.showModal();}}>+ Nummer hinzufügen</button>
 <dialog ref={dialog} className={styles.phoneDialog}><form onSubmit={save}><h3>Nummer hinzufügen</h3>
 <label>Rufnummer mit Vorwahl<input autoFocus type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="0154 312345678" required/></label>
 <p>Die zusätzliche Nummer wird diesem Kunden zugeordnet. Deutsche Nummern speichern wir mit +49.</p>
 {error&&<p role="alert">{error}</p>}
 <div className={styles.actions}><button type="button" disabled={saving} onClick={()=>dialog.current?.close()}>Abbrechen</button>
 <button type="submit" disabled={saving}>{saving?"Speichert …":"Nummer speichern"}</button></div>
 </form></dialog></>;
}
