# NEONTRIP EasyDPD Browser-Worker

Der lokale macOS-Worker verarbeitet ausschließlich bereits in Postgres freigegebene EasyDPD-Kaufaufträge. Er verwendet ein separates Chrome-Profil in einem dauerhaft laufenden Browserprozess, klickt pro Auftrag höchstens einmal auf `Create label` und wiederholt nach dem Dispatch niemals automatisch einen Kauf. Der langlebige Prozess ist erforderlich, weil die Shopify-Sitzung beim Beenden dieses separaten Browsers nicht zuverlässig erhalten bleibt.

Das separate Profil kann mit demselben Google-Konto wie der normale Chrome angemeldet werden, verwendet aber bewusst nicht das normale Chrome-Benutzerdatenverzeichnis. Playwrights Sync- und Mock-Keychain-Standardparameter werden für dieses Profil herausgefiltert, damit Chrome den echten macOS-Schlüsselbund und die normale Profilanmeldung verwenden kann.

## Sicherheitsgrenzen

- Postgres-Queue und eindeutiger `case_id` sind die Idempotenzgrenze.
- Live benötigt Serverfreigabe, lokale Freigabe und `--acknowledge-production-write`.
- EasyDPD-Produkt, A6-Format, 500 g und maximal 15,00 EUR werden serverseitig festgeschrieben.
- Ein abgelaufener oder unklarer Auftrag nach `dispatching` wird `manual_review`.
- Die PDF muss genau eine eindeutige 14-stellige DPD-Sendungsnummer enthalten.
- Die letzten sechs Ziffern der eingehenden DHL-Sendungsnummer werden in einer freigegebenen Fläche ergänzt.
- Erst nach QA und privatem Storage-Upload entsteht ein A6-Druckauftrag. Die vorhandene Druckkette archiviert danach die DHL-Express-Mail.
- Shopify-Versandbestätigung wird nur durch die aktivierte EasyDPD-Einstellung ausgelöst; der Worker sendet keine zweite Kundenmail.

## Installation und Freigabereihenfolge

Das API-Token liegt im macOS-Schlüsselbund unter `NEONTRIP EasyDPD Browser Worker API Token`. Cloudflare Access nutzt bei Bedarf den vorhandenen Service-Token. Das LaunchAgent-Plist enthält keine Geheimnisse.

```bash
npm run arrival-labels:browser-worker:manage -- install --mode dry_run --interval-seconds 300
npm run arrival-labels:browser-worker:manage -- status
```

Der Produktionswechsel erfolgt in dieser Reihenfolge: Zuerst bleiben `worker_enabled` und `live_purchase_enabled` in Postgres ausgeschaltet. Dann wird der lokale Prozess mit seiner separaten Live-Bestätigung installiert. Solange die beiden Server-Gates aus sind, kann er keinen Auftrag reservieren oder kaufen.

```bash
npm run arrival-labels:browser-worker:manage -- install --mode live --interval-seconds 300 --acknowledge-production-write
npm run arrival-labels:browser-worker:manage -- setup-session
npm run arrival-labels:browser-worker:manage -- self-test
```

`setup-session` öffnet keinen zweiten Browserprozess. Es bestätigt, dass der LaunchAgent läuft; die Anmeldung erfolgt im bereits geöffneten NEONTRIP-Chrome. `self-test` liest anschließend den frischen lokalen Heartbeat und klickt keinen Kaufbutton. Erst nach diesem grünen Test werden die beiden Postgres-Gates kontrolliert aktiviert.

Rollback und Deaktivierung sind reversibel:

```bash
npm run arrival-labels:browser-worker:manage -- rollback
npm run arrival-labels:browser-worker:manage -- uninstall
```

Der Worker läuft nur, wenn der Mac eingeschaltet, ein Benutzer angemeldet und die separate Shopify-Sitzung im laufenden Browser gültig ist. Nach Neustart startet `launchd` automatisch wieder, setzt ohne gültige Sitzung aber nur den Zustand `authentication_required`; Käufe bleiben dann aus, bis Shopify im offenen NEONTRIP-Chrome erneut angemeldet wurde.
