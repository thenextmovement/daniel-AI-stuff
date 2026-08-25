# Sales-Vergabe Known Issues

## Priorität Hoch

### Event-Constraint ist gegenüber dem Code veraltet

- `[verifiziert]` `supabase/migrations/20260609102438_create_supplier_sales_ops.sql` erlaubt in `supplier_sale_events.event_type` nur zehn ursprüngliche Werte.
- `[verifiziert]` `src/lib/ops/supplier-sales.ts` schreibt zusätzlich mindestens `source_trello_order_title_synced`, `source_trello_order_title_sync_failed`, `post_order_change_acknowledged` und `shopify_tag_retry`.
- `[verifiziert]` Keine spätere Repository-Migration erweitert diesen Constraint.
- `[aus Git/Code abgeleitet]` `insertEvent` behandelt Insert-Fehler defensiv, wodurch die fachliche Hauptaktion erfolgreich erscheinen kann, obwohl das Audit-Ereignis fehlt.
- `[offen]` Das produktive Schema könnte manuell abweichen; das wurde wegen der No-Mutation-/No-Secret-Grenze nicht live geprüft.
- `[offen]` Nächster Schritt: additive Migration mit allen tatsächlich verwendeten Event-Typen und fokussierter Migration-/Rollback-Prüfung erstellen.

### Gewünschter automatischer 5-Minuten-Bezahllink-Versand fehlt

- `[verifiziert]` Im aktuellen Code gibt es nur die explizite UI-Aktion `request_payment_reminder`.
- `[verifiziert]` Es existiert keine implementierte Regel „private E-Mail-Adresse, fünf Minuten nach Bestellung automatisch senden“.
- `[aus Git/Code abgeleitet]` Eine naive Automatisierung könnte falsche Empfänger, fehlende Links oder Kunden mit Opt-out anschreiben.
- `[offen]` Vor Umsetzung müssen Start-Ereignis, Verzögerung, Kundentyp, gültiger Payment-Link, `Keine Zahlungserinnerung n8n`, Wiederholungsregel, Arbeitszeiten und interne Teststrategie beschlossen werden.

### Produktiver Sync-/Workflow-Zustand ist nicht belegt

- `[nur aus Thread erinnert]` Der Payment-Reminder-Workflow `h2Eye2kArl2CBx3k` wurde als aktiv gemeldet.
- `[verifiziert, Read-only 2026-08-25]` Der Shopify-Tag-Sync `WlSmT7zlLcR4TlUG` ist weiterhin inaktiv (`active:false`, kein `activeVersionId`); ohne manuellen `Sync + Laden` oder eine sichere Reaktivierung läuft daher kein regelmäßiger Storno-/Tag-Abgleich.
- `[offen]` Completed-Offers- und AB-Workflow haben keine verifizierte produktive ID oder Aktivierungsprüfung.
- `[offen]` Es fehlt ein kontrollierter End-to-End-Beleg: neue Annahme erscheint zeitnah, Shopify-Zahlung/Tag reconciled, Vergabe setzt exaktes Tag, freigegebene Testmail und Trello-Projektion erzeugen genau einen Side Effect.

## Priorität Mittel

### Snapshot und AB sind semantisch nicht getrennt

- `[verifiziert]` `snapshot_pdf` und `order_confirmation_pdf` verwenden denselben AB-Generator aus `offer_snapshot`.
- `[verifiziert]` Das unveränderliche Offers-PDF ist separat über `final_pdf_url` vorhanden.
- `[verifiziert]` Der nicht gemergte Commit `dead29867153af7d81d131aff3c82f59d9eaaae6` verändert Linkdarstellung und Tests, gehört aber nicht zu `origin/main`.
- `[offen]` Produktentscheidung: „Snapshot“ entweder klar als generierte Auswahl-/AB-Ansicht benennen oder ein echtes unveränderliches Accepted-Snapshot-Artefakt anbinden.

### Trello-Projektion und Dokumentation widersprechen sich

- `[verifiziert]` Commit `90813f4` und der aktuelle Code deaktivieren Supplier-Kartenerstellung standardmäßig.
- `[verifiziert]` `SUPPLIER_TRELLO_PROJECTION_ENABLED` ist im Code erforderlich, fehlt aber in `.env.ops.example`; vorhandene Integrationsdokumentation erweckt mit Listen-IDs allein einen vollständigeren Eindruck.
- `[verifiziert]` Ohne gespeicherte Supplier-Karten-ID liefert die UI nur Quellkarte oder Quentin-Board-Suche, keinen garantierten direkten Match über Request-/Nerdyforms-ID.
- `[offen]` Doku/Env-Beispiel an tatsächlichen Opt-in-Mechanismus angleichen und Unique-ID-Auflösung mit Ambiguitätsprüfung spezifizieren.

### UI-Gating ist teilweise widersprüchlich

- `[verifiziert]` `reviewBlocksAssignment` wird im Client berechnet, aber nicht für den Disabled-Zustand des Vergabe-Buttons verwendet. Die API lehnt `change_requested` trotzdem ab.
- `[aus Git/Code abgeleitet]` Mitarbeiter sehen dadurch einen klickbaren Button und erst nach dem Klick einen Fehler.
- `[verifiziert]` `reminderBlockReason` deaktiviert derzeit den Button `Warten`, während `Erinnerung` bei fehlender E-Mail oder fehlendem Payment-Link nicht entsprechend disabled ist.
- `[aus Git/Code abgeleitet]` Dies kann tote beziehungsweise fehlerwerfende Buttons erklären und kehrt die erwartete Bedienlogik um.
- `[offen]` UI und API auf dieselben Guard-Funktionen stellen und mit Komponententest plus korrigiertem Playwright-Smoke absichern.

