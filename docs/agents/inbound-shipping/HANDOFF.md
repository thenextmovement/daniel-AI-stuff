# Inbound Shipping Handoff

Stand: 2026-07-21. Verifiziert gegen Ops `origin/main` auf Commit `c76e7e526bf0933b47b1b68936601137f7721309` sowie read-only gegen die veroeffentlichten n8n-Versionen.

Parent-Agent: `logistics-fulfillment-agent`

## Evidenzstatus

- `[verifiziert]`: durch aktuellen Code, Git, Tests, CI oder einen in [VERIFICATION.md](./VERIFICATION.md) genannten read-only Check belegt.
- `[historisch verifiziert]`: datierter Produktionsbefund aus dem uebergebenen Verlauf; heute nicht erneut gegen das betreffende Live-System geprueft.
- `[aus Code abgeleitet]`: belastbare Schlussfolgerung aus dem aktuellen Code, aber kein Nachweis des heutigen Produktionsverhaltens.
- `[Live-Evidenz fehlt]`: nur mit aktuellem Provider-, Datenbank- oder End-to-End-Zugriff bestaetigbar.
- `[offen]`: bekanntes Risiko oder noch nicht entschiedene Zielarchitektur.

## Kanonische Rolle

- `[verifiziert]` Wiederkehrende Registrierung und Synchronisierung sind ein deterministischer Loop: Schedule -> Zeitfenster-Gate -> authentifizierte Ops-Route -> atomarer Postgres-Claim -> 17TRACK-Aufruf -> persistiertes Ergebnis/Incident.
- `[verifiziert]` Das Agentenprofil ist ausschliesslich fuer Diagnose, Evidenzsammlung, Ausnahmebewertung und die Vorbereitung reversibler Aenderungen bestimmt. Es plant oder startet keine wiederkehrenden Registrierungen und fuehrt keine Provider-, Kunden- oder Produktionsaktion aus.
- `[verifiziert]` `schedule_supported` ist deshalb in [agent.json](./agent.json) `false`.
- `[verifiziert]` Die beiden veroeffentlichten n8n-Workflows enthalten keine AI-Nodes. Fachliche Statusabbildung, Claims und Idempotenz liegen in Code und Postgres.

## Aktueller Befund

- `[verifiziert]` `NEONTRIP Inbound Shipping Agent v0.1` (`rYmSl4D0nNmEEU0M`) und `NEONTRIP Shipping Agent v0.1` (`QtG2XHw7DsvOEPtQ`) sind aktiv. Beide haben einen stuendlichen Trigger und einen aktivierten `17TRACK: Gate 09/11/13`, der nur um 09:00, 11:00 und 13:00 Uhr Europe/Berlin weiterleitet.
- `[verifiziert]` Pro freigegebenem Fenster ruft n8n zuerst die Registrierungsroute mit `limit: 20` und danach die Sync-Route mit `limit: 20` auf.
- `[verifiziert]` Inbound registriert DHL/FedEx; Outbound registriert DHL/DPD. DHL Express und FedEx erhalten feste 17TRACK-Carrier-IDs, DPD nutzt Provider-Erkennung.
- `[verifiziert]` Ops Supabase speichert Sendungen, Registrierungen, Tracking-Events und Incidents. Event- und Registrierungs-Keys verhindern normale Replay-Duplikate.
- `[verifiziert]` Der als Daily Cap bezeichnete SQL-Mechanismus begrenzt die pro Berliner Kalendertag beruecksichtigten Registrierungszeilen auf 100, zaehlt aber nicht jeden erneuten Provider-Aufruf. Wiederholungen derselben Zeile und der DHL-Refresh im Sync koennen den tatsaechlichen Verbrauch ueber diese Zahl heben.
- `[verifiziert]` Die vier n8n-HTTP-Nodes fuer Registrierung/Sync verwenden derzeit `allowUnauthorizedCerts=true` und bis zu drei POST-Versuche. Das ist ein offenes Security-, Replay- und Kostenrisiko.
- `[verifiziert]` Der Inbound-Workflow liest neue Kandidaten weiterhin aus Trello. Das aktuelle Capability-Manifest markiert ihn deshalb als `source_of_truth_review_required`; Zielmodus ist `database_loop_trello_projection`.
- `[verifiziert]` Die fokussierten Inbound-/17TRACK-Tests sind 17/17 gruen. Der aktuelle Main-Commit hat zudem einen erfolgreichen CI-Lauf mit kompletter Quote-Suite, Typecheck und Produktions-Build.
- `[Live-Evidenz fehlt]` Aktueller 17TRACK-Kontostand, heutiger Datenbank-Backlog, aktueller Quota-Verbrauch und ein realer Lauf mit neu gekauften Credits wurden nicht geprueft.

