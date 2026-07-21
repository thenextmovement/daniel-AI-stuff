# Kundenakte und Calls Review - System Map

## Source-of-Truth-Grenzen

| Bereich | Autorität | Status | Bedeutung |
| --- | --- | --- | --- |
| Kunde und aktueller Request | `master_customers`, `master_requests` | `[verifiziert]` | Postgres ist kanonisch; `master_customers.request_id` ist der aktuelle Zeiger, alte Requests bleiben über `master_requests.customer_id` erreichbar. |
| Segmente | `master_requests` plus letzte Klassifikation | `[verifiziert]` | KI-Vorschlag wird angezeigt; manuelle Bestätigung schreibt deterministisch in `master_requests`. |
| Call-Aufgaben | `sales_tasks` | `[verifiziert]` | Persistente Wahrheit für offene/fällige Call-, Callback-, Angebots- und E-Mail-Aufgaben. |
| Call-Cadence und Ergebnisse | `sales_call_cadence_state`, `sales_call_results` | `[verifiziert]` | Tageslisten sind Ansichten; Ergebnis und Cadence bleiben fallbezogen erhalten. |
| Call-Tageslauf | `sales_call_runs`, `sales_call_list_items` | `[verifiziert]` | Snapshot eines Tageslaufs, nicht alleinige Wahrheit für zukünftige Arbeit. |
| Angebotsversand | Offers-Ereignis -> `ops_offer_events`/RPC | `[verifiziert]` | Erfolgreicher Versand startet idempotent die Angebots-Nachfassstrecke. |
| Workboard-Status | `customer_case_state` | `[verifiziert]` | Aktueller Zustand `active`, `handled` oder `snoozed`; `workflow_audit_log` bleibt Historie. |
| Audit/Notizen/Teamstatus | `workflow_audit_log` | `[verifiziert]` | Ereignishistorie und mehrere abgeleitete Zustände; kein Ersatz für kanonische Tabellen, wenn eine solche existiert. |
| Trello | Trello API plus IDs/URLs in Postgres | `[verifiziert]` | Projektion und Arbeitsmaterial. Eine Karte darf keine fachliche Wahrheit überschreiben. |
| Outlook/E-Mail | synchronisierte Postgres-Tabellen | `[aus Code abgeleitet]` | Die Kundenakte liest synchronisierte Kommunikation. Sie rekonstruiert keine fehlenden Originalzeiten. |
| Auth | Cloudflare Access JWT oder Portal-Session | `[verifiziert]` | API-Routen validieren serverseitig; lokaler Bypass gilt nur außerhalb Production auf localhost. |

## Haupteinstiegspunkte

| Zweck | Pfad |
| --- | --- |
| Kundenakte Seite | `src/app/ops/customer-records/page.tsx` |
| Kundenakte Client | `src/app/ops/customer-records/page-client.tsx` |
| Suche, Preview, Kontaktdaten-Update | `src/app/api/ops/customer-records/route.ts` |
| Direkte Fallaktionen | `src/app/api/ops/customer-records/actions/route.ts` |
| Angebotsmail-Schnittstelle | `src/app/api/ops/customer-records/offers/[offerId]/send/route.ts` |
| Notizen/Aufgaben | `src/app/api/ops/customer-records/notes/route.ts` |
| Trello-Felder | `src/app/api/ops/customer-records/trello-fields/route.ts` |
| Trello-Karte | `src/app/api/ops/customer-records/trello-card/route.ts` |
| Trello-Duplizierung | `src/app/api/ops/customer-records/trello-card/duplicate/route.ts` |
| Kundenakte Domäne | `src/lib/ops/customer-records.ts` |
| Calls Seite | `src/app/ops/customer-records/calls/page.tsx` |
| Calls Client | `src/app/ops/customer-records/calls/page-client.tsx` |
| Calls API | `src/app/api/ops/customer-records/calls/route.ts` |
| Calls Domäne | `src/lib/ops/customer-call-module.ts` |
| Aufgaben-Engine | `src/lib/ops/sales-task-engine.ts` |
| Segmentkatalog | `src/lib/ops/customer-segments.ts` |
| Supabase REST | `src/lib/quotes/supabase-rest.ts` |
| Trello Client | `src/lib/quotes/trello.ts` |

## Kundenakte-Lesefluss

1. `[verifiziert]` `GET /api/ops/customer-records` validiert Ops-Zugriff und wählt Suche, Inbox oder Workboard.
2. `[verifiziert]` Die Suche bestimmt deterministisch einen Modus: Request-ID, exakte E-Mail, Name/Firma, Telefon, Deal oder Trello.
3. `[verifiziert]` E-Mail-Suche berücksichtigt `email`, `billing_email`, `original_email` und `cc_emails`. Request-ID-Fallback lädt zuerst `master_requests.customer_id`, wenn der aktuelle Kundenzeiger nicht mehr auf den gesuchten Request zeigt.
4. `[verifiziert]` Der volle Fallkontext fächert parallel auf viele Quellen auf: Requests, Quotes, Orders, CRM, Calls, Voice Calls, Follow-ups, Pläne, Document Journey, Kommunikation, Outlook, E-Mail-Agent, Audit, Case State, aktive Viewer und Segmentklassifikation.
5. `[verifiziert]` Verwandte Kunden/Requests, Quote-Versionen, Bilder, Offer-Tracking und Trello werden zusätzlich geladen. Trello-Fehler werden beim Lesen abgefangen; andere zentrale Supabase-Fehler können den gesamten Fall-Read fehlschlagen lassen.
6. `[aus Code abgeleitet]` Dieser breite Fan-out erklärt, warum die Kundenakte und Angebotskontext langsamer als schmale Ops-Seiten laden können.

