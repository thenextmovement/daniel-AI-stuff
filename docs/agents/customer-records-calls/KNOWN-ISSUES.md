# Kundenakte und Calls Review - Known Issues

## Priorität Hoch

### Terminale Call-Ergebnisse schließen Customer-Ops-Folgen nicht

- `[verifiziert]` `do-not-call`, `not-interested` und `bought` setzen eine terminale Call-Cadence und schließen offene `sales_tasks`.
- `[verifiziert]` Der Calls-Pfad ruft weder `blockCustomerContact` noch `pausePendingCustomerFollowups` oder `applyCustomerCaseOutcome` auf.
- `[Risiko]` Ein Fall kann aus der Call-Liste verschwinden, während E-Mail-Follow-ups weiterlaufen, die E-Mail nicht in `followup_blacklist` steht oder der Workboard-Ausgang offen bleibt.
- `[verifiziert]` Ergebnis-Insert/Supersede ist im RPC atomar, Audit, Cadence und Task-Sync laufen danach als getrennte Writes. Ein später Fehler kann Ergebnis und Folgezustand auseinanderlaufen lassen.
- `[erforderlich]` Terminale Presets über eine atomare, idempotente Customer-Ops-RPC beziehungsweise einen wiederaufnehmbaren Action-Run führen. `do-not-call` muss Kontaktstopp und alle Kommunikations-Follow-ups schließen; `not-interested` und `bought` brauchen den festgelegten Fallausgang.

### Call-Basisschema ist im aktuellen Repository nicht vollständig reproduzierbar

- `[verifiziert]` Der Code und spätere Migrationen setzen `sales_call_runs`, `sales_call_list_items`, `sales_call_results` und `sales_call_cadence_state` voraus.
- `[verifiziert]` Die historische Doku verweist für die Basismigrationen `202605210001` bis `202605210004` auf absolute Pfade in einem anderen alten Projektordner. Diese Dateien liegen nicht unter den aktuellen `supabase/migrations`.
- `[verifiziert]` `202605290001_harden_sales_call_ops.sql` referenziert vorhandene Call-Tabellen, legt sie aber nicht an.
- `[verifiziert]` Das Repository enthält keine sichtbare RLS-/Grant-Definition für die Call-Basistabellen; nur RPC-Rechte sowie RLS für `sales_tasks`/`ops_offer_events` sind versioniert.
- `[Risiko]` Clean Bootstrap, Disaster Recovery, Schema-Diff und RLS-Audit sind aus diesem Repository allein nicht belastbar.
- `[erforderlich]` Aktuelles Live-Schema read-only inventarisieren, historische Migrationen prüfen, kanonische Basismigrationen plus Rollbacks/RLS versionieren und auf einer isolierten Datenbank testen.

### Destruktive Einzelaktionen haben nicht durchgehend eine zweite Bestätigung

- `[verifiziert]` Die Quick Action `Kein Kontakt mehr` ruft direkt `block_customer_contact` auf.
- `[verifiziert]` Primäre Aktionen können `Gewonnen`, Follow-up-Verschiebung oder Sales-Recovery direkt auslösen.
- `[verifiziert]` Batch-Aktionen haben eine Vorschau; einzelne Direktaktionen verwenden diesen Vertrag nicht durchgehend.
- `[Risiko]` Ein Fehlklick kann Follow-ups abbrechen, den Kontakt blacklisten oder einen Fallabschluss setzen.
- `[erforderlich]` Gemeinsamen Confirm-Dialog mit Fall, Wirkung, betroffenen Rows und explizitem Verb einführen; Komponententest/Playwright für Bestätigen und Abbrechen.

### Angebotsmail wird ohne finales Versand-Gate ausgelöst

