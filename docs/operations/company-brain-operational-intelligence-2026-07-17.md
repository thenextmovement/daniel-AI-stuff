# Company Brain Operational Intelligence

Stand: 2026-07-17

## Ziel und Grenze

Das Company Brain verdichtet technische und fachliche Belege zu einer kurzen, nachvollziehbaren Diagnose und einer klaren nächsten Mitarbeiteraktion. Es erkennt offene Probleme außerdem proaktiv und zeigt sie im Cockpit, auch bevor ein Mitarbeiter einen Trello-Link eingibt.

Postgres und die jeweiligen Fachsysteme bleiben Source of Truth. Trello ist nur Projektion. Die KI erklärt vorhandene Belege; sie wählt oder startet keine Aktion, sendet keine Kundenkommunikation und verändert keine Produktions-Workflows. Alle ausführbaren Aktionen bleiben deterministisch, idempotent und rollenbasiert.

## Mitarbeiterablauf

### Ein einzelner Problemfall

1. Trello-Link, Request-ID, Angebotsnummer oder E-Mail im Company Brain suchen.
2. Zuerst die Kurzdiagnose lesen: Problem, belegte Ursache, Unsicherheit und nächste Aktion.
3. Im Fix Center nur die angebotene deterministische Aktion ausführen. Gesperrte Aktionen zeigen ihren konkreten Blocker.
4. Nach dem Fix den Fall erneut prüfen. Erst ein neuer positiver Beleg schließt das Problem fachlich.
5. Kundenkontakt bleibt bei fehlender Zustell-, Farb- oder Freigabe-Evidenz gesperrt.

### Proaktive Problemwarteschlange

Unter `/ops/company-brain/governance` startet die Ansicht `Probleme` als Cockpit. Sie zeigt kritische und offene Incidents nach Schweregrad und Aktualität. Mitarbeiter können:

- ein Problem übernehmen oder als gesehen markieren,
- den verknüpften Fall öffnen,
- den passenden Playbook-Ablauf lesen,
- eine belegte Lösung mit verpflichtender Notiz abschließen.

Nur `automation_admin` oder `company_admin` dürfen einen Incident ignorieren. Ignorierte Incidents werden vom Scanner nicht automatisch wieder geöffnet. Ein gelöster Incident kann bei einem neuen Fehlerbeleg wieder geöffnet werden.

## Architektur

### Incident Control Plane

- `company_brain_operational_incidents`: aktueller, idempotenter Problemzustand je Fingerprint.
- `company_brain_incident_events`: unveränderliche Historie jeder Erkennung und Statusänderung.
- `company_brain_playbooks`: versionierte Diagnose-, Sicherheits-, Eskalations- und Verifikationsschritte.
- `scan_company_brain_operational_incidents()`: deterministischer Scanner für Workflowfehler, festhängende Aktionen, Identitätskonflikte und offene Datenqualitätsprobleme.
- `upsert_company_brain_incident(...)`: atomare Erkennung, Aktualisierung und kontrollierte Wiedereröffnung.
- `transition_company_brain_incident(...)`: atomare Mitarbeitertransition mit Actor und verpflichtender Abschlussnotiz.

Der Scanner läuft alle fünf Minuten über `pg_cron`. Zusätzlich kann ein Operator im Cockpit eine sofortige Prüfung auslösen. Ein späterer erfolgreicher Workflowbeleg löst einen passenden offenen Workflow-Incident automatisch auf; reines Verstreichen von Zeit gilt nicht als Erfolg.

### Beleggebundene KI-Zusammenfassung

Die KI erhält nur einen begrenzten, bereinigten Fallkontext. Quelltexte gelten ausdrücklich als nicht vertrauenswürdige Daten. Tool-Aufrufe, Aktionsauswahl und Side Effects sind deaktiviert. Die Antwort muss das strikte JSON-Schema erfüllen und mindestens eine bekannte Evidence-ID zitieren, sofern Fallbelege existieren. Unbekannte Zitate werden verworfen; eine Ausgabe ohne gültigen Beleg wird komplett verworfen.