## Calls-Lesefluss

1. `[verifiziert]` Kandidaten stammen ausgewogen aus Requests der letzten 30 Tage, gesendeten Master-/CRM-Angeboten, gespeicherter Cadence und sichtbaren aktiven `sales_tasks`.
2. `[verifiziert]` Für den initialen Preview werden höchstens 30 Kandidaten ausgewogen über die drei Tabs geladen; ein vollständiger Refresh arbeitet mit bis zu 80 Kandidaten und maximal 160 Kontext-IDs.
3. `[verifiziert]` Die Calls-Ansicht nutzt einen schlankeren Customer-Records-Read ohne Live-Trello im Hauptpfad. Begrenzte Trello-Bild-Fallbacks und gespeicherte Bild-Snapshots reduzieren Requests.
4. `[verifiziert]` `getSalesCallModuleState` verwendet den jüngsten heutigen Lauf, solange er höchstens zwei Minuten alt ist. Sonst wird ein Preview erzeugt.
5. `[verifiziert]` `refreshSalesCallList` nutzt normalerweise `ops_claim_refresh_lock` mit 60 Sekunden Cooldown, schreibt Run und List-Items und synchronisiert Cadence/Aufgaben begrenzt parallel.
6. `[verifiziert]` Die API begrenzt State/Refresh auf 35 Sekunden. Bei Fehlern antwortet sie absichtlich mit HTTP 200, `degraded:true` und einem fehlgeschlagenen Modulzustand oder einem lesbaren Fallback.

## Call-Guards

Ein echter Call wird serverseitig blockiert, wenn mindestens eine Bedingung gilt:

- Kontaktstopp oder Do-not-contact ist aktiv.
- Der Fall ist abgeschlossen oder ein Auftrag ist verknüpft.
- Eine frische Kundenantwort muss zuerst geprüft werden.
- Ein Rückruf ist für die Zukunft terminiert.
- Es fehlt eine Telefonnummer.

Schwache Telefonnummern werden nicht hart blockiert, aber als Aufmerksamkeitspunkt markiert. Review-Presets dürfen auch bei einem blockierten Call gespeichert werden; echte Call-Presets nicht.

## Sichtbare Call-Tabs

| Tab | Deterministische Zuordnung |
| --- | --- |
| `Neue Anfragen` | `cadence.currentStage === inquiry_call` |
| `Angebot gesendet` | `quote_call` oder `no_response_call` |
| `Fällige Anrufe` | Callback, manuell, Anpassung, Datenproblem und sonstige nicht abgeschlossene Stufen |

Ein Fall bleibt nur sichtbar, wenn eine aktive Aufgabe jetzt sichtbar ist, ein heutiger neuer Request/ein heutiges Angebot vorliegt oder `nextCallDueAt` heute fällig ist. Abgeschlossene Fälle und Fälle mit Auftrag werden entfernt.

## Calls-Review-Gate

- `[verifiziert]` Das Review bewertet die Top 10 des aktuellen Laufs. Pflichtfelder und Callback-Datum werden validiert.
- `[verifiziert]` `green` verlangt vollständige Review-Arbeit, keine kritischen Datenfehler und mindestens sieben informative nützliche Ergebnisse sowie zwei konkrete nächste Schritte oder ein hinreichend vielfältiges Lernsignal.
- `[verifiziert]` Zwei oder mehr falsche Telefonnummern führen zu `red`; fünf oder mehr informative nützliche Ergebnisse können `yellow` erreichen.
- `[verifiziert]` Technisch abgeschlossen ist das Review nur bei `technicalStatus=ok`, grünem Gate und mindestens einem konkreten Sales-Nächsten-Schritt.
- `[verifiziert]` Simulations-/Testnotizen und Platzhalter zählen nicht als belastbarer fachlicher Kontext.

## Geprüfte Schreibaktionen

