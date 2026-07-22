# EasyDPD Browser-Worker – Safety Review und Betrieb

Stand: 2026-07-22

## Scope

Der Worker reserviert freigegebene Arrival-Label-Fälle aus Postgres, öffnet die konkrete Shopify/easyDPD-Bestellung in einem separaten lokalen Chrome-Profil, setzt das freigegebene Produkt, `Einzeln auf A6` und 500 g und klickt im Live-Modus genau einmal auf `Create label`. Die heruntergeladene PDF wird serverseitig geprüft, mit den letzten sechs Ziffern der eingehenden DHL-Sendungsnummer ergänzt, privat gespeichert und in die vorhandene A6-Druckqueue eingereiht. Die vorhandene Druck-/Archivkette archiviert die zugehörige DHL-Express-Mail erst nach bestätigt erfolgreichem Druck.

easyDPD erfüllt die Shopify-Bestellung und löst über seine bereits aktivierte Shopify-Einstellung die Versandbestätigung aus. Der Worker führt deshalb keine zweite Shopify-Fulfillment-Mutation und keinen separaten Kundenmail-Versand aus.

## Findings

### Hoch – Live-Freigabe bleibt bis zum kontrollierten Pilot gesperrt

Die easyDPD-Kaufseite zeigt vor `Create label` keinen maschinenlesbaren Preis. Die Datenbank verlangt deshalb eine von einem Menschen freigegebene Produktzuordnung mit einem festen Maximalpreis von höchstens 1.500 Cent. Daniel Klesse hat im Chat am 22.07.2026 die automatische Buchung bis 15,00 EUR freigegeben. Die geprüften UI-Labels sind `B2C`, `DPD Express 8:30`, `DPD Express 12:00` und `DPD Express 18:00`; EU-Standard verwendet ebenfalls `B2C`. Die vorbereitende Migration trägt diese Zuordnung ein, lässt `worker_enabled=false` und `live_purchase_enabled=false` aber bis zum lokalen Session-/Canary-Gate ausgeschaltet. Der fehlende maschinenlesbare Ist-Preis bleibt ein akzeptiertes Restrisiko und darf nicht als gemessener Preis protokolliert werden.

### Hoch – Separate Shopify-Sitzung muss einmalig verifiziert werden

Der LaunchAgent kann keine abgelaufene Shopify-Anmeldung reparieren. Vor Live muss `setup-session` ausgeführt und danach `self-test` erfolgreich bestätigt werden. Ein Login-Redirect oder eine abweichende easyDPD-Oberfläche führt vor dem Kauf zu einem sicheren Fehler.

### Mittel – Browseroberflächen können sich ändern

Produkt, Format, Gesamtgewicht und Kaufbutton werden über exakte Rollen und Bezeichnungen geprüft. Eine UI-Änderung stoppt den Auftrag vor dem Kauf. Nach `dispatching` führt jede Unsicherheit zu `manual_review`; ein automatischer Wiederholungskauf ist ausgeschlossen.

## Scorecard

| Dimension | Inaktiv/Dry-Run | Live vor Pilot | Notes |
| --- | ---: | ---: | --- |
| correctness | 5 | 3 | Schema/API sind geprüft; reale Session, Download und Tarif müssen im Pilot verifiziert werden. |
| reliability | 5 | 3 | Fail-closed und LaunchAgent sind vorhanden; Shopify-Session und reale easyDPD-UI bleiben externe Abhängigkeiten. |
| idempotency | 5 | 5 | Eindeutiger Fall, DB-Lease, `dispatching` vor Klick und kein Retry nach Dispatch. |
| observability | 5 | 5 | Jobs, Zustände, Hashes, Tracking, Artefakte, Druckauftrag und Events liegen in Postgres/Supabase. |
| security | 5 | 4 | Eigenes Profil, Host-/Pfad-Allowlist, getrenntes API-Token im Schlüsselbund, private Storage-Objekte und RLS. |
| tracking impact | 5 | 5 | Keine Änderung an GA/GTM/Ads; Shopify erhält nur das easyDPD-Fulfillment. |
| cost risk | 5 | 3 | Inaktiv entstehen keine Kosten; live ist die Produktfreigabe bis zur Tarifprüfung gesperrt. |

## Required Fixes vor Live

1. Separate Shopify/easyDPD-Sitzung mit `setup-session` einrichten.
2. `self-test` ohne Kauf erfolgreich ausführen.
3. Exakte easyDPD-Produktzuordnung und die ausdrücklich freigegebene Obergrenze von 15,00 EUR human-approved in `approved_products` speichern.
4. Einen einzigen kontrollierten Pilotauftrag mit ausdrücklicher Bestätigung ausführen.
5. DPD-Tracking, Shopify-Fulfillment/Kundenbenachrichtigung, annotierte A6-PDF, CUPS-Druck und Outlook-Archivierung Ende-zu-Ende prüfen.
6. Erst danach beide Produktionsschalter und den lokalen Live-Modus aktivieren.

## QA Plan

- 670 Repository-Tests, TypeScript-Typecheck, Voice-Runtime-Build und Next.js-Produktionsbuild müssen grün sein.
- Migration in einer isolierten Postgres-Datenbank ausführen und danach Supabase Advisors prüfen.
- Unautorisierte API-Aufrufe müssen vor Datenbank-/Storage-Zugriff mit 401 enden.
- Dry-Run-Claim muss 204 liefern und darf keinen Auftrag reservieren.
- Login-Redirect, unbekanntes Produkt, falsches Format, falsches Gewicht, mehr als 15 EUR, nicht eindeutige DPD-Nummer und fehlender Download müssen fail-closed enden.
- Nach simuliertem Fehler vor `dispatching` ist nur ein begrenzter Retry erlaubt.
- Nach simuliertem Fehler ab `dispatching` muss `manual_review` entstehen; kein erneuter Klick.
- PDF-QA muss eine A6-Seite, Schutzbereiche und genau die letzten sechs DHL-Ziffern bestätigen.
- A4-Lieferschein und A6-Etikett müssen weiterhin getrennte Drucker verwenden.

## Rollback

1. Lokal: `npm run arrival-labels:browser-worker:manage -- uninstall` – das Plist wird gesichert und deaktiviert.
2. Server: `worker_enabled=false` und `live_purchase_enabled=false` setzen; dadurch können weder Enqueue noch Claim erfolgen.
3. Code: gezielten Revert-Commit erstellen, vollständige Tests ausführen, `codex-predeploy ops` starten und nur dessen exakten Commit deployen.
4. Secret: den Workflowmodus `delete_ops_arrival_label_browser_worker_token` ausführen und den Schlüsselbund-Eintrag entfernen.
5. Die additive Queue und Auditdaten standardmäßig behalten. Die SQL-Rollbackdatei nur nach Export/Prüfung verwenden; sie löscht Browser-Queue-Daten. Der private Storage-Bucket wird nur gelöscht, wenn er leer ist.
