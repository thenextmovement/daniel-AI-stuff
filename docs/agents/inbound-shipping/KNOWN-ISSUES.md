# Inbound Shipping Known Issues

## Findings nach Schwere

### High - Der Daily Cap ist kein harter API-Verbrauchsdeckel

`[verifiziert]` `seventeen_track_daily_registration_count` zaehlt pro Berliner Tag Rows, deren `last_attempt_at` im Fenster liegt. Wiederholt dieselbe Row `/register`, bleibt sie eine gezaehlte Row. `refresh17TrackRegistrationIfNeeded` kann ausserdem im Inbound-Sync `/register` aufrufen, ohne die gemeinsame Kapazitaet zu claimen.

Auswirkung: Der reale Providerverbrauch kann hoeher als 100 Registrierungsversuche pro Tag sein. Historische Monatsprognosen auf Basis der Row-Zaehlung sind nur Naeherungen.

Erforderliche Korrektur vor der Bezeichnung "Hard Cap": append-only Attempt-Ledger oder atomarer Budget-Token pro geplanter `/register`-Position, Einbezug des Refresh-Pfads und Tests fuer Retry, Parallelitaet, Berlin-DST und Tageswechsel.

### High - Ambige POST-Retries und deaktivierte TLS-Pruefung

`[verifiziert]` Alle vier aktiven n8n-HTTP-Nodes fuer 17TRACK Register/Sync nutzen `https://coolify-proxy/...`, `allowUnauthorizedCerts=true`, `retryOnFail=true` und maximal drei Versuche.

Auswirkung: Zertifikatsfehler werden nicht fail-closed behandelt. Bei Timeout nach serverseitigem Erfolg kann der naechste POST weitere Rows claimen; beim Sync koennen weitere Providerabfragen entstehen. Die DB-Claims reduzieren Duplikate, sind aber kein Request-Level-Receipt fuer einen unklaren HTTP-Ausgang.

Erforderliche Korrektur: verifiziertes TLS-Ziel, kein automatischer Retry fuer ambige POSTs oder ein stabiler Request-/Execution-Key mit durable Receipt und Reconciliation vor Retry.

### High - Trello ist noch Kandidatenautoritaet

`[verifiziert]` Der aktive Inbound-Workflow liest die `sign shipped`-Liste und erzeugt daraus DB-Kandidaten. Das Capability-Manifest klassifiziert ihn als `source_of_truth_review_required` und `trello_authority_candidate`.

Auswirkung: geloeschte, umbenannte oder falsch gepflegte Trello-Daten koennen Aufnahme und Carrier-Zuordnung beeinflussen. Das widerspricht dem Ziel "Postgres Source of Truth, Trello Projektion".

Erforderliche Korrektur: kanonische DB-Intake-Quelle/Job-State einfuehren und Trello nur aus diesem Zustand projizieren. Bis dahin Trello-Aenderungen nie als ausreichenden Beleg fuer fachliche Wahrheit behandeln.

### Medium - Keine exakte Kosten- und Execution-Receipt-Kette

`[verifiziert]` Registration-Rows speichern kumulative Attempts und nur den letzten Versuch. Erfolgreiche n8n-Executions werden nicht gelistet/aufbewahrt; die read-only Abfrage lieferte keine Execution-Rows. App-/Workflow-Pfad hat keinen durchgaengigen Correlation-/Execution-/Provider-Receipt-Datensatz.

Auswirkung: Exakte API-Calls, Kosten pro Fenster und unklare Timeout-Ausgaenge sind nachtraeglich nicht lueckenlos rekonstruierbar.

Erforderliche Korrektur: append-only Attempt/Receipt mit source event, n8n execution ID, shipment ID, operation, request idempotency key, Providerresultat und Kostenklasse.

### Medium - Quota-/Claim-SQL ist nicht fokussiert regression-getestet

`[verifiziert]` Die TypeScript-Tests decken Parsing, Carrier-IDs, stabile Event-Keys und Routensicherheit ab. Es gibt keinen Repository-Test fuer `seventeen_track_daily_registration_count`, Advisory-Lock-Parallelitaet, wiederholte Rows, Inbound/Outbound-Fairness oder den Refresh-Bypass.

Auswirkung: Eine gruen laufende App-Suite beweist die Verbrauchsgrenze nicht.

Erforderliche Korrektur: isolierte Postgres-Tests mit konkurrierenden Sessions, wiederholten Fehlern, Tageswechsel und Rollback/Reapply.

