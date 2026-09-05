# Sales-Vergabe Operations

## Sicherer Start

```bash
codex-new-worktree ops <topic>
cd <ausgegebener-worktree>
git status --short --branch
git fetch origin
git rebase origin/main
```

- `[verifiziert]` Nicht im alten Checkout `/Users/danielklesse/Desktop/neontrip-ops-coolify` arbeiten.
- `[verifiziert]` Vor Änderungen `HANDOFF.md`, `SYSTEM-MAP.md`, `DECISIONS.md`, `KNOWN-ISSUES.md` und das repo-nahe Regelwerk lesen.
- `[verifiziert]` Für Offers-Gegenprüfungen nur einen eigenen Offers-Worktree verwenden oder Dateien read-only aus `origin/main` lesen.

## Lokale Verifikation

```bash
npm ci
node --import tsx --test tests/quotes/supplier-sales.test.ts tests/quotes/acceptance.test.ts
npm run test:quotes
npx tsc --noEmit
npm run build
```

- `[verifiziert]` Der vorhandene UI-Smoke-Test ist `npm run smoke:sales-vergabe-ui` und erwartet lokal standardmäßig `http://127.0.0.1:3107`.
- `[verifiziert]` Der Smoke-Test mockt die Ops-API und erzeugt keine externen Side Effects.
- `[offen]` Der aktuelle Smoke-Test hat eine nicht deterministische Filtersequenz und muss vor Nutzung als Release-Gate stabilisiert werden.

## Read-only Diagnose

### Neuer Sale fehlt

1. `[verifiziert]` Prüfen, ob die Offers-Annahme ein persistiertes Sync-Ergebnis beziehungsweise einen Fehler für `offer.completed` enthält.
2. `[verifiziert]` Den geschützten Offers-Feed nur mit autorisiertem Read-only-Aufruf prüfen; keine Schlüssel in Shell-Historie oder Logs schreiben.
3. `[verifiziert]` In Ops nach `offer_id`, `offer_number`, `document_reference` und `request_id` suchen.
4. `[verifiziert]` Den manuellen Completed-Offers-Sync nur nach expliziter Freigabe auslösen, weil er Daten schreibt und Shopify abfragt.
5. `[verifiziert]` Bei Shopify-Fallback zuerst eindeutige Offer-/Order-Referenzen prüfen. Reine Namens- oder Betragsähnlichkeit darf keine mehrdeutige Zuordnung erzwingen.

### Bereits vergebener Sale bleibt aktiv

1. `[verifiziert]` Exakte Shopify-Tags prüfen: `Quentin (noch bezahlen)` oder `Saeid (schon bezahlt)`; der historische Quentin-Alias wird inbound ebenfalls erkannt.
2. `[verifiziert]` `shopify_order_id`, Order-Referenz und `shopify_tag_sync_status` in der Ops-Projektion prüfen.
3. `[verifiziert]` Sicherstellen, dass der 5-Minuten-Tag-Sync in n8n tatsächlich aktiv ist; eine Draft-Datei reicht nicht als Beleg.
4. `[verifiziert]` Einen manuellen `sync_shopify_supplier_tags` erst nach Freigabe ausführen. Ergebnis und Reconcile-Zähler sichern.
5. `[verifiziert]` Keine Row manuell löschen, nur weil Trello oder Shopify anders aussieht.

### Bezahllink fehlt

1. `[verifiziert]` Prüfen, ob eine Shopify-Order eindeutig verknüpft ist.
2. `[verifiziert]` Prüfen, ob Shopify `statusPageUrl` oder ein unterstütztes Linkfeld liefert beziehungsweise ob ein Snapshot-Link vorhanden ist.
3. `[verifiziert]` Den Shopify-Admin-Link nicht als beweisbaren Kunden-Bezahllink behandeln.
4. `[verifiziert]` Keine Erinnerung senden, bis Empfängeradresse, kundentauglicher Link und Opt-out-Tag geprüft sind.

### Vergeben-Button meldet Fehler

1. `[verifiziert]` Zahlung: `paid_confirmed` oder explizit `manual_approved_unpaid`.
2. `[verifiziert]` Lieferdatum: Pflichtfeld und normalisierbares Datum.
3. `[verifiziert]` Änderung: `change_requested` muss quittiert sein; ein bloß offenes 24-Stunden-Fenster ist kein Blocker.
4. `[verifiziert]` Supplier und Sonder-Supplier-Name prüfen.
5. `[verifiziert]` Bei Partial Failure den vorhandenen Assignment Attempt und dessen Side-Effect-Status prüfen; nicht blind erneut einen anderen Auftrag erzeugen.

