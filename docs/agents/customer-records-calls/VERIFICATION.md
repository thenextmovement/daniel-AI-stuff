# Kundenakte und Calls Review - Verification

## Verifikationsbasis

- `[verifiziert]` Repository: `https://github.com/thenextmovement/daniel-AI-stuff.git`.
- `[verifiziert]` Branch-Basis vor Dokumentänderungen: `origin/main` auf `c76e7e526bf0933b47b1b68936601137f7721309` (`Convert ActiveCampaign auto reply to draft loop`).
- `[verifiziert]` Dedizierter Worktree: `/Users/danielklesse/codex-worktrees/neontrip-ops-handoff-customer-records-calls-20260721-201558`.
- `[verifiziert]` Verifiziert am 2026-07-21 in Europe/Berlin.
- `[verifiziert]` Während der Prüfung wurden keine Produktion, Supabase-Daten, Trello-Karten, n8n-Workflows, Offers, Coolify-Konfiguration oder Kundenkommunikation verändert.

## Lokale Ergebnisse

| Prüfung | Ergebnis | Status |
| --- | --- | --- |
| Vier fokussierte Testdateien | 73/73 bestanden | `[verifiziert]` |
| `npx tsc --noEmit --pretty false` | Exit 0 | `[verifiziert]` |
| `smoke_customer_records_ui.mjs` | grün; Fehler-Recovery und 390px ohne horizontalen Overflow | `[verifiziert]` |
| `smoke_customer_calls_ui.mjs` | grün; Fehler-Recovery und 390px ohne horizontalen Overflow | `[verifiziert]` |
| `git diff --check` | Exit 0 | `[verifiziert]` |
| JSON-Parse/Manifest-Pflichtfelder | gültig; alle Pflichtfelder vorhanden | `[verifiziert]` |

Die Trello-Warnlogs in `customer-records.test.ts` stammen aus absichtlich unkonfiguriertem Trello in Suchfilter-Tests; alle Tests endeten erfolgreich.

`npm ci` installierte 390 Pakete aus dem aktuellen Lockfile und meldete `found 0 vulnerabilities`.

## CI- und Git-Evidenz

- `[verifiziert]` `c5ca78881e596c6ed67e80b22b143e3cba1b3f38` führte die Trello-Duplizierung ein und ist Vorfahr von `origin/main`.
- `[verifiziert]` Seit `c5ca788` wurden die Kernpfade `customer-records.ts`, `customer-call-module.ts`, Kundenakte-/Calls-Routen und deren fokussierte Tests nicht mehr verändert.
- `[verifiziert]` GitHub Actions Run `29833312455` für `c5ca788` war erfolgreich.
- `[verifiziert]` GitHub Actions Run `29857274686` für exakt `c76e7e526bf0933b47b1b68936601137f7721309` war erfolgreich. Der Workflow führt `npm ci`, vollständige Quote-Tests, Typecheck, Next-Build, Coolify-Trigger und optionalen geschützten Smoke aus.
- `[verifiziert]` Der Main-Commit nach der lokalen Fokustest-Ausführung änderte nur ActiveCampaign-Draft-Workflow, zugehörige Migration/Tests und Betriebsdokumentation; keine Kundenakte-, Calls-, Offers-, Abhängigkeits- oder fokussierten Testpfade.
- `[verifiziert]` Deshalb wurde für diese reine Dokumentationsmigration kein unnötiger zweiter lokaler Voll-Build gestartet.
- `[wichtig]` Ein erfolgreicher Workflow/Deploy beweist Build und Auslieferung, nicht die fachliche Funktion mit authentifizierten Live-Daten.

## Geprüfte Codepfade

- UI: `src/app/ops/customer-records/page-client.tsx`, `src/app/ops/customer-records/calls/page-client.tsx`.
- APIs: Kernroute, Actions, Notes, Calls, Offers-Send, Trello-Felder, Trello-Karte und Trello-Duplizierung unter `src/app/api/ops/customer-records`.
- Domäne: `src/lib/ops/customer-records.ts`, `src/lib/ops/customer-call-module.ts`, `src/lib/ops/sales-task-engine.ts`, `src/lib/ops/offers.ts`.
- Infrastruktur: `src/lib/ops/auth.ts`, `src/lib/quotes/supabase-rest.ts`, `src/lib/quotes/trello.ts`, `.github/workflows/deploy-coolify.yml`.
- Datenbank: `202605280001_create_sales_tasks.sql`, `202605290001_harden_sales_call_ops.sql`, `202605290002_harden_ops_rpc_permissions.sql`, `202605290003_customer_case_state_and_card_views.sql`, `202606010001_ops_offer_sent_sales_call_bridge.sql`, `20260611190000_harden_sales_tasks_offer_events_rls.sql`.
- Tests/Smokes: alle in der lokalen Ergebnistabelle genannten Dateien/Skripte.
- Historische Doku: `docs/projects/customer-records-ops/*`, insbesondere Request Segmentation, Operations Runbook und Go-live-Status.

