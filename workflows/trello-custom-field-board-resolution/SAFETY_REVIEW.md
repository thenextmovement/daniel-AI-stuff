# Safety Review

## Findings

- P1 behoben: Der Workflow lud Custom Fields statisch von Quentin, obwohl die Ziel-List-ID inzwischen zum Anfrage-Management-Board gehört. Gleich benannte Felder haben dort andere IDs; dadurch scheiterten beide natürlichen Anfragen mit `404 Custom Field not found`.
- P1 behoben: Der Patch bindet alle Felddefinitionen an `Create Trello Card.idBoard` und verwirft boardfremde Ergebnisse vor jedem Schreibversuch.
- P2 bestehend: Der Workflow hat 38 Nodes. Der Hotfix ändert weder Node-Anzahl noch Topologie; eine Aufteilung bleibt separate Arbeit.
- P2 bestehend: Das vorhandene generische Retry unterscheidet nicht zwischen 404 und 429/5xx. Die neue deterministische Vorvalidierung verhindert den konkreten 404, ohne den bestehenden Fehlerpfad riskant umzubauen.

## Scorecard

| Dimension | Score | Notes |
| --- | ---: | --- |
| correctness | 5 | Felder und Option werden ausschließlich vom tatsächlichen Kartenboard aufgelöst und typgeprüft. |
| reliability | 4 | Deterministische Vorvalidierung und bestehendes begrenztes Retry; historisch großer Workflow bleibt Restrisiko. |
| idempotency | 5 | Beide PUTs setzen dieselben Werte wiederholbar; bestehende Request-ID-Deduplizierung bleibt erhalten. |
| observability | 4 | Board-ID, Feldname und Idempotency-Key sind im Node-Input sichtbar; bestehender globaler Error Workflow bleibt aktiv. |
| security | 5 | Bestehende n8n-Credential bleibt unverändert; keine Tokens oder freien Ziel-URLs im Patch. |
| tracking impact | 5 | Keine Änderung an Ads-, Analytics-, CRM- oder Attributionsevents. |
| cost risk | 5 | Keine neuen AI-Aufrufe oder externen Side Effects; ein bestehender Board-GET und zwei PUTs bleiben erhalten. |

## Required Fixes

- Vor Live-Mutation aktuelle Version und vollständigen Workflow sichern.
- Patch gegen einen aktuellen Live-Snapshot testen und vollständigen Struktur-Diff auf genau zwei Parameter begrenzen.
- n8n-Validator vor und nach dem Rollout ausführen.
- Nach Rollout mindestens eine natürliche Ausführung rücklesend kontrollieren; keine Testkundenkommunikation erzeugen.

## QA Plan

Unit- und Patch-Idempotenztests, Live-Snapshot-Patchtest, n8n-Validierung, vollständiger Vorher-/Nachher-Strukturvergleich und rücklesende Kontrolle der nächsten natürlichen Ausführung.

## Rollback

Unmittelbar vor der Mutation gespeicherte n8n-Version zurückrollen. Code-PR separat revertieren. Es gibt keine Daten- oder Trello-Feldmigration.