| Aktion | Hauptwirkung | Guard / Rückfall |
| --- | --- | --- |
| Kontakt-Preview | keine Mutation | Validiert Diff, betroffene Tabellen und Warnungen. |
| Kontakt speichern | `master_customers` plus abhängige Follow-up-/Dokument-Zeilen | Validierung, Audit und kompensierender Rollback bei Fehler. |
| Letzte Kontaktänderung zurückrollen | stellt letzten vollständigen Snapshot wieder her | Nur wenn aktueller Zustand exakt dem letzten `after` entspricht. |
| Segment bestätigen | schreibt `master_requests` | Statischer Segmentkatalog; bei Auditfehler Rückschreiben des vorherigen Zustands. |
| Follow-ups pausieren/verschieben | `followup_queue`, teils `lead_followup_plans` | Zukunftsdatum, offene Rows, kompensierender Rollback. |
| Kontaktstopp | Follow-ups abbrechen, Plan blockieren, E-Mail blacklisten | Kompensierender Rollback im Domänenpfad; UI-Einzelaktion hat derzeit keine zweite Bestätigung. |
| Rückruf | verschiebt Follow-ups/Pläne | Zukunftsdatum und kompensierender Rollback innerhalb dieser Aktion. |
| Fallausgang / Sales-Recovery | verkettet mehrere Aktionen | Einzelaktionen validieren; Gesamtverkettung ist nicht atomar. |
| Aktualisiertes Angebot senden | externe Kunden-E-Mail, Offer-Event, Call-Sync und Versand-Evidenz | Serverseitig werden Preisfreigabe, E-Mail-Zuordnung/-Format und Idempotenz geprüft; im UI fehlt eine finale Bestätigung, nach dem Versand sind Sync/Evidenz getrennte best-effort Schritte. |
| Workboard/Team/Flow/Sonderfall | `customer_case_state` oder Audit-Ereignis | Serverseitige Eingabevalidierung, aber nicht durchgehend idempotent. |
| Trello-Felder/-Karte | Trello API plus Audit | Karte muss zum geladenen Fall/Board gehören; kompensierende Trello-Rollbacks. |
| Trello duplizieren | neue Karte, neue Request-ID, neue DB-Zeile, aktueller Kundenzeiger, Call-Aufgabe | Idempotenzschlüssel, Kartenvergleich, Archiv-Rollback nur vor DB-Insert. |
| Call-Ergebnis | Ergebnis, Audit, Cadence, nächste `sales_task` | Live-Guard und optimistischer Latest-Result-Check; RPC ist der sichere Normalpfad. Gesamtwrite und terminale Customer-Ops-Folgen sind noch nicht atomar/geschlossen. |
| Call-Liste aktualisieren | Run/List-Items, Cadence und Aufgaben | Cooldown-Lock im Normalpfad; Side-Effect-Fehler werden gezählt und auditiert. |

## Trello-Duplizierungsfluss

1. Der Operator bestätigt im Browser die Erstellung einer neuen Anfrage.
2. Ein Browser-Idempotenzschlüssel wird mitgesendet.
3. Der Server prüft, ob Schlüssel, Karte und Board bereits verarbeitet beziehungsweise zum Fall gehören.
4. Trello kopiert die Karte mit `keepFromSource=all`; Titel und Beschreibung werden erneut gesetzt.
5. Das Request-ID-Custom-Field wird auf eine neue UUID gesetzt.
6. Titel, Beschreibung, Custom Fields und Attachment-Signaturen werden bis zu dreimal geprüft.
7. Eine neue `master_requests`-Zeile mit `status=new`, `deal_status=open` und Herkunftsmetadaten wird angelegt.
8. `master_customers.request_id` zeigt danach auf die neue Anfrage.
9. Eine idempotente `call_new_inquiry`-Aufgabe und ein Audit werden best effort angelegt.

## Segmentierungsfluss

- `[verifiziert]` Die UI liest kanonische Request-Felder und bevorzugt die letzte Klassifikation, solange keine manuelle Quelle vorliegt.
- `[verifiziert]` Review ist nötig, wenn Segment fehlt, Status nicht `accepted` ist oder Confidence unter `0.75` liegt.
- `[verifiziert]` Manuelle Bestätigung setzt Confidence `1`, Quelle `manual_ops_portal` und Policy `manual_override_v1_20260521`.
- `[historisch]` `docs/projects/customer-records-ops/request-segmentation.md` nennt einen minütlichen n8n-Workflow mit OpenAI-Websuche und genau einem Job pro Lauf.
- `[Live-Evidenz fehlt]` Aktivierung, Queue-Rückstand, Modell-/Websuche, aktuelle Policy und tatsächliche externe Domain-Recherche wurden in dieser Übergabe nicht live geprüft.

## Auth und Datenzugriff

- Alle Kernrouten prüfen `isOpsPortalConfigured` und `hasOpsSession`.
- Cloudflare Access JWT wird gegen Issuer, Audience, Zeit, RS256-Signatur und optionale E-Mail-Allowlist validiert.
- Lokaler Bypass gilt nur für `localhost`/`127.0.0.1`, wenn `NODE_ENV` nicht `production` ist.
- Supabase-Zugriffe erfolgen ausschließlich serverseitig mit `SUPABASE_SERVICE_ROLE_KEY`.
- GET/HEAD-Requests werden bei Transportfehlern oder 502/503/504 bis zu dreimal versucht. Schreibrequests werden nicht automatisch wiederholt.
