# Exportversand/Schweiz Operations

## Aktueller Betriebsstatus

- Exportversand ist nicht in `origin/main`.
- Es gibt keine freigegebene Exportmigration und keinen belegten aktiven Exportmonitor. Produktive Umgebungsvariablen wurden in diesem Handoff bewusst nicht gelesen; ihr Vorhandensein wäre allein keine Aktivierungsfreigabe.
- Es gibt keine verifizierte DPD-Sandbox-/Live-Labelerzeugung dieses Agenten.
- Dieses Runbook autorisiert keine Aktivierung.

## Sicherer Start einer Folgesession

```bash
codex-new-worktree ops <export-topic>
git status --short --branch
git fetch origin main
git rev-parse HEAD
git rev-parse origin/main
```

Erst weiterarbeiten, wenn der neue Worktree sauber und auf aktuellem `origin/main` basiert. Niemals im alten Main-Checkout arbeiten.

Danach zuerst feststellen:

```bash
git ls-tree -r --name-only HEAD | rg 'export-shipping|shipping/export'
rg -n -i 'dpd|easydpd|schweiz|non-eu' src supabase docs workflows scripts tests
```

Wenn die Exportdateien weiter fehlen, darf der historische Worktree nur als Read-only-Referenz dienen. Seine uncommittierten Änderungen nicht blind kopieren oder committen; zuerst gegen alle seit `cc2e199` hinzugekommenen Shipping-/Arrival-Änderungen diffen.

## Getrennte Freigabegates

### Gate 0 – Architekturfreigabe

Voraussetzungen:

- DPD Cloud **oder** EasyDPD-Exportbrowser ist schriftlich gewählt.
- Exaktes Schweizer Produkt, Preis-/Zuschlagsgrenze, Gewicht und Größenregeln sind bestätigt.
- Verantwortung für Handelsrechnung, Zollfelder und myDPD-Ablage ist geklärt.
- Shopify-Fulfillment-/Mail-Verantwortung des Providers ist eindeutig.
- Retention, Zugriff und Löschung der Rechnungs-/UID-Daten sind freigegeben.

Ohne Gate 0 keine Produktlogik übernehmen.

### Gate 1 – Code-/Schemafreigabe, weiterhin ohne Side Effects

Voraussetzungen:

- neuer aktueller Worktree, Review gegen Arrival-/EasyDPD-System;
- Migration plus Rollback in disponibler Postgres-Instanz geprüft;
- RLS, Grants, privater Bucket, Audit und Idempotenz bestätigt;
- fokussierte Tests, Typecheck und erforderlicher Build grün;
- alle Write-/Notify-Schalter defaulten aus;
- Backup, Diff und Rollback dokumentiert.

Ein eventueller Merge/Deploy nach Gate 1 darf nur eine deaktivierte, read-only/preparation-fähige Oberfläche bereitstellen. Er ist **keine** Freigabe für ein Label.

### Gate 2 – Read-only-/Preview-Abnahme

- interne Testorder eindeutig laden;
- keine Kunden-PII in Logs oder Testfixtures persistieren;
- Liefer-/Rechnungsadresse, Fulfillment Order, Werte und alle Zollpositionen prüfen;
- Snapshot-Historie und wiederholtes Prepare ohne Duplikat bestätigen;
- Dokumentdownload-Auth mit unberechtigtem und berechtigtem Request prüfen;
- noch kein Carrier-, Shopify- oder Mail-Side-Effect.

### Gate 3 – echte Label-Erzeugung

Dieses Gate braucht eine **separate ausdrückliche Freigabe**, auch wenn Gate 1/2 bereits genehmigt sind.

- zunächst DPD-Sandbox mit eigenen Sandbox-Credentials und internem Testfall;
- Request/Response ohne Credentialwerte protokollieren;
- Label-PDF, Trackingnummer, Produkt, Preis, Adresse, Gewicht, Format und Scanbarkeit prüfen;
- bei Browserpfad tatsächlichen Preis vor Klick gegen freigegebene Obergrenze prüfen;
- vor Carrier-Aufruf `dispatching`/äquivalent dauerhaft setzen;
- bei Timeout/5xx/Downloadunsicherheit kein Retry, sondern Providerkonto anhand interner Referenz prüfen;
- Produktions-Canary erst nach erfolgreicher Sandbox-/Vertragsabnahme und eigener Freigabe.

### Gate 4 – Shopify-Tracking/Fulfillment

- Kundenmail bleibt aus;
- Provider darf nicht bereits dasselbe Fulfillment erzeugt haben;
- bestehendes Fulfillment anhand Trackingnummer read-only abgleichen;
- genau einen internen Canary erfüllen;
- Shopify-Order, Fulfillment Order, Location, Trackingnummer/-URL und Audit prüfen;
- unsichere Mutation nicht wiederholen.

### Gate 5 – Kundenbenachrichtigung