- `[verifiziert]` `Aktualisiertes Angebot senden` ruft den Versand direkt aus dem Offers-Editor auf; ein Confirm-Dialog oder eine finale Empfänger-/CC-/Betreff-Vorschau ist nicht vorhanden.
- `[verifiziert]` Die API blockiert fehlende Design-Preisfreigabe, Datensatz-/Angebots-E-Mail-Abweichung, interne, Platzhalter- und syntaktisch ungültige Hauptempfänger und gibt einen Idempotenzschlüssel an Offers weiter.
- `[verifiziert]` Nach erfolgreichem E-Mail-Versand werden Call-Sync und `quote_email_log`-Evidenz separat geschrieben. Diese Schritte können fehlschlagen, obwohl die Kundenkommunikation bereits erfolgt ist; die UI weist nur auf einen fehlgeschlagenen Call-Sync hin.
- `[Risiko]` Ein Fehlklick kann echte Kundenkommunikation auslösen. Ein Teilfehler kann zudem Versand, Call-Stufe und Evidenz auseinanderlaufen lassen, ohne dass alle Abweichungen sichtbar werden.
- `[erforderlich]` Finalen Confirm-Schritt mit Empfänger, CC, Betreff, Angebots-ID und Wirkung einführen; serverseitig kurzlebigen Prüfbeleg oder gleichwertigen Guard validieren und Post-Send-Side-Effects über Outbox/Action-Run zuverlässig nachführen.

### Zusammengesetzte Fallaktionen sind nicht atomar

- `[verifiziert]` `startCustomerSalesRecovery` verkettet Rückruf, Workboard-Snooze und Audit.
- `[verifiziert]` `applyCustomerCaseOutcome` verkettet je nach Ausgang Follow-up, Callback/Kontaktstopp und Workboard-Zustand.
- `[verifiziert]` Die inneren Aktionen kompensieren ihre eigenen Writes, aber die Gesamtverkettung hat keine gemeinsame Transaktion oder Action-Run-Wiederaufnahme.
- `[Risiko]` Ein Zwischenfehler kann einen fachlich widersprüchlichen Teilzustand hinterlassen.
- `[erforderlich]` Atomare RPC oder persistenter Action-Run mit Schritten, Idempotenz, Resume und explizitem Rollback.

### Trello-Duplizierung kann nach DB-Insert partiell bleiben

- `[verifiziert]` Automatisches Archiv-Rollback der neuen Trello-Karte läuft nur, solange `requestInserted === false`.
- `[verifiziert]` Scheitert danach der Kundenzeiger oder das finale Reload, bleiben neue Karte und Request bestehen; Task/Audit sind best effort und dürfen fehlen.
- `[Risiko]` Neuer Request, aktueller Kundenzeiger, Task und Audit können auseinanderlaufen.
- `[erforderlich]` Persistenten Duplizierungs-Action-Run/Outbox einführen und jeden Schritt idempotent wiederaufnehmbar machen.

### „Identische“ Trello-Kopie ist nur teilweise bewiesen

- `[verifiziert]` Der Code prüft Titel, Beschreibung, Custom-Field-Werte und Attachments über `Name|MIME-Type`.
- `[verifiziert]` Binärinhalt/Hash der Anhänge, Labels, Checklisten, Mitglieder, Fälligkeit und Kommentare werden nicht verifiziert.
- `[aus Code abgeleitet]` `keepFromSource=all` delegiert den Kopierumfang an Trello, ersetzt aber keinen vollständigen Gleichheitsbeleg.
- `[erforderlich]` Fachlichen Identitätsvertrag festlegen und alle verpflichtenden Felder/Assets mit stabilen IDs oder Hashes prüfen.

## Priorität Mittel

### Call-Ergebnis-Fallback ist schwächer als die RPC

- `[verifiziert]` Die RPC serialisiert pro Request mit Advisory Lock und prüft `expectedLatestResultId` atomar.
- `[verifiziert]` Wenn die RPC fehlt, liest der REST-Fallback zuerst und schreibt danach getrennt.
- `[Risiko]` Zwei parallele Fallback-Schreiber können denselben alten Stand akzeptieren und konkurrierende Rows anlegen.
- `[erforderlich]` In Production fail-closed bei fehlender RPC oder vollständige Gleichwertigkeit über DB-Constraint/RPC herstellen.