### Kundenauswahl oder Bilder fehlen

1. `[verifiziert]` `offer_snapshot` und normalisierte `supplier_sale_items` auf Positionen, Menge und Auswahlmerkmale prüfen.
2. `[verifiziert]` Bildquellen in Snapshot-/Line-Item-Metadaten prüfen. Die UI kann kein Bild rekonstruieren, das keine Quelle geliefert hat.
3. `[verifiziert]` Größe, Farbe und Zuschnitt müssen aus strukturierten Snapshot-Feldern beziehungsweise Auswahltexten stammen; keine Werte erfinden.

### Zahlungserinnerung oder AB

1. `[verifiziert]` Vorher Empfänger, Link/PDF, Opt-out-Tag und Vorschau kontrollieren.
2. `[verifiziert]` Der UI-Befehl reserviert idempotent und ruft den konfigurierten n8n-Webhook auf.
3. `[verifiziert]` Ohne Reminder-Webhook erzeugt der aktuelle Code eine interne Aufgabe; dies ist ein Fallback, kein Versandbeleg.
4. `[verifiziert]` Eine erfolgreiche API-Antwort muss zusammen mit gespeichertem Versandstatus oder Provider-ID geprüft werden.
5. `[verifiziert]` Kein echter Test an einen Kunden. Für Live-QA ausschließlich ausdrücklich freigegebene interne Testadresse und Test-Sale verwenden.

## Konfigurationsnamen

- `[verifiziert]` Offers/Ops: `NEONTRIP_OFFERS_BASE_URL`, `NEONTRIP_OFFERS_INTERNAL_API_KEY`, `NEONTRIP_OPS_SUPPLIER_SALES_URL`, `SUPPLIER_SALES_AGENT_API_TOKEN`, `QUOTE_INTERNAL_API_TOKEN`, `OPS_INTERNAL_API_KEY`.
- `[verifiziert]` Shopify: `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ADMIN_API_ACCESS_TOKEN`, `SHOPIFY_ADMIN_API_VERSION`, `SHOPIFY_SUPPLIER_TAG_QUENTIN`, `SHOPIFY_SUPPLIER_TAG_SAID`, `SHOPIFY_SUPPLIER_TAG_SPECIAL`, `SHOPIFY_NO_PAYMENT_REMINDER_TAG`.
- `[verifiziert]` Trello: `TRELLO_API_KEY`, `TRELLO_TOKEN`, `SUPPLIER_TRELLO_PROJECTION_ENABLED`, `SUPPLIER_TRELLO_QUENTIN_LIST_ID`, `SUPPLIER_TRELLO_SAID_LIST_ID`, `SUPPLIER_TRELLO_SPECIAL_LIST_ID`.
- `[verifiziert]` Side Effects: `SUPPLIER_ASSIGNMENT_TASKS_ENABLED`, `SUPPLIER_PAYMENT_REMINDER_WEBHOOK_URL`, `SUPPLIER_ORDER_CONFIRMATION_WEBHOOK_URL`.
- `[verifiziert]` Der Code unterstützt mehrere historische Aliase. Neue Konfiguration soll die kanonischen Namen verwenden und nicht unnötig mehrere Schlüssel parallel aktiv halten.
- `[verifiziert]` Secret-Werte gehören ausschließlich in den Runtime-Secret-Store, nie in Repo, Chat, Screenshots oder Diagnoseausgaben.

## Mutations- und Approval-Matrix

| Aktion | Ohne Freigabe | Erforderlich |
| --- | --- | --- |
| Code/Git/Tests read-only prüfen | erlaubt | `[verifiziert]` Keine Secrets, keine externe Mutation. |
| Lokalen Worktree und lokalen Commit erstellen | erlaubt im beauftragten Scope | `[verifiziert]` Nur eigene Dateien, sauberer Diff. |
| Offers-/Shopify-/n8n-/Trello-Live-Read | nur bei vorhandener sicherer Sitzung | `[verifiziert]` Read-only, keine PII dokumentieren. |
| Ops-Sync, Supplier-Vergabe, Reminder, AB oder Tag-Retry | nicht erlaubt | `[verifiziert]` Explizite Zustimmung und definierter Testdatensatz. |
| n8n aktivieren/ändern, Env ändern, Supabase migrieren | nicht erlaubt | `[verifiziert]` Backup, Diff, Rollback, ausdrückliche Zustimmung. |
| Push auf `main` | nicht erlaubt | `[verifiziert]` Kann den Deploy-Workflow auslösen; Scope und Commit bestätigen lassen. |
| Deploy/Redeploy | nicht erlaubt | `[verifiziert]` Erfolgreicher Preflight und explizite Deploy-Freigabe. |

