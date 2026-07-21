# Voice Copilot Decisions

## Dauerhafte Entscheidungen

| Entscheidung | Status | Konsequenz |
| --- | --- | --- |
| Nur Erstkontakt nach konkreter Anfrage und Offer-Follow-up sind erlaubt. | `[verifiziert]` | Keine Kaltakquise, gekauften/importierten Listen oder Payment-Reminder-Calls. |
| Postgres/Supabase ist Source of Truth. | `[verifiziert]` | Trello und n8n duerfen weder Berechtigung noch fachlichen Zustand bestimmen. |
| n8n ist Dispatcher/Ergebnisverarbeiter, nicht Audio-Runtime. | `[verifiziert]` | Langlebige SIP-, WebSocket- und Tool-Kontrolle liegt im Runtime-Service. |
| Telefonie, OpenAI und Geschaeftslogik sind getrennt. | `[verifiziert]` | Aktuell existieren Twilio-SIP-, OpenAI-Realtime- und Ops-Adapter; Vapi ist keine Pflichtabhaengigkeit. |
| Modellwahl ist fuer Outbound-Calls registriert und auditierbar. | `[verifiziert]` | Candidate, Production und Rollback werden in Postgres mit Modell-ID, API/Transport, Stimme, Config, Capabilities, Prompt-Manifest und Eval gespeichert. |
| Ein ChatGPT-Produktname ist keine API-Modell-ID. | `[verifiziert]` | Ein spaeteres "GPT Live 1" wird erst mit offizieller exakter API-ID registriert, vertraglich geprueft, evaluiert und freigegeben. |
| Anfrage ist notwendig, aber nicht gleich Einwilligung. | `[verifiziert]` | Consent muss Request, Nummer, Zweck, Wortlaut, Version, Quelle, Quellreferenz und Zeitpunkt exakt binden. |
| Offenlegung erfolgt frueh, aber nicht als erste Worte. | `[verifiziert]` | NEONTRIP und Anlass zuerst, dann Verfuegbarkeitsfrage und noch im selben ersten Sprechzug die KI-Offenlegung vor Sachgespraech. |
| Der Agent darf keinen Menschen vortaeuschen. | `[verifiziert]` | Auf direkte Nachfrage muss er sofort wahrheitsgemaess antworten. |
| Wissen ist human-gated. | `[verifiziert]` | KI- oder Mitarbeitererkenntnisse werden Kandidat beziehungsweise Review-Version, niemals automatisch freigegeben. |
| Kunden-/Offer-/Outlook-Text ist untrusted input. | `[verifiziert]` | Prompt Injection wird ignoriert; fremde Kunden duerfen nicht gesucht oder offengelegt werden. |
| Audio und Rohtranskript werden nicht dauerhaft gespeichert. | `[verifiziert]` | Nur strukturierte Outcomes, kurze Zusammenfassungen und erforderliche Audit-Metadaten bleiben. |
| Live-Copilot ist still und ohne Side Effects. | `[verifiziert]` | Er zeigt dem Mitarbeiter Vorschlaege, spricht aber nicht, waehlt nicht und sendet nichts. |
| Unsicherer Provider-Create wird nicht wiederholt. | `[verifiziert]` | Manuelle Provider-Reconciliation hat Vorrang vor dem Risiko eines Doppelanrufs. |
| Stop und menschliche Uebergabe sind Kernfunktionen. | `[verifiziert]` | Operator und Kunde koennen den Agenten stoppen; DNC und strukturierte Finalisierung werden persistiert. |
| Aktivierung und Kommunikation sind separate Freigaben. | `[verifiziert]` | Push/Deploy, Flag, Modell, Workflow und einzelner realer Testcall duerfen nicht zu einer Sammelfreigabe zusammengezogen werden. |

## Relevante Git-Historie

