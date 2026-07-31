# TICKET-088 Rollout State

## Inaktive n8n-Previews

| Rolle | Workflow-ID | Status |
|---|---|---|
| Hauptworkflow | `pp3hOVlqekA00ymn` | inaktiv, n8n-validiert |
| Technischer Error-Workflow | `eBuHOnz94HqwgDxV` | inaktiv, n8n-validiert |
| Read-only QA-Harness | `OmkP8gKSUgZpWLq9` | inaktiv, n8n-validiert, kein Outlook-Knoten |

Alle drei Workflows wurden am 2026-07-31 auf `https://fuajob.online`
erstellt. Keiner wurde aktiviert und keine E-Mail wurde versendet.

## Noch gesperrt

- Der n8n-MCP-Test fuer einen Webhook erfordert eine aktive Workflow-Version.
  Der QA-Harness wurde deshalb nicht ausgefuehrt.
- Fuer den aktuellen Direktvergleich wird eine eng begrenzte Freigabe
  benoetigt, den mailfreien QA-Harness kurz zu aktivieren, einmal auszufuehren
  und unmittelbar wieder zu deaktivieren.
- Haupt- und Error-Workflow duerfen erst nach fertigem Draft-PR, erneuter
  Konflikt-/Testpruefung und ausdruecklicher Produktionsfreigabe aktiviert
  werden.

## Aktivierungsreihenfolge nach Freigabe

1. Aktuelle Workflow-Versionen und Inaktivitaet ruecklesen.
2. Error-Workflow `eBuHOnz94HqwgDxV` als Fehlerziel des Hauptworkflows
   verifizieren.
3. Hauptworkflow `pp3hOVlqekA00ymn` auf Zeitplan `0 18 * * *` und Zeitzone
   `Europe/Berlin` pruefen.
4. Error-Workflow und Hauptworkflow kontrolliert aktivieren.
5. Aktivstatus ruecklesen; keine manuelle Produktionsausfuehrung erzwingen.
6. Ersten regulaeren 18:00-Uhr-Lauf bis terminal verfolgen und Ergebnis,
   Shopify-Order-ID sowie Easybill-Dokument-ID pruefen.

## Rollback

Hauptworkflow sofort deaktivieren. Falls erforderlich auch den separaten
Error-Workflow deaktivieren und beide auf die vor Aktivierung gesicherten
n8n-Versionen zurueckrollen. Bestehende Sync-Workflows bleiben unveraendert.