## Release-Gate

1. `[verifiziert]` Im eigenen Aufgabenworktree arbeiten; der saubere Kandidat muss den frisch abgefragten Stand von `origin/main` enthalten.
2. `[verifiziert]` Fokussierte Tests, `npm run test:quotes`, `npx tsc --noEmit` und `npm run build` grün.
3. `[verifiziert]` UI-Smoke stabil und grün oder begründete Freigabe mit dokumentiertem Rest-Risiko.
4. `[verifiziert]` Diff auf Secrets, unbeabsichtigte Migrationen und fremde Änderungen prüfen.
5. `[verifiziert]` Nur beauftragte Dateien committen.
6. `[verifiziert]` Scope und volle Commit-SHA des sauberen Kandidaten für die Veröffentlichung freigeben lassen. Eine vorhandene Freigabe gilt weiter, solange Scope und SHA unverändert sind; bereits der Push auf `main` kann Produktion verändern.
7. `[verifiziert]` Vor diesem Push im selben Aufgabenworktree `codex-predeploy ops` ausführen. Der ausgegebene `Full commit`, die freigegebene SHA und der aktuelle `HEAD` müssen übereinstimmen. Predeploy prüft den Git-Kandidaten und ersetzt weder die Tests oben noch den späteren Betriebsnachweis.
8. `[verifiziert]` Nur nach erfolgreichem Preflight und übereinstimmenden SHAs im selben Aufgabenworktree `codex-safe-push-main` statt rohem `git push origin main` ausführen. Ändert sich der Kandidat, etwa durch Rebase, den neuen Diff prüfen, betroffene Prüfungen wiederholen und die neue exakte SHA freigeben lassen. Bei fortgeschrittenem `origin/main` zuerst abgleichen und den Preflight vor dem Push erneut ausführen. Einen fehlenden oder fehlschlagenden Helfer niemals umgehen.
9. `[verifiziert]` Für einen zusätzlichen manuellen Deploy/Redeploy unmittelbar vorher erneut `codex-predeploy ops` im selben Aufgabenworktree ausführen und die Übereinstimmung von ausgegebener SHA, freigegebener SHA und `HEAD` prüfen. Nur genau diesen Commit deployen.
10. `[verifiziert]` Nach Deploy geschützten Health-/UI-Smoke, Sales-Flow-Diagnose und relevante Integrationszustände prüfen, ohne einen echten Kundenversand auszulösen.

## Rollback

- `[verifiziert]` Code: Mit `codex-new-worktree ops <topic>` den passenden Aufgabenworktree ermitteln und einen gezielten Revert des exakten Commits erstellen. Das vollständige Release-Gate oben gilt auch hier: erforderliche Tests, sauberer Revert-Commit, Freigabe seiner exakten SHA, dann im selben Worktree `codex-predeploy ops` vor `codex-safe-push-main`. Nur den freigegebenen und vom Preflight bestätigten Revert-Commit deployen; bei geänderter SHA erneut prüfen und freigeben lassen.
- `[verifiziert]` n8n: Vor Änderung Export/Backup und Diff sichern; bei Regression den Workflow deaktivieren oder die gesicherte Version wiederherstellen. Keine parallelen Workflow-Kopien aktiv lassen.
- `[verifiziert]` Konfiguration: Vor Änderung nur Namen/Checksummen und den bisherigen Zustand dokumentieren; Secret-Werte nicht exportieren. Rückkehr auf den vorherigen Secret-Store-Zustand muss separat möglich sein.
- `[verifiziert]` Datenbank: Rollback-SQL existiert für die Basismigration, ist aber nach produktiver Datennutzung nicht blind anzuwenden. Backup, Impact-Analyse und ausdrückliche Datenbankfreigabe sind Pflicht.
- `[verifiziert]` Side Effects wie versandte E-Mails, gesetzte Shopify-Tags oder erstellte Trello-Karten sind nicht durch einen Code-Rollback rückgängig. Sie benötigen eine eigene, protokollierte Korrektur.
