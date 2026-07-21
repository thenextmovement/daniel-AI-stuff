# NEONTRIP EasyDPD Browser-Worker

Der lokale macOS-Worker verarbeitet ausschließlich bereits in Postgres freigegebene EasyDPD-Kaufaufträge. Er verwendet ein separates Chrome-Profil, klickt pro Auftrag höchstens einmal auf `Create label` und wiederholt nach dem Dispatch niemals automatisch einen Kauf.

## Sicherheitsgrenzen

- Postgres-Queue und eindeutiger `case_id` sind die Idempotenzgrenze.
- Live benötigt Serverfreigabe, lokale Freigabe und `--acknowledge-production-write`.
- EasyDPD-Produkt, A6-Format, 500 g und maximal 15,00 EUR werden serverseitig festgeschrieben.
- Ein abgelaufener oder unklarer Auftrag nach `dispatching` wird `manual_review`.
- Die PDF muss genau eine eindeutige 14-stellige DPD-Sendungsnummer enthalten.
- Die letzten sechs Ziffern der eingehenden DHL-Sendungsnummer werden in einer freigegebenen Fläche ergänzt.
- Erst nach QA und privatem Storage-Upload entsteht ein A6-Druckauftrag. Die vorhandene Druckkette archiviert danach die DHL-Express-Mail.
- Shopify-Versandbestätigung wird nur durch die aktivierte EasyDPD-Einstellung ausgelöst; der Worker sendet keine zweite Kundenmail.

## Installation

Das API-Token liegt im macOS-Schlüsselbund unter `NEONTRIP EasyDPD Browser Worker API Token`. Cloudflare Access nutzt bei Bedarf den vorhandenen Service-Token. Das LaunchAgent-Plist enthält keine Geheimnisse.

```bash
npm run arrival-labels:browser-worker:manage -- install --mode dry_run --interval-seconds 300
npm run arrival-labels:browser-worker:manage -- setup-session
npm run arrival-labels:browser-worker:manage -- self-test
npm run arrival-labels:browser-worker:manage -- status
```

Der Live-Wechsel erfolgt erst nach kontrolliertem Probekauf:

```bash
npm run arrival-labels:browser-worker:manage -- install --mode live --interval-seconds 300 --acknowledge-production-write
```

Rollback und Deaktivierung sind reversibel:

```bash
npm run arrival-labels:browser-worker:manage -- rollback
npm run arrival-labels:browser-worker:manage -- uninstall
```

Der Worker läuft nur, wenn der Mac eingeschaltet, ein Benutzer angemeldet und die separate Shopify-Sitzung gültig ist. Nach Neustart startet `launchd` automatisch wieder.