## Assertionsmatrix

| Aussage | Befund | Status |
| --- | --- | --- |
| Alte Request-ID bleibt nach neuem aktuellem Request ladbar. | Fallback über `master_requests.customer_id` plus Test vorhanden. | `[verifiziert]` |
| Exakte E-Mail-Suche berücksichtigt Billing, Original und CC. | Query-Code und Filtertests vorhanden. | `[verifiziert]` |
| `Angebot gesendet` erhält Offer-Follow-ups. | Offer-Sent-RPC, Runtime-Reconcile und Tests vorhanden. | `[verifiziert]` |
| Calls bleibt bei Transportfehler nicht endlos auf Laden. | 35s Timeout, degraded State und UI-Fehlersmoke vorhanden. | `[verifiziert]` |
| Letzter guter Call-Stand bleibt immer sichtbar. | Bei vollständigem GET-Fehler wird eine leere Failure-State gebaut. | `[verifiziert]` als nicht garantiert |
| Call-Write respektiert Kontaktstopp/Abschluss/Antwort/Zukunft/Telefon. | Live-Guard wird direkt vor Write neu berechnet. | `[verifiziert]` |
| `Nicht mehr anrufen` stoppt auch E-Mail-Follow-ups und setzt die Blacklist. | Calls-Pfad beendet nur Cadence/Tasks; Customer-Ops-Aktion wird nicht aufgerufen. | `[verifiziert]` als falsch |
| `Kauft/Auftrag` oder `Kein Interesse` setzt den kanonischen Fallausgang. | Calls-Pfad beendet nur Cadence/Tasks. | `[verifiziert]` als falsch |
| Parallele Call-Writes sind geschützt. | RPC-Pfad ja; REST-Fallback nicht gleichwertig atomar. | `[verifiziert]` mit offenem Risiko |
| KI-Segment bleibt Vorschlag bis deterministische Annahme/Review. | UI-Auflösung und manuelle Override-Logik vorhanden. | `[verifiziert]` |
| Nicht private Domain wird aktuell live recherchiert. | Nur historische Workflow-Doku, keine Live-Execution geprüft. | `[Live-Evidenz fehlt]` |
| Segmentbestätigung ist rückfallgesichert. | Request-Patch wird bei Auditfehler zurückgesetzt. | `[verifiziert]` |
| Trello-Duplikat hat neue Request-ID und Call-Aufgabe. | Code und fokussierter Happy-Path-Test vorhanden. | `[verifiziert]` |
| Trello-Duplikat ist in jeder Eigenschaft identisch. | Verifikation deckt nur einen Teilvertrag ab. | `[verifiziert]` als nicht bewiesen |
| Batch-Aktionen überspringen Kontaktstopp/Urlaub. | UI-Eligibility-Filter vorhanden. | `[verifiziert]` |
| Jede destruktive Einzelaktion verlangt Bestätigung. | `Kein Kontakt mehr` wirkt direkt. | `[verifiziert]` als falsch |
| Angebotsversand verlangt eine finale Bestätigung. | Versand-Button ruft direkt POST auf; serverseitige Empfänger-/Preis-/Idempotenz-Guards ersetzen kein Confirm-Gate. | `[verifiziert]` als falsch |
| Versand, Call-Sync und Versand-Evidenz sind eine atomare Aktion. | E-Mail wird zuerst gesendet; Sync und Evidenz folgen getrennt und dürfen fehlschlagen. | `[verifiziert]` als falsch |
| Call-Schema kann aus Repo neu aufgebaut werden. | Basismigrationen fehlen im aktuellen Repo. | `[verifiziert]` als falsch |

## Fehlende Live-Evidenz

- Kein authentifizierter Read von `ops.neontrip.de`.
- Keine aktuelle Supabase-Row-, RLS-, Grant-, Advisor- oder Migration-History-Prüfung.
- Keine aktuelle n8n-Inventur oder Segmentierungs-Execution.
- Keine echte Trello-Kopie oder Kartenmutation.
- Kein echter Call, Segment-Override, Kontaktstopp, Callback, Outcome, Batch oder Kundenversand.
- Kein Re-Test des im historischen Thread genannten konkreten Kundenkontakts.

## Supabase-Changelog-Prüfung

- `[verifiziert]` Der Supabase-Changelog wurde am 2026-07-21 nach relevanten Breaking Changes gescannt.
- `[verifiziert]` Aktuelle Einträge zu self-hosted Gateway/Auth und automatisch exponierten Tabellen ändern diese reine Dokumentation nicht.
- `[verifiziert]` Das Sicherheitsprinzip bleibt: interne Tabellen in exponierten Schemas brauchen RLS/Grants; Service Role bleibt ausschließlich serverseitig.

## Grenzen

Die Verifikation beweist aktuellen Repository-, Test- und CI-Stand. Sie beweist nicht, dass produktive Daten vollständig, externe Workflows aktiv, RLS korrekt deployed oder jeder fachliche Realfall fehlerfrei ist.
