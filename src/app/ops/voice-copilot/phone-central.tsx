"use client";
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Search, Phone, Headphones, ChevronRight, Bot, Delete, Users, Grid2X2, RefreshCw } from "lucide-react";
import type { VoiceCopilotSuggestion } from "@/lib/ops/voice-copilot";
import type { VoiceCustomerContext } from "@/lib/ops/voice-knowledge";
import {HotLeads,leadAmount,DirectoryLeadSnooze} from "./hot-leads";
import {contactSegment} from "@/lib/ops/voice-hot-lead-rules";
import type {VoiceHotLead} from "@/lib/ops/voice-hot-leads";
import {CustomerEditor} from "./customer-editor";
import type {CustomerEditorData} from "@/lib/ops/voice-customer-editor";
import {ContactCopyButton} from "./contact-copy-button";
import {parsePhoneNumberFromString} from "libphonenumber-js";
import {CustomerPhoneEditor} from "./customer-phone-editor";
import { CallNotes } from "./call-notes";
import { PlacetelCallButton, type PlacetelCallHandle } from "./placetel-call-button";
import { RecentCalls } from "./recent-calls";
import {OrganizationOrdersButton} from "./organization-orders";
import {CustomerLinks} from "./customer-links";
import { CustomerBrief } from "./customer-brief";
import { VoiceHistoryPanel } from "./voice-history-panel";
import styles from "./phone-central.module.css";
import { OpsAppSwitcher } from "../ops-app-switcher";
import { useBrowserPhone } from "./use-browser-phone";
import {PhoneAiCallsPanel} from "./phone-ai-calls-panel";
import { PhoneTranscriptPanel } from "./phone-transcript-panel";
import { PhoneTransferPanel } from "./phone-transfer-panel";
import {PhoneStaffAdmin} from "./phone-staff-admin";
import { PhoneAccount } from "./phone-account";
import type { PhoneTeamMember, PhoneIdentity } from "@/lib/ops/voice-phone-contract";

import type { VoiceDirectoryContact } from "@/lib/ops/voice-directory";
import { dialPhoneNumber, readPhoneCentralResponse, fetchPhoneDirectory } from "./phone-central-data";

