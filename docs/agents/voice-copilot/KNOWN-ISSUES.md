# Voice Copilot Known Issues

## Blocker fuer Kundenbetrieb

### Kein aktuelles Live-E2E belegt

- `[verifiziert]` Diese Wissensmigration hat absichtlich keine produktiven Tabellen, Flags, Runtime-Healthdaten, Provider, n8n-Executions oder Calls gelesen beziehungsweise veraendert.
- `[offen]` Unbekannt sind daher heutiger Schema-/Flag-Stand, aktive Workflow-Versionen, Runtime-Commit, Provider-Readiness, DNC-/Consent-Datenqualitaet und Stop/Handoff unter echter Telefonie.
- `[offen]` Vor Kundenbetrieb ist ein vollstaendiger, personenbezogen begrenzter Sandbox-E2E mit separaten Freigaben erforderlich.

### Kein Modell besteht das Produktionsgate

- `[verifiziert]` Die gespeicherten textbasierten Runs vom 2026-07-13 endeten mit 39/56 fuer `gpt-realtime-2.1` und 41/56 fuer `gpt-realtime-1.5`; beide `status=failed`, null blockierende Safety-Fehler.
- `[verifiziert]` Die Suite simuliert Dialekt/Laerm nur als Text. Reale Audioqualitaet, Latenz, Barge-in, Telefoncodec, Sprecherwechsel und SIP-Fehler sind nicht bewertet.
- `[offen]` Kein Modell darf fuer Kundenkampagnen promoted werden, bevor alle 56 Szenarien, Audio-/Telefonietests, Tool-/Stop-/Handoff-Pfade und das exakte Zwei-Prompt-Manifest bestehen.

### Juristische und Datenschutzfreigabe fehlt als aktueller Beleg

- `[verifiziert]` `docs/legal/voice-consent-and-disclosure.md` ist ein Engineering-Gate und ausdruecklich keine Rechtsberatung.
- `[offen]` Exakte Checkbox, Datenschutzhinweis, Eingangsbestätigung, gesprochenes Wording, Mitarbeiterregeln, Processor-/Transfer-Setup und Retention wurden hier nicht aktuell juristisch freigegeben.
- `[offen]` Kundenanruf- und Kunden-Live-Copilot-Schalter muessen bis zu dokumentierter Freigabe aus bleiben.

## Prioritaet Hoch

### Aelterer Browser-Sprachagent umgeht Teile der Plattform-Governance

- `[verifiziert]` `VOICE_COPILOT_MODEL` ist dort fest auf `gpt-realtime-2.1` gesetzt; Modell-Registry, Campaign Channel und Model Kill Switch werden nicht verwendet.
- `[verifiziert]` Bei ausgeschaltetem Wissensflag koennen Lead-/Follow-up-Modi mit manuell eingegebenem Kontext starten. Bei eingeschaltetem Flag akzeptieren UI und Session-Schema fuer den direkten Sprachagenten auch `pending` statt zwingend `confirmed`.
- `[verifiziert]` Der Pfad prueft keine Call-Plattform-Kampagne, DNC, Kontaktzeit oder produktive Modellfreigabe. Er waehlt zwar nicht selbst, kann aber als sprechender Kundenpfad missverstanden werden.
- `[offen]` Vor jeder Kundennutzung sperren oder auf dieselben serverseitigen Consent-, Request-, Modell- und Audit-Gates wie die Outbound-Plattform stellen.

### Plattformadministration hat keine feingranulare Ops-Rolle

- `[verifiziert]` `/api/ops/voice-platform` verlangt eine gueltige Ops-Session und leitet den serverseitig ermittelten Actor weiter.
- `[verifiziert]` Es gibt in diesem Pfad keine zusaetzliche Rollen-/Capability-Pruefung fuer Kill Switches, Consent, Allowlist, Kampagnen, Targets, Promptfreigabe, Modellfreigabe oder Rollback.
- `[offen]` Vor breitem Ops-Zugriff least-privilege Rollen fuer Betrieb, Wissen, Modellfreigabe und Kundenanruf-Freigabe einfuehren.

### Auditstatus kann bei Browser-/Live-Sessions hinterherhinken

- `[verifiziert]` `markVoiceSession` und `markSession` protokollieren Fehler beim Wechsel auf `live` beziehungsweise `failed`, lassen die OpenAI-Session aber weiterlaufen beziehungsweise antworten erfolgreich.
- `[aus Git/Code abgeleitet]` Dadurch kann eine aktive Session in Postgres als `created` stehen bleiben, obwohl Audio verarbeitet wird.
- `[offen]` Den Auditwechsel entweder fail-closed machen oder einen dauerhaften Reconcile-Pfad mit Alarmierung implementieren.

## Prioritaet Mittel

