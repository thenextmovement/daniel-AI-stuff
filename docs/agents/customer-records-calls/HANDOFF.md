# Kundenakte und Calls Review - Agent Handoff

Stand: 2026-07-21, verifiziert gegen Ops `origin/main` auf Commit `c76e7e526bf0933b47b1b68936601137f7721309`.

Parent-Agent: `ops-software-agent`

## Evidenzstatus

- `[verifiziert]`: durch aktuellen Code, Git-Historie, lokale Tests oder einen ausdrücklich genannten Read-only-Check belegt.
- `[aus Code abgeleitet]`: belastbare Schlussfolgerung aus dem aktuellen Code, aber kein Beleg für den heutigen Produktionszustand.
- `[historisch]`: im übergebenen Arbeitsverlauf oder in älterer Projektdokumentation berichtet; nicht als aktueller Live-Beleg zu verwenden.
- `[Live-Evidenz fehlt]`: nur durch authentifizierte Read-only-Prüfung externer Systeme feststellbar.
- `[offen]`: fachliche oder technische Entscheidung fehlt.

## Aktueller Befund

- `[verifiziert]` Kundenakte und Calls laufen als geschützte Next.js-Ops-Oberflächen unter `/ops/customer-records` und `/ops/customer-records/calls`.
- `[verifiziert]` Postgres/Supabase ist die operative Wahrheit für Kunden-, Anfrage-, Call-, Aufgaben- und Audit-Zustände. Trello ist Arbeitskontext und Projektion, nicht Wahrheit.
- `[verifiziert]` Die Kundenakte sucht nach Request-ID, exakter E-Mail, Name/Firma, Telefonnummer, ActiveCampaign-Deal und Trello-Karte. Alte Requests können über `master_requests.customer_id` geladen werden, auch wenn `master_customers.request_id` inzwischen auf einen neueren Fall zeigt.
- `[verifiziert]` Die Calls-Liste wird aus frischen Requests, gesendeten Angeboten, Call-Cadence und offenen `sales_tasks` gebildet. Die drei sichtbaren Tabs sind `Neue Anfragen`, `Angebot gesendet` und `Fällige Anrufe`.
- `[verifiziert]` Angebot-Nachfassfälle werden durch `ops_record_offer_sent` idempotent als `call_quote_sent`-Aufgabe und `quote_call`-Cadence in Postgres angelegt. Der aktuelle Code korrigiert veraltete Inquiry-Zustände, wenn inzwischen ein Angebot versendet wurde.
- `[verifiziert]` Call-Ergebnisse werden serverseitig gegen Kontaktstopp, Abschluss/Auftrag, frische Kundenantwort, zukünftigen Rückruf und fehlende Telefonnummer geprüft. Ein optimistischer Schreibschutz verhindert im Normalpfad das Überschreiben eines neueren Ergebnisses.
- `[verifiziert]` Terminale Calls-Presets beenden derzeit Call-Cadence und offene `sales_tasks`, übertragen `Nicht mehr anrufen`, `Kein Interesse` oder `Kauft/Auftrag` aber nicht automatisch in Kontakt-Blacklist, E-Mail-Follow-ups oder kanonischen Workboard-Fallausgang. Das ist ein hoher offener Sicherheits- und Konsistenzpunkt.
- `[verifiziert]` Die KI-Segmentierung wird in der UI als Vorschlag angezeigt. Manuelle Bestätigung setzt deterministisch Segment, Standard-`s_kategorie`, Status, Confidence und Quelle und rollt bei fehlgeschlagenem Audit zurück.
- `[verifiziert]` Der Offers-Editor in der Kundenakte prüft vor dem Versand unter anderem Preisfreigabe, Datensatz-/Angebots-E-Mail, interne oder ungültige Empfänger und verwendet einen Idempotenzschlüssel. Der Versand selbst wird trotzdem mit einem einzelnen Button ohne finale Bestätigung oder Folgenvorschau ausgelöst; nach erfolgreichem Versand können Call-Sync oder Versand-Evidenz getrennt fehlschlagen.
- `[verifiziert]` `Karte duplizieren` kopiert eine Trello-Karte, erzeugt eine neue UUID als Request-ID, legt eine neue `master_requests`-Zeile und eine `call_new_inquiry`-Aufgabe an und stellt den Kunden auf den neuen aktuellen Request um. Der Vorgang hat einen Idempotenzschlüssel.
- `[verifiziert]` Der Duplizierungspfad prüft Titel, Beschreibung, Custom Fields und Attachment-Signaturen. Er beweist keine byte-identischen Anhänge und prüft weitere Trello-Eigenschaften wie Kommentare, Labels, Mitglieder oder Checklisten nicht vollständig.
- `[verifiziert]` 73 fokussierte Tests, TypeScript sowie zwei gemockte Mobile-Smokes sind am Verifikationsstand grün. Der GitHub-Workflow für exakt `c76e7e5` hat vollständige Tests, Typecheck, Build und geschützten Deploy-Smoke erfolgreich abgeschlossen.
- `[Live-Evidenz fehlt]` Keine authentifizierte Produktionsabfrage hat aktuelle Kundenrows, Call-Queues, Segmentierungsjobs, RLS-Policies oder Trello-Kopien bestätigt. Es wurde bewusst keine echte Aktion ausgelöst.