### UI-Smoke ist nicht deterministisch

- `[verifiziert]` `scripts/smoke_sales_vergabe_ui.mjs` schaltet Scope, Supplier und Zahlungsstatus ohne Warten auf jeden einzelnen Fetch um.
- `[verifiziert]` Der lokale Lauf am 2026-07-21 lief in einen 10-Sekunden-Timeout, nachdem der erwartete Mock-Sale nach der kombinierten Filtersequenz nicht sichtbar wurde.
- `[aus Git/Code abgeleitet]` Mehrere schnelle `useEffect`-Fetches können ihre Antworten in anderer Reihenfolge setzen; das Skript wartet nur an einigen Übergängen explizit auf die Response.
- `[offen]` Smoke-Skript pro Filterwechsel auf die genaue Request-Kombination warten lassen und erst danach als Release-Gate verwenden.

### Authentisierung und Replay-Schutz sind breiter als nötig

- `[verifiziert]` Die Ops-Route akzeptiert mehrere Bearer-Aliase: `SUPPLIER_SALES_AGENT_API_TOKEN`, `QUOTE_INTERNAL_API_TOKEN`, `OPS_INTERNAL_API_KEY` und `NEONTRIP_OFFERS_INTERNAL_API_KEY`.
- `[verifiziert]` Der Offers-Pull kann nach abgelehntem dediziertem Key auf den Supabase-Service-Role-Key zurückfallen.
- `[verifiziert]` HMAC-Timestamps werden auf zehn Minuten geprüft, sind aber nicht für jeden signierten Aufruf zwingend vorhanden.
- `[aus Git/Code abgeleitet]` Breite Key-Akzeptanz und Service-Role-Fallback vergrößern Rotations- und Blast-Radius-Risiken.
- `[offen]` Dedizierte scoped Credentials und verpflichtenden Timestamp/Nonce für neue Integrationen einführen, ohne bestehende Produktionspfade unkontrolliert zu brechen.

### Paging und Live-Check können falsche Sicherheit geben

- `[verifiziert]` `Mehr laden` lädt die Liste erneut von vorne und erhöht nur das Limit bis 500; es gibt keinen Cursor.
- `[verifiziert]` Der Active-Read holt begrenzt mehr Kandidaten und filtert anschließend. Bei vielen extern vergebenen Rows können ältere noch offene Sales außerhalb des Fensters bleiben.
- `[verifiziert]` Statistiken sind auf 2.000 Rows begrenzt.
- `[verifiziert]` `latestCompletedOfferInTopVergabe` prüft nur, ob die neueste Offer-ID in einer Top-Menge vorkommt, nicht ob sie tatsächlich an Position eins steht.
- `[offen]` Server-seitiges Cursor-Paging und eine echte Sortpositionsprüfung einführen.

### Payment-Link ist nicht immer ein kundentauglicher Bezahllink

- `[verifiziert]` Linkextraktion versucht mehrere Shopify-/Snapshot-Felder und `statusPageUrl`.
- `[verifiziert]` Die Reminder-Funktion kann als Fallback einen Shopify-Admin-Link verwenden.
- `[aus Git/Code abgeleitet]` Ein Admin-Link ist für Kunden ungeeignet und darf nicht als erfolgreich vorhandener Bezahllink dargestellt oder versendet werden.
- `[offen]` Linktypen explizit klassifizieren und Kundenversand auf allowlistete öffentliche HTTPS-Hosts begrenzen.

## Priorität Niedrig

### Bilder hängen vollständig von Quelldaten ab

- `[verifiziert]` Die Normalisierung nutzt Offer-/Line-Item-/Shopify-Medien als Fallback-Kette.
- `[aus Git/Code abgeleitet]` Fehlt in allen Quellen eine belastbare URL, bleibt das Bild leer; die UI kann kein Produktbild zuverlässig aus Shopify erraten.
- `[offen]` Fehlende Medien mit Ursache kennzeichnen und den Offers-Payload für abgeschlossene Dokumente vollständig machen.

### Positionen werden nicht transaktional ersetzt

- `[verifiziert]` Die Aktualisierung der `supplier_sale_items` löscht vorhandene Items und fügt neue danach ein, ohne sichtbare gemeinsame Datenbanktransaktion im Repository-Code.
- `[aus Git/Code abgeleitet]` Ein Fehler zwischen beiden Schritten kann vorübergehend einen Sale ohne Positionen hinterlassen.
- `[offen]` In eine atomare RPC oder transaktionale Datenbankfunktion verschieben.

## Nicht belastbare Thread-Aussagen

- `[nur aus Thread erinnert]` Mehrere Meldungen behaupteten, Coolify-Variablen, grüne Diagnosekarten, Outlook-Credential und Trello-Listen seien produktiv korrekt gesetzt.
- `[nur aus Thread erinnert]` Mehrere Antworten behaupteten allgemein „deployed“ oder „alles erledigt“, ohne durchgehend den exakten Commit und einen fachlichen End-to-End-Test zu nennen.
- `[offen]` Diese Aussagen dürfen nicht als aktueller Betriebsbeleg verwendet werden; jede neue Session muss Read-only-Status und exakten Release-Commit erneut prüfen.
