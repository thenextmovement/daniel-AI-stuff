"use client";
import {useEffect,useRef,useState} from "react";
import type {OrganizationOrders} from "@/lib/ops/voice-organization-orders";
import styles from "./phone-central.module.css";
const money=(amount:number,currency:string)=>new Intl.NumberFormat("de-DE",{style:"currency",currency}).format(amount);
const statuses:Record<string,string>={PAID:"Bezahlt",PENDING:"Zahlung offen",AUTHORIZED:"Autorisiert",PARTIALLY_PAID:"Teilbezahlt",PARTIALLY_REFUNDED:"Teilweise erstattet",REFUNDED:"Erstattet",VOIDED:"Storniert",EXPIRED:"Abgelaufen"};
export function OrganizationOrdersButton({customerId}:{customerId:string}) {
 const [data,setData]=useState<OrganizationOrders|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const [retry,setRetry]=useState(0);
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError("");setData(null);
  void fetch("/api/ops/voice-copilot/orders?"+new URLSearchParams({customerId}),{cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(55000)])})
   .then(async response=>{if(!response.ok)throw Error();return response.json();})
   .then(result=>{if(!controller.signal.aborted){if(result.unavailable)setError(result.unavailable);else setData(result);}})
   .catch(()=>{if(!controller.signal.aborted)setError("Der Bestellstand konnte nicht zuverlässig geladen werden. Bitte erneut versuchen.");})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[customerId,retry]);
 const totals=data?.totals.map(total=>money(total.amount,total.currency)).join(" + ");
 return <><button type="button" className={styles.orderSummary} onClick={()=>dialog.current?.showModal()} aria-label="Bisherige Bestellungen öffnen">
  {loading?"Wird geladen …":data?`${data.count} Stück · Gesamt: ${totals || "0,00 €"}`:"Bestellungen prüfen"}
 </button>
 <dialog ref={dialog} className={styles.phoneDialog+" "+styles.ordersDialog} aria-labelledby="organization-orders-title">
  <h3 id="organization-orders-title">{data?.scope==="organization"?"Bestellungen der Organisation":"Bisherige Bestellungen"}</h3>
  {data&&<p>{data.organizationName?`Alle zugeordneten Kontakte von ${data.organizationName}`:data.scope==="organization"?`Alle Bestelladressen mit @${data.domain}`:"Bestellungen dieses Kunden einschließlich seiner zusätzlichen E-Mail-Adressen."}</p>}
  {loading?<p role="status">Bestellungen werden geladen …</p>:error?<p role="alert">{error}</p>:data&&<>
   <p><strong>{data.count} Bestellungen · {totals||"0,00 €"}</strong></p>
   <p>Aktueller Bestellwert laut Shopify inkl. Steuern. Stornierte und Testbestellungen zählen nicht zur Summe.</p>
   <div className={styles.ordersScroll}><table><thead><tr><th>Bestellung</th><th>Kontakt</th><th>Status</th><th>Wert</th></tr></thead><tbody>{data.orders.map(order=><tr key={order.id}><td><a href={order.href} target="_blank" rel="noreferrer">{order.name} ↗</a><small>{new Date(order.createdAt).toLocaleDateString("de-DE")}</small></td><td>{order.email||"–"}</td><td>{order.cancelled?"Storniert":statuses[order.status||""]||"Unbekannt"}</td><td>{money(order.amount,order.currency)}</td></tr>)}</tbody></table></div>
   {!data.orders.length&&<p>Keine zugehörigen Bestellungen im bestätigten Datenstand vorhanden.</p>}
   <p>Shopify-Abgleich alle 15 Minuten · Stand: {new Date(data.checkedAt).toLocaleString("de-DE")}</p>
  </>}
  <div className={styles.actions}>{error&&<button type="button" className={styles.button+" "+styles.primary} onClick={()=>setRetry(n=>n+1)}>Erneut versuchen</button>}<button type="button" className={styles.button} onClick={()=>dialog.current?.close()}>Schließen</button></div>
 </dialog></>;
}
