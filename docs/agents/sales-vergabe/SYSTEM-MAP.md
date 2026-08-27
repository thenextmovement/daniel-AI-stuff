# Sales-Vergabe System Map

## Source-of-Truth-Grenzen

| Bereich | System | Status | Beleg / Bedeutung |
| --- | --- | --- | --- |
| Angebotsannahme und Kundenauswahl | Offers-Datenbank und unveränderlicher Annahme-Snapshot | `[verifiziert]` | `src/lib/quotes/accept-quote.ts` erzeugt aus der angenommenen Auswahl ein `offer.completed`-Ereignis. |
| Produktionsvergabe | Ops Supabase | `[verifiziert]` | `supabase/migrations/20260609102438_create_supplier_sales_ops.sql` bezeichnet Shopify, Trello und Aufgaben als Projektionen beziehungsweise Side Effects. |
| Zahlung, Fulfillment und Shopify-Tags | Shopify Admin | `[aus Git/Code abgeleitet]` | `src/lib/ops/supplier-sales.ts` liest diese Zustände beim Import und Reconcile und projiziert sie in `supplier_sales`. |
| Historische Kaufbelege | Ops- und lokale Shopify-Projektionen | `[verifiziert]` | Frühere bezahlte `supplier_sales` sowie `v_orders_by_email` und `crm_sales` werden zur Bestandskundenerkennung ausgewertet. |
| Supplier-Karte | Trello | `[verifiziert]` | Projektion mit gespeicherten Karten-IDs/URLs; keine Entscheidungs- oder Wiederherstellungsquelle. |
| Zeitpläne und E-Mail-Transport | n8n | `[verifiziert]` | Statische Workflow-Entwürfe lösen synchronisierte Ops-Aktionen beziehungsweise Outlook-Versand aus; die fachliche Entscheidung bleibt in Ops. |

## Datenfluss

1. `[verifiziert]` Eine Angebotsannahme läuft durch `src/lib/quotes/accept-quote.ts`. `src/lib/quotes/ops-sales-sync.ts` sendet danach authentifiziert `offer.completed` an `POST /api/ops/supplier-sales` mit `action=upsert_sale`.
2. `[verifiziert]` Die Route `src/app/api/ops/supplier-sales/route.ts` delegiert an `src/lib/ops/supplier-sales.ts`, normalisiert den Snapshot und upsertet Sale und Positionen idempotent.
3. `[verifiziert]` Als Recovery kann `action=sync_completed_offers` den internen Completed-Sales-Feed der Offers-App abrufen. Der Feed liefert angenommene Dokumente in den Status `ACCEPTED`, `COMPLETED` oder `DOWNLOADED` mit vorhandener Annahme, nicht nur den String `COMPLETED`.
4. `[verifiziert]` Derselbe Sync importiert aktuelle Shopify-Bestellungen als Fallback, verknüpft sie anhand belastbarer Offer-/Order-Referenzen und gleicht aktive Rows mit Zahlung, Fulfillment und Supplier-Tags ab.
5. `[verifiziert]` `GET /api/ops/supplier-sales` liest das Board aus Ops Supabase. Das initiale Laden der UI stößt keinen Shopify-Sync an; `Sync + Laden` führt erst `sync_completed_offers` und danach den Board-Read aus.
6. `[verifiziert]` Eine Vergabe schreibt zuerst die fachliche Entscheidung und einen idempotenten Versuch in Ops. Danach folgen Shopify-Tag, optional Trello-Projektion und optional interne Aufgabe als kontrollierte Side Effects.
7. `[verifiziert]` Teilfehler der Side Effects werden auf Sale/Attempt protokolliert und können über begrenzte Retry-Aktionen erneut versucht werden.

## Einstiegspunkte

| Zweck | Pfad oder Route | Status |
| --- | --- | --- |
| Seite | `src/app/ops/sales-vergabe/page.tsx` | `[verifiziert]` |
| Client-UI | `src/app/ops/sales-vergabe/page-client.tsx` | `[verifiziert]` |
| Ops-API | `src/app/api/ops/supplier-sales/route.ts` | `[verifiziert]` |
| Domänenlogik | `src/lib/ops/supplier-sales.ts` | `[verifiziert]` |
| Offer-Annahme | `src/lib/quotes/accept-quote.ts` | `[verifiziert]` |
| Offer-zu-Ops-Transport | `src/lib/quotes/ops-sales-sync.ts` | `[verifiziert]` |
| Basismigration | `supabase/migrations/20260609102438_create_supplier_sales_ops.sql` | `[verifiziert]` |
| Rollback | `supabase/rollbacks/20260609102438_create_supplier_sales_ops_rollback.sql` | `[verifiziert]` |
| Kern-Tests | `tests/quotes/supplier-sales.test.ts` | `[verifiziert]` |
| Annahme-Tests | `tests/quotes/acceptance.test.ts` | `[verifiziert]` |
| UI-Smoke | `scripts/smoke_sales_vergabe_ui.mjs` | `[verifiziert]` |
| Integrationsdoku | `docs/operations/supplier-sales-integrations.md` | `[verifiziert]` |
| AB-E-Mail-Doku | `docs/operations/supplier-order-confirmation-email.md` | `[verifiziert]` |

