# TICKET-088: Shopify ↔ Easybill Daily Reconciliation

## Plan

Ein neuer, eigenstaendiger n8n-Workflow liest jeden Tag um 18:00 Uhr
Europe/Berlin die Shopify-Bestellungen der letzten 14 Tage. Er waehlt die
neueste nicht stornierte Bestellung, die vor dem Sicherheits-Cutoff 14:55 Uhr
angelegt wurde. Easybill importiert um 11:00 und 15:00 Uhr; die fuenf Minuten
Abstand zum zweiten Import verhindern Fehlalarme fuer Bestellungen genau am
Import-Rand. Anschliessend liest der Workflow in Easybill die Rechnung mit
derselben normalisierten Nummer und vergleicht deterministisch:

1. Shopify-Ordernummer gegen Easybill-Rechnungsnummer
2. Shopify-Bruttobetrag gegen Easybill-Betrag in Cent
3. Kunde zuerst ueber E-Mail, ersatzweise ueber normalisierten Namen

Nur bei einer Abweichung wird spaeter eine interne E-Mail von
`support@neontrip.de` an `info@NeonTrip.de` mit dem Betreff
`Easy Bill & Shopify Abweichung` gesendet. Technische Fehler nutzen denselben
Betreff ueber einen getrennten Error-Trigger-Workflow.

## Node Structure

### Hauptworkflow

1. `Daily 18:00 Europe/Berlin` — einziger Trigger
2. `Read Shopify Orders` — read-only API, drei begrenzte Versuche
3. `Select Latest Eligible Order` — Cutoff-, Storno- und Feldvalidierung
4. `Read Easybill Invoice` — read-only Suche ueber die Rechnungsnummer
5. `Prepare Invoice Lookup` / `Invoice Found?` — deterministische Auswahl
6. `Read Easybill Customer` — read-only Kundenzuordnung
7. `Build Comparison` oder `Build Missing Invoice Result`
8. `Mismatch?` — trennt OK und Alarm
9. `Prepare Alert` / `Notification Idempotency`
10. `Send Internal Alert` — nur im Abweichungszweig
11. `Mark Alert Sent` oder `Record OK` — sichtbarer Abschluss

### Error-Workflow

`Error Trigger` → sichere Fehleraufbereitung → Idempotenz → interne E-Mail →
Versandmarkierung.

### QA-Workflow

Der inaktive Webhook-Harness enthaelt nur die read-only Vergleichskette und
keinen Outlook-Knoten. Er dient dem einmaligen aktuellen Abgleich und darf nur
nach ausdruecklicher Freigabe kurz aktiviert, einmal ausgefuehrt und sofort
wieder deaktiviert werden.

## Datenvertrag

- Shopify ist Quelle fuer Order-ID, Ordernummer, Bruttobetrag, Kunde und
  Erstellzeitpunkt.
- Easybill ist Quelle fuer Rechnungsnummer, Rechnungsbetrag und
  Rechnungskunde.
- Der veraltete Easybill-Supabase-Spiegel wird nicht als aktueller Beweis
  verwendet.
- Betragsvergleich erfolgt in ganzzahligen Cent, nicht als Float.
- Fuehrendes `#`, Gross-/Kleinschreibung und Leerraum werden bei der Nummer
  normalisiert; andere echte Nummernunterschiede bleiben sichtbar.
- Die Easybill-API-Suche verwendet die originale Shopify-Nummer inklusive
  fuehrendem `#`, weil Easybill aktuelle Rechnungen genau so speichert.

## Tests

```bash
node workflows/shopify-easybill-reconciliation/build-workflows.mjs
node --test workflows/shopify-easybill-reconciliation/test-workflows.mjs
```

Danach alle drei JSON-Dateien mit n8n validieren. Der QA-Harness wird inaktiv
erstellt und einmal per Test-Webhook ausgefuehrt. Dabei darf kein E-Mail-Knoten
vorhanden sein.

## Rollback

- Vor Aktivierung bleiben alle neuen Workflows inaktiv.
- Nach einer spaeteren Aktivierung: Hauptworkflow sofort deaktivieren und auf
  die gesicherte n8n-Version zurueckrollen.
- Bestehende Shopify-, Easybill-, Outlook- und Sync-Workflows werden nicht
  veraendert.
- Der QA-Harness bleibt inaktiv und kann nach dokumentierter Verifikation
  kontrolliert entfernt werden.
