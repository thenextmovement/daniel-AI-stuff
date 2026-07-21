# Voice Copilot Agent Handoff

Stand: 2026-07-21, verifiziert gegen Ops `origin/main` auf Commit `c76e7e526bf0933b47b1b68936601137f7721309`.

Parent-Agent: `customer-communication-agent`.

## Evidenzstatus

- `[verifiziert]`: durch aktuellen Repository-Code, Git-Historie oder einen in [VERIFICATION.md](./VERIFICATION.md) protokollierten lokalen Test belegt.
- `[aus Git/Code abgeleitet]`: belastbare Schlussfolgerung aus statischen Artefakten, aber kein Beleg fuer den heutigen Produktionszustand.
- `[nur aus Thread erinnert]`: im relevanten Arbeitschat berichtet, in dieser Wissensmigration aber nicht erneut live bestaetigt.
- `[offen]`: nicht belegt, widerspruechlich oder vor Nutzung noch freizugeben.

## Kanonischer Befund

- `[verifiziert]` Der Bereich besteht aus drei getrennten Pfaden: direkter Browser-Sprachagent, stiller Live-Copilot fuer einen menschlichen Mitarbeiter und modellunabhaengige Outbound-Call-Plattform.
- `[verifiziert]` Nur die Outbound-Plattform waehlt Telefonnummern. Sie verwendet Postgres fuer Einwilligung, DNC, Kampagnen, atomare Reservierung, Attempts, Ereignisse, Ergebnisse, Prompt-Versionen und Modell-Releases.
- `[verifiziert]` Der langlebige Runtime-Service verwendet aktuell einen `TelephonyAdapter` mit Twilio/SIP sowie OpenAI Realtime mit serverseitigem Sideband-WebSocket. n8n haelt keine Audioverbindung und ist nicht Source of Truth.
- `[verifiziert]` Der Live-Copilot spricht nicht mit dem Kunden. Er verarbeitet getrennte Kunden- und Mitarbeiter-Audiospuren, zeigt fluechtige Transkripte und maximal drei validierte Antwort-, Frage- oder Warnvorschlaege.
- `[verifiziert]` Kunden-, Offer- und Outlook-Kontext ist serverseitig an eine exakte `request_id` gebunden. Trello dient dabei nur als Alias-/Projektionshilfe und nicht als Faktenautoritaet.
- `[verifiziert]` Wissen durchlaeuft `draft -> review -> approved -> retired`. Nur freigegebenes, gueltiges, moduspassendes und nicht eingeschraenktes Wissen ist abrufbar. KI-extrahierte Erkenntnisse bleiben Kandidaten und werden nicht automatisch publiziert.
- `[verifiziert]` Audioaufzeichnung und dauerhafte Rohtranskripte sind in allen dokumentierten Pfaden standardmaessig deaktiviert. Gespeichert werden strukturierte Ergebnisse, kurze Zusammenfassungen und Audit-Metadaten.
- `[verifiziert]` Die statischen n8n-Artefakte fuer Dispatcher, Outcome und Fehlerbehandlung stehen auf `active:false`. Das belegt nicht den Zustand einer extern importierten Instanz.
- `[verifiziert]` Die vorhandenen textbasierten Modell-Evals sind fuer Produktion nicht bestanden: `gpt-realtime-2.1` 39/56 und `gpt-realtime-1.5` 41/56, jeweils ohne blockierenden Safety-Fehler. Kein Release ist dadurch produktionsfreigegeben.
- `[offen]` Migrationen, Feature-Flags, Runtime-Provider, n8n-Aktivierungszustand, Modell-Lifecycle und Live-Gesundheit wurden in dieser reinen Wissensmigration absichtlich nicht gegen Produktion geprueft.

## Anruf- und Kommunikationsfreigaben

Diese Regeln sind nicht durch eine allgemeine Projekt-, Push- oder Deploy-Freigabe ersetzbar:

1. `[verifiziert]` Kein echter Anruf ohne Freigabe fuer genau diesen Anruftyp und, bei Tests, genau die freigegebene Allowlist-Nummer. Eine fruehere Testfreigabe ist nicht automatisch wiederverwendbar.
2. `[verifiziert]` Interne Testcalls brauchen `internal-test:<uuid>`, eine aktive Allowlist-Zeile, dokumentierte Quelle `internal_test_authorization`, eine Allowlist-Kampagne und die separaten Plattform-/Internal-Kill-Switches.
3. `[verifiziert]` Kundenanrufe brauchen eine aktive konkrete Anfrage, exakte Kontakt-/Request-Zuordnung, zweckpassende dokumentierte Einwilligung, keinen Widerruf/DNC, erlaubte Kontaktzeit und Versuchsgrenze, freigegebenen Prompt, bestandenes Produktionsmodell sowie den separat bestaetigten Kunden-Kill-Switch.
4. `[verifiziert]` Die Plattform-Einwilligung speichert Wortlaut, Formularversion, Zeitpunkt, Quelle, Quellreferenz, Zweck, Request und Telefonbindung. Eine Anfrage allein gilt im Code und in der Rechtsdokumentation nicht als Einwilligung.
5. `[verifiziert]` Der erste Sprechzug beginnt nicht mit "Ich bin eine KI". Er nennt NEONTRIP und den konkreten Anlass, fragt kurz, ob es passt, und legt noch im selben ersten Sprechzug als KI-gestuetzter digitaler Telefonassistent offen, bevor Qualifikation oder Follow-up beginnen.
6. `[verifiziert]` Widerruf oder Stop beendet die Verkaufsfragen, fuehrt zu `do_not_call`, legt einen DNC-Eintrag an und stoppt aktive beziehungsweise blockiert offene Targets. Stop-Fehler duerfen nicht verborgen werden.
7. `[verifiziert]` Der Voice-Agent darf keine Preise, Rabatte, Liefertermine, Produktionsstarts, Bestellungen, Angebotsaenderungen, Rechtsaussagen, Zahlungsforderungen oder verbindlichen Zusagen ausloesen.
8. `[verifiziert]` Kein Voice-Pfad versendet E-Mails. Jede spaetere E-Mail, Nachricht oder andere Kundenkommunikation bleibt ein eigener, validierter und menschlich freigegebener Vorgang des Parent-Agenten.
9. `[verifiziert]` Live-Transkription im Mitarbeiter-Copilot startet fuer Kundenmodi erst nach aktiver, informierter Einwilligung; bei Widerruf muss der Operator sofort stoppen und ohne Copilot fortfahren.
10. `[verifiziert]` Push, Deploy, Migration, Feature-Flag-Aenderung, Modellfreigabe, n8n-Aktivierung, bezahlte Live-Eval und echter Testanruf sind jeweils eigene Freigabeereignisse.

## Einstieg

1. Architektur, Grenzen und Datenfluss: [SYSTEM-MAP.md](./SYSTEM-MAP.md)
2. Dauerhafte und historische Entscheidungen: [DECISIONS.md](./DECISIONS.md)
3. Diagnose, Freigabematrix und Rollback: [OPERATIONS.md](./OPERATIONS.md)
4. Priorisierte Risiken und fehlende Evidenz: [KNOWN-ISSUES.md](./KNOWN-ISSUES.md)
5. Gepruefte Dateien, Tests und Scorecard: [VERIFICATION.md](./VERIFICATION.md)
6. Maschinenlesbares Manifest: [agent.json](./agent.json)

## Scope und Grenzen

- `[verifiziert]` Im Scope: `/ops/voice-copilot`, Voice-APIs, Wissenssystem, Kunden-/Offer-/Outlook-Kontext, Voice-Runtime, Voice-Migrationen/Rollbacks, Voice-Evals, statische n8n-Voice-Artefakte und die angrenzende manuelle Callliste als Integrationsgrenze.
- `[verifiziert]` Nicht im Scope: Payment Reminder, allgemeiner E-Mail-Agent, produktive Placetel-/Twilio-/OpenAI-/n8n-Konfiguration, reale Calls, Deployments oder Datenmigrationen.
- `[verifiziert]` Dieses Paket enthaelt keine Telefonnummern, Kundennamen, Request-IDs, E-Mail-Adressen, Tokens oder andere Live-Datensaetze.
- `[verifiziert]` `schedule_supported` ist im Manifest `false`: Der Control-Tower-Agent darf keine autonomen Zeitplaene, Kampagnenaktivierungen oder Kommunikationsjobs ausfuehren. Produktseitige Call-Zeitfenster bleiben davon getrennt.
