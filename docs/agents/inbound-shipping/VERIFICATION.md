# Inbound Shipping Verification

Verifikationszeitpunkt: 2026-07-21T20:28:36+02:00

Verifizierter Code-Stand: `c76e7e526bf0933b47b1b68936601137f7721309`

## Verifikationsumfang

- Aktueller Ops-Repository- und Git-Stand
- Inbound-Board/API und manuelle Ausnahmeaktionen
- 17TRACK-Adapter, interne Register-/Sync-/Webhook-Routen
- Inbound-/Outbound-Registrierungs- und Tracking-Migrationen
- gemeinsamer nomineller Tagesrahmen und Rollback
- veroeffentlichte n8n-Graphen, Zeitfenster und Strict Validation
- fokussierte Tests und frischer kompletter CI-Lauf
- datierte Thread-Evidenz zu Quota-Verbrauch und Providerfehlern

Keine produktive Mutation, kein Workflow-Trigger, keine Aktivierung, keine Kundenkommunikation, kein Kauf und kein Secret-Read wurde ausgefuehrt.

## Git-Evidenz

- `[verifiziert]` Worktree wurde mit `codex-new-worktree ops handoff-inbound-shipping` erstellt.
- `[verifiziert]` Branch-Basis nach Fast-forward: `c76e7e526bf0933b47b1b68936601137f7721309`, identisch mit dem damaligen `origin/main`.
- `[verifiziert]` Inbound-Fundament `6e439fe41fb7705cab05eb635b85acb1ad050a8a` und Quota-Commit `9ab208186c2eef3b8e346521231918b032a795ba` sind Vorfahren des verifizierten Stands.
- `[verifiziert]` Seit `9ab2081` wurden die 17TRACK-TypeScript-Datei, die fuenf internen 17TRACK-Routen, die Cap-Migration, deren Rollback und `tests/quotes/seventeen-track.test.ts` nicht erneut geaendert.
- `[verifiziert]` Alle fuer diesen Scope geprueften Migrationen besitzen korrespondierende Rollback-Dateien.

## Lokale Tests

Ausgefuehrt im dedizierten Worktree:

```bash
npm ci --ignore-scripts
node --import tsx --test tests/quotes/seventeen-track.test.ts tests/quotes/inbound-shipping-route.test.ts
```

Ergebnis:

- 17 Tests
- 17 bestanden
- 0 fehlgeschlagen
- 0 uebersprungen
- Lockfile-Installation meldete 0 bekannte Vulnerabilities

Abgedeckt sind unter anderem:

- 17TRACK-Statusnormalisierung
- Webhook-/Snapshot-Parsing
- stabile Latest-Status-Event-Keys
- accepted/rejected/already-registered-Antworten
- DHL-Express-/FedEx-/DPD-Carrier-Verhalten
- Legacy-DHL-Refresh-Erkennung
- Inbound-Routenfilter, Default-Scope, no-store und Fehlerredaktion
- Lieferschein-PDF-Response-Header

Nicht abgedeckt sind die SQL-Cap-/Concurrency-Eigenschaften; siehe [KNOWN-ISSUES.md](./KNOWN-ISSUES.md).

## CI- und Build-Evidenz

GitHub Actions Run `29856777646` fuer den direkten Parent `a063f216692e97639da36492d9e025f7615665fe`:

- `npm ci`: bestanden
- `npm run test:quotes`: bestanden
- `npx tsc --noEmit`: bestanden
- `npm run build`: bestanden
- Deploy-Job und geschuetzter Smoke-Step: bestanden

Dieser Lauf existierte unabhaengig von der Wissensmigration. Der verifizierte Commit `c76e7e5` aenderte danach nur die fachfremde ActiveCampaign-Draft-Loop-Dokumentation, -Migration und -Workflow-Artefakte; keine Inbound-/17TRACK-, Package- oder Build-Datei. Deshalb wurde auf `c76e7e5` der 17-Test-Fokuslauf wiederholt und kein unnoetiger lokaler Full Build gestartet. Die Handoff-Arbeit hat keinen Deploy ausgeloest.

Historische Cap-Evidenz:

- Run `28605878439` fuer `9ab208186c2eef3b8e346521231918b032a795ba`
- Test, Typecheck, Build, Deploy-Trigger und geschuetzter Smoke-Step: bestanden

## Aktuelle read-only n8n-Evidenz

### Inbound `rYmSl4D0nNmEEU0M`

- aktiv: ja
- Published Version: `18429ec6-e647-4c97-bd05-0f0e5ae794e7`
- aktualisiert: `2026-07-20T17:22:06.119Z`
- gespeicherter Graph: 27 Nodes
- Trigger: `Every Hour`, Intervall 1 Stunde
- Gate: `17TRACK: Gate 09/11/13`, Europe/Berlin, Stunden 9/11/13
- Verbindung: Trigger -> Gate -> Register Inbound -> Sync Inbound
- Register/Sync: POST, `limit:20`, Timeout 30 Sekunden, bis zu 3 Versuche, TLS-Pruefung deaktiviert
- Strict Validation: valid, 0 Fehler, 28 Warnungen, 26 aktivierte ausfuehrbare Nodes, 1 Trigger
- relevante Warnung: zehn direkte DHL-/FedEx-Nodes sind nicht vom Trigger erreichbar

