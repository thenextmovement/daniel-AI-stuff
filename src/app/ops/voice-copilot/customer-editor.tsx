"use client";
import {useRef,useState,useId} from "react";
import {Pencil,Plus,Trash2} from "lucide-react";
import type {CustomerEditorData} from "@/lib/ops/voice-customer-editor";
import {parsePhoneNumberFromString,type CountryCode} from "libphonenumber-js";
import {PhoneCountrySelect} from "./phone-country-select";
import styles from "./phone-central.module.css";
type Form={firstName:string;lastName:string;email:string;phone:string;emails:string[];phones:string[];organizationId:string;newOrganizationName:string;expectedUpdatedAt:string};
export function CustomerEditor({customerId,disabled,onSaved,trigger="name"}:{customerId:string;disabled:boolean;onSaved:(data:CustomerEditorData)=>Promise<void>;trigger?:"name"|"phone"|"email"}){
 const dialog=useRef<HTMLDialogElement>(null),titleId=useId();
 const [data,setData]=useState<CustomerEditorData|null>(null),[form,setForm]=useState<Form|null>(null);
 const [phoneCountries,setPhoneCountries]=useState<CountryCode[]>([]);
 const [working,setWorking]=useState(false),[error,setError]=useState("");
 async function read(response:Response){
 const body=await response.json();if(!response.ok)throw Error(response.status===502?"Die Kundendaten sind gerade nicht erreichbar.":body.error||"Speichern fehlgeschlagen.");return body as CustomerEditorData;
 }
 async function open(){
 dialog.current?.showModal();setWorking(true);setError("");setForm(null);
 try{
 const result=await read(await fetch("/api/ops/voice-copilot/customer?"+new URLSearchParams({customerId}),{cache:"no-store",signal:AbortSignal.timeout(15000)}));
 setData(result);setPhoneCountries(result.phones.map(phone=>parsePhoneNumberFromString(phone)?.country||"DE"));const c=result.customer;
 setForm({firstName:c.first_name||"",lastName:c.last_name||"",email:c.email,phone:c.phone||"",emails:result.emails,phones:result.phones,organizationId:c.customer_organization_id||"",newOrganizationName:"",expectedUpdatedAt:c.updated_at});
 }catch(e){setError(e instanceof Error?e.message:"Kunde konnte nicht geladen werden.");}finally{setWorking(false);}
 }
 async function save(){
 if(!form)return;setWorking(true);setError("");
 try{
 const result=await read(await fetch("/api/ops/voice-copilot/customer",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({customerId,...form,phones:form.phones.map((phone,i)=>({phone,country:phoneCountries[i]||"DE"})),organizationId:form.organizationId||null})}));
 // Only acknowledge after the server has read the saved customer back.
 await onSaved(result);dialog.current?.close();
 }catch(e){setError(e instanceof Error?e.message:"Speichern fehlgeschlagen.");}finally{setWorking(false);}
 }
 const field=(key:keyof Form,value:string)=>setForm(old=>old?{...old,[key]:value}:old);
 return <>
 <button type="button" className={trigger==="name"?styles.phonePlus:styles.orderSummary} disabled={disabled} onClick={()=>void open()} aria-label="Kundendaten bearbeiten">
 {trigger==="name"?<Pencil size={16}/>:trigger==="phone"?"Rufnummer ergänzen":"E-Mail ergänzen"}
 </button>
 <dialog ref={dialog} className={styles.phoneDialog+" "+styles.customerEditDialog} aria-labelledby={titleId} onCancel={e=>{if(working)e.preventDefault();}}>
 <h3 id={titleId}>Kundendaten bearbeiten</h3>
 <p>Hier kannst du Namen und Organisation bearbeiten sowie weitere Kontaktdaten ergänzen.</p>
 {working&&!form&&<p role="status">Kontaktdaten werden geladen …</p>}
 {error&&<p role="alert" className={styles.searchError}>{error}</p>}
 {form&&<form onSubmit={e=>{e.preventDefault();void save();}}>
 <fieldset disabled={working} className={styles.contactEditorFields}>
 <div className={styles.contactEditorGrid}>
 <label>Vorname<input value={form.firstName} maxLength={120} onChange={e=>field("firstName",e.target.value)}/></label>
 <label>Nachname<input value={form.lastName} maxLength={120} onChange={e=>field("lastName",e.target.value)}/></label>
 <label>Haupt-E-Mail<input type="email" readOnly value={form.email}/></label>
 <label>Hauptnummer<input type="tel" readOnly value={form.phone} placeholder="Nicht hinterlegt"/></label>
 </div>
 <small>Haupt-E-Mail und Hauptnummer bleiben unverändert. Weitere E-Mails und Telefonnummern kannst du unten hinzufügen.</small>
 {(["emails","phones"] as const).map(kind=><section key={kind} className={styles.contactEditorSection}>
 <h4>{kind==="emails"?"Zusätzliche E-Mails":"Zusätzliche Telefonnummern"} <small>{form[kind].length}/10</small></h4>
 {form[kind].map((value,index)=><div className={styles.contactEditorRow} key={index}>
 {kind==="phones"&&<PhoneCountrySelect label={"Land für Telefonnummer "+(index+1)} value={phoneCountries[index]||"DE"} onChange={country=>setPhoneCountries(old=>form.phones.map((_,i)=>i===index?country:old[i]||"DE"))}/>}
 <input aria-label={(kind==="emails"?"Zusätzliche E-Mail ":"Zusätzliche Telefonnummer ")+(index+1)} type={kind==="emails"?"email":"tel"} required value={value} onChange={e=>setForm(old=>old?{...old,[kind]:old[kind].map((v,i)=>i===index?e.target.value:v)}:old)}/>
 <button type="button" className={styles.button} aria-label={"Kontakt "+(index+1)+" entfernen"} onClick={()=>{if(kind==="phones")setPhoneCountries(old=>old.filter((_,i)=>i!==index));setForm(old=>old?{...old,[kind]:old[kind].filter((_,i)=>i!==index)}:old);}}><Trash2 size={16}/></button>
 </div>)}
 <button type="button" className={styles.button} disabled={form[kind].length>=10} onClick={()=>{if(kind==="phones")setPhoneCountries(old=>[...old,"DE"]);setForm(old=>old?{...old,[kind]:[...old[kind],""]}:old);}}><Plus size={16}/> {kind==="emails"?"E-Mail hinzufügen":"Telefonnummer hinzufügen"}</button>
 </section>)}
 <label>Organisation<select value={form.organizationId} onChange={e=>setForm(old=>old?{...old,organizationId:e.target.value,newOrganizationName:""}:old)}>
 <option value="">Keine Organisation</option>{data?.organizations.map(org=><option key={org.id} value={org.id}>{org.name}</option>)}
 </select></label>
 {!form.organizationId&&<label>Neue Organisation (optional)<input value={form.newOrganizationName} maxLength={200} onChange={e=>field("newOrganizationName",e.target.value)}/></label>}
 </fieldset>
 <div className={styles.actions}><button type="submit" disabled={working} className={styles.button+" "+styles.primary}>{working?"Wird gespeichert …":"Änderungen speichern"}</button><button type="button" disabled={working} className={styles.button} onClick={()=>dialog.current?.close()}>Abbrechen</button></div>
 </form>}
 {!form&&!working&&<div className={styles.actions}><button type="button" className={styles.button} onClick={()=>void open()}>Erneut versuchen</button><button type="button" className={styles.button} onClick={()=>dialog.current?.close()}>Schließen</button></div>}
 </dialog></>;
}