### Refresh-Lock kann bei fehlender RPC übersprungen werden

- `[verifiziert]` Fehlt `ops_claim_refresh_lock` oder die Lock-Tabelle, läuft Refresh weiter.
- `[Risiko]` Parallele Refreshes können mehrere Tagesläufe und doppelte Sync-Arbeit erzeugen.
- `[erforderlich]` Production-Schema-Gate und fail-closed; Preview darf read-only bleiben, persistenter Refresh nicht.

### Degraded-Text und tatsächlicher letzter Stand sind nicht deckungsgleich

- `[verifiziert]` Die API-Warnung sagt, der „zuletzt bekannte Stand bleibt sichtbar“.
- `[verifiziert]` Bei vollständigem GET-Fehler liefert `buildFailedSalesCallModuleState` eine leere Liste; serverseitig wird kein letzter guter Zustand geladen.
- `[aus Code abgeleitet]` Beim initialen Laden oder doppeltem Fallback kann die UI daher leer werden.
- `[erforderlich]` Entweder letzten guten Run explizit laden/cachen oder Text auf „Status konnte nicht geladen werden“ korrigieren.

### Breiter Customer-Records-Fan-out bleibt Latenz- und Fehlerverstärker

- `[verifiziert]` Ein voller Fall lädt mehr als ein Dutzend Supabase-Quellen, verwandte Datensätze, Offer-Tracking und optional Trello.
- `[verifiziert]` GETs werden bis zu dreimal versucht; ein zentraler abgelehnter Promise kann den gesamten Detail-Read verwerfen.
- `[erforderlich]` Quellen nach kritischem Kern und optionalen Panels trennen, Teilergebnisse kennzeichnen, messen und lazy laden.

### Batch-Aktionen sind sequentiell und nicht als Batch idempotent

- `[verifiziert]` Die UI zeigt höchstens fünf Fälle und führt sie nacheinander aus.
- `[verifiziert]` Bei einem Fehler lautet die Meldung nur „nicht vollständig ausgeführt“; es gibt keinen Batch-Run mit Ergebnis pro Fall.
- `[Risiko]` Ein Retry kann bereits erfolgreiche Fälle erneut bearbeiten und Audits duplizieren.
- `[erforderlich]` Batch-ID, per-Fall-Idempotenz, Ergebnisliste und sichere Wiederaufnahme.

### Schema-Check deckt den eigentlichen Calls-Vertrag nicht vollständig ab

- `[verifiziert]` `scripts/check_customer_records_schema.mjs` prüft Call-Bildspalten, aber nicht alle Call-Tabellen, Constraints, RLS, Grants oder erforderlichen RPCs.
- `[erforderlich]` Check um Tabellen, Schlüssel, RPC-Signaturen, RLS/Grants und Offer-Sent-Bridge erweitern.

### Segmentierungs-Livezustand ist nicht belegt

- `[historisch]` Die Projektdoku bezeichnet einen minütlichen n8n-Workflow als aktiv und fordert Web-Evidenz bei Firmen-Domains.
- `[Live-Evidenz fehlt]` Aktive Version, Queue, letzte erfolgreiche Execution, Domain-Recherche, Kosten und Fehlerquote wurden nicht geprüft.
- `[erforderlich]` Read-only Betriebsbeleg mit Workflow-ID/Version, letzter Execution, Job-Backlog und Stichprobe ohne PII dokumentieren.

### Projektdokumentation enthält veraltete Betriebsanweisungen

- `[verifiziert]` `operations-runbook.md` empfiehlt noch Arbeit im alten Main-Checkout und direkten `git push`.
- `[verifiziert]` Alte Go-live-Dokumente widersprechen sich bei Basic Auth, Portal-Token und Cloudflare Access.
- `[erforderlich]` Dieses Handoff als aktuelle Autorität verwenden und Alt-Dokus sichtbar als historisch markieren oder aktualisieren.

## Priorität Niedrig

### Aktions- und Route-Tests sind lückenhaft

