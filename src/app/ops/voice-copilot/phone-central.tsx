"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Search, Phone, Headphones, ChevronRight, Bot } from "lucide-react";
import type { VoiceCopilotSuggestion } from "@/lib/ops/voice-copilot";
import type { VoiceCustomerContext } from "@/lib/ops/voice-knowledge";
import { VoiceHistoryPanel } from "./voice-history-panel";
import styles from "./phone-central.module.css";

type CustomerResult = {
  requestId: string;
  displayName: string | null;
  company: string | null;
  email?: string | null;
  phone?: string | null;
  offerNumber?: string | null;
  requestTitle: string | null;
};
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
  const { selected, busy } = props;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [device, setDevice] = useState("app");
  const [notice, setNotice] = useState("");
  const selection = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          "/api/ops/voice-copilot/context?query=" +
            encodeURIComponent(query.trim()),
          { cache: "no-store", signal: controller.signal },
        );
        const data = await response.json();
        if (!response.ok)
          throw new Error("Die Kundensuche ist gerade nicht erreichbar.");
        setResults(data.results || []);
        setError("");
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Suche fehlgeschlagen.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);
  async function select(requestId: string) {
    if (busy) return;
    const current = ++selection.current;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        "/api/ops/voice-copilot/context?requestId=" +
          encodeURIComponent(requestId),
        { cache: "no-store" },
      );
      const data = await response.json();
      if (current !== selection.current) return;
      if (!response.ok || !data.context)
        throw new Error("Kundenübersicht konnte nicht geladen werden.");
      props.onSelect(data.context);
      setNotice("");
    } catch (e) {
      if (current === selection.current)
        setError(e instanceof Error ? e.message : "Kunde nicht erreichbar.");
    } finally {
      if (current === selection.current) setLoading(false);
    }
  }
  const name =
    selected?.customer.company ||
    selected?.customer.displayName ||
    "Kunden auswählen";
  const phone = selected?.customer.phone || "";
  const dialPhone = phone.replace(/[\s()/.-]/g, "");
  const dialable = /^\+?\d{6,15}$/.test(dialPhone);
  const lastCall = selected?.recentCalls?.[0];
  const lastMail = selected?.outlook[0];
  return (
    <main className={styles.shell}>
      <header className={styles.top}>
        <a className={styles.brand} href="/ops">
          NEONTRIP
        </a>
        <span className={styles.breadcrumb}>Ops / Telefonzentrale</span>
        <span className={styles.spacer} />
        <a className={styles.small} href="#voice-settings">
          Einstellungen
        </a>
      </header>
      <div className={styles.titlebar}>
        <h1>Telefonzentrale</h1>
        <span className={styles.spacer} />
        <label
          className={styles.tone}
          title="Verfügbar, sobald eingehende Anrufe angebunden sind."
        >
          <input type="checkbox" disabled />
          Klingelton
        </label>
        <label>
          <span className="sr-only">Mitarbeiter</span>
          <input
            className={styles.device}
            value={props.operatorName}
            disabled={busy}
            placeholder="Dein Name"
            onChange={(e) => props.onOperatorNameChange(e.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Telefonieren über</span>
          <select
            className={styles.device}
            value={device}
            disabled={busy}
            onChange={(e) => setDevice(e.target.value)}
          >
            <option value="app">Telefon-App / Handy</option>
            <option value="browser">Browser · in Einrichtung</option>
          </select>
        </label>
      </div>
      <div className={styles.connection} role="status">
        <Headphones size={25} />
        <div>
          <strong>
            {busy
              ? "Gesprächsbegleitung aktiv"
              : "Telefonanschluss wird eingerichtet"}
          </strong>
          <p>
            {busy
              ? props.status
              : "Kunden finden und Gesprächsverlauf öffnen. Annehmen und Übernehmen werden mit dem Telefonanschluss verbunden."}
          </p>
        </div>
      </div>
      <div className={styles.layout}>
        <aside className={styles.left} aria-label="Kundensuche und Team">
          <div className={styles.sectionhead}>
            <h2>Kunden finden</h2>
          </div>
          <label className={styles.search}>
            <Search size={21} />
            <input
              aria-label="Kunden suchen"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, E-Mail, Telefon …"
            />
          </label>
          <p className={styles.small}>
            Auch über eine Angebotsnummer auffindbar.
          </p>
          <p className={styles.small} role="status">
            {loading
              ? "Suche läuft …"
              : query.trim().length >= 2
                ? results.length + " Treffer"
                : "Mindestens zwei Zeichen eingeben."}
          </p>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <div className={styles.results}>
            {results.map((customer) => (
              <button
                key={customer.requestId}
                className={
                  styles.result +
                  " " +
                  (selected?.requestId === customer.requestId
                    ? styles.selected
                    : "")
                }
                disabled={busy}
                onClick={() => void select(customer.requestId)}
              >
                <strong>
                  {customer.company || customer.displayName || "Kontakt"}
                </strong>
                <span>
                  {customer.company ? customer.displayName + " · " : ""}
                  {customer.phone || "Keine Telefonnummer hinterlegt"}
                </span>
                <span>{customer.email}</span>
                <div className={styles.meta}>
                  {customer.offerNumber
                    ? "Angebot " + customer.offerNumber
                    : customer.requestTitle || "Kundenanfrage"}
                </div>
              </button>
            ))}
          </div>
          {!loading && query.trim().length >= 2 && !results.length && !error ? (
            <p className={styles.empty}>
              Kein Treffer. Versuche einen Namen, eine E-Mail-Adresse oder die
              vollständige Telefonnummer.
            </p>
          ) : null}
          <section className={styles.team}>
            <div className={styles.sectionhead}>
              <h3>Live im Team</h3>
            </div>
            {busy ? (
              <div className={styles.livecall}>
                <span className={styles.avatar}>
                  {props.workspace === "live"
                    ? "KI"
                    : initials(props.operatorName || "Du")}
                </span>
                <div>
                  <strong>{name}</strong>
                  <div className={styles.small}>{props.status}</div>
                </div>
                <ChevronRight size={19} />
              </div>
            ) : (
              <p className={styles.small}>
                Die Team-Anrufanzeige wird mit dem Telefonanschluss verbunden.
              </p>
            )}
          </section>
        </aside>
        <div>
          <section className={styles.callhead}>
            <div className={styles.calltitle}>
              <span className={styles.avatar}>
                {selected ? initials(name) : <Phone size={23} />}
              </span>
              <div>
                <h2>{name}</h2>
                <p>
                  {selected
                    ? [
                        selected.customer.displayName,
                        phone || "Rufnummer fehlt",
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : "Suche links nach einem Kunden."}
                </p>
              </div>
            </div>
            {selected ? (
              <span className={styles.badge}>
                Kunde ausgewählt
                {selected.offer
                  ? " · Angebot " +
                    (selected.offer.offerNumber || selected.offer.label)
                  : ""}
              </span>
            ) : null}
            <div className={styles.actions}>
              {selected && dialable && device === "app" && !busy ? (
                <a
                  className={styles.button + " " + styles.primary}
                  href={"tel:" + dialPhone}
                  onClick={() =>
                    setNotice(
                      "Die Telefon-App öffnet sich. Ein Anruf außerhalb des Browsers wird erst nach Anschluss der Telefonanlage automatisch mitgeschrieben.",
                    )
                  }
                >
                  <Phone size={17} />
                  Anrufen
                </a>
              ) : (
                <button
                  className={styles.button + " " + styles.primary}
                  disabled
                >
                  {!selected
                    ? "Kunden auswählen"
                    : !dialable
                      ? "Rufnummer fehlt"
                      : "Browser-Anruf noch nicht verbunden"}
                </button>
              )}
              <button
                className={styles.button}
                disabled={busy}
                onClick={() => props.onWorkspaceChange("assist")}
              >
                <Headphones size={17} />
                Gespräch begleiten
              </button>
              <button
                className={styles.button}
                disabled={busy}
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
                      {selected
                        ? "Die Kundenübersicht ist bereit."
                        : "Wähle einen Kunden aus der Suche."}
                    </p>
                    <p className={styles.small}>
                      Angebot, letzte Nachrichten und Telefontranskripte stehen
                      direkt daneben.
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
              {props.hints.length ? (
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
                  <strong>Hinweise während des Gesprächs</strong>
                  <p>
                    Der Copilot gleicht Kundenwünsche mit eurem freigegebenen
                    Wissen ab. Hinweise und Quellen erscheinen hier.
                  </p>
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
      <details id="voice-settings" className={styles.admin}>
        <summary>Einstellungen &amp; Wissen</summary>
        <div className="mt-6">{props.settings}</div>
      </details>
    </main>
  );
}
