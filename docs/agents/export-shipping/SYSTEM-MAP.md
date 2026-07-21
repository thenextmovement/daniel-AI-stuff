# Exportversand/Schweiz System Map

## Drei strikt getrennte Zustände

| Ebene | Befund | Status |
| --- | --- | --- |
| Aktuelles `origin/main` | Shipping-/Tracking-Domäne und separate Arrival-Label-/EasyDPD-Komponenten vorhanden; kein `/shipping/export`, keine Exporttabellen und kein Exportmonitor | `[verifiziert]` |
| Historischer Exportprototyp | Vollständige uncommittierte UI/API/Domain-/Migration-/Testskizze auf Basis `cc2e199`, 48 Commits hinter `origin/main` | `[historischer Prototyp]` |
| Produktiver Exportversand | weder deployt noch aktiviert; Provider, Tarif, Legal, Retention und Live-E2E fehlen | `[offen]` |

Diese Ebenen dürfen in Diagnose oder Planung nicht als derselbe Systemstand behandelt werden.

## Vorgesehene Source-of-Truth-Grenzen

| Bereich | Autorität | Bedeutung |
| --- | --- | --- |
| Bestellung, Lieferadresse, offene Fulfillment Orders, Positionen | Shopify Admin | serverseitig erneut lesen; Browserpayload ist keine Autorität |
| Exportjob, Snapshot, Idempotenz, Dokumentmetadaten, Audit | Ops Supabase/Postgres | vorgesehene kanonische Versandzustände |
| feste Versender- und SKU-Zolldaten | Ops Supabase/Postgres | keine Secrets; versions- und auditierbare Stammdaten |
| Label und Paketnummer | der ausdrücklich freigegebene DPD-Provider | DPD Cloud **oder** qualifizierte EasyDPD-Automation, nicht beides implizit |
| Zahlung, Fulfillment, Tracking und Kundenmail | Shopify | Schreiben nur nach eigenem Freigabegate |
| Handelsrechnung | lokale, überprüfte Dokumenterzeugung oder später bestätigter Providerpfad | der historische Cloud-Entwurf speichert sie nicht in myDPD |
| Trello | Projektion/Zuordnungshilfe | niemals Source of Truth |
| n8n | optionales Monitoring/Transport | keine fachliche Autorität, kein primärer Recovery-Mechanismus |

## Historischer Prototypfluss

1. `GET bootstrap` liest Diagnose und aktives Versenderprofil.
2. `GET action=order` sucht Shopify und akzeptiert in Phase 1 nur `CH` mit mindestens einer offenen Fulfillment Order.
3. Der Mitarbeiter prüft Empfänger, Kunden-UID, Zollpositionen, Ursprung, Gewicht, Maße, Werte, Datum, Rechnung und Incoterm.
4. `POST action=prepare` liest Shopify serverseitig erneut, validiert alle offenen Positionen und erzeugt einen kanonischen SHA-256-Snapshot.
5. `shipping_prepare_export_job(jsonb,jsonb)` legt Job und Positionen transaktional und idempotent an.
6. Eine explizite Checkbox ist Voraussetzung für `POST action=submit`.
7. DPD Cloud führt zuerst `checkOrderData`, dann genau einen `startOrder` aus.
8. Paketnummer und Label werden geprüft; Label und lokal erzeugte Handelsrechnung werden in einem privaten Storage-Bucket abgelegt.
9. Ein Versanddatensatz wird in die bestehende Shipping-Domäne projiziert.
10. Nur bei separaten Flags folgt Shopify `fulfillmentCreate`; `notifyCustomer` ist nochmals separat schaltbar.
11. Bei unklarem Shopify-Ausgang sucht `reconcile_shopify` nur nach derselben Trackingnummer und sendet keine zweite Mutation.

## Historisches Zustandsmodell

```text
ready
  -> dpd_submitting
  -> dpd_created
  -> documents_ready
  -> shopify_submitting
  -> completed
```

Ausnahmezustände:

- `dpd_outcome_unknown`: möglicher Auftrag trotz Timeout/5xx; niemals blind erneut senden.
- `shopify_outcome_unknown`: mögliche Fulfillment-Mutation; nur read-only anhand der Trackingnummer abgleichen.
- `needs_review`: deterministischer Daten-, Provider-, Dokument- oder Persistenzfehler.
- `cancelled`: im Schema vorgesehen, aber kein automatischer Stornopfad belegt.

`[historischer Prototyp]` Der Idempotenzschlüssel basierte auf Shopify Fulfillment Order, Paketindex und Revision. Derselbe Schlüssel mit verändertem Snapshot wurde abgelehnt.

## Historisches Datenmodell