## Persistenz

- `[verifiziert]` `supplier_sales`: kanonischer Vergabestatus, Kunden-/Offer-/Shopify-Referenzen, Zahlung, Deadline, Snapshot, Supplier und Projektionszustände.
- `[verifiziert]` `supplier_sale_items`: normalisierte Positionen und Bild-/Produktmerkmale pro Sale.
- `[verifiziert]` `supplier_sale_events`: idempotente Audit-Ereignisse. Der aktuelle Check-Constraint ist gegenüber dem Code veraltet; siehe [KNOWN-ISSUES.md](./KNOWN-ISSUES.md).
- `[verifiziert]` `supplier_assignment_attempts`: idempotente Vergabeversuche mit Side-Effect-Resultaten.
- `[verifiziert]` `supplier_payment_reminders`: tägliche/idempotente Reservierung und Ergebnis einer Zahlungserinnerung.
- `[verifiziert]` Alle fünf Tabellen haben RLS; die Basismigration vergibt Zugriff an `service_role`.

## Board- und UI-Logik

- `[verifiziert]` Unterstützte API-Scopes sind `active`, `ready`, `payment`, `assigned`, `deadline`, `sync` und `all`; zusätzlich gibt es Supplier-, Zahlungs-, Dringlichkeits- und Textfilter.
- `[verifiziert]` Standardmäßig werden 50 Rows geladen; `Mehr laden` erhöht bis maximal 500. Dies ist kein Cursor-Paging.
- `[verifiziert]` Außer im Deadline-Scope gilt die Priorität: aktuell bezahlt und offen, dann unbezahlter Bestandskunde mit früherer Zahlung, dann übrige aktive Sales; innerhalb der Gruppe entscheidet die Aktualität.
- `[verifiziert]` Der Deadline-Scope priorisiert Status und Fälligkeit.
- `[verifiziert]` Die UI kennzeichnet bezahlte Sales grün, Bestandskunden mit früherer Zahlung separat und bietet Schnellfilter für bezahlt, Bestandskunde, fehlenden Bezahllink, Sync-Fehler, Deadline und Express/Eil.
- `[verifiziert]` Die Kundenauswahl zeigt pro Position die Menge und, soweit im Snapshot vorhanden, Größe, Breite, Höhe, Farbe, Zuschnitt, Rückseite, Montage und Outdoor-Merkmale.
- `[verifiziert]` Links können zu Angebot, finalem PDF, generiertem Snapshot/AB-PDF, Shopify, Bezahlen, Supplier-Trello-Karte, Quellkarte und Quentin-Board-Suche führen.
- `[verifiziert]` Vergabe und Projektions-Retry verändern auf der zugeordneten Quentin-Karte weder Titel noch Description. Karten-Zuordnung und der kontrollierte Approved-Design-Upload bleiben erhalten; der separate Shopify-Order-Präfix auf Quell-Trello-Karten bleibt davon unberührt.
- `[aus Git/Code abgeleitet]` Eine genaue direkte Quentin-Karte ist nur vorhanden, wenn deren ID/URL bereits gespeichert wurde; die Board-Suche ist ansonsten nur eine Suchhilfe und kein bewiesenes Unique-ID-Match.

## Zahlungs- und Freigabelogik

- `[verifiziert]` Shopify `paid` wird als `paid_confirmed` behandelt und ist sofortige Vergabepriorität.
- `[verifiziert]` Unbezahlte Sales benötigen die explizite Operatorentscheidung `manual_approved_unpaid`, bevor sie vergeben werden dürfen. `wait_for_payment` blockiert die Vergabe.
- `[verifiziert]` Ein offenes 24-Stunden-Fenster blockiert die Vergabe nicht.
- `[verifiziert]` `postOrderReview.status=change_requested` blockiert die serverseitige Vergabe bis zur Quittierung.
- `[verifiziert]` Der Vergabe-Idempotenzschlüssel enthält Sale, Supplier und Lieferdatum.
- `[verifiziert]` Zahlungserinnerungen werden nur über einen expliziten UI-Befehl reserviert und an den konfigurierten Webhook übergeben. Ein automatischer Versand fünf Minuten nach Annahme ist nicht implementiert.
- `[verifiziert]` Das Tag `Keine Zahlungserinnerung n8n` kann explizit in Shopify gesetzt werden.