## Historischer Kontext

- `[historisch verifiziert]` Am 2026-07-15 waren in den letzten 30 Tagen 224 Registrierungszeilen versucht und 155 erstmals akzeptiert worden. 52 Rows trugen den Fehler `Quota is not enough for use.`; dieser Befund ist kein aktueller Kontostand und keine exakte API-Call-Zaehlung.
- `[historisch verifiziert]` Als kleinste damals sichtbare Kaufoption wurden 5.000 Quota fuer USD 119 diskutiert. Ein Kauf ist im Verlauf nicht nachgewiesen und darf nicht durch diesen Agenten ausgeloest werden.
- `[historisch verifiziert]` Die Drosselung auf 09:00/11:00/13:00 und die Migration `9ab2081` wurden am 2026-07-02 eingefuehrt. Der zugehoerige CI-/Deploy-Lauf war erfolgreich.

## Einstieg

1. Architektur, Datenfluesse und Besitzgrenzen: [SYSTEM-MAP.md](./SYSTEM-MAP.md)
2. Dauerhafte und historische Entscheidungen: [DECISIONS.md](./DECISIONS.md)
3. Diagnose, Ausnahmebearbeitung und Rollback: [OPERATIONS.md](./OPERATIONS.md)
4. Priorisierte Risiken und Safety Score: [KNOWN-ISSUES.md](./KNOWN-ISSUES.md)
5. Reproduzierbare Verifikation und fehlende Live-Evidenz: [VERIFICATION.md](./VERIFICATION.md)
6. Maschinenlesbares Profil: [agent.json](./agent.json)

## Nicht verhandelbare Grenzen

- Keine Provider-Registrierung, kein manueller Workflow-Trigger, keine Workflow-Aktivierung und keine produktive Datenmutation aus dem Diagnose-Agenten.
- Keine Kundenkommunikation. Die Inbound-Alerts sind intern; jede spaetere kundenwirksame Funktion braucht deterministische Validierung und ausdrueckliche Freigabe.
- Keine Quota- oder Tarifkaeufe. Das bleibt eine manuelle Account-Owner-Entscheidung.
- Keine Secret-Werte lesen, ausgeben oder dokumentieren. Runbooks nennen nur Variablennamen und Auth-Grenzen.
- Trello nicht als fachliche Wahrheit behandeln. Der aktuelle Trello-Intake ist eine dokumentierte Architekturluecke, keine Zielentscheidung.
- Neue Arbeit nur mit `codex-new-worktree ops <topic>`. Vor jedem Ops-Deploy `codex-predeploy ops`; nur dessen exakten Commit deployen und nur mit ausdruecklicher Freigabe pushen/deployen.
- n8n-Aenderungen nur mit Vollbackup, strukturellem Diff, inaktiver/strikter Validierung und getesteter Rollback-Version.

## Scope dieser Wissensmigration

- Dokumentiert sind Inbound-Board/API, 17TRACK-Registrierung und -Sync fuer Inbound und Outbound, Quota-Steuerung, Incidents, manuelle Ausnahmeaktionen, aktuelle n8n-Struktur, Migrationen, Rollbacks, Tests und relevante Git-Historie.
- Nicht geaendert wurden Produktlogik, Datenbank, n8n, Coolify, Providerkonten oder Kundenkommunikation.
- Es wurden keine personenbezogenen Live-Datensaetze, Credential-Werte oder Execution-Payloads in das Paket uebernommen.
