# Safety Review — TICKET-088

## Findings

### High

- Produktive Aktivierung oder echter E-Mail-Versand vor Dry-Run, n8n-
  Validierung und erneuter Freigabe ist gesperrt.
- Ein Vergleich gegen den veralteten Easybill-Supabase-Spiegel wuerde falsche
  Alarme erzeugen. Der Workflow liest Easybill deshalb direkt.

### Medium

- Shopify-Bestellungen nach 11:15 Uhr duerfen am selben Tag nicht als fehlende
  Easybill-Rechnung gemeldet werden. Der Cutoff ist fest auf Europe/Berlin
  gesetzt.
- Kundennamen koennen sich syntaktisch unterscheiden. E-Mail ist der primaere
  Match, ein normalisierter Name nur der deterministische Fallback.
- Ein unsicherer Outlook-Versand kann technisch nicht exakt-once garantiert
  werden. Der taegliche Business-Alarm wird per Workflow-Static-Data und
  stabilem Fingerprint dedupliziert; ein unklarer Versandfehler bleibt im
  Error-Log sichtbar.

### Low

- Der Shopify-REST-Endpunkt entspricht dem bereits produktiv verwendeten
  Credential-/API-Pfad. Eine spaetere Migration auf Shopify GraphQL ist ein
  separater Auftrag.

## Scorecard

| Dimension | Score | Notes |
| --- | ---: | --- |
| correctness | 4 | Cent-Vergleich, exakte Nummer und deterministischer Kunde; Live-Dry-Run steht aus. |
| reliability | 4 | Begrenzte Retries und eigener Error-Workflow; externe APIs bleiben Abhaengigkeiten. |
| idempotency | 4 | Stabiler taeglicher Fingerprint vor internem E-Mail-Side-Effect. |
| observability | 4 | Correlation-ID, Workflow-/Execution-/Order-/Document-IDs in Ausfuehrungsdaten. |
| security | 4 | Credentials nur referenziert; keine Secrets oder Kundendaten im Repository. |
| tracking impact | 5 | Keine GA4-, Ads- oder Conversion-Aenderung. |
| cost risk | 5 | Ein taeglicher Lauf, begrenzte API-Aufrufe, E-Mail nur bei Abweichung. |

## Required Fixes

- Inaktiven QA-Harness validieren und mit dem aktuellen Shopify-Kandidaten
  gegen Easybill ausfuehren.
- Hauptworkflow-ID und Error-Workflow-ID nach Erstellung dokumentieren.
- Vor Aktivierung erneute ausdrueckliche Freigabe fuer fertigen PR, Ziel-IDs,
  Zeitplan und Empfaenger einholen.

## QA Plan

1. Unit-Tests fuer Nummer, Cent-Betrag, Kundenmatch und Topologie.
2. Generierte JSON-Dateien lokal parsen und mit n8n strikt validieren.
3. Inaktiven QA-Harness ohne Outlook-Knoten erstellen.
4. Aktuellen Kandidaten read-only gegen Easybill pruefen.
5. Haupt- und Error-Workflow inaktiv erstellen und erneut validieren.
6. Erst nach Freigabe aktivieren; anschliessend Workflowstatus, Zeitplan und
   ersten terminalen Lauf ruecklesen.

## Rollback

Hauptworkflow deaktivieren, gesicherte n8n-Version wiederherstellen und neuen
Error-Workflow abkoppeln. Bestehende Sync-Workflows und Geschaeftsdaten werden
nicht angefasst.