### Medium - Unerreichbare direkte DHL-/FedEx-Nodes bleiben im aktiven Inbound-Graph

`[verifiziert]` Strict Validation meldet zehn direkte Carrier-Nodes als nicht vom Trigger erreichbar. Der 17TRACK-Pfad ist erreichbar und laeuft; die toten Nodes erhoehen aber Wartungs- und Fehlinterpretationsrisiko.

Erforderliche Korrektur: nach Backup und Verhaltensvergleich entfernen oder als klar inaktiven, separaten Fallback-Workflow versionieren.

### Medium - Webhook-Token darf in der URL stehen

`[verifiziert]` `is17TrackWebhookAuthorized` akzeptiert den Token im Query-Parameter oder Header.

Auswirkung: Query-Strings koennen in Proxy-, Browser- oder Access-Logs landen.

Erforderliche Korrektur: nur Header-/Signaturauthentifizierung akzeptieren, Providerkompatibilitaet pruefen und bestehenden Token kontrolliert rotieren, falls URL-Nutzung nicht ausgeschlossen werden kann.

### Medium - Manuelle Incident-Statusaenderungen haben kein append-only Audit

`[verifiziert]` `acknowledged`, `resolved` und `ignored` patchen die Incident-Row und schreiben App-Logs, aber keinen dauerhaften Transition-Datensatz.

Auswirkung: Wer/wann/warum ist nach Log-Retention nicht verlaesslich rekonstruierbar.

Erforderliche Korrektur: idempotente Status-Transition-RPC mit Actor, Reason, vorherigem/neuem Status und append-only Event.

### Medium - Aktueller Provider- und Backlog-Stand fehlt

`[Live-Evidenz fehlt]` In dieser Wissensmigration wurden weder 17TRACK-Kontostand noch aktueller DB-Backlog oder ein realer post-purchase Lauf abgefragt. Der letzte bekannte Quota-Fehlerstand stammt vom 2026-07-15.

Auswirkung: Das Paket beschreibt System und Risiken, bestaetigt aber nicht, dass heute Credits vorhanden sind oder alle Rows aufgeholt wurden.

### Low - Lieferschein und Shopify-Verknuepfung nicht live E2E getestet

`[verifiziert]` Route-/PDF-Test und aktuelle Match-/Fallback-Logik sind vorhanden. `[Live-Evidenz fehlt]` Ein authentifizierter Produktionsfall mit echtem Shipment, Shopify-Link und generiertem Lieferschein wurde in dieser Migration nicht ausgefuehrt.

## Safety Scorecard

| Dimension | Score | Begruendung |
| --- | ---: | --- |
| correctness | 3 | Fachlogik und Parser sind getestet; Daily-Cap-Bezeichnung entspricht nicht exakten API-Calls. |
| reliability | 3 | DB-Claims/Leases sind solide, aber POST-Retries, tote Nodes und fehlende Receipts bleiben. |
| idempotency | 4 | Stabile Registration/Event/Task-Keys; ambiger Request-Retry ist nicht vollstaendig abgedeckt. |
| observability | 3 | Persistierte Rows/Incidents vorhanden; kein lueckenloses Attempt-/Execution-/Kosten-Ledger. |
| security | 3 | Interne Auth und RLS sind vorhanden; TLS-Pruefung aus und Query-Token bleiben offen. |
| tracking impact | 5 | Keine Analytics-/Attribution-Aenderung in diesem Scope. |
| cost risk | 2 | Cap unterzaehlt Wiederholungen/Refresh; n8n kann POSTs mehrfach ausfuehren. |

## Priorisierte Fix-Reihenfolge

1. Exaktes Attempt-/Budget-Ledger und echter atomarer Quota-Cap inklusive Refresh.
2. Verifiziertes TLS und fail-closed/idempotenter HTTP-Request-Receipt statt ambiger POST-Retries.
3. DB-kanonischer Inbound-Intake; Trello nur Projektion.
4. Durable Execution-/Kosten-Receipts und Incident-Transition-Audit.
5. Unerreichbare direkte Carrier-Nodes kontrolliert entfernen oder separieren.
6. Webhook-Auth auf Header/Signatur migrieren.

Jeder Fix ist neue Produktarbeit und gehoert in einen eigenen Ops-Worktree mit Backup, Diff, Rollback und Produktionsfreigabe.