| Commit | Befund |
| --- | --- |
| `2ffb65e` | `[verifiziert]` Browserbasierter Voice-Copilot-MVP und Ops-Navigation. |
| `24ca8fd` | `[verifiziert]` Geprueftes Wissen, Kundenbindung, Post-Call-Kandidaten und private Migration. |
| `fe38b9d` | `[verifiziert]` Governed Call-Plattform, Runtime, Migration, drei inaktive n8n-Workflows, Evals und Runbooks. |
| `1cf0f01`, `be6c844`, `55bc15d`, `5e6696e`, `f77302f` | `[verifiziert]` Safety-Gates, isolierter Sandboxpfad, Provider-Readiness, Setup- und Prompt-Approval-Fixes. |
| `4115b91` | `[verifiziert]` Voice nutzt die vorhandenen serverseitigen OpenAI-Konfigurationsaliase. |
| `96cfc10` | `[verifiziert]` Stiller Live-Copilot mit zwei Audio-/Transkriptionspfaden und Vorschlaegen. |
| `879ff45`, `afb65c9`, `19ba4e4` | `[verifiziert]` Offer-Bindung, dedizierter Outlook-Kontext und requestgebundene Trello-Aliase. |
| `9e8ad10` | `[verifiziert]` Spaetere gemeinsame Voice-/E-Mail-Wissenspruefung und servergebundener Review-Audit. |

## Historische Thread-Entscheidungen

- `[nur aus Thread erinnert]` Der Wunsch war, den gesamten Apparat vor einer spaeteren oeffentlichen "GPT Live 1"-API vorzubereiten und dann moeglichst ohne Geschaeftsprozess-Codewechsel umzuschalten.
- `[nur aus Thread erinnert]` Ein Browser-Realtime-Test wurde als brauchbar, aber nicht gleichwertig mit dem gewuenschten ChatGPT-Live-Erlebnis bewertet.
- `[nur aus Thread erinnert]` Die Wissens- und OpenAI-Konfiguration sowie mehrere Kontextfixes wurden als deployed berichtet. Das ist kein aktueller Live-Nachweis.
- `[nur aus Thread erinnert]` Nach Offer-/Outlook-Fixes zeigte ein damaliger, personenbezogen bereinigter UI-Spotcheck Request, Angebot und zwei Outlook-Nachrichten. Der heutige Datenbestand wurde nicht geprueft.
- `[nur aus Thread erinnert]` Ein Outlook-n8n-Sync und Backfill wurden bearbeitet. Aktiver Workflow, Backfill-Vollstaendigkeit und aktuelle Credentials wurden in diesem Handoff nicht erneut geprueft.
- `[nur aus Thread erinnert]` Eine dauerhafte Gespraechstranskription als Wissensquelle wurde diskutiert und anschliessend fuer die Testphase bewusst vertagt. Der aktuelle Code speichert weiterhin kein Rohtranskript.

## Nicht getroffene oder offene Entscheidungen

- `[offen]` Exakte juristische Freigabe von Formular, Eingangsbestätigung, gesprochenem Hinweis, Datenschutz-/Processor-Setup, Mitarbeiterregeln und Aufbewahrung fuer Kundenbetrieb.
- `[offen]` Exakte oeffentliche API-ID und Vertragsfaehigkeit des intern "GPT Live 1" genannten Modells.
- `[offen]` Produktionsanbieter fuer Telefonie: Der Code nutzt Twilio/SIP; Placetel ist im Live-Copilot nur Desktop-Audioquelle.
- `[offen]` Rollenmodell fuer Plattformadministration und Wissenstrias ausserhalb einer allgemeinen Ops-Session.
- `[offen]` Ob und wie spaeter Audio oder Rohtranskripte gespeichert werden. Das waere eine neue Datenschutz-, Retention-, Sicherheits- und Freigabeentscheidung.
- `[offen]` Produktive Aktivierung der drei n8n-Workflows, der Runtime und der Kundenanrufschalter.
