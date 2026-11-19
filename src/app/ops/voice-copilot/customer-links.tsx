"use client";
import {useEffect,useRef,useState} from "react";
import type {VoiceCustomerContext} from "@/lib/ops/voice-knowledge";
import type {CustomerLinkKind} from "@/lib/ops/voice-customer-links";
import styles from "./phone-central.module.css";
const names={quentin:"Quentin · Trello",inquiry:"Anfrage-Management · Trello",offer:"Angebot"};
export function CustomerLinks({customerId,requestId,context}:{customerId:string;requestId:string;context:VoiceCustomerContext|null}){
 const [links,setLinks]=useState<Partial<Record<CustomerLinkKind,string>>>({});
 const [loaded,setLoaded]=useState(false),[failed,setFailed]=useState(false);
 const [kind,setKind]=useState<CustomerLinkKind>("offer"),[url,setUrl]=useState(""),[error,setError]=useState(""),[saving,setSaving]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null);
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
 const boundOfferMatches=!links.offer || links.offer===context?.links?.offer;
 const price=boundOfferMatches?context?.offer?.price:null;
 return <section className={styles.customerLinks} aria-label="Kundenkarte">
 <strong>Kundenkarte</strong>
 {boundOfferMatches&&context?.offer?.thumbnailUrl&&<img className={styles.offerPreview} src={context.offer.thumbnailUrl} alt={"Angebotsvorschau "+context.offer.label} referrerPolicy="no-referrer" onError={e=>{e.currentTarget.hidden=true;}}/>}
 {price&&<p><strong>{new Intl.NumberFormat("de-DE",{style:"currency",currency:price.currency}).format(price.amount)}</strong> {price.taxBasis==="gross"?"inkl. MwSt.":price.taxBasis==="net"?"zzgl. MwSt.":"Angebotswert"}</p>}
 {(["quentin","inquiry","offer"] as const).map(k=>{
  const href=links[k]||(k==="offer"?context?.links?.offer:null);
  return <div className={styles.customerLinkRow} key={k}>
   <span>{href?<a href={href} target="_blank" rel="noreferrer">{names[k]} ↗</a>:!requestId?<span>{names[k]}: Kein Vorgang ausgewählt</span>:!loaded?<span>{names[k]}: Wird geprüft …</span>:failed?<span>{names[k]}: Prüfung derzeit nicht möglich</span>:<span>{k==="offer"?"Kein Angebot vorhanden":names[k]+": Keine Karte verknüpft"}</span>}</span>
   {requestId&&<button className={styles.link} type="button" onClick={()=>{setKind(k);setUrl(href||"");setError("");dialog.current?.showModal();}}>{href?"Ändern":"Hinzufügen"}</button>}
  </div>;
 })}
 <dialog ref={dialog} className={styles.phoneDialog}><form onSubmit={save}><h3>{names[kind]} verknüpfen</h3>
 <label>Link<input type="url" required value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://"/></label>
 <p>Die Verknüpfung wird beim ausgewählten Kundenvorgang gespeichert.</p>
 {error&&<p role="alert">{error}</p>}
 <div className={styles.actions}><button type="button" disabled={saving} onClick={()=>dialog.current?.close()}>Abbrechen</button><button disabled={saving}>{saving?"Speichert …":"Link speichern"}</button></div>
 </form></dialog>
 </section>;
}
