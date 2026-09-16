"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Search, Phone, Headphones, ChevronRight, Bot, Delete, Users, Grid2X2, RefreshCw } from "lucide-react";
import type { VoiceCopilotSuggestion } from "@/lib/ops/voice-copilot";
import type { VoiceCustomerContext } from "@/lib/ops/voice-knowledge";
import { VoiceHistoryPanel } from "./voice-history-panel";
import styles from "./phone-central.module.css";
import { OpsAppSwitcher } from "../ops-app-switcher";
import { useBrowserPhone } from "./use-browser-phone";
import { PhoneAccount } from "./phone-account";
import type { PhoneTeamMember, PhoneIdentity } from "@/lib/ops/voice-phone-contract";

import type { VoiceDirectoryContact } from "@/lib/ops/voice-directory";
import { dialPhoneNumber, readPhoneCentralResponse } from "./phone-central-data";

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
  const [phoneIdentity,setPhoneIdentity]=useState<PhoneIdentity|null>(null);
  const browserPhone=useBrowserPhone(phoneIdentity,props.busy);
  const busy=props.busy||browserPhone.busy;
  const [query, setQuery] = useState("");
  const [phoneTeam,setPhoneTeam] = useState<PhoneTeamMember[]>([]);
  const [results, setResults] = useState<VoiceDirectoryContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeContact, setActiveContact] = useState<VoiceDirectoryContact | null>(null);
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
        const response = await fetch(
          "/api/ops/voice-copilot/context?directory=1&query=" +
            encodeURIComponent(query.trim()) + "&offset=" + offset,
          { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) },
        );
        const data = await readPhoneCentralResponse<DirectoryResponse>(response,
          "Kunden konnten nicht geladen werden. Bitte versuche es erneut.");
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
        "/api/ops/voice-copilot/context?requestId=" + encodeURIComponent(contact.requestId) + "&customerId=" + encodeURIComponent(contact.customerId),
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
  const name = customer?.company || customer?.displayName || "Dein nächstes Gespräch";
  const phone = customer?.phone || "";
  const dialPhone = dialPhoneNumber(phone);
  const freeDialPhone = dialPhoneNumber(number);
  function appNotice() {
    setNotice("Die Standard-Telefon-App öffnet sich. Anrufe darüber werden derzeit nicht automatisch mitgeschrieben.");
  }
  const lastCall = selected?.recentCalls?.[0];
  const lastMail = selected?.outlook[0];
  return (
    <div className={styles.page}>
    <main className={styles.shell}>
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
        <h1>Telefonzentrale</h1>
        <span className={styles.spacer} />
        <PhoneAccount value={props.operatorName} onChange={props.onOperatorNameChange} busy={busy} onTeam={setPhoneTeam} onIdentity={setPhoneIdentity}/>
        <span className={styles.connectionState}><span />{browserPhone.registered ? "Browser verbunden" : props.busy ? "Begleitung aktiv" : "Telefon-App"}</span>
      </div>
      {phoneIdentity?.browserCallingAvailable ? <section className={styles.browserPhoneBar} aria-label="Browser-Telefon">
        <div><strong>{browserPhone.call ? (browserPhone.call.cleanupPending ? "Anruf wird beendet …" :
          browserPhone.call.connected ? "Im Gespräch" : browserPhone.call.state==="ringing" ? "Es klingelt beim Angerufenen …" : "Anruf wird verbunden …") : "Browser-Telefon · Pilot"}</strong>
          <p className={styles.small}>{browserPhone.call ? browserPhone.call.phone : "Nur freigegebene Testnummern. In diesem Pilot wird noch kein Gesprächstranskript erstellt."}</p>
        </div>
        {browserPhone.call ? <div className={styles.actions}>
          <button type="button" className={styles.button} aria-pressed={browserPhone.muted} onClick={browserPhone.mute}>{browserPhone.muted?"Mikrofon einschalten":"Stummschalten"}</button>
          <details className={styles.callDigits}><summary>Wahltasten im Gespräch</summary><div className={styles.keypad}>
            {["1","2","3","4","5","6","7","8","9","*","0","#"].map(digit=><button type="button" key={digit} onClick={()=>browserPhone.sendDigits(digit)}>{digit}</button>)}
          </div></details>
          <button type="button" className={styles.button} onClick={()=>void browserPhone.finish()}>Auflegen</button>
        </div> : <button type="button" className={styles.button} disabled={!browserPhone.allowed||browserPhone.working||browserPhone.registered||props.busy}
          onClick={()=>void browserPhone.enable()}>{browserPhone.registered?"Browser bereit":browserPhone.working?"Verbindet …":"Browser-Telefon verbinden"}</button>}
        {browserPhone.error?<p className={styles.searchError} role="alert">{browserPhone.error}</p>:null}
      </section>:null}
      <div className={styles.layout}>
        <aside className={styles.left} aria-label="Kundensuche und Team">
          <div className={styles.panelTabs} aria-label="Telefonbereich">
            <button type="button" aria-pressed={panel === "contacts"} onClick={() => setPanel("contacts")}><Users size={17} />Kunden</button>
            <button type="button" aria-pressed={panel === "dial"} onClick={() => setPanel("dial")}><Grid2X2 size={17} />Wählen</button>
          </div>
          {panel === "contacts" ? <>
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
                query.trim() ? results.length + (nextOffset !== null ? "+ Treffer" : " Treffer") : "Euer Kundenverzeichnis · alphabetisch"}
            </p>
            {error ? <div className={styles.searchError} role="alert">
              <p>{error}</p>
              <button type="button" className={styles.retry} onClick={() => setRetry(value => value + 1)}><RefreshCw size={15} />Erneut versuchen</button>
            </div> : null}
            <div className={styles.results}>
              {results.map(contact => <button type="button" key={contact.customerId}
                className={styles.result + " " + (activeContact?.customerId === contact.customerId ? styles.selected : "")}
                disabled={busy} aria-pressed={activeContact?.customerId === contact.customerId}
                onClick={() => void select(contact)}>
                <span className={styles.contactAvatar}>{initials(contact.company || contact.displayName || "Kontakt")}</span>
                <span className={styles.resultContent}>
                  <strong>{contact.company || contact.displayName || "Kontakt"}</strong>
                  <span>{contact.company && contact.displayName ? contact.displayName + " · " : ""}{contact.phone || "Rufnummer fehlt"}</span>
                  <span>{contact.email || contact.requestTitle || "Kontaktdaten öffnen"}</span>
                </span>
                <ChevronRight size={16} />
              </button>)}
            </div>
            {!loading && !error && !results.length && query.trim().length !== 1 ? <p className={styles.empty}>
              {nextOffset !== null ? "Auf dieser Seite kein passender Kontakt. Weitere Kontakte laden." :
                query.trim() ? "Kein passender Kontakt. Du kannst die Nummer unter „Wählen“ direkt eingeben." : "Noch keine Kontakte vorhanden."}
            </p> : null}
            {nextOffset !== null && !error ? <button type="button" className={styles.loadMore} disabled={loading}
              onClick={() => setOffset(nextOffset)}>Weitere Kontakte laden</button> : null}
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
            {browserPhone.allowed && freeDialPhone && !busy ? <button type="button" className={styles.button+" "+styles.primary+" "+styles.dialAction}
              disabled={busy||!browserPhone.registered} onClick={()=>void browserPhone.dial(activeContact?
                {customerId:activeContact.customerId,requestId:activeContact.requestId}:{phone:freeDialPhone})}>Im Browser anrufen</button>:null}
            {freeDialPhone && !busy ? <a className={styles.button + " " + styles.primary + " " + styles.dialAction}
              href={"tel:" + freeDialPhone} onClick={appNotice}><Phone size={17}/>In Telefon-App anrufen</a> :
              !browserPhone.call ? <button className={styles.button + " " + styles.primary + " " + styles.dialAction} disabled><Phone size={17}/>{busy?"Gespräch aktiv":"Nummer eingeben"}</button>:null}
            {number && !freeDialPhone ? <p className={styles.small}>Bitte eine vollständige Telefonnummer eingeben.</p> : null}
          </section>}
          <div className={styles.providerNote}>
            <Phone size={16}/><p><strong>Telefon-App auf diesem Gerät</strong>Placetel ist noch nicht mit dem CRM verbunden. Annehmen und Übernehmen folgen mit dem Anschluss.</p>
          </div>
          {phoneTeam.length ? <section className={styles.phoneTeam} aria-label="Telefonteam">
            <h3>Dein Team</h3>
            {phoneTeam.map(member=><div className={styles.phoneTeamMember} key={member.id}>
              <span className={styles.contactAvatar}>{initials(member.displayName)}</span>
              <div><strong>{member.displayName}</strong><p className={styles.small}>
                {member.extension?"Nebenstelle "+member.extension+" · ":""}
                {browserPhone.call && member.id===phoneIdentity?.profile?.id?"Im Gespräch":member.presence==="available"?"Bereit":member.presence==="away"?"Abwesend":"Telefon offline"}
              </p></div>
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
          <section className={styles.callhead}>
            <div className={styles.calltitle}>
              <span className={styles.avatar}>
                {customer ? initials(name) : <Phone size={23} />}
              </span>
              <div>
                <h2>{browserPhone.call && !customer ? browserPhone.call.phone : name}</h2>
                <p>
                  {customer
                    ? [
                        customer.displayName,
                        phone || "Rufnummer fehlt",
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : browserPhone.call ? "Freier Anruf · ohne Kundenzuordnung" : "Kontakt auswählen oder links eine Nummer wählen."}
                </p>
              </div>
            </div>
            {activeContact || selected ? (
              <span className={styles.badge}>
                {contextLoading ? "Gesprächsübersicht wird geladen …" : activeContact && !activeContact.requestId ? "Kontakt ohne verknüpften Vorgang" : "Kunde ausgewählt"}
                {selected?.offer ? " · Angebot " + (selected.offer.offerNumber || selected.offer.label) : ""}
              </span>
            ) : null}
            <div className={styles.actions}>
              {browserPhone.allowed && activeContact && dialPhone && !busy ? <button type="button" className={styles.button+" "+styles.primary}
                disabled={busy||!browserPhone.registered} onClick={()=>void browserPhone.dial({customerId:activeContact.customerId,requestId:activeContact.requestId})}>Im Browser anrufen</button>:null}
              {customer && dialPhone && !busy ? (
                <a className={styles.button + " " + styles.primary} href={"tel:" + dialPhone} onClick={appNotice}>
                  <Phone size={17} />In Telefon-App anrufen
                </a>
              ) : customer ? (
                <button className={styles.button + " " + styles.primary} disabled>
                  {busy ? "Gespräch aktiv" : "Rufnummer fehlt"}
                </button>
              ) : null}
              <button
                className={styles.button}
                disabled={busy || contextLoading || Boolean(activeContact && !selected)}
                onClick={() => props.onWorkspaceChange("assist")}
              >
                <Headphones size={17} />
                Gespräch begleiten
              </button>
              <button
                className={styles.button}
                disabled={busy || contextLoading || Boolean(activeContact && !selected)}
                onClick={() => props.onWorkspaceChange("live")}
              >
                <Bot size={18} />
                KI-Sprachtest
              </button>
            </div>
          </section>
          <div className={styles.detailgrid}>
            <section className={styles.conversation} aria-label="Gespräch">
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
                        : selected ? "Letzte Absprachen, Nachrichten und verknüpfte Vorgänge findest du rechts."
                          : "Wähle links einen Kontakt. Hier findest du seine letzten Absprachen, Nachrichten und Vorgänge."}
                    </p>
                  </div>
                  <p className={styles.small}>
                    Transkription und Speicherung: vor Gesprächsbeginn klären.
                  </p>
                </>
              ) : null}
              {props.children}
            </section>
            <aside className={styles.context} aria-label="Kundenübersicht">
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
              <div className={styles.contextgrid}>
                <div>
                  <p className={styles.label}>Kundenübersicht</p>
                  <h3>Zuletzt besprochen</h3>
                  {lastCall ? (
                    <>
                      <p className={styles.small}>
                        {lastCall.startedAt
                          ? new Date(lastCall.startedAt).toLocaleString("de-DE")
                          : "Telefonat"}
                        {lastCall.incomplete
                          ? " · unvollständiges Transkript"
                          : ""}
                      </p>
                      <p>
                        {lastCall.summary ||
                          "Ein Telefontranskript liegt vor. Eine Zusammenfassung wurde noch nicht erstellt."}
                      </p>
                      <a
                        className={styles.link}
                        href={lastCall.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Letztes Telefonat öffnen ↗
                      </a>
                    </>
                  ) : (
                    <p className={styles.small}>
                      {selected
                        ? "Noch kein gespeichertes Telefontranskript zu diesem Vorgang."
                        : "Nach der Kundenauswahl verfügbar."}
                    </p>
                  )}
                  {lastMail ? (
                    <>
                      <h3>Letzte Nachricht</h3>
                      <p>
                        <strong>{lastMail.subject}</strong>
                      </p>
                      <p>
                        {lastMail.preview ||
                          "Kein Nachrichtenauszug verfügbar."}
                      </p>
                      <p className={styles.small}>
                        {lastMail.occurredAt
                          ? new Date(lastMail.occurredAt).toLocaleString(
                              "de-DE",
                            )
                          : ""}
                        {lastMail.scope === "organization"
                          ? " · Firmenkontext, anderer Kontakt"
                          : ""}
                      </p>
                    </>
                  ) : null}
                </div>
                <div>
                  <h3>Direkt zum Vorgang</h3>
                  {selected?.links?.offer ? (
                    <a
                      className={styles.link}
                      href={selected.links.offer}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Angebot {selected.offer?.offerNumber} öffnen ↗
                    </a>
                  ) : (
                    <p className={styles.small}>Kein Angebot verknüpft.</p>
                  )}
                  {selected?.links?.trello ? (
                    <a
                      className={styles.link}
                      href={selected.links.trello}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Trello-Karte öffnen ↗
                    </a>
                  ) : (
                    <p className={styles.small}>
                      Keine Trello-Karte verknüpft.
                    </p>
                  )}
                  {selected?.outlook.length ? (
                    <details>
                      <summary className={styles.link}>
                        Letzte Nachrichten anzeigen
                      </summary>
                      {selected.outlook.map((mail, i) => (
                        <div key={i}>
                          <p>
                            <strong>{mail.subject}</strong>
                          </p>
                          <p>{mail.preview}</p>
                        </div>
                      ))}
                    </details>
                  ) : null}
                  {selected?.request.description ? (
                    <>
                      <h3>Anfrage</h3>
                      <p>{selected.request.description}</p>
                    </>
                  ) : null}
                </div>
              </div>
              {selected ? (
                <div className="mt-7">
                  <VoiceHistoryPanel requestId={selected.requestId} />
                </div>
              ) : null}
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
      <details ref={settingsRef} id="voice-settings" className={styles.admin}>
        <summary>Einstellungen &amp; Wissen</summary>
        <div className="mt-6">{props.settings}</div>
      </details>
    </main>
    </div>
  );
}
