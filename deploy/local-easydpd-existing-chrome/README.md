# NEONTRIP EasyDPD Existing-Chrome-Bridge

Diese Bridge nutzt ausschließlich einen bereits geöffneten, angemeldeten easyDPD-Auftragstab im normalen Chrome-Profil. Sie startet kein zweites Chrome-Profil und öffnet kein neues Fenster. Ohne passenden offenen Tab wird kein Auftrag reserviert.

## Sicherheitsgrenzen

- Postgres ist Source of Truth und Exactly-once-Grenze.
- Die Erweiterung besitzt nur Rechte für die feste NEONTRIP-Shopify-/easyDPD-Route, Downloads, den fest gepinnten Native Host, Alarme und lokalen Status.
- Der Native Host liest Tokens ausschließlich aus dem macOS-Schlüsselbund.
- Vor jedem Dispatch werden Shopify-Auftrags-ID, Bestellname, Produkt, `Einzeln auf A6`, 500 g und maximal 15,00 EUR geprüft.
- Jeder vorhandene easyDPD-History-/Tracking-Eintrag stoppt den Kauf dauerhaft als `existing_label`.
- `dispatching` wird vor genau einem `Create label`-Klick in Postgres gespeichert.
- Jede Ungewissheit nach `dispatching` führt zu manueller Prüfung; es gibt keinen automatischen zweiten Kauf.
- Erst ein eindeutig zum Tab gehörender abgeschlossener PDF-Download wird an die bestehende PDF-/A6-Druck-/Outlook-Archivkette übergeben.

## Installation

Die Installation wird nur aus einem sauberen, aktuellen `origin/main` zugelassen:

```bash
npm run arrival-labels:existing-chrome:manage -- install --mode dry_run
npm run arrival-labels:existing-chrome:manage -- status
```

Danach wird einmalig in `chrome://extensions` der Entwicklermodus aktiviert und der vom Status ausgegebene Ordner über **Entpackte Erweiterung laden** ausgewählt. Die feste Erweiterungs-ID ist `bgfphlbhdameagnafljlgpbpjdajmdhk`.

Der Dry-Run prüft Native Host, Schlüsselbund, normalen Chrome-Tab und easyDPD-Inhalt ohne Auftrag-Claim und ohne Kauf. Live benötigt eine zweite lokale Bestätigung:

```bash
npm run arrival-labels:existing-chrome:manage -- install --mode live --acknowledge-production-write
```

Beim Live-Wechsel wird der alte separate Playwright-Worker zuerst deaktiviert. Die beiden Server-Gates bleiben bis zum beaufsichtigten Canary ausgeschaltet.

## Rollback

```bash
npm run arrival-labels:existing-chrome:manage -- rollback
npm run arrival-labels:existing-chrome:manage -- uninstall
```

Rollback stellt die zuletzt gesicherte Native-Host-Konfiguration wieder her. `uninstall` deaktiviert nur diese Native-Bridge; die Datenbank-Auditdaten bleiben erhalten.
