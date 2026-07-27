# TICKET-042: Trello Product Routing

## Plan

`Product 1` wird bei strukturierten Landingpage-Anfragen aus dem ersten Produktsegment des erzeugten Kartentitels gesetzt. Unstrukturierte Anfragen werden nicht mehr pauschal als Neon markiert; der Quoting Agent setzt `Product 1` nach validierter Produktklassifikation. `Product 2` bleibt ausschließlich manuell. Der bereits produktive Offers-Import verwendet Product 1/2 pro Design.

LED Neon Flex, LED Flex, Full Glow, Neon-Halo und Ultrathin Acrylic verwenden gemeinsam den Dropdownwert `LED Neon Flex / Full Glow`. Die Neon-Preisleiter bleibt durch die bestehende serverseitige Produktprüfung auf echte Neon-Strukturen begrenzt; Ultrathin, 3D und Lightbox werden übersprungen.

## Node Structure

1. Eingangstrigger der vorhandenen Workflows
2. Bestehende Schema- und Produktvalidierung
3. Deterministische Product-1-Zuordnung
4. Idempotentes Trello-PUT auf genau ein Custom Field
5. Bestehende Execution-Logs und globaler Error Workflow
6. Kein Schreiber auf Product 2

Betroffene produktive Workflows:

- `FQ7lf36yje4B1eE3` – LP Anfrage Webhook v1.0
- `AcYSau5MGsAxeAqL` – RH | Unstruktuierte Anfragen Aktiv
- `EtEpzMp10EmaqXIS` – NEONTRIP Quoting Agent v1 — Event Driven

## Risiken

- Der LP-Workflow hat historisch mehr als 30 Nodes. Diese Änderung fügt dort keine Nodes hinzu; eine spätere Aufteilung ist separat zu planen.
- Änderungen an Trello-Dropdown-IDs müssen kontrolliert in den Konstanten und im produktiven Workflow nachgezogen werden.
- Bei unbekanntem Produkttitel bleibt Product 1 bewusst leer, statt geraten zu werden.
- `3D Multi-Variant` setzt nur Product 1 auf Backlit. Product 2 bleibt für die manuelle Auswahl offen.

## Test Plan

- Alle erlaubten Titelvarianten einschließlich Ultrathin testen.
- Kundennamen und unbekannte Produkttypen dürfen keine Auswahl erzeugen.
- Quoting-Workflow zweimal patchen: keine doppelten Nodes oder Connections.
- Sicherstellen, dass kein aktiver Workflow Product 2 schreibt.
- n8n-Workflowvalidierung vor Aktivierung.
- E2E ausschließlich mit der freigegebenen Testkarte; Angebot bleibt Entwurf und es wird keine echte Kundenmail versendet.

## Rollback

- Vor jeder Mutation die n8n-Versionen der drei Workflows festhalten und Vollkopien inaktiv sichern.
- Bei Fehlern die gesicherte Version wiederherstellen.
- Offers-App bei Bedarf auf den unmittelbar vorherigen erfolgreichen `main`-Deploy zurückrollen.
- Die Testkarte in eine nicht versendende Liste zurückverschieben; keine Kundenaktion rückabwickeln, weil kein Kundenversand erlaubt ist.

## Lokale Prüfung

```bash
node --test workflows/trello-product-routing/test-product-routing.mjs
```