type DirectoryResponse = { results: VoiceDirectoryContact[]; nextOffset: number | null };
type Props = {
  operatorName: string;
  onOperatorNameChange: (value: string) => void;
  selected: VoiceCustomerContext | null;
  onSelect: (context: VoiceCustomerContext | null) => void;
  busy: boolean;
  status: string;
  workspace: "prepare" | "assist" | "live";
  onWorkspaceChange: (value: "prepare" | "assist" | "live") => void;
  hints: VoiceCopilotSuggestion[];
  children: ReactNode;
  settings: ReactNode;
  liveAssistSession?: string | null;
  linkedTranscript?: string | null;
};
function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toLocaleUpperCase("de");
}
export function PhoneCentral(props: Props) {
  const { selected } = props;
  const [finishedLeadCall,setFinishedLeadCall]=useState<{customerId:string;requestId:string;callId:string}|null>(null);
  const leadCallEnded=useCallback((customerId:string,requestId:string,callId:string)=>setFinishedLeadCall({customerId,requestId,callId}),[]);
  const [callHistoryRevision, setCallHistoryRevision] = useState(0);
  const refreshCallHistory = useCallback(() => setCallHistoryRevision(n => n + 1), []);
  const [phoneAdminOpen,setPhoneAdminOpen]=useState(false);
  const [phoneIdentity,setPhoneIdentity]=useState<PhoneIdentity|null>(null);
  const browserPhone=useBrowserPhone(phoneIdentity,props.busy,leadCallEnded);
  const [outgoingRoute,setOutgoingRoute]=useState<"browser"|"mobile">("browser");
  const mobileAudio=(browserPhone.transfer?.role==="recipient"&&browserPhone.transfer.transport==="mobile")||browserPhone.call?.transport==="mobile"||(!browserPhone.call&&outgoingRoute==="mobile");
  const canDial=outgoingRoute==="mobile"?browserPhone.mobileAllowed:browserPhone.allowed;
  const endpointReady=outgoingRoute==="mobile"?browserPhone.mobileAllowed:browserPhone.registered;
  useEffect(()=>{
    if(phoneIdentity?.mobileCallingAvailable&&!phoneIdentity.browserCallingAvailable)setOutgoingRoute("mobile");
    else if(phoneIdentity?.browserCallingAvailable&&!phoneIdentity.mobileCallingAvailable)setOutgoingRoute("browser");
  },[phoneIdentity?.mobileCallingAvailable,phoneIdentity?.browserCallingAvailable]);
  const busy=props.busy||browserPhone.busy;
  const [query, setQuery] = useState("");
  const [phoneTeam,setPhoneTeam] = useState<PhoneTeamMember[]>([]);
  const [results, setResults] = useState<VoiceDirectoryContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeContact, setActiveContact] = useState<VoiceDirectoryContact | null>(null);
  const briefCustomerId = selected?.masterCustomerId || activeContact?.customerId;
  const briefRequestId = selected?.requestId || activeContact?.requestId || "";
  const [customerRevision,setCustomerRevision]=useState(0);
  const [contactDetails,setContactDetails]=useState<CustomerEditorData|null>(null);
  const phonePicker=useRef<HTMLDialogElement>(null);
  const placetelCall=useRef<PlacetelCallHandle>(null);
  const [organizationLabel,setOrganizationLabel]=useState<{customerId:string;name:string|null;manual:boolean}|null>(null);
  useEffect(()=>{
    if(!briefCustomerId)return;
    const controller=new AbortController();
    void fetch("/api/ops/voice-copilot/customer?"+new URLSearchParams({customerId:briefCustomerId}),{cache:"no-store",signal:controller.signal})
      .then(response=>readPhoneCentralResponse<CustomerEditorData>(response,"Organisation konnte nicht geladen werden."))
      .then(data=>{if(!controller.signal.aborted){setContactDetails(data);setOrganizationLabel({customerId:briefCustomerId,name:data.organizations.find(org=>org.id===data.customer.customer_organization_id)?.name||null,manual:data.organizationManuallySet});}})
      .catch(()=>{});
    return ()=>controller.abort();
  },[briefCustomerId,customerRevision]);
  const [noteTarget, setNoteTarget] = useState<{requestId:string; callId:string; time:string} | null>(null);
  const selectNoteTarget = (callId:string, time = new Date().toISOString()) => setNoteTarget({requestId:briefRequestId, callId, time});
  const selectedNoteCall = noteTarget?.requestId === briefRequestId ? noteTarget : null;
  const [contactTab,setContactTab]=useState<"directory"|"leads">("directory");
  const [directoryAmounts,setDirectoryAmounts]=useState<VoiceHotLead[]>([]);
  const [amountError,setAmountError]=useState(false);
  const directoryIds=results.map(c=>c.customerId).join(",");
  useEffect(()=>{
    setDirectoryAmounts([]);setAmountError(false);if(!directoryIds)return;
    const controller=new AbortController();
    const ids=directoryIds.split(",");
    void Promise.all(Array.from({length:Math.ceil(ids.length/100)},(_,i)=>fetch("/api/ops/voice-copilot/hot-leads?"+new URLSearchParams({customerIds:ids.slice(i*100,i*100+100).join(",")}),{cache:"no-store",signal:controller.signal})
      .then(r=>readPhoneCentralResponse<{results:VoiceHotLead[]}>(r,"Beträge nicht verfügbar"))))
      .then(pages=>({results:pages.flatMap(page=>page.results)}))
      .then(data=>{if(!controller.signal.aborted)setDirectoryAmounts(data.results);})
      .catch(()=>{if(!controller.signal.aborted)setAmountError(true);});
    return ()=>controller.abort();
  },[directoryIds,callHistoryRevision]);
  const [panel, setPanel] = useState<"contacts" | "dial">("contacts");
  const [number, setNumber] = useState("");
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState("");
  const [notice, setNotice] = useState("");
  const selection = useRef(0);
  const settingsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (query.trim().length === 1) {
      setResults([]); setNextOffset(null); setLoading(false); setError("");
      return;
    }
    if (offset === 0) setResults([]);
    setError("");
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const data = await fetchPhoneDirectory<DirectoryResponse>(
          "/api/ops/voice-copilot/context?directory=1&query=" +
            encodeURIComponent(query.trim()) + "&offset=" + offset,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (!Array.isArray(data.results)) throw new Error("Kunden konnten nicht geladen werden.");
        setResults(current => offset === 0 ? data.results :
          [...new Map([...current, ...data.results].map(contact => [contact.customerId, contact])).values()]);
        setNextOffset(data.nextOffset);
      } catch {
        if (!controller.signal.aborted)
          setError("Kunden konnten nicht geladen werden. Bitte versuche es erneut.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, query.trim() ? 300 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, offset, retry]);

  // Adopt the persisted customer binding when joining another person's call.
  // Clear a previously selected customer before loading the incoming context.
  const receivedCall = browserPhone.transfer?.role==="recipient" ? browserPhone.transfer.call : (browserPhone.call?.direction==="inbound"||browserPhone.call?.transport==="mobile") ? browserPhone.call : null;
  const receivedId=useRef<string|null>(null);
  useEffect(()=>{
    if(!receivedCall || receivedId.current===receivedCall.id)return;
    receivedId.current=receivedCall.id;
    const current=++selection.current;
    setActiveContact(null);setNumber(receivedCall.phone);props.onSelect(null);props.onWorkspaceChange("prepare");
    setContextError("");setNotice("");setContextLoading(false);
    if(!receivedCall.customerId)return;
    if(!receivedCall.requestId){
      setContextLoading(true);
      void fetch("/api/ops/voice-copilot/context?directory=1&customerId="+encodeURIComponent(receivedCall.customerId),
        {cache:"no-store",signal:AbortSignal.timeout(15000)})
        .then(response=>readPhoneCentralResponse<DirectoryResponse>(response,"Die Kontaktdaten sind gerade nicht erreichbar."))
        .then(data=>{
          if(selection.current!==current)return;
          const contact=data.results?.find(row=>row.customerId===receivedCall.customerId);
          if(!contact)throw Error("incoming_contact_mismatch");
          setActiveContact({...contact,requestId:null,requestTitle:null});
        }).catch(()=>{if(selection.current===current)setContextError("Die Kontaktdaten sind gerade nicht erreichbar. Der Anruf bleibt verbunden.");})
        .finally(()=>{if(selection.current===current)setContextLoading(false);});
      return;
    }
    setContextLoading(true);
    void fetch("/api/ops/voice-copilot/context?overview=1&requestId="+encodeURIComponent(receivedCall.requestId)+"&customerId="+encodeURIComponent(receivedCall.customerId),
      {cache:"no-store",signal:AbortSignal.timeout(20000)})
      .then(response=>readPhoneCentralResponse<{context:VoiceCustomerContext}>(response,"Die Kundenübersicht ist gerade nicht erreichbar."))
      .then(data=>{
        if(selection.current!==current)return;
        if(data.context?.requestId!==receivedCall.requestId)throw Error("incoming_context_mismatch");
        props.onSelect(data.context);
      }).catch(()=>{if(selection.current===current)setContextError("Die Kundenübersicht ist gerade nicht erreichbar. Der Anruf bleibt verbunden.");})
      .finally(()=>{if(selection.current===current)setContextLoading(false);});
  // The server-bound call ID changes once for each incoming customer call.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[receivedCall?.id]);

  async function select(contact: VoiceDirectoryContact) {
    if (busy) return;
    const current = ++selection.current;
    setActiveContact(contact);
    setNumber(contact.phone || "");
    props.onSelect(null);
    props.onWorkspaceChange("prepare");
    setNotice("");
    setContextError("");
    setContextLoading(Boolean(contact.requestId));
    if (!contact.requestId) return;
    try {
      const response = await fetch(
        "/api/ops/voice-copilot/context?overview=1&requestId=" + encodeURIComponent(contact.requestId) + "&customerId=" + encodeURIComponent(contact.customerId),
        { cache: "no-store", signal: AbortSignal.timeout(20000) },
      );
      const data = await readPhoneCentralResponse<{context: VoiceCustomerContext}>(response,
        "Kontaktdaten sind da. Die Gesprächsübersicht ist gerade nicht erreichbar.");
      if (current !== selection.current) return;
      if (!data.context || data.context.requestId !== contact.requestId)
        throw new Error("Die Gesprächsübersicht konnte nicht zugeordnet werden.");
      props.onSelect(data.context);
    } catch {
      if (current === selection.current)
        setContextError("Kontaktdaten sind da. Die Gesprächsübersicht ist gerade nicht erreichbar.");
    } finally {
      if (current === selection.current) setContextLoading(false);
    }
  }
  async function customerSaved(data: CustomerEditorData) {
    const id=data.customer.id;
    setContactDetails(data);
    setCustomerRevision(n=>n+1);
    setOrganizationLabel({customerId:id,name:data.organizations.find(org=>org.id===data.customer.customer_organization_id)?.name||null,manual:data.organizationManuallySet});
    const response=await fetch("/api/ops/voice-copilot/context?directory=1&customerId="+encodeURIComponent(id),{cache:"no-store"});
    const directory=await readPhoneCentralResponse<DirectoryResponse>(response,"Gespeichert. Bitte lade die Kundenansicht erneut.");
    const contact=directory.results.find(row=>row.customerId===id);
    if(!contact)throw Error("Gespeichert. Bitte lade die Kundenansicht erneut.");
    setChosenPhone(null);
    setResults(old=>old.map(row=>row.customerId===id?contact:row));
    await select(contact);
  }
  function changeNumber(value: string) {
    if (busy) return;
    ++selection.current;
    setNumber(value);
    setActiveContact(null);
    props.onSelect(null);
    props.onWorkspaceChange("prepare");
    setContextLoading(false); setContextError(""); setNotice("");
  }
  const customer = activeContact || selected?.customer;
  const organization = organizationLabel && organizationLabel.customerId===briefCustomerId ? organizationLabel.name || (organizationLabel.manual ? null : customer?.company) : customer?.company;
  const name = customer?.displayName || customer?.company || "Dein nächstes Gespräch";
  const [chosenPhone,setChosenPhone]=useState<{customerId:string;phone:string}|null>(null);
  const detail=contactDetails?.customer.id===briefCustomerId?contactDetails:null;
  const emailCount=detail?new Set([detail.customer.email,...detail.emails].map(value=>value.trim().toLowerCase()).filter(Boolean)).size:0;
  const phoneNumbers=[...new Set((detail?[detail.customer.phone,...detail.phones]:[customer?.phone,...(activeContact?.phoneNumbers||[])]).filter((value):value is string=>Boolean(value)).map(value=>parsePhoneNumberFromString(value,"DE")?.number||value))];
  function callContact(number:string,event?:MouseEvent<HTMLButtonElement>){
    if(busy||contextLoading)return;
    const target=dialPhoneNumber(number);if(!target)return;
    phonePicker.current?.close();
    if(placetelCall.current){if(!placetelCall.current.start(target)){setNotice("Bitte schließe zuerst den bereits vorbereiteten Anruf ab oder prüfe seinen Status.");return;}}
    else if(event)openPhoneApp(event,target);
    else {if(!window.confirm(`Möchtest du ${target} jetzt mit der Telefon-App anrufen?`))return;window.location.assign("tel:"+target);setNotice("Nummer an die Telefon-App übergeben.");}
    if(briefCustomerId)setChosenPhone({customerId:briefCustomerId,phone:number});
  }
  const phone = chosenPhone && chosenPhone.customerId===briefCustomerId && phoneNumbers.includes(parsePhoneNumberFromString(chosenPhone.phone,"DE")?.number||chosenPhone.phone) ? chosenPhone.phone : customer?.phone || phoneNumbers[0] || "";
  const dialPhone = dialPhoneNumber(phone);
  const freeDialPhone = dialPhoneNumber(number);
  const lastDialAt = useRef(-Infinity);
  const dialedSession = useRef<string | null>(null);
  const readySession = props.workspace === "assist" && selected && !browserPhone.busy ? props.liveAssistSession : null;
  const assistedDialReady = Boolean(readySession && readySession !== dialedSession.current);
  function openPhoneApp(event: MouseEvent<HTMLButtonElement>, phone: string) {
    const assisted = assistedDialReady && phone === dialPhone && readySession !== dialedSession.current;
    if (!event.nativeEvent.isTrusted || (busy && !assisted) || performance.now() - lastDialAt.current < 2000) return;
    if (!window.confirm(`Möchtest du ${phone} jetzt mit der Telefon-App anrufen?`)) return;
    if (assisted && readySession) dialedSession.current = readySession;
    lastDialAt.current = performance.now();
    window.location.assign("tel:" + phone);
    setNotice(assisted ? "Telefon-App geöffnet. Die Gesprächsbegleitung läuft in OPS weiter." : "Die Standard-Telefon-App öffnet sich. Anrufe darüber werden derzeit nicht automatisch mitgeschrieben.");
  }

  return (
    <div className={styles.page}>
    <main className={styles.shell} data-header-design="salbei" data-contact-design="3">
      <header className={styles.top}>
        <div className={styles.brandrow}>
        <a className={styles.brand} href="/ops">
          NEONTRIP
        </a>
        <span className={styles.breadcrumb}>Ops / Telefonzentrale</span>
        <span className={styles.spacer} />
        <a
          className={styles.small}
          href="#voice-settings"
          onClick={() => {
            if (settingsRef.current) settingsRef.current.open = true;
          }}
        >
          Einstellungen
        </a>
        </div>
        <div
          className={styles.navigation}
          onFocusCapture={(event) => {
            event.target.closest("a")?.scrollIntoView({ block: "nearest", inline: "nearest" });
          }}
        >
          <OpsAppSwitcher active="voiceCopilot" tone="light" />
        </div>
      </header>
      <div className={styles.titlebar}>
        <div className={styles.centralIdentity}>
            <div className={styles.operatorBlock}>        <PhoneAccount value={props.operatorName} onChange={props.onOperatorNameChange} busy={busy} onTeam={setPhoneTeam} onIdentity={setPhoneIdentity} onManage={()=>{setPhoneAdminOpen(true);if(settingsRef.current)settingsRef.current.open=true;window.setTimeout(()=>document.getElementById("voice-phone-team")?.scrollIntoView({block:"start"}),0);}}/>
        <span className={styles.connectionState}><span />{mobileAudio ? "Mein Handy" : browserPhone.registered ? "Browser verbunden" : props.busy ? "Begleitung aktiv" : "Telefon-App"}</span>
</div>
        <h1>Telefonzentrale</h1></div>
          <section className={styles.callhead}>
            <div className={styles.customerOverview}>
            <div className={styles.calltitle}>
              <span className={styles.avatar}>
                {customer ? initials(name) : <Phone size={23} />}
              </span>
              <div className={styles.customerIdentity}>
                <div className={styles.customerNameRow}><h2>{browserPhone.call && !customer ? browserPhone.call.phone : name}</h2>{briefCustomerId && <CustomerEditor key={briefCustomerId} customerId={briefCustomerId} disabled={busy} onSaved={customerSaved} onDial={callContact}/>}</div>
                {!customer && <p>{browserPhone.call ? browserPhone.call.customerId ? "Kundenanruf · kein Vorgang geöffnet" : "Freier Anruf · ohne Kundenzuordnung" : "Kontakt auswählen oder links eine Nummer wählen."}</p>}
                {contextLoading && <small role="status">Gesprächsübersicht wird geladen …</small>}

              </div>
            </div>
            <div className={styles.actions + " " + styles.headerActions}>
              {briefCustomerId && briefRequestId && dialPhone && props.workspace === "prepare" &&
                <PlacetelCallButton ref={placetelCall} key={briefCustomerId + ":" + briefRequestId} customerId={briefCustomerId}
                  requestId={briefRequestId} dialNumber={dialPhone} disabled={busy || contextLoading} onCallChange={refreshCallHistory} onNoteTarget={selectNoteTarget} onEnded={leadCallEnded} />}
              {customer && !readySession && props.workspace !== "prepare" && (props.workspace === "assist" ? (
                <button type="submit" form="phone-assist-start" className={styles.button + " " + styles.primary}
                  disabled={busy || contextLoading || !selected}>
                  <Headphones size={17}/> Einwilligung bestätigen und Begleitung starten
                </button>
              ) : (
                <button type="button" className={styles.button} disabled={busy || contextLoading || !selected}
                  onClick={() => props.onWorkspaceChange("assist")}><Headphones size={17}/> Gespräch begleiten</button>
              ))}
              {canDial && activeContact && dialPhone && !busy ? <button type="button" className={styles.button+" "+styles.primary}
                disabled={busy||!endpointReady} onClick={()=>void browserPhone.dial({customerId:activeContact.customerId,requestId:activeContact.requestId},outgoingRoute)}>{outgoingRoute==="mobile"?"Über mein Handy anrufen":"Im Browser anrufen"}</button>:null}
              {props.workspace === "prepare" && briefCustomerId && briefRequestId && dialPhone ? null : customer && dialPhone && (!busy || assistedDialReady) ? (
                <button type="button" className={assistedDialReady ? styles.button + " " + styles.primary : styles.button} onClick={event => openPhoneApp(event, dialPhone)}>
                  <Phone size={17} />{assistedDialReady ? "Mit Live-Mitschrift anrufen" : "In Telefon-App anrufen"}
                </button>
              ) : customer ? (
                <button className={styles.button + " " + styles.primary + " " + styles.placetelDial} disabled><Phone size={20}/>
                  {props.workspace === "assist" && dialPhone ? (readySession ? "Anruf gestartet" : "Gesprächsbegleitung vorbereiten") : busy ? "Gespräch aktiv" : "Rufnummer fehlt"}
                </button>
              ) : null}
              <button
                className={styles.button}
                disabled={busy || contextLoading || Boolean(activeContact && !selected)}
                onClick={() => props.onWorkspaceChange("live")}
              >
                <Bot size={18} />
                KI-Sprachtest
              </button>

            </div>
            </div>
            {customer && <dl className={styles.contactFacts} aria-label="Kontaktdaten">
              <div><dt>E-Mail: {briefCustomerId&&emailCount>1&&<CustomerEditor customerId={briefCustomerId} disabled={busy} onSaved={customerSaved} onDial={callContact} trigger="email" count={emailCount}/>}</dt><dd>{customer.email ? <a className={styles.factValue} title={customer.email} href={"mailto:" + customer.email}>{customer.email}</a> : <span className={styles.missingFact}>{briefCustomerId ? <CustomerEditor customerId={briefCustomerId} disabled={busy} onSaved={customerSaved} onDial={callContact} trigger="email"/> : "Nicht hinterlegt"}</span>}</dd></div>
              <div><dt>Telefonnummer: {phoneNumbers.length>1&&<button type="button" className={styles.contactCount} disabled={busy||contextLoading} aria-label={`${phoneNumbers.length} Telefonnummern – Nummer auswählen`} onClick={()=>phonePicker.current?.showModal()}>({phoneNumbers.length})</button>}</dt><dd><div className={styles.phoneFact}><span>{phone || (briefCustomerId ? <CustomerEditor customerId={briefCustomerId} disabled={busy} onSaved={customerSaved} onDial={callContact} trigger="phone"/> : "Rufnummer fehlt")}</span>{briefCustomerId && <CustomerPhoneEditor key={briefCustomerId} customerId={briefCustomerId} disabled={busy} onSaved={(saved,numbers)=>{
                  setCustomerRevision(n=>n+1);
                  setChosenPhone({customerId:briefCustomerId,phone:saved});
                  setActiveContact(old=>old?.customerId===briefCustomerId?{...old,phone:old.phone||saved,phoneNumbers:numbers}:old);
                  setResults(old=>old.map(row=>row.customerId===briefCustomerId?{...row,phone:row.phone||saved,phoneNumbers:numbers}:row));
                }}/>}</div></dd></div>
              <div><dt>Organisation:</dt><dd>{organization ? <span className={styles.factValue} title={organization}>{organization}</span> : <span className={styles.missingFact}>Nicht hinterlegt</span>}</dd></div>
              <div><dt>Bisherige Bestellungen:</dt><dd>{briefCustomerId && <OrganizationOrdersButton key={briefCustomerId+":"+customerRevision} customerId={briefCustomerId}/>}</dd></div>
            </dl>}
            <dialog ref={phonePicker} className={styles.phoneDialog} aria-label="Rufnummer auswählen">
              <h3>Welche Nummer möchtest du anrufen?</h3>
              <div className={styles.phoneChoices}>{phoneNumbers.map(number=><div className={styles.phoneChoice} key={number}>
                <span>{number}</span><ContactCopyButton value={number} label={number}/>
                <button type="button" className={styles.button+" "+styles.primary} disabled={busy||contextLoading} onClick={event=>callContact(number,event)}><Phone size={16}/>Mit Placetel anrufen</button>
              </div>)}</div>
              <div className={styles.actions}><button type="button" className={styles.button} onClick={()=>phonePicker.current?.close()}>Schließen</button></div>
            </dialog>
            {briefCustomerId && <CustomerLinks key={briefCustomerId+":"+briefRequestId} customerId={briefCustomerId} requestId={briefRequestId} context={selected}/>}

          </section>
      </div>
      {phoneIdentity?.browserCallingAvailable&&phoneIdentity.mobileCallingAvailable?<label className={styles.outgoingRoute}>Anrufen über
        <select aria-label="Anrufen über" className={styles.device} value={browserPhone.transfer?.role==="recipient"?browserPhone.transfer.transport||"browser":browserPhone.call?.transport||outgoingRoute} disabled={busy} onChange={e=>setOutgoingRoute(e.target.value as "browser"|"mobile")}>
          <option value="browser">Browser</option><option value="mobile">Mein Handy · {phoneIdentity.mobilePhone}</option>
        </select>
      </label>:null}
      {phoneIdentity?.browserCallingAvailable||phoneIdentity?.mobileCallingAvailable ? <section className={styles.browserPhoneBar} aria-label={mobileAudio?"Handy-Telefon":"Browser-Telefon"}>
        <div><strong>{browserPhone.call ? (browserPhone.call.cleanupPending ? "Anruf wird beendet …" :
          browserPhone.transfer ? "Gesprächsübergabe" : browserPhone.call.connected ? "Im Gespräch" : browserPhone.call.state==="ringing" ? "Es klingelt beim Angerufenen …" : browserPhone.call.state==="dialing" ? "Der Kunde wird angerufen …" : mobileAudio?"Nimm den Rückruf am Handy an und drücke 1.":"Anruf wird verbunden …") : mobileAudio?"Handy-Telefon · Pilot":"Browser-Telefon · Pilot"}</strong>
          <p className={styles.small}>{browserPhone.call ? browserPhone.call.phone : "Nur freigegebene Testnummern. Eine Mitschrift startest du nach bestätigter Absprache."}</p>
        </div>
        {browserPhone.call ? <div className={styles.actions}>
          {!mobileAudio?<>          <button type="button" className={styles.button} aria-pressed={browserPhone.muted} onClick={browserPhone.mute}>{browserPhone.muted?"Mikrofon einschalten":"Stummschalten"}</button>
          <details className={styles.callDigits}><summary>Wahltasten im Gespräch</summary><div className={styles.keypad}>
            {["1","2","3","4","5","6","7","8","9","*","0","#"].map(digit=><button type="button" key={digit} onClick={()=>browserPhone.sendDigits(digit)}>{digit}</button>)}
          </div></details></>:<p className={styles.small}>Stummschalten und Wahltasten direkt am Handy.</p>}
          <button type="button" className={styles.button} disabled={!!browserPhone.transfer && (browserPhone.transfer.state==="committing"||browserPhone.transfer.ownerAdopted)} onClick={()=>void browserPhone.finish()}>{browserPhone.transfer?.role==="recipient"?"Rücksprache verlassen":"Auflegen"}</button>
        </div> : mobileAudio?<p className={styles.small}>Wir rufen zuerst dein bestätigtes Handy an.</p>:<button type="button" className={styles.button} disabled={!browserPhone.allowed||browserPhone.busy||browserPhone.registered||props.busy}
          onClick={()=>void browserPhone.enable()}>{browserPhone.registered?"Browser bereit":browserPhone.working?"Verbindet …":"Browser-Telefon verbinden"}</button>}
        {browserPhone.error?<p className={styles.searchError} role="alert">{browserPhone.error}</p>:null}
      </section>:null}
      {browserPhone.aiHandoff?<section className={styles.browserPhoneBar} aria-label="KI-Übernahme">
        <div role="status"><strong>{browserPhone.aiHandoff.state==="redirecting"?"Kundenleitung wird übergeben …":browserPhone.aiHandoff.cleanupPending?"Übernahme wird beendet …":"Deine Verbindung wird vorbereitet …"}</strong>
          <p className={styles.small}>{browserPhone.aiHandoff.phone} · Erst nach bestätigtem Beitritt gilt das Gespräch als übernommen.</p></div>
        <button type="button" className={styles.button} disabled={browserPhone.working||browserPhone.aiHandoff.state==="redirecting"||browserPhone.aiHandoff.connected||browserPhone.aiHandoff.cleanupPending} onClick={()=>void browserPhone.finish()}>Übernahme abbrechen</button>
      </section>:null}
      {phoneIdentity?.browserCallingAvailable||browserPhone.call?<PhoneTransferPanel phone={browserPhone}/>:null}
      <div className={styles.layout}>
        <aside className={styles.left} aria-label="Kundensuche und Team">
          <div className={styles.panelTabs} aria-label="Telefonbereich">
            <button type="button" aria-pressed={panel === "contacts"} onClick={() => setPanel("contacts")}><Users size={17} />Kunden</button>
            <button type="button" aria-pressed={panel === "dial"} onClick={() => setPanel("dial")}><Grid2X2 size={17} />Wählen</button>
          </div>
          {panel === "contacts" ? <>
            <div className={styles.panelTabs} aria-label="Kundenliste">
              <button type="button" aria-pressed={contactTab==="directory"} onClick={()=>setContactTab("directory")}>Verzeichnis</button>
              <button type="button" aria-pressed={contactTab==="leads"} onClick={()=>setContactTab("leads")}>Hot-Leads</button>
            </div>
            {contactTab==="leads"?<HotLeads busy={busy} finishedCall={finishedLeadCall} revision={callHistoryRevision} onSelect={contact=>void select(contact)}/>:<>
            <h2 className={styles.leftTitle}>Kundenverzeichnis</h2>
            <label className={styles.search}>
              <Search size={18} />
              <input aria-label="Kunden suchen" value={query} maxLength={160}
                onChange={e => { setOffset(0); setQuery(e.target.value); }}
                placeholder="Name, E-Mail, Telefon" />
            </label>
            <p className={styles.directoryStatus} role="status">
              {loading ? "Kontakte werden geladen …" : error ? "Suche derzeit nicht verfügbar" :
                query.trim().length === 1 ? "Bitte mindestens zwei Zeichen eingeben." :
                query.trim() ? results.length + (nextOffset !== null ? "+ Treffer" : " Treffer") : "Euer Kundenverzeichnis · neueste Anfrage zuerst"}
            </p>
            {error ? <div className={styles.searchError} role="alert">
              <p>{error}</p>
              <button type="button" className={styles.retry} onClick={() => setRetry(value => value + 1)}><RefreshCw size={15} />Erneut versuchen</button>
            </div> : null}
            <div className={styles.results}>
              {results.map(contact => {const lead=directoryAmounts.find(item=>item.customerId===contact.customerId&&item.requestId===contact.requestId);return <div key={contact.customerId}><button type="button"
                className={styles.result + " " + (activeContact?.customerId === contact.customerId ? styles.selected : "")}
                disabled={busy} aria-pressed={activeContact?.customerId === contact.customerId}
                onClick={() => void select(contact)}>
                <span className={styles.contactAvatar}>{initials(contact.company || contact.displayName || "Kontakt")}</span>
                <span className={styles.resultContent}>
                  <strong>{contact.company || contact.displayName || "Kontakt"} {contactSegment(contact.email)?<small className={styles.leadBadge} title="Automatisch anhand der E-Mail-Domain">{contactSegment(contact.email)}</small>:null}</strong>
                  {lead?.amount!=null?<strong>{leadAmount(lead)}</strong>:null}
                  <span>{contact.company && contact.displayName ? contact.displayName + " · " : ""}{contact.phone || "Rufnummer fehlt"}</span>
                  <span>{contact.email || contact.requestTitle || "Kontaktdaten öffnen"}</span>
                  {contact.requestCreatedAt && <span>Letzte Anfrage: {new Date(contact.requestCreatedAt).toLocaleDateString("de-DE")}</span>}
                </span>
                <ChevronRight size={16} />
              </button>{lead?.canSchedule?<DirectoryLeadSnooze lead={lead} onSaved={refreshCallHistory}/>:null}</div>;})}
            </div>
            {!loading && !error && !results.length && query.trim().length !== 1 ? <p className={styles.empty}>
              {nextOffset !== null ? "Auf dieser Seite kein passender Kontakt. Weitere Kontakte laden." :
                query.trim() ? "Kein passender Kontakt. Du kannst die Nummer unter „Wählen“ direkt eingeben." : "Noch keine Kontakte vorhanden."}
            </p> : null}
            {nextOffset !== null && !error ? <button type="button" className={styles.loadMore} disabled={loading}
              onClick={() => setOffset(nextOffset)}>Weitere Kontakte laden</button> : null}
            {amountError?<p className={styles.small}>Angebotsbeträge gerade nicht verfügbar.</p>:null}
            </>}
          </> : <section aria-label="Wahltasten" className={styles.dialer}>
            <h2 className={styles.leftTitle}>Nummer wählen</h2>
            <label className={styles.dialInput}>
              <span className="sr-only">Telefonnummer</span>
              <input type="tel" inputMode="tel" autoComplete="off" maxLength={40} value={number} disabled={busy}
                onChange={e => changeNumber(e.target.value)} placeholder="+49 …" />
            </label>
            <p className={styles.directoryStatus}>{activeContact ? "Nummer des ausgewählten Kontakts" : "Freie Nummer · ohne Kundenzuordnung"}</p>
            <div className={styles.keypad}>
              {["1","2","3","4","5","6","7","8","9","+","0"].map(key =>
                <button type="button" key={key} aria-label={key === "+" ? "Plus" : "Ziffer " + key} disabled={busy || number.length >= 40}
                  onClick={() => changeNumber(number + key)}>{key}</button>)}
              <button type="button" aria-label="Letzte Ziffer löschen" disabled={busy || !number}
                onClick={() => changeNumber(number.slice(0,-1))}><Delete size={21}/></button>
            </div>
            {canDial && freeDialPhone && !busy ? <button type="button" className={styles.button+" "+styles.primary+" "+styles.dialAction}
              disabled={busy||!endpointReady} onClick={()=>void browserPhone.dial(activeContact?
                {customerId:activeContact.customerId,requestId:activeContact.requestId}:{phone:freeDialPhone},outgoingRoute)}>{outgoingRoute==="mobile"?"Über mein Handy anrufen":"Im Browser anrufen"}</button>:null}
            {freeDialPhone && !busy ? <button type="button" className={styles.button + " " + styles.primary + " " + styles.dialAction}
              onClick={event => openPhoneApp(event, freeDialPhone)}><Phone size={17}/>In Telefon-App anrufen</button> :
              !browserPhone.call ? <button className={styles.button + " " + styles.primary + " " + styles.dialAction} disabled><Phone size={17}/>{browserPhone.externalIncoming?"Eingehender Anruf":browserPhone.incoming?"Eingehende Übergabe":busy?"Gespräch aktiv":"Nummer eingeben"}</button>:null}
            {number && !freeDialPhone ? <p className={styles.small}>Bitte eine vollständige Telefonnummer eingeben.</p> : null}
          </section>}
          <div className={styles.providerNote}>
            <Phone size={16}/><p><strong>Telefon-App auf diesem Gerät</strong>Für die Direktwahl muss Placetel auf diesem Gerät als Telefon-App eingerichtet sein.</p>
          </div>
          {phoneTeam.length ? <section className={styles.phoneTeam} aria-label="Telefonteam">
            <h3>Dein Team</h3>
            {phoneTeam.map(member=><div className={styles.phoneTeamMember} key={member.id}>
              <span className={styles.contactAvatar}>{initials(member.displayName)}</span>
              <div><strong>{member.displayName}</strong><p className={styles.small}>
                {member.extension?"Nebenstelle "+member.extension+" · ":""}
                {(browserPhone.call && member.id===phoneIdentity?.profile?.id)||[browserPhone.transfer?.fromStaffId,browserPhone.transfer?.toStaffId].includes(member.id)?"Im Gespräch":member.presence==="busy"?"Im Gespräch":member.presence==="available"?(member.receiveVia==="mobile"?"Handy bereit":"Bereit"):member.presence==="away"?"Abwesend":"Telefon offline"}
              </p></div>
              {browserPhone.call?.connected && member.id!==phoneIdentity?.profile?.id && !browserPhone.transfer?
               <button type="button" className={styles.button} disabled={browserPhone.working||member.presence!=="available"}
                onClick={()=>void browserPhone.beginTransfer(member.id)}>Weitergeben</button>:null}
            </div>)}
          </section>:null}
          <section className={styles.team}>
            <div className={styles.sectionhead}>
              <h3>Im Gespräch</h3>
            </div>
            {busy ? (
              <div className={styles.livecall}>
                <span className={styles.avatar}>
                  {props.workspace === "live"
                    ? "KI"
                    : initials(props.operatorName || "Du")}
                </span>
                <div>
                  <strong>{browserPhone.call && !customer ? browserPhone.call.phone : name}</strong>
                  <div className={styles.small}>{browserPhone.call ? browserPhone.call.cleanupPending?"Wird beendet …":browserPhone.call.connected?"Im Gespräch":"Verbindet …" : props.status}</div>
                </div>
                <ChevronRight size={19} />
              </div>
            ) : (
              <p className={styles.small}>
                Keine aktive Gesprächsbegleitung.
              </p>
            )}
          </section>
        </aside>
        <div>
          <div className={styles.detailgrid}>
            <section className={styles.conversation} aria-label="Gespräch">
              {phoneIdentity?.aiHandoffAvailable&&phoneIdentity.profile&&!browserPhone.call?<PhoneAiCallsPanel phone={browserPhone} onTakeover={id=>{
                ++selection.current;setActiveContact(null);props.onSelect(null);setContextError("");setContextLoading(false);props.onWorkspaceChange("prepare");
                void browserPhone.beginAiHandoff(id);
              }}/>:null}
              <PhoneTranscriptPanel call={browserPhone.call} recipientConsultation={browserPhone.transfer?.role==="recipient"&&!browserPhone.transfer.ownerAdopted}/>
              {notice ? (
                <p className={styles.notice} role="status">
                  {notice}
                </p>
              ) : null}
              {contextError ? <div className={styles.searchError} role="alert">
                <p>{contextError}</p>
                {activeContact ? <button type="button" className={styles.retry} onClick={() => void select(activeContact)}>Übersicht erneut laden</button> : null}
              </div> : null}
              {selected?.historyStatus === "unavailable" ? (
                <div className={styles.hint}>
                  <strong>Gesprächshistorie gerade nicht erreichbar</strong>
                  <p>Frühere Absprachen können deshalb fehlen.</p>
                </div>
              ) : null}
              <h3>
                {props.workspace === "prepare"
                  ? "Gespräch vorbereiten"
                  : props.workspace === "live"
                    ? "KI-Sprachtest mit GPT-Live 1"
                    : "Live-Gespräch begleiten"}
              </h3>
              {props.workspace === "prepare" ? (
                <>
                  <div className={styles.prep}>
                    <p>
                      {contextLoading ? "Die Gesprächsübersicht wird geladen." : selected ? "Bereit für dein Gespräch." :
                        activeContact ? "Die Kontaktdaten sind bereit." : "Alles für dein Gespräch an einem Ort."}
                    </p>
                    <p className={styles.small}>
                      {activeContact && !activeContact.requestId
                        ? "Für diesen Kontakt ist noch kein Vorgang verknüpft. Du kannst ihn trotzdem über die Telefon-App anrufen."
                        : selected || activeContact ? "Letzte Absprachen, Nachrichten und verknüpfte Vorgänge findest du rechts."
                          : "Wähle links einen Kontakt. Hier findest du seine letzten Absprachen, Nachrichten und Vorgänge."}
                    </p>
                  </div>
                  {selected?.requestId && <CallNotes key={selected.requestId} requestId={selected.requestId} target={selectedNoteCall} onSaved={refreshCallHistory}/>}
                </>
              ) : null}
              {props.children}
            </section>
            <aside className={styles.context} aria-label="Kundenübersicht">
              {!briefCustomerId && <RecentCalls busy={busy} onSelect={select} onNumber={phone=>{changeNumber(phone);setPanel("dial");}}/>}
              {briefCustomerId && <CustomerBrief key={briefCustomerId + ":" + briefRequestId}
                id={briefCustomerId} requestId={briefRequestId} context={selected} revision={callHistoryRevision} onNoteTarget={(callId,time)=>{
                  selectNoteTarget(callId,time); document.getElementById("voice-call-note")?.focus();
                }}/>}
              {selected && props.hints.length ? (
                <div aria-live="polite">
                  {props.hints.map((hint, index) => (
                    <article key={index} className={styles.hint}>
                      <div className={styles.label}>Wissen · nur für dich</div>
                      <strong>{hint.text}</strong>
                      <p>{hint.reason}</p>
                      {hint.sourceLabels.length ? (
                        <details>
                          <summary>Quelle &amp; Begründung</summary>
                          <p>{hint.sourceLabels.join(", ")}</p>
                        </details>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <div className={styles.hint}>
                  <div className={styles.label}>Wissen · nur für dich</div>
                  <strong>Dein Wissenscheck</strong>
                  <p>Kurze Hinweise zu Kundenwünschen und euren Regeln – sobald die Gesprächsbegleitung läuft.</p>
                </div>
              )}
              {props.linkedTranscript ? (
                <div className="mt-7">
                  <VoiceHistoryPanel
                    initialSessionId={props.linkedTranscript}
                  />
                </div>
              ) : null}
            </aside>
          </div>
        </div>
      </div>
      <details ref={settingsRef} id="voice-settings" className={styles.admin} onToggle={event=>{if(event.target===event.currentTarget&&!event.currentTarget.open)setPhoneAdminOpen(false);}}>
        <summary>Einstellungen &amp; Wissen</summary>
        {phoneIdentity?.canManagePhone?<PhoneStaffAdmin identity={phoneIdentity} open={phoneAdminOpen} onToggle={()=>setPhoneAdminOpen(!phoneAdminOpen)}/>:null}
        <div className="mt-6">{props.settings}</div>
      </details>
    </main>
    </div>
  );
}