## Bestandskunden-Erkennung

- `[verifiziert]` Eine exakt übereinstimmende E-Mail kann auch bei privaten Providern als Beleg dienen.
- `[verifiziert]` Eine Firmendomain wird nur verwendet, wenn sie nicht in der Liste persönlicher Provider wie Gmail, Web.de oder GMX liegt.
- `[verifiziert]` Als weiterer Fallback dient ein normalisierter Kundenname.
- `[verifiziert]` PostgREST-Historienfilter übergeben E-Mail, Firmendomain und Namen roh an den gemeinsamen URL-Builder, damit diese Werte genau einmal transportkodiert werden.
- `[verifiziert]` Nur frühere bezahlte Bestellungen zählen. Die UI-Antwort enthält Beleg-Order, Shopify-Link und Match-Basis, ohne diesen abgeleiteten Marker zurück in den Sale zu schreiben.

## Shopify und Trello

- `[verifiziert]` Default-Tags: `Quentin (noch bezahlen)` und `Saeid (schon bezahlt)`. Der Inbound-Abgleich erkennt zusätzlich den historischen Alias `Quentin (schon bezahlt)`.
- `[verifiziert]` Tag-Vergleiche trimmen und kleinschreiben, normalisieren aber keine internen Leerzeichen oder Satzzeichen. Exakte Schreibweise bleibt relevant.
- `[verifiziert]` Bereits extern getaggte, über Shopify `cancelledAt` stornierte oder als `fulfilled`, `shipped`, `delivered`, `complete` oder `completed` erkannte Rows werden nach Reconcile nicht im aktiven Board gezeigt.
- `[verifiziert]` Wenn eine Shopify-Order bekannt wird, kann der Titel aller zum `request_id` gehörenden Quell-Trello-Karten idempotent mit `#ORDER | ` vorangestellt beziehungsweise aktualisiert werden.
- `[verifiziert]` Die Erstellung einer Supplier-Trello-Karte ist standardmäßig deaktiviert und benötigt zusätzlich `SUPPLIER_TRELLO_PROJECTION_ENABLED=true` sowie Zugang und Listen-ID.

## PDF und E-Mail

- `[verifiziert]` `generateSupplierOrderConfirmationPdf` erzeugt eine Auftragsbestätigung aus `offer_snapshot`.
- `[verifiziert]` Die E-Mail-Aktion reserviert idempotent, erzeugt und hasht das PDF, sendet es an einen konfigurierten Webhook und speichert den Versandstatus.
- `[verifiziert]` Die API-Aktionen `snapshot_pdf` und `order_confirmation_pdf` rufen derzeit denselben AB-PDF-Generator auf. Das finale unveränderliche Offers-PDF ist separat über `final_pdf_url` verlinkt.

## n8n-Workflow-Artefakte

| Datei | Workflow | Trigger | Repo-Status | Laufzeitstatus |
| --- | --- | --- | --- | --- |
| `workflows/supplier-completed-offers-sync-v0.1.inactive-draft.json` | NEONTRIP Supplier Completed Offers Sync v0.1 | alle 10 Minuten | `[verifiziert]` `active:false` | `[offen]` |
| `workflows/supplier-shopify-tag-sync-v0.1.inactive-draft.json` | NEONTRIP Supplier Shopify Tag Sync v0.1 | alle 5 Minuten | `[verifiziert]` `active:false` | `[nur aus Thread erinnert]` ID `WlSmT7zlLcR4TlUG`, zuletzt ausdrücklich inaktiv nach 401 gemeldet |
| `workflows/supplier-payment-reminder-email-v0.1.inactive-draft.json` | NEONTRIP Supplier Payment Reminder Email v0.1 | POST `supplier-payment-reminder` | `[verifiziert]` `active:false` | `[nur aus Thread erinnert]` ID `h2Eye2kArl2CBx3k`, als aktiv/published gemeldet |
| `workflows/supplier-order-confirmation-email-v0.1.inactive-draft.json` | NEONTRIP Supplier Order Confirmation Email v0.1 | POST `supplier-order-confirmation` | `[verifiziert]` `active:false` | `[offen]` |

- `[verifiziert]` Der `active:false`-Wert in einer statischen Draft-Datei beweist nicht den Zustand einer importierten produktiven n8n-Instanz.
- `[nur aus Thread erinnert]` Für Zahlungserinnerungen wurde `support@neontrip.de` als Outlook-Credential genannt; ein echter Versandtest wurde in diesem Handoff nicht nachgewiesen.
