# Kundenakte und Calls Review - Operations

## Sicherer Arbeitsstart

```bash
codex-new-worktree ops <topic>
cd /Users/danielklesse/codex-worktrees/<worktree>
git status --short --branch
git fetch origin
git rebase origin/main
```

Nicht im alten Ops-Checkout arbeiten. Vor jeder Änderung zuerst relevante Pfade und fremde Änderungen prüfen. Neue Produktlogik braucht fokussierte Tests und einen reversiblen Plan.

## Sichere lokale Verifikation

```bash
npm ci
node --import tsx --test \
  tests/quotes/customer-records.test.ts \
  tests/quotes/customer-call-module.test.ts \
  tests/quotes/customer-records-session-meta.test.ts \
  tests/quotes/customer-records-session-maps.test.ts
npx tsc --noEmit --pretty false
```

Gemockte UI-Smokes, mit lokalem Dev-Server auf einem freien Port:

```bash
npm run dev -- --hostname 127.0.0.1 --port 3107
node scripts/smoke_customer_records_ui.mjs http://127.0.0.1:3107
node scripts/smoke_customer_calls_ui.mjs http://127.0.0.1:3107
```

Diese Smokes mutieren keine Produktion. Ein echter Kundenfall, Call, Segment, Trello-Karte oder Versand darf nicht als Test verwendet werden.

Angebotsversand ist keine Diagnoseaktion. Die UI- und API-Guards dürfen nur mit Mocks/Fakes getestet werden; auch eine interne Empfängeradresse ist kein freigegebener Live-Testpfad.

## Wann ein Voll-Build nötig ist

- Nach Änderung an gemeinsamen Next.js-/Auth-/Build-Pfaden, Abhängigkeiten, Routenverträgen oder breiter UI-Logik.
- Vor einem freigegebenen Deploy, sofern kein grüner CI-Build exakt für den zu deployenden Commit vorliegt.
- Nicht allein für ein Dokumentations-Handoff, wenn derselbe Commit bereits grüne vollständige CI-Evidenz besitzt.

## Read-only Diagnose: Kundenakte meldet Supabase-Anfrage fehlgeschlagen

1. Prüfen, ob der Fehler Suche oder voller Kontext-Load ist. Suche und Detail-Fan-out sind unterschiedliche Phasen.
2. Suchmodus anhand Eingabe nachvollziehen: Request-ID, E-Mail, Name, Telefon, Deal oder Trello.
3. Bei altem Request prüfen, ob `master_requests.request_id -> customer_id` existiert, auch wenn `master_customers.request_id` inzwischen abweicht.
4. Bei E-Mail beachten: exakte Suche über primäre, Billing-, Original- und CC-Adresse; keine breite Domain-Zuordnung als Kundenidentität.
5. Fehlerstatus und PostgREST-Details nur ohne personenbezogene Inhalte/Secrets dokumentieren.
6. Prüfen, welche Fan-out-Quelle scheitert. Trello-Lesefehler werden abgefangen; zentrale Supabase-Rejections können den gesamten Detail-Read abbrechen.
7. Keine Row direkt reparieren, bevor Source-of-Truth, erwarteter Wert, Backup und Rollback feststehen.

## Read-only Diagnose: Calls bleibt auf Statusladen oder ist leer

1. `GET /api/ops/customer-records/calls` im geschützten Browser/Netzwerk prüfen: `degraded`, `warning`, `storageReady`, `completion.technicalStatus` und Item-Anzahl.
2. Bei 35-Sekunden-Timeout die langsamste Datenquelle anhand Serverlogs ermitteln; keine pauschalen Retries oder höheren Timeouts zuerst einführen.
3. Prüfen, ob heutiger `sales_call_runs`-Lauf frisch ist und zugehörige `sales_call_list_items` besitzt.
4. Prüfen, ob `sales_call_cadence_state`, `sales_call_results`, `sales_tasks` und die RPCs `ops_claim_refresh_lock`/`ops_record_sales_call_result` vorhanden und serverseitig zugreifbar sind.
5. Falls Tabellen/RPC fehlen, Preview-/Fallback-Verhalten erwarten. Das ist degraded, nicht produktionsbereit.
6. Prüfen, ob Kandidaten durch Guards oder `shouldIncludeInDailyCallList` korrekt entfernt werden: Auftrag/Abschluss, Zukunfts-Callback, heute nicht fällig oder finished.

## Read-only Diagnose: `Angebot gesendet` ist leer

1. Prüfen, ob ein erfolgreiches Offer-Sent-Ereignis für den Request existiert und nicht nur ein Entwurf/fehlgeschlagener Versand.
2. In `ops_offer_events` muss ein idempotentes `offer_sent`-Ereignis vorliegen.
3. `sales_tasks` muss `call_quote_sent` mit fälligem oder zukünftigem `due_at` enthalten; eine vorherige `call_new_inquiry`-Aufgabe sollte abgeschlossen sein.
4. `sales_call_cadence_state.current_stage` sollte `quote_call` oder später `no_response_call` sein, außer ein bewusster manueller/terminaler Zustand schützt vor Überschreibung.
5. Beim Read reconciled `resolveRuntimeSalesCallState` veraltete Inquiry-Zustände gegen Offer-/Task-Wahrheit. Fehlt trotzdem der Fall, Sichtbarkeitsdatum und Guard prüfen.
6. Niemals durch manuelles Erfinden eines Trello-Status reparieren. Trello ist keine Call-Wahrheit.

## Read-only Diagnose: Segment fehlt oder ist falsch