| Objekt | Zweck | Status |
| --- | --- | --- |
| `shipping_export_profiles` | fester Versender, USt-ID, EORI, Kontakt, Incoterm | `[historischer Prototyp]` |
| `shipping_customs_products` | wiederverwendbare SKU-Zollangaben | `[historischer Prototyp]` |
| `shipping_export_jobs` | Zustandsmaschine, Shopify-/DPD-Referenzen, Snapshot und Hash | `[historischer Prototyp]` |
| `shipping_export_job_items` | unveränderliche Positionen des konkreten Jobs | `[historischer Prototyp]` |
| `shipping_export_documents` | privater Storagepfad, SHA-256, Größe und Typ | `[historischer Prototyp]` |
| `shipping_audit_log.export_job_id` | Side-Effect-Audits | `[historischer Prototyp]` |
| `shipping-export-documents` | privater PDF-Bucket, 10 MiB, PDF-only | `[historischer Prototyp]` |

Alle Prototyptabellen aktivierten RLS, vergaben keine Policies an `anon`/`authenticated` und erlaubten Tabellen/RPC-Zugriff nur über `service_role`.

## Historische Einstiegspunkte

Die folgenden Pfade existieren nicht in `origin/main`, sondern nur im uncommittierten Prototyp:

| Zweck | relativer Pfad |
| --- | --- |
| UI | `src/app/ops/customer-records/shipping/export/page-client.tsx` |
| Page/Auth | `src/app/ops/customer-records/shipping/export/page.tsx` |
| API | `src/app/api/ops/customer-records/shipping/export/route.ts` |
| Dokumentdownload | `src/app/api/ops/customer-records/shipping/export/documents/[jobId]/[documentType]/route.ts` |
| Orchestrierung | `src/lib/ops/export-shipping.ts` |
| DPD Cloud | `src/lib/ops/export-shipping-dpd.ts` |
| Shopify | `src/lib/ops/export-shipping-shopify.ts` |
| PDF/ZIP | `src/lib/ops/export-shipping-documents.ts` |
| Migration | `supabase/migrations/20260717100350_create_export_shipping.sql` |
| Rollback | `supabase/rollbacks/20260717100350_create_export_shipping_rollback.sql` |
| Tests | `tests/quotes/export-shipping.test.ts` |
| UI-Smoke | `scripts/smoke_export_shipping_ui.mjs` |
| Monitor-Draft | `workflows/dpd-export-shipping-monitor-v0.1.inactive-draft.json` |

## Aktuelle angrenzende Systeme in `origin/main`

### Shipping-/Tracking-Agent

- `src/lib/ops/shipping.ts` und `/ops/customer-records/shipping` verwalten Sendungen, Carrier-Ereignisse und Incidents.
- Der Exportprototyp wollte nach Labelerzeugung über `upsertShippingShipment` in diese Domäne projizieren.
- Der bestehende Shipping-Agent ist kein Label-Käufer und belegt keine DPD-Exportfähigkeit.

### Arrival-Label-/EasyDPD-System

- `src/lib/ops/arrival-labels/**`, `scripts/easydpd_browser_worker_lib.mjs` und die Migration `20260721170915_create_arrival_label_browser_purchase_queue.sql` bilden eine separate DHL-Eingang-zu-DPD-Kette.
- Der Worker ist auf einen konkreten Shopify-Shop, eine konkrete EasyDPD-Route, eine enge Produkt-Allowlist, A6, 500 g und maximal 15 EUR begrenzt.
- DB- und lokale Schalter defaulten aus; nach `dispatching` ist kein automatischer Wiederholungskauf erlaubt.
- Schweiz und sonstige Nicht-EU-Ziele sind in der Arrival-Domäne harte Stopper und gehen in manuelle Prüfung.
- EasyDPD kann dort Shopify-Fulfillment und Kundenmail selbst auslösen. Ein zukünftiger Exportpfad muss deshalb Doppel-Fulfillment und Doppelmail explizit verhindern.

## Providergrenze

### Option A: DPD Cloud

- offizieller myDPD-Business-Integrationshinweis;
- Sandbox sowie separate Live-Credentials/Live-URL;
- direkter Label-/Paketnummernpfad;
- keine belegte myDPD-interne Handelsrechnung/Zollübergabe;
- historischer Adapter vorhanden, aber nur gemockt getestet und nicht auf aktuellen `main` rebased.

### Option B: EasyDPD-Browserautomation

- vorhandene Browser-Sicherheitsmuster können als Referenz dienen;
- der aktuelle Worker ist fachlich und technisch nicht für Export geeignet;
- Exportformular, Zoll-/Rechnungsseite, Tarif, Preisgrenze, Shopify-Side-Effects und Download müssten separat aufgenommen, allowlistet und getestet werden;
- UI-Änderungen müssen fail-closed enden.

Eine Providerentscheidung ist Voraussetzung für jede Produktimplementierung.

## Schedule

- Der Mitarbeiterprozess ist manuell angestoßen und nicht schedule-fähig.
- Der historische n8n-Draft war ausschließlich ein inaktiver Monitor für hängende/unklare Jobs.
- Monitoring darf keine Labelerzeugung, kein Shopify-Schreiben und keine Kundenkommunikation auslösen.
- `schedule_supported` ist deshalb im Manifest `false`.