- `[verifiziert]` Die fokussierten Unit-Tests decken Planung, Suche, Session-Mapping, Cadence, Presets und einen Trello-Duplizierungs-Happy-Path ab.
- `[verifiziert]` Es fehlen Route-/Domänentests für viele Kontakt-, Outcome-, Batch- und Teilfehlerpfade sowie UI-Tests für destruktive Bestätigungen.

### Konkrete historische Suchmeldung ist nicht live reproduziert

- `[historisch]` Ein einzelner Produktionskontakt war zeitweise nicht auffindbar und löste eine Supabase-Fehlermeldung aus.
- `[verifiziert]` Aktueller Code hat Fallbacks für alte/fehlende Request-Zeiger und Tests für Suchfilter.
- `[Live-Evidenz fehlt]` Der konkrete Datensatz wurde nicht erneut authentifiziert geprüft und wird aus Datenschutzgründen nicht in diesem Paket genannt.

## Sicherheits-Scorecard

| Dimension | Score | Begründung |
| --- | ---: | --- |
| Correctness | 3/5 | Gute deterministische Kernlogik und Tests, aber Teiltransaktionen, unvollständige Trello-Gleichheit und lückenhafte Action-Tests. |
| Reliability | 3/5 | Timeouts, Preview und kompensierende Schritte vorhanden; breiter Fan-out und fehlende atomare Gesamtaktionen bleiben. |
| Idempotency | 3/5 | Offer-Bridge, Tasks, Call-RPC und Trello-Duplizierung sind stark; viele Direkt-/Batchaktionen und Fallbacks sind nicht durchgehend replay-sicher. |
| Observability | 3/5 | Breites Audit und degraded States vorhanden; best-effort Audit, kein Batch-/Duplicate-Action-Run und missverständlicher Stale-State-Text. |
| Security | 3/5 | Serverseitige Access- und Service-Role-Grenze; Call-Basistabellen-RLS ist im Repo nicht reproduzierbar und destruktive UI-Gates fehlen. |
| Tracking impact | 5/5 | Der Scope verändert kein Marketing-/Analytics-Tracking; diese Wissensmigration hat keine Trackingwirkung. |
| Cost risk | 4/5 | Keine kostenpflichtige Aktion wurde ausgeführt. Live-Websuche/Trello/n8n können Kosten erzeugen und bleiben freigabepflichtig. |

## QA-Plan für die erforderlichen Fixes

1. Isolierte Datenbank aus kanonischen Migrationen aufbauen und Schema/RLS/RPC-Vertrag automatisiert prüfen.
2. Für jede destruktive Aktion und jeden Kundenversand UI-Abbruch, UI-Bestätigung, API-Guard, Idempotenz und Audit/Evidenz testen.
3. Terminale Call-Presets gegen `sales_tasks`, `followup_queue`, `followup_blacklist`, Cadence und Workboard testen; kein Kanal darf widersprüchlich offen bleiben.
4. Teilfehler nach jedem Schritt von Call-Ergebnis, Outcome, Recovery und Duplizierung injizieren; Endzustand muss eindeutig resumable oder vollständig kompensiert sein.
5. Zwei parallele Call-Ergebnis- und Refresh-Requests testen; genau ein kanonisches Ergebnis/ein Run darf entstehen.
6. Calls mit langsamer/fehlender Quelle testen: letzter guter Stand oder klarer leerer Fehlerzustand, niemals Endlosladen.
7. Trello-Kopie gegen den beschlossenen vollständigen Identitätsvertrag prüfen, ohne echte Kundenkarte.

## Rollback

- Dieses Paket ändert keine Produktlogik und benötigt keinen Produktionsrollback.
- Spätere Fixes einzeln, mit eigener Migration/Rollback-Datei und ohne Alt-Historie umzuschreiben ausliefern.
- Bei Action-Hardening zunächst neue Pfade hinter explizitem Gate einführen; alten Pfad erst nach erfolgreicher Parallelverifikation entfernen.
