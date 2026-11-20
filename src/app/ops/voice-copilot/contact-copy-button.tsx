"use client";
import {useState,useEffect} from "react";
import {Copy,Check} from "lucide-react";
import styles from "./phone-central.module.css";
export function ContactCopyButton({value,label}:{value:string;label:string}) {
 const [status,setStatus]=useState("");
 useEffect(()=>setStatus(""),[value]);
 return <span className={styles.contactCopy}><button type="button" className={styles.contactAction} aria-label={label+" kopieren"} title={label+" kopieren"} disabled={!value} onClick={async()=>{
 try { await navigator.clipboard.writeText(value);setStatus("Kopiert"); } catch { setStatus("Kopieren fehlgeschlagen. Bitte Text markieren."); }
 }}>{status==="Kopiert"?<Check size={16}/>:<Copy size={16}/>}</button><span role="status" className={styles.copyStatus}>{status}</span></span>;
}