### Placetel ist nicht direkt integriert

- `[verifiziert]` Der Live-Copilot nutzt Browser-Screen-/Systemaudio-Sharing fuer Placetel/Webex. Ein direkter Placetel-Live-Media-Stream oder Softphone-Adapter existiert nicht.
- `[aus Git/Code abgeleitet]` Audiofreigabe, Browser/OS-Unterstuetzung, Echo und Headset-Setup bleiben workstationabhaengig.
- `[offen]` Eine spaetere SIP/WebRTC-Softphone-Integration muss dieselben Consent-, Stop- und Nicht-Speicher-Gates erhalten.

### Aktuelle Telefonie ist Twilio-spezifisch

- `[verifiziert]` Ein `TelephonyAdapter` existiert, aber nur `TwilioSipAdapter` ist implementiert. Realtime/Sideband ist direkt OpenAI-spezifisch.
- `[offen]` Ein Anbieterwechsel ist vorbereitet, aber nicht ohne neuen Adapter, Provider-Contract-Tests und Incident-/Idempotenzpruefung fertig.

### Wissenskandidaten-Akteure sind nicht durchgaengig servergebunden

- `[verifiziert]` Wissensversion- und E-Mail-Review kombinieren den authentifizierten Ops-Actor mit dem Operatornamen.
- `[verifiziert]` Candidate-Erstellung und Candidate-Entscheidung akzeptieren `proposedBy` beziehungsweise `reviewer` aus dem Request. Eine Promotion erzeugt nur eine Review-Version, aber die Kandidaten-Auditidentitaet kann ungenau sein.
- `[offen]` Candidate-Routen auf `resolveVoiceCopilotActor` umstellen und Input-Identitaet nur als Anzeigezusatz verwenden.

### Call-Plattform-Konfiguration ist nicht im Ops-Env-Beispiel vollstaendig

- `[verifiziert]` `.env.ops.example` dokumentiert Browser-/Live-Copilot-Variablen, nicht die gesamte `VOICE_CALL_PLATFORM_ENABLED`-/Runtime-Verkabelung.
- `[verifiziert]` Die Namen stehen in `docs/operations/voice-call-platform.md` und `services/voice-runtime/README.md`.
- `[offen]` Kanonische, wertfreie Env-Templates fuer Ops und den separaten Runtime-Service ergaenzen.

### Offer-/Outlook-Kontext bleibt bei fehlender Evidenz bewusst unvollstaendig

- `[verifiziert]` Offer-Binding lehnt Konflikte ab und kann `not_linked` oder `unavailable` liefern. Das ist sicherer als ein falscher Cross-Customer-Match.
- `[verifiziert]` Outlook unterscheidet `empty` und `unavailable`; Organisationsdomain-Treffer werden nur bei fehlenden direkten Nachrichten genutzt und gekennzeichnet.
- `[offen]` Produktive Spiegel-/Graph-Vollstaendigkeit und Aliasqualitaet muessen beobachtbar sein; niemals per freier Firmen-/Namensaehnlichkeit erzwingen.

### Statische n8n-Dateien beweisen keinen Laufzeitstatus

- `[verifiziert]` Repo-Drafts und Manifest stehen auf inaktiv, enthalten aber IDs einer frueher angelegten Instanz.
- `[nur aus Thread erinnert]` Separate Outlook-Sync-/Backfill-Arbeit wurde als erfolgt berichtet; sie gehoert nicht zu den drei Voice-Workflows und wurde hier nicht erneut geprueft.
- `[offen]` Vor jeder n8n-Aktion aktiven Export, Diff, Credential-Referenzen, Error-Workflow und Rollback read-only erfassen.

### Deklariertes Parent-Paket ist im Basis-Commit noch nicht vorhanden

- `[verifiziert]` `agent.json` bindet den Voice-Agenten wie beauftragt an `customer-communication-agent`.
- `[verifiziert]` Unter `docs/agents/` existiert auf Basis-Commit `c76e7e5` noch kein Paket `customer-communication-agent`.
- `[offen]` Der Control-Tower-Merge muss das Parent-Paket vor oder zusammen mit diesem Handoff bereitstellen und die Agent-ID exakt abgleichen.

## Bewusst nicht implementiert

- `[verifiziert]` Keine dauerhafte Audioaufzeichnung oder Rohtranskriptspeicherung.
- `[verifiziert]` Keine automatische Wissensfreigabe aus Gespraechen.
- `[verifiziert]` Keine Preis-/Offer-Aenderung, Bestellung oder E-Mail aus Voice-Tools.
- `[verifiziert]` Keine autonome Control-Tower-Planung (`schedule_supported=false`).
- `[verifiziert]` Keine Nutzung des Payment-Reminder-Workflows fuer Lead-/Follow-up-Calls.
