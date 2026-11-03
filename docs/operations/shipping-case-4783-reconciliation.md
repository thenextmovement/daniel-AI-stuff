# Versandfall #NEONT4783 – Abgleich 2026-11-03

Ziel: vorhandenes manuelles Label zuordnen und Zweitkauf verhindern.
Nachbar: AT-Freigabe, Lieferscheinstatus und Druck bleiben unverändert offen.
Wirkung: vorhandene DPD-Nummer im kanonischen Fall; kein Kauf, Druck oder Kundenversand.

Belege: EasyDPD-Archiv: genau eine Zeile, 28.10.2026 11:15, Classic, 01476813229337. Shopify: dieselbe Nummer im Fulfillment vom 28.10.2026 10:15:11Z. Keine Ersatzrunde, keine zusätzlichen Pakete im aktuellen Fall; null Kauf- und Druckjobs.

Live umgesetzt und zurueckgelesen: 03.11.2026 09:11:41.200975Z. `existing_dpd_tracking`
ist `01476813229337`; `status` und `delivery_note_status` bleiben `manual_review`.
Der bestehende Arrival-Code behandelt eine zugeordnete vorhandene DPD-Nummer bereits als
behandelten Label-Fall; keine neue Kauf- oder Druckaktion wurde ausgeloest.
Die zusaetzliche DPD-AT-Webabfrage lieferte keine auswertbaren Sendungsdetails. Deshalb
wird weder Druck noch Zustellung allein aus dem vorhandenen Label abgeleitet.

Vorher (nur geänderte Felder und Parallelitätsmarker):
```json
{
  "id": "ed76c5d3-1501-4f25-9741-0295dde9270d",
  "existing_dpd_tracking": null,
  "manual_review_reason": "Shopify enthaelt Zusatzfelder ausserhalb des freigegebenen NEONTRIP-Angebotsformats. Sendungen nach AT einschliesslich Lieferscheinen werden vorerst manuell bearbeitet.",
  "updated_at": "2026-11-03 09:08:52.443+00"
}
```

Rollback nur nach erneutem Abgleich mit aktuellem Scheduler-Stand: die in `arrival_label_events` unter `manual-label-reconciliation:NEONT4783:01476813229337:v1` gesicherten vorherigen Felder wiederherstellen. Dadurch würde die Zweitkauf-Sperre aus dem zugeordneten Label entfallen; nicht automatisch zurücksetzen.
