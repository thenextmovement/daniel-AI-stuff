"use client";
import {Phone,Plus} from "lucide-react";
import {getCountries,getCountryCallingCode,type CountryCode} from "libphonenumber-js";
import {useRef,useState} from "react";
import styles from "./phone-central.module.css";
const countryNames=new Intl.DisplayNames(["de"],{type:"region"});
const flag=(country:string)=>String.fromCodePoint(...[...country].map(c=>127397+c.charCodeAt(0)));
const priority=["DE","AT","CH"];
const eu=new Set("BE BG CY CZ DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK".split(" "));
const countries=getCountries().sort((a,b)=>{
 const rank=(c:string)=>priority.includes(c)?priority.indexOf(c):eu.has(c)?3:4;
 return rank(a)-rank(b) || (countryNames.of(a)||a).localeCompare(countryNames.of(b)||b,"de");
});
export function CustomerPhoneEditor({customerId,disabled,onSaved}:{customerId:string;disabled:boolean;onSaved:(phone:string,numbers:string[])=>void}){
 const [country,setCountry]=useState<CountryCode>("DE");
 const dialog=useRef<HTMLDialogElement>(null);
 const [phone,setPhone]=useState(""),[error,setError]=useState(""),[saving,setSaving]=useState(false);
 async function save(event:React.FormEvent){event.preventDefault();if(saving)return;setSaving(true);setError("");
 try{
  const response=await fetch("/api/ops/voice-copilot/phones",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({customerId,phone,country})});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||"Die Rufnummer konnte nicht gespeichert werden.");
  onSaved(data.phone,data.phoneNumbers);dialog.current?.close();setPhone("");
 }catch(error){setError(error instanceof Error?error.message:"Speichern fehlgeschlagen.");}finally{setSaving(false);}
 }
 return <><button type="button" className={styles.phonePlus} title="Nummer hinzufügen" aria-label="Nummer hinzufügen" disabled={disabled} onClick={()=>{setError("");dialog.current?.showModal();}}><Phone size={17}/><Plus size={10} className={styles.phonePlusMark}/></button>
 <dialog ref={dialog} className={styles.phoneDialog}><form onSubmit={save}><h3>Nummer hinzufügen</h3>
 <label>Land<select value={country} onChange={e=>setCountry(e.target.value as CountryCode)}>{countries.map(c=><option key={c} value={c}>{flag(c)} {countryNames.of(c)} (+{getCountryCallingCode(c)})</option>)}</select></label>
 <label>Rufnummer<input autoFocus type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder={country==="DE"?"0151 23456789":"Rufnummer oder +Ländervorwahl"} required/></label>
 <p>Das Rufnummernformat wird automatisch angepasst. Gib die vollständige Nummer ein – bei Deutschland wird aus 01590… automatisch +49 1590…. Eine internationale +Vorwahl wird übernommen.</p>
 {error&&<p role="alert">{error}</p>}
 <div className={styles.actions}><button className={styles.button} type="button" disabled={saving} onClick={()=>dialog.current?.close()}>Abbrechen</button>
 <button className={styles.button + " " + styles.primary} type="submit" disabled={saving}>{saving?"Speichert …":"Nummer speichern"}</button></div>
 </form></dialog></>;
}
