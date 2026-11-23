"use client";
import {useEffect,useRef,useState} from "react";
import {ArrowUpRight, FileText, ImageIcon, PanelsTopLeft, Pencil, Plus, X} from "lucide-react";
import type {VoiceCustomerContext} from "@/lib/ops/voice-knowledge";
import type {VoiceHotLead} from "@/lib/ops/voice-hot-leads";
import type {CustomerLinkKind} from "@/lib/ops/voice-customer-links";
import styles from "./phone-central.module.css";
const names={quentin:"Quentin Board",inquiry:"Anfrage Board",offer:"Angebot"};
export function CustomerLinks({customerId,requestId,context,lead}:{customerId:string;requestId:string;context:VoiceCustomerContext|null;lead?:VoiceHotLead|null}){
 const [links,setLinks]=useState<Partial<Record<CustomerLinkKind,string>>>({});
 const [loaded,setLoaded]=useState(false),[failed,setFailed]=useState(false);
 const [kind,setKind]=useState<CustomerLinkKind>("offer"),[url,setUrl]=useState(""),[error,setError]=useState(""),[saving,setSaving]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null);
 const preview=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const c=new AbortController();setLoaded(false);setFailed(false);setLinks({});
  if(!requestId)return ()=>c.abort();
  void fetch("/api/ops/voice-copilot/links?"+new URLSearchParams({customerId,requestId}),{signal:c.signal,cache:"no-store"})
   .then(async r=>{if(!r.ok)throw Error();return r.json();}).then(d=>{if(!c.signal.aborted){setLinks(d.links);setFailed(Boolean(d.incomplete));}})
   .catch(()=>{if(!c.signal.aborted)setFailed(true);}).finally(()=>{if(!c.signal.aborted)setLoaded(true);});
  return ()=>c.abort();
 },[customerId,requestId]);
 async function save(e:React.FormEvent){e.preventDefault();if(saving)return;setSaving(true);setError("");
  try{
   const r=await fetch("/api/ops/voice-copilot/links",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({customerId,requestId,kind,url})});
   const d=await r.json();if(!r.ok)throw Error(d.error||"Speichern fehlgeschlagen.");
   setLinks(old=>({...old,[kind]:d.url}));dialog.current?.close();
  }catch(e){setError(e instanceof Error?e.message:"Speichern fehlgeschlagen.");}finally{setSaving(false);}
 }
 const [failedImage,setFailedImage]=useState<string|null>(null);
 const boundOfferMatches=!links.offer || links.offer===context?.links?.offer;
 const sentAt=boundOfferMatches && lead?.offerNumber && lead.offerNumber===context?.offer?.offerNumber ? lead.firstSentAt : null;
 const price=boundOfferMatches?context?.offer?.price:null;
 return <section className={styles.customerLinks} aria-label="Kundenkarte">
 <div className={styles.customerLinkButtons}>
 {(["quentin","inquiry","offer"] as const).map(k=>{
  const href=links[k]||(k==="offer"?context?.links?.offer:null);
  const label=k==="offer" && href && boundOfferMatches && context?.offer?.offerNumber ? "Angebot " + context.offer.offerNumber : names[k];
  const open=()=>{setKind(k);setUrl(href||"");setError("");dialog.current?.showModal();};
  const missing=!requestId?"Kein Vorgang ausgewählt":!loaded?"Wird geprüft …":failed?"Prüfung derzeit nicht möglich":k==="offer"?"Kein Angebot vorhanden":"Keine Karte verknüpft";
  const Icon=k==="offer"?FileText:PanelsTopLeft;
  return <div className={styles.customerLinkRow} data-linked={Boolean(href)} key={k}>
   {href?<a className={styles.customerLinkButton} href={href} target="_blank" rel="noreferrer"><Icon size={15}/>{label}<ArrowUpRight size={13}/></a>
    :<button className={styles.customerLinkButton} type="button" disabled={!requestId} title={missing} onClick={open}><Icon size={15}/>{names[k]}<Plus size={13}/></button>}
   {href&&requestId&&<button className={styles.editLink} type="button" aria-label={names[k]+"-Link ändern"} onClick={open}><Pencil size={12}/></button>}
  </div>;
 })}
 {price?<span className={styles.offerValue}><strong>{new Intl.NumberFormat("de-DE",{style:"currency",currency:price.currency}).format(price.amount)}</strong><small>{price.taxBasis==="gross"?"inkl. MwSt.":price.taxBasis==="net"?"zzgl. MwSt.":"Angebotswert"}</small>{sentAt&&<small><time dateTime={sentAt} title="Angebot gesendet am">({new Intl.DateTimeFormat("de-DE",{timeZone:"Europe/Berlin"}).format(new Date(sentAt))})</time></small>}</span>:loaded&&!links.offer&&!context?.links?.offer&&<small className={styles.muted}>Kein Angebot vorhanden</small>}
 </div>
 {boundOfferMatches&&context?.offer?.thumbnailUrl&&failedImage!==context.offer.thumbnailUrl&&<div className={styles.offerPeek}>
  <button type="button" className={styles.offerPeekButton} aria-label="Angebotsbild vergrößern" onClick={()=>preview.current?.showModal()}><img src={context.offer.thumbnailUrl} alt={"Angebotsvorschau "+context.offer.label} onError={()=>setFailedImage(context.offer!.thumbnailUrl!)} referrerPolicy="no-referrer"/></button>
  <div className={styles.offerHover} aria-hidden="true"><img src={context.offer.thumbnailUrl} alt="" referrerPolicy="no-referrer"/></div>
  <dialog ref={preview} className={styles.offerDialog} onClick={e=>{if(e.target===e.currentTarget)preview.current?.close();}}><button type="button" autoFocus aria-label="Vorschau schließen" className={styles.previewClose} onClick={()=>preview.current?.close()}><X size={20}/></button><img src={context.offer.thumbnailUrl} alt={"Angebot "+context.offer.label} referrerPolicy="no-referrer"/></dialog>
 </div>}
 {(!boundOfferMatches||!context?.offer?.thumbnailUrl||failedImage===context.offer.thumbnailUrl)&&<div className={styles.offerPeek}><div className={styles.offerPeekButton+" "+styles.offerPlaceholder} role="img" aria-label="Kein Angebotsbild vorhanden"><ImageIcon size={26} aria-hidden="true"/><span>Kein Bild</span></div></div>}
 <dialog ref={dialog} className={styles.phoneDialog}><form onSubmit={save}><h3>{names[kind]} verknüpfen</h3>
 <label>Link<input type="url" required value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://"/></label>
 <p>Die Verknüpfung wird beim ausgewählten Kundenvorgang gespeichert.</p>
 {error&&<p role="alert">{error}</p>}
 <div className={styles.actions}><button className={styles.button} type="button" disabled={saving} onClick={()=>dialog.current?.close()}>Abbrechen</button><button className={styles.button + " " + styles.primary} disabled={saving}>{saving?"Speichert …":"Link speichern"}</button></div>
 </form></dialog>
 </section>;
}