Bei Timeout, fehlendem API-Key, Schemafehler oder unbelegter Antwort bleibt die deterministische Diagnose vollständig verfügbar. Die nächste Aktion und die Kundenkontaktregel stammen immer aus der Regel-Engine, nicht aus dem Modell.

Optionale Runtime-Variablen:

```text
COMPANY_BRAIN_OPENAI_API_KEY
COMPANY_BRAIN_OPENAI_MODEL
```

Bestehende Ops/OpenAI-Variablen dienen als Fallback. Secrets dürfen weder in Logs noch in Incident-Metadaten gespeichert werden.

## Playbooks

Die erste Version deckt insbesondere folgende Ursachen ab:

- ungültige oder fehlende Kunden-E-Mail,
- fehlgeschlagene oder unbelegte Zustellung,
- Trello-/Request-/Offer-Zuordnungskonflikte,
- abgelehnte Video-Inhaltsprüfung,
- fehlgeschlagene Asset-Verarbeitung,
- Offer-API-Fehler,
- allgemeine harte Workflowfehler,
- festhängende Action-Runs,
- Identitätskonflikte,
- Datenqualitätsprobleme.

Ein Playbook beschreibt Diagnose, risikoarme Aktionen, verbotene Aktionen, Eskalation und den erforderlichen Erfolgsbeleg. Playbooks führen selbst keine Aktion aus.

## Rollen und Sicherheit

- `operator`: lesen, scannen, übernehmen und mit Belegnotiz lösen.
- `approver`: zusätzlich sensible Action-Runs freigeben.
- `automation_admin`: zusätzlich Incidents ignorieren und Automation-Inventar verwalten.
- `company_admin`: alle Company-Brain-Rechte.

Explizite Rollenzuweisungen können über `company_brain_actor_roles.expires_at` ablaufen. Danach gilt nur die normale, niedrigere Standardrolle. API-Antworten sind privat und `no-store`; interne Supabase-Fehlerdetails werden nicht an Clients ausgegeben. Neue Tabellen und RPCs sind ausschließlich für `service_role` verfügbar.

## Betriebsprüfung

Nach App- oder Schemaänderungen müssen mindestens folgende Prüfungen laufen:

1. `npx tsc --noEmit`
2. `npm run test:quotes`
3. `npm run build:voice-runtime`
4. `npm run build`
5. Company-Brain- und Governance-UI-Smokes auf Desktop und Mobile
6. Migrationslauf plus Scanner-Assertions in einer Transaktion mit Rollback
7. `codex-predeploy ops`
8. Deploy ausschließlich des vom Predeploy ausgegebenen Commits
9. Live-Prüfung von Tabellen, Playbooks, Cron-Job, Incident-Events und geschützter App

## Rollback

Die Datenbank-Rücknahme liegt unter:

`supabase/rollbacks/20260717073542_company_brain_operational_intelligence_rollback.sql`

Vor dem Schema-Rollback muss zuerst eine App-Version ohne Zugriff auf die neuen Tabellen und RPCs ausgerollt werden. Der Rollback entfernt den Cron-Job, Funktionen, Tabellen, Index und Rollen-Ablaufspalte. Incident-Historie wird dabei gelöscht und muss bei notwendiger Aufbewahrung vorher exportiert werden.

## Bewusste Restgrenzen

- Ein technischer Erfolg ist erst mit einem neuen Quellbeleg abgeschlossen, nicht durch eine KI-Aussage.
- Outlook-Spiegel und Live-Graph haben unterschiedliche Beweiskraft; ein Spiegelbeleg darf keinen Live-Zustellbeleg vortäuschen.
- Die erste Scanner-Version deckt strukturierte Audit-, Action-, Identity- und Quality-Signale ab. Neue Fehlertypen brauchen einen stabilen Fehlercode und ein versioniertes Playbook.
- Ein Fix am Produktions-Workflow bleibt ein Engineering-Vorgang mit Backup, Diff, Test und Rollback. Das Cockpit ersetzt dieses Gate nicht.
