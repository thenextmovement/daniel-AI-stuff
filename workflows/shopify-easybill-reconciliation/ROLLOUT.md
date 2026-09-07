# TICKET-088 Rollout State

## Inaktive n8n-Previews

| Rolle | Workflow-ID | Status |
|---|---|---|
| Hauptworkflow | `pp3hOVlqekA00ymn` | inaktiv, n8n-validiert |
| Technischer Error-Workflow | `eBuHOnz94HqwgDxV` | inaktiv, n8n-validiert |
| Read-only QA-Harness | `OmkP8gKSUgZpWLq9` | inaktiv, n8n-validiert, kein Outlook-Knoten |

Alle drei Workflows wurden am 2026-07-31 auf `https://fuajob.online`
erstellt. Der QA-Workflow wurde nach ausdruecklicher Freigabe nur fuer die
read-only Pruefung kurz aktiviert und danach wieder deaktiviert. Haupt- und
Error-Workflow wurden nicht aktiviert; keine E-Mail wurde versendet.

## Read-only QA-Ergebnis

- Finale Ausfuehrung: `4080504`, Status `success`.
- Der aktuelle Shopify-Kandidat vor dem 14:55-Uhr-Cutoff wurde in Easybill
  gefunden; Rechnungsnummer, Bruttobetrag und Kunde waren identisch.
- Der Test belegte, dass Easybill die aktuelle Rechnungsnummer inklusive
  fuehrendem `#` speichert. Die finale API-Suche verwendet deshalb die
  originale Shopify-Nummer und normalisiert erst beim Vergleich.
- QA-, Haupt- und Error-Workflow sind nach der Pruefung inaktiv.

## Noch gesperrt

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
