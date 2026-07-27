# Safety Review

## Findings

- P1: Der unstrukturierte Eingang setzte Product 1 bisher pauschal auf Neon und konnte 3D-Anfragen falsch vorbelegen. Der Patch entfernt diese Annahme.
- P1: Product 2 darf von keinem aktiven Workflow geschrieben werden. Die Inventur und Tests prüfen diese Negativbedingung.
- P2: Der LP-Workflow überschreitet bereits vor dieser Änderung die empfohlene 30-Node-Grenze. Der Patch fügt dort keine Nodes hinzu.

## Scorecard

| Dimension | Score | Notes |
| --- | ---: | --- |
| correctness | 5 | Allowlist, unbekannte Werte bleiben leer, Product 2 bleibt manuell. |
| reliability | 4 | Trello-PUT mit drei Versuchen; vorhandene Workflowgröße bleibt technisches Risiko. |
| idempotency | 5 | Wiederholtes Setzen desselben Dropdownwerts und erneutes Patchen sind idempotent. |
| observability | 4 | n8n-Execution-Logs und globaler Error Workflow vorhanden; kein separates Produktmetrik-Dashboard. |
| security | 5 | Keine neuen Secrets, keine freie URL und nur ein festes Trello-Custom-Field. |
| tracking impact | 5 | Keine Änderung an Ads-, Analytics- oder Attributionsevents. |
| cost risk | 5 | Keine zusätzlichen AI-Aufrufe; maximal ein kleines Trello-PUT pro Anfrage. |

## Required Fixes

- Vor Rollout aktuelle Workflow-Versionen und inaktive Vollbackups sichern.
- Nach Rollout die Negativprüfung auf Product-2-Schreiber wiederholen.
- E2E nur mit freigegebener Testkarte und ohne Kundenmail.

## QA Plan

Siehe README: Unit-Tests, Workflowvalidierung, Diff gegen Live-Version und kontrollierter Testkartendurchlauf.

## Rollback

Gesicherte n8n-Versionen wiederherstellen; bei Offers-Regression vorherigen erfolgreichen `main`-Deploy aktivieren.