### Outbound `QtG2XHw7DsvOEPtQ`

- aktiv: ja
- Published Version: `3d967102-34ff-4f36-abf9-532ffb5f8d2f`
- aktualisiert: `2026-07-20T17:22:05.380Z`
- gespeicherter Graph: 27 Nodes
- Trigger: `Every Hour`, Intervall 1 Stunde
- Gate: `17TRACK: Gate 09/11/13`, Europe/Berlin, Stunden 9/11/13
- Verbindung: Trigger -> Gate -> Register Outbound -> Sync Outbound
- Register/Sync: POST, `limit:20`, Timeout 30 Sekunden, bis zu 3 Versuche, TLS-Pruefung deaktiviert
- Strict Validation: valid, 0 Fehler, 19 Warnungen, 26 aktivierte ausfuehrbare Nodes, 1 Trigger

Fuer beide Workflows lieferte die read-only Execution-Liste keine gespeicherten Rows. Das ist eine fehlende Lauf-/Receipt-Evidenz, kein Beleg fuer Inaktivitaet.

## Statische Quota-Verifikation

`[verifiziert]` Die Cap-Migration:

- berechnet Berliner Tagesgrenzen,
- kombiniert Inbound- und Outbound-Registrierungs-Rows,
- verwendet `pg_advisory_xact_lock(170017, 1)`,
- begrenzt Claim-Argumente auf 1 bis 50,
- verwendet nominell `100` gemeinsame Kapazitaet,
- entzieht den Funktionen Execute fuer `public`, `anon`, `authenticated`,
- erteilt Execute an `service_role`.

`[verifiziert]` Gegenbeleg zur Hard-Cap-Annahme:

- Die Count-Funktion aggregiert Rows nach `last_attempt_at`, nicht einzelne Attempts.
- Wiederholte Attempts aktualisieren dieselbe Row.
- Der Inbound-DHL-Refresh ruft `/register` aus dem Sync-Pfad ohne Capacity-Claim auf.

Damit ist ein exakter Maximalwert von 100 Provider-Registrierungsaufrufen pro Tag nicht bewiesen und nach aktuellem Code nicht garantiert.

## Historische Live-Evidenz aus dem uebergebenen Verlauf

Stand 2026-07-15, nicht heute erneut abgefragt:

- letzte 30 Tage: 224 Rows mit Registrierungsversuch
- letzte 30 Tage: 155 Rows erstmals akzeptiert
- davon Inbound versucht: 84
- davon Outbound versucht: 140
- 52 abgelehnte Rows mit `Quota is not enough for use.`
- am 2026-07-15: 40 versuchte Rows, 0 neue Acceptances

Diese Zahlen messen Rows/letzte Versuche und nicht zwingend alle 17TRACK-API-Calls. Sie duerfen nicht als aktueller Kontostand oder garantierter Monatsverbrauch ausgegeben werden.

## Fehlende Live-Evidenz

- aktueller 17TRACK-Kontostand und Tarif
- ob nach dem 2026-07-15 Credits gekauft wurden
- heutige Due-/Rejected-/Accepted-Counts in Supabase
- letzter tatsaechlich erfolgreicher 09/11/13-Lauf
- Provider-Receipt pro Registrierungs-/Sync-Aufruf
- authentifizierter Produktions-E2E-Fall fuer Board, Shopify-Link und Lieferschein
- direkte DHL-/DPD-API-Credentials und Eignung als produktiver Ersatz

## QA-Plan fuer spaetere Produktarbeit

1. Postgres-Test fuer exakten Attempt-Count, Inbound/Outbound-Konkurrenz, DST und Tageswechsel.
2. Timeout nach serverseitigem Route-Erfolg injizieren und beweisen, dass kein zweiter unbelegter Batch entsteht.
3. Legacy-DHL-Refresh in denselben atomaren Budgetpfad aufnehmen und testen.
4. TLS-verifiziertes internes/oeffentliches Ziel mit `retryOnFail=false` oder durable Request-Receipt validieren.
5. Quota-leer, 401/403, 429, 5xx, malformed JSON, no-events und already-registered replayen.
6. Trello-zu-DB-Intake gegen DB-kanonischen Ersatz im Shadow-Modus vergleichen.
7. Incident-Aktionen und Lieferschein mit synthetischen, nicht personenbezogenen Daten E2E testen.
8. Rollback und Reapply der Cap-Migration auf isoliertem Postgres ausfuehren.

## Safety Review Ergebnis

Die Workflows sind strukturell innerhalb der 30-Node-Grenze, haben je einen Trigger und keine AI-Nodes. Das Handoff ist nutzbar, aber Produktarbeit bleibt durch die High-Risiken zu Cap-Semantik, TLS/POST-Retry und Trello-Autoritaet priorisiert. Scorecard und Fix-Reihenfolge stehen in [KNOWN-ISSUES.md](./KNOWN-ISSUES.md).