- separate ausdrückliche Freigabe;
- Shopify-Mailvorlage, Absender, Trackinglink und Empfänger mit intern kontrolliertem Fall prüfen;
- keine eigene E-Mail senden, wenn Shopify/Provider bereits benachrichtigt;
- `notifyCustomer` erst danach gezielt aktivieren.

### Gate 6 – Monitoring

- Monitoring ist read-only und darf nur interne Alerts erzeugen;
- keine Carrier-/Shopify-/Mail-Recovery aus einem Poller;
- inaktiven Draft mit Backup, Diff, Credential-Referenzen und Error-Workflow reviewen;
- Aktivierung ist ein eigenes Workflow-Gate.

## Historische Feature-Flag-Namen

Nur Namen dokumentieren, niemals Werte oder Secretinhalte:

- `EXPORT_SHIPPING_ENABLED`
- `EXPORT_SHIPPING_DPD_MODE`
- `EXPORT_SHIPPING_DPD_WRITE_ENABLED`
- `EXPORT_SHIPPING_SHOPIFY_WRITE_ENABLED`
- `EXPORT_SHIPPING_NOTIFY_CUSTOMER`

Historische serverseitige Providerkonfiguration:

- `DPD_CLOUD_PARTNER_NAME`
- `DPD_CLOUD_PARTNER_TOKEN`
- `DPD_CLOUD_USER_ID`
- `DPD_CLOUD_USER_TOKEN`
- `DPD_CLOUD_STAGE_ENDPOINT`
- `DPD_CLOUD_ENDPOINT`
- `DPD_CLOUD_TIMEOUT_MS`
- `DPD_TRACKING_URL_TEMPLATE`

Diese Namen sind keine Bestätigung, dass Variablen existieren oder gültig sind. Secretwerte niemals auslesen oder in Tickets, Logs oder Handoff-Dokumente kopieren.

## Fokussierte Verifikation nach einer zukünftigen Übernahme

Wenn die Dateien in einem neuen Branch tatsächlich vorhanden sind:

```bash
node --import tsx --test tests/quotes/export-shipping.test.ts
jq -e '.active == false' workflows/dpd-export-shipping-monitor-v0.1.inactive-draft.json
npx tsc --noEmit
git diff --check
```

Zusätzlich erforderlich:

- Migration und Rollback in einer disponiblen Postgres-Version ausführen.
- RPC-Idempotenz mit gleichem und verändertem Snapshot prüfen.
- RLS/Grants für `anon`, `authenticated` und `service_role` beweisen.
- PDF rendern und visuell prüfen; nur `%PDF`-Magic ist keine Layout-/Rechtsprüfung.
- UI-Smoke auf Desktop, Tablet und Mobile mit gemockten API-Antworten.
- DPD-Vertragstest gegen Sandbox erst nach Gate 3.
- Shopify-Mutationstest erst nach Gate 4.

## Incident-Runbook

### DPD-/EasyDPD-Ausgang unklar

1. Job sperren und als unklar markieren.
2. Nicht erneut senden/klicken.
3. Interne Referenz, Shopify-Order und vorhandene Trackingnummer read-only im gewählten Provider prüfen.
4. Erst nach eindeutigem Nichtvorhandensein darf ein Mensch eine neue Revision freigeben.

### Shopify-Ausgang unklar

1. Keine zweite Mutation.
2. Fulfillments der Order nach exakt derselben Trackingnummer lesen.
3. Treffer lokal reconciliieren; kein Treffer bleibt manuelle Prüfung.

### Dokumentfehler nach Labelerzeugung

1. Label nicht neu kaufen.
2. Providererfolg und Paketnummer bewahren.
3. private Storage-/PDF-Ursache beheben und Dokumente für denselben Job reproduzierbar erzeugen.
4. Shopify erst nach vollständiger Dokumentprüfung freigeben.

## Rollback

### Dieses Handoff

Nur den Handoff-Commit revertieren. Es gibt keine Runtime- oder Datenänderung.

### Zukünftiger deaktivierter Deploy

1. alle Export-Write-/Notify-Flags auf `false`;
2. Route/UI deaktivieren;
3. vorherigen freigegebenen Commit über den normalen `codex-predeploy ops`-Pfad deployen;
4. Auditdaten und bestehende Dokumente bewahren.

### Zukünftige Migration

Der historische SQL-Rollback löscht die Exporttabellen und damit Job-/Dokumentmetadaten. Er bewahrt Storage-Objekte nur dadurch, dass der Bucket bei vorhandenen Objekten nicht gelöscht wird. Vor einem Schema-Rollback sind daher DB-Export, Objektinventar und Wiederherstellungsplan zwingend; niemals ungeprüft in Produktion ausführen.

## Deploy-Regel

Vor jedem späteren Deploy:

```bash
codex-predeploy ops
```

Nur den exakt ausgegebenen Commit deployen. Dieses Handoff wurde nicht gepusht und nicht deployt.
