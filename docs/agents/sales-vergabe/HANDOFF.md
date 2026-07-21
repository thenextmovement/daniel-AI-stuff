# Sales-Vergabe Agent Handoff

Stand: 2026-07-21, verifiziert gegen Ops `origin/main` auf Commit `d3e14db4e1da447cf18ec0d328c63827f81bd9f1`.

## Evidenzstatus

- `[verifiziert]`: durch Datei, Test, Git-Historie oder einen ausdrücklich genannten Read-only-Check belegt.
- `[aus Git/Code abgeleitet]`: Schlussfolgerung aus vorhandenem Code; kein Beleg für den aktuellen Produktionszustand.
- `[nur aus Thread erinnert]`: im alten Arbeitschat berichtet, aber in dieser Übergabe nicht unabhängig bestätigt.
- `[offen]`: ungeklärt oder mit widersprüchlicher Evidenz.

## Aktueller Befund

- `[verifiziert]` Die Sales-Vergabe ist im aktuellen Code keine reine Shopify-Liste. Angenommene Angebote werden direkt als `offer.completed` an die Ops-API übertragen; ein Offers-Pull und ein Shopify-Import dienen als Wiederherstellung beziehungsweise Fallback.
- `[verifiziert]` Die operative Vergabe und ihre Idempotenz werden in den Supabase-Tabellen `supplier_sales`, `supplier_sale_items`, `supplier_sale_events`, `supplier_assignment_attempts` und `supplier_payment_reminders` geführt. Trello ist nur Projektion.
- `[verifiziert]` Bezahlte offene Sales werden zuerst, unbezahlte Bestandskunden mit früher nachgewiesener Zahlung direkt danach und übrige aktive Sales anschließend sortiert.
- `[verifiziert]` Das offene 24-Stunden-Änderungsfenster blockiert die Vergabe nicht. Eine tatsächlich angeforderte und noch nicht quittierte Änderung blockiert sie serverseitig.
- `[verifiziert]` Die Standard-Tags lauten exakt `Quentin (noch bezahlen)` und `Saeid (schon bezahlt)`. Vorhandene Supplier-Tags und abgeschlossene Fulfillment-Status werden beim Shopify-Abgleich aus der aktiven Liste entfernt.
- `[verifiziert]` Kundenauswahl, Menge, Größe, Breite, Höhe, Farbe, Zuschnitt, Rückseite, Montage und Outdoor-Merkmale können aus dem gespeicherten `offer_snapshot` in der UI angezeigt werden, sofern die Quelldaten sie enthalten.
- `[verifiziert]` Fokussierte Tests, vollständige Quote-Test-Suite, TypeScript-Prüfung und Produktions-Build sind am Verifikationsstand grün. Der vorhandene UI-Smoke-Test ist wegen eines nicht deterministischen Filterwechsels rot; Details stehen in [VERIFICATION.md](./VERIFICATION.md).
- `[offen]` Der aktuelle produktive n8n-Aktivierungszustand, aktuelle Coolify-Variablen und ein echter End-to-End-Lauf mit Kundenmail und Trello-Projektion wurden in dieser Read-only-Übergabe nicht bestätigt.
- `[verifiziert]` Im Repository besteht ein Schema-/Code-Widerspruch bei neueren `supplier_sale_events.event_type`-Werten. Das kann Audit-Ereignisse unbemerkt verwerfen und ist vor weiterer Funktionsarbeit zu beheben.

## Einstieg

1. `[verifiziert]` Architektur, Datenflüsse und Einstiegspunkte: [SYSTEM-MAP.md](./SYSTEM-MAP.md)
2. `[verifiziert]` Festgelegte Geschäfts- und Architekturentscheidungen: [DECISIONS.md](./DECISIONS.md)
3. `[verifiziert]` Diagnose, Tests, Deploy-Gates und Rollback: [OPERATIONS.md](./OPERATIONS.md)
4. `[verifiziert]` Priorisierte Fehler, Risiken und offene Punkte: [KNOWN-ISSUES.md](./KNOWN-ISSUES.md)
5. `[verifiziert]` Reproduzierbare Belege und Testergebnisse: [VERIFICATION.md](./VERIFICATION.md)
6. `[verifiziert]` Maschinenlesbares Agentenmanifest: [agent.json](./agent.json)

## Nicht verhandelbare Grenzen

- `[verifiziert]` Neue Ops-Arbeit beginnt mit `codex-new-worktree ops <topic>`, nicht im alten Main-Checkout `/Users/danielklesse/Desktop/neontrip-ops-coolify`.
- `[verifiziert]` Vor jedem Ops-Deploy ist `codex-predeploy ops` Pflicht; deployt werden darf nur der dort ausgegebene Commit.
- `[verifiziert]` Ein Push auf `main` kann über `.github/workflows/deploy-coolify.yml` Produktion verändern und benötigt deshalb eine ausdrückliche Freigabe.
- `[verifiziert]` Keine produktiven n8n-, Supabase-, Shopify-, Trello-, Coolify- oder E-Mail-Mutationen ohne Backup, Diff, Rollback und explizite Zustimmung.
- `[verifiziert]` Keine Secrets lesen, protokollieren, dokumentieren oder committen. Nur Variablennamen dürfen in Runbooks stehen.
- `[verifiziert]` Keine ungeprüfte Kundenkommunikation; UI-Aktionen mit E-Mail- oder Produktionswirkung müssen bestätigt, validiert und idempotent sein.
- `[verifiziert]` Trello ist niemals Source of Truth.

## Scope dieser Übergabe

- `[verifiziert]` Dokumentiert sind Sales-Vergabe-UI, API und Domänenlogik, Offer-Annahme, Completed-Offers-/Shopify-Abgleich, Zahlungs- und Bestandskundenlogik, Supplier-Zuweisung, PDF/E-Mail-Pfade, Trello-Projektionen, statische n8n-Entwürfe, Tests, Migrationen und relevante Git-Historie.
- `[verifiziert]` Es wurden keine produktiven Daten, Secret-Werte oder personenbezogenen Live-Datensätze in dieses Paket übernommen.
- `[offen]` Behauptungen aus dem alten Chat, die nur über eingeloggte Produktionsoberflächen oder externe Systeme prüfbar wären, bleiben ausdrücklich als nicht verifiziert markiert.