## Einstieg

1. Architektur, Source-of-Truth und Datenflüsse: [SYSTEM-MAP.md](./SYSTEM-MAP.md)
2. Dauerhafte fachliche und technische Entscheidungen: [DECISIONS.md](./DECISIONS.md)
3. Diagnose, sichere Prüfung und Rollback: [OPERATIONS.md](./OPERATIONS.md)
4. Priorisierte Fehler und offene Risiken: [KNOWN-ISSUES.md](./KNOWN-ISSUES.md)
5. Reproduzierbare Belege und Teststand: [VERIFICATION.md](./VERIFICATION.md)
6. Maschinenlesbares Manifest: [agent.json](./agent.json)

## Nicht verhandelbare Grenzen

- Neue Ops-Arbeit beginnt mit `codex-new-worktree ops <topic>`.
- Niemals im alten Checkout `/Users/danielklesse/Desktop/neontrip-ops-coolify` arbeiten oder deployen.
- Vor jedem später ausdrücklich freigegebenen Deploy muss `codex-predeploy ops` laufen. Nur der exakt ausgegebene Commit darf deployt werden.
- Ein Push auf `main` startet `.github/workflows/deploy-coolify.yml` und kann Produktion verändern. Dieses Handoff autorisiert keinen Push.
- Keine produktiven Supabase-, Trello-, n8n-, Offers-, Coolify- oder Kundenkommunikations-Mutationen ohne explizite Freigabe, Backup/Diff und Rollback.
- Keine echte Call-Erfassung, Segmentbestätigung, Kontaktblockade, Fallentscheidung, Kartenkopie oder Sammelaktion zu Testzwecken.
- Keine Secrets lesen, ausgeben oder dokumentieren. Nur Namen erforderlicher Variablen dürfen genannt werden.
- AI schlägt vor; deterministische Logik und ein Mensch entscheiden über operative Wirkung.

## Scope dieser Übergabe

- Enthalten: Kundenakte, Suche, breiter Fallkontext, Segmentbestätigung, direkte Fallaktionen, Call Review/Tagesliste, Call-Cadence, `sales_tasks`, Offer-Sent-Bridge, Trello-Kartenbearbeitung und -duplizierung, Auth-Grenzen, Audit und relevante Tests/Migrationen.
- Nur als Schnittstelle enthalten: Offers-Editor, Outlook-Verlauf, interne Aufgaben und Segmentierungs-n8n. Deren vollständige Eigenlogik gehört in eigene Agentenpakete.
- Ausgeschlossen: Voice Call Platform, Live Voice Copilot, Versand, Wareneingang, Preisprüfung und Sales-Vergabe, außer wo sie Daten in der Kundenakte sichtbar machen.
- Es wurden keine personenbezogenen Einzelfälle oder Live-Daten in das Paket übernommen.