1. `master_requests.segment`, `segment_status`, `segment_confidence`, `segment_source`, `segment_policy_version` und `segment_classified_at` prüfen.
2. Die letzte Row der View `request_segmentation_latest_classification` gegen den Request vergleichen.
3. Eine manuelle Quelle hat Vorrang vor einem neueren KI-Vorschlag.
4. Ohne Segment, ohne `accepted` oder unter `0.75` ist menschliches Review erwartetes Verhalten.
5. Workflow-Aktivierung, Jobs, Web-Evidenz und Modellantwort nur read-only und ohne Kundendaten in Logs prüfen.
6. Eine manuelle Segmentbestätigung ist eine echte Produktionsmutation und darf nicht als Diagnosehandlung erfolgen.

## Read-only Diagnose: Trello-Duplizierung

Nach einer gemeldeten Duplizierung nur lesen:

- `master_requests.attribution_raw.source = customer_records_trello_duplicate`
- passender `idempotency_key`, `source_request_id` und `source_trello_card_id`
- neuer Request mit `status=new`, `deal_status=open` und neuer Trello-ID
- `master_customers.request_id` zeigt auf den neuen Request
- `sales_tasks` enthält `call_new_inquiry` mit `trello-duplicate-call:<newRequestId>`
- Audit `customer_trello_card_duplicated`, soweit vorhanden

Bei unklarem Ausgang denselben Vorgang nicht mit neuem Idempotenzschlüssel wiederholen. Zuerst Audit und `attribution_raw` suchen.

## Rollback-Verträge

### Kontaktdaten

- Der Speichervorgang kompensiert Teiländerungen selbst.
- Der UI-Rollback darf nur laufen, wenn der aktuelle Snapshot exakt dem letzten gespeicherten `after` entspricht.
- Bei Rollbackfehlern keine weiteren Writes; betroffene Tabellen und erwartete Vorwerte sichern.

### Follow-up, Kontaktstopp und Rückruf

- Die einzelne Domänenaktion besitzt kompensierende Schritte.
- Zusammengesetzte Fallausgänge besitzen keinen gemeinsamen atomaren Rollback. Bei Fehler jedes bereits geschriebene Audit/Case-State-/Follow-up-Signal einzeln abgleichen.

### Call-Ergebnis

- Ergebnisse werden superseded, nicht gelöscht.
- Bei HTTP 409 Browser neu laden und den neueren Stand prüfen.
- Fehlt die RPC, ist der REST-Fallback nicht gleich stark gegen Parallelität; zuerst Schema/RPC wiederherstellen.
- Bei `do-not-call`, `not-interested` oder `bought` zusätzlich read-only prüfen, ob Kontaktstopp/Follow-ups/Workboard fachlich konsistent sind. Der aktuelle Call-Pfad schreibt diese Folgezustände nicht automatisch.
- Liegt ein Ergebnis vor, aber Cadence/Aufgabe ist alt, keine zweite Ergebnis-Row erzeugen. Zuerst den Teilfehler zwischen Ergebnis, Audit, Cadence und Task bestimmen.

### Angebotsmail

- Ein erfolgreicher Mailversand kann bereits erfolgt sein, obwohl Call-Sync oder `quote_email_log` danach fehlschlägt.
- Vor jedem Retry read-only anhand Offer-Event/`eventId`, Idempotenzschlüssel, Call-Task/Cadence und Versand-Evidenz klären, welcher Schritt fehlt.
- Nicht mit neuem Idempotenzschlüssel erneut senden, um fehlenden Sync oder fehlende Evidenz zu reparieren. Den ausstehenden Post-Send-Schritt gezielt und nach expliziter Freigabe nachführen.

### Trello-Duplizierung

- Scheitert der Vorgang vor dem `master_requests`-Insert, archiviert der Code die neue Karte best effort.
- Nach erfolgreichem DB-Insert existiert kein vollständiger automatischer Rollback über Karte, Request-Zeile, Kundenzeiger, Task und Audit.
- Keine Rows oder Karten löschen, bevor ein expliziter Wiederherstellungsplan mit IDs, Backup und Folgen für alte Requests vorliegt.

### Code/Deploy

- Code-Rollback erfolgt über einen neuen reversierenden Commit, nicht durch History-Rewrite.
- Datenbankmigrationen nur mit dokumentiertem Backup und passender Rollback-Datei zurücknehmen.
- Bei einem später ausdrücklich freigegebenen Deploy:

```bash
codex-predeploy ops
```

Nur den ausgegebenen Commit deployen. Push auf `main` ausschließlich über `codex-safe-push-main` und nur mit ausdrücklicher Freigabe.

## Beobachtbarkeit

Wichtige Audit-Aktionen:

- `customer_record_update`, `customer_record_rollback`
- `customer_request_segment_override`
- `customer_followups_paused`, `customer_followups_rescheduled`
- `customer_contact_blocked`, `customer_callback_scheduled`
- `customer_case_outcome_applied`, `customer_workboard_handled`, `customer_workboard_snoozed`
- `customer_trello_fields_updated`, `customer_trello_card_updated`, `customer_trello_card_duplicated`
- `sales_call_list_refreshed`, `sales_call_result_recorded`

Audit ist kein Beweis, dass alle externen Side Effects erfolgreich waren. Bei Trello-Duplizierung können Task- oder Auditfehler als Warnung zurückkommen, obwohl Request und Karte bereits existieren.

## Zeitplanfähigkeit

`schedule_supported` ist für diesen Agenten `false`. Kundenakte und Call Review sind menschlich bediente Review-Oberflächen. Segmentierungs- und sonstige n8n-Zeitpläne sind externe Systeme und dürfen von diesem Agenten nicht autonom aktiviert, geändert oder als gesund behauptet werden.
